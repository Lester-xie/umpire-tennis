const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

function isStaffUser(u) {
  return !!(u && u.isManager);
}

async function assertStaffCaller(openid) {
  const res = await db.collection('db_user').where({ _openid: openid }).limit(1).get();
  const u = res.data && res.data[0];
  if (!isStaffUser(u)) return null;
  return u;
}

/** 与订场页一致：14 个时段 8:00–21:00 */
const PRICE_SLOT_COUNT = 14;

function normalizeCourtList(raw) {
  if (!Array.isArray(raw)) {
    return { ok: false, errMsg: 'courtList 须为数组' };
  }
  if (raw.length === 0) {
    return { ok: false, errMsg: '至少保留一个场地' };
  }
  const out = [];
  for (let i = 0; i < raw.length; i += 1) {
    const c = raw[i];
    if (!c || typeof c !== 'object') {
      return { ok: false, errMsg: `第 ${i + 1} 个场地格式无效` };
    }
    const name = String(c.name || '').trim();
    if (!name) {
      return { ok: false, errMsg: `第 ${i + 1} 个场地缺少名称` };
    }
    const pl = c.priceList;
    if (!Array.isArray(pl)) {
      return { ok: false, errMsg: `场地「${name}」的 priceList 须为数组` };
    }
    const priceList = [];
    for (let j = 0; j < PRICE_SLOT_COUNT; j += 1) {
      const n = Number(pl[j]);
      priceList.push(Number.isFinite(n) && n >= 0 ? n : 0);
    }
    const item = { name, priceList };
    const vpl = c.vipPriceList;
    if (vpl != null) {
      if (!Array.isArray(vpl)) {
        return { ok: false, errMsg: `场地「${name}」的 vipPriceList 须为数组` };
      }
      const vipPriceList = [];
      for (let j = 0; j < PRICE_SLOT_COUNT; j += 1) {
        const n = Number(vpl[j]);
        vipPriceList.push(Number.isFinite(n) && n >= 0 ? n : 0);
      }
      item.vipPriceList = vipPriceList;
    }
    if (c.specialPrice != null && String(c.specialPrice).trim() !== '') {
      const sp = Number(c.specialPrice);
      if (Number.isFinite(sp) && sp >= 0) {
        item.specialPrice = sp;
      }
    }
    out.push(item);
  }
  return { ok: true, courtList: out };
}

/** category_list：教练课用途与会员默认场次价；未传 categoryList 时不覆盖库内原值 */
function normalizeCategoryList(raw) {
  if (raw === undefined) {
    return { ok: true, omit: true, list: null };
  }
  if (!Array.isArray(raw)) {
    return { ok: false, errMsg: 'categoryList 须为数组' };
  }
  const out = [];
  for (let i = 0; i < raw.length; i += 1) {
    const row = raw[i];
    if (!row || typeof row !== 'object') {
      return { ok: false, errMsg: `用途配置第 ${i + 1} 项无效` };
    }
    const name = String(row.name || '').trim();
    if (!name) {
      return { ok: false, errMsg: `用途配置第 ${i + 1} 项缺少名称` };
    }
    const item = { name };
    if (row.scaleList != null && typeof row.scaleList === 'object' && !Array.isArray(row.scaleList)) {
      const sl = {};
      Object.keys(row.scaleList).forEach((k) => {
        const n = Number(row.scaleList[k]);
        if (Number.isFinite(n) && n >= 0) sl[k] = n;
      });
      if (Object.keys(sl).length) item.scaleList = sl;
    }
    if (row.price != null && String(row.price).trim() !== '') {
      const p = Number(row.price);
      if (Number.isFinite(p) && p >= 0) item.price = p;
    }
    out.push(item);
  }
  return { ok: true, omit: false, list: out };
}

function normalizeVenuePayload(body) {
  const name = body.name != null ? String(body.name).trim() : '';
  if (!name) {
    return { ok: false, errMsg: '场馆名称必填' };
  }
  const address = body.address != null ? String(body.address).trim() : '';
  const lat = Number(body.latitude);
  const lon = Number(body.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { ok: false, errMsg: '纬度、经度须为有效数字' };
  }
  const image = body.image != null ? String(body.image).trim() : '';
  const courtNorm = normalizeCourtList(body.courtList);
  if (!courtNorm.ok) {
    return courtNorm;
  }
  const catNorm = normalizeCategoryList(body.categoryList);
  if (!catNorm.ok) {
    return catNorm;
  }
  const data = {
    name,
    address,
    latitude: lat,
    longitude: lon,
    courtList: courtNorm.courtList,
    updatedAt: Date.now(),
  };
  if (image) {
    data.image = image;
  }
  if (!catNorm.omit && catNorm.list != null) {
    data.category_list = catNorm.list;
  }
  return { ok: true, data };
}

/**
 * event.action: list | get | create | update | remove
 * get/create/update/remove 时 event.venueId 为文档 _id
 * create/update 时 event.payload 为场馆字段对象
 */
exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  if (!openid) {
    return { ok: false, errMsg: '未登录' };
  }
  const admin = await assertStaffCaller(openid);
  if (!admin) {
    return { ok: false, errMsg: '无权限' };
  }

  const action = event.action != null ? String(event.action).trim() : '';

  if (action === 'list') {
    try {
      const res = await db.collection('db_venue').get();
      const rows = (res.data || []).slice().sort((a, b) => {
        const na = String(a.name || '');
        const nb = String(b.name || '');
        return na.localeCompare(nb, 'zh-CN');
      });
      return { ok: true, data: rows };
    } catch (e) {
      console.error('adminVenue list', e);
      return { ok: false, errMsg: e.message || '读取失败' };
    }
  }

  if (action === 'get') {
    const venueId = event.venueId != null ? String(event.venueId).trim() : '';
    if (!venueId) {
      return { ok: false, errMsg: '缺少 venueId' };
    }
    try {
      const doc = await db.collection('db_venue').doc(venueId).get();
      if (!doc.data) {
        return { ok: false, errMsg: '记录不存在' };
      }
      return { ok: true, data: doc.data };
    } catch (e) {
      console.error('adminVenue get', e);
      return { ok: false, errMsg: e.message || '读取失败' };
    }
  }

  if (action === 'create') {
    const norm = normalizeVenuePayload(event.payload || {});
    if (!norm.ok) {
      return norm;
    }
    const data = { ...norm.data, createdAt: Date.now() };
    try {
      const addRes = await db.collection('db_venue').add({ data });
      return { ok: true, id: addRes._id };
    } catch (e) {
      console.error('adminVenue create', e);
      return { ok: false, errMsg: e.message || '创建失败' };
    }
  }

  if (action === 'update') {
    const venueId = event.venueId != null ? String(event.venueId).trim() : '';
    if (!venueId) {
      return { ok: false, errMsg: '缺少 venueId' };
    }
    const norm = normalizeVenuePayload(event.payload || {});
    if (!norm.ok) {
      return norm;
    }
    try {
      await db.collection('db_venue').doc(venueId).update({ data: norm.data });
      return { ok: true };
    } catch (e) {
      console.error('adminVenue update', e);
      return { ok: false, errMsg: e.message || '更新失败' };
    }
  }

  if (action === 'remove') {
    const venueId = event.venueId != null ? String(event.venueId).trim() : '';
    if (!venueId) {
      return { ok: false, errMsg: '缺少 venueId' };
    }
    try {
      await db.collection('db_venue').doc(venueId).remove();
      return { ok: true };
    } catch (e) {
      console.error('adminVenue remove', e);
      return { ok: false, errMsg: e.message || '删除失败' };
    }
  }

  return { ok: false, errMsg: '未知操作' };
};
