const cloud = require('wx-server-sdk');
const { parseGroupOpenEnrollment } = require('./groupOpenEnrollment');

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

function sanitizeScaleDisplayName(raw) {
  const s = String(raw || '')
    .trim()
    .replace(/[\r\n]/g, '');
  if (s.length > 40) return s.slice(0, 40);
  return s;
}

function buildCapacityLabel(lessonType, pairMode, groupMode, scaleDisplayName) {
  const disp = sanitizeScaleDisplayName(scaleDisplayName);
  if (lessonType === 'open_play') {
    if (disp) return `畅打·${disp}`;
    const gm = String(groupMode || '').trim().toLowerCase();
    if (gm === 'group36') return '畅打·3-6人';
    return `畅打·${groupMode || ''}`.replace(/·$/, '') || '畅打';
  }
  if (lessonType === 'group') {
    if (disp) return `团课·${disp}`;
    return groupMode === 'group35' ? '团课·3-5人' : `团课·${groupMode}`;
  }
  const pair =
    pairMode === '1v2' ? '1V2' : pairMode === '1v1' ? '1V1' : String(pairMode || '').toUpperCase();
  if (lessonType === 'experience') {
    return disp ? `体验课·${disp}` : `体验课·${pair}`;
  }
  if (lessonType === 'regular') {
    return disp ? `正课·${disp}` : `正课·${pair}`;
  }
  return '';
}

function isValidPairMode(pm) {
  const s = String(pm || '')
    .trim()
    .toLowerCase();
  return /^\d+v\d+$/.test(s) && s.length <= 12;
}

function isValidGroupMode(gm) {
  const s = String(gm || '')
    .trim()
    .toLowerCase();
  return /^group[a-z0-9_]+$/.test(s) && s.length >= 5 && s.length <= 40;
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

function sanitizeMemberPricePerSlotYuan(raw) {
  if (raw == null || raw === '') {
    return { ok: false, errMsg: '请填写会员支付单价' };
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n > 999999) {
    return { ok: false, errMsg: '会员支付单价须为有效正数' };
  }
  return { ok: true, value: Math.round(n * 100) / 100 };
}

/**
 * 教练占用场地（写入 db_coach_slot_hold，与已支付订单一并参与 getBookedSlots 占用计算）
 * event: { venueId, orderDate, slots: [{courtId, slotIndex}], lessonType, pairMode?, groupMode? }
 * lessonType: experience | regular | group | open_play（畅打，需 isManager）
 * pairMode（体验课/正课）: 1v1 | 1v2
 * groupMode（团课）: 如 group35、group36 等
 * scaleDisplayName（可选）: 规模展示名，写入 capacityLabel（与 scaleList.name 一致时推荐传入）
 * capacityLimit（可选）: 课节最多可报名会员数
 * memberPricePerSlotYuan（必填）: 会员应付的「场次」总价（元），与占用 1 小时或连续多格无关；写入时同时写入 memberPricePerSessionYuan 同值
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
  let pairMode = event.pairMode != null ? String(event.pairMode).trim() : '';
  let groupMode = event.groupMode != null ? String(event.groupMode).trim() : '';
  const scaleDisplayName = sanitizeScaleDisplayName(event.scaleDisplayName);
  const venueName =
    event.venueName != null && String(event.venueName).trim() !== ''
      ? String(event.venueName).trim()
      : '';

  if (!venueId || !orderDate || slots.length === 0) {
    return { ok: false, errMsg: '参数不完整' };
  }

  const userRes = await db.collection('db_user').where({ _openid: openid }).limit(1).get();
  const user = userRes.data && userRes.data[0];
  if (!user) {
    return { ok: false, errMsg: '未登录' };
  }

  if (!['experience', 'regular', 'group', 'open_play'].includes(lessonType)) {
    return { ok: false, errMsg: '请选择场地用途' };
  }
  if (lessonType === 'open_play') {
    if (!user.isManager) {
      return { ok: false, errMsg: '无权限使用该用途' };
    }
  } else if (!user.isCoach) {
    return { ok: false, errMsg: '仅教练账号可占用场地' };
  }
  if (lessonType === 'group' || lessonType === 'open_play') {
    if (!isValidGroupMode(groupMode)) {
      return { ok: false, errMsg: lessonType === 'open_play' ? '请选择畅打规模' : '请选择团课规模' };
    }
    groupMode = groupMode.toLowerCase();
  } else if (!isValidPairMode(pairMode)) {
    return { ok: false, errMsg: '请选择有效规模' };
  } else {
    pairMode = pairMode.toLowerCase();
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

  const capacityLabel = buildCapacityLabel(lessonType, pairMode, groupMode, scaleDisplayName);

  const ge = parseGroupOpenEnrollment(event, lessonType);
  if (!ge.ok) {
    return { ok: false, errMsg: ge.errMsg || '参数无效' };
  }
  let capacityLimit = ge.capacityLimit;
  if (lessonType !== 'group' && lessonType !== 'open_play') {
    if (!Number.isFinite(capacityLimit) || capacityLimit < 1) {
      capacityLimit = defaultCapacityLimit(lessonType, pairMode, groupMode);
    }
  } else if (!Number.isFinite(capacityLimit) || capacityLimit < 1) {
    return { ok: false, errMsg: '人数参数无效' };
  }
  capacityLimit = clampCoachCapacityFromModes(lessonType, pairMode, groupMode, capacityLimit);

  const mpSan = sanitizeMemberPricePerSlotYuan(event.memberPricePerSlotYuan);
  if (!mpSan.ok) {
    return { ok: false, errMsg: mpSan.errMsg || '会员支付单价无效' };
  }
  const memberPricePerSlotYuan = mpSan.value;

  const sessionSlotKeys = normalized
    .map((s) => `${s.courtId}-${s.slotIndex}`)
    .sort()
    .join('|');

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
  const coachName =
    user.name != null && String(user.name).trim() !== '' ? String(user.name).trim() : '';

  try {
    for (let i = 0; i < normalized.length; i += 1) {
      const s = normalized[i];
      const holdData = {
        _openid: openid,
        phone,
        coachName,
        venueId,
        venueName,
        orderDate,
        courtId: s.courtId,
        slotIndex: s.slotIndex,
        lessonType,
        pairMode: lessonType === 'group' || lessonType === 'open_play' ? '' : pairMode,
        groupMode: lessonType === 'group' || lessonType === 'open_play' ? groupMode : '',
        capacityLabel,
        capacityLimit,
        sessionSlotKeys,
        status: 'active',
        createdAt: now,
      };
      if (ge.minParticipants != null) {
        holdData.minParticipants = ge.minParticipants;
      }
      if (ge.refundHoursBeforeStart != null) {
        holdData.refundHoursBeforeStart = ge.refundHoursBeforeStart;
      }
      holdData.memberPricePerSlotYuan = memberPricePerSlotYuan;
      holdData.memberPricePerSessionYuan = memberPricePerSlotYuan;
      await db.collection('db_coach_slot_hold').add({
        data: holdData,
      });
    }
  } catch (err) {
    console.error('coachHoldSlots add failed', err);
    return { ok: false, errMsg: err.message || '写入失败，请重试' };
  }

  try {
    await emitBookingRealtimeSignal({ venueId, orderDate });
  } catch (e) {
    console.error('emitBookingRealtimeSignal coachHoldSlots failed', e);
  }

  return { ok: true };
};
