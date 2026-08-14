const { roundYuan, formatYuanText } = require('./storedValuePlans');

function extractSessionCardPlans(venue) {
  if (!venue || typeof venue !== 'object') return [];
  const raw = venue.sessionCardPlans;
  return Array.isArray(raw) ? raw : [];
}

function normalizePlanRow(row) {
  if (!row || typeof row !== 'object') return null;
  const payYuan = roundYuan(row.payYuan);
  const grantTimes = Math.floor(Number(row.grantTimes));
  if (payYuan <= 0 || !Number.isFinite(grantTimes) || grantTimes < 1) return null;
  if (grantTimes > 9999) return null;
  return {
    payYuan,
    grantTimes,
    enabled: row.enabled !== false,
  };
}

function activeSessionCardPlans(venue) {
  return extractSessionCardPlans(venue)
    .map(normalizePlanRow)
    .filter(Boolean)
    .filter((p) => p.enabled);
}

function planDisplayLabel(plan) {
  const pay = roundYuan(plan && plan.payYuan);
  const times = Math.floor(Number(plan && plan.grantTimes) || 0);
  if (pay <= 0 || times < 1) return '';
  return `${formatYuanText(pay)} 元 · ${times} 次（每次 1 小时）`;
}

function rowsFromPlans(list) {
  const raw = extractSessionCardPlans({ sessionCardPlans: list });
  if (raw.length === 0) {
    return [{ payYuan: '', grantTimes: '', enabled: true }];
  }
  return raw.map((item) => ({
    payYuan: item.payYuan != null ? String(item.payYuan) : '',
    grantTimes: item.grantTimes != null ? String(item.grantTimes) : '',
    enabled: item.enabled !== false,
  }));
}

function plansFromRows(rows) {
  const out = [];
  for (let i = 0; i < (rows || []).length; i += 1) {
    const r = rows[i];
    const payYuan = roundYuan(r.payYuan);
    const grantTimes = Math.floor(Number(r.grantTimes));
    if (payYuan <= 0 && (!Number.isFinite(grantTimes) || grantTimes <= 0)) continue;
    if (payYuan <= 0 || !Number.isFinite(grantTimes) || grantTimes < 1) {
      return { ok: false, errMsg: `第 ${i + 1} 档请填写售价与次数` };
    }
    if (grantTimes > 9999) {
      return { ok: false, errMsg: `第 ${i + 1} 档次数过多` };
    }
    out.push({
      payYuan,
      grantTimes,
      enabled: r.enabled !== false,
      sort: i,
    });
  }
  return { ok: true, plans: out };
}

/**
 * 从未被券/月卡覆盖的时段中，按次序卡抵扣（1 次 = 1 小时槽位）
 */
function pickSessionCardSlots(flatSlots, vouchers, monthCardFreeSlotKey, remainingTimes) {
  const used = new Set((vouchers || []).map((v) => String(v.slotKey || '')));
  const mcKey = monthCardFreeSlotKey != null ? String(monthCardFreeSlotKey).trim() : '';
  if (mcKey) used.add(mcKey);
  const times = Math.max(0, Math.floor(Number(remainingTimes) || 0));
  const sessionCardSlotKeys = [];
  let sessionCardDeductYuan = 0;
  for (let i = 0; i < (flatSlots || []).length; i += 1) {
    if (sessionCardSlotKeys.length >= times) break;
    const s = flatSlots[i];
    const key = String(s.slotKey || '');
    if (!key || used.has(key)) continue;
    sessionCardSlotKeys.push(key);
    sessionCardDeductYuan = roundYuan(sessionCardDeductYuan + roundYuan(s.priceYuan));
  }
  return {
    sessionCardDeductTimes: sessionCardSlotKeys.length,
    sessionCardSlotKeys,
    sessionCardDeductYuan: roundYuan(sessionCardDeductYuan),
  };
}

module.exports = {
  extractSessionCardPlans,
  activeSessionCardPlans,
  planDisplayLabel,
  rowsFromPlans,
  plansFromRows,
  pickSessionCardSlots,
};
