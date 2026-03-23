/** 与 venue.courtList[].priceList 对齐：14 个时段，8:00–21:00 开始（至 22:00 结束） */
function buildBookingTimeSlots() {
  const timeSlots = [];
  for (let hour = 8; hour <= 21; hour += 1) {
    const hourStr = hour < 10 ? `0${hour}` : `${hour}`;
    timeSlots.push({
      time: `${hourStr}:00`,
      hour,
    });
  }
  return timeSlots;
}

module.exports = {
  buildBookingTimeSlots,
};
