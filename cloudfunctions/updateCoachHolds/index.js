const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

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
  if (lt === 'group') return 5;
  if (lt === 'open_play') {
    const gm = String(groupMode || '').trim().toLowerCase();
    if (gm === 'group36') return 6;
    return 6;
  }
  const pm = String(pairMode || '')
    .trim()
    .toLowerCase();
  if (pm === '1v2') return 2;
  return 1;
}

/**
 * 批量更新本人多条教练占用：课程类型 / 规模（与 coachHoldSlots 字段一致）
 * event: { holdIds: string[], lessonType, pairMode?, groupMode? }
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
  let capacityLimit = Math.floor(Number(event.capacityLimit));
  if (!Number.isFinite(capacityLimit) || capacityLimit < 1) {
    capacityLimit = defaultCapacityLimit(lessonType, pairMode, groupMode);
  }
  capacityLimit = Math.min(99, capacityLimit);
  const coachName =
    user.name != null && String(user.name).trim() !== '' ? String(user.name).trim() : '';
  const now = Date.now();

  try {
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

      await db
        .collection('db_coach_slot_hold')
        .doc(holdId)
        .update({
          data: {
            lessonType,
            pairMode: lessonType === 'group' || lessonType === 'open_play' ? '' : pairMode,
            groupMode: lessonType === 'group' || lessonType === 'open_play' ? groupMode : '',
            capacityLabel,
            capacityLimit,
            coachName,
            updatedAt: now,
          },
        });
    }
    return { ok: true };
  } catch (err) {
    console.error('updateCoachHolds failed', err);
    return { ok: false, errMsg: err.message || '更新失败' };
  }
};
