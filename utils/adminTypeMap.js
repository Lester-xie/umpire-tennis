/**
 * db_course.typeMap 与管理员可视化行数据互转。
 * 结构：外层键 = 上课形式（如 1V1）；内层键 = 课时/节数规格，值为单价（元）。
 */

function sortFormatKeys(keys) {
  return [...keys].sort((a, b) => String(a).localeCompare(String(b), 'zh-CN'));
}

function sortSessionKeys(inner) {
  if (!inner || typeof inner !== 'object') return [];
  return Object.keys(inner).sort((a, b) => {
    const na = Number(a);
    const nb = Number(b);
    if (
      Number.isFinite(na) &&
      Number.isFinite(nb) &&
      String(na) === String(a).trim() &&
      String(nb) === String(b).trim()
    ) {
      return na - nb;
    }
    return String(a).localeCompare(String(b), 'zh-CN');
  });
}

function parsePriceRaw(raw) {
  const n = Number(String(raw != null ? raw : '').replace(/,/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** 默认一行一规格，便于新建课程 */
function defaultTypeMapRows() {
  return [
    {
      formatKey: '1V1',
      sessions: [{ sessionKey: '1', price: '0' }],
    },
  ];
}

/**
 * @param {object|null|undefined} tm
 * @returns {Array<{ formatKey: string, sessions: Array<{ sessionKey: string, price: string }> }>}
 */
function typeMapToRows(tm) {
  if (!tm || typeof tm !== 'object' || Array.isArray(tm)) {
    return defaultTypeMapRows();
  }
  const formatKeys = sortFormatKeys(Object.keys(tm));
  if (formatKeys.length === 0) {
    return defaultTypeMapRows();
  }
  return formatKeys.map((fk) => {
    const inner = tm[fk];
    const sessions = [];
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
      sortSessionKeys(inner).forEach((sk) => {
        const p = parsePriceRaw(inner[sk]);
        sessions.push({
          sessionKey: String(sk),
          price: String(p),
        });
      });
    }
    if (sessions.length === 0) {
      sessions.push({ sessionKey: '1', price: '0' });
    }
    return {
      formatKey: String(fk),
      sessions,
    };
  });
}

/**
 * @param {Array<{ formatKey: string, sessions: Array<{ sessionKey: string, price: string }> }>} rows
 * @returns {object}
 */
function rowsToTypeMap(rows) {
  const out = Object.create(null);
  (rows || []).forEach((row) => {
    const fk = String(row.formatKey || '').trim();
    if (!fk) return;
    const inner = Object.create(null);
    (row.sessions || []).forEach((s) => {
      const sk = String(s.sessionKey != null ? s.sessionKey : '').trim();
      if (!sk) return;
      inner[sk] = parsePriceRaw(s.price);
    });
    if (Object.keys(inner).length > 0) {
      out[fk] = inner;
    }
  });
  return out;
}

module.exports = {
  defaultTypeMapRows,
  typeMapToRows,
  rowsToTypeMap,
};
