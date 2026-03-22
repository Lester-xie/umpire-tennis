const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

/**
 * 当前教练的有效场地占用列表（db_coach_slot_hold，status=active）
 */
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  if (!openid) {
    return { data: [] };
  }

  try {
    const res = await db.collection('db_coach_slot_hold').where({
      _openid: openid,
      status: 'active',
    }).get();

    const rows = (res.data || [])
      .sort((a, b) => {
        const ds = String(b.orderDate || '').localeCompare(String(a.orderDate || ''));
        if (ds !== 0) return ds;
        return (b.createdAt || 0) - (a.createdAt || 0);
      })
      .slice(0, 100);

    return { data: rows };
  } catch (err) {
    console.error('listCoachHolds failed', err);
    return { data: [], errMsg: err.message || String(err) };
  }
};
