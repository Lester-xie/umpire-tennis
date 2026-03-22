const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

/**
 * 当前用户已支付的课程（课时包）订单：db_course_purchase
 * 与 listBookings 相同：openid + phone 与 db_user 一致才可查。
 */
exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  if (!openid) {
    return { data: [] };
  }

  const phone = String((event && event.phone) || '').trim();
  if (!phone) {
    return { data: [] };
  }

  const userRes = await db.collection('db_user').where({ _openid: openid, phone }).limit(1).get();
  if (!userRes.data || userRes.data.length === 0) {
    return { data: [] };
  }

  try {
    const res = await db.collection('db_course_purchase').where({ phone }).get();
    const list = (res.data || [])
      .filter((doc) => doc.status === 'paid')
      .sort((a, b) => (b.paidAt || b.createdAt || 0) - (a.paidAt || a.createdAt || 0))
      .slice(0, 80);
    return { data: list };
  } catch (err) {
    console.error('listCoursePurchases', err);
    return { data: [], errMsg: err.message || String(err) };
  }
};
