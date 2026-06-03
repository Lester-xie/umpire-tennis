/**
 * 昂湃网球学练馆 · 团购验券规则
 * platform: 1 美团，2 抖音（与 open.elys.cn Hexiao V2 一致）
 * 除 1 小时发球机券需管理员协助外，其余券可自助验券；入账规则由套餐标题推断。
 */

const PLATFORM_MEITUAN = 1;
const PLATFORM_DOUYIN = 2;

const ADMIN_VERIFY_MSG =
  '该券为1小时发球机团购，暂不支持自助验券，请联系场馆工作人员协助验券';

function normId(v) {
  if (v == null || v === '') return '';
  return String(v).trim();
}

function normalizePlatform(v) {
  const n = Math.floor(Number(v));
  if (n === PLATFORM_MEITUAN || n === PLATFORM_DOUYIN) return n;
  return 0;
}

function platformLabel(platform) {
  if (platform === PLATFORM_DOUYIN) return '抖音';
  if (platform === PLATFORM_MEITUAN) return '美团';
  return '团购';
}

function isBallMachineTitle(title) {
  return String(title || '').indexOf('发球机') >= 0;
}

/** 10h/12h 等多小时发球机包 */
function isMultiHourBallMachineTitle(title) {
  const t = String(title || '');
  if (!isBallMachineTitle(t)) return false;
  return /(?:1[02]|十二|十)\s*小时|十小时发球机|12\s*小时|10\s*小时/i.test(t);
}

/** 1 小时发球机券：需管理员协助验券 */
function isBallMachine1HourVoucher(title) {
  const t = String(title || '').trim();
  if (!isBallMachineTitle(t)) return false;
  if (isMultiHourBallMachineTitle(t)) return false;
  if (/(?:^|[^0-9])1\s*小时|1\s*h\b|1H|一小时/i.test(t)) return true;
  return parseHoursFromTitle(t) === 1;
}

function findShopDeal({ dealId, dealGroupId, shopDeals }) {
  const did = normId(dealId);
  const dg = normId(dealGroupId);
  const list = Array.isArray(shopDeals) ? shopDeals : [];
  for (let i = 0; i < list.length; i += 1) {
    const row = list[i];
    if (!row) continue;
    if (did && normId(row.dealId) === did) return row;
    if (dg && normId(row.dealGroupId) === dg) return row;
  }
  return null;
}

function parseHoursFromTitle(title) {
  const t = String(title || '');
  if (/十小时.*(?:赠|送).*(?:两|2)\s*小时|10\s*小时.*(?:赠|送)/i.test(t)) return 12;
  if (/十二\s*小时|12\s*小时/i.test(t)) return 12;
  if (/十\s*小时|10\s*小时/i.test(t)) return 10;
  const zhMatch = t.match(/([一二三四五六七八九十两]+)\s*小时/);
  if (zhMatch) {
    const n = parseChineseNumber(zhMatch[1]);
    if (n > 0) return n;
  }
  const numMatch = t.match(/(\d+)\s*小时/);
  if (numMatch) return Number(numMatch[1]);
  const hMatch = t.match(/(\d+)\s*h\b/i);
  if (hMatch) return Number(hMatch[1]);
  if (/一小时|1\s*小时/i.test(t)) return 1;
  return 1;
}

function parseChineseNumber(s) {
  const map = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  const str = String(s || '').trim();
  if (!str) return 0;
  if (str === '十') return 10;
  if (str.indexOf('十') === 0 && str.length > 1) return 10 + (map[str[1]] || 0);
  if (str.indexOf('十') === str.length - 1) return (map[str[0]] || 0) * 10;
  return map[str] || 0;
}

/** 从套餐标题推断入账规则（不依赖固定 deal 白名单） */
function inferGrantFromTitle(title) {
  const t = String(title || '').trim();
  const grantHours = parseHoursFromTitle(t);

  if (/体验/.test(t)) {
    return {
      kind: 'experience',
      lessonKey: 'experience:1v1',
      grantHours,
      label: t || '体验课',
    };
  }
  if (/发球机/.test(t)) {
    return {
      kind: 'court',
      lessonKey: 'court:ball_machine',
      grantHours,
      label: t || '发球机订场',
    };
  }
  return {
    kind: 'regular',
    lessonKey: 'regular:1v1',
    grantHours,
    label: t || '正课课时',
  };
}

function evaluatePrepareDeal({ dealId, dealGroupId, title, platform, shopDeals }) {
  const shopDeal = findShopDeal({ dealId, dealGroupId, shopDeals });
  const resolvedTitle = String(title || '').trim() || (shopDeal && shopDeal.title) || '';

  if (isBallMachine1HourVoucher(resolvedTitle)) {
    return {
      ok: false,
      errMsg: ADMIN_VERIFY_MSG,
      blocked: true,
      reason: 'ball_machine_1h',
      dealTitle: resolvedTitle,
    };
  }

  const grant = inferGrantFromTitle(resolvedTitle);
  return {
    ok: true,
    grant: {
      kind: grant.kind,
      lessonKey: grant.lessonKey,
      grantHours: grant.grantHours,
      label: grant.label,
      platform: normalizePlatform(platform),
    },
    dealTitle: resolvedTitle,
  };
}

module.exports = {
  PLATFORM_MEITUAN,
  PLATFORM_DOUYIN,
  ADMIN_VERIFY_MSG,
  normalizePlatform,
  platformLabel,
  isBallMachine1HourVoucher,
  findShopDeal,
  inferGrantFromTitle,
  evaluatePrepareDeal,
};
