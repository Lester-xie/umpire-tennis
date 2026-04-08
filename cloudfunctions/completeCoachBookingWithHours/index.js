const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

function buildLessonKey(lessonType, pairMode, groupMode) {
  const lt = String(lessonType || '').trim()
  if (lt === 'group') {
    const gm = String(groupMode || 'group35').trim() || 'group35'
    return `group:${gm}`
  }
  if (lt === 'open_play') {
    const gm = String(groupMode || 'group36').trim() || 'group36'
    return `open_play:${gm}`
  }
  const pm = String(pairMode || '1v1').trim() || '1v1'
  return `${lt}:${pm}`
}

function venueIdLooseEqual(a, b) {
  const sa = a == null ? '' : String(a).trim()
  const sb = b == null ? '' : String(b).trim()
  if (sa === sb) return true
  const na = Number(sa)
  const nb = Number(sb)
  return Number.isFinite(na) && Number.isFinite(nb) && na === nb
}

function normalizeOrderDate(raw) {
  const s = String(raw || '').trim()
  const parts = s.split('-')
  if (parts.length !== 3) return s
  const y = parseInt(parts[0], 10)
  const mo = parseInt(parts[1], 10)
  const d = parseInt(parts[2], 10)
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return s
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function sessionKeyFromHoldIds(ids) {
  return [...(ids || [])]
    .map((id) => String(id || '').trim())
    .filter(Boolean)
    .sort()
    .join('|')
}

function defaultCapacityLimit(lessonType, pairMode, groupMode) {
  const lt = String(lessonType || '').trim()
  if (lt === 'group') {
    const gm = String(groupMode || '').trim().toLowerCase()
    if (gm.includes('1v2')) return 1
    return 5
  }
  if (lt === 'open_play') {
    const gm = String(groupMode || '').trim().toLowerCase()
    if (gm === 'group36') return 6
    return 6
  }
  return 1
}

function clampCoachCapacityFromModes(lessonType, pairMode, groupMode, cap) {
  const n = Math.floor(Number(cap))
  if (!Number.isFinite(n) || n < 1) return cap
  const pm = String(pairMode || '').trim().toLowerCase()
  const lt = String(lessonType || '').trim()
  const gm = String(groupMode || '').trim().toLowerCase()
  if (pm === '1v2' || (lt === 'group' && gm.includes('1v2'))) return Math.min(n, 1)
  return Math.min(99, n)
}

function venueIdInValues(venueIdRaw) {
  const s = String(venueIdRaw || '').trim()
  if (!s) return []
  const out = new Set([s])
  const n = Number(s)
  if (Number.isFinite(n)) out.add(n)
  return [...out]
}

function orderDateInValues(orderDateRaw, normalized) {
  const raw = String(orderDateRaw || '').trim()
  const set = new Set()
  if (normalized) set.add(normalized)
  if (raw) set.add(raw)
  return [...set]
}

/**
 * 使用已购课时预订教练已占时段：扣课时、写已支付订场、释放教练占用
 * event: { phone, holdIds: string[], snapshot: { orderNumber, campusName, venueId, orderDate, formattedDate, orderItems, bookedSlots, totalPrice, lessonKey, coachCapacityLabel } }
 */
exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const phone = String((event && event.phone) || '').trim()
  const holdIds = Array.isArray(event && event.holdIds)
    ? event.holdIds.map((id) => String(id).trim()).filter(Boolean)
    : []
  const snapshot = event && event.snapshot && typeof event.snapshot === 'object' ? event.snapshot : null

  if (!openid || !phone || !snapshot || holdIds.length === 0) {
    return { ok: false, errMsg: '参数不完整' }
  }

  const userRes = await db.collection('db_user').where({ _openid: openid, phone }).limit(1).get()
  if (!userRes.data || userRes.data.length === 0) {
    return { ok: false, errMsg: '用户校验失败' }
  }

  const bookedSlots = Array.isArray(snapshot.bookedSlots) ? snapshot.bookedSlots : []
  if (bookedSlots.length !== holdIds.length) {
    return { ok: false, errMsg: '时段与占用记录不一致' }
  }

  const lessonKeyClient = String(snapshot.lessonKey || '').trim()
  if (!lessonKeyClient) {
    return { ok: false, errMsg: '缺少课程类型' }
  }

  const requiredHours = holdIds.length
  const now = Date.now()

  let holds = []
  try {
    for (let i = 0; i < holdIds.length; i += 1) {
      const doc = await db.collection('db_coach_slot_hold').doc(holdIds[i]).get()
      if (!doc.data) {
        return { ok: false, errMsg: '占用记录不存在' }
      }
      holds.push(doc.data)
    }
  } catch (err) {
    console.error('load holds', err)
    return { ok: false, errMsg: '读取占用失败' }
  }

  for (let i = 0; i < holds.length; i += 1) {
    if (holds[i].status !== 'active') {
      return { ok: false, errMsg: '该时段已不可订，请刷新' }
    }
  }

  const v0 = holds[0]
  const venueIdHold = v0.venueId
  const venueIdNorm = String(venueIdHold != null ? venueIdHold : '').trim()
  if (!venueIdNorm) {
    return { ok: false, errMsg: '占用记录缺少场馆信息' }
  }
  const snapVid = String(snapshot.venueId != null ? snapshot.venueId : '').trim()
  if (!snapVid || !venueIdLooseEqual(snapVid, venueIdHold)) {
    return { ok: false, errMsg: '订单场馆与占用不符' }
  }
  const orderDateNorm = normalizeOrderDate(v0.orderDate)
  const lk0 = buildLessonKey(v0.lessonType, v0.pairMode, v0.groupMode)
  if (lk0 !== lessonKeyClient) {
    return { ok: false, errMsg: '课程类型与占用不符' }
  }

  for (let i = 1; i < holds.length; i += 1) {
    const h = holds[i]
    if (!venueIdLooseEqual(h.venueId, venueIdHold) || normalizeOrderDate(h.orderDate) !== orderDateNorm) {
      return { ok: false, errMsg: '占用数据异常' }
    }
    if (buildLessonKey(h.lessonType, h.pairMode, h.groupMode) !== lessonKeyClient) {
      return { ok: false, errMsg: '课程类型不一致' }
    }
  }

  const holdKeys = new Set(holds.map((h) => `${Number(h.courtId)}-${Number(h.slotIndex)}`))
  for (let i = 0; i < bookedSlots.length; i += 1) {
    const s = bookedSlots[i]
    const k = `${Number(s.courtId)}-${Number(s.slotIndex)}`
    if (!holdKeys.has(k)) {
      return { ok: false, errMsg: '所选时段与占用不符' }
    }
  }

  const skTarget = sessionKeyFromHoldIds(holdIds)
  const venueIds = venueIdInValues(venueIdHold)
  const dateKeys = orderDateInValues(v0.orderDate, orderDateNorm)
  let capLimit = Math.floor(Number(v0.capacityLimit))
  if (!Number.isFinite(capLimit) || capLimit < 1) {
    capLimit = defaultCapacityLimit(v0.lessonType, v0.pairMode, v0.groupMode)
  }
  capLimit = clampCoachCapacityFromModes(v0.lessonType, v0.pairMode, v0.groupMode, capLimit)

  const preBook = await db
    .collection('db_booking')
    .where({
      venueId: _.in(venueIds),
      orderDate: _.in(dateKeys),
      bookingSubtype: 'coach_course',
    })
    .get()

  let takenPre = 0
  let dupPre = false
  ;(preBook.data || []).forEach((doc) => {
    if (normalizeOrderDate(doc.orderDate) !== orderDateNorm) return
    const st = String(doc.status || '')
    if (!['paid', 'pending', 'payment_confirming'].includes(st)) return
    if (sessionKeyFromHoldIds(doc.coachHoldIds || []) !== skTarget) return
    takenPre += 1
    if (String(doc.phone || '').trim() === phone) dupPre = true
  })
  if (dupPre) {
    return { ok: false, errMsg: '您已在该课节报名或存在待支付订单' }
  }
  if (takenPre >= capLimit) {
    return { ok: false, errMsg: '该课节名额已满' }
  }

  try {
    const balRes = await db
      .collection('db_member_course_hours')
      .where({ phone, lessonKey: lessonKeyClient, venueId: venueIdNorm })
      .limit(1)
      .get()

    if (!balRes.data || balRes.data.length === 0) {
      return { ok: false, errMsg: '该场馆暂无此课程的可用课时' }
    }

    const balDoc = balRes.data[0]
    const curH = Number(balDoc.hours) || 0
    if (curH < requiredHours) {
      return { ok: false, errMsg: '课时不足' }
    }

    const deductRes = await db
      .collection('db_member_course_hours')
      .where({
        phone,
        lessonKey: lessonKeyClient,
        venueId: venueIdNorm,
        hours: _.gte(requiredHours),
      })
      .update({
        data: {
          hours: _.inc(-requiredHours),
          updatedAt: now,
        },
      })

    if (!deductRes.stats || deductRes.stats.updated < 1) {
      return { ok: false, errMsg: '扣减课时失败，请重试' }
    }

    await db.collection('db_booking').add({
      data: {
        phone,
        outTradeNo: '',
        totalFee: 0,
        status: 'paid',
        paymentMethod: 'course_hours',
        lessonKey: lessonKeyClient,
        coachCapacityLabel: String(snapshot.coachCapacityLabel || '').trim(),
        orderNumber: String(snapshot.orderNumber || '').trim(),
        campusName: String(snapshot.campusName || '').trim(),
        venueId: venueIdNorm,
        orderDate: String(snapshot.orderDate || '').trim(),
        formattedDate: String(snapshot.formattedDate || '').trim(),
        orderItems: Array.isArray(snapshot.orderItems) ? snapshot.orderItems : [],
        bookedSlots,
        totalPrice: Number(snapshot.totalPrice) || 0,
        coachHoldIds: holdIds,
        bookingSubtype: 'coach_course',
        memberDisplayName:
          snapshot.memberDisplayName != null
            ? String(snapshot.memberDisplayName).trim().slice(0, 40)
            : '',
        paidAt: now,
        createdAt: now,
        updatedAt: now,
      },
    })

    const postBook = await db
      .collection('db_booking')
      .where({
        venueId: _.in(venueIds),
        orderDate: _.in(dateKeys),
        bookingSubtype: 'coach_course',
        status: 'paid',
      })
      .get()
    let paidSession = 0
    ;(postBook.data || []).forEach((doc) => {
      if (normalizeOrderDate(doc.orderDate) !== orderDateNorm) return
      if (sessionKeyFromHoldIds(doc.coachHoldIds || []) !== skTarget) return
      paidSession += 1
    })

    if (paidSession >= capLimit) {
      for (let i = 0; i < holdIds.length; i += 1) {
        try {
          await db
            .collection('db_coach_slot_hold')
            .doc(holdIds[i])
            .update({
              data: {
                status: 'released',
                releasedAt: now,
                releaseReason: 'member_course_hours',
              },
            })
        } catch (err) {
          console.error('release hold', holdIds[i], err)
        }
      }
    }

    return { ok: true }
  } catch (err) {
    console.error('completeCoachBookingWithHours', err)
    return { ok: false, errMsg: err.message || '处理失败' }
  }
}
