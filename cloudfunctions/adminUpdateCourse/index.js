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
  'lessonType',
]);

/** 复制到新场馆时从源文档拷贝的字段 */
const COPY_FIELDS = [
  'name',
  'description',
  'image',
  'picture',
  'displayImage',
  'typeMap',
  'unit',
  'grantHours',
  'courseHours',
  'category',
  'type',
  'lessonType',
  'title',
];

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

function cloneJson(v) {
  if (v == null) return v;
  try {
    return JSON.parse(JSON.stringify(v));
  } catch (e) {
    return v;
  }
}

/**
 * 更新：event { courseId, patch }
 * 复制到场馆（新建独立文档）：event { action: 'copyToVenue', sourceCourseId, venueId }
 */
exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  if (!openid) return { ok: false, errMsg: '未登录' };

  const admin = await assertStaffCaller(openid);
  if (!admin) return { ok: false, errMsg: '无权限' };

  const action = event && event.action != null ? String(event.action).trim() : 'update';

  if (action === 'copyToVenue') {
    const sourceCourseId = String((event && event.sourceCourseId) || '').trim();
    const venueId = String((event && event.venueId) || '').trim();
    if (!sourceCourseId || !venueId) {
      return { ok: false, errMsg: '参数不完整' };
    }
    try {
      const srcDoc = await db.collection('db_course').doc(sourceCourseId).get();
      const src = srcDoc && srcDoc.data;
      if (!src) return { ok: false, errMsg: '源课程不存在' };

      const now = Date.now();
      const data = {
        venueId,
        createdAt: now,
        updatedAt: now,
        copiedFromCourseId: sourceCourseId,
      };
      COPY_FIELDS.forEach((k) => {
        if (src[k] === undefined) return;
        data[k] = k === 'typeMap' ? cloneJson(src[k]) : src[k];
      });
      // 兼容旧字段 venue
      data.venue = venueId;

      const addRes = await db.collection('db_course').add({ data });
      const newId = addRes && addRes._id != null ? String(addRes._id) : '';
      await writeAudit({
        adminOpenid: openid,
        adminPhone: admin.phone,
        action: 'copyCourseToVenue',
        detail: { sourceCourseId, venueId, courseId: newId },
      });
      return { ok: true, courseId: newId };
    } catch (e) {
      console.error('adminUpdateCourse copyToVenue', e);
      return { ok: false, errMsg: e.message || '复制失败' };
    }
  }

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

  // 禁止改绑场馆：每馆独立课程文档，需用 copyToVenue
  if (Object.prototype.hasOwnProperty.call(data, 'venueId')) {
    try {
      const curDoc = await db.collection('db_course').doc(courseId).get();
      const cur = curDoc && curDoc.data;
      const oldVid = cur && cur.venueId != null ? String(cur.venueId).trim() : '';
      const newVid = data.venueId != null ? String(data.venueId).trim() : '';
      if (oldVid && newVid && oldVid !== newVid) {
        return { ok: false, errMsg: '不可改绑场馆，请使用「复制到本馆」生成独立课程' };
      }
    } catch (e) {
      console.warn('venueId check', e);
    }
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
