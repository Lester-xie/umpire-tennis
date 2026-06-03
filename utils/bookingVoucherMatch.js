/** 订场团购券：时段匹配与抵扣计算（面值对比用普通价，不用 VIP 价） */

const {
  buildSlotPriceMapFromCourtList,
  resolveCourtSlotPrice,
} = require('./bookingSlotPrice');

function roundYuan(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/** 普通订场单价（priceList / 非 VIP 周末价），用于团购券面值匹配 */
function resolveRegularSlotPriceYuan(courtId, slotIndex, courtList, selectedDate) {
  const list = Array.isArray(courtList) ? courtList : [];
  if (!list.length) return 0;
  const regularMap = buildSlotPriceMapFromCourtList(list, { useVipPrices: false });
  const p = resolveCourtSlotPrice(
    list,
    courtId,
    slotIndex,
    selectedDate,
    regularMap,
    { isVipUser: false },
  );
  return roundYuan(p);
}

function buildFlatCourtSlots(bookedSlots, courts, getTimeLabel, options) {
  const opts = options && typeof options === 'object' ? options : {};
  const courtList = opts.courtList;
  const selectedDate = opts.selectedDate || '';
  const list = [];
  (bookedSlots || []).forEach((s) => {
    const courtId = Number(s.courtId);
    const slotIndex = Number(s.slotIndex);
    if (!Number.isFinite(courtId) || !Number.isFinite(slotIndex)) return;
    let priceYuan = resolveRegularSlotPriceYuan(courtId, slotIndex, courtList, selectedDate);
    if (priceYuan <= 0) {
      const court = (courts || []).find((c) => Number(c.id) === courtId);
      const slotData = court && court.slots && court.slots[slotIndex];
      priceYuan = roundYuan(slotData && slotData.price);
    }
    list.push({
      courtId,
      slotIndex,
      slotKey: `${courtId}-${slotIndex}`,
      priceYuan,
      timeLabel:
        typeof getTimeLabel === 'function' ? getTimeLabel(slotIndex) : `${slotIndex}`,
    });
  });
  return list;
}

function getUncoveredSlotPrices(flatSlots, vouchers) {
  const used = new Set((vouchers || []).map((v) => String(v.slotKey || '')));
  const prices = [];
  (flatSlots || []).forEach((s) => {
    if (used.has(s.slotKey)) return;
    if (s.priceYuan > 0) prices.push(s.priceYuan);
  });
  return [...new Set(prices.map(roundYuan))];
}

function findMatchingSlot(flatSlots, vouchers, priceYuan) {
  const used = new Set((vouchers || []).map((v) => String(v.slotKey || '')));
  const target = roundYuan(priceYuan);
  for (let i = 0; i < (flatSlots || []).length; i += 1) {
    const s = flatSlots[i];
    if (used.has(s.slotKey)) continue;
    if (Math.abs(roundYuan(s.priceYuan) - target) < 0.011) return s;
  }
  return null;
}

function recalcVoucherPayment(totalPriceYuan, vouchers) {
  const total = roundYuan(totalPriceYuan);
  const ded = (vouchers || []).reduce((sum, v) => sum + roundYuan(v.priceYuan), 0);
  const voucherDeductionYuan = roundYuan(ded);
  const cashDueYuan = roundYuan(Math.max(0, total - voucherDeductionYuan));
  return { voucherDeductionYuan, cashDueYuan };
}

module.exports = {
  roundYuan,
  resolveRegularSlotPriceYuan,
  buildFlatCourtSlots,
  getUncoveredSlotPrices,
  findMatchingSlot,
  recalcVoucherPayment,
};
