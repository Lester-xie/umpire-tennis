/** 会员自助取消：须不晚于场次首场开始前 6 小时（与云函数 cancelMemberBooking 一致） */
const MEMBER_CANCEL_LEAD_MS = 6 * 60 * 60 * 1000;

function minSlotIndexFromBookedSlots(bookedSlots) {
  const arr = Array.isArray(bookedSlots) ? bookedSlots : [];
  let min = 999;
  arr.forEach((s) => {
    const i = Number(s.slotIndex);
    if (Number.isFinite(i)) min = Math.min(min, i);
  });
  return min === 999 ? null : min;
}

function sessionStartMsFromOrderDateAndMinSlot(orderDate, minSlotIndex) {
  if (minSlotIndex == null || !orderDate) return null;
  const p = String(orderDate)
    .split('-')
    .map((x) => parseInt(x, 10));
  if (p.length !== 3) return null;
  const hour = 8 + minSlotIndex;
  const iso = `${p[0]}-${String(p[1]).padStart(2, '0')}-${String(p[2]).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00+08:00`;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * 是否允许会员点击「取消订单」（最终以后端 cancelMemberBooking 为准）
 */
function memberCancelButtonVisible(order, nowMs) {
  const t = nowMs != null ? nowMs : Date.now();
  const st = String(order.status || '');
  if (!['paid', 'pending', 'payment_confirming'].includes(st)) return false;
  const minIdx = minSlotIndexFromBookedSlots(order.bookedSlots);
  if (minIdx == null) return true;
  const start = sessionStartMsFromOrderDateAndMinSlot(order.orderDate, minIdx);
  if (start == null) return true;
  if (t >= start) return false;
  return start - t >= MEMBER_CANCEL_LEAD_MS;
}

function bookingStatusLabel(status) {
  const s = String(status || '');
  if (s === 'paid') return '已支付';
  if (s === 'pending') return '待支付';
  if (s === 'payment_confirming') return '支付确认中';
  if (s === 'cancelled') return '已取消';
  if (s === 'conflict') return '异常';
  return s || '';
}

module.exports = {
  memberCancelButtonVisible,
  bookingStatusLabel,
  sessionStartMsFromOrderDateAndMinSlot,
  minSlotIndexFromBookedSlots,
  MEMBER_CANCEL_LEAD_MS,
};
