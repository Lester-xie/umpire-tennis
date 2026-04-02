const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

function isStaffUser(u) {
  return !!(u && u.isManager);
}

async function assertStaffCaller(openid) {
  const res = await db.collection('db_user').where({ _openid: openid }).limit(1).get();
  const u = res.data && res.data[0];
  if (!isStaffUser(u)) return null;
  return u;
}

function monthRangeMs(year, month1to12) {
  const y = Math.floor(Number(year));
  const m = Math.floor(Number(month1to12));
  const start = new Date(y, m - 1, 1).getTime();
  const end = new Date(y, m, 1).getTime();
  return { start, end };
}

function sumFees(rows, feeKey) {
  let fen = 0;
  (rows || []).forEach((r) => {
    const n = Math.floor(Number(r[feeKey]) || 0);
    if (Number.isFinite(n)) fen += n;
  });
  return fen;
}

/**
 * event: { year: number, month: number }  month 为 1-12
 * 按 paidAt 落在该自然月统计；无 paidAt 的已付单不计入（历史数据可能缺字段）。
 */
exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  if (!openid) return { ok: false, errMsg: '未登录' };

  const admin = await assertStaffCaller(openid);
  if (!admin) return { ok: false, errMsg: '无权限' };

  const year = event && event.year != null ? Number(event.year) : NaN;
  const month = event && event.month != null ? Number(event.month) : NaN;
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return { ok: false, errMsg: '年月无效' };
  }

  const { start, end } = monthRangeMs(year, month);

  try {
    const [bookRes, purchaseRes] = await Promise.all([
      db
        .collection('db_booking')
        .where({
          status: 'paid',
          paidAt: _.gte(start).and(_.lt(end)),
        })
        .limit(1000)
        .get(),
      db
        .collection('db_course_purchase')
        .where({
          status: 'paid',
          paidAt: _.gte(start).and(_.lt(end)),
        })
        .limit(1000)
        .get(),
    ]);

    const bookings = bookRes.data || [];
    const purchases = purchaseRes.data || [];

    const bookingFen = sumFees(bookings, 'totalFee');
    const purchaseFen = sumFees(purchases, 'totalFee');

    return {
      ok: true,
      data: {
        year,
        month,
        bookingCount: bookings.length,
        bookingAmountFen: bookingFen,
        coursePurchaseCount: purchases.length,
        coursePurchaseAmountFen: purchaseFen,
        totalAmountFen: bookingFen + purchaseFen,
        truncated: bookings.length >= 1000 || purchases.length >= 1000,
      },
    };
  } catch (e) {
    console.error('adminOrderStatsByMonth', e);
    return { ok: false, errMsg: e.message || '统计失败' };
  }
};
