// 云数据库封装

const courseCache = require('./courseCache');

function getDb() {
  return wx.cloud.database();
}

/** 新注册用户默认头像（与 profile 页兜底图一致，小程序包内静态资源） */
const DEFAULT_USER_AVATAR = '/assets/images/default-avatar.jpg';

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
 * 课程列表：courseCache 拉取 db_course 并缓存；切换分类仅在内存筛选（新 schema 无 category 时等效于全部分类）。
 * 新 db_course：name、description、image、venueId、typeMap；旧版仍可含 category、type 外键。
 * @param {string} filterCategoryId
 * @param {{ forceRefresh?: boolean }} [options]
 * @returns {Promise<{ data: object[], scaleById: Record<string,object>, categoryById: Record<string,object> }>}
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
 * 新增用户（未传 avatar 或为空时使用包内默认图）
 */
function createUser({ phone, name, avatar } = {}) {
  const db = getDb();
  const avatarTrim = avatar != null ? String(avatar).trim() : '';
  const data = {
    phone: phone || '',
    name: name || '',
    avatar: avatarTrim || DEFAULT_USER_AVATAR,
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
 * 当前登录用户订场记录：以本地手机号查询 db_booking（云函数校验 db_user 与当前微信绑定）。
 * @param {{ includePending?: boolean }} [options] includePending 为 true 时含待支付/确认中
 */
function getMyBookings(options) {
  const phone = String(wx.getStorageSync('user_phone') || '').trim();
  const includePending = !!(options && options.includePending);
  return wx.cloud.callFunction({
    name: 'listBookings',
    data: { phone, ...(includePending ? { includePending: true } : {}) },
  });
}

/**
 * 会员取消订场/教练课：首场开始前满 6 小时可取消；已付原路退微信、退课时（云函数内校验）
 * @param {{ bookingId: string }} payload
 */
function cancelMemberBooking(payload) {
  const phone = String(wx.getStorageSync('user_phone') || '').trim();
  return wx.cloud.callFunction({
    name: 'cancelMemberBooking',
    data: {
      ...(payload || {}),
      phone,
    },
  });
}

/** 当前用户已支付课时包订单（db_course_purchase，云函数校验 openid+phone） */
function listCoursePurchases() {
  const phone = String(wx.getStorageSync('user_phone') || '').trim();
  return wx.cloud.callFunction({
    name: 'listCoursePurchases',
    data: { phone },
  });
}

/** 当前用户在指定场馆下的各课程剩余课时（db_member_course_hours 按 venueId 区分） */
function listMemberCourseHours(venueId) {
  const phone = String(wx.getStorageSync('user_phone') || '').trim();
  const vid = venueId != null ? String(venueId).trim() : '';
  return wx.cloud.callFunction({
    name: 'listMemberCourseHours',
    data: { phone, venueId: vid },
  });
}

/** 当前用户全部场馆下的剩余课时（一次查询，用于「我的课时」等） */
function listAllMemberCourseHours() {
  const phone = String(wx.getStorageSync('user_phone') || '').trim();
  return wx.cloud.callFunction({
    name: 'listMemberCourseHours',
    data: { phone, allVenues: true },
  });
}

/**
 * 使用已购课时预订教练占用时段
 * @param {{ phone: string, holdIds: string[], snapshot: object }} payload
 */
function completeCoachBookingWithHours(payload) {
  return wx.cloud.callFunction({
    name: 'completeCoachBookingWithHours',
    data: payload || {},
  });
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
 * 占用场地（云函数内：畅打需 isManager，体验/正课/团课需 isCoach）
 * @param {{ venueId: string, venueName?: string, orderDate: string, slots: Array<{courtId:number, slotIndex:number}>, lessonType: string, pairMode?: string, groupMode?: string }} payload
 */
function coachHoldSlots(payload) {
  return wx.cloud.callFunction({
    name: 'coachHoldSlots',
    data: payload || {},
  });
}

/**
 * 当前教练占用列表
 * @param {{ venueId?: string, orderDate?: string, includeReleasedForSession?: boolean }} [payload] 约场页传场馆+日期+includeReleasedForSession 可含 released 占用
 */
function listCoachHolds(payload) {
  return wx.cloud.callFunction({
    name: 'listCoachHolds',
    data: payload || {},
  });
}

/**
 * 取消教练占用：可传 holdId 或 holdIds；已有学员时作废同场次订单并退回已扣课时（微信实付需线下协调退款）
 * @param {{ holdId?: string, holdIds?: string[] }} payload
 */
function cancelCoachHold(payload) {
  return wx.cloud.callFunction({
    name: 'cancelCoachHold',
    data: payload || {},
  });
}

/**
 * 批量更新本人占用的课程类型/规模
 * @param {{ holdIds: string[], lessonType: string, pairMode?: string, groupMode?: string, scaleDisplayName?: string }} payload
 */
function updateCoachHolds(payload) {
  return wx.cloud.callFunction({
    name: 'updateCoachHolds',
    data: payload || {},
  });
}

module.exports = {
  DEFAULT_USER_AVATAR,
  getVenues,
  getCategories,
  getCourses,
  invalidateCourseCache,
  getUserByPhone,
  createUser,
  decryptPhoneNumber,
  updateUserByPhone,
  getMyBookings,
  cancelMemberBooking,
  listCoursePurchases,
  listMemberCourseHours,
  listAllMemberCourseHours,
  completeCoachBookingWithHours,
  getBookedSlots,
  coachHoldSlots,
  listCoachHolds,
  cancelCoachHold,
  updateCoachHolds,
};

