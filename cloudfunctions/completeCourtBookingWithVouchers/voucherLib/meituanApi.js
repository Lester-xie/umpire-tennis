const https = require('https');
const http = require('http');
const { URL } = require('url');

const DEFAULT_BASE = 'https://open.elys.cn';
const DEFAULT_PREPARE_PATH = '/api/hexiao/v2/ddzh-tuangou-receipt-prepare';
const DEFAULT_CONSUME_PATH = '/api/hexiao/v2/ddzh-tuangou-receipt-consume';

const DEFAULT_QUERY_DEALS_PATH = '/api/hexiao/v2/ddzh-tuangou-deal-queryshopdeal';

function hexiaoBaseConfig() {
  const base = String(process.env.MEITUAN_API_BASE || process.env.MEITUAN_API_BASE_URL || DEFAULT_BASE).trim();
  const preparePath = String(process.env.MEITUAN_PREPARE_PATH || DEFAULT_PREPARE_PATH).trim();
  const consumePath = String(process.env.MEITUAN_CONSUME_PATH || DEFAULT_CONSUME_PATH).trim();
  const queryDealsPath = String(process.env.MEITUAN_QUERY_DEALS_PATH || DEFAULT_QUERY_DEALS_PATH).trim();
  const authorization = buildAuthorizationHeader();
  return { base, preparePath, consumePath, queryDealsPath, authorization };
}

function shopIdForPlatform(platform) {
  const pf = Math.floor(Number(platform));
  if (pf === 2) {
    const raw =
      process.env.DOUYIN_SHOP_ID ||
      process.env.SHOP_ID ||
      process.env.MEITUAN_SHOP_ID ||
      process.env.MEITUAN_OP_POI_ID ||
      '8676243';
    return Number(raw);
  }
  const raw =
    process.env.SHOP_ID ||
    process.env.MEITUAN_SHOP_ID ||
    process.env.MEITUAN_OP_POI_ID ||
    '8676243';
  return Number(raw);
}

function meituanConfig(platform) {
  const pf = Math.floor(Number(platform));
  const baseCfg = hexiaoBaseConfig();
  return {
    ...baseCfg,
    platform: pf,
    shopId: shopIdForPlatform(pf),
  };
}

/** 环境变量 MEITUAN_AUTHORIZATION：完整 Bearer token 或仅 JWT 字符串 */
function buildAuthorizationHeader() {
  const raw = String(
    process.env.MEITUAN_AUTHORIZATION ||
      process.env.MEITUAN_BEARER_TOKEN ||
      process.env.MEITUAN_APP_AUTH_TOKEN ||
      '',
  ).trim();
  if (!raw) return '';
  if (/^bearer\s+/i.test(raw)) return raw;
  return `Bearer ${raw}`;
}

function assertHexiaoConfigured(platform) {
  const pf = Math.floor(Number(platform));
  if (pf !== 1 && pf !== 2) {
    return { ok: false, errMsg: '请选择验券平台（1=美团，2=抖音）' };
  }
  const c = meituanConfig(pf);
  if (!c.authorization) {
    return { ok: false, errMsg: '未配置 MEITUAN_AUTHORIZATION（Bearer Token）' };
  }
  if (!Number.isFinite(c.shopId) || c.shopId <= 0) {
    return {
      ok: false,
      errMsg: pf === 2 ? '未配置有效的 DOUYIN_SHOP_ID / SHOP_ID' : '未配置有效的 SHOP_ID',
    };
  }
  return { ok: true, config: c };
}

function joinUrl(base, path) {
  const b = String(base || '').replace(/\/$/, '');
  const p = String(path || '').startsWith('/') ? path : `/${path}`;
  return `${b}${p}`;
}

function postJson(urlStr, bodyObj, headersExtra) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(urlStr);
    } catch (e) {
      reject(new Error('无效 API 地址'));
      return;
    }
    const body = JSON.stringify(bodyObj || {});
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: `${u.pathname}${u.search}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          ...(headersExtra || {}),
        },
        timeout: 20000,
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          let parsed = null;
          try {
            parsed = raw ? JSON.parse(raw) : null;
          } catch (e) {
            reject(new Error(`验券 API 返回非 JSON：${raw.slice(0, 200)}`));
            return;
          }
          resolve({ statusCode: res.statusCode, parsed, raw });
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('验券 API 请求超时'));
    });
    req.write(body);
    req.end();
  });
}

function apiOk(parsed) {
  if (!parsed || typeof parsed !== 'object') return false;
  if (parsed.success === false) return false;
  if (parsed.success === true) return true;
  return parsed.code === 10000 || parsed.code === '10000';
}

function apiErrMsg(parsed, fallback) {
  if (!parsed) return fallback || '验券 API 失败';
  return (
    parsed.message ||
    parsed.msg ||
    parsed.errMsg ||
    (parsed.error && parsed.error.message) ||
    fallback ||
    '验券 API 失败'
  );
}

function pickDealFromPrepareData(data) {
  if (!data || typeof data !== 'object') {
    return { dealId: '', dealGroupId: '', ticketName: '', title: '', ticketInfo: '', price: 0, raw: data };
  }
  let dealId = '';
  let dealGroupId = '';
  if (data.dealId != null) dealId = String(data.dealId);
  if (data.dealGroupId != null) dealGroupId = String(data.dealGroupId);
  const ticketDataRaw = data.ticketData != null ? String(data.ticketData).trim() : '';
  if (ticketDataRaw) {
    try {
      const td = JSON.parse(ticketDataRaw);
      if (td && typeof td === 'object') {
        if (td.dealId != null && !dealId) dealId = String(td.dealId);
        if (td.dealGroupId != null && !dealGroupId) dealGroupId = String(td.dealGroupId);
      }
    } catch (e) {
      /* ticketData 可能非 JSON */
    }
  }
  const ticketName = data.ticketName != null ? String(data.ticketName).trim() : '';
  const title =
    ticketName ||
    (data.dealTitle != null ? String(data.dealTitle).trim() : '') ||
    (data.title != null ? String(data.title).trim() : '');
  const ticketInfo = data.ticketInfo != null ? String(data.ticketInfo) : '';
  let price = 0;
  if (data.payAmount != null) {
    const pa = Number(data.payAmount);
    price = Number.isFinite(pa) ? pa / 100 : 0;
  } else if (data.price != null) {
    price = Number(data.price);
  }
  return { dealId, dealGroupId, ticketName, title, ticketInfo, price, raw: data };
}

function pickDealFromConsumeData(root) {
  const data = root && root.data != null ? root.data : root;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') {
    return { dealId: '', dealGroupId: '', title: '', ticketInfo: '', price: 0, raw: row };
  }
  return {
    dealId: row.dealId != null ? String(row.dealId) : '',
    dealGroupId: row.dealGroupId != null ? String(row.dealGroupId) : '',
    title:
      row.dealTitle != null
        ? String(row.dealTitle)
        : row.ticketName != null
          ? String(row.ticketName)
          : '',
    ticketInfo: '',
    price: row.dealPrice != null ? Number(row.dealPrice) : 0,
    raw: row,
  };
}

async function callHexiao(path, body, config) {
  const url = joinUrl(config.base, path);
  const { parsed, statusCode } = await postJson(url, body, {
    Authorization: config.authorization,
  });
  if (!apiOk(parsed)) {
    return {
      ok: false,
      errMsg: apiErrMsg(parsed, `验券失败（HTTP ${statusCode}）`),
      raw: parsed,
      traceId: parsed && parsed.traceId ? String(parsed.traceId) : '',
    };
  }
  return {
    ok: true,
    parsed,
    traceId: parsed && parsed.traceId ? String(parsed.traceId) : '',
  };
}

function normalizeShopDealRow(row) {
  if (!row || typeof row !== 'object') return null;
  return {
    dealId: row.dealId != null ? String(row.dealId) : '',
    dealGroupId: row.dealGroupId != null ? String(row.dealGroupId) : '',
    title: row.title != null ? String(row.title).trim() : '',
    price: row.price != null ? Number(row.price) : 0,
    marketPrice: row.marketPrice != null ? Number(row.marketPrice) : 0,
    saleStatus: row.saleStatus,
  };
}

/** 门店在售团购：POST .../ddzh-tuangou-deal-queryshopdeal */
async function queryShopDeals(platform) {
  const cfgCheck = assertHexiaoConfigured(platform);
  if (!cfgCheck.ok) return cfgCheck;
  const config = cfgCheck.config;
  try {
    const res = await callHexiao(
      config.queryDealsPath,
      {
        shopId: config.shopId,
        platform: config.platform,
        offset: 1,
        limit: 50,
        source: 1,
      },
      config,
    );
    if (!res.ok) return res;
    const rawList = res.parsed && res.parsed.data;
    const deals = (Array.isArray(rawList) ? rawList : [])
      .map(normalizeShopDealRow)
      .filter(Boolean);
    return {
      ok: true,
      platform: config.platform,
      deals,
      traceId: res.traceId,
    };
  } catch (e) {
    return { ok: false, errMsg: e.message || '拉取团购列表失败' };
  }
}

/**
 * 验券前检查：POST .../ddzh-tuangou-receipt-prepare
 * body: { shopId, platform, code }
 */
async function meituanPrepare(receiptCode, platform) {
  const cfgCheck = assertHexiaoConfigured(platform);
  if (!cfgCheck.ok) return cfgCheck;
  const config = cfgCheck.config;
  const code = String(receiptCode || '').trim();
  if (!code) return { ok: false, errMsg: '请输入团购券码' };

  try {
    const res = await callHexiao(
      config.preparePath,
      {
        shopId: config.shopId,
        platform: config.platform,
        code,
      },
      config,
    );
    if (!res.ok) return res;
    const deal = pickDealFromPrepareData(res.parsed && res.parsed.data);
    return {
      ok: true,
      receiptCode: code,
      deal,
      ticketInfo: deal.ticketInfo,
      traceId: res.traceId,
      raw: res.parsed,
    };
  } catch (e) {
    return { ok: false, errMsg: e.message || '验券请求失败' };
  }
}

/**
 * 确认核销：POST .../ddzh-tuangou-receipt-consume
 * ticketInfo 须与 prepare 返回完全一致
 */
async function meituanConsume(receiptCode, ticketInfo, num, platform) {
  const cfgCheck = assertHexiaoConfigured(platform);
  if (!cfgCheck.ok) return cfgCheck;
  const config = cfgCheck.config;
  const code = String(receiptCode || '').trim();
  const ti = ticketInfo != null ? String(ticketInfo) : '';
  if (!code) return { ok: false, errMsg: '请输入团购券码' };
  if (!ti) return { ok: false, errMsg: '缺少 ticketInfo，请先查询券信息' };

  const n = Math.max(1, Math.floor(Number(num) || 1));
  try {
    const res = await callHexiao(
      config.consumePath,
      {
        shopId: config.shopId,
        platform: config.platform,
        ticketInfo: ti,
        code,
        num: n,
      },
      config,
    );
    if (!res.ok) return res;
    const deal = pickDealFromConsumeData(res.parsed);
    if (!deal.title && res.parsed && res.parsed.data) {
      const prepDeal = pickDealFromPrepareData(
        Array.isArray(res.parsed.data) ? null : res.parsed.data,
      );
      if (prepDeal.title) deal.title = prepDeal.title;
    }
    return {
      ok: true,
      receiptCode: code,
      deal,
      traceId: res.traceId,
      raw: res.parsed,
    };
  } catch (e) {
    return { ok: false, errMsg: e.message || '核销请求失败' };
  }
}

module.exports = {
  meituanConfig,
  assertHexiaoConfigured,
  queryShopDeals,
  meituanPrepare,
  meituanConsume,
};
