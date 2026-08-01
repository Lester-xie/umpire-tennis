const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

/**
 * 查询当前用户场馆月卡（db_member_venue_month_card）
 * 文档字段：phone, venueId, expiresAt
 * event.allVenues=true 时返回该手机号全部场馆月卡
 * event.orderDate=YYYY-MM-DD 且单馆查询时，附带 freeUsedOnDate（当日是否已用免费 1 小时）
 */
exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const phone = String((event && event.phone) || '').trim();
  const venueId = String((event && event.venueId) || '').trim();
  const orderDate = String((event && event.orderDate) || '').trim();
  const allVenues = !!(event && event.allVenues);
  if (!openid || !phone) {
    return { data: [] };
  }
  if (!allVenues && !venueId) {
    return { data: [] };
  }

  const userRes = await db.collection('db_user').where({ _openid: openid, phone }).limit(1).get();
  if (!userRes.data || userRes.data.length === 0) {
    return { data: [] };
  }

  try {
    if (allVenues) {
      const res = await db.collection('db_member_venue_month_card').where({ phone }).get();
      return { data: res.data || [] };
    }
    const res = await db.collection('db_member_venue_month_card').where({ phone, venueId }).limit(1).get();
    const data = res.data || [];
    let freeUsedOnDate = false;
    if (orderDate && data.length) {
      const usedHit = await db
        .collection('db_booking')
        .where({
          phone,
          venueId,
          orderDate,
          status: _.in(['paid', 'pending']),
          monthCardFreeSlotKey: _.neq(''),
        })
        .limit(1)
        .get();
      freeUsedOnDate = !!(usedHit.data && usedHit.data.length);
    }
    return { data, freeUsedOnDate };
  } catch (err) {
    console.error('listMemberVenueMonthCard', err);
    return { data: [], errMsg: err.message || String(err) };
  }
};
