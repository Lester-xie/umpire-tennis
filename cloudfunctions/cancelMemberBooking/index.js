const crypto = require('crypto');
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const MEMBER_CANCEL_LEAD_MS = 6 * 60 * 60 * 1000;

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

function sessionKeyFromHoldIds(ids) {
  return [...(ids || [])]
    .map((id) => String(id || '').trim())
    .filter(Boolean)
    .sort()
    .join('|');
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

function defaultCapacityLimit(lessonType, pairMode, groupMode) {
  const lt = String(lessonType || '').trim();
  if (lt === 'group') {
    const gm = String(groupMode || '').trim().toLowerCase();
    if (gm.includes('1v2')) return 1;
    return 5;
  }
  if (lt === 'open_play') {
    const gm = String(groupMode || '').trim().toLowerCase();
    if (gm === 'group36') return 6;
    return 6;
  }
  return 1;
}

function clampCoachCapacityFromModes(lessonType, pairMode, groupMode, cap) {
  const n = Math.floor(Number(cap));
  if (!Number.isFinite(n) || n < 1) return cap;
  const pm = String(pairMode || '').trim().toLowerCase();
  const lt = String(lessonType || '').trim();
  const gm = String(groupMode || '').trim().toLowerCase();
  if (pm === '1v2' || (lt === 'group' && gm.includes('1v2'))) return Math.min(n, 1);
  return Math.min(99, n);
}

async function getCoachSessionLimitForHoldIds(holdIds) {
  if (!holdIds || !holdIds[0]) return 1;
  try {
    const d = await db.collection('db_coach_slot_hold').doc(holdIds[0]).get();
    const doc = d.data;
    if (!doc) return 1;
    let cap = Math.floor(Number(doc.capacityLimit));
    if (!Number.isFinite(cap) || cap < 1) {
      cap = defaultCapacityLimit(doc.lessonType, doc.pairMode, doc.groupMode);
    }
    return clampCoachCapacityFromModes(doc.lessonType, doc.pairMode, doc.groupMode, cap);
  } catch (e) {
    return 1;
  }
}

function generateRandomString(length = 32) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += chars[bytes[i] % chars.length];
  }
  return out;
}

/**
 * 预订首场开始时刻（北京时间）：slotIndex 最小格对应 8+index 点整
 */
function earliestSessionStartMs(orderDate, bookedSlots) {
  let minIdx = 999;
  const slots = Array.isArray(bookedSlots) ? bookedSlots : [];
  slots.forEach((s) => {
    const idx = Number(s.slotIndex);
    if (Number.isFinite(idx)) minIdx = Math.min(minIdx, idx);
  });
  if (minIdx === 999) return null;
  const p = String(orderDate || '').split('-');
  if (p.length !== 3) return null;
  const y = parseInt(p[0], 10);
  const mo = parseInt(p[1], 10);
  const d = parseInt(p[2], 10);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  const hour = 8 + minIdx;
  const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00+08:00`;
  return new Date(iso).getTime();
}

async function earliestSessionStartMsWithHolds(orderDate, bookedSlots, coachHoldIds) {
  let ms = earliestSessionStartMs(orderDate, bookedSlots);
  if (ms != null) return ms;
  const ids = Array.isArray(coachHoldIds) ? coachHoldIds : [];
  const idxs = [];
  for (let i = 0; i < ids.length; i += 1) {
    try {
      const doc = await db.collection('db_coach_slot_hold').doc(String(ids[i]).trim()).get();
      if (doc.data && doc.data.slotIndex != null) {
        idxs.push(Number(doc.data.slotIndex));
      }
    } catch (e) {
      console.warn('load hold for time', ids[i], e);
    }
  }
  if (idxs.length === 0) return null;
  const minIdx = Math.min(...idxs.filter((x) => Number.isFinite(x)));
  return earliestSessionStartMs(orderDate, [{ slotIndex: minIdx }]);
}

async function getRefundLeadMsFromCoachHolds(coachHoldIds) {
  const ids = Array.isArray(coachHoldIds) ? coachHoldIds : [];
  if (!ids[0]) return null;
  try {
    const d = await db.collection('db_coach_slot_hold').doc(String(ids[0]).trim()).get();
    const doc = d.data;
    if (!doc) return null;
    const lt = String(doc.lessonType || '').trim();
    if ((lt === 'group' || lt === 'open_play') && doc.refundHoursBeforeStart != null) {
      const h = Math.floor(Number(doc.refundHoursBeforeStart));
      if (Number.isFinite(h) && h >= 0) return h * 3600000;
    }
  } catch (e) {
    console.warn('getRefundLeadMsFromCoachHolds', e);
  }
  return null;
}

function memberWithinCancelDeadline(sessionStartMs, nowMs, leadMsOpt) {
  if (sessionStartMs == null) return true;
  if (nowMs >= sessionStartMs) return false;
  const lead =
    leadMsOpt != null && Number.isFinite(leadMsOpt) && leadMsOpt >= 0
      ? leadMsOpt
      : MEMBER_CANCEL_LEAD_MS;
  return sessionStartMs - nowMs >= lead;
}

async function refundWeChatPortion(booking, now) {
  const totalFee = Math.floor(Number(booking.totalFee) || 0);
  if (totalFee <= 0) return { ok: true, skipped: true };
  if (String(booking.refundStatus || '') === 'success') return { ok: true, skipped: true };
  const outTradeNo = String(booking.outTradeNo || '').trim();
  if (!outTradeNo) {
    return { ok: false, errMsg: '订单缺少商户单号，无法原路退款' };
  }
  const subMchId = process.env.subMchId;
  if (!subMchId) {
    return { ok: false, errMsg: '服务端未配置 subMchId，无法退款' };
  }
  const outRefundNo = `rf${Date.now()}${crypto.randomBytes(4).toString('hex')}`.slice(0, 32);
  try {
    const res = await cloud.cloudPay.refund({
      outTradeNo,
      outRefundNo,
      totalFee,
      refundFee: totalFee,
      subMchId,
      nonceStr: generateRandomString(32),
      refundDesc: '用户取消订场',
    });
    const refundOk = res.returnCode === 'SUCCESS' || res.resultCode === 'SUCCESS';
    if (!refundOk) {
      return {
        ok: false,
        errMsg: res.returnMsg || res.errMsg || res.errmsg || res.return_msg || '微信退款失败',
      };
    }
    await db
      .collection('db_booking')
      .doc(booking._id)
      .update({
        data: {
          refundStatus: 'success',
          outRefundNo,
          refundedAt: now,
          updatedAt: now,
        },
      });
    return { ok: true };
  } catch (err) {
    console.error('refundWeChatPortion', err);
    return { ok: false, errMsg: err.message || '退款异常' };
  }
}

async function returnCourseHoursForBooking(booking, now) {
  const subtype = String(booking.bookingSubtype || '').trim();
  const payMethod = String(booking.paymentMethod || '').trim();
  if (subtype !== 'coach_course') return { ok: true };

  let hours = Math.floor(Number(booking.coachCourseHoursDeduct) || 0);
  if (hours <= 0 && payMethod === 'course_hours') {
    const slots = Array.isArray(booking.bookedSlots) ? booking.bookedSlots : [];
    hours = slots.length;
  }
  if (hours <= 0) return { ok: true };

  const phone = String(booking.phone || '').trim();
  const lessonKey = String(booking.lessonKey || '').trim();
  const vId = String(booking.venueId != null ? booking.venueId : '').trim();
  if (!phone || !lessonKey || !vId) {
    console.warn('returnCourseHoursForBooking: 缺少字段', booking._id);
    return { ok: true };
  }

  const upd = await db
    .collection('db_member_course_hours')
    .where({ phone, lessonKey, venueId: vId })
    .update({
      data: {
        hours: _.inc(hours),
        updatedAt: now,
      },
    });
  if (!upd.stats || upd.stats.updated < 1) {
    const n = Number(vId);
    if (Number.isFinite(n)) {
      await db
        .collection('db_member_course_hours')
        .where({ phone, lessonKey, venueId: n })
        .update({
          data: {
            hours: _.inc(hours),
            updatedAt: now,
          },
        });
    }
  }
  return { ok: true };
}

async function reactivateCoachHoldsIfSessionHasRoom(booking, now) {
  const subtype = String(booking.bookingSubtype || '').trim();
  if (subtype !== 'coach_course') return;
  const coachHoldIds = Array.isArray(booking.coachHoldIds)
    ? booking.coachHoldIds.map((id) => String(id).trim()).filter(Boolean)
    : [];
  if (coachHoldIds.length === 0) return;

  const sk = sessionKeyFromHoldIds(coachHoldIds);
  const orderDateNorm = normalizeOrderDate(booking.orderDate);
  const venueIds = venueIdInValues(booking.venueId);
  const dateKeys = orderDateInValues(booking.orderDate, orderDateNorm);
  const limit = await getCoachSessionLimitForHoldIds(coachHoldIds);

  const all = await db
    .collection('db_booking')
    .where({
      venueId: _.in(venueIds),
      orderDate: _.in(dateKeys),
      bookingSubtype: 'coach_course',
      status: 'paid',
    })
    .get();

  let paidCount = 0;
  (all.data || []).forEach((doc) => {
    if (normalizeOrderDate(doc.orderDate) !== orderDateNorm) return;
    if (sessionKeyFromHoldIds(doc.coachHoldIds || []) !== sk) return;
    paidCount += 1;
  });

  if (paidCount >= limit) return;

  for (let i = 0; i < coachHoldIds.length; i += 1) {
    const hid = coachHoldIds[i];
    try {
      const ref = await db.collection('db_coach_slot_hold').doc(hid).get();
      const d = ref.data;
      if (!d) continue;
      const st = String(d.status || '');
      const rr = String(d.releaseReason || '');
      if (st === 'released' && (rr === 'member_paid' || rr === 'member_course_hours')) {
        await db.collection('db_coach_slot_hold').doc(hid).update({
          data: {
            status: 'active',
            releasedAt: _.remove(),
            releaseReason: _.remove(),
            reactivatedAt: now,
          },
        });
      }
    } catch (err) {
      console.error('reactivateCoachHoldsIfSessionHasRoom', hid, err);
    }
  }
}

async function emitBookingRealtimeSignal({ venueId, orderDate }) {
  const venueIdNorm = venueId != null ? String(venueId).trim() : '';
  const orderDateNorm = normalizeOrderDate(orderDate);
  if (!venueIdNorm || !orderDateNorm) return;
  const ts = Date.now();
  const coll = db.collection('db_booking_realtime_signal');
  const hit = await coll
    .where({ venueId: venueIdNorm, orderDate: orderDateNorm })
    .limit(1)
    .get();
  if (hit.data && hit.data[0] && hit.data[0]._id) {
    await coll.doc(hit.data[0]._id).update({
      data: {
        eventType: 'booking_cancelled',
        updatedAt: ts,
      },
    });
    return;
  }
  await coll.add({
    data: {
      venueId: venueIdNorm,
      orderDate: orderDateNorm,
      eventType: 'booking_cancelled',
      createdAt: ts,
      updatedAt: ts,
    },
  });
}

/**
 * 会员取消订场/教练课订单
 * event: { phone, bookingId }
 * 规则：距首场开始不足规定时间不可取消（普通 6h；团课/畅打以占用上的 refundHoursBeforeStart 为准）；已付原路退；pending 仅关单
 */
exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const phone = String((event && event.phone) || '').trim();
  const bookingId = String((event && event.bookingId) || '').trim();

  if (!openid || !phone || !bookingId) {
    return { ok: false, errMsg: '参数不完整' };
  }

  const userRes = await db.collection('db_user').where({ _openid: openid, phone }).limit(1).get();
  if (!userRes.data || userRes.data.length === 0) {
    return { ok: false, errMsg: '用户校验失败' };
  }

  let booking;
  try {
    const doc = await db.collection('db_booking').doc(bookingId).get();
    booking = doc.data;
    if (!booking) {
      return { ok: false, errMsg: '订单不存在' };
    }
  } catch (e) {
    return { ok: false, errMsg: '订单不存在' };
  }

  if (String(booking.phone || '').trim() !== phone) {
    return { ok: false, errMsg: '无权操作该订单' };
  }

  const st = String(booking.status || '');
  if (!['paid', 'pending', 'payment_confirming'].includes(st)) {
    return { ok: false, errMsg: '当前状态不可取消' };
  }

  const now = Date.now();
  const sessionStartMs = await earliestSessionStartMsWithHolds(
    booking.orderDate,
    booking.bookedSlots,
    booking.coachHoldIds
  );
  let leadMs = MEMBER_CANCEL_LEAD_MS;
  if (String(booking.bookingSubtype || '').trim() === 'coach_course') {
    const customLead = await getRefundLeadMsFromCoachHolds(booking.coachHoldIds);
    if (customLead != null) leadMs = customLead;
  }
  if (!memberWithinCancelDeadline(sessionStartMs, now, leadMs)) {
    if (sessionStartMs != null && now >= sessionStartMs) {
      return { ok: false, errMsg: '场次已开始或已结束，无法取消' };
    }
    const hoursLabel = Math.max(1, Math.round(leadMs / 3600000));
    return {
      ok: false,
      errMsg: `距开场不足 ${hoursLabel} 小时，无法取消；如需协调请联系场馆`,
    };
  }

  if (st === 'pending' || st === 'payment_confirming') {
    await db
      .collection('db_booking')
      .doc(bookingId)
      .update({
        data: {
          status: 'cancelled',
          memberCancelledAt: now,
          cancelReason: 'member_request',
          updatedAt: now,
        },
      });
    try {
      await emitBookingRealtimeSignal({
        venueId: booking.venueId,
        orderDate: booking.orderDate,
      });
    } catch (e) {
      console.error('emitBookingRealtimeSignal', e);
    }
    return { ok: true };
  }

  if (st === 'paid') {
    const rf = await refundWeChatPortion({ ...booking, _id: bookingId }, now);
    if (!rf.ok) {
      return rf;
    }
    const rh = await returnCourseHoursForBooking({ ...booking, _id: bookingId }, now);
    if (!rh.ok) {
      return rh;
    }

    await db
      .collection('db_booking')
      .doc(bookingId)
      .update({
        data: {
          status: 'cancelled',
          memberCancelledAt: now,
          cancelReason: 'member_request',
          updatedAt: now,
        },
      });

    await reactivateCoachHoldsIfSessionHasRoom({ ...booking, _id: bookingId }, now);

    try {
      await emitBookingRealtimeSignal({
        venueId: booking.venueId,
        orderDate: booking.orderDate,
      });
    } catch (e) {
      console.error('emitBookingRealtimeSignal', e);
    }

    return { ok: true };
  }

  return { ok: false, errMsg: '无法处理' };
};
