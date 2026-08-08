/**
 * 管理端场馆表单：场地时段价
 * - 界面：10:00–21:00（至 22:00 结束），与会员可预约一致，共 12 档
 * - 落库：仍写 14 格（slotIndex 0=8:00），前两档 8:00/9:00 固定为 0，与订场页对齐
 */
const {
  SLOT_DATA_BASE_HOUR,
  BOOKING_START_HOUR,
  BOOKING_LAST_START_HOUR,
} = require('./bookingTimeSlots');

const SLOT_COUNT = BOOKING_LAST_START_HOUR - BOOKING_START_HOUR + 1; // 12
/** DB priceList 长度（与订场 slotIndex 约定一致） */
const PRICE_LIST_STORAGE_COUNT = 14;
const PRICE_LIST_OFFSET = BOOKING_START_HOUR - SLOT_DATA_BASE_HOUR; // 2

function buildSlotLabels() {
  const labels = [];
  for (let h = BOOKING_START_HOUR; h <= BOOKING_LAST_START_HOUR; h += 1) {
    const hs = h < 10 ? `0${h}` : `${h}`;
    labels.push(`${hs}:00`);
  }
  return labels;
}

function readBookablePrices(rawList) {
  const pl = Array.isArray(rawList) ? rawList : [];
  const out = [];
  for (let i = 0; i < SLOT_COUNT; i += 1) {
    let srcIdx = i;
    if (pl.length >= PRICE_LIST_STORAGE_COUNT) {
      srcIdx = i + PRICE_LIST_OFFSET;
    } else if (pl.length === SLOT_COUNT) {
      srcIdx = i;
    } else if (pl.length > PRICE_LIST_OFFSET) {
      srcIdx = i + PRICE_LIST_OFFSET;
    }
    const n = pl[srcIdx];
    out.push(n != null && n !== '' ? String(n) : '0');
  }
  return out;
}

function writeStoragePrices(formList) {
  const priceList = Array.from({ length: PRICE_LIST_STORAGE_COUNT }, () => 0);
  for (let i = 0; i < SLOT_COUNT; i += 1) {
    const raw = formList && formList[i] != null ? formList[i] : '0';
    const n = Number(raw);
    priceList[i + PRICE_LIST_OFFSET] = Number.isFinite(n) && n >= 0 ? n : 0;
  }
  return priceList;
}

function newCourt(customName) {
  const n = customName != null ? String(customName) : '1号场';
  const priceList = Array.from({ length: SLOT_COUNT }, () => '100');
  return {
    name: n,
    priceList,
    vipPriceList: priceList.slice(),
    priceTab: 'regular',
    specialPrice: '',
  };
}

function courtFromDoc(c) {
  const priceList = readBookablePrices(c.priceList);
  const sp = c.specialPrice;
  let specialPrice = '';
  if (sp != null && String(sp).trim() !== '') {
    const num = Number(sp);
    if (Number.isFinite(num)) {
      specialPrice = String(sp);
    }
  }
  const hasVip = Array.isArray(c.vipPriceList) && c.vipPriceList.length > 0;
  const vipPriceList = hasVip
    ? readBookablePrices(c.vipPriceList).map((v, i) =>
        v != null && String(v).trim() !== '' ? String(v) : String(priceList[i] || '0'),
      )
    : priceList.slice();
  return {
    name: c.name != null ? String(c.name) : '场地',
    priceList,
    vipPriceList,
    priceTab: 'regular',
    specialPrice,
  };
}

function courtsToPayload(courts) {
  return courts.map((c) => {
    const name = String(c.name || '').trim();
    const priceList = writeStoragePrices(c.priceList);
    const vipPriceList = writeStoragePrices(c.vipPriceList);
    const item = { name, priceList, vipPriceList };
    const spStr = c.specialPrice != null ? String(c.specialPrice).trim() : '';
    if (spStr !== '') {
      const sp = Number(spStr);
      if (Number.isFinite(sp) && sp >= 0) {
        item.specialPrice = sp;
      }
    }
    return item;
  });
}

module.exports = {
  SLOT_COUNT,
  PRICE_LIST_STORAGE_COUNT,
  PRICE_LIST_OFFSET,
  buildSlotLabels,
  newCourt,
  courtFromDoc,
  courtsToPayload,
};
