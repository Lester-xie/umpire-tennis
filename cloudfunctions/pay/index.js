// 云函数入口文件
const crypto = require('crypto')
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV }) // 使用当前云环境

const db = cloud.database()
const _ = db.command

function normalizeOrderDatePay(raw) {
  const s = String(raw || '').trim()
  const parts = s.split('-')
  if (parts.length !== 3) return s
  const y = parseInt(parts[0], 10)
  const mo = parseInt(parts[1], 10)
  const d = parseInt(parts[2], 10)
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return s
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function sessionKeyFromHoldIdsPay(ids) {
  return [...(ids || [])]
    .map((id) => String(id || '').trim())
    .filter(Boolean)
    .sort()
    .join('|')
}

function defaultCapacityLimitPay(lessonType, pairMode, groupMode) {
  const lt = String(lessonType || '').trim()
  if (lt === 'group') return 5
  if (lt === 'open_play') {
    const gm = String(groupMode || '').trim().toLowerCase()
    if (gm === 'group36') return 6
    return 6
  }
  const pm = String(pairMode || '')
    .trim()
    .toLowerCase()
  if (pm === '1v2') return 2
  return 1
}

function venueIdInValuesPay(venueIdRaw) {
  const s = String(venueIdRaw || '').trim()
  if (!s) return []
  const out = new Set([s])
  const n = Number(s)
  if (Number.isFinite(n)) out.add(n)
  return [...out]
}

function orderDateInValuesPay(orderDateRaw, normalized) {
  const raw = String(orderDateRaw || '').trim()
  const set = new Set()
  if (normalized) set.add(normalized)
  if (raw) set.add(raw)
  return [...set]
}

async function assertCoachCourseCanCreatePending(dbConn, cmd, { phone, venueId, orderDate, coachHoldIds }) {
  const sk = sessionKeyFromHoldIdsPay(coachHoldIds)
  const phoneNorm = String(phone || '').trim()
  const orderDateNorm = normalizeOrderDatePay(orderDate)
  const venueIds = venueIdInValuesPay(venueId)
  const dateKeys = orderDateInValuesPay(orderDate, orderDateNorm)
  if (!venueIds.length || !orderDateNorm) {
    return { ok: false, msg: '场馆或日期无效' }
  }
  for (let i = 0; i < coachHoldIds.length; i += 1) {
    try {
      const docRef = await dbConn.collection('db_coach_slot_hold').doc(coachHoldIds[i]).get()
      if (!docRef.data || String(docRef.data.status || '') !== 'active') {
        return { ok: false, msg: '该课节不可订，请刷新后重试' }
      }
    } catch (e) {
      return { ok: false, msg: '该课节不可订，请刷新后重试' }
    }
  }
  const h0 = await dbConn.collection('db_coach_slot_hold').doc(coachHoldIds[0]).get()
  const hd = h0.data
  let limit = Math.floor(Number(hd && hd.capacityLimit))
  if (!Number.isFinite(limit) || limit < 1) {
    limit = defaultCapacityLimitPay(hd && hd.lessonType, hd && hd.pairMode, hd && hd.groupMode)
  }
  limit = Math.min(99, limit)

  const all = await dbConn
    .collection('db_booking')
    .where({
      venueId: cmd.in(venueIds),
      orderDate: cmd.in(dateKeys),
      bookingSubtype: 'coach_course',
    })
    .get()

  let taken = 0
  let dup = false
  ;(all.data || []).forEach((doc) => {
    if (normalizeOrderDatePay(doc.orderDate) !== orderDateNorm) return
    const st = String(doc.status || '')
    if (!['paid', 'pending', 'payment_confirming'].includes(st)) return
    if (sessionKeyFromHoldIdsPay(doc.coachHoldIds || []) !== sk) return
    taken += 1
    if (String(doc.phone || '').trim() === phoneNorm) dup = true
  })
  if (dup) return { ok: false, msg: '您已在该课节报名或存在待支付订单' }
  if (taken >= limit) return { ok: false, msg: '该课节名额已满' }
  return { ok: true }
}

/**
 * 生成 32 位纯数字商户订单号（仅 0-9，长度固定 32）
 * 形如：1217752501201407033233368018（毫秒时间戳 + 随机数字补满 32 位）
 */
function generateOutTradeNo32() {
  const ts = Date.now().toString();
  if (ts.length >= 32) {
    return ts.slice(0, 32);
  }
  const need = 32 - ts.length;
  const buf = crypto.randomBytes(need);
  let rand = '';
  for (let i = 0; i < need; i++) {
    rand += String(buf[i] % 10);
  }
  return ts + rand;
}

/**
 * 随机字符串（微信支付 nonceStr 常用 32 位）
 * 小程序/云函数均无内置 generateRandomString，云函数里用 Node crypto 即可
 */
function generateRandomString(length = 32) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += chars[bytes[i] % chars.length];
  }
  return out;
}

// 云函数入口函数
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  /** 当前用户在小程序下的 openid；子商户 JSAPI 下作为 subOpenid 传入 */
  const openid = wxContext.OPENID;
  /**
   * 子商户绑定的小程序 AppId（与 subOpenid 配对使用）
   * 优先读环境变量 SUB_APPID；未配置时用云函数上下文里的 APPID（一般为当前小程序 appid）
   */
  const subAppid =
    process.env.SUB_APPID ||
    process.env.subAppid ||
    event.subAppid ||
    wxContext.APPID;

  // 终端 IP：优先从云函数 context 取（更可靠）
  // 兜底：从 event 里取（如果你自己传了），最后用 127.0.0.1
  const terminalIp =
    context?.CLIENTIP ||
    context?.clientIP ||
    event?.spbillCreateIp ||
    event?.terminalIp ||
    '127.0.0.1';

  // 微信要求 out_trade_no ≤32 字符；此处固定为 32 位纯数字（仅 0-9）
  const outTradeNo = generateOutTradeNo32();
  if (!/^\d{1,32}$/.test(outTradeNo)) {
    return {
      returnCode: 'FAIL',
      returnMsg: '商户订单号必须为纯数字',
      payment: undefined,
    };
  }
  const envId = process.env.ENV_ID;
  const subMchId = process.env.subMchId;

  // totalFee 必须为「整数、单位：分」。传 0.1 等小数会报「参数格式校验错误」，且不会返回 payment
  const rawFee = event.totalFee != null ? Number(event.totalFee) : 1;
  const totalFee = Math.max(1, Math.round(rawFee));

  if (!subMchId || !envId) {
    return {
      returnCode: 'FAIL',
      returnMsg: '云函数缺少环境变量 subMchId 或 ENV_ID',
      payment: undefined,
    };
  }

  if (!openid) {
    return {
      returnCode: 'FAIL',
      returnMsg: '缺少用户 OPENID，请先在小程序端完成登录/授权后再调起支付',
      payment: undefined,
    };
  }

  // 子商户号模式：JSAPI 需 subMchId + subAppid + subOpenid（与 openid 二选一，不要同时混用）
  if (!subAppid) {
    return {
      returnCode: 'FAIL',
      returnMsg:
        '子商户支付需 subAppid：请在云函数环境变量配置 SUB_APPID，或确保 wxContext.APPID 可用',
      payment: undefined,
    };
  }

  const bookingPhone = String(event.phone || '').trim();
  if (event.booking && event.booking.type === 'court' && !bookingPhone) {
    return {
      returnCode: 'FAIL',
      returnMsg: '请先完成手机号登录后再订场',
      payment: undefined,
    };
  }

  if (event.booking && event.booking.type === 'court') {
    const coachHoldIdsPre = Array.isArray(event.booking.coachHoldIds)
      ? event.booking.coachHoldIds.map((id) => String(id).trim()).filter(Boolean)
      : [];
    const bookingSubtypePre =
      event.booking.bookingSubtype != null ? String(event.booking.bookingSubtype).trim() : '';
    if (bookingSubtypePre === 'coach_course' && coachHoldIdsPre.length > 0) {
      const gate = await assertCoachCourseCanCreatePending(db, _, {
        phone: bookingPhone,
        venueId: event.booking.venueId,
        orderDate: event.booking.orderDate,
        coachHoldIds: coachHoldIdsPre,
      });
      if (!gate.ok) {
        return {
          returnCode: 'FAIL',
          returnMsg: gate.msg || '无法下单',
          payment: undefined,
        };
      }
    }
  }

  const params = {
    body: '昂湃Tennis', // 商品描述
    outTradeNo, // 商户订单号：纯数字，固定 32 位（≤32 字符）
    spbillCreateIp: terminalIp, // 终端 IP（IPv4/IPv6）
    subMchId, // 子商户号（微信支付分配）
    subAppid, // 子商户小程序/公众号 appid（与 subOpenid 配套）
    totalFee, // 订单总金额，单位：分，整数
    envId, // 接收支付回调的云函数所在环境 ID
    functionName: 'payCallback', // 支付结果异步通知云函数名
    nonceStr: generateRandomString(32), // 随机字符串，≤32 位
    tradeType: 'JSAPI',
    subOpenid: openid, // 用户在子商户 subAppid 下的 openid
  }
  const res = await cloud.cloudPay.unifiedOrder(params);

  // 订场：统一下单成功后再写入 db_booking（归属字段为 phone；支付结果由 payCallback 按 outTradeNo 更新为 paid）
  if (res.returnCode === 'SUCCESS' && event.booking && event.booking.type === 'court') {
    try {
      const coachHoldIds = Array.isArray(event.booking.coachHoldIds)
        ? event.booking.coachHoldIds.map((id) => String(id)).filter(Boolean)
        : [];
      const bookingSubtype =
        event.booking.bookingSubtype != null ? String(event.booking.bookingSubtype).trim() : '';
      const coachCourseHoursDeduct = Math.floor(
        Number(event.booking.coachCourseHoursDeduct) || 0,
      );
      const lessonKey =
        event.booking.lessonKey != null ? String(event.booking.lessonKey).trim() : '';
      if (
        bookingSubtype === 'coach_course' &&
        coachCourseHoursDeduct > 0 &&
        !lessonKey
      ) {
        return {
          returnCode: 'FAIL',
          returnMsg: '组合支付需携带课程类型 lessonKey',
          payment: undefined,
        };
      }

      await db.collection('db_booking').add({
        data: {
          phone: bookingPhone,
          outTradeNo,
          totalFee,
          status: 'pending',
          orderNumber: event.booking.orderNumber || '',
          campusName: event.booking.campusName || '',
          venueId: event.booking.venueId || '',
          orderDate: event.booking.orderDate || '',
          formattedDate: event.booking.formattedDate || '',
          orderItems: event.booking.orderItems || [],
          bookedSlots: Array.isArray(event.booking.bookedSlots)
            ? event.booking.bookedSlots
            : [],
          totalPrice: Number(event.booking.totalPrice) || totalFee / 100,
          coachHoldIds,
          bookingSubtype,
          coachCourseHoursDeduct,
          lessonKey,
          coachCapacityLabel:
            event.booking.coachCapacityLabel != null
              ? String(event.booking.coachCapacityLabel).trim()
              : '',
          memberDisplayName:
            event.booking.memberDisplayName != null
              ? String(event.booking.memberDisplayName).trim().slice(0, 40)
              : '',
          paymentMethod: 'wechat_pending',
          createdAt: Date.now(),
        },
      });
    } catch (err) {
      console.error('db_booking 写入失败', err);
      return {
        returnCode: 'FAIL',
        returnMsg: '订场订单保存失败，请重试',
        payment: undefined,
      };
    }
  }

  // 购买课时包：统一下单成功后写 db_course_purchase（pending），支付结果由 payCallback 入账 db_member_course_hours
  if (res.returnCode === 'SUCCESS' && event.goodsPurchase && event.goodsPurchase.type === 'course_hours') {
    const gp = event.goodsPurchase;
    const phone = String(gp.phone || '').trim();
    const lessonKey = String(gp.lessonKey || '').trim();
    const grantHours = Math.floor(Number(gp.grantHours) || 0);
    const venueId = String(gp.venueId || '').trim();
    if (!phone || !lessonKey || grantHours <= 0 || !venueId) {
      return {
        returnCode: 'FAIL',
        returnMsg: '课时商品参数无效（需绑定场馆）',
        payment: undefined,
      };
    }
    try {
      await db.collection('db_course_purchase').add({
        data: {
          phone,
          venueId,
          outTradeNo,
          totalFee,
          status: 'pending',
          courseId: gp.courseId != null ? String(gp.courseId) : '',
          grantHours,
          lessonKey,
          goodDesc: gp.goodDesc != null ? String(gp.goodDesc).trim() : '',
          createdAt: Date.now(),
        },
      });
    } catch (err) {
      console.error('db_course_purchase 写入失败', err);
      return {
        returnCode: 'FAIL',
        returnMsg: '订单保存失败，请重试',
        payment: undefined,
      };
    }
  }

  return res;
};