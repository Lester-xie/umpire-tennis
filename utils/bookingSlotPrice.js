const { isWeekendDateStr } = require('./dateHelpers');

/**
 * @param {Array} courtList venue.courtList
 * @param {{ useVipPrices?: boolean }} [options] VIP 用户用 court.vipPriceList，缺省时回退 priceList
 * @returns {Record<string, number>} key `courtId-slotIndex`
 */
function buildSlotPriceMapFromCourtList(courtList, options = {}) {
  const { useVipPrices = false } = options;
  const priceMap = {};
  if (!Array.isArray(courtList) || courtList.length === 0) {
    return priceMap;
  }
  courtList.forEach((court, cIdx) => {
    const courtId = cIdx + 1;
    let prices = court.priceList || [];
    if (useVipPrices && Array.isArray(court.vipPriceList) && court.vipPriceList.length > 0) {
      prices = court.vipPriceList;
    }
    prices.forEach((price, slotIndex) => {
      const normalizedPrice = typeof price === 'number' ? price : Number(price);
      if (Number.isFinite(normalizedPrice)) {
        priceMap[`${courtId}-${slotIndex}`] = normalizedPrice;
      }
    });
  });
  return priceMap;
}

/**
 * 周六日 specialPrice（仅非 VIP），否则 slotPriceMap（订场与教练占场共用）。
 * VIP 用户不按常规周末一口价，走 vipPriceList 映射。
 */
function resolveCourtSlotPrice(courtList, courtId, slotIndex, selectedDate, slotPriceMap, options = {}) {
  const { isVipUser = false } = options;
  const list = Array.isArray(courtList) ? courtList : [];
  const court = list[courtId - 1];

  if (court && isWeekendDateStr(selectedDate) && !isVipUser) {
    const sp = court.specialPrice;
    if (sp != null && sp !== '') {
      const n = typeof sp === 'number' ? sp : Number(sp);
      if (Number.isFinite(n) && n >= 0) {
        return n;
      }
    }
  }
  if (!slotPriceMap) return null;
  const key = `${courtId}-${slotIndex}`;
  const price = slotPriceMap[key];
  if (price == null) return null;
  return Number(price);
}

module.exports = {
  buildSlotPriceMapFromCourtList,
  resolveCourtSlotPrice,
};
