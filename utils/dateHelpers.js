/** 根据 YYYY-MM-DD 判断是否为周六(6)或周日(0) */
function isWeekendDateStr(dateStr) {
  const parts = String(dateStr || '').split('-');
  if (parts.length !== 3) return false;
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10) - 1;
  const d = parseInt(parts[2], 10);
  if (Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) return false;
  const wd = new Date(y, m, d).getDay();
  return wd === 0 || wd === 6;
}

module.exports = {
  isWeekendDateStr,
};
