const { ALL_CATEGORY_ID } = require('../utils/constants');
const { indexDocsById } = require('../utils/courseCatalog');

function getDb() {
  return wx.cloud.database();
}

/** 全表缓存；切换分类仅在内存中筛选，避免重复请求云库 */
let cachedRows = null;
let cachedScaleById = null;
let cachedCategoryById = null;
let inflightFetch = null;

function fetchFullAndWriteCache() {
  if (inflightFetch) return inflightFetch;
  inflightFetch = Promise.all([
    getDb().collection('db_course').get(),
    getDb().collection('db_course_scale').get(),
    getDb().collection('db_category').get(),
  ])
    .then(([courseRes, scaleRes, catRes]) => {
      cachedRows = courseRes.data || [];
      cachedScaleById = indexDocsById(scaleRes.data || []);
      cachedCategoryById = indexDocsById(catRes.data || []);
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
 * 课程 + 规模表 + 分类表一次拉齐，避免在 db_course 上冗余 categoryLabel / typeLabel。
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
