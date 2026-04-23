/**
 * db_venue.categoryList：教练课用途与会员默认「场次」价（与占用时长无关）；旧数据可能为 category_list，读时兼容
 * 项示例：{ name: '体验课', scaleList: { 1V1: 118, 1V2: 188 } }
 * 或：{ name: '团课', price: 85 }
 */

const LESSON_TYPE_TO_NAME = {
  experience: '体验课',
  regular: '正课',
  group: '团课',
  open_play: '畅打',
};

function extractCategoryList(venue) {
  if (!venue || typeof venue !== 'object') return [];
  const raw =
    venue.categoryList != null
      ? venue.categoryList
      : venue.category_list != null
        ? venue.category_list
        : null;
  return Array.isArray(raw) ? raw : [];
}

function normalizePairScaleKey(pairMode) {
  const pm = String(pairMode || '')
    .trim()
    .toLowerCase();
  if (pm === '1v1') return '1V1';
  if (pm === '1v2') return '1V2';
  return '';
}

function pickScaleListPrice(scaleList, pairMode) {
  if (!scaleList || typeof scaleList !== 'object' || Array.isArray(scaleList)) return null;
  const want = normalizePairScaleKey(pairMode);
  const candidates = [
    want,
    want.replace('V', 'v'),
    String(pairMode || '').trim(),
    String(pairMode || '')
      .trim()
      .toUpperCase(),
  ];
  for (let i = 0; i < candidates.length; i += 1) {
    const k = candidates[i];
    if (!k || !Object.prototype.hasOwnProperty.call(scaleList, k)) continue;
    const n = Number(scaleList[k]);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  const keys = Object.keys(scaleList);
  for (let j = 0; j < keys.length; j += 1) {
    const sk = keys[j];
    const compact = String(sk)
      .replace(/\s/g, '')
      .toUpperCase();
    if (want === '1V1' && (compact === '1V1' || compact === '1对1')) {
      const n = Number(scaleList[sk]);
      if (Number.isFinite(n) && n >= 0) return n;
    }
    if (want === '1V2' && (compact === '1V2' || compact === '1对2')) {
      const n = Number(scaleList[sk]);
      if (Number.isFinite(n) && n >= 0) return n;
    }
  }
  return null;
}

/**
 * @returns {number|null} 元/次（单场次会员应付，与占用 1 小时或多小时无关）
 */
function defaultMemberPriceYuanFromVenue(venue, lessonType, pairMode) {
  const lt = String(lessonType || '').trim();
  const list = extractCategoryList(venue);
  const wantName = LESSON_TYPE_TO_NAME[lt];
  if (!wantName) return null;
  const row = list.find((item) => {
    const n = item && item.name != null ? String(item.name).trim() : '';
    return n === wantName;
  });
  if (!row) return null;
  if (lt === 'group' || lt === 'open_play') {
    const n = Number(row.price);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  const fromScale = pickScaleListPrice(row.scaleList, pairMode);
  return fromScale != null && Number.isFinite(fromScale) ? fromScale : null;
}

module.exports = {
  extractCategoryList,
  defaultMemberPriceYuanFromVenue,
  LESSON_TYPE_TO_NAME,
};
