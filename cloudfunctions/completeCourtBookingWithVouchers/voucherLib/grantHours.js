const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

function isExperienceLessonKey(lk) {
  return String(lk || '')
    .trim()
    .toLowerCase()
    .startsWith('experience:');
}

/**
 * 与 payCallback 一致：累加 db_member_course_hours；单次 ≥10 小时正课/订场包可设 VIP
 */
async function grantMemberCourseHours({ phone, venueId, lessonKey, grantHours, sourceMeta }) {
  const ph = String(phone || '').trim();
  const lk = String(lessonKey || '').trim();
  const vid = String(venueId || '').trim();
  const gh = Math.floor(Number(grantHours) || 0);
  const now = Date.now();

  if (!ph || !lk || !vid || gh <= 0) {
    return { ok: false, errMsg: '入账参数无效' };
  }

  const balColl = db.collection('db_member_course_hours');
  const bal = await balColl.where({ phone: ph, lessonKey: lk, venueId: vid }).limit(1).get();
  if (bal.data && bal.data.length > 0) {
    await balColl.doc(bal.data[0]._id).update({
      data: {
        hours: _.inc(gh),
        updatedAt: now,
        lastGrantSource: sourceMeta || 'meituan',
      },
    });
  } else {
    await balColl.add({
      data: {
        phone: ph,
        venueId: vid,
        lessonKey: lk,
        hours: gh,
        lastGrantSource: sourceMeta || 'meituan',
        createdAt: now,
        updatedAt: now,
      },
    });
  }

  if (gh >= 10 && !isExperienceLessonKey(lk)) {
    try {
      const userHit = await db.collection('db_user').where({ phone: ph }).limit(1).get();
      const udoc = userHit.data && userHit.data[0];
      if (udoc && udoc._id) {
        await db.collection('db_user').doc(udoc._id).update({
          data: { isVip: true, updatedAt: now },
        });
      }
    } catch (e) {
      console.error('grantMemberCourseHours setVip', ph, e);
    }
  }

  return { ok: true, phone: ph, venueId: vid, lessonKey: lk, grantHours: gh };
}

async function resolveAipaiVenueId() {
  const fromEnv = process.env.MEITUAN_VENUE_ID || process.env.VENUE_ID;
  if (fromEnv != null && String(fromEnv).trim() !== '') {
    return String(fromEnv).trim();
  }
  try {
    const hit = await db
      .collection('db_venue')
      .where({
        name: db.RegExp({ regexp: '昂湃网球学练馆', options: 'i' }),
      })
      .limit(1)
      .get();
    const row = hit.data && hit.data[0];
    if (row && row._id != null) return String(row._id).trim();
  } catch (e) {
    console.error('resolveAipaiVenueId', e);
  }
  return '';
}

module.exports = {
  grantMemberCourseHours,
  resolveAipaiVenueId,
  isExperienceLessonKey,
};
