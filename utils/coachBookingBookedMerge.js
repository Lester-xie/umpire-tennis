const { venueIdLooseEqual } = require('./venueId');
const { normalizeOrderDateStr } = require('./bookingDate');

/**
 * 合并 getBookedSlots 与 listCoachHolds，得到格子键集合与 coachHold 元数据。
 * @param {{ keys?: string[], coachHoldMeta?: object }} bookedResult getBookedSlots 云函数 result
 * @param {object[]} holdRows listCoachHolds 的 data
 * @param {string|number} venueId
 * @param {string} normDate normalizeOrderDateStr(orderDate)
 */
function mergeBookedSlotsAndCoachHolds(bookedResult, holdRows, venueId, normDate) {
  const r = bookedResult && typeof bookedResult === 'object' ? bookedResult : {};
  const keys = Array.isArray(r.keys) ? r.keys : [];
  const keySet = new Set(keys);
  const coachHoldMeta = {
    ...(r.coachHoldMeta &&
    typeof r.coachHoldMeta === 'object' &&
    !Array.isArray(r.coachHoldMeta)
      ? r.coachHoldMeta
      : {}),
  };

  const rows = Array.isArray(holdRows) ? holdRows : [];
  const myHoldIdSet = new Set();

  rows.forEach((row) => {
    if (!row) return;
    const st = String(row.status || '');
    if (!['active', 'released'].includes(st)) return;
    if (!venueIdLooseEqual(row.venueId, venueId)) return;
    if (normalizeOrderDateStr(row.orderDate) !== normDate) return;
    const cid = Number(row.courtId);
    const idx = Number(row.slotIndex);
    if (!Number.isFinite(cid) || !Number.isFinite(idx)) return;
    myHoldIdSet.add(String(row._id));
    keySet.add(`${cid}-${idx}`);
    const k = `${cid}-${idx}`;
    const cur = coachHoldMeta[k] || {};
    coachHoldMeta[k] = {
      ...cur,
      holdId: String(row._id),
      sessionHoldIds:
        cur.sessionHoldIds && cur.sessionHoldIds.length > 0
          ? cur.sessionHoldIds
          : [String(row._id)],
      capacityLabel:
        (row.capacityLabel && String(row.capacityLabel).trim()) ||
        cur.capacityLabel ||
        '教练占用',
      coachName:
        (row.coachName != null && String(row.coachName).trim()) ||
        (cur.coachName != null && String(cur.coachName).trim()) ||
        '',
      lessonType: row.lessonType,
      pairMode: row.pairMode,
      groupMode: row.groupMode,
    };
  });

  return { keySet, coachHoldMeta, myHoldIdSet };
}

module.exports = {
  mergeBookedSlotsAndCoachHolds,
};
