const { memberCancelButtonVisible, bookingStatusLabel } = require('./bookingCancelRules');

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
    statusLabel: bookingStatusLabel(order.status),
    showCancelBooking: memberCancelButtonVisible(order),
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
  buildCourtOrderDisplay,
  formatGoodsOrderTime,
};
