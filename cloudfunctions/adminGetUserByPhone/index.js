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
 * event:
 * - { action: 'listCoaches' } 列出全部 isCoach 用户（含管理员兼教练）
 * - { phone: string } 按手机号查单用户
 */
exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  if (!openid) return { ok: false, errMsg: '未登录' };

  const admin = await assertStaffCaller(openid);
  if (!admin) return { ok: false, errMsg: '无权限' };

  const action = event && event.action != null ? String(event.action).trim() : '';

  if (action === 'listCoaches') {
    try {
      const hit = await db.collection('db_user').where({ isCoach: true }).limit(500).get();
      const rows = (hit && hit.data) || [];
      const coaches = rows
        .filter((u) => u && u.phone && /^1\d{10}$/.test(String(u.phone).trim()))
        .map((u) => ({
          phone: String(u.phone).trim(),
          name: u.name != null && String(u.name).trim() !== '' ? String(u.name).trim() : '教练',
          isCoach: true,
          isManager: !!u.isManager,
        }));
      return { ok: true, data: { coaches } };
    } catch (e) {
      console.error('adminGetUserByPhone listCoaches', e);
      return { ok: false, errMsg: e.message || '查询失败' };
    }
  }

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
        isManager: !!row.isManager,
      },
    };
  } catch (e) {
    console.error('adminGetUserByPhone', e);
    return { ok: false, errMsg: e.message || '查询失败' };
  }
};
