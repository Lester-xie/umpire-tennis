const cloud = require('wx-server-sdk');
const { parseGroupOpenEnrollment } = require('./groupOpenEnrollment');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

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

function sanitizeMemberPricePerSlotYuanForUpdate(raw) {
  if (raw === undefined) return { skip: true };
  if (raw === null || raw === '') {
    return { skip: false, errMsg: '请填写会员支付单价' };
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n > 999999) {
    return { skip: false, errMsg: '会员支付单价须为有效正数' };
  }
  return { skip: false, value: Math.round(n * 100) / 100 };
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
 * 批量更新本人多条教练占用：课程类型 / 规模（与 coachHoldSlots 字段一致）
 * event: { holdIds: string[], lessonType, pairMode?, groupMode?, memberPricePerSlotYuan?: number|null }
 */
exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  if (!openid) {
    return { ok: false, errMsg: '未登录' };
  }

  const holdIds = Array.isArray(event.holdIds) ? event.holdIds : [];
  const lessonType = event.lessonType != null ? String(event.lessonType).trim() : '';
  let pairMode = event.pairMode != null ? String(event.pairMode).trim() : '';
  let groupMode = event.groupMode != null ? String(event.groupMode).trim() : '';
  const scaleDisplayName = sanitizeScaleDisplayName(event.scaleDisplayName);

  const normalizedIds = holdIds
    .map((id) => (id != null ? String(id).trim() : ''))
    .filter(Boolean);
  if (normalizedIds.length === 0) {
    return { ok: false, errMsg: '缺少占用记录' };
  }

  if (!['experience', 'regular', 'group', 'open_play'].includes(lessonType)) {
    return { ok: false, errMsg: '请选择课程类型' };
  }

  const userRes = await db.collection('db_user').where({ _openid: openid }).limit(1).get();
  const user = userRes.data && userRes.data[0];
  if (!user) {
    return { ok: false, errMsg: '未登录' };
  }
  if (lessonType === 'open_play') {
    if (!user.isManager) {
      return { ok: false, errMsg: '无权限使用该用途' };
    }
  } else if (!user.isCoach) {
    return { ok: false, errMsg: '仅教练可修改' };
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
  const mpUpd = sanitizeMemberPricePerSlotYuanForUpdate(event.memberPricePerSlotYuan);
  if (!mpUpd.skip && mpUpd.errMsg) {
    return { ok: false, errMsg: mpUpd.errMsg };
  }
  const coachName =
    user.name != null && String(user.name).trim() !== '' ? String(user.name).trim() : '';
  const now = Date.now();

  try {
    let signalVenueId = '';
    let signalOrderDate = '';
    for (let i = 0; i < normalizedIds.length; i += 1) {
      const holdId = normalizedIds[i];
      const docRes = await db.collection('db_coach_slot_hold').doc(holdId).get();
      const doc = docRes.data;
      if (!doc) {
        return { ok: false, errMsg: '记录不存在' };
      }
      if (doc._openid !== openid) {
        return { ok: false, errMsg: '无权限操作' };
      }
      if (doc.status !== 'active') {
        return { ok: false, errMsg: '部分占用已失效，请刷新' };
      }
      if (!signalVenueId && doc.venueId != null) signalVenueId = String(doc.venueId).trim();
      if (!signalOrderDate && doc.orderDate != null) signalOrderDate = String(doc.orderDate).trim();

      const patch = {
        lessonType,
        pairMode: lessonType === 'group' || lessonType === 'open_play' ? '' : pairMode,
        groupMode: lessonType === 'group' || lessonType === 'open_play' ? groupMode : '',
        capacityLabel,
        capacityLimit,
        coachName,
        updatedAt: now,
      };
      if (lessonType === 'group' || lessonType === 'open_play') {
        patch.minParticipants = ge.minParticipants;
        patch.refundHoursBeforeStart = ge.refundHoursBeforeStart;
      } else if (lessonType === 'experience' || lessonType === 'regular') {
        patch.minParticipants = _.remove();
        patch.refundHoursBeforeStart = ge.refundHoursBeforeStart;
      } else {
        patch.minParticipants = _.remove();
        patch.refundHoursBeforeStart = _.remove();
      }
      if (!mpUpd.skip) {
        patch.memberPricePerSlotYuan = mpUpd.value;
        patch.memberPricePerSessionYuan = mpUpd.value;
      }
      await db.collection('db_coach_slot_hold').doc(holdId).update({
        data: patch,
      });
    }
    try {
      await emitBookingRealtimeSignal({
        venueId: signalVenueId,
        orderDate: signalOrderDate,
      });
    } catch (e) {
      console.error('emitBookingRealtimeSignal updateCoachHolds failed', e);
    }
    return { ok: true };
  } catch (err) {
    console.error('updateCoachHolds failed', err);
    return { ok: false, errMsg: err.message || '更新失败' };
  }
};
