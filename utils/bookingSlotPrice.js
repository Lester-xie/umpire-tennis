const { isWeekendDateStr } = require('./dateHelpers');

/**
 * @param {Array} courtList venue.courtList
 * @returns {Record<string, number>} key `courtId-slotIndex`
 */
function buildSlotPriceMapFromCourtList(courtList) {
  const priceMap = {};
  if (!Array.isArray(courtList) || courtList.length === 0) {
    return priceMap;
  }
  courtList.forEach((court, cIdx) => {
    const courtId = cIdx + 1;
    const prices = court.priceList || [];
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
 * 周六日 specialPrice，否则 slotPriceMap（订场与教练占场共用）
 */
function resolveCourtSlotPrice(courtList, courtId, slotIndex, selectedDate, slotPriceMap) {
  const list = Array.isArray(courtList) ? courtList : [];
  const court = list[courtId - 1];

  if (court && isWeekendDateStr(selectedDate)) {
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
