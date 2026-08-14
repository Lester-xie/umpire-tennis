const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const DEFAULT_AVATAR = '/assets/images/default-avatar.jpg';

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

function sanitizeName(raw) {
  const name = String(raw != null ? raw : '').trim();
  if (!name) return { ok: false, errMsg: '请填写教练姓名' };
  if (name.length > 32) return { ok: false, errMsg: '姓名最多 32 个字' };
  return { ok: true, name };
}

/**
 * event:
 * - { action: 'upsertCoach', targetPhone, name } 新增或升级为教练
 * - { targetPhone, isCoach?, isVip?, name? } 更新角色/昵称
 * isManager 仅允许在云数据库 db_user 中手动维护，本接口忽略该字段。
 */
exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  if (!openid) return { ok: false, errMsg: '未登录' };

  const admin = await assertStaffCaller(openid);
  if (!admin) return { ok: false, errMsg: '无权限' };

  const action = event && event.action != null ? String(event.action).trim() : '';
  const targetPhone = String((event && event.targetPhone) || '').trim();
  if (!/^1\d{10}$/.test(targetPhone)) {
    return { ok: false, errMsg: '请输入有效手机号' };
  }

  if (action === 'upsertCoach') {
    const nameRes = sanitizeName(event && event.name);
    if (!nameRes.ok) return nameRes;

    try {
      const hit = await db.collection('db_user').where({ phone: targetPhone }).limit(1).get();
      const row = hit.data && hit.data[0];
      const now = Date.now();

      if (row && row._id) {
        const patch = {
          name: nameRes.name,
          isCoach: true,
          updatedAt: now,
        };
        await db.collection('db_user').doc(row._id).update({ data: patch });
        await writeAudit({
          adminOpenid: openid,
          adminPhone: admin.phone,
          action: 'upsertCoach',
          detail: { targetPhone, created: false, patch },
        });
        return { ok: true, created: false };
      }

      await db.collection('db_user').add({
        data: {
          phone: targetPhone,
          name: nameRes.name,
          avatar: DEFAULT_AVATAR,
          isCoach: true,
          isVip: false,
          createdAt: now,
          updatedAt: now,
        },
      });
      await writeAudit({
        adminOpenid: openid,
        adminPhone: admin.phone,
        action: 'upsertCoach',
        detail: { targetPhone, created: true, name: nameRes.name },
      });
      return { ok: true, created: true };
    } catch (e) {
      console.error('adminSetUserRoles upsertCoach', e);
      return { ok: false, errMsg: e.message || '保存失败' };
    }
  }

  let hit = await db.collection('db_user').where({ phone: targetPhone }).limit(1).get();
  let row = hit.data && hit.data[0];
  let stubCreated = false;
  if (!row || !row._id) {
    // 未注册：预建账号后再写角色（与导入课时一致，用户授权后绑 openid）
    const now = Date.now();
    const last4 = targetPhone.slice(-4);
    const nameFromEvent =
      event && Object.prototype.hasOwnProperty.call(event, 'name')
        ? sanitizeName(event.name)
        : null;
    if (nameFromEvent && !nameFromEvent.ok) return nameFromEvent;
    const createData = {
      phone: targetPhone,
      name: (nameFromEvent && nameFromEvent.name) || `昂湃用户_${last4}`,
      avatar: DEFAULT_AVATAR,
      isVip: typeof (event && event.isVip) === 'boolean' ? event.isVip : false,
      isCoach: typeof (event && event.isCoach) === 'boolean' ? event.isCoach : false,
      createdAt: now,
      updatedAt: now,
    };
    try {
      const addRes = await db.collection('db_user').add({ data: createData });
      row = { _id: addRes._id, ...createData };
      stubCreated = true;
      await writeAudit({
        adminOpenid: openid,
        adminPhone: admin.phone,
        action: 'setUserRoles',
        detail: { targetPhone, stubCreated: true, created: createData },
      });
      return { ok: true, stubCreated: true };
    } catch (e) {
      console.error('adminSetUserRoles create stub', e);
      return { ok: false, errMsg: e.message || '预建用户失败' };
    }
  }

  const data = { updatedAt: Date.now() };
  const keys = ['isCoach', 'isVip'];
  keys.forEach((k) => {
    if (event && typeof event[k] === 'boolean') {
      data[k] = event[k];
    }
  });

  if (event && Object.prototype.hasOwnProperty.call(event, 'name')) {
    const nameRes = sanitizeName(event.name);
    if (!nameRes.ok) return nameRes;
    data.name = nameRes.name;
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
      detail: { targetPhone, stubCreated, patch: data },
    });
    return { ok: true };
  } catch (e) {
    console.error('adminSetUserRoles', e);
    return { ok: false, errMsg: e.message || '更新失败' };
  }
};
