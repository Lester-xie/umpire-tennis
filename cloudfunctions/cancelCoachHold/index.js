const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

/**
 * 取消本人一条教练占用（软删除：status -> cancelled）
 * event: { holdId: 文档 _id }
 */
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  if (!openid) {
    return { ok: false, errMsg: '未登录' };
  }

  const holdId = event.holdId != null ? String(event.holdId).trim() : '';
  if (!holdId) {
    return { ok: false, errMsg: '缺少占用记录' };
  }

  try {
    const docRes = await db.collection('db_coach_slot_hold').doc(holdId).get();
    const doc = docRes.data;
    if (!doc) {
      return { ok: false, errMsg: '记录不存在' };
    }
    if (doc._openid !== openid) {
      return { ok: false, errMsg: '无权限操作' };
    }
    if (doc.status !== 'active') {
      return { ok: false, errMsg: '该占用已失效' };
    }

    await db
      .collection('db_coach_slot_hold')
      .doc(holdId)
      .update({
        data: {
          status: 'cancelled',
          cancelledAt: Date.now(),
        },
      });

    return { ok: true };
  } catch (err) {
    console.error('cancelCoachHold failed', err);
    return { ok: false, errMsg: err.message || '取消失败' };
  }
};
