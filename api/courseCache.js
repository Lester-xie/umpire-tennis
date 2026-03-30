const { ALL_CATEGORY_ID } = require('../utils/constants');

function getDb() {
  return wx.cloud.database();
}

/** 全表缓存；切换分类仅在内存中筛选，避免重复请求云库 */
let cachedRows = null;
/** 兼容旧版 db_course 外键 type → db_course_scale；新 schema 无 type 时为空表 */
let cachedScaleById = null;
/** 兼容旧版 category → db_category；新 schema 无 category 时为空表 */
let cachedCategoryById = null;
let inflightFetch = null;

function fetchFullAndWriteCache() {
  if (inflightFetch) return inflightFetch;
  inflightFetch = getDb()
    .collection('db_course')
    .get()
    .then((courseRes) => {
      cachedRows = courseRes.data || [];
      cachedScaleById = {};
      cachedCategoryById = {};
      return {
        data: cachedRows,
        scaleById: cachedScaleById,
        categoryById: cachedCategoryById,
      };
    })
    .finally(() => {
      inflightFetch = null;
    });
  return inflightFetch;
}

function filterByCategory(rows, filterCategoryId) {
  if (!filterCategoryId || filterCategoryId === ALL_CATEGORY_ID) {
    return rows.slice();
  }
  return rows.filter((c) => c.category === filterCategoryId);
}

/**
 * 仅拉取 db_course；scaleById / categoryById 为空对象（兼容旧调用方）。
 * @returns {Promise<{ data: object[], scaleById: Record<string,object>, categoryById: Record<string,object> }>}
 */
function getCourses(filterCategoryId, options = {}) {
  const { forceRefresh = false } = options;
  if (forceRefresh) {
    cachedRows = null;
    cachedScaleById = null;
    cachedCategoryById = null;
  }
  if (cachedRows != null && cachedScaleById != null && cachedCategoryById != null) {
    return Promise.resolve({
      data: filterByCategory(cachedRows, filterCategoryId),
      scaleById: cachedScaleById,
      categoryById: cachedCategoryById,
    });
  }
  return fetchFullAndWriteCache().then((res) => ({
    data: filterByCategory(res.data, filterCategoryId),
    scaleById: res.scaleById || cachedScaleById || {},
    categoryById: res.categoryById || cachedCategoryById || {},
  }));
}

function invalidateCourseCache() {
  cachedRows = null;
  cachedScaleById = null;
  cachedCategoryById = null;
}

module.exports = {
  getCourses,
  invalidateCourseCache,
};
