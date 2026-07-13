/**
 * 课时包单价与 FIFO 扣课（云函数内 require 前请复制到各云函数目录，或整包部署 common）
 */

function calcUnitPriceCents(totalFee, grantHours) {
  const fee = Math.floor(Number(totalFee) || 0);
  const gh = Math.floor(Number(grantHours) || 0);
  if (gh <= 0 || fee <= 0) return 0;
  return Math.max(1, Math.floor(fee / gh));
}

function isExperienceLessonKey(lk) {
  return String(lk || '')
    .trim()
    .toLowerCase()
    .startsWith('experience:');
}

function purchaseRemainingHours(p) {
  const gh = Math.floor(Number(p.grantHours) || 0);
  if (p.remainingHours != null && Number.isFinite(Number(p.remainingHours))) {
    return Math.max(0, Math.floor(Number(p.remainingHours)));
  }
  return Math.max(0, gh);
}

function purchaseUnitPriceCents(p) {
  const stored = Math.floor(Number(p.unitPriceCents) || 0);
  if (stored > 0) return stored;
  return calcUnitPriceCents(p.totalFee, p.grantHours);
}

/**
 * 从已付课包 FIFO 分配课时，返回每节单价快照
 */
async function allocateLessonUnits(db, { phone, venueId, lessonKey, hoursNeeded }) {
  const ph = String(phone || '').trim();
  const vid = String(venueId || '').trim();
  const lk = String(lessonKey || '').trim();
  const need = Math.floor(Number(hoursNeeded) || 0);
  if (!ph || !vid || !lk || need <= 0) {
    return { ok: false, errMsg: '分配课时参数无效' };
  }

  const hit = await db
    .collection('db_course_purchase')
    .where({ phone: ph, venueId: vid, lessonKey: lk, status: 'paid' })
    .limit(100)
    .get();

  const rows = (hit.data || []).slice().sort((a, b) => {
    const ta = Number(a.paidAt) || Number(a.createdAt) || 0;
    const tb = Number(b.paidAt) || Number(b.createdAt) || 0;
    return ta - tb;
  });

  let left = need;
  const lessonUnits = [];
  const purchaseUpdates = [];

  for (let i = 0; i < rows.length && left > 0; i += 1) {
    const p = rows[i];
    const rem = purchaseRemainingHours(p);
    if (rem <= 0) continue;
    const take = Math.min(left, rem);
    const unitCents = purchaseUnitPriceCents(p);
    for (let j = 0; j < take; j += 1) {
      lessonUnits.push({
        purchaseId: p._id != null ? String(p._id) : '',
        unitPriceCents: unitCents,
      });
    }
    purchaseUpdates.push({ purchaseId: p._id, remainingHours: rem - take });
    left -= take;
  }

  if (left > 0) {
    return { ok: false, errMsg: '课包剩余课时不足，无法分配单价' };
  }

  const lessonValueCents = lessonUnits.reduce(
    (sum, u) => sum + Math.floor(Number(u.unitPriceCents) || 0),
    0,
  );

  return { ok: true, lessonUnits, lessonValueCents, purchaseUpdates };
}

async function applyPurchaseRemainingUpdates(db, purchaseUpdates, now) {
  const ts = now != null ? now : Date.now();
  for (let i = 0; i < (purchaseUpdates || []).length; i += 1) {
    const u = purchaseUpdates[i];
    if (!u || !u.purchaseId) continue;
    await db
      .collection('db_course_purchase')
      .doc(String(u.purchaseId))
      .update({
        data: {
          remainingHours: Math.max(0, Math.floor(Number(u.remainingHours) || 0)),
          updatedAt: ts,
        },
      });
  }
}

async function restorePurchaseHoursFromUnits(db, booking, now) {
  const units = Array.isArray(booking.lessonUnits) ? booking.lessonUnits : [];
  if (units.length === 0) return;
  const ts = now != null ? now : Date.now();
  const byPurchase = {};
  units.forEach((u) => {
    const pid = u && u.purchaseId != null ? String(u.purchaseId).trim() : '';
    if (!pid) return;
    byPurchase[pid] = (byPurchase[pid] || 0) + 1;
  });
  const ids = Object.keys(byPurchase);
  for (let i = 0; i < ids.length; i += 1) {
    const pid = ids[i];
    const add = byPurchase[pid];
    try {
      const doc = await db.collection('db_course_purchase').doc(pid).get();
      const row = doc.data;
      if (!row) continue;
      const cur = purchaseRemainingHours(row);
      const gh = Math.floor(Number(row.grantHours) || 0);
      const next = Math.min(gh, cur + add);
      await db.collection('db_course_purchase').doc(pid).update({
        data: { remainingHours: next, updatedAt: ts },
      });
    } catch (e) {
      console.error('restorePurchaseHoursFromUnits', pid, e);
    }
  }
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
  isExperienceLessonKey,
  purchaseRemainingHours,
  purchaseUnitPriceCents,
  allocateLessonUnits,
  applyPurchaseRemainingUpdates,
  restorePurchaseHoursFromUnits,
  lessonHoursForBooking,
  lessonValueCentsForBooking,
};
