const { roundYuan, formatYuanText } = require('./storedValuePlans');

/** 月卡默认有效天数 */
const MONTH_CARD_DAYS = 30;

/** 生效时段默认：每天 10:00–12:00（含开始、不含结束整点；与可预约起始一致） */
const DEFAULT_WINDOW_START_HOUR = 10;
const DEFAULT_WINDOW_END_HOUR = 12;

/** 订场时段钟点范围（会员可预约 10–22；DB slotIndex 仍以 8 为基准） */
const SLOT_CLOCK_MIN = 10;
const SLOT_CLOCK_MAX = 22;

function extractMonthCard(venue) {
  if (!venue || typeof venue !== 'object') return null;
  const raw = venue.monthCard;
  if (!raw || typeof raw !== 'object') return null;
  return raw;
}

function normalizeWindowHour(raw, fallback) {
  let h = Math.floor(Number(raw));
  if (!Number.isFinite(h)) h = fallback;
  if (h < SLOT_CLOCK_MIN) h = SLOT_CLOCK_MIN;
  if (h > SLOT_CLOCK_MAX) h = SLOT_CLOCK_MAX;
  return h;
}

function normalizeMonthCard(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const priceYuan = roundYuan(raw.priceYuan);
  if (priceYuan <= 0) return null;
  let days = Math.floor(Number(raw.days));
  if (!Number.isFinite(days) || days < 1) days = MONTH_CARD_DAYS;
  let windowStartHour = normalizeWindowHour(raw.windowStartHour, DEFAULT_WINDOW_START_HOUR);
  let windowEndHour = normalizeWindowHour(raw.windowEndHour, DEFAULT_WINDOW_END_HOUR);
  if (windowEndHour <= windowStartHour) {
    windowStartHour = DEFAULT_WINDOW_START_HOUR;
    windowEndHour = DEFAULT_WINDOW_END_HOUR;
  }
  return {
    priceYuan,
    enabled: raw.enabled !== false,
    days,
    windowStartHour,
    windowEndHour,
  };
}

/** 首页/购买页：仅上架且价格有效 */
function activeMonthCard(venue) {
  const n = normalizeMonthCard(extractMonthCard(venue));
  if (!n || !n.enabled) return null;
  return n;
}

function formatHourLabel(hour) {
  const h = Math.floor(Number(hour));
  if (!Number.isFinite(h)) return '';
  return `${String(h).padStart(2, '0')}:00`;
}

function monthCardWindowLabel(card) {
  const n = normalizeMonthCard(card) || {
    windowStartHour: DEFAULT_WINDOW_START_HOUR,
    windowEndHour: DEFAULT_WINDOW_END_HOUR,
  };
  return `${formatHourLabel(n.windowStartHour)}–${formatHourLabel(n.windowEndHour)}`;
}

function monthCardFormFromVenue(venue) {
  const n = normalizeMonthCard(extractMonthCard(venue));
  if (!n) {
    return {
      priceYuan: '',
      enabled: true,
      days: String(MONTH_CARD_DAYS),
      windowStartHour: DEFAULT_WINDOW_START_HOUR,
      windowEndHour: DEFAULT_WINDOW_END_HOUR,
    };
  }
  return {
    priceYuan: String(n.priceYuan),
    enabled: n.enabled !== false,
    days: String(n.days || MONTH_CARD_DAYS),
    windowStartHour: n.windowStartHour,
    windowEndHour: n.windowEndHour,
  };
}

function monthCardFromForm(form) {
  const priceYuan = roundYuan(form && form.priceYuan);
  if (priceYuan <= 0) {
    return { ok: false, errMsg: '请填写有效的月卡价格' };
  }
  let days = Math.floor(Number(form && form.days));
  if (!Number.isFinite(days) || days < 1) days = MONTH_CARD_DAYS;
  if (days > 366) {
    return { ok: false, errMsg: '有效天数不能超过 366' };
  }
  let windowStartHour = normalizeWindowHour(
    form && form.windowStartHour,
    DEFAULT_WINDOW_START_HOUR,
  );
  let windowEndHour = normalizeWindowHour(
    form && form.windowEndHour,
    DEFAULT_WINDOW_END_HOUR,
  );
  if (windowEndHour <= windowStartHour) {
    return { ok: false, errMsg: '结束时间须晚于开始时间' };
  }
  return {
    ok: true,
    monthCard: {
      priceYuan,
      enabled: !(form && form.enabled === false),
      days,
      windowStartHour,
      windowEndHour,
    },
  };
}

function monthCardDisplayLabel(card) {
  const n = normalizeMonthCard(card);
  if (!n) return '';
  const d = n.days || MONTH_CARD_DAYS;
  return `月卡 ${d} 天 · ¥${formatYuanText(n.priceYuan)} · ${monthCardWindowLabel(n)}`;
}

/** slotIndex → 开始钟点（8 + index） */
function slotIndexToClockHour(slotIndex) {
  const idx = Math.floor(Number(slotIndex));
  if (!Number.isFinite(idx) || idx < 0) return NaN;
  return 8 + idx;
}

/** 时段是否落在月卡生效窗口 [start, end) */
function isSlotInMonthCardWindow(slotIndex, card) {
  const n = normalizeMonthCard(card);
  if (!n) return false;
  const hour = slotIndexToClockHour(slotIndex);
  if (!Number.isFinite(hour)) return false;
  return hour >= n.windowStartHour && hour < n.windowEndHour;
}

/**
 * 在未覆盖时段中选一格用于月卡免费（优先高价）
 * @returns {{ slotKey, courtId, slotIndex, deductYuan }|null}
 */
function pickMonthCardFreeSlot(orderSlots, vouchers, card) {
  const used = new Set((vouchers || []).map((v) => String(v.slotKey || '')));
  let best = null;
  (orderSlots || []).forEach((s) => {
    if (!s) return;
    const slotKey = String(s.slotKey || `${s.courtId}-${s.slotIndex}`);
    if (used.has(slotKey)) return;
    if (!isSlotInMonthCardWindow(s.slotIndex, card)) return;
    const deductYuan = roundYuan(s.priceYuan);
    if (deductYuan <= 0) return;
    if (!best || deductYuan > best.deductYuan) {
      best = {
        slotKey,
        courtId: Number(s.courtId),
        slotIndex: Number(s.slotIndex),
        deductYuan,
      };
    }
  });
  return best;
}

function buildHourPickerRange() {
  const labels = [];
  const values = [];
  for (let h = SLOT_CLOCK_MIN; h <= SLOT_CLOCK_MAX; h += 1) {
    labels.push(formatHourLabel(h));
    values.push(h);
  }
  return { labels, values };
}

module.exports = {
  MONTH_CARD_DAYS,
  DEFAULT_WINDOW_START_HOUR,
  DEFAULT_WINDOW_END_HOUR,
  SLOT_CLOCK_MIN,
  SLOT_CLOCK_MAX,
  roundYuan,
  formatYuanText,
  extractMonthCard,
  normalizeMonthCard,
  activeMonthCard,
  formatHourLabel,
  monthCardWindowLabel,
  monthCardFormFromVenue,
  monthCardFromForm,
  monthCardDisplayLabel,
  slotIndexToClockHour,
  isSlotInMonthCardWindow,
  pickMonthCardFreeSlot,
  buildHourPickerRange,
};
