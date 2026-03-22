const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

function normalizeOrderDate(raw) {
  const s = String(raw || '').trim();
  const parts = s.split('-');
  if (parts.length !== 3) return s;
  const y = parseInt(parts[0], 10);
  const mo = parseInt(parts[1], 10);
  const d = parseInt(parts[2], 10);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return s;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function venueIdInValues(venueIdRaw) {
  const s = String(venueIdRaw || '').trim();
  if (!s) return [];
  const out = new Set([s]);
  const n = Number(s);
  if (Number.isFinite(n)) out.add(n);
  return [...out];
}

function orderDateInValues(orderDateRaw, normalized) {
  const raw = String(orderDateRaw || '').trim();
  const set = new Set();
  if (normalized) set.add(normalized);
  if (raw) set.add(raw);
  return [...set];
}

/**
 * 当前教练的场地占用列表（db_coach_slot_hold）
 * event: { venueId?, orderDate?, includeReleasedForSession?: boolean }
 * 默认仅 active；教练约场页传 includeReleasedForSession + 场馆/日期 时包含 released，便于取消已有学员的场次
 */
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  if (!openid) {
    return { data: [] };
  }

  const ev = event || {};
  const venueIdRaw = ev.venueId != null ? String(ev.venueId).trim() : '';
  const orderDateRaw = ev.orderDate != null ? String(ev.orderDate).trim() : '';
  const includeReleased =
    ev.includeReleasedForSession === true ||
    ev.includeReleasedForSession === 1 ||
    ev.includeReleasedForSession === '1' ||
    ev.includeReleasedForSession === 'true';

  try {
    let res;
    if (venueIdRaw && orderDateRaw && includeReleased) {
      const norm = normalizeOrderDate(orderDateRaw);
      const venueIds = venueIdInValues(venueIdRaw);
      const dateKeys = orderDateInValues(orderDateRaw, norm);
      res = await db
        .collection('db_coach_slot_hold')
        .where({
          _openid: openid,
          venueId: _.in(venueIds),
          orderDate: _.in(dateKeys),
          status: _.in(['active', 'released']),
        })
        .get();
    } else {
      res = await db.collection('db_coach_slot_hold').where({
        _openid: openid,
        status: 'active',
      }).get();
    }

    const rows = (res.data || [])
      .sort((a, b) => {
        const ds = String(b.orderDate || '').localeCompare(String(a.orderDate || ''));
        if (ds !== 0) return ds;
        return (b.createdAt || 0) - (a.createdAt || 0);
      })
      .slice(0, 100);

    return { data: rows };
  } catch (err) {
    console.error('listCoachHolds failed', err);
    return { data: [], errMsg: err.message || String(err) };
  }
};
