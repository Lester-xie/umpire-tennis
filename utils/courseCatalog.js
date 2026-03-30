/**
 * 课程列表展示与 lessonKey：
 * - 新 db_course：name、description、image、venueId、typeMap（如 1V1/1V2 → 节数→单价）
 * - 旧版：外键 category、type，关联 db_category / db_course_scale
 */

const { buildLessonKey } = require('./lessonKey');
const { normalizeVenueId } = require('./venueId');

const DEFAULT_GOODS_IMAGE = '/assets/images/goods/good1.jpg';

/** 从 typeMap 嵌套对象中取最小标价（元），用于列表展示 */
function minPriceFromTypeMap(typeMap) {
  let min = Infinity;
  function walk(obj) {
    if (!obj || typeof obj !== 'object') return;
    Object.values(obj).forEach((v) => {
      if (v != null && typeof v === 'object') walk(v);
      else {
        const n = Number(String(v).replace(/,/g, ''));
        if (Number.isFinite(n) && n >= 0) min = Math.min(min, n);
      }
    });
  }
  walk(typeMap);
  return min === Infinity ? undefined : min;
}

function typeMapKeysLabel(typeMap) {
  if (!typeMap || typeof typeMap !== 'object') return '';
  return Object.keys(typeMap)
    .sort()
    .join(' · ');
}

/** 订单页：说明与「正式课」等后缀分行展示 */
function splitCourseDescriptionLines(subtitle) {
  const s = String(subtitle || '').trim();
  if (!s) return { note: '', tail: '' };
  const idx = s.indexOf('正式课');
  if (idx >= 0) {
    return {
      note: s.slice(0, idx).trim(),
      tail: s.slice(idx).trim(),
    };
  }
  return { note: s, tail: '' };
}

/**
 * @param {object[]} docs 含 _id 的云文档数组
 * @returns {Record<string, object>}
 */
function indexDocsById(docs) {
  const o = Object.create(null);
  (docs || []).forEach((s) => {
    if (!s || s._id == null) return;
    const k = String(s._id).trim();
    if (!k) return;
    o[k] = s;
    const n = Number(k);
    if (Number.isFinite(n) && String(n) === k) {
      o[String(n)] = s;
    }
  });
  return o;
}

function pickById(map, ref) {
  if (!map || ref == null) return null;
  const a = String(ref).trim();
  if (!a) return null;
  if (map[a]) return map[a];
  const n = Number(a);
  if (Number.isFinite(n) && map[String(n)]) return map[String(n)];
  return null;
}

function pickCourseScale(scaleById, typeRef) {
  return pickById(scaleById, typeRef);
}

function pickCategory(categoryById, categoryRef) {
  return pickById(categoryById, categoryRef);
}

/** 规模展示名：仅来自 db_course_scale.name */
function courseScaleDisplayName(scaleDoc) {
  if (scaleDoc && scaleDoc.name != null && String(scaleDoc.name).trim() !== '') {
    return String(scaleDoc.name).trim();
  }
  return '';
}

/** 分类展示名：仅来自 db_category.name */
function courseCategoryDisplayName(categoryDoc) {
  if (categoryDoc && categoryDoc.name != null && String(categoryDoc.name).trim() !== '') {
    return String(categoryDoc.name).trim();
  }
  return '';
}

/** 课程图：优先 picture，其次 image */
function courseImageSource(c) {
  const pic =
    c.picture != null && String(c.picture).trim() !== ''
      ? String(c.picture).trim()
      : '';
  if (pic) return pic;
  const img =
    c.image != null && String(c.image).trim() !== ''
      ? String(c.image).trim()
      : '';
  return img;
}

/**
 * 优先 grantHours / courseHours；否则从 unit 解析，如 1h、1H、2小时、10
 */
function parseGrantHours(c) {
  const raw = c.grantHours != null ? c.grantHours : c.courseHours;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) {
    return Math.min(999, Math.floor(n));
  }
  const unit = String(c.unit || '').trim();
  if (!unit) return 0;
  const m1 = unit.match(/^(\d+(?:\.\d+)?)\s*(?:h|H|小时|时)\b/);
  if (m1) {
    const v = Math.floor(Number(m1[1]));
    if (v > 0) return Math.min(999, v);
  }
  const m2 = unit.match(/^(\d+)/);
  if (m2) {
    const v = Math.floor(Number(m2[1]));
    if (v > 0) return Math.min(999, v);
  }
  return 0;
}

function inferLessonTypeFromCategoryName(catName) {
  const cat = String(catName || '');
  if (cat.indexOf('体验') !== -1) return 'experience';
  if (cat.indexOf('团') !== -1) return 'group';
  if (cat.indexOf('正课') !== -1) return 'regular';
  if (cat.indexOf('正') !== -1) return 'regular';
  return '';
}

/**
 * @param {object} course db_course
 * @param {object|null} categoryDoc db_category
 */
function inferLessonType(course, categoryDoc) {
  const ex = course.lessonType != null ? String(course.lessonType).trim() : '';
  if (['experience', 'regular', 'group'].includes(ex)) return ex;

  const coachLt =
    categoryDoc && categoryDoc.coachLessonType != null
      ? String(categoryDoc.coachLessonType).trim()
      : '';
  if (['experience', 'regular', 'group'].includes(coachLt)) return coachLt;

  const fromCat = inferLessonTypeFromCategoryName(courseCategoryDisplayName(categoryDoc));
  if (fromCat) return fromCat;

  const fromName = inferLessonTypeFromCategoryName(
    course.name != null ? String(course.name).trim() : '',
  );
  if (fromName) return fromName;

  const title = String(course.title || course.name || '');
  if (title.indexOf('体验') !== -1) return 'experience';
  if (title.indexOf('团课') !== -1 || title.indexOf('团体') !== -1) return 'group';
  return '';
}

function inferPairModeFromScale(scaleDoc, course, displayName) {
  const pmScale =
    scaleDoc && scaleDoc.pairMode != null ? String(scaleDoc.pairMode).trim().toLowerCase() : '';
  if (/^\d+v\d+$/.test(pmScale)) return pmScale;

  const pm0 = course.pairMode != null ? String(course.pairMode).trim().toLowerCase() : '';
  if (pm0 === '1v2') return '1v2';
  if (pm0 === '1v1') return '1v1';

  const typ = String(displayName || '')
    .replace(/Ｖ/g, 'V')
    .replace(/v/g, 'V')
    .toUpperCase();
  if (typ.indexOf('1V2') !== -1 || typ.indexOf('1对2') !== -1 || typ.indexOf('一对二') !== -1) {
    return '1v2';
  }
  if (typ.indexOf('1V1') !== -1 || typ.indexOf('1对1') !== -1 || typ.indexOf('一对一') !== -1) {
    return '1v1';
  }
  return '1v1';
}

function inferGroupModeFromScale(scaleDoc, course, displayName) {
  const gmScale =
    scaleDoc && scaleDoc.groupMode != null ? String(scaleDoc.groupMode).trim().toLowerCase() : '';
  if (/^group[a-z0-9_]+$/i.test(gmScale)) return gmScale;

  const gm0 = course.groupMode != null ? String(course.groupMode).trim().toLowerCase() : '';
  if (/^group[a-z0-9_]+$/i.test(gm0)) return gm0;

  const label = String(displayName || '');
  if (/3\s*[-~～]\s*5|三五/.test(label) || /3\s*[-~～]?\s*5.*班/.test(label)) {
    return 'group35';
  }
  return 'group35';
}

/**
 * 用户选定 typeMap 中的上课形式（如 1V1）后生成 lessonKey（节数只影响 grantHours，不改变 key）
 * @param {string} lessonType experience | regular | group | open_play | ''
 * @param {string} formatKey typeMap 外层键，如 1V1、1V2
 */
function lessonKeyFromTypeMapFormat(lessonType, formatKey) {
  const ltRaw = String(lessonType || '').trim();
  const lt =
    ltRaw && ['experience', 'regular', 'group', 'open_play'].includes(ltRaw) ? ltRaw : 'regular';
  if (lt === 'group') {
    const gm = inferGroupModeFromScale(null, {}, String(formatKey || ''));
    return buildLessonKey('group', '1v1', gm);
  }
  if (lt === 'open_play') {
    return buildLessonKey('open_play', '1v1', 'group36');
  }
  const pm = inferPairModeFromScale(null, {}, String(formatKey || ''));
  return buildLessonKey(lt, pm, 'group35');
}

function resolveLessonKeyFromCourse(course, scaleDoc, categoryDoc) {
  const direct = course.lessonKey != null ? String(course.lessonKey).trim() : '';
  if (direct) return direct;

  let scaleName = courseScaleDisplayName(scaleDoc);
  if (!scaleName && course.typeMap && typeof course.typeMap === 'object') {
    const keys = Object.keys(course.typeMap).sort();
    scaleName = keys[0] || '';
  }

  const ltExplicit = course.lessonType != null ? String(course.lessonType).trim() : '';
  if (['experience', 'regular', 'group'].includes(ltExplicit)) {
    if (ltExplicit === 'group') {
      const gm = inferGroupModeFromScale(scaleDoc, course, scaleName);
      return buildLessonKey(ltExplicit, '1v1', gm);
    }
    const pm = inferPairModeFromScale(scaleDoc, course, scaleName);
    return buildLessonKey(ltExplicit, pm, 'group35');
  }

  const lt = inferLessonType(course, categoryDoc);
  if (!lt) return '';
  if (lt === 'group') {
    const gm = inferGroupModeFromScale(scaleDoc, course, scaleName);
    return buildLessonKey(lt, '1v1', gm);
  }
  const pm = inferPairModeFromScale(scaleDoc, course, scaleName);
  return buildLessonKey(lt, pm, 'group35');
}

/**
 * @param {object} c db_course（可含 displayImage）
 * @param {object|null} scaleDoc
 * @param {object|null} categoryDoc
 */
function formatCourseRow(c, scaleDoc, categoryDoc) {
  const hasTypeMap =
    c &&
    c.typeMap != null &&
    typeof c.typeMap === 'object' &&
    Object.keys(c.typeMap).length > 0;

  if (hasTypeMap) {
    const titleRaw = c.name != null ? String(c.name).trim() : '';
    const title = titleRaw || '课程';
    const typeLabel = typeMapKeysLabel(c.typeMap);
    const categoryLabel = '';
    const subtitle =
      c.description != null && String(c.description).trim() !== ''
        ? String(c.description).trim()
        : '';
    const desc = [title, subtitle].filter(Boolean).join(' · ');
    const grantHours = parseGrantHours(c);
    const lessonKey = resolveLessonKeyFromCourse(c, scaleDoc, categoryDoc);
    const venueId = normalizeVenueId(c.venueId != null ? c.venueId : c.venue);
    const price = minPriceFromTypeMap(c.typeMap) ?? c.price ?? 0;
    const lessonType = inferLessonType(c, categoryDoc);
    return {
      id: c._id,
      image: c.displayImage || courseImageSource(c) || DEFAULT_GOODS_IMAGE,
      title,
      typeLabel,
      categoryLabel,
      subtitle,
      desc,
      price,
      grantHours,
      lessonKey,
      venueId,
      typeMap: c.typeMap,
      lessonType,
    };
  }

  const titleRaw =
    c.title != null
      ? String(c.title).trim()
      : c.name != null
        ? String(c.name).trim()
        : '';
  const title = titleRaw || '课程';
  const typeLabel = courseScaleDisplayName(scaleDoc);
  const categoryLabel = courseCategoryDisplayName(categoryDoc);
  const subtitle =
    c.unit != null && String(c.unit).trim() !== '' ? String(c.unit).trim() : '';
  const desc = [title, typeLabel, subtitle].filter(Boolean).join(' · ');
  const grantHours = parseGrantHours(c);
  const lessonKey = resolveLessonKeyFromCourse(c, scaleDoc, categoryDoc);
  const venueId = normalizeVenueId(c.venueId != null ? c.venueId : c.venue);
  return {
    id: c._id,
    image: c.displayImage || courseImageSource(c) || DEFAULT_GOODS_IMAGE,
    title,
    typeLabel,
    categoryLabel,
    subtitle,
    desc,
    price: c.price,
    grantHours,
    lessonKey,
    venueId,
  };
}

module.exports = {
  DEFAULT_GOODS_IMAGE,
  indexDocsById,
  pickCourseScale,
  pickCategory,
  courseScaleDisplayName,
  courseCategoryDisplayName,
  courseImageSource,
  parseGrantHours,
  resolveLessonKeyFromCourse,
  formatCourseRow,
  minPriceFromTypeMap,
  typeMapKeysLabel,
  lessonKeyFromTypeMapFormat,
  splitCourseDescriptionLines,
};
