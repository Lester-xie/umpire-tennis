function roundYuan(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function extractStoredValuePlans(venue) {
  if (!venue || typeof venue !== 'object') return [];
  const raw = venue.storedValuePlans;
  return Array.isArray(raw) ? raw : [];
}

function normalizePlanRow(row) {
  if (!row || typeof row !== 'object') return null;
  const payYuan = roundYuan(row.payYuan);
  const creditYuan = roundYuan(row.creditYuan);
  if (payYuan <= 0 || creditYuan <= 0) return null;
  if (creditYuan < payYuan) return null;
  return {
    payYuan,
    creditYuan,
    enabled: row.enabled !== false,
  };
}

function activeStoredValuePlans(venue) {
  return extractStoredValuePlans(venue)
    .map(normalizePlanRow)
    .filter(Boolean)
    .filter((p) => p.enabled);
}

function planBonusYuan(plan) {
  return roundYuan((plan && plan.creditYuan) - (plan && plan.payYuan));
}

function planDisplayLabel(plan) {
  const pay = roundYuan(plan && plan.payYuan);
  const credit = roundYuan(plan && plan.creditYuan);
  if (pay <= 0 || credit <= 0) return '';
  const bonus = roundYuan(credit - pay);
  if (bonus > 0.009) return `充 ${formatYuanText(pay)} 送 ${formatYuanText(bonus)}`;
  return `充${formatYuanText(pay)}得${formatYuanText(credit)}`;
}

function formatYuanText(v) {
  const n = roundYuan(v);
  if (Math.abs(n - Math.round(n)) < 0.001) return String(Math.round(n));
  return String(n);
}

function rowsFromPlans(list) {
  const arr = activeStoredValuePlans({ storedValuePlans: list });
  if (arr.length === 0) {
    return [{ payYuan: '', creditYuan: '', enabled: true }];
  }
  return extractStoredValuePlans({ storedValuePlans: list }).map((item) => ({
    payYuan: item.payYuan != null ? String(item.payYuan) : '',
    creditYuan: item.creditYuan != null ? String(item.creditYuan) : '',
    enabled: item.enabled !== false,
  }));
}

function plansFromRows(rows) {
  const out = [];
  for (let i = 0; i < (rows || []).length; i += 1) {
    const r = rows[i];
    const payYuan = roundYuan(r.payYuan);
    const creditYuan = roundYuan(r.creditYuan);
    if (payYuan <= 0 && creditYuan <= 0) continue;
    if (payYuan <= 0 || creditYuan <= 0) return { ok: false, errMsg: `第 ${i + 1} 档请填写充值金额与实得金额` };
    if (creditYuan < payYuan) return { ok: false, errMsg: `第 ${i + 1} 档实得金额不能小于充值金额` };
    out.push({
      payYuan,
      creditYuan,
      enabled: r.enabled !== false,
      sort: i,
    });
  }
  return { ok: true, plans: out };
}

module.exports = {
  roundYuan,
  extractStoredValuePlans,
  activeStoredValuePlans,
  planBonusYuan,
  planDisplayLabel,
  formatYuanText,
  rowsFromPlans,
  plansFromRows,
};
