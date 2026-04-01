const { memberCancelButtonVisible, bookingStatusLabel } = require('./bookingCancelRules');

/** 与订场页一致：slotIndex 0 → 08:00-09:00 */
function coachSlotTimeRange(slotIndex) {
  const i = Number(slotIndex);
  if (!Number.isFinite(i) || i < 0 || i > 13) return '';
  const start = 8 + i;
  const end = start + 1;
  const pad = (n) => (n < 10 ? `0${n}` : `${n}`);
  return `${pad(start)}:00-${pad(end)}:00`;
}

/** 连续多格：min=0 max=1 → 08:00-10:00 */
function coachSlotTimeRangeMerged(minSlotIndex, maxSlotIndex) {
  const a = Number(minSlotIndex);
  const b = Number(maxSlotIndex);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b > 13 || a > b) return '';
  const start = 8 + a;
  const end = 8 + b + 1;
  const pad = (n) => (n < 10 ? `0${n}` : `${n}`);
  return `${pad(start)}:00-${pad(end)}:00`;
}

/** 同一次提交写入的多条 hold 共用 sessionSlotKeys（畅打/体验课/正课/团课均适用） */
function coachHoldSessionMergeKey(row) {
  if (!row) return '';
  const sk = String(row.sessionSlotKeys || '').trim();
  if (!sk) return '';
  const v = row.venueId != null ? String(row.venueId).trim() : '';
  const d = String(row.orderDate || '').trim();
  return `${v}|${d}|${sk}`;
}

function formatCoachHoldCalendarDate(orderDate) {
  const p = String(orderDate || '').split('-');
  if (p.length !== 3) return orderDate || '';
  return `${parseInt(p[1], 10)}月${parseInt(p[2], 10)}日`;
}

function buildCoachHoldRow(doc) {
  if (!doc || !doc._id) return null;
  return {
    ...doc,
    displayDate: formatCoachHoldCalendarDate(doc.orderDate),
    venueLine: doc.venueName ? String(doc.venueName) : `场馆 ${doc.venueId || ''}`,
    courtLabel: `${doc.courtId}号场`,
    timeRange: coachSlotTimeRange(doc.slotIndex),
    purposeLine: doc.capacityLabel ? String(doc.capacityLabel) : '',
  };
}

/**
 * 同一次占用（相同 sessionSlotKeys）合并为一条展示；取消时携带该次预定的全部 holdId
 * @param {object[]} rawDocs listCoachHolds 返回行
 */
function mergeCoachHoldDisplayRows(rawDocs) {
  const rows = (Array.isArray(rawDocs) ? rawDocs : []).map(buildCoachHoldRow).filter(Boolean);
  const sessionMap = new Map();
  rows.forEach((r) => {
    const sk = coachHoldSessionMergeKey(r);
    if (!sk) return;
    if (!sessionMap.has(sk)) sessionMap.set(sk, []);
    sessionMap.get(sk).push(r);
  });

  const emitted = new Set();
  const out = [];
  rows.forEach((r) => {
    const sk = coachHoldSessionMergeKey(r);
    if (!sk) {
      out.push({
        ...r,
        cancelHoldIds: [r._id],
        cancelHoldIdsStr: String(r._id),
        listKey: String(r._id),
      });
      return;
    }
    if (emitted.has(sk)) return;
    emitted.add(sk);
    const sessionRows = sessionMap.get(sk) || [r];
    if (sessionRows.length <= 1) {
      out.push({
        ...r,
        cancelHoldIds: [r._id],
        cancelHoldIdsStr: String(r._id),
        listKey: String(r._id),
      });
      return;
    }
    const indices = sessionRows.map((x) => Number(x.slotIndex)).filter(Number.isFinite);
    const minI = Math.min(...indices);
    const maxI = Math.max(...indices);
    const sorted = sessionRows.slice().sort((a, b) => Number(a.slotIndex) - Number(b.slotIndex));
    const base = sorted[0];
    const ids = sorted.map((x) => x._id);
    out.push({
      ...base,
      timeRange: coachSlotTimeRangeMerged(minI, maxI),
      cancelHoldIds: ids,
      cancelHoldIdsStr: ids.join(','),
      listKey: `sess:${sk}`,
    });
  });
  return out;
}

function formatBookingOrderDate(orderDate) {
  const p = String(orderDate || '').split('-');
  if (p.length !== 3) return orderDate || '';
  return `${parseInt(p[1], 10)}月${parseInt(p[2], 10)}日`;
}

function buildCourtOrderDisplay(order) {
  const parts = [];
  (order.orderItems || []).forEach((oi) => {
    const slots = (oi.timeSlots || []).map((ts) => ts.timeRange).join('、');
    if (oi.courtName && slots) {
      parts.push(`${oi.courtName} ${slots}`);
    }
  });
  const formattedDate =
    order.formattedDate || formatBookingOrderDate(order.orderDate);
  return {
    ...order,
    displaySummary: parts.join(' | ') || '场地预订',
    formattedDate,
    statusLabel: bookingStatusLabel(order.status),
    showCancelBooking: memberCancelButtonVisible(order),
  };
}

function formatGoodsOrderTime(timestamp) {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const h = d.getHours();
  const min = d.getMinutes();
  return `${m}月${day}日 ${h < 10 ? '0' + h : h}:${min < 10 ? '0' + min : min}`;
}

module.exports = {
  coachSlotTimeRange,
  coachSlotTimeRangeMerged,
  formatCoachHoldCalendarDate,
  buildCoachHoldRow,
  mergeCoachHoldDisplayRows,
  buildCourtOrderDisplay,
  formatGoodsOrderTime,
};
