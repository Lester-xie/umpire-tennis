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
    const hit = await db.collection('db_user').where({ phone }).limit(1).get();
    const row = hit.data && hit.data[0];
    if (!row || !row._id) {
      return { ok: false, errMsg: '该手机号尚未注册小程序' };
    }
    return {
      ok: true,
      data: {
        phone: row.phone != null ? String(row.phone) : phone,
        name: row.name != null ? String(row.name) : '',
        avatar: row.avatar != null ? String(row.avatar) : '',
        isVip: !!row.isVip,
        isCoach: !!row.isCoach,
        commissionPersent:
          row.commissionPersent != null && row.commissionPersent !== ''
            ? Number(row.commissionPersent)
            : null,
      },
    };
  } catch (e) {
    console.error('adminGetUserByPhone', e);
    return { ok: false, errMsg: e.message || '查询失败' };
  }
};
