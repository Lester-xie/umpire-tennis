const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

/**
 * 查询当前用户场馆储值余额（db_member_venue_balance）
 * 文档字段：phone, venueId, balanceYuan
 */
exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const phone = String((event && event.phone) || '').trim();
  const venueId = String((event && event.venueId) || '').trim();
  const allVenues = !!(event && event.allVenues);
  if (!openid || !phone) {
    return { data: [] };
  }

  const userRes = await db.collection('db_user').where({ _openid: openid, phone }).limit(1).get();
  if (!userRes.data || userRes.data.length === 0) {
    return { data: [] };
  }

  try {
    if (allVenues) {
      const res = await db.collection('db_member_venue_balance').where({ phone }).get();
      return { data: res.data || [] };
    }
    if (!venueId) {
      return { data: [] };
    }
    const res = await db.collection('db_member_venue_balance').where({ phone, venueId }).get();
    return { data: res.data || [] };
  } catch (err) {
    console.error('listMemberVenueBalance', err);
    return { data: [], errMsg: err.message || String(err) };
  }
};
