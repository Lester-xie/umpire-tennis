/**
 * 定时任务：团课/畅打在「开课前 N 小时」检查已付人数；若低于最少人数则取消场次并退款。
 * 需在云开发控制台配置定时触发器（建议每 10–15 分钟）。
 */
const crypto = require('crypto');
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

function generateRandomString(length = 32) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += chars[bytes[i] % chars.length];
  }
  return out;
}

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

function sessionKeyFromHoldIds(ids) {
  return [...(ids || [])]
    .map((id) => String(id || '').trim())
    .filter(Boolean)
    .sort()
    .join('|');
}

function earliestSessionStartMs(orderDate, minSlotIndex) {
  const p = String(orderDate || '').split('-');
  if (p.length !== 3) return null;
  const y = parseInt(p[0], 10);
  const mo = parseInt(p[1], 10);
  const d = parseInt(p[2], 10);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  const hour = 8 + minSlotIndex;
  const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00+08:00`;
  return new Date(iso).getTime();
}

async function refundWeChatPortionForBooking(bookingDoc, bookingId, now) {
  const totalFee = Math.floor(Number(bookingDoc.totalFee) || 0);
  if (totalFee <= 0) return { ok: true, skipped: true };
  if (String(bookingDoc.refundStatus || '') === 'success') return { ok: true, skipped: true };
  const outTradeNo = String(bookingDoc.outTradeNo || '').trim();
  if (!outTradeNo) {
    return { ok: false, errMsg: '订单缺少商户单号，无法原路退款' };
  }
  const subMchId = process.env.subMchId;
  if (!subMchId) {
    return { ok: false, errMsg: '服务端未配置 subMchId，无法退款' };
  }
  const outRefundNo = `le${Date.now()}${crypto.randomBytes(4).toString('hex')}`.slice(0, 32);
  try {
    const res = await cloud.cloudPay.refund({
      outTradeNo,
      outRefundNo,
      totalFee,
      refundFee: totalFee,
      subMchId,
      nonceStr: generateRandomString(32),
      refundDesc: '未成班自动退款',
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
      .doc(bookingId)
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
    console.error('refundWeChatPortionForBooking', err);
    return { ok: false, errMsg: err.message || '退款异常' };
  }
}

async function emitBookingRealtimeSignal({ venueId, orderDate }) {
  const venueIdNorm = venueId != null ? String(venueId).trim() : '';
  const orderDateNorm = normalizeOrderDate(orderDate);
  if (!venueIdNorm || !orderDateNorm) return;
  const now = Date.now();
  const coll = db.collection('db_booking_realtime_signal');
  const hit = await coll
    .where({ venueId: venueIdNorm, orderDate: orderDateNorm })
    .limit(1)
    .get();
  if (hit.data && hit.data[0] && hit.data[0]._id) {
    await coll.doc(hit.data[0]._id).update({
      data: {
        eventType: 'coach_hold_changed',
        updatedAt: now,
      },
    });
    return;
  }
  await coll.add({
    data: {
      venueId: venueIdNorm,
      orderDate: orderDateNorm,
      eventType: 'coach_hold_changed',
      createdAt: now,
      updatedAt: now,
    },
  });
}

/**
 * 取消一场团课/畅打：同 cancelCoachHold 中与订单、占用相关的逻辑
 */
async function cancelSessionAndRefund({ holdDocs, now }) {
  const anchor = holdDocs[0];
  const venueIdRaw = anchor.venueId;
  const orderDateRaw = anchor.orderDate;
  const orderDateNorm = normalizeOrderDate(orderDateRaw);
  const venueIds = venueIdInValues(venueIdRaw);
  const dateKeys = orderDateInValues(orderDateRaw, orderDateNorm);

  const expandedIds = holdDocs.map((d) => String(d._id)).sort();

  const targetSk = sessionKeyFromHoldIds(expandedIds);

  const allBookings = await db
    .collection('db_booking')
    .where({
      venueId: _.in(venueIds),
      orderDate: _.in(dateKeys),
      bookingSubtype: 'coach_course',
      status: _.in(['paid', 'pending', 'payment_confirming']),
    })
    .get();

  const toCancel = (allBookings.data || []).filter((b) => {
    const st = String(b.status || '');
    if (!['paid', 'pending', 'payment_confirming'].includes(st)) return false;
    return sessionKeyFromHoldIds(b.coachHoldIds || []) === targetSk;
  });

  for (let i = 0; i < toCancel.length; i += 1) {
    const b = toCancel[i];
    const bid = b._id;
    const st = String(b.status || '');
    if (st === 'paid') {
      const rf = await refundWeChatPortionForBooking(b, bid, now);
      if (!rf.ok && !rf.skipped) {
        console.error('lowEnrollment refund fail', bid, rf.errMsg);
        return { ok: false, errMsg: rf.errMsg };
      }
      let deduct = Math.floor(Number(b.coachCourseHoursDeduct) || 0);
      if (deduct <= 0 && String(b.paymentMethod || '').trim() === 'course_hours') {
        deduct = Array.isArray(b.bookedSlots) ? b.bookedSlots.length : 0;
      }
      if (deduct > 0) {
        const phone = String(b.phone || '').trim();
        const lessonKey = String(b.lessonKey || '').trim();
        const vId = String(b.venueId != null ? b.venueId : '').trim();
        if (phone && lessonKey && vId) {
          const upd = await db
            .collection('db_member_course_hours')
            .where({ phone, lessonKey, venueId: vId })
            .update({
              data: {
                hours: _.inc(deduct),
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
                    hours: _.inc(deduct),
                    updatedAt: now,
                  },
                });
            }
          }
        }
      }
    }
    await db
      .collection('db_booking')
      .doc(bid)
      .update({
        data: {
          status: 'cancelled',
          coachCancelledAt: now,
          cancelReason: 'low_enrollment',
          updatedAt: now,
        },
      });
  }

  for (let i = 0; i < expandedIds.length; i += 1) {
    const hid = expandedIds[i];
    try {
      await db
        .collection('db_coach_slot_hold')
        .doc(hid)
        .update({
          data: {
            status: 'cancelled',
            cancelledAt: now,
            cancelReason: 'low_enrollment',
          },
        });
    } catch (err) {
      console.error('lowEnrollment hold update', hid, err);
    }
  }

  try {
    await emitBookingRealtimeSignal({
      venueId: venueIdRaw,
      orderDate: orderDateRaw,
    });
  } catch (e) {
    console.error('emitBookingRealtimeSignal lowEnrollment', e);
  }

  return { ok: true, cancelledBookings: toCancel.length };
}

exports.main = async (event, context) => {
  const now = Date.now();
  let processed = 0;
  let cancelledSessions = 0;

  try {
    const holdRes = await db
      .collection('db_coach_slot_hold')
      .where({
        status: 'active',
        lessonType: _.in(['group', 'open_play']),
      })
      .limit(500)
      .get();

    const rows = holdRes.data || [];
    const bySession = new Map();
    rows.forEach((doc) => {
      const sk = String(doc.sessionSlotKeys || '').trim();
      if (!sk) return;
      const vk = `${String(doc.venueId || '').trim()}|${normalizeOrderDate(doc.orderDate)}|${sk}`;
      if (!bySession.has(vk)) bySession.set(vk, []);
      bySession.get(vk).push(doc);
    });

    for (const [, groupDocs] of bySession) {
      const sample = groupDocs[0];
      const minP = Math.floor(Number(sample.minParticipants));
      const refundH = Math.floor(Number(sample.refundHoursBeforeStart));
      if (!Number.isFinite(minP) || minP < 1) continue;
      if (!Number.isFinite(refundH) || refundH < 0) continue;
      const checkHours = refundH > 0 ? refundH : 1;

      let minIdx = 999;
      groupDocs.forEach((d) => {
        const idx = Number(d.slotIndex);
        if (Number.isFinite(idx)) minIdx = Math.min(minIdx, idx);
      });
      if (minIdx === 999) continue;

      const sessionStartMs = earliestSessionStartMs(sample.orderDate, minIdx);
      if (sessionStartMs == null) continue;
      if (now >= sessionStartMs) continue;

      const deadlineMs = sessionStartMs - checkHours * 3600000;
      if (now < deadlineMs) continue;

      const venueIdRaw = sample.venueId;
      const orderDateNorm = normalizeOrderDate(sample.orderDate);
      const venueIds = venueIdInValues(venueIdRaw);
      const dateKeys = orderDateInValues(sample.orderDate, orderDateNorm);
      const holdIds = groupDocs.map((d) => String(d._id)).sort();
      const targetSk = sessionKeyFromHoldIds(holdIds);

      const bookRes = await db
        .collection('db_booking')
        .where({
          venueId: _.in(venueIds),
          orderDate: _.in(dateKeys),
          bookingSubtype: 'coach_course',
          status: 'paid',
        })
        .get();

      let paidCount = 0;
      const seenPhone = new Set();
      ;(bookRes.data || []).forEach((b) => {
        if (sessionKeyFromHoldIds(b.coachHoldIds || []) !== targetSk) return;
        const ph = String(b.phone || '').trim();
        if (ph && !seenPhone.has(ph)) {
          seenPhone.add(ph);
          paidCount += 1;
        }
      });

      if (paidCount >= minP) continue;

      const res = await cancelSessionAndRefund({ holdDocs: groupDocs, now });
      processed += 1;
      if (res.ok) cancelledSessions += 1;
      else console.error('cancelSessionAndRefund', res.errMsg);
    }

    return {
      ok: true,
      scannedSessions: bySession.size,
      processed,
      cancelledSessions,
    };
  } catch (err) {
    console.error('coachSessionLowEnrollmentSweep', err);
    return { ok: false, errMsg: err.message || 'sweep failed' };
  }
};
