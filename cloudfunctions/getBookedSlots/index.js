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


function defaultCapacityLimit(lessonType, pairMode, groupMode) {
  const lt = String(lessonType || '').trim()
  if (lt === 'venue_lock') return 1
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

function slotKeysFromBookedSlots(slots) {
  return [...(slots || [])]
    .map((s) => `${Number(s.courtId)}-${Number(s.slotIndex)}`)
    .filter((k) => /^\d+-\d+$/.test(k))
    .sort()
}

function sessionKeyFromBookedSlots(slots) {
  return slotKeysFromBookedSlots(slots).join('|')
}

/** 某格所属已付课节对应的 coachHoldIds（用于教练在 released 后仍可取消整场） */
function sessionHoldIdsForSlotKey(slotKey, sessionsPaid) {
  const sks = Object.keys(sessionsPaid || {})
  for (let i = 0; i < sks.length; i += 1) {
    const sk = sks[i]
    if (sk.split('|').includes(slotKey)) {
      const ids = sessionsPaid[sk].sessionHoldIds
      if (Array.isArray(ids) && ids.length > 0) return [...ids]
    }
  }
  return []
}

function defaultLimitFromLessonKey(lk) {
  const s = String(lk || '').trim()
  if (!s) return 5
  if (s.includes('1v2')) return 1
  if (s.startsWith('group:')) return 5
  if (s.startsWith('open_play:')) return 6
  return 1
}

/** 按手机号批量查 db_user.avatar（_.in 单次不宜过长，分块） */
async function avatarUrlByPhoneMap(phones) {
  const list = [...phones].map((p) => String(p || '').trim()).filter(Boolean)
  if (list.length === 0) return {}
  const out = {}
  const chunkSize = 20
  for (let i = 0; i < list.length; i += chunkSize) {
    const chunk = list.slice(i, i + chunkSize)
    try {
      const ur = await db
        .collection('db_user')
        .where({ phone: _.in(chunk) })
        .field({ phone: true, avatar: true })
        .get()
      ;(ur.data || []).forEach((row) => {
        const ph = String(row.phone || '').trim()
        if (!ph) return
        const av = row.avatar != null ? String(row.avatar).trim() : ''
        out[ph] = av
      })
    } catch (e) {
      console.error('getBookedSlots avatar batch', e)
    }
  }
  return out
}

/** 展示用：按占用人 _openid 从 db_user 取昵称，修正占用文档中错误的 coachName */
async function userNameByOpenidMap(openids) {
  const list = [...new Set((openids || []).map((x) => String(x || '').trim()).filter(Boolean))]
  if (list.length === 0) return {}
  const out = {}
  const chunkSize = 20
  for (let i = 0; i < list.length; i += chunkSize) {
    const chunk = list.slice(i, i + chunkSize)
    try {
      const ur = await db
        .collection('db_user')
        .where({ _openid: _.in(chunk) })
        .field({ _openid: true, name: true })
        .get()
      ;(ur.data || []).forEach((row) => {
        const oid = row._openid != null ? String(row._openid).trim() : ''
        if (!oid) return
        const nm = row.name != null && String(row.name).trim() !== '' ? String(row.name).trim() : ''
        if (nm) out[oid] = nm
      })
    } catch (e) {
      console.error('getBookedSlots userNameByOpenid', e)
    }
  }
  return out
}

function collectCoachPhones(rosterByHoldId, sessionsPaid) {
  const s = new Set()
  Object.values(rosterByHoldId || {}).forEach((arr) => {
    ;(arr || []).forEach((p) => {
      const ph = String(p.phone || '').trim()
      if (ph) s.add(ph)
    })
  })
  Object.values(sessionsPaid || {}).forEach((bucket) => {
    if (bucket && bucket.byPhone) {
      bucket.byPhone.forEach((_v, ph) => {
        const p = String(ph || '').trim()
        if (p) s.add(p)
      })
    }
  })
  return s
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
    const rosterByHoldId = {}
    const sessionsPaid = {}

    const wxContext = cloud.getWXContext()
    let viewerPhone = ''
    if (wxContext.OPENID) {
      try {
        const ur = await db.collection('db_user').where({ _openid: wxContext.OPENID }).limit(1).get()
        if (ur.data && ur.data[0] && ur.data[0].phone) {
          viewerPhone = String(ur.data[0].phone).trim()
        }
      } catch (e) {
        /* ignore */
      }
    }

    ;(res.data || []).forEach((doc) => {
      if (normalizeOrderDate(doc.orderDate) !== orderDateNorm) return
      if (doc.status !== 'paid') return
      const subtype = String(doc.bookingSubtype || '').trim()
      ;(doc.bookedSlots || []).forEach((s) => {
        if (s == null || s.courtId == null || s.slotIndex == null) return
        const cid = Number(s.courtId)
        const idx = Number(s.slotIndex)
        if (!Number.isFinite(cid) || !Number.isFinite(idx)) return
        keySet.add(`${cid}-${idx}`)
      })
      if (subtype === 'coach_course') {
        const name =
          doc.memberDisplayName != null && String(doc.memberDisplayName).trim() !== ''
            ? String(doc.memberDisplayName).trim()
            : `尾号${String(doc.phone || '').slice(-4)}`
        const phone = String(doc.phone || '').trim()
        if (Array.isArray(doc.coachHoldIds) && doc.coachHoldIds.length > 0) {
          const entry = { displayName: name, phone }
          doc.coachHoldIds.forEach((hid) => {
            const hk = String(hid || '').trim()
            if (!hk) return
            if (!rosterByHoldId[hk]) rosterByHoldId[hk] = []
            rosterByHoldId[hk].push(entry)
          })
        }
        const keysArr = slotKeysFromBookedSlots(doc.bookedSlots)
        if (keysArr.length > 0) {
          const sk = keysArr.join('|')
          if (!sessionsPaid[sk]) {
            sessionsPaid[sk] = {
              byPhone: new Map(),
              coachCapacityLabel: '',
              lessonKey: '',
              sessionHoldIds: [],
            }
          }
          const bucket = sessionsPaid[sk]
          if (phone) bucket.byPhone.set(phone, { displayName: name, phone })
          const capL = doc.coachCapacityLabel != null ? String(doc.coachCapacityLabel).trim() : ''
          if (capL) bucket.coachCapacityLabel = capL
          const lk = doc.lessonKey != null ? String(doc.lessonKey).trim() : ''
          if (lk) bucket.lessonKey = lk
          const hidArr = Array.isArray(doc.coachHoldIds)
            ? doc.coachHoldIds.map((x) => String(x || '').trim()).filter(Boolean)
            : []
          if (hidArr.length > 0 && (!bucket.sessionHoldIds || bucket.sessionHoldIds.length === 0)) {
            bucket.sessionHoldIds = hidArr
          }
        }
      }
    })

    const avatarMap = await avatarUrlByPhoneMap(collectCoachPhones(rosterByHoldId, sessionsPaid))

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
    const holdOpenids = new Set()
    ;(holdRes.data || []).forEach((doc) => {
      if (normalizeOrderDate(doc.orderDate) !== orderDateNorm) return
      const ltHold0 = doc.lessonType != null ? String(doc.lessonType).trim() : ''
      if (ltHold0 === 'venue_lock') return
      const o2 = doc._openid != null ? String(doc._openid).trim() : ''
      if (o2) holdOpenids.add(o2)
    })
    const nameByOpenid = await userNameByOpenidMap([...holdOpenids])
    ;(holdRes.data || []).forEach((doc) => {
      if (normalizeOrderDate(doc.orderDate) !== orderDateNorm) return
      const cid = Number(doc.courtId)
      const idx = Number(doc.slotIndex)
      if (!Number.isFinite(cid) || !Number.isFinite(idx)) return
      const k = `${cid}-${idx}`
      keySet.add(k)
      const holdId = doc._id != null ? String(doc._id) : ''
      const ltHold = doc.lessonType != null ? String(doc.lessonType).trim() : ''
      const openidForHold = doc._openid != null ? String(doc._openid).trim() : ''
      const storedCoachName = doc.coachName != null ? String(doc.coachName).trim() : ''
      const nameFromUser = openidForHold && nameByOpenid[openidForHold] ? nameByOpenid[openidForHold] : ''
      const coachNameResolved =
        ltHold === 'venue_lock'
          ? storedCoachName
          : (nameFromUser || storedCoachName)
      const capacityLabel =
        ltHold === 'venue_lock'
          ? '已占用'
          : doc.capacityLabel != null && String(doc.capacityLabel).trim() !== ''
            ? String(doc.capacityLabel).trim()
            : '教练占用'
      let cap = Math.floor(Number(doc.capacityLimit))
      if (!Number.isFinite(cap) || cap < 1) {
        cap = defaultCapacityLimit(doc.lessonType, doc.pairMode, doc.groupMode)
      }
      cap = clampCoachCapacityFromModes(doc.lessonType, doc.pairMode, doc.groupMode, cap)
      const rawList = rosterByHoldId[holdId] || []
      const seenPhones = new Set()
      const participants = []
      rawList.forEach((p) => {
        const ph = String(p.phone || '').trim()
        if (!ph || seenPhones.has(ph)) return
        seenPhones.add(ph)
        const av = avatarMap[ph] || ''
        participants.push({ displayName: p.displayName || '学员', avatarUrl: av })
      })
      const joinedCount = participants.length
      const sessionFull = joinedCount >= cap
      let viewerAlreadyJoined = false
      if (viewerPhone) {
        viewerAlreadyJoined = rawList.some((p) => String(p.phone || '').trim() === viewerPhone)
      }
      const fromPaid = sessionHoldIdsForSlotKey(k, sessionsPaid)
      const sessionHoldIds = fromPaid.length > 0 ? fromPaid : holdId ? [holdId] : []
      const minP =
        doc.minParticipants != null && String(doc.minParticipants).trim() !== ''
          ? Math.floor(Number(doc.minParticipants))
          : null
      const refundH =
        doc.refundHoursBeforeStart != null && String(doc.refundHoursBeforeStart).trim() !== ''
          ? Math.floor(Number(doc.refundHoursBeforeStart))
          : null
      const mpRaw =
        doc.memberPricePerSessionYuan != null && String(doc.memberPricePerSessionYuan).trim() !== ''
          ? doc.memberPricePerSessionYuan
          : doc.memberPricePerSlotYuan;
      const mpYuan =
        mpRaw != null && String(mpRaw).trim() !== '' ? Number(mpRaw) : null;
      const mpRounded =
        Number.isFinite(mpYuan) && mpYuan > 0 ? Math.round(mpYuan * 100) / 100 : null;
      coachHoldMeta[k] = {
        holdId,
        sessionHoldIds,
        capacityLabel,
        coachName: coachNameResolved,
        lessonType: ltHold === 'venue_lock' ? 'venue_lock' : doc.lessonType != null ? String(doc.lessonType).trim() : 'experience',
        pairMode: doc.pairMode != null ? String(doc.pairMode).trim() : '1v1',
        groupMode: doc.groupMode != null ? String(doc.groupMode).trim() : '',
        capacityLimit: cap,
        minParticipants: Number.isFinite(minP) && minP >= 1 ? minP : null,
        refundHoursBeforeStart: Number.isFinite(refundH) && refundH >= 0 ? refundH : null,
        joinedCount,
        sessionFull,
        participants,
        viewerAlreadyJoined,
        fromReleasedSession: false,
        /** 会员应付场次价（元）；与占用连续小时数无关 */
        memberPricePerSessionYuan: mpRounded,
        /** 兼容旧字段名，含义同 memberPricePerSessionYuan */
        memberPricePerSlotYuan: mpRounded,
      }
    })

    /** 已满员释放占用后：仍用已付教练课订单生成格子展示与名单（营销）；教练名从占用文档读（释放后 doc 仍在） */
    const paidSkList = Object.keys(sessionsPaid)
    for (let psi = 0; psi < paidSkList.length; psi += 1) {
      const sk = paidSkList[psi]
      const bucket = sessionsPaid[sk]
      const keysArr = sk.split('|').filter(Boolean)
      if (keysArr.length === 0) continue
      if (keysArr.some((k) => coachHoldMeta[k] && !coachHoldMeta[k].fromReleasedSession)) continue

      let coachNameResolved = ''
      const holdIdCandidates = Array.isArray(bucket.sessionHoldIds) ? bucket.sessionHoldIds : []
      for (let hci = 0; hci < holdIdCandidates.length; hci += 1) {
        const hid = String(holdIdCandidates[hci] || '').trim()
        if (!hid) continue
        try {
          const hdr = await db.collection('db_coach_slot_hold').doc(hid).get()
          if (!hdr.data) continue
          const d0 = hdr.data
          const lt0 = d0.lessonType != null ? String(d0.lessonType).trim() : ''
          const stored = d0.coachName != null ? String(d0.coachName).trim() : ''
          const oid = d0._openid != null ? String(d0._openid).trim() : ''
          if (lt0 === 'venue_lock') {
            if (stored) {
              coachNameResolved = stored
              break
            }
            continue
          }
          let fromProf = oid ? nameByOpenid[oid] : ''
          if (oid && !fromProf) {
            const m = await userNameByOpenidMap([oid])
            fromProf = m[oid] || ''
            if (m[oid]) nameByOpenid[oid] = m[oid]
          }
          const res = (fromProf || stored).trim()
          if (res) {
            coachNameResolved = res
            break
          }
        } catch (e) {
          /* ignore */
        }
      }

      const participants = [...bucket.byPhone.values()].map((p) => {
        const ph = String(p.phone || '').trim()
        const av = ph ? avatarMap[ph] || '' : ''
        return {
          displayName: p.displayName || '学员',
          avatarUrl: av,
        }
      })
      const joinedCount = participants.length
      const capGuess = Math.max(defaultLimitFromLessonKey(bucket.lessonKey), joinedCount, 1)
      const capacityLabel =
        bucket.coachCapacityLabel && String(bucket.coachCapacityLabel).trim() !== ''
          ? String(bucket.coachCapacityLabel).trim()
          : '教练课程'
      let viewerAlreadyJoined = false
      if (viewerPhone) {
        viewerAlreadyJoined = bucket.byPhone.has(viewerPhone)
      }
      const synthetic = {
        holdId: '',
        sessionHoldIds: Array.isArray(bucket.sessionHoldIds) ? [...bucket.sessionHoldIds] : [],
        capacityLabel,
        coachName: coachNameResolved,
        lessonType: 'experience',
        pairMode: '1v1',
        groupMode: '',
        capacityLimit: capGuess,
        joinedCount,
        sessionFull: joinedCount >= capGuess,
        participants,
        viewerAlreadyJoined,
        fromReleasedSession: true,
      }
      keysArr.forEach((k) => {
        if (!coachHoldMeta[k]) {
          coachHoldMeta[k] = { ...synthetic }
        }
      })
    }

    return { keys: [...keySet], coachHoldMeta }
  } catch (err) {
    console.error('getBookedSlots failed', err)
    return { keys: [], coachHoldMeta: {}, errMsg: err.message || String(err) }
  }
}
