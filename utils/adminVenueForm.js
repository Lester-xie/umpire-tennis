/** 管理端场馆表单：场地时段价，与 cloudfunctions/adminVenue 一致 */

const SLOT_COUNT = 14;

function buildSlotLabels() {
  const labels = [];
  for (let h = 8; h <= 21; h += 1) {
    const hs = h < 10 ? `0${h}` : `${h}`;
    labels.push(`${hs}:00`);
  }
  return labels;
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
  const pl = Array.isArray(c.priceList) ? c.priceList : [];
  const priceList = [];
  for (let i = 0; i < SLOT_COUNT; i += 1) {
    const n = pl[i];
    priceList.push(n != null && n !== '' ? String(n) : '0');
  }
  const sp = c.specialPrice;
  let specialPrice = '';
  if (sp != null && String(sp).trim() !== '') {
    const num = Number(sp);
    if (Number.isFinite(num)) {
      specialPrice = String(sp);
    }
  }
  const vpl = Array.isArray(c.vipPriceList) ? c.vipPriceList : [];
  const vipPriceList = [];
  for (let i = 0; i < SLOT_COUNT; i += 1) {
    const n = vpl[i];
    vipPriceList.push(n != null && n !== '' ? String(n) : String(priceList[i] || '0'));
  }
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
    const priceList = [];
    for (let i = 0; i < SLOT_COUNT; i += 1) {
      const raw = c.priceList && c.priceList[i] != null ? c.priceList[i] : '0';
      const n = Number(raw);
      priceList.push(Number.isFinite(n) && n >= 0 ? n : 0);
    }
    const vipPriceList = [];
    for (let i = 0; i < SLOT_COUNT; i += 1) {
      const raw = c.vipPriceList && c.vipPriceList[i] != null ? c.vipPriceList[i] : '0';
      const n = Number(raw);
      vipPriceList.push(Number.isFinite(n) && n >= 0 ? n : 0);
    }
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
  buildSlotLabels,
  newCourt,
  courtFromDoc,
  courtsToPayload,
};
