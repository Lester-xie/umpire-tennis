/**
 * 教练约场「场地用途」弹层：按 db_category.scaleList 生成规模选项
 * scaleList 项：{ id, name, code? }；code 可选，缺省时从 name 推断
 * db_course_scale 可通过 scaleList.id 关联，字段 limit 表示该规模最多可报名人数（含 1v1=1、1v2=1、团课=5 等）
 */

const NAME_TO_LESSON_TYPE = {
  体验课: 'experience',
  正课: 'regular',
  团课: 'group',
  畅打: 'open_play',
};

const DEFAULT_PAIR_SCALES = [
  { id: 'default-1v1', name: '1V1', modeCode: '1v1' },
  { id: 'default-1v2', name: '1V2', modeCode: '1v2' },
];

const DEFAULT_GROUP_SCALES = [{ id: 'default-g35', name: '3-5人', modeCode: 'group35' }];

/** 与历史配置「3-5人班」等对齐为「3-5人」 */
function normalizeGroupScaleDisplayName(raw) {
  const s = String(raw || '').trim();
  if (!s) return s;
  if (/3\s*[-~～]\s*5\s*人\s*班/.test(s)) return '3-5人';
  return s;
}

function mapCategoryNameToLessonType(name) {
  const n = String(name || '').trim();
  if (NAME_TO_LESSON_TYPE[n]) return NAME_TO_LESSON_TYPE[n];
  if (n.includes('畅打')) return 'open_play';
  if (n.includes('体验')) return 'experience';
  if (n.includes('团课') || (n.includes('团') && n.includes('课'))) return 'group';
  if (n.includes('正课') || n.includes('正')) return 'regular';
  return '';
}

/**
 * @param {object[]} categories getCategories().data
 * @param {{ allowOpenPlay?: boolean }} [options] 仅 isManager 为 true 时应传 allowOpenPlay: true，才索引「畅打」
 * @returns {Record<string, object>}
 */
function indexCategoriesByCoachLessonType(categories, options = {}) {
  const allowOpenPlay = options.allowOpenPlay === true;
  const index = {};
  (categories || []).forEach((cat) => {
    const lt =
      cat && cat.coachLessonType != null
        ? String(cat.coachLessonType).trim()
        : mapCategoryNameToLessonType(cat && cat.name);
    if (lt === 'open_play' && !allowOpenPlay) return;
    if (!['experience', 'regular', 'group', 'open_play'].includes(lt)) return;
    if (!index[lt]) index[lt] = cat;
  });
  return index;
}

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

function inferGroupModeCode(scale) {
  const code = scale.code != null ? String(scale.code).trim().toLowerCase() : '';
  if (/^group[a-z0-9_]+$/i.test(code)) return code.toLowerCase();
  const name = String(scale.name || '');
  if (/3\s*[-–~～]\s*6|三\s*[-–~～]?\s*六|3.?6\s*人/.test(name)) return 'group36';
  if (/3\s*[-–~～]\s*5|三五|3.?5/.test(name)) return 'group35';
  return '';
}

function pickLimitFromScaleDoc(scaleDoc, fallback) {
  const n = Math.floor(Number(scaleDoc && scaleDoc.limit));
  if (Number.isFinite(n) && n >= 1) return Math.min(99, n);
  return fallback;
}

function parsePairScale(raw, scaleById) {
  if (!raw || typeof raw !== 'object') return null;
  const id = raw.id != null ? String(raw.id).trim() : '';
  const name = raw.name != null ? String(raw.name).trim() : '';
  const modeCode = inferPairModeCode({ ...raw, name });
  if (!modeCode) return null;
  const scaleDoc =
    scaleById && id
      ? scaleById[id] || scaleById[String(Number(id))]
      : null;
  const fb = 1;
  let limit = pickLimitFromScaleDoc(scaleDoc, fb);
  if (modeCode === '1v2') limit = Math.min(limit, 1);
  return {
    id: id || modeCode,
    name: name || modeCode.replace('v', 'V').toUpperCase(),
    modeCode,
    limit,
  };
}

function parseGroupScale(raw, scaleById) {
  if (!raw || typeof raw !== 'object') return null;
  const id = raw.id != null ? String(raw.id).trim() : '';
  const name = raw.name != null ? String(raw.name).trim() : '';
  const compact = String(name || '')
    .toUpperCase()
    .replace(/\s/g, '');
  if (compact.includes('1V2') || /1对2|一对二/.test(name)) {
    const modeCode = 'group_1v2';
    return {
      id: id || modeCode,
      name: name || '1V2',
      modeCode,
      limit: 1,
    };
  }
  let modeCode = inferGroupModeCode({ ...raw, name });
  if (!modeCode) {
    const slug = id.replace(/[^a-z0-9]/gi, '').slice(0, 16);
    modeCode = slug ? `group_${slug}` : 'group35';
  }
  if (!modeCode || !/^group[a-z0-9_]+$/i.test(modeCode)) return null;
  const scaleDoc =
    scaleById && id
      ? scaleById[id] || scaleById[String(Number(id))]
      : null;
  const mc = modeCode.toLowerCase();
  const fbLimit = mc === 'group36' ? 6 : 5;
  const limit = pickLimitFromScaleDoc(scaleDoc, fbLimit);
  const normalized = normalizeGroupScaleDisplayName(name);
  let displayName = normalized;
  if (!displayName) {
    if (mc === 'group35') displayName = '3-5人';
    else if (mc === 'group36') displayName = '3-6人';
    else displayName = modeCode;
  }
  return {
    id: id || modeCode,
    name: displayName,
    modeCode: modeCode.toLowerCase(),
    limit,
  };
}

/**
 * @param {Record<string, object>} [scaleById] db_course_scale 按 _id 索引，用于读取 limit
 * @returns {{ pairScales: object[], groupScales: object[] }}
 */
function scalesForLessonType(lessonType, categoryIndex, scaleById) {
  const cat = categoryIndex && categoryIndex[lessonType];
  const raw = cat && Array.isArray(cat.scaleList) ? cat.scaleList : [];

  if (lessonType === 'group' || lessonType === 'open_play') {
    const groupScales = raw.map((row) => parseGroupScale(row, scaleById)).filter(Boolean);
    if (groupScales.length) return { pairScales: [], groupScales };
    const fb = DEFAULT_GROUP_SCALES.map((d) => ({
      ...d,
      limit: d.limit != null ? d.limit : 5,
    }));
    return {
      pairScales: [],
      groupScales: fb,
    };
  }

  const pairScales = raw.map((row) => parsePairScale(row, scaleById)).filter(Boolean);
  if (pairScales.length) return { pairScales, groupScales: [] };
  const fb = DEFAULT_PAIR_SCALES.map((d) => ({
    ...d,
    limit: 1,
  }));
  return {
    pairScales: fb,
    groupScales: [],
  };
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
  indexCategoriesByCoachLessonType,
  scalesForLessonType,
  firstPairMode,
  firstGroupMode,
  coerceModes,
  DEFAULT_PAIR_SCALES,
  DEFAULT_GROUP_SCALES,
};
