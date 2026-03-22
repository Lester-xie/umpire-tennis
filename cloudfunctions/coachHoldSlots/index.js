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

async function collectOccupiedKeys(venueIdRaw, orderDateRaw) {
  const orderDateNorm = normalizeOrderDate(orderDateRaw);
  const venueIds = venueIdInValues(venueIdRaw);
  const dateKeys = orderDateInValues(orderDateRaw, orderDateNorm);
  const keySet = new Set();

  if (venueIds.length === 0 || !orderDateNorm) return keySet;

  const bookingRes = await db
    .collection('db_booking')
    .where({
      venueId: _.in(venueIds),
      orderDate: _.in(dateKeys),
    })
    .get();
  (bookingRes.data || []).forEach((doc) => {
    if (normalizeOrderDate(doc.orderDate) !== orderDateNorm) return;
    if (doc.status !== 'paid') return;
    (doc.bookedSlots || []).forEach((s) => {
      if (s == null || s.courtId == null || s.slotIndex == null) return;
      const cid = Number(s.courtId);
      const idx = Number(s.slotIndex);
      if (!Number.isFinite(cid) || !Number.isFinite(idx)) return;
      keySet.add(`${cid}-${idx}`);
    });
  });

  const holdRes = await db
    .collection('db_coach_slot_hold')
    .where({
      venueId: _.in(venueIds),
      orderDate: _.in(dateKeys),
      status: 'active',
    })
    .get();
  (holdRes.data || []).forEach((doc) => {
    if (normalizeOrderDate(doc.orderDate) !== orderDateNorm) return;
    const cid = Number(doc.courtId);
    const idx = Number(doc.slotIndex);
    if (!Number.isFinite(cid) || !Number.isFinite(idx)) return;
    keySet.add(`${cid}-${idx}`);
  });

  return keySet;
}

function buildCapacityLabel(lessonType, pairMode, groupMode) {
  if (lessonType === 'group') {
    return groupMode === 'group35' ? '团课·3-5人班' : '团课·其他班型';
  }
  const pair = pairMode === '1v2' ? '1V2' : '1V1';
  if (lessonType === 'experience') return `体验课·${pair}`;
  if (lessonType === 'regular') return `正课·${pair}`;
  return '';
}

/**
 * 教练占用场地（写入 db_coach_slot_hold，与已支付订单一并参与 getBookedSlots 占用计算）
 * event: { venueId, orderDate, slots: [{courtId, slotIndex}], lessonType, pairMode?, groupMode? }
 * lessonType: experience | regular | group
 * pairMode（体验课/正课）: 1v1 | 1v2
 * groupMode（团课）: group35 | groupOther
 */
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  if (!openid) {
    return { ok: false, errMsg: '未登录' };
  }

  const venueId = event.venueId != null ? String(event.venueId).trim() : '';
  const orderDateRaw = event.orderDate != null ? String(event.orderDate).trim() : '';
  const orderDate = normalizeOrderDate(orderDateRaw) || orderDateRaw;
  const slots = Array.isArray(event.slots) ? event.slots : [];
  const lessonType = event.lessonType != null ? String(event.lessonType).trim() : '';
  const pairMode = event.pairMode != null ? String(event.pairMode).trim() : '';
  const groupMode = event.groupMode != null ? String(event.groupMode).trim() : '';
  const venueName =
    event.venueName != null && String(event.venueName).trim() !== ''
      ? String(event.venueName).trim()
      : '';

  if (!venueId || !orderDate || slots.length === 0) {
    return { ok: false, errMsg: '参数不完整' };
  }

  const userRes = await db.collection('db_user').where({ _openid: openid }).limit(1).get();
  const user = userRes.data && userRes.data[0];
  if (!user || !user.isCoach) {
    return { ok: false, errMsg: '仅教练账号可占用场地' };
  }

  if (!['experience', 'regular', 'group'].includes(lessonType)) {
    return { ok: false, errMsg: '请选择场地用途' };
  }
  if (lessonType === 'group') {
    if (!['group35', 'groupOther'].includes(groupMode)) {
      return { ok: false, errMsg: '请选择团课班型' };
    }
  } else if (!['1v1', '1v2'].includes(pairMode)) {
    return { ok: false, errMsg: '请选择 1V1 或 1V2' };
  }

  const normalized = slots
    .map((s) => ({
      courtId: Number(s.courtId),
      slotIndex: Number(s.slotIndex),
    }))
    .filter((s) => Number.isFinite(s.courtId) && Number.isFinite(s.slotIndex));

  if (normalized.length === 0) {
    return { ok: false, errMsg: '请选择有效时段' };
  }

  const capacityLabel = buildCapacityLabel(lessonType, pairMode, groupMode);

  let occupied;
  try {
    occupied = await collectOccupiedKeys(venueId, orderDate);
  } catch (e) {
    console.error('collectOccupiedKeys', e);
    return { ok: false, errMsg: '查询占用失败' };
  }

  for (let i = 0; i < normalized.length; i += 1) {
    const k = `${normalized[i].courtId}-${normalized[i].slotIndex}`;
    if (occupied.has(k)) {
      return { ok: false, errMsg: '部分时段已被占用，请刷新后重选' };
    }
  }

  const now = Date.now();
  const phone = user.phone != null ? String(user.phone).trim() : '';

  try {
    for (let i = 0; i < normalized.length; i += 1) {
      const s = normalized[i];
      await db.collection('db_coach_slot_hold').add({
        data: {
          _openid: openid,
          phone,
          venueId,
          venueName,
          orderDate,
          courtId: s.courtId,
          slotIndex: s.slotIndex,
          lessonType,
          pairMode: lessonType === 'group' ? '' : pairMode,
          groupMode: lessonType === 'group' ? groupMode : '',
          capacityLabel,
          status: 'active',
          createdAt: now,
        },
      });
    }
  } catch (err) {
    console.error('coachHoldSlots add failed', err);
    return { ok: false, errMsg: err.message || '写入失败，请重试' };
  }

  return { ok: true };
};
