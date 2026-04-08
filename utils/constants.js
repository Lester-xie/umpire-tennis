/** 分类组件「全部」项 _id，与 db_course.category 无关联；选中全部时不按 category 筛选 */
const ALL_CATEGORY_ID = '__category_all__';

/** 首页分类栏与课程列表不展示的分类（与 db_category.name trim 后全等） */
const HOME_EXCLUDED_CATEGORY_NAMES = ['畅打', '团课'];

function isCategoryExcludedFromHome(categoryDoc) {
  const n =
    categoryDoc && categoryDoc.name != null ? String(categoryDoc.name).trim() : '';
  return HOME_EXCLUDED_CATEGORY_NAMES.includes(n);
}

/** @param {Record<string, object>} categoryById courseCache / indexDocsById 结果 */
function collectHomeExcludedCategoryRefs(categoryById) {
  const set = new Set();
  const seenDoc = new Set();
  Object.values(categoryById || {}).forEach((doc) => {
    if (!doc || doc._id == null) return;
    const dk = String(doc._id);
    if (seenDoc.has(dk)) return;
    seenDoc.add(dk);
    if (!isCategoryExcludedFromHome(doc)) return;
    set.add(String(doc._id));
    const n = Number(doc._id);
    if (Number.isFinite(n)) set.add(String(n));
  });
  return set;
}

function isCourseInHomeExcludedCategory(course, excludedCategoryRefs) {
  const name = course && course.name != null ? String(course.name).trim() : '';
  if (name && HOME_EXCLUDED_CATEGORY_NAMES.includes(name)) return true;
  const ref = course && course.category;
  if (ref == null || ref === '') return false;
  if (excludedCategoryRefs.has(String(ref))) return true;
  const n = Number(ref);
  return Number.isFinite(n) && excludedCategoryRefs.has(String(n));
}

module.exports = {
  ALL_CATEGORY_ID,
  HOME_EXCLUDED_CATEGORY_NAMES,
  isCategoryExcludedFromHome,
  collectHomeExcludedCategoryRefs,
  isCourseInHomeExcludedCategory,
};
