const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

/** 锁场：日期归一化 */
function normalizeOrderDateForLock(raw) {
  const s = String(raw || '').trim();
  const parts = s.split('-');
  if (parts.length !== 3) return s;
  const y = parseInt(parts[0], 10);
  const mo = parseInt(parts[1], 10);
  const d = parseInt(parts[2], 10);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return s;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function venueIdInValuesForLock(venueIdRaw) {
  const s = String(venueIdRaw || '').trim();
  if (!s) return [];
  const out = new Set([s]);
  const n = Number(s);
  if (Number.isFinite(n)) out.add(n);
  return [...out];
}

function orderDateInValuesForLock(orderDateRaw, normalized) {
  const raw = String(orderDateRaw || '').trim();
  const set = new Set();
  if (normalized) set.add(normalized);
  if (raw) set.add(raw);
  return [...set];
}

async function emitBookingRealtimeSignalForLock({ venueId, orderDate }) {
  const venueIdNorm = venueId != null ? String(venueId).trim() : '';
  const orderDateNorm = normalizeOrderDateForLock(orderDate);
  if (!venueIdNorm || !orderDateNorm) return;
  const now = Date.now();
  const coll = db.collection('db_booking_realtime_signal');
  const hit = await coll
    .where({ venueId: venueIdNorm, orderDate: orderDateNorm })
    .limit(1)
    .get();
  if (hit.data && hit.data[0] && hit.data[0]._id) {
    await coll.doc(hit.data[0]._id).update({
      data: {
        eventType: 'coach_hold_changed',
        updatedAt: now,
      },
    });
    return;
  }
  await coll.add({
    data: {
      venueId: venueIdNorm,
      orderDate: orderDateNorm,
      eventType: 'coach_hold_changed',
      createdAt: now,
      updatedAt: now,
    },
  });
}

async function collectOccupiedKeysForLock(venueIdRaw, orderDateRaw) {
  const orderDateNorm = normalizeOrderDateForLock(orderDateRaw);
  const venueIds = venueIdInValuesForLock(venueIdRaw);
  const dateKeys = orderDateInValuesForLock(orderDateRaw, orderDateNorm);
  const keySet = new Set();

  if (venueIds.length === 0 || !orderDateNorm) return keySet;

  const bookingRes = await db
    .collection('db_booking')
    .where({
      venueId: _.in(venueIds),
      orderDate: _.in(dateKeys),
    })
    .get();
  (bookingRes.data || []).forEach((doc) => {
    if (normalizeOrderDateForLock(doc.orderDate) !== orderDateNorm) return;
    if (doc.status !== 'paid') return;
    (doc.bookedSlots || []).forEach((s) => {
      if (s == null || s.courtId == null || s.slotIndex == null) return;
      const cid = Number(s.courtId);
      const idx = Number(s.slotIndex);
      if (!Number.isFinite(cid) || !Number.isFinite(idx)) return;
      keySet.add(`${cid}-${idx}`);
    });
  });

  const holdRes = await db
    .collection('db_coach_slot_hold')
    .where({
      venueId: _.in(venueIds),
      orderDate: _.in(dateKeys),
      status: 'active',
    })
    .get();
  (holdRes.data || []).forEach((doc) => {
    if (normalizeOrderDateForLock(doc.orderDate) !== orderDateNorm) return;
    const cid = Number(doc.courtId);
    const idx = Number(doc.slotIndex);
    if (!Number.isFinite(cid) || !Number.isFinite(idx)) return;
    keySet.add(`${cid}-${idx}`);
  });

  return keySet;
}

async function writeVenueLockAudit({ adminOpenid, adminPhone, detail }) {
  try {
    await db.collection('db_admin_audit').add({
      data: {
        adminOpenid: adminOpenid || '',
        adminPhone: adminPhone != null ? String(adminPhone).trim() : '',
        action: 'venueSlotLock',
        detail: detail && typeof detail === 'object' ? detail : {},
        createdAt: Date.now(),
      },
    });
  } catch (e) {
    console.warn('db_admin_audit write failed', e);
  }
}

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
 * event.action: list | get | create | update | remove | venueSlotLock
 * get/create/update/remove 时 event.venueId 为文档 _id
 * create/update 时 event.payload 为场馆字段对象
 * venueSlotLock: 管理员锁场，event 含 venueId、orderDate、slots[{courtId,slotIndex}]、venueName?
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

  if (action === 'venueSlotLock') {
    const ev = event || {};
    const venueId = ev.venueId != null ? String(ev.venueId).trim() : '';
    const orderDateRaw = ev.orderDate != null ? String(ev.orderDate).trim() : '';
    const orderDate = normalizeOrderDateForLock(orderDateRaw) || orderDateRaw;
    const slots = Array.isArray(ev.slots) ? ev.slots : [];
    const venueName =
      ev.venueName != null && String(ev.venueName).trim() !== ''
        ? String(ev.venueName).trim()
        : '';

    if (!venueId || !orderDate || slots.length === 0) {
      return { ok: false, errMsg: '参数不完整' };
    }

    const normalized = slots
      .map((s) => ({
        courtId: Number(s.courtId),
        slotIndex: Number(s.slotIndex),
      }))
      .filter((s) => Number.isFinite(s.courtId) && Number.isFinite(s.slotIndex));

    if (normalized.length === 0) {
      return { ok: false, errMsg: '请选择有效时段' };
    }

    let occupied;
    try {
      occupied = await collectOccupiedKeysForLock(venueId, orderDate);
    } catch (e) {
      console.error('collectOccupiedKeysForLock', e);
      return { ok: false, errMsg: '查询占用失败' };
    }

    for (let i = 0; i < normalized.length; i += 1) {
      const k = `${normalized[i].courtId}-${normalized[i].slotIndex}`;
      if (occupied.has(k)) {
        return { ok: false, errMsg: '部分时段已被占用，请刷新后重选' };
      }
    }

    const now = Date.now();
    const adminOpenid = openid;
    const phone = admin.phone != null ? String(admin.phone).trim() : '';
    const coachName =
      admin.name != null && String(admin.name).trim() !== '' ? String(admin.name).trim() : '';
    const sessionSlotKeys = normalized
      .map((s) => `${s.courtId}-${s.slotIndex}`)
      .sort()
      .join('|');
    const memberPriceYuan = 1;

    try {
      for (let i = 0; i < normalized.length; i += 1) {
        const s = normalized[i];
        const holdData = {
          _openid: adminOpenid,
          phone,
          coachName,
          venueId,
          venueName,
          orderDate,
          courtId: s.courtId,
          slotIndex: s.slotIndex,
          lessonType: 'venue_lock',
          pairMode: '1v1',
          groupMode: '',
          capacityLabel: '已占用',
          capacityLimit: 1,
          sessionSlotKeys,
          status: 'active',
          createdAt: now,
          adminVenueLock: true,
          memberPricePerSlotYuan: memberPriceYuan,
          memberPricePerSessionYuan: memberPriceYuan,
        };
        await db.collection('db_coach_slot_hold').add({
          data: holdData,
        });
      }
    } catch (err) {
      console.error('adminVenue venueSlotLock add failed', err);
      return { ok: false, errMsg: err.message || '写入失败，请重试' };
    }

    try {
      await emitBookingRealtimeSignalForLock({ venueId, orderDate });
    } catch (e) {
      console.error('emitBookingRealtimeSignal venueSlotLock failed', e);
    }

    await writeVenueLockAudit({
      adminOpenid,
      adminPhone: admin.phone,
      detail: {
        venueId,
        orderDate,
        slotCount: normalized.length,
      },
    });

    return { ok: true };
  }

  return { ok: false, errMsg: '未知操作' };
};
