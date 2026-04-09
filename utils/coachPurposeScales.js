/**
 * 教练约场「场地用途」弹层：规模选项优先来自 db_venue.category_list（与会员价同一套配置）。
 * scaleList 为对象时：{ 1V1: 元, 1V2: 元 }；团课/畅打为单场价 row.price。
 * 未配置或无法解析时使用 DEFAULT_* 兜底。
 */

const { extractCategoryList, LESSON_TYPE_TO_NAME } = require('./venueCategoryList');

const DEFAULT_PAIR_SCALES = [
  { id: 'default-1v1', name: '1V1', modeCode: '1v1' },
  { id: 'default-1v2', name: '1V2', modeCode: '1v2' },
];

const DEFAULT_GROUP_SCALES = [{ id: 'default-g35', name: '3-5人', modeCode: 'group35' }];

function inferPairModeCode(scale) {
  const code = scale.code != null ? String(scale.code).trim().toLowerCase() : '';
  if (/^\d+v\d+$/i.test(code)) return code.toLowerCase();
  const compact = String(scale.name || '')
    .toUpperCase()
    .replace(/\s/g, '');
  if (compact.includes('1V2')) return '1v2';
  if (compact.includes('1V1')) return '1v1';
  return '';
}

function modeCodeFromScaleListKey(key) {
  const s = String(key || '').trim();
  const u = s.replace(/\s/g, '').toUpperCase();
  if (u === '1V1') return '1v1';
  if (u === '1V2') return '1v2';
  if (/^1对1|^一对一/.test(s)) return '1v1';
  if (/^1对2|^一对二/.test(s)) return '1v2';
  return inferPairModeCode({ name: s, code: s });
}

function displayNameForPairMode(modeCode) {
  if (modeCode === '1v1') return '1V1';
  if (modeCode === '1v2') return '1V2';
  return String(modeCode || '');
}

/**
 * 与 admin 后台「体验课/正课」分项价一致：scaleList 为对象，键为 1V1 / 1V2 等。
 * @returns {object[]|null}
 */
function pairScalesFromVenueScaleList(scaleList) {
  if (!scaleList || typeof scaleList !== 'object' || Array.isArray(scaleList)) return null;
  const keys = Object.keys(scaleList);
  if (keys.length === 0) return null;
  const entries = keys
    .map((k) => {
      const modeCode = modeCodeFromScaleListKey(k);
      const n = Number(scaleList[k]);
      if (!modeCode || !Number.isFinite(n) || n < 0) return null;
      return { k, modeCode };
    })
    .filter(Boolean);
  if (!entries.length) return null;
  const rank = (m) => (m === '1v1' ? 0 : m === '1v2' ? 1 : 2);
  entries.sort(
    (a, b) =>
      rank(a.modeCode) - rank(b.modeCode) || String(a.k).localeCompare(String(b.k)),
  );
  return entries.map((e) => ({
    id: `venue-${e.modeCode}`,
    name: displayNameForPairMode(e.modeCode),
    modeCode: e.modeCode,
    limit: e.modeCode === '1v2' ? 1 : 1,
  }));
}

function findCategoryRowForLessonType(venue, lessonType) {
  const lt = String(lessonType || '').trim();
  const wantName = LESSON_TYPE_TO_NAME[lt];
  if (!wantName) return null;
  const list = extractCategoryList(venue);
  return list.find((item) => String(item.name || '').trim() === wantName) || null;
}

/**
 * @param {object|null|undefined} venue globalData.selectedVenue
 * @param {string} lessonType experience | regular | group | open_play
 * @returns {{ pairScales: object[], groupScales: object[] }}
 */
function scalesForLessonType(venue, lessonType) {
  const lt = String(lessonType || '').trim();
  const row = findCategoryRowForLessonType(venue, lt);

  if (lt === 'group' || lt === 'open_play') {
    if (row && (row.price != null || row.name)) {
      const isOpen = lt === 'open_play';
      const groupScales = [
        {
          id: 'venue-group',
          name: isOpen ? '3-6人' : '3-5人',
          modeCode: isOpen ? 'group36' : 'group35',
          limit: isOpen ? 6 : 5,
        },
      ];
      return { pairScales: [], groupScales };
    }
    const fb = DEFAULT_GROUP_SCALES.map((d) => ({
      ...d,
      limit: d.limit != null ? d.limit : 5,
    }));
    return { pairScales: [], groupScales: fb };
  }

  if (row && row.scaleList && typeof row.scaleList === 'object' && !Array.isArray(row.scaleList)) {
    const pairScales = pairScalesFromVenueScaleList(row.scaleList);
    if (pairScales && pairScales.length) {
      return { pairScales, groupScales: [] };
    }
  }

  const fb = DEFAULT_PAIR_SCALES.map((d) => ({
    ...d,
    limit: 1,
  }));
  return { pairScales: fb, groupScales: [] };
}

function firstPairMode(pairScales) {
  const first = (pairScales && pairScales[0]) || DEFAULT_PAIR_SCALES[0];
  return first.modeCode;
}

function firstGroupMode(groupScales) {
  const first = (groupScales && groupScales[0]) || DEFAULT_GROUP_SCALES[0];
  return first.modeCode;
}

/**
 * 若当前 mode 不在列表中，回退到列表首项
 */
function coerceModes(lessonType, pairMode, groupMode, pairScales, groupScales) {
  if (lessonType === 'group' || lessonType === 'open_play') {
    const list = groupScales && groupScales.length ? groupScales : DEFAULT_GROUP_SCALES;
    const ok = list.some((s) => s.modeCode === groupMode);
    return {
      pairMode: pairMode || '1v1',
      groupMode: ok ? groupMode : list[0].modeCode,
    };
  }
  const list = pairScales && pairScales.length ? pairScales : DEFAULT_PAIR_SCALES;
  const ok = list.some((s) => s.modeCode === pairMode);
  return {
    pairMode: ok ? pairMode : list[0].modeCode,
    groupMode: groupMode || 'group35',
  };
}

module.exports = {
  scalesForLessonType,
  firstPairMode,
  firstGroupMode,
  coerceModes,
  DEFAULT_PAIR_SCALES,
  DEFAULT_GROUP_SCALES,
};
