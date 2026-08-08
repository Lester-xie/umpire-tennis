/**
 * 时段约定：
 * - DB / priceList / bookedSlots.slotIndex：0 = 8:00（历史不变）
 * - 会员可预约展示：10:00 开始至 22:00 结束（最后一格 21:00–22:00）
 */
const SLOT_DATA_BASE_HOUR = 8;
const BOOKING_START_HOUR = 10;
const BOOKING_LAST_START_HOUR = 21;
const BOOKING_END_HOUR = 22;

function buildBookingTimeSlots() {
  const timeSlots = [];
  for (let hour = BOOKING_START_HOUR; hour <= BOOKING_LAST_START_HOUR; hour += 1) {
    const hourStr = hour < 10 ? `0${hour}` : `${hour}`;
    timeSlots.push({
      time: `${hourStr}:00`,
      hour,
      /** 与 priceList / 订单 bookedSlots 对齐的绝对下标 */
      slotIndex: hour - SLOT_DATA_BASE_HOUR,
    });
  }
  return timeSlots;
}

function hourToSlotIndex(hour) {
  const h = Math.floor(Number(hour));
  if (!Number.isFinite(h)) return NaN;
  return h - SLOT_DATA_BASE_HOUR;
}

function slotIndexToHour(slotIndex) {
  const idx = Math.floor(Number(slotIndex));
  if (!Number.isFinite(idx)) return NaN;
  return SLOT_DATA_BASE_HOUR + idx;
}

/** 在场地 slots 数组中按 DB slotIndex 查找（数组可能只含可预约时段） */
function findCourtSlot(courtOrSlots, slotIndex) {
  const slots = Array.isArray(courtOrSlots)
    ? courtOrSlots
    : courtOrSlots && Array.isArray(courtOrSlots.slots)
      ? courtOrSlots.slots
      : null;
  if (!slots) return null;
  const idx = Number(slotIndex);
  if (!Number.isFinite(idx)) return null;
  return slots.find((s) => Number(s.slotIndex) === idx) || null;
}

module.exports = {
  SLOT_DATA_BASE_HOUR,
  BOOKING_START_HOUR,
  BOOKING_LAST_START_HOUR,
  BOOKING_END_HOUR,
  buildBookingTimeSlots,
  hourToSlotIndex,
  slotIndexToHour,
  findCourtSlot,
};
