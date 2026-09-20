const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const BATCH = 100;
const IN_BATCH = 20;

function isStaffUser(u) {
  return !!(u && u.isManager);
}

async function assertStaffCaller(openid) {
  const res = await db.collection('db_user').where({ _openid: openid }).limit(1).get();
  const u = res.data && res.data[0];
  if (!isStaffUser(u)) return null;
  return u;
}

function roundYuan(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function venueIdVariants(raw) {
  const s = String(raw || '').trim();
  if (!s) return [];
  const out = new Set([s]);
  const n = Number(s);
  if (Number.isFinite(n)) out.add(n);
  return [...out];
}

/** 分页拉取集合全部文档（可选 where） */
async function fetchAllDocs(collectionName, whereCond) {
  const col = db.collection(collectionName);
  const rows = [];
  let skip = 0;
  for (;;) {
    let q = whereCond ? col.where(whereCond) : col;
    const res = await q.skip(skip).limit(BATCH).get();
    const chunk = res.data || [];
    rows.push(...chunk);
    if (chunk.length < BATCH) break;
    skip += BATCH;
    if (skip > 5000) break;
  }
  return rows;
}

async function buildVenueNameMap() {
  const venues = await fetchAllDocs('db_venue');
  const map = {};
  venues.forEach((v) => {
    const id = v._id != null ? String(v._id).trim() : '';
    const name = v.name != null ? String(v.name).trim() : '';
    if (id) map[id] = name || id;
  });
  return map;
}

async function buildUserNameMap(phones) {
  const unique = [...new Set(phones.map((p) => String(p || '').trim()).filter((p) => /^1\d{10}$/.test(p)))];
  const map = {};
  for (let i = 0; i < unique.length; i += IN_BATCH) {
    const batch = unique.slice(i, i + IN_BATCH);
    const res = await db
      .collection('db_user')
      .where({ phone: _.in(batch) })
      .limit(BATCH)
      .get();
    (res.data || []).forEach((u) => {
      const phone = u.phone != null ? String(u.phone).trim() : '';
      if (!phone) return;
      const name = u.name != null ? String(u.name).trim() : '';
      map[phone] = name;
    });
  }
  return map;
}

/**
 * event: { type: 'balance' | 'session_card' | 'course_hours', venueId?: string }
 */
exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  if (!openid) return { ok: false, errMsg: '未登录', data: [] };

  const admin = await assertStaffCaller(openid);
  if (!admin) return { ok: false, errMsg: '无权限', data: [] };

  const type = String((event && event.type) || '').trim();
  if (!['balance', 'session_card', 'course_hours'].includes(type)) {
    return { ok: false, errMsg: '查询类型无效', data: [] };
  }

  const venueIdFilter = String((event && event.venueId) || '').trim();
  let whereCond = null;
  if (venueIdFilter) {
    const variants = venueIdVariants(venueIdFilter);
    whereCond = variants.length === 1 ? { venueId: variants[0] } : { venueId: _.in(variants) };
  }

  try {
    let collectionName = 'db_member_venue_balance';
    if (type === 'session_card') collectionName = 'db_member_venue_session_card';
    if (type === 'course_hours') collectionName = 'db_member_course_hours';

    const rawRows = await fetchAllDocs(collectionName, whereCond);
    const venueNameMap = await buildVenueNameMap();

    let list = [];
    if (type === 'balance') {
      list = rawRows
        .map((row) => {
          const balanceYuan = roundYuan(row.balanceYuan);
          return {
            phone: row.phone != null ? String(row.phone).trim() : '',
            venueId: row.venueId != null ? String(row.venueId).trim() : '',
            balanceYuan,
            remaining: balanceYuan,
          };
        })
        .filter((r) => r.phone && r.remaining > 0);
    } else if (type === 'session_card') {
      list = rawRows
        .map((row) => {
          const remainingTimes = Math.max(0, Math.floor(Number(row.remainingTimes) || 0));
          return {
            phone: row.phone != null ? String(row.phone).trim() : '',
            venueId: row.venueId != null ? String(row.venueId).trim() : '',
            remainingTimes,
            remaining: remainingTimes,
          };
        })
        .filter((r) => r.phone && r.remaining > 0);
    } else {
      list = rawRows
        .map((row) => {
          const hours = Math.max(0, Math.floor(Number(row.hours) || 0));
          return {
            phone: row.phone != null ? String(row.phone).trim() : '',
            venueId: row.venueId != null ? String(row.venueId).trim() : '',
            lessonKey: row.lessonKey != null ? String(row.lessonKey).trim() : '',
            hours,
            remaining: hours,
            unitPriceYuan: roundYuan(row.unitPriceYuan),
          };
        })
        .filter((r) => r.phone && r.remaining > 0);
    }

    const userNameMap = await buildUserNameMap(list.map((r) => r.phone));

    const data = list
      .map((r) => {
        const name = userNameMap[r.phone] || '';
        const venueName = venueNameMap[r.venueId] || r.venueId || '未知场馆';
        return {
          ...r,
          name,
          displayName: name || r.phone,
          venueName,
        };
      })
      .sort((a, b) => {
        const va = a.venueName.localeCompare(b.venueName, 'zh');
        if (va !== 0) return va;
        const na = (a.name || a.phone).localeCompare(b.name || b.phone, 'zh');
        if (na !== 0) return na;
        if (type === 'course_hours') {
          return String(a.lessonKey || '').localeCompare(String(b.lessonKey || ''));
        }
        return b.remaining - a.remaining;
      });

    return { ok: true, data, type };
  } catch (e) {
    console.error('adminListMemberAssets', e);
    return { ok: false, errMsg: e.message || '查询失败', data: [] };
  }
};
