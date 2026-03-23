// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV }) // 使用当前云环境

const db = cloud.database()
const _ = db.command

function normalizeOrderDateCb(raw) {
  const s = String(raw || '').trim()
  const parts = s.split('-')
  if (parts.length !== 3) return s
  const y = parseInt(parts[0], 10)
  const mo = parseInt(parts[1], 10)
  const d = parseInt(parts[2], 10)
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return s
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function sessionKeyFromHoldIdsCb(ids) {
  return [...(ids || [])]
    .map((id) => String(id || '').trim())
    .filter(Boolean)
    .sort()
    .join('|')
}

function defaultCapacityLimitCb(lessonType, pairMode, groupMode) {
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

function venueIdInValuesCb(venueIdRaw) {
  const s = String(venueIdRaw || '').trim()
  if (!s) return []
  const out = new Set([s])
  const n = Number(s)
  if (Number.isFinite(n)) out.add(n)
  return [...out]
}

function orderDateInValuesCb(orderDateRaw, normalized) {
  const raw = String(orderDateRaw || '').trim()
  const set = new Set()
  if (normalized) set.add(normalized)
  if (raw) set.add(raw)
  return [...set]
}

function slotKeysFromBookedSlotsCb(slots) {
  return [...(slots || [])]
    .map((s) => `${Number(s.courtId)}-${Number(s.slotIndex)}`)
    .filter((k) => /^\d+-\d+$/.test(k))
    .sort()
}

async function emitBookingRealtimeSignal({ venueId, orderDate }) {
  const venueIdNorm = venueId != null ? String(venueId).trim() : ''
  const orderDateNorm = normalizeOrderDateCb(orderDate)
  if (!venueIdNorm || !orderDateNorm) return
  const now = Date.now()
  const coll = db.collection('db_booking_realtime_signal')
  const hit = await coll
    .where({ venueId: venueIdNorm, orderDate: orderDateNorm })
    .limit(1)
    .get()
  if (hit.data && hit.data[0] && hit.data[0]._id) {
    await coll.doc(hit.data[0]._id).update({
      data: {
        eventType: 'booking_paid',
        updatedAt: now,
      },
    })
    return
  }
  await coll.add({
    data: {
      venueId: venueIdNorm,
      orderDate: orderDateNorm,
      eventType: 'booking_paid',
      createdAt: now,
      updatedAt: now,
    },
  })
}

async function getCoachSessionLimitForHoldIds(holdIds) {
  if (!holdIds || !holdIds[0]) return 1
  try {
    const d = await db.collection('db_coach_slot_hold').doc(holdIds[0]).get()
    const doc = d.data
    if (!doc) return 1
    let cap = Math.floor(Number(doc.capacityLimit))
    if (!Number.isFinite(cap) || cap < 1) {
      cap = defaultCapacityLimitCb(doc.lessonType, doc.pairMode, doc.groupMode)
    }
    return Math.min(99, cap)
  } catch (e) {
    return 1
  }
}

/**
 * 教练课：已付人数未满且同手机未重复才可标记本单为已付；返回 paidCountBefore 供满员后释放占用
 */
async function assertCoachSessionAllowsMarkPaid(booking) {
  if (String(booking.bookingSubtype || '').trim() !== 'coach_course') {
    return { ok: true, paidCountBefore: 0, limit: 999, shouldReleaseHolds: false }
  }
  const coachHoldIds = Array.isArray(booking.coachHoldIds)
    ? booking.coachHoldIds.map((id) => String(id).trim()).filter(Boolean)
    : []
  if (coachHoldIds.length === 0) {
    return { ok: true, paidCountBefore: 0, limit: 999, shouldReleaseHolds: false }
  }

  const selfId = booking._id
  const sk = sessionKeyFromHoldIdsCb(coachHoldIds)
  const phone = String(booking.phone || '').trim()
  const orderDateNorm = normalizeOrderDateCb(booking.orderDate)
  const venueIds = venueIdInValuesCb(booking.venueId)
  const dateKeys = orderDateInValuesCb(booking.orderDate, orderDateNorm)
  const limit = await getCoachSessionLimitForHoldIds(coachHoldIds)

  const all = await db
    .collection('db_booking')
    .where({
      venueId: _.in(venueIds),
      orderDate: _.in(dateKeys),
      bookingSubtype: 'coach_course',
    })
    .get()

  let paidCount = 0
  let dupOther = false
  ;(all.data || []).forEach((doc) => {
    if (normalizeOrderDateCb(doc.orderDate) !== orderDateNorm) return
    if (String(doc._id) === String(selfId)) return
    if (sessionKeyFromHoldIdsCb(doc.coachHoldIds || []) !== sk) return
    if (String(doc.status || '') !== 'paid') return
    paidCount += 1
    if (String(doc.phone || '').trim() === phone) dupOther = true
  })

  if (dupOther) return { ok: false, reason: 'dup' }
  if (paidCount >= limit) return { ok: false, reason: 'full' }
  const shouldReleaseHolds = paidCount + 1 >= limit
  return { ok: true, paidCountBefore: paidCount, limit, shouldReleaseHolds }
}

/**
 * 普通场地单：支付成功回调时做最终占用冲突校验
 * 若已有其他 paid 订单占用了本单任一时段，则本单不可再标记 paid
 */
async function assertCourtSlotsAllowMarkPaid(booking) {
  const subtype = String(booking.bookingSubtype || '').trim()
  if (subtype === 'coach_course') {
    return { ok: true }
  }
  const selfId = String(booking._id || '').trim()
  const orderDateNorm = normalizeOrderDateCb(booking.orderDate)
  const venueIds = venueIdInValuesCb(booking.venueId)
  const dateKeys = orderDateInValuesCb(booking.orderDate, orderDateNorm)
  const targetSlotKeys = slotKeysFromBookedSlotsCb(booking.bookedSlots)
  if (!orderDateNorm || venueIds.length === 0 || targetSlotKeys.length === 0) {
    return { ok: false, reason: 'invalid_booking_payload' }
  }

  const targetSet = new Set(targetSlotKeys)
  const hit = await db
    .collection('db_booking')
    .where({
      venueId: _.in(venueIds),
      orderDate: _.in(dateKeys),
      status: 'paid',
    })
    .get()

  let conflict = false
  ;(hit.data || []).forEach((doc) => {
    if (conflict) return
    if (normalizeOrderDateCb(doc.orderDate) !== orderDateNorm) return
    if (String(doc._id || '').trim() === selfId) return
    const occupied = slotKeysFromBookedSlotsCb(doc.bookedSlots)
    for (let i = 0; i < occupied.length; i += 1) {
      if (targetSet.has(occupied[i])) {
        conflict = true
        break
      }
    }
  })
  if (conflict) {
    return { ok: false, reason: 'slot_conflict' }
  }
  return { ok: true }
}

/**
 * 支付成功：将支付结果写入 db_pay_order 集合（按 outTradeNo 幂等更新，避免微信重复通知产生多条记录）
 */
async function savePaidOrderToDb({
  outTradeNo,
  totalFee,
  resultCode,
  transactionId,
  timeEnd,
}) {
  if (!outTradeNo) {
    console.error('savePaidOrderToDb: 缺少 outTradeNo，跳过写入');
    return;
  }
  const now = Date.now()
  const payload = {
    outTradeNo,
    totalFee,
    resultCode,
    transactionId,
    timeEnd,
    updatedAt: now,
  }

  const coll = db.collection('db_pay_order')
  const exist = await coll.where({ outTradeNo }).limit(1).get()

  if (exist.data && exist.data.length > 0) {
    const _id = exist.data[0]._id
    await coll.doc(_id).update({ data: payload })
    console.log('db_pay_order 已更新', _id, outTradeNo)
  } else {
    await coll.add({
      data: {
        ...payload,
        createdAt: now,
      },
    })
    console.log('db_pay_order 已新增', outTradeNo)
  }
}

/**
 * 教练课组合支付：支付成功前先扣减已写入订单的课时，失败则不标记已付（订单保持 pending）
 */
async function tryDeductCoachCourseHoursForBooking(booking, now) {
  const deduct = Math.floor(Number(booking.coachCourseHoursDeduct) || 0)
  if (deduct <= 0) return true
  if (String(booking.bookingSubtype || '').trim() !== 'coach_course') return true
  const phone = String(booking.phone || '').trim()
  const lessonKey = String(booking.lessonKey || '').trim()
  const venueId = String(booking.venueId || '').trim()
  if (!phone || !lessonKey || !venueId) {
    console.error('tryDeductCoachCourseHoursForBooking: 缺少字段', booking._id)
    return false
  }
  const deductRes = await db
    .collection('db_member_course_hours')
    .where({
      phone,
      lessonKey,
      venueId,
      hours: _.gte(deduct),
    })
    .update({
      data: {
        hours: _.inc(-deduct),
        updatedAt: now,
      },
    })
  const ok = deductRes.stats && deductRes.stats.updated >= 1
  if (!ok) {
    console.error('组合支付扣课时失败', phone, lessonKey, venueId, deduct)
  }
  return ok
}

/**
 * 支付成功：将 db_booking 中对应 outTradeNo 的订场单更新为已支付
 */
async function markBookingPaid({ outTradeNo, transactionId, timeEnd }) {
  if (!outTradeNo) return
  const coll = db.collection('db_booking')
  const exist = await coll.where({ outTradeNo }).limit(1).get()
  if (!exist.data || exist.data.length === 0) {
    console.log('markBookingPaid: 无匹配 db_booking', outTradeNo)
    return
  }
  const booking = exist.data[0]
  const _id = booking._id
  if (String(booking.status || '') === 'paid') {
    console.log('markBookingPaid: 已支付，跳过', outTradeNo)
    return
  }
  const now = Date.now()
  const coachHoldIds = Array.isArray(booking.coachHoldIds)
    ? booking.coachHoldIds.map((id) => String(id)).filter(Boolean)
    : []

  const lockRes = await coll
    .where({ outTradeNo, status: 'pending' })
    .update({ data: { status: 'payment_confirming', updatedAt: now } })
  if (!lockRes.stats || lockRes.stats.updated < 1) {
    console.log('markBookingPaid: 非 pending，跳过', outTradeNo)
    return
  }

  const sessionGate = await assertCoachSessionAllowsMarkPaid(booking)
  if (!sessionGate.ok) {
    console.error('markBookingPaid: 教练课名额校验失败，回退 pending', outTradeNo, sessionGate.reason)
    await coll.doc(_id).update({
      data: { status: 'pending', updatedAt: now },
    })
    return
  }

  const courtGate = await assertCourtSlotsAllowMarkPaid(booking)
  if (!courtGate.ok) {
    console.error('markBookingPaid: 场地冲突，标记冲突单', outTradeNo, courtGate.reason)
    await coll.doc(_id).update({
      data: {
        status: 'conflict',
        conflictReason: courtGate.reason || 'slot_conflict',
        conflictAt: now,
        updatedAt: now,
      },
    })
    return
  }

  const deductOk = await tryDeductCoachCourseHoursForBooking(booking, now)
  if (!deductOk) {
    console.error('markBookingPaid: 课时扣减失败，回退 pending', outTradeNo)
    await coll.doc(_id).update({
      data: { status: 'pending', updatedAt: now },
    })
    return
  }

  const deductH = Math.floor(Number(booking.coachCourseHoursDeduct) || 0)
  const payMethodFinal = deductH > 0 ? 'mixed' : 'wechat'

  await coll.doc(_id).update({
    data: {
      status: 'paid',
      transactionId: transactionId || '',
      timeEnd: timeEnd || '',
      paidAt: now,
      updatedAt: now,
      paymentMethod: payMethodFinal,
    },
  })
  console.log('db_booking 已标记已支付', _id, outTradeNo)

  if (coachHoldIds.length > 0 && sessionGate.shouldReleaseHolds) {
    await releaseCoachHolds(coachHoldIds, now)
  }
}

/**
 * 课时包支付成功：标记 db_course_purchase 已付，并累加 db_member_course_hours
 */
async function markCoursePurchasePaidAndGrantHours({ outTradeNo, transactionId, timeEnd }) {
  if (!outTradeNo) return
  const coll = db.collection('db_course_purchase')
  const exist = await coll.where({ outTradeNo }).limit(1).get()
  if (!exist.data || exist.data.length === 0) {
    return
  }
  const row = exist.data[0]
  const _id = row._id
  const now = Date.now()
  const phone = String(row.phone || '').trim()
  const lessonKey = String(row.lessonKey || '').trim()
  const venueId = String(row.venueId || '').trim()
  const grantHours = Math.floor(Number(row.grantHours) || 0)
  if (!phone || !lessonKey || !venueId || grantHours <= 0) {
    console.error('markCoursePurchasePaid: 无效课时数据', outTradeNo)
    return
  }

  const lockRes = await coll.where({ outTradeNo, status: 'pending' }).update({
    data: {
      status: 'paid',
      transactionId: transactionId || '',
      timeEnd: timeEnd || '',
      paidAt: now,
      updatedAt: now,
    },
  })
  if (!lockRes.stats || lockRes.stats.updated < 1) {
    return
  }
  console.log('db_course_purchase 已标记已支付', _id, outTradeNo)

  const balColl = db.collection('db_member_course_hours')
  const bal = await balColl.where({ phone, lessonKey, venueId }).limit(1).get()
  if (bal.data && bal.data.length > 0) {
    const bid = bal.data[0]._id
    await balColl.doc(bid).update({
      data: {
        hours: _.inc(grantHours),
        updatedAt: now,
      },
    })
  } else {
    await balColl.add({
      data: {
        phone,
        venueId,
        lessonKey,
        hours: grantHours,
        createdAt: now,
        updatedAt: now,
      },
    })
  }
  console.log('db_member_course_hours 已入账', phone, venueId, lessonKey, grantHours)
}

/** 会员微信支付成功后释放教练占用的连续时段 */
async function releaseCoachHolds(holdIds, now) {
  for (let i = 0; i < holdIds.length; i += 1) {
    const id = holdIds[i]
    try {
      await db
        .collection('db_coach_slot_hold')
        .doc(id)
        .update({
          data: {
            status: 'released',
            releasedAt: now,
            releaseReason: 'member_paid',
          },
        })
    } catch (err) {
      console.error('releaseCoachHolds failed', id, err)
    }
  }
}

// 云函数入口函数
exports.main = async (event, context) => {
  const { outTradeNo, totalFee, resultCode, transactionId, timeEnd } = event;

  if (resultCode === 'SUCCESS') {
    console.log(`支付成功，订单号: ${outTradeNo}, 金额: ${totalFee}`);
    try {
      await savePaidOrderToDb({
        outTradeNo,
        totalFee,
        resultCode,
        transactionId,
        timeEnd,
      });
      const bookingColl = db.collection('db_booking')
      const bookingHit = await bookingColl.where({ outTradeNo }).limit(1).get()
      if (bookingHit.data && bookingHit.data.length > 0) {
        await markBookingPaid({ outTradeNo, transactionId, timeEnd })
        try {
          const paidHit = await bookingColl.where({ outTradeNo }).limit(1).get()
          const paidBooking = paidHit.data && paidHit.data[0] ? paidHit.data[0] : null
          if (paidBooking && String(paidBooking.status || '') === 'paid') {
            await emitBookingRealtimeSignal({
              venueId: paidBooking.venueId,
              orderDate: paidBooking.orderDate,
            })
          }
        } catch (e) {
          console.error('emitBookingRealtimeSignal after payCallback main failed', e)
        }
      } else {
        await markCoursePurchasePaidAndGrantHours({ outTradeNo, transactionId, timeEnd })
      }
    } catch (err) {
      console.error('写入 db_pay_order 集合失败', err);
      // 返回非 0 可能导致微信侧重试；若需重试可保持抛出或返回错误码
      return {
        errcode: -1,
        errormessage: err.message || '写入订单失败',
      };
    }
  } else {
    console.log(`支付失败，订单号: ${outTradeNo}`);
  }

  return {
    errcode: 0,
    errormessage: '支付处理完成',
  };
};