/** 与订场页一致：slotIndex 0 → 08:00-09:00 */
function coachSlotTimeRange(slotIndex) {
  const i = Number(slotIndex);
  if (!Number.isFinite(i) || i < 0 || i > 13) return '';
  const start = 8 + i;
  const end = start + 1;
  const pad = (n) => (n < 10 ? `0${n}` : `${n}`);
  return `${pad(start)}:00-${pad(end)}:00`;
}

function formatCoachHoldCalendarDate(orderDate) {
  const p = String(orderDate || '').split('-');
  if (p.length !== 3) return orderDate || '';
  return `${parseInt(p[1], 10)}月${parseInt(p[2], 10)}日`;
}

function buildCoachHoldRow(doc) {
  if (!doc || !doc._id) return null;
  return {
    ...doc,
    displayDate: formatCoachHoldCalendarDate(doc.orderDate),
    venueLine: doc.venueName ? String(doc.venueName) : `场馆 ${doc.venueId || ''}`,
    courtLabel: `${doc.courtId}号场`,
    timeRange: coachSlotTimeRange(doc.slotIndex),
    purposeLine: doc.capacityLabel ? String(doc.capacityLabel) : '',
  };
}

function formatBookingOrderDate(orderDate) {
  const p = String(orderDate || '').split('-');
  if (p.length !== 3) return orderDate || '';
  return `${parseInt(p[1], 10)}月${parseInt(p[2], 10)}日`;
}

function buildCourtOrderDisplay(order) {
  const parts = [];
  (order.orderItems || []).forEach((oi) => {
    const slots = (oi.timeSlots || []).map((ts) => ts.timeRange).join('、');
    if (oi.courtName && slots) {
      parts.push(`${oi.courtName} ${slots}`);
    }
  });
  const formattedDate =
    order.formattedDate || formatBookingOrderDate(order.orderDate);
  return {
    ...order,
    displaySummary: parts.join(' | ') || '场地预订',
    formattedDate,
  };
}

function formatGoodsOrderTime(timestamp) {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const h = d.getHours();
  const min = d.getMinutes();
  return `${m}月${day}日 ${h < 10 ? '0' + h : h}:${min < 10 ? '0' + min : min}`;
}

module.exports = {
  coachSlotTimeRange,
  formatCoachHoldCalendarDate,
  buildCoachHoldRow,
  buildCourtOrderDisplay,
  formatGoodsOrderTime,
};
