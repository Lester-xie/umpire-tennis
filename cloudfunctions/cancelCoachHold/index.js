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

function sessionKeyFromHoldIds(ids) {
  return [...(ids || [])]
    .map((id) => String(id || '').trim())
    .filter(Boolean)
    .sort()
    .join('|');
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
 * 取消占用：支持 active / released（已有学员支付后占用会变为 released）
 * event: { holdId?: string, holdIds?: string[] }
 * 教练仅能取消本人占用；isManager 可取消任意人占用。
 * 将同场次已付/待付教练课订单置为 cancelled，并退回组合支付中已扣课时；占用记录统一置为 cancelled
 */
exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  if (!openid) {
    return { ok: false, errMsg: '未登录' };
  }

  let holdIds = [];
  if (Array.isArray(event && event.holdIds) && event.holdIds.length > 0) {
    holdIds = event.holdIds.map((id) => String(id || '').trim()).filter(Boolean);
  }
  if (holdIds.length === 0 && event && event.holdId != null) {
    const one = String(event.holdId).trim();
    if (one) holdIds = [one];
  }
  if (holdIds.length === 0) {
    return { ok: false, errMsg: '缺少占用记录' };
  }

  const userRes = await db.collection('db_user').where({ _openid: openid }).limit(1).get();
  const user = userRes.data && userRes.data[0];
  if (!user) {
    return { ok: false, errMsg: '未登录' };
  }
  if (!user.isCoach && !user.isManager) {
    return { ok: false, errMsg: '无权限操作' };
  }

  const isManagerUser = !!user.isManager;
  const now = Date.now();

  try {
    const verified = new Map();
    for (let i = 0; i < holdIds.length; i += 1) {
      const id = holdIds[i];
      const docRes = await db.collection('db_coach_slot_hold').doc(id).get();
      const doc = docRes.data;
      if (!doc) {
        return { ok: false, errMsg: '记录不存在' };
      }
      if (!isManagerUser && doc._openid !== openid) {
        return { ok: false, errMsg: '无权限操作' };
      }
      const st = String(doc.status || '');
      if (st === 'cancelled') {
        verified.set(id, doc);
        continue;
      }
      if (!['active', 'released'].includes(st)) {
        return { ok: false, errMsg: '该占用已失效，请刷新' };
      }
      verified.set(id, doc);
    }

    const anchor = [...verified.values()].find((d) => d && d.venueId != null && d.orderDate != null);
    if (!anchor) {
      return { ok: false, errMsg: '记录不存在' };
    }

    const venueIdRaw = anchor.venueId;
    const orderDateRaw = anchor.orderDate;
    const orderDateNorm = normalizeOrderDate(orderDateRaw);
    const venueIds = venueIdInValues(venueIdRaw);
    const dateKeys = orderDateInValues(orderDateRaw, orderDateNorm);

    const idSet = new Set(holdIds.map(String));
    const probe = await db
      .collection('db_booking')
      .where({
        venueId: _.in(venueIds),
        orderDate: _.in(dateKeys),
        bookingSubtype: 'coach_course',
        status: _.in(['paid', 'pending', 'payment_confirming']),
        coachHoldIds: holdIds[0],
      })
      .limit(30)
      .get();

    ;(probe.data || []).forEach((b) => {
      (Array.isArray(b.coachHoldIds) ? b.coachHoldIds : []).forEach((hid) => {
        const h = String(hid || '').trim();
        if (h) idSet.add(h);
      });
    });

    const expandedIds = [...idSet].sort();

    for (let i = 0; i < expandedIds.length; i += 1) {
      const hid = expandedIds[i];
      if (verified.has(hid)) continue;
      const docRes = await db.collection('db_coach_slot_hold').doc(hid).get();
      const doc = docRes.data;
      if (!doc || (!isManagerUser && doc._openid !== openid)) {
        return { ok: false, errMsg: '无权限操作' };
      }
      const st = String(doc.status || '');
      if (st === 'cancelled') {
        verified.set(hid, doc);
        continue;
      }
      if (!['active', 'released'].includes(st)) {
        return { ok: false, errMsg: '部分占用已失效，请刷新' };
      }
      verified.set(hid, doc);
    }

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
        const deduct = Math.floor(Number(b.coachCourseHoursDeduct) || 0);
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
            updatedAt: now,
          },
        });
    }

    for (let i = 0; i < expandedIds.length; i += 1) {
      const hid = expandedIds[i];
      const doc = verified.get(hid);
      const st = doc ? String(doc.status || '') : '';
      if (st === 'cancelled') continue;
      try {
        await db
          .collection('db_coach_slot_hold')
          .doc(hid)
          .update({
            data: {
              status: 'cancelled',
              cancelledAt: now,
              cancelReason: 'coach_cancel_session',
            },
          });
      } catch (err) {
        console.error('cancelCoachHold hold update', hid, err);
      }
    }

    try {
      await emitBookingRealtimeSignal({
        venueId: venueIdRaw,
        orderDate: orderDateRaw,
      });
    } catch (e) {
      console.error('emitBookingRealtimeSignal cancelCoachHold failed', e);
    }

    return { ok: true, cancelledBookings: toCancel.length };
  } catch (err) {
    console.error('cancelCoachHold failed', err);
    return { ok: false, errMsg: err.message || '取消失败' };
  }
};
