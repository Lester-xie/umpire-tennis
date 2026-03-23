const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

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

function asSignalRow(raw) {
  if (!raw || typeof raw !== 'object') return null
  const venueId = raw.venueId != null ? String(raw.venueId).trim() : ''
  const orderDate = normalizeOrderDate(raw.orderDate)
  if (!venueId || !orderDate) return null
  return { venueId, orderDate }
}

function pickRowsFromRecord(record) {
  if (!record || typeof record !== 'object') return []
  const out = []
  const candidates = [
    record.doc,
    record.value,
    record.fullDocument,
    record.after,
    record.data,
    record.updateDescription && record.updateDescription.updatedFields,
  ]
  candidates.forEach((row) => {
    const parsed = asSignalRow(row)
    if (parsed) out.push(parsed)
  })
  return out
}

function collectRows(event) {
  const out = []
  const roots = [event, event && event.detail, event && event.payload, event && event.data]
  roots.forEach((root) => {
    out.push(...pickRowsFromRecord(root))
  })
  const docChanges = event && Array.isArray(event.docChanges) ? event.docChanges : []
  docChanges.forEach((c) => {
    out.push(...pickRowsFromRecord(c))
    out.push(...pickRowsFromRecord(c && c.doc))
    out.push(...pickRowsFromRecord(c && c.queueDoc))
    out.push(...pickRowsFromRecord(c && c.updateDescription && c.updateDescription.updatedFields))
  })
  if (Array.isArray(event && event.records)) {
    event.records.forEach((r) => {
      out.push(...pickRowsFromRecord(r))
    })
  }
  if (Array.isArray(event && event.data)) {
    event.data.forEach((r) => {
      out.push(...pickRowsFromRecord(r))
    })
  }
  out.push(...pickRowsFromRecord(event))
  return out
}

function normalizeCollectionName(raw) {
  const s = String(raw || '').trim()
  if (!s) return ''
  // 兼容 "env.db_booking" / "db_booking/..." 等格式
  const seg = s.split(/[./]/).filter(Boolean)
  return seg.length > 0 ? seg[seg.length - 1] : s
}

async function upsertSignalRow(row) {
  const now = Date.now()
  const coll = db.collection('db_booking_realtime_signal')
  const hit = await coll
    .where({
      venueId: row.venueId,
      orderDate: row.orderDate,
    })
    .limit(1)
    .get()
  if (hit.data && hit.data[0] && hit.data[0]._id) {
    return coll.doc(hit.data[0]._id).update({
      data: {
        eventType: 'booking_changed',
        updatedAt: now,
      },
    })
  }
  return coll.add({
    data: {
      venueId: row.venueId,
      orderDate: row.orderDate,
      eventType: 'booking_changed',
      updatedAt: now,
      createdAt: now,
    },
  })
}

async function purgeOldSignals() {
  const keepMs = 45 * 24 * 60 * 60 * 1000
  const threshold = Date.now() - keepMs
  const coll = db.collection('db_booking_realtime_signal')
  const old = await coll
    .where({
      updatedAt: db.command.lt(threshold),
    })
    .field({ _id: true })
    .limit(20)
    .get()
  const rows = old.data || []
  for (let i = 0; i < rows.length; i += 1) {
    const id = rows[i] && rows[i]._id ? String(rows[i]._id) : ''
    if (!id) continue
    try {
      await coll.doc(id).remove()
    } catch (e) {
      /* ignore cleanup failures */
    }
  }
}

exports.main = async (event) => {
  const collectionNameRaw = String(
    (event && (event.collectionName || event.collection || event.collection_name)) || ''
  ).trim()
  const collectionName = normalizeCollectionName(collectionNameRaw)
  if (
    collectionName &&
    collectionName !== 'db_booking' &&
    collectionName !== 'db_coach_slot_hold'
  ) {
    return {
      updated: 0,
      ignored: true,
      reason: `unsupported collection ${collectionName}`,
    }
  }

  const rows = collectRows(event)
  console.log('emitBookingRealtimeSignal event meta', {
    collectionNameRaw,
    collectionName,
    keys: Object.keys(event || {}),
    rowCount: rows.length,
  })
  const dedup = new Set()
  const finalRows = []
  rows.forEach((row) => {
    const key = `${row.venueId}__${row.orderDate}`
    if (dedup.has(key)) return
    dedup.add(key)
    finalRows.push(row)
  })

  await Promise.all(finalRows.map((row) => upsertSignalRow(row)))
  try {
    await purgeOldSignals()
  } catch (e) {
    /* ignore cleanup failures */
  }
  return {
    updated: finalRows.length,
    ignored: false,
  }
}
