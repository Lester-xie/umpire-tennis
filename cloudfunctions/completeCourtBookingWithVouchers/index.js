const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

function normalizeOrderDate(raw) {
  const s = String(raw || '').trim();
  const parts = s.split('-');
  if (parts.length !== 3) return s;
  const y = parseInt(parts[0], 10);
  const mo = parseInt(parts[1], 10);
  const d = parseInt(parts[2], 10);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return s;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function venueIdInValues(venueIdRaw) {
  const s = String(venueIdRaw || '').trim();
  if (!s) return [];
  const out = new Set([s]);
  const n = Number(s);
  if (Number.isFinite(n)) out.add(n);
  return [...out];
}

function orderDateInValues(orderDateRaw, normalized) {
  const raw = String(orderDateRaw || '').trim();
  const set = new Set();
  if (normalized) set.add(normalized);
  if (raw) set.add(raw);
  return [...set];
}

function slotKeysFromBookedSlots(slots) {
  return [...(slots || [])]
    .map((s) => `${Number(s.courtId)}-${Number(s.slotIndex)}`)
    .filter((k) => /^\d+-\d+$/.test(k));
}

function roundYuan(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

async function assertCourtSlotsCanCreate(venueId, orderDate, bookedSlots) {
  const orderDateNorm = normalizeOrderDate(orderDate);
  const venueIds = venueIdInValues(venueId);
  const dateKeys = orderDateInValues(orderDate, orderDateNorm);
  const targetKeys = slotKeysFromBookedSlots(bookedSlots);
  if (!venueIds.length || !orderDateNorm || targetKeys.length === 0) {
    return { ok: false, errMsg: '场馆/日期/时段无效' };
  }
  const targetSet = new Set(targetKeys);
  const hit = await db
    .collection('db_booking')
    .where({
      venueId: _.in(venueIds),
      orderDate: _.in(dateKeys),
      status: 'paid',
    })
    .field({ bookedSlots: true, orderDate: true })
    .get();
  let conflict = false;
  (hit.data || []).forEach((doc) => {
    if (conflict) return;
    if (normalizeOrderDate(doc.orderDate) !== orderDateNorm) return;
    const occupied = slotKeysFromBookedSlots(doc.bookedSlots);
    for (let i = 0; i < occupied.length; i += 1) {
      if (targetSet.has(occupied[i])) {
        conflict = true;
        break;
      }
    }
  });
  if (conflict) return { ok: false, errMsg: '所选时段已被预订，请返回重选' };
  return { ok: true };
}

function generateOutTradeNo() {
  const now = Date.now();
  const rand = Math.floor(Math.random() * 1e6)
    .toString()
    .padStart(6, '0');
  return `${now}${rand}`.slice(0, 32);
}

async function runBookingVoucherConsume({ phone, outTradeNo, vouchers, memberOpenid }) {
  try {
    const res = await cloud.callFunction({
      name: 'verifyMeituanReceipt',
      data: {
        action: 'consumeForBookingBatch',
        phone,
        outTradeNo,
        vouchers,
        fromPayCallback: true,
        fromSiblingFunction: true,
        memberOpenid: memberOpenid || '',
      },
      config: { timeout: 60000 },
    });
    return res && res.result ? res.result : { ok: false, errMsg: '团购券核销无响应' };
  } catch (e) {
    console.error('runBookingVoucherConsume failed', outTradeNo, e);
    return { ok: false, errMsg: e.message || '团购券核销调用失败' };
  }
}

async function updateVoucherConsumeStatus(outTradeNo, consumeRes) {
  const tradeNo = String(outTradeNo || '').trim();
  if (!tradeNo) return;
  const hit = await db.collection('db_booking').where({ outTradeNo: tradeNo }).limit(1).get();
  const doc = hit.data && hit.data[0];
  if (!doc || !doc._id) return;
  const ok = !!(consumeRes && consumeRes.ok);
  await db
    .collection('db_booking')
    .doc(doc._id)
    .update({
      data: {
        voucherConsumeStatus: ok ? 'done' : 'failed',
        voucherConsumeErrMsg: ok ? '' : String((consumeRes && consumeRes.errMsg) || '核销失败'),
        updatedAt: Date.now(),
      },
    });
}

function scheduleBookingRealtimeSignal(snapshot) {
  cloud
    .callFunction({
      name: 'emitBookingRealtimeSignal',
      data: {
        venueId: snapshot.venueId,
        orderDate: snapshot.orderDate,
      },
    })
    .catch((e) => {
      console.error('emitBookingRealtimeSignal', e);
    });
}

exports.main = async (event, context) => {
  if (context && typeof context.callbackWaitsForEmptyEventLoop !== 'undefined') {
    context.callbackWaitsForEmptyEventLoop = false;
  }

  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const phone = String((event && event.phone) || '').trim();
  const snapshot = event && event.snapshot && typeof event.snapshot === 'object' ? event.snapshot : null;
  const vouchers = Array.isArray(event && event.vouchers) ? event.vouchers : [];

  if (!openid || !phone || !snapshot) {
    return { ok: false, errMsg: '参数不完整' };
  }
  if (!vouchers.length) {
    return { ok: false, errMsg: '请添加团购券' };
  }

  const bookedSlots = Array.isArray(snapshot.bookedSlots) ? snapshot.bookedSlots : [];
  const slotPrices = Array.isArray(snapshot.slotPrices) ? snapshot.slotPrices : [];
  if (bookedSlots.length !== slotPrices.length) {
    return { ok: false, errMsg: '订单时段数据异常' };
  }
  if (vouchers.length > bookedSlots.length) {
    return { ok: false, errMsg: '团购券数量不能超过预订小时数' };
  }

  const totalPrice = roundYuan(snapshot.totalPrice);
  let voucherSum = 0;
  const usedSlotKeys = new Set();
  for (let i = 0; i < vouchers.length; i += 1) {
    const v = vouchers[i];
    const slotKey = String(v.slotKey || '');
    const priceYuan = roundYuan(v.priceYuan);
    if (!slotKey || priceYuan <= 0) {
      return { ok: false, errMsg: '团购券数据无效' };
    }
    if (usedSlotKeys.has(slotKey)) {
      return { ok: false, errMsg: '团购券时段重复' };
    }
    const slot = slotPrices.find((s) => String(s.slotKey) === slotKey);
    if (!slot || Math.abs(roundYuan(slot.priceYuan) - priceYuan) >= 0.011) {
      return { ok: false, errMsg: '团购券与订场时段不匹配' };
    }
    usedSlotKeys.add(slotKey);
    voucherSum += priceYuan;
  }
  voucherSum = roundYuan(voucherSum);
  const cashDue = roundYuan(totalPrice - voucherSum);
  if (cashDue > 0.009) {
    return { ok: false, errMsg: '尚有未抵扣金额，请使用混合支付' };
  }

  const [userRes, gate] = await Promise.all([
    db.collection('db_user').where({ _openid: openid, phone }).limit(1).get(),
    assertCourtSlotsCanCreate(snapshot.venueId, snapshot.orderDate, bookedSlots),
  ]);
  if (!userRes.data || !userRes.data.length) {
    return { ok: false, errMsg: '用户校验失败' };
  }
  if (!gate.ok) return gate;

  const outTradeNo = generateOutTradeNo();
  const now = Date.now();

  try {
    await db.collection('db_booking').add({
      data: {
        phone,
        memberOpenid: openid,
        outTradeNo,
        totalFee: 0,
        status: 'paid',
        orderNumber: snapshot.orderNumber || '',
        campusName: snapshot.campusName || '',
        venueId: snapshot.venueId || '',
        orderDate: snapshot.orderDate || '',
        formattedDate: snapshot.formattedDate || '',
        orderItems: snapshot.orderItems || [],
        bookedSlots,
        totalPrice,
        voucherDeductionYuan: voucherSum,
        cashDueYuan: 0,
        bookingVouchers: vouchers,
        bookingSubtype: '',
        paymentMethod: 'voucher',
        voucherConsumeStatus: 'pending',
        paidAt: now,
        createdAt: now,
        updatedAt: now,
      },
    });
  } catch (e) {
    console.error('completeCourtBookingWithVouchers add booking', outTradeNo, e);
    return { ok: false, errMsg: '订场失败，请重试' };
  }

  const consumeRes = await runBookingVoucherConsume({
    phone,
    outTradeNo,
    vouchers,
    memberOpenid: openid,
  });
  await updateVoucherConsumeStatus(outTradeNo, consumeRes);
  scheduleBookingRealtimeSignal(snapshot);

  if (!consumeRes.ok) {
    return {
      ok: false,
      errMsg: consumeRes.errMsg || '订场已创建，团购券核销失败，请联系场馆',
      data: { outTradeNo, voucherConsumeFailed: true },
    };
  }

  return { ok: true, data: { outTradeNo, voucherConsumePending: false } };
};
