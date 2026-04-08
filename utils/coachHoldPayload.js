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
  minParticipants,
  maxParticipants,
  refundHoursBeforeStart,
}) {
  const base = {
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
  if (lessonType === 'group' || lessonType === 'open_play') {
    base.minParticipants = minParticipants;
    base.maxParticipants = maxParticipants;
    base.refundHoursBeforeStart = refundHoursBeforeStart;
  }
  return base;
}

function buildUpdateCoachHoldsPayload({
  holdIds,
  lessonType,
  pairMode,
  groupMode,
  scaleDisplayName,
  capacityLimit,
  minParticipants,
  maxParticipants,
  refundHoursBeforeStart,
}) {
  const base = {
    holdIds,
    lessonType,
    pairMode,
    groupMode,
    scaleDisplayName,
    capacityLimit,
  };
  if (lessonType === 'group' || lessonType === 'open_play') {
    base.minParticipants = minParticipants;
    base.maxParticipants = maxParticipants;
    base.refundHoursBeforeStart = refundHoursBeforeStart;
  }
  return base;
}

module.exports = {
  buildCoachHoldSlotsPayload,
  buildUpdateCoachHoldsPayload,
};
