/**
 * 课时单价工具（购课加权平均 + 扣课按统一单价快照）
 * 云函数内 require 前请复制到各云函数目录，或整包部署 common
 */

function calcUnitPriceCents(totalFee, grantHours) {
  const fee = Math.floor(Number(totalFee) || 0);
  const gh = Math.floor(Number(grantHours) || 0);
  if (gh <= 0 || fee <= 0) return 0;
  return Math.max(1, Math.floor(fee / gh));
}

/** 分 → 元（保留两位） */
function centsToYuan(cents) {
  const n = Math.floor(Number(cents) || 0);
  return Math.round(n) / 100;
}

/**
 * 购课入账加权平均单价（元/节）
 * 例：剩 18 节×188，再买 10 节×198 → (188*18 + 198*10) / 28
 */
function mergeUnitPriceYuan(oldHours, oldUnitPriceYuan, addHours, addUnitPriceYuan) {
  const oh = Math.max(0, Math.floor(Number(oldHours) || 0));
  const ah = Math.max(0, Math.floor(Number(addHours) || 0));
  const op = Number(oldUnitPriceYuan);
  const ap = Number(addUnitPriceYuan);
  const oldP = Number.isFinite(op) && op > 0 ? Math.round(op * 100) / 100 : 0;
  const addP = Number.isFinite(ap) && ap > 0 ? Math.round(ap * 100) / 100 : 0;
  if (ah <= 0) return oldP;
  if (oh <= 0) return addP;
  return Math.round(((oldP * oh + addP * ah) / (oh + ah)) * 100) / 100;
}

function isExperienceLessonKey(lk) {
  return String(lk || '')
    .trim()
    .toLowerCase()
    .startsWith('experience:');
}

/**
 * 按 db_member_course_hours.unitPriceYuan 生成扣课单价快照（不再走课包 FIFO）
 */
async function allocateLessonUnits(db, { phone, venueId, lessonKey, hoursNeeded }) {
  const ph = String(phone || '').trim();
  const vid = String(venueId || '').trim();
  const lk = String(lessonKey || '').trim();
  const need = Math.floor(Number(hoursNeeded) || 0);
  if (!ph || !vid || !lk || need <= 0) {
    return { ok: false, errMsg: '分配课时参数无效' };
  }

  let unitCents = 0;
  try {
    const balHit = await db
      .collection('db_member_course_hours')
      .where({ phone: ph, venueId: vid, lessonKey: lk })
      .limit(1)
      .get();
    const bal = balHit.data && balHit.data[0];
    if (!bal) {
      return { ok: false, errMsg: '暂无课时余额' };
    }
    const yuan = Number(bal.unitPriceYuan);
    if (Number.isFinite(yuan) && yuan > 0) {
      unitCents = Math.max(1, Math.round(yuan * 100));
    }
  } catch (e) {
    console.error('allocateLessonUnits unitPriceYuan', e);
    return { ok: false, errMsg: '读取课时单价失败' };
  }

  const lessonUnits = [];
  for (let j = 0; j < need; j += 1) {
    lessonUnits.push({
      purchaseId: '',
      unitPriceCents: unitCents,
    });
  }

  return {
    ok: true,
    lessonUnits,
    lessonValueCents: unitCents * need,
    purchaseUpdates: [],
  };
}

function lessonHoursForBooking(booking) {
  const deduct = Math.floor(Number(booking.coachCourseHoursDeduct) || 0);
  if (deduct > 0) return deduct;
  const slots = Array.isArray(booking.bookedSlots) ? booking.bookedSlots : [];
  if (slots.length > 0) return slots.length;
  return 1;
}

function lessonValueCentsForBooking(booking) {
  const stored = Math.floor(Number(booking.lessonValueCents) || 0);
  if (stored > 0) return stored;
  const units = Array.isArray(booking.lessonUnits) ? booking.lessonUnits : [];
  if (units.length > 0) {
    return units.reduce((s, u) => s + Math.floor(Number(u.unitPriceCents) || 0), 0);
  }
  return 0;
}

module.exports = {
  calcUnitPriceCents,
  centsToYuan,
  mergeUnitPriceYuan,
  isExperienceLessonKey,
  allocateLessonUnits,
  lessonHoursForBooking,
  lessonValueCentsForBooking,
};
