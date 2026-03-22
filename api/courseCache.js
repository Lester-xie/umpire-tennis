const { ALL_CATEGORY_ID } = require('../utils/constants');

function getDb() {
  return wx.cloud.database();
}

/** 全表缓存；切换分类仅在内存中筛选，避免重复请求云库 */
let cachedRows = null;
/** 并发时合并为单次 .get() */
let inflightFetch = null;

function fetchFullAndWriteCache() {
  if (inflightFetch) return inflightFetch;
  inflightFetch = getDb()
    .collection('db_course')
    .get()
    .then((res) => {
      const data = res.data || [];
      cachedRows = data;
      return { data };
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
 * 与 db.collection().get() 相同返回形态 { data }，便于沿用原有 then 逻辑。
 * @param {string} filterCategoryId
 * @param {{ forceRefresh?: boolean }} [options] forceRefresh 为 true 时清空缓存并重新拉全表
 */
function getCourses(filterCategoryId, options = {}) {
  const { forceRefresh = false } = options;
  if (forceRefresh) {
    cachedRows = null;
  }
  if (cachedRows != null) {
    return Promise.resolve({
      data: filterByCategory(cachedRows, filterCategoryId),
    });
  }
  return fetchFullAndWriteCache().then((res) => ({
    data: filterByCategory(res.data, filterCategoryId),
  }));
}

function invalidateCourseCache() {
  cachedRows = null;
}

module.exports = {
  getCourses,
  invalidateCourseCache,
};
