const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

/** YYYY-M-D / YYYY-MM-DD 统一为 YYYY-MM-DD，便于与库内多种写法对齐 */
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

/** 云库里 venueId 可能是字符串或数字，精确 where 会查不到 */
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
 * 入参：venueId（与 db_venue / 占用记录一致，可为字符串或数字）、orderDate（YYYY-MM-DD）
 * 返回：keys 形如 ["1-0","2-3"]，含已支付订单与 db_coach_slot_hold（status=active）教练占用
 */
exports.main = async (event) => {
  const venueIdRaw = event.venueId != null ? String(event.venueId).trim() : ''
  const orderDateRaw = event.orderDate != null ? String(event.orderDate).trim() : ''
  const orderDateNorm = normalizeOrderDate(orderDateRaw)
  if (!venueIdRaw || !orderDateNorm) {
    return { keys: [], coachHoldMeta: {} }
  }

  const venueIds = venueIdInValues(venueIdRaw)
  const dateKeys = orderDateInValues(orderDateRaw, orderDateNorm)

  try {
    const res = await db
      .collection('db_booking')
      .where({
        venueId: _.in(venueIds),
        orderDate: _.in(dateKeys),
      })
      .get()

    const keySet = new Set()
    ;(res.data || []).forEach((doc) => {
      if (normalizeOrderDate(doc.orderDate) !== orderDateNorm) return
      if (doc.status !== 'paid') return
      ;(doc.bookedSlots || []).forEach((s) => {
        if (s == null || s.courtId == null || s.slotIndex == null) return
        const cid = Number(s.courtId)
        const idx = Number(s.slotIndex)
        if (!Number.isFinite(cid) || !Number.isFinite(idx)) return
        keySet.add(`${cid}-${idx}`)
      })
    })

    /** 教练占用：供订场页展示用途、合并连续格、后续报名 */
    const coachHoldMeta = {}

    const holdRes = await db
      .collection('db_coach_slot_hold')
      .where({
        venueId: _.in(venueIds),
        orderDate: _.in(dateKeys),
        status: 'active',
      })
      .get()
    ;(holdRes.data || []).forEach((doc) => {
      if (normalizeOrderDate(doc.orderDate) !== orderDateNorm) return
      const cid = Number(doc.courtId)
      const idx = Number(doc.slotIndex)
      if (!Number.isFinite(cid) || !Number.isFinite(idx)) return
      const k = `${cid}-${idx}`
      keySet.add(k)
      const holdId = doc._id != null ? String(doc._id) : ''
      const capacityLabel =
        doc.capacityLabel != null && String(doc.capacityLabel).trim() !== ''
          ? String(doc.capacityLabel).trim()
          : '教练占用'
      coachHoldMeta[k] = { holdId, capacityLabel }
    })

    return { keys: [...keySet], coachHoldMeta }
  } catch (err) {
    console.error('getBookedSlots failed', err)
    return { keys: [], coachHoldMeta: {}, errMsg: err.message || String(err) }
  }
}
