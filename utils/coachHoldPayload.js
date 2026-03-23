/**
 * 教练占场云函数入参组装（页面只传业务字段，集中维护字段名与结构）
 */
function buildCoachHoldSlotsPayload({
  selectedVenueId,
  venueName,
  selectedDate,
  selectedSlots,
  lessonType,
  pairMode,
  groupMode,
  scaleDisplayName,
  capacityLimit,
}) {
  return {
    venueId: selectedVenueId,
    venueName: venueName != null ? String(venueName).trim() : '',
    orderDate: selectedDate,
    slots: selectedSlots,
    lessonType,
    pairMode,
    groupMode,
    scaleDisplayName,
    capacityLimit,
  };
}

function buildUpdateCoachHoldsPayload({
  holdIds,
  lessonType,
  pairMode,
  groupMode,
  scaleDisplayName,
  capacityLimit,
}) {
  return {
    holdIds,
    lessonType,
    pairMode,
    groupMode,
    scaleDisplayName,
    capacityLimit,
  };
}

module.exports = {
  buildCoachHoldSlotsPayload,
  buildUpdateCoachHoldsPayload,
};
