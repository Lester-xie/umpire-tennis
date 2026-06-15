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

/** 普通订场：券后应付、储值抵扣、微信应付 */
function recalcCourtPlainPayment({
  totalPriceYuan,
  vouchers,
  courtPayMethod,
  storedBalanceYuan,
}) {
  const { voucherDeductionYuan, cashDueYuan } = recalcVoucherPayment(totalPriceYuan, vouchers);
  const bal = roundYuan(storedBalanceYuan);
  const method = String(courtPayMethod || 'wechat');
  let storedBalanceDeductYuan = 0;
  if (method === 'stored_balance' || method === 'mixed_balance') {
    storedBalanceDeductYuan = roundYuan(Math.min(bal, cashDueYuan));
  }
  const wechatDueYuan = roundYuan(Math.max(0, cashDueYuan - storedBalanceDeductYuan));
  return {
    voucherDeductionYuan,
    cashDueYuan,
    storedBalanceDeductYuan,
    wechatDueYuan,
  };
}

function defaultCourtPayMethod({ cashDueYuan, storedBalanceYuan }) {
  const due = roundYuan(cashDueYuan);
  const bal = roundYuan(storedBalanceYuan);
  if (bal >= due && due > 0) return 'stored_balance';
  if (bal > 0 && due > 0) return 'mixed_balance';
  return 'wechat';
}

module.exports = {
  roundYuan,
  resolveRegularSlotPriceYuan,
  buildFlatCourtSlots,
  getUncoveredSlotPrices,
  findMatchingSlot,
  recalcVoucherPayment,
  recalcCourtPlainPayment,
  defaultCourtPayMethod,
};
