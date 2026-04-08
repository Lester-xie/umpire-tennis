/**
 * 团课 / 畅打：最少、最多人数；开课前 refundHoursBeforeStart 小时为退课截止，
 * 并在该时刻前检查是否达最少人数（未成班则自动取消并退款）。
 * capacityLimit 存「最多人数」
 */

function parseGroupOpenEnrollment(event, lessonType) {
  const lt = String(lessonType || '').trim();
  if (lt !== 'group' && lt !== 'open_play') {
    const capacityLimit = Math.floor(Number(event.capacityLimit));
    return {
      ok: true,
      capacityLimit: Number.isFinite(capacityLimit) && capacityLimit >= 1 ? Math.min(99, capacityLimit) : NaN,
      minParticipants: null,
      refundHoursBeforeStart: null,
    };
  }

  const minP = Math.floor(Number(event.minParticipants));
  const maxP = Math.floor(
    Number(event.maxParticipants != null ? event.maxParticipants : event.capacityLimit),
  );
  const refundH = Math.floor(Number(event.refundHoursBeforeStart));

  if (!Number.isFinite(minP) || minP < 1 || minP > 99) {
    return { ok: false, errMsg: '请填写最少参加人数（1–99）' };
  }
  if (!Number.isFinite(maxP) || maxP < minP || maxP > 99) {
    return { ok: false, errMsg: '最多人数须不少于最少人数，且不超过 99' };
  }
  if (!Number.isFinite(refundH) || refundH < 0 || refundH > 336) {
    return { ok: false, errMsg: '开课前时间须为 0–336 小时（退课截止与成团检查共用）' };
  }

  return {
    ok: true,
    capacityLimit: maxP,
    minParticipants: minP,
    refundHoursBeforeStart: refundH,
  };
}

module.exports = {
  parseGroupOpenEnrollment,
};
