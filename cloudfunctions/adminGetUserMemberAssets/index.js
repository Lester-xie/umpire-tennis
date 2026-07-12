const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

function isStaffUser(u) {
  return !!(u && u.isManager);
}

async function assertStaffCaller(openid) {
  const res = await db.collection('db_user').where({ _openid: openid }).limit(1).get();
  const u = res.data && res.data[0];
  if (!isStaffUser(u)) return null;
  return u;
}

function roundYuan(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/**
 * event: { phone: string }
 */
exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  if (!openid) return { ok: false, errMsg: '未登录' };

  const admin = await assertStaffCaller(openid);
  if (!admin) return { ok: false, errMsg: '无权限' };

  const phone = String((event && event.phone) || '').trim();
  if (!/^1\d{10}$/.test(phone)) {
    return { ok: false, errMsg: '请输入有效手机号' };
  }

  try {
    const userHit = await db.collection('db_user').where({ phone }).limit(1).get();
    if (!userHit.data || !userHit.data[0]) {
      return { ok: false, errMsg: '该手机号尚未注册小程序' };
    }

    const [balRes, hoursRes] = await Promise.all([
      db.collection('db_member_venue_balance').where({ phone }).get(),
      db.collection('db_member_course_hours').where({ phone }).get(),
    ]);

    const balances = (balRes.data || []).map((row) => ({
      docId: row._id || '',
      venueId: row.venueId != null ? String(row.venueId).trim() : '',
      balanceYuan: roundYuan(row.balanceYuan),
    }));

    const courseHours = (hoursRes.data || []).map((row) => ({
      docId: row._id || '',
      venueId: row.venueId != null ? String(row.venueId).trim() : '',
      lessonKey: row.lessonKey != null ? String(row.lessonKey).trim() : '',
      hours: Math.max(0, Math.floor(Number(row.hours) || 0)),
    }));

    return { ok: true, data: { balances, courseHours } };
  } catch (e) {
    console.error('adminGetUserMemberAssets', e);
    return { ok: false, errMsg: e.message || '查询失败' };
  }
};
