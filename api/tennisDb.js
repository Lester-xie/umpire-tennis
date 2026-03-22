// 云数据库封装

const courseCache = require('./courseCache');

function getDb() {
  return wx.cloud.database();
}

/**
 * 获取场馆列表
 * venue 集合建议字段：
 * - name
 * - address
 * - latitude
 * - longitude
 * - （可选）image
 * - courtList: [{ name, priceList, specialPrice? }] — priceList 长度 14；周六日单价用 specialPrice（可选）
 */
function getVenues() {
  const db = getDb();
  return db.collection('db_venue').get();
}

/**
 * 首页分类入口 db_category 建议字段：
 * - name（展示名）
 * - image（https 或 cloud:// 文件 ID，若界面展示图时用）
 * - sortOrder（可选，数字越小越靠前）
 */
function getCategories() {
  const db = getDb();
  return db.collection('db_category').get();
}

/**
 * 课程列表 db_course：走内存全表缓存（见 api/courseCache.js），切换分类不再重复请求。
 * 课程图字段：picture（优先，https 或 cloud://）；兼容旧字段 image。
 * 列表展示文案：categoryLabel（如体验课/正课，与筛选字段 category 可并存）。
 * @param {string} filterCategoryId
 * @param {{ forceRefresh?: boolean }} [options]
 */
function getCourses(filterCategoryId, options) {
  return courseCache.getCourses(filterCategoryId, options);
}

/** 清空课程缓存（如下单成功、后台改价后可在适当时机调用再拉） */
function invalidateCourseCache() {
  courseCache.invalidateCourseCache();
}

/**
 * 按手机号查询用户
 * user 集合字段建议：
 * - phone
 * - name
 * - avatar
 */
function getUserByPhone(phone) {
  if (!phone) return Promise.resolve({ data: [] });
  const db = getDb();
  return db.collection('db_user').where({ phone }).get();
}

/**
 * 新增用户
 */
function createUser({ phone, name, avatar } = {}) {
  const db = getDb();
  const data = {
    phone: phone || '',
    name: name || '',
    avatar: avatar || '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  return db.collection('db_user').add({ data });
}

function decryptPhoneNumber({ code, encryptedData, iv, appid } = {}) {
  return wx.cloud.callFunction({
    name: 'decryptPhoneNumber',
    data: {
      code,
      encryptedData,
      iv,
      appid,
    },
  });
}

/**
 * 根据手机号更新 user 集合字段（例如头像/昵称）
 */
function updateUserByPhone({ phone, update } = {}) {
  const db = getDb();
  const data = update || {};
  if (!phone) return Promise.reject(new Error('MISSING_PHONE'));
  if (!data || Object.keys(data).length === 0) return Promise.resolve({ stats: { updated: 0 } });

  return db
    .collection('db_user')
    .where({ phone })
    .update({
      data: {
        ...data,
        updatedAt: Date.now(),
      },
    });
}

/**
 * 当前登录用户已支付订场记录（云函数内按 openid 查询 db_booking）
 */
function getMyBookings() {
  return wx.cloud.callFunction({ name: 'listBookings' });
}

/**
 * 某场馆某日已被已支付订单占用的时段（courtId + slotIndex）
 */
function getBookedSlots({ venueId, orderDate } = {}) {
  return wx.cloud.callFunction({
    name: 'getBookedSlots',
    data: { venueId, orderDate },
  });
}

/**
 * 教练占用场地（云函数内校验 db_user.isCoach）
 * @param {{ venueId: string, venueName?: string, orderDate: string, slots: Array<{courtId:number, slotIndex:number}>, lessonType: string, pairMode?: string, groupMode?: string }} payload
 */
function coachHoldSlots(payload) {
  return wx.cloud.callFunction({
    name: 'coachHoldSlots',
    data: payload || {},
  });
}

/** 当前教练有效占用列表 */
function listCoachHolds() {
  return wx.cloud.callFunction({ name: 'listCoachHolds' });
}

/** 取消一条本人占用 @param {{ holdId: string }} payload */
function cancelCoachHold(payload) {
  return wx.cloud.callFunction({
    name: 'cancelCoachHold',
    data: payload || {},
  });
}

/**
 * 批量更新本人占用的课程类型/规模
 * @param {{ holdIds: string[], lessonType: string, pairMode?: string, groupMode?: string }} payload
 */
function updateCoachHolds(payload) {
  return wx.cloud.callFunction({
    name: 'updateCoachHolds',
    data: payload || {},
  });
}

module.exports = {
  getVenues,
  getCategories,
  getCourses,
  invalidateCourseCache,
  getUserByPhone,
  createUser,
  decryptPhoneNumber,
  updateUserByPhone,
  getMyBookings,
  getBookedSlots,
  coachHoldSlots,
  listCoachHolds,
  cancelCoachHold,
  updateCoachHolds,
};

