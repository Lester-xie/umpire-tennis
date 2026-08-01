/**
 * 月卡免费 1 小时：窗口与每日额度校验（供 pay / payCallback / completeCourtBooking 共用）
 * 生效窗口 [windowStartHour, windowEndHour)，默认 9–12；每日每馆仅可免费 1 小时。
 */

const DEFAULT_WINDOW_START_HOUR = 9;
const DEFAULT_WINDOW_END_HOUR = 12;

function roundYuan(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function normalizeWindow(raw) {
  const card = raw && typeof raw === 'object' ? raw : {};
  let start = Math.floor(Number(card.windowStartHour));
  let end = Math.floor(Number(card.windowEndHour));
  if (!Number.isFinite(start)) start = DEFAULT_WINDOW_START_HOUR;
  if (!Number.isFinite(end)) end = DEFAULT_WINDOW_END_HOUR;
  if (start < 8) start = 8;
  if (end > 22) end = 22;
  if (end <= start) {
    start = DEFAULT_WINDOW_START_HOUR;
    end = DEFAULT_WINDOW_END_HOUR;
  }
  return { windowStartHour: start, windowEndHour: end };
}

function slotIndexToClockHour(slotIndex) {
  const idx = Math.floor(Number(slotIndex));
  if (!Number.isFinite(idx) || idx < 0) return NaN;
  return 8 + idx;
}

function parseSlotKey(slotKey) {
  const s = String(slotKey || '').trim();
  const m = /^(\d+)-(\d+)$/.exec(s);
  if (!m) return null;
  return { courtId: Number(m[1]), slotIndex: Number(m[2]), slotKey: s };
}

function isHourInWindow(hour, window) {
  return hour >= window.windowStartHour && hour < window.windowEndHour;
}

/**
 * @param {object} opts
 * @param {object} opts.db
 * @param {object} opts._ db.command
 * @param {string} opts.phone
 * @param {string} opts.venueId
 * @param {string} opts.orderDate
 * @param {object|null} opts.monthCardFree { slotKey, deductYuan }
 * @param {string} [opts.excludeOutTradeNo]
 */
async function assertAndNormalizeMonthCardFree(opts) {
  const db = opts.db;
  const _ = opts._;
  const phone = String(opts.phone || '').trim();
  const venueId = String(opts.venueId || '').trim();
  const orderDate = String(opts.orderDate || '').trim();
  const raw = opts.monthCardFree;
  const excludeOutTradeNo = opts.excludeOutTradeNo != null ? String(opts.excludeOutTradeNo) : '';

  if (!raw || typeof raw !== 'object') {
    return { ok: true, monthCardFree: null };
  }

  const slotKey = String(raw.slotKey || '').trim();
  const deductYuan = roundYuan(raw.deductYuan);
  if (!slotKey || deductYuan <= 0) {
    return { ok: false, errMsg: '月卡免费时段无效' };
  }
  const parsed = parseSlotKey(slotKey);
  if (!parsed) {
    return { ok: false, errMsg: '月卡免费时段无效' };
  }
  if (!phone || !venueId || !orderDate) {
    return { ok: false, errMsg: '月卡校验参数不完整' };
  }

  let venue = null;
  try {
    const venueDoc = await db.collection('db_venue').doc(venueId).get();
    venue = venueDoc && venueDoc.data ? venueDoc.data : null;
  } catch (e) {
    venue = null;
  }
  if (!venue) {
    return { ok: false, errMsg: '场馆不存在，无法校验月卡' };
  }

  const window = normalizeWindow(venue.monthCard);
  const hour = slotIndexToClockHour(parsed.slotIndex);
  if (!Number.isFinite(hour) || !isHourInWindow(hour, window)) {
    return {
      ok: false,
      errMsg: `月卡仅可在 ${String(window.windowStartHour).padStart(2, '0')}:00–${String(window.windowEndHour).padStart(2, '0')}:00 免费预订 1 小时`,
    };
  }

  const mcHit = await db
    .collection('db_member_venue_month_card')
    .where({ phone, venueId })
    .limit(1)
    .get();
  const mc = mcHit.data && mcHit.data[0] ? mcHit.data[0] : null;
  if (!mc || !(Number(mc.expiresAt) > Date.now())) {
    return { ok: false, errMsg: '月卡无效或已过期' };
  }

  const usedHit = await db
    .collection('db_booking')
    .where({
      phone,
      venueId,
      orderDate,
      status: _.in(['paid', 'pending']),
      monthCardFreeSlotKey: _.neq(''),
    })
    .limit(10)
    .get();
  const conflict = (usedHit.data || []).find((row) => {
    if (!row || !row.monthCardFreeSlotKey) return false;
    if (excludeOutTradeNo && String(row.outTradeNo || '') === excludeOutTradeNo) return false;
    return true;
  });
  if (conflict) {
    return { ok: false, errMsg: '当日月卡免费 1 小时已使用' };
  }

  return {
    ok: true,
    monthCardFree: {
      slotKey: parsed.slotKey,
      courtId: parsed.courtId,
      slotIndex: parsed.slotIndex,
      deductYuan,
    },
  };
}

module.exports = {
  DEFAULT_WINDOW_START_HOUR,
  DEFAULT_WINDOW_END_HOUR,
  roundYuan,
  normalizeWindow,
  slotIndexToClockHour,
  parseSlotKey,
  assertAndNormalizeMonthCardFree,
};
