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

async function emitMemberAssetRealtimeSignal(phone) {
  const phoneNorm = String(phone || '').trim();
  if (!/^1\d{10}$/.test(phoneNorm)) return;
  const ts = Date.now();
  // 与订场页共用 db_booking_realtime_signal，避免新集合未配读权限导致 watch 无效
  const coll = db.collection('db_booking_realtime_signal');
  const hit = await coll.where({ signalKind: 'member_asset', phone: phoneNorm }).limit(1).get();
  if (hit.data && hit.data[0] && hit.data[0]._id) {
    await coll.doc(hit.data[0]._id).update({
      data: {
        eventType: 'member_assets_updated',
        updatedAt: ts,
      },
    });
    return;
  }
  await coll.add({
    data: {
      signalKind: 'member_asset',
      phone: phoneNorm,
      eventType: 'member_assets_updated',
      createdAt: ts,
      updatedAt: ts,
    },
  });
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

function roundYuan(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100) / 100;
}

function venueIdInValues(venueIdRaw) {
  const s = String(venueIdRaw || '').trim();
  if (!s) return [];
  const out = new Set([s]);
  const n = Number(s);
  if (Number.isFinite(n)) out.add(n);
  return [...out];
}

async function findBalanceDoc({ phone, venueId, docId }) {
  if (docId) {
    try {
      const doc = await db.collection('db_member_venue_balance').doc(String(docId).trim()).get();
      const row = doc.data;
      if (!row) return null;
      if (String(row.phone || '').trim() !== phone) return null;
      return row;
    } catch (e) {
      return null;
    }
  }
  const venueIds = venueIdInValues(venueId);
  if (!venueIds.length) return null;
  const hit = await db.collection('db_member_venue_balance').where({ phone, venueId: _.in(venueIds) }).limit(1).get();
  return hit.data && hit.data[0] ? hit.data[0] : null;
}

async function findCourseHoursDoc({ phone, venueId, lessonKey, docId }) {
  if (docId) {
    try {
      const doc = await db.collection('db_member_course_hours').doc(String(docId).trim()).get();
      const row = doc.data;
      if (!row) return null;
      if (String(row.phone || '').trim() !== phone) return null;
      return row;
    } catch (e) {
      return null;
    }
  }
  const venueIds = venueIdInValues(venueId);
  const lk = String(lessonKey || '').trim();
  if (!venueIds.length || !lk) return null;
  const hit = await db
    .collection('db_member_course_hours')
    .where({ phone, lessonKey: lk, venueId: _.in(venueIds) })
    .limit(1)
    .get();
  return hit.data && hit.data[0] ? hit.data[0] : null;
}

/**
 * event: {
 *   targetPhone: string,
 *   balances?: Array<{ docId?: string, venueId: string, balanceYuan: number }>,
 *   courseHours?: Array<{ docId?: string, venueId: string, lessonKey: string, hours: number }>,
 * }
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

  const userHit = await db.collection('db_user').where({ phone: targetPhone }).limit(1).get();
  if (!userHit.data || !userHit.data[0]) {
    return { ok: false, errMsg: '该手机号尚未注册小程序' };
  }

  const balances = Array.isArray(event && event.balances) ? event.balances : [];
  const courseHours = Array.isArray(event && event.courseHours) ? event.courseHours : [];
  if (balances.length === 0 && courseHours.length === 0) {
    return { ok: false, errMsg: '未指定要保存的储值或课时' };
  }

  const now = Date.now();
  const balanceUpdates = [];
  const courseHourUpdates = [];

  try {
    for (let i = 0; i < balances.length; i += 1) {
      const item = balances[i] || {};
      const venueId = String(item.venueId || '').trim();
      const balanceYuan = roundYuan(item.balanceYuan);
      const docId = item.docId != null ? String(item.docId).trim() : '';
      if (!venueId) {
        return { ok: false, errMsg: `储值第 ${i + 1} 项缺少场馆` };
      }
      if (!Number.isFinite(balanceYuan) || balanceYuan < 0) {
        return { ok: false, errMsg: `储值第 ${i + 1} 项金额无效` };
      }
      const existing = await findBalanceDoc({ phone: targetPhone, venueId, docId });
      if (docId && !existing) {
        return { ok: false, errMsg: `储值第 ${i + 1} 项记录不存在或无权修改` };
      }
      if (existing && existing._id) {
        await db.collection('db_member_venue_balance').doc(existing._id).update({
          data: {
            venueId: existing.venueId != null ? existing.venueId : venueId,
            balanceYuan,
            updatedAt: now,
          },
        });
        balanceUpdates.push({ docId: existing._id, venueId, balanceYuan });
      } else {
        const addRes = await db.collection('db_member_venue_balance').add({
          data: {
            phone: targetPhone,
            venueId,
            balanceYuan,
            createdAt: now,
            updatedAt: now,
          },
        });
        balanceUpdates.push({ docId: addRes._id, venueId, balanceYuan, created: true });
      }
    }

    for (let i = 0; i < courseHours.length; i += 1) {
      const item = courseHours[i] || {};
      const venueId = String(item.venueId || '').trim();
      const lessonKey = String(item.lessonKey || '').trim();
      const hours = Math.floor(Number(item.hours));
      const docId = item.docId != null ? String(item.docId).trim() : '';
      if (!venueId) {
        return { ok: false, errMsg: `课时第 ${i + 1} 项缺少场馆` };
      }
      if (!lessonKey) {
        return { ok: false, errMsg: `课时第 ${i + 1} 项缺少课程类型` };
      }
      if (!Number.isFinite(hours) || hours < 0) {
        return { ok: false, errMsg: `课时第 ${i + 1} 项数量无效` };
      }
      const existing = await findCourseHoursDoc({ phone: targetPhone, venueId, lessonKey, docId });
      if (docId && !existing) {
        return { ok: false, errMsg: `课时第 ${i + 1} 项记录不存在或无权修改` };
      }
      if (existing && existing._id) {
        await db.collection('db_member_course_hours').doc(existing._id).update({
          data: {
            venueId: existing.venueId != null ? existing.venueId : venueId,
            lessonKey: existing.lessonKey != null ? existing.lessonKey : lessonKey,
            hours,
            updatedAt: now,
          },
        });
        courseHourUpdates.push({ docId: existing._id, venueId, lessonKey, hours });
      } else {
        const addRes = await db.collection('db_member_course_hours').add({
          data: {
            phone: targetPhone,
            venueId,
            lessonKey,
            hours,
            createdAt: now,
            updatedAt: now,
          },
        });
        courseHourUpdates.push({ docId: addRes._id, venueId, lessonKey, hours, created: true });
      }
    }

    await writeAudit({
      adminOpenid: openid,
      adminPhone: admin.phone,
      action: 'setUserMemberAssets',
      detail: {
        targetPhone,
        balanceUpdates,
        courseHourUpdates,
      },
    });

    try {
      await emitMemberAssetRealtimeSignal(targetPhone);
    } catch (e) {
      console.warn('emitMemberAssetRealtimeSignal failed', e);
    }

    return { ok: true };
  } catch (e) {
    console.error('adminSetUserMemberAssets', e);
    return { ok: false, errMsg: e.message || '保存失败' };
  }
};
