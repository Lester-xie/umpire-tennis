/**
 * 是否已有「体验课」教练订场记录（与云函数体验课限购、退款规则一致）
 * bookings：来自 listBookings（含 includePending 时含待支付）
 * 仅统计已支付：待支付/未付取消不算「已参加」，避免拉起支付后取消仍被限购提示误导
 */
function hasExperienceCoachParticipation(bookings) {
  const list = Array.isArray(bookings) ? bookings : [];
  for (let i = 0; i < list.length; i += 1) {
    const b = list[i];
    if (String(b.bookingSubtype || '') !== 'coach_course') continue;
    const lk = String(b.lessonKey || '').trim().toLowerCase();
    if (!lk.startsWith('experience:')) continue;
    const st = String(b.status || '');
    if (st === 'paid') return true;
  }
  return false;
}

module.exports = {
  hasExperienceCoachParticipation,
};
