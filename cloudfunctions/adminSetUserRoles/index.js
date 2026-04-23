const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

/** 管理员权限：isManager */
function isStaffUser(u) {
  return !!(u && u.isManager);
}

async function assertStaffCaller(openid) {
  const res = await db.collection('db_user').where({ _openid: openid }).limit(1).get();
  const u = res.data && res.data[0];
  if (!isStaffUser(u)) return null;
  return u;
}

async function writeAudit({ adminOpenid, adminPhone, action, detail }) {
  try {
    await db.collection('db_admin_audit').add({
      data: {
        adminOpenid: adminOpenid || '',
        adminPhone: adminPhone != null ? String(adminPhone).trim() : '',
        action: String(action || ''),
        detail: detail && typeof detail === 'object' ? detail : {},
        createdAt: Date.now(),
      },
    });
  } catch (e) {
    console.warn('db_admin_audit write failed', e);
  }
}

/**
 * event: { targetPhone, isCoach?, isVip? }
 * isManager 仅允许在云数据库 db_user 中手动维护，本接口忽略该字段。
 * 仅当 isCoach / isVip 为 boolean 时更新该项。
 */
exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  if (!openid) return { ok: false, errMsg: '未登录' };

  const admin = await assertStaffCaller(openid);
  if (!admin) return { ok: false, errMsg: '无权限' };

  const targetPhone = String((event && event.targetPhone) || '').trim();
  if (!/^1\d{10}$/.test(targetPhone)) {
    return { ok: false, errMsg: '请输入有效手机号' };
  }

  const hit = await db.collection('db_user').where({ phone: targetPhone }).limit(1).get();
  const row = hit.data && hit.data[0];
  if (!row || !row._id) {
    return { ok: false, errMsg: '该手机号尚未注册小程序' };
  }

  const data = { updatedAt: Date.now() };
  const keys = ['isCoach', 'isVip'];
  keys.forEach((k) => {
    if (event && typeof event[k] === 'boolean') {
      data[k] = event[k];
    }
  });

  if (Object.keys(data).length <= 1) {
    return { ok: false, errMsg: '未指定要修改的字段' };
  }

  try {
    await db.collection('db_user').doc(row._id).update({ data });
    await writeAudit({
      adminOpenid: openid,
      adminPhone: admin.phone,
      action: 'setUserRoles',
      detail: { targetPhone, patch: data },
    });
    return { ok: true };
  } catch (e) {
    console.error('adminSetUserRoles', e);
    return { ok: false, errMsg: e.message || '更新失败' };
  }
};
