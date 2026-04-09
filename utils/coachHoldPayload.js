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
  memberPricePerSlotYuan,
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
  } else if (lessonType === 'experience' || lessonType === 'regular') {
    base.refundHoursBeforeStart = refundHoursBeforeStart;
  }
  if (memberPricePerSlotYuan != null && Number.isFinite(Number(memberPricePerSlotYuan))) {
    base.memberPricePerSlotYuan = Number(memberPricePerSlotYuan);
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
  memberPricePerSlotYuan,
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
  } else if (lessonType === 'experience' || lessonType === 'regular') {
    base.refundHoursBeforeStart = refundHoursBeforeStart;
  }
  if (memberPricePerSlotYuan !== undefined) {
    base.memberPricePerSlotYuan = memberPricePerSlotYuan;
  }
  return base;
}

module.exports = {
  buildCoachHoldSlotsPayload,
  buildUpdateCoachHoldsPayload,
};
