const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const { calcUnitPriceCents } = require('./courseHourUnit');

function isExperienceLessonKey(lk) {
  return String(lk || '')
    .trim()
    .toLowerCase()
    .startsWith('experience:');
}

function voucherOutTradeNo(platform, receiptCodeKey) {
  const pf = Math.floor(Number(platform) || 0);
  const key = String(receiptCodeKey || '')
    .replace(/\W/g, '')
    .slice(-24);
  return `v${pf}${key}`.slice(0, 32);
}

/**
 * 验券入账：写入 db_course_purchase（含 unitPriceCents），供扣课 FIFO 与教练统计
 */
async function recordCoursePurchaseFromVoucher({
  phone,
  venueId,
  lessonKey,
  grantHours,
  totalFeeCents,
  goodDesc,
  platform,
  receiptCodeKey,
  sourceMeta,
}) {
  const ph = String(phone || '').trim();
  const vid = String(venueId || '').trim();
  const lk = String(lessonKey || '').trim();
  const gh = Math.floor(Number(grantHours) || 0);
  const fee = Math.max(0, Math.floor(Number(totalFeeCents) || 0));
  const pf = Math.floor(Number(platform) || 0);
  const rcKey = String(receiptCodeKey || '').trim();
  const now = Date.now();

  if (!ph || !vid || !lk || gh <= 0 || !rcKey || (pf !== 1 && pf !== 2)) {
    return { ok: false, errMsg: '验券课包参数无效' };
  }

  const outTradeNo = voucherOutTradeNo(pf, rcKey);
  const exist = await db.collection('db_course_purchase').where({ outTradeNo }).limit(1).get();
  if (exist.data && exist.data[0]) {
    return {
      ok: true,
      duplicate: true,
      purchaseId: exist.data[0]._id,
      unitPriceCents: Math.floor(Number(exist.data[0].unitPriceCents) || 0),
    };
  }

  const unitPriceCents = calcUnitPriceCents(fee, gh);
  const addRes = await db.collection('db_course_purchase').add({
    data: {
      phone: ph,
      venueId: vid,
      outTradeNo,
      totalFee: fee,
      status: 'paid',
      courseId: '',
      grantHours: gh,
      lessonKey: lk,
      goodDesc: goodDesc != null ? String(goodDesc).trim() : '',
      unitPriceCents,
      remainingHours: gh,
      purchaseSource: sourceMeta || (pf === 2 ? 'douyin_receipt' : 'meituan_receipt'),
      voucherPlatform: pf,
      voucherReceiptCode: rcKey,
      paidAt: now,
      createdAt: now,
      updatedAt: now,
    },
  });

  return { ok: true, purchaseId: addRes._id, unitPriceCents, outTradeNo };
}

/**
 * 累加 db_member_course_hours；验券时可附带写入 db_course_purchase 记录课时单价
 */
async function grantMemberCourseHours({
  phone,
  venueId,
  lessonKey,
  grantHours,
  sourceMeta,
  voucherPurchase,
}) {
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
      console.error('grantMemberCourseHours setVip', e);
    }
  }

  let purchaseRecord = null;
  if (voucherPurchase && typeof voucherPurchase === 'object') {
    purchaseRecord = await recordCoursePurchaseFromVoucher({
      phone: ph,
      venueId: vid,
      lessonKey: lk,
      grantHours: gh,
      totalFeeCents: voucherPurchase.totalFeeCents,
      goodDesc: voucherPurchase.goodDesc,
      platform: voucherPurchase.platform,
      receiptCodeKey: voucherPurchase.receiptCodeKey,
      sourceMeta,
    });
    if (!purchaseRecord.ok) {
      console.error('recordCoursePurchaseFromVoucher failed', purchaseRecord.errMsg);
    }
  }

  return {
    ok: true,
    phone: ph,
    venueId: vid,
    lessonKey: lk,
    grantHours: gh,
    purchaseRecord,
  };
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
  recordCoursePurchaseFromVoucher,
  resolveAipaiVenueId,
  isExperienceLessonKey,
  voucherOutTradeNo,
};
