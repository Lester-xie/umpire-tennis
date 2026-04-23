const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const ALLOWED = new Set([
  'name',
  'description',
  'image',
  'picture',
  'displayImage',
  'venueId',
  'typeMap',
  'unit',
  'grantHours',
  'courseHours',
  'category',
  'type',
]);

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
 * event: { courseId: string, patch: object }
 */
exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  if (!openid) return { ok: false, errMsg: '未登录' };

  const admin = await assertStaffCaller(openid);
  if (!admin) return { ok: false, errMsg: '无权限' };

  const courseId = String((event && event.courseId) || '').trim();
  const patch = event && event.patch && typeof event.patch === 'object' ? event.patch : null;
  if (!courseId || !patch) {
    return { ok: false, errMsg: '参数不完整' };
  }

  const data = { updatedAt: Date.now() };
  Object.keys(patch).forEach((k) => {
    if (!ALLOWED.has(k)) return;
    data[k] = patch[k];
  });

  if (Object.keys(data).length <= 1) {
    return { ok: false, errMsg: '无有效字段' };
  }

  if (data.typeMap != null && typeof data.typeMap !== 'object') {
    return { ok: false, errMsg: 'typeMap 须为对象' };
  }

  try {
    await db.collection('db_course').doc(courseId).update({ data });
    await writeAudit({
      adminOpenid: openid,
      adminPhone: admin.phone,
      action: 'updateCourse',
      detail: { courseId, keys: Object.keys(data) },
    });
    return { ok: true };
  } catch (e) {
    console.error('adminUpdateCourse', e);
    return { ok: false, errMsg: e.message || '更新失败' };
  }
};
