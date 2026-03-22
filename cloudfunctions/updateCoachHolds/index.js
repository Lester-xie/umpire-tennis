const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

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
  const pairMode = event.pairMode != null ? String(event.pairMode).trim() : '';
  const groupMode = event.groupMode != null ? String(event.groupMode).trim() : '';

  const normalizedIds = holdIds
    .map((id) => (id != null ? String(id).trim() : ''))
    .filter(Boolean);
  if (normalizedIds.length === 0) {
    return { ok: false, errMsg: '缺少占用记录' };
  }

  if (!['experience', 'regular', 'group'].includes(lessonType)) {
    return { ok: false, errMsg: '请选择课程类型' };
  }
  if (lessonType === 'group') {
    if (!['group35', 'groupOther'].includes(groupMode)) {
      return { ok: false, errMsg: '请选择团课班型' };
    }
  } else if (!['1v1', '1v2'].includes(pairMode)) {
    return { ok: false, errMsg: '请选择 1V1 或 1V2' };
  }

  const userRes = await db.collection('db_user').where({ _openid: openid }).limit(1).get();
  const user = userRes.data && userRes.data[0];
  if (!user || !user.isCoach) {
    return { ok: false, errMsg: '仅教练可修改' };
  }

  const capacityLabel = buildCapacityLabel(lessonType, pairMode, groupMode);
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
            pairMode: lessonType === 'group' ? '' : pairMode,
            groupMode: lessonType === 'group' ? groupMode : '',
            capacityLabel,
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
