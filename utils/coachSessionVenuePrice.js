/**
 * 教练占用：会员支付价为「按场次一次」，与占用连续小时数无关。
 * getBookedSlots 的 meta.memberPricePerSlotYuan 实为场次价（历史字段名保留）。
 * 生成格子后：合并块内仅首格 venueSlotPrice = 场次价，后续格为 0，避免订单按格累加。
 */
function sessionMemberPriceFromMeta(meta) {
  if (!meta) return null;
  const raw =
    meta.memberPricePerSessionYuan != null
      ? meta.memberPricePerSessionYuan
      : meta.memberPricePerSlotYuan;
  if (raw == null || String(raw).trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * @param {object[]} slots 单场地列，须已执行 applyCoachHoldMergeAndLayout
 * @param {number} courtId
 * @param {Record<string, object>} coachHoldMeta
 */
function applyCoachSessionFlatVenuePrice(slots, courtId, coachHoldMeta) {
  const m = coachHoldMeta || {};
  const n = slots.length;
  for (let i = 0; i < n; i += 1) {
    if (slots[i].coachMergeSkip) continue;
    if (!slots[i].bookedByCoach) continue;
    const sessionYuan = sessionMemberPriceFromMeta(m[`${courtId}-${i}`]);
    if (sessionYuan == null) continue;
    const span = slots[i].coachSpan || 1;
    slots[i].venueSlotPrice = sessionYuan;
    for (let k = 1; k < span; k += 1) {
      if (i + k < n) slots[i + k].venueSlotPrice = 0;
    }
  }
}

module.exports = {
  sessionMemberPriceFromMeta,
  applyCoachSessionFlatVenuePrice,
};
