const { ALL_CATEGORY_ID } = require('../utils/constants');

function getDb() {
  return wx.cloud.database();
}

/** 全表缓存；切换分类仅在内存中筛选，避免重复请求云库 */
let cachedRows = null;
let inflightFetch = null;

function fetchFullAndWriteCache() {
  if (inflightFetch) return inflightFetch;
  inflightFetch = getDb()
    .collection('db_course')
    .get()
    .then((courseRes) => {
      cachedRows = courseRes.data || [];
      return { data: cachedRows };
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
 * 仅拉取 db_course；课型与场馆用途以 db_course / db_venue.category_list 为准。
 * @returns {Promise<{ data: object[] }>}
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
