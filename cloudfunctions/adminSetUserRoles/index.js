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
 * event: { targetPhone, isCoach?, isVip?, commissionPersent? }
 * isManager 仅允许在云数据库 db_user 中手动维护，本接口忽略该字段。
 * 仅当 isCoach / isVip 为 boolean 时更新该项。
 * isCoach 为 true 时写入 commissionPersent：存小数比例（5%→0.05），event 传 0–100 的百分点，缺省 5→0.05；为 false 时不改该字段。
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

  if (event && typeof event.isCoach === 'boolean' && event.isCoach) {
    let cp = event.commissionPersent;
    if (cp === undefined || cp === null || cp === '') {
      data.commissionPersent = 0.05;
    } else {
      const n = Number(cp);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        return { ok: false, errMsg: '分成比例须为 0–100 的数字' };
      }
      data.commissionPersent = Number((n / 100).toFixed(6));
    }
  }

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
