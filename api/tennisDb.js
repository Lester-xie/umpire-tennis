// 云数据库封装

const courseCache = require('./courseCache');
const { venueIdLooseEqual } = require('../utils/venueId');

/** 与 app.js、pages/location 一致 */
const STORAGE_SELECTED_VENUE = 'selected_venue';

function getDb() {
  return wx.cloud.database();
}

/** 新注册用户默认头像（与 profile 页兜底图一致，小程序包内静态资源） */
const DEFAULT_USER_AVATAR = '/assets/images/default-avatar.jpg';

/**
 * 获取场馆列表（增删改见云函数 adminVenue，仅 isManager）
 * venue 集合建议字段：
 * - name
 * - address
 * - latitude
 * - longitude
 * - （可选）image
 * - courtList: [{ name, priceList, vipPriceList?, specialPrice? }] — 各 14 段；周末一口价 specialPrice 仅非 VIP 订场生效
 * - categoryList: 教练课用途与会员默认「场次」价，见 utils/venueCategoryList.js（旧库可能仍为 category_list，读时兼容）
 */
function getVenues() {
  const db = getDb();
  return db.collection('db_venue').get();
}

/**
 * 与 pages/location loadVenues 映射一致；保留云库其它字段，避免后台增字段后客户端丢数据。
 */
function normalizeVenueDoc(v, idx) {
  if (!v) return null;
  const i = idx != null ? idx : 0;
  const id = v.id || v.venueId || v._id || String(v._id || i);
  const image =
    v.image ||
    (i % 2 === 0 ? '/assets/images/court1.jpg' : '/assets/images/court2.jpg');
  const mergedCategoryList =
    v.categoryList != null
      ? v.categoryList
      : v.category_list != null
        ? v.category_list
        : [];
  const { category_list, ...restVenue } = v;
  return {
    ...restVenue,
    id,
    name: v.name != null ? String(v.name) : '',
    address: v.address != null ? String(v.address) : '',
    latitude: v.latitude,
    longitude: v.longitude,
    image,
    courtList: Array.isArray(v.courtList) ? v.courtList : [],
    categoryList: Array.isArray(mergedCategoryList) ? mergedCategoryList : [],
  };
}

/**
 * 按逻辑 id 拉取单条场馆（优先 doc / where，避免整表 get 的缓存与带宽问题）。
 */
function fetchVenueRawByLogicalId(wantId) {
  const db = getDb();
  const s = String(wantId).trim();

  const fromFullList = () =>
    getVenues().then((res) => {
      const docs = res && res.data ? res.data : [];
      for (let i = 0; i < docs.length; i += 1) {
        const r = docs[i];
        const id = r.id || r.venueId || r._id || String(r._id || i);
        if (venueIdLooseEqual(id, wantId)) return r;
      }
      return null;
    });

  const tryWhere = (field) =>
    db
      .collection('db_venue')
      .where({ [field]: s })
      .limit(1)
      .get()
      .then((res) => (res.data && res.data[0] ? res.data[0] : null))
      .catch(() => null);

  if (/^[a-fA-F0-9]{24}$/.test(s)) {
    return db
      .collection('db_venue')
      .doc(s)
      .get()
      .then((res) => (res && res.data ? res.data : null))
      .catch(() => null)
      .then((row) => row || tryWhere('id'))
      .then((row) => row || tryWhere('venueId'))
      .then((row) => row || fromFullList());
  }

  return tryWhere('id').then((row) => row || tryWhere('venueId')).then((row) => row || fromFullList());
}

/**
 * 从 db_venue 重拉当前已选场馆并写回 globalData 与本地缓存。
 * 订场依赖内存中的 courtList、名称等任意字段，任意后台变更后都应调用以与云端一致。
 * @param {WechatMiniprogram.App.Instance} [appInstance] App.onShow 等时机 getApp() 可能为 undefined，可传入 this
 */
function refreshSelectedVenueFromCloud(appInstance) {
  const app =
    appInstance && appInstance.globalData
      ? appInstance
      : typeof getApp === 'function'
        ? getApp()
        : null;
  if (!app || !app.globalData) {
    return Promise.resolve(null);
  }
  const current = app.globalData.selectedVenue;
  if (!current || current.id == null || String(current.id).trim() === '') {
    return Promise.resolve(null);
  }
  const wantId = current.id;
  return fetchVenueRawByLogicalId(wantId).then((raw) => {
    if (!raw) return null;
    return normalizeVenueDoc(raw, 0);
  }).then((normalized) => {
    if (!normalized) return null;
    app.globalData.selectedVenue = normalized;
    try {
      wx.setStorageSync(STORAGE_SELECTED_VENUE, normalized);
    } catch (e) {
      console.warn('refreshSelectedVenueFromCloud storage', e);
    }
    return normalized;
  });
}

/**
 * 课程列表：courseCache 拉取 db_course 并缓存；切换分类仅在内存筛选（新 schema 无 category 时等效于全部分类）。
 * 新 db_course：name、description、image、venueId、typeMap；旧版仍可含 category、type 外键。
 * @param {string} filterCategoryId
 * @param {{ forceRefresh?: boolean }} [options]
 * @returns {Promise<{ data: object[] }>}
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
 * 体验课课时包原路退款（须已登录且手机号与 openid 绑定）
 * @param {{ venueId: string, lessonKey: string }} payload
 */
function refundExperienceCoursePurchase(payload) {
  const phone = String(wx.getStorageSync('user_phone') || '').trim();
  return wx.cloud.callFunction({
    name: 'refundExperienceCoursePurchase',
    data: {
      phone,
      ...(payload || {}),
    },
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
 * 占用场地（云函数内：畅打需 isManager；体验/正课/团课需 isCoach）
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

/** 管理员：按手机号设置教练/VIP（isManager 仅数据库维护，见云函数说明） */
function adminSetUserRoles(payload) {
  return wx.cloud.callFunction({
    name: 'adminSetUserRoles',
    data: payload || {},
  });
}

/** 管理员：按手机号查询用户昵称、头像、VIP/教练（需 isManager） */
function adminGetUserByPhone(payload) {
  return wx.cloud.callFunction({
    name: 'adminGetUserByPhone',
    data: payload || {},
  });
}

/** 管理员：更新课程文档 */
function adminUpdateCourse(payload) {
  return wx.cloud.callFunction({
    name: 'adminUpdateCourse',
    data: payload || {},
  });
}

/** 管理员：代教练/管理员写入场地占用 */
function adminCoachHoldForCoach(payload) {
  return wx.cloud.callFunction({
    name: 'adminCoachHoldForCoach',
    data: payload || {},
  });
}

/** 管理员：锁场（venue_lock，会员侧显示已占用；走 adminVenue 云函数，避免单独部署） */
function adminVenueSlotLock(payload) {
  const p = payload || {};
  return wx.cloud.callFunction({
    name: 'adminVenue',
    data: {
      action: 'venueSlotLock',
      venueId: p.venueId,
      orderDate: p.orderDate,
      venueName: p.venueName,
      slots: p.slots,
    },
  });
}

/** 管理员：按月交易汇总 */
function adminOrderStatsByMonth(payload) {
  return wx.cloud.callFunction({
    name: 'adminOrderStatsByMonth',
    data: payload || {},
  });
}

/** 管理员：按自然月统计各教练教练课（体验 / 正课 1v1·1v2）节数与金额 */
function adminCoachMonthStats(payload) {
  return wx.cloud.callFunction({
    name: 'adminCoachMonthStats',
    data: payload || {},
  });
}

/** 管理员：场馆/场地 CRUD，event.action: list | get | create | update | remove */
function adminVenue(payload) {
  return wx.cloud.callFunction({
    name: 'adminVenue',
    data: payload || {},
  });
}

module.exports = {
  DEFAULT_USER_AVATAR,
  getVenues,
  refreshSelectedVenueFromCloud,
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
  refundExperienceCoursePurchase,
  completeCoachBookingWithHours,
  getBookedSlots,
  coachHoldSlots,
  listCoachHolds,
  cancelCoachHold,
  updateCoachHolds,
  adminSetUserRoles,
  adminGetUserByPhone,
  adminUpdateCourse,
  adminCoachHoldForCoach,
  adminVenueSlotLock,
  adminOrderStatsByMonth,
  adminCoachMonthStats,
  adminVenue,
};

