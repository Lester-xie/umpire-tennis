const {
  listCoursePurchases,
  getCourses,
  getMyBookings,
  listAllMemberCourseHours,
  refundExperienceCoursePurchase,
} = require('../../api/tennisDb');
const { normalizeVenueId } = require('../../utils/venueId');
const { hasExperienceCoachParticipation } = require('../../utils/experienceParticipation');
const { formatGoodsOrderTime } = require('../../utils/profileHistoryHelpers');
const { ALL_CATEGORY_ID } = require('../../utils/constants');
const {
  courseImageSource,
  DEFAULT_GOODS_IMAGE,
  indexDocsById,
} = require('../../utils/courseCatalog');

/** 与首页课程卡片一致：displayImage → picture/image → 默认图 */
function thumbUrlFromCourseDoc(course) {
  if (!course) return DEFAULT_GOODS_IMAGE;
  const d =
    course.displayImage != null && String(course.displayImage).trim() !== ''
      ? String(course.displayImage).trim()
      : '';
  if (d) return d;
  return courseImageSource(course) || DEFAULT_GOODS_IMAGE;
}

function isExperienceLessonKey(lk) {
  return String(lk || '').trim().toLowerCase().startsWith('experience:');
}

function hoursSumForVenueLesson(hoursRows, venueId, lessonKey) {
  const vid = normalizeVenueId(venueId);
  const lk = String(lessonKey || '').trim();
  if (!vid || !lk) return 0;
  let sum = 0;
  (hoursRows || []).forEach((r) => {
    if (normalizeVenueId(r.venueId) !== vid) return;
    if (String(r.lessonKey || '').trim() !== lk) return;
    sum += Number(r.hours) || 0;
  });
  return sum;
}

function pickCourse(map, courseId) {
  const a = String(courseId || '').trim();
  if (!a || !map) return null;
  if (map[a]) return map[a];
  const n = Number(a);
  if (Number.isFinite(n) && map[String(n)]) return map[String(n)];
  return null;
}

/** cloud:// 批量换临时 https，与 components/goods 行为一致 */
function resolveCloudImageUrls(urls) {
  const list = urls || [];
  const cloudIds = [...new Set(list.filter((u) => u && String(u).startsWith('cloud://')))];
  if (!cloudIds.length) {
    return Promise.resolve(list.slice());
  }
  return new Promise((resolve) => {
    wx.cloud.getTempFileURL({
      fileList: cloudIds.map((fileID) => ({ fileID, maxAge: 60 * 60 * 24 * 7 })),
      success: (res) => {
        const urlMap = Object.create(null);
        (res.fileList || []).forEach((f) => {
          if (f.fileID && f.tempFileURL) urlMap[f.fileID] = f.tempFileURL;
        });
        resolve(list.map((u) => (u && urlMap[u] ? urlMap[u] : u)));
      },
      fail: () => resolve(list.slice()),
    });
  });
}

Page({
  data: {
    headerHeight: 0,
    contentHeight: 400,
    placeholderHeight: 0,
    isLoggedIn: false,
    goodsOrders: [],
    lottieLoadingVisible: false,
  },
  _loadingTaskCount: 0,

  onShow() {
    this.loadGoodsOrders();
  },

  onReady() {
    this.calculateHeaderHeight();
    this.calculateContentHeight();
  },

  calculateHeaderHeight() {
    const query = wx.createSelectorQuery();
    query.select('.header').boundingClientRect();
    query.exec((res) => {
      const headerRect = res[0];
      if (headerRect && headerRect.height > 0) {
        this.setData({ headerHeight: headerRect.height });
      } else {
        const app = getApp();
        const headerPaddingTop = app?.globalData?.screenInfo?.headerInfo?.headerPaddingTop || 0;
        this.setData({ headerHeight: headerPaddingTop + 55 });
      }
    });
  },

  calculateContentHeight() {
    const windowInfo = wx.getWindowInfo();
    const windowHeight = windowInfo.windowHeight;
    const query = wx.createSelectorQuery();
    query.select('.header').boundingClientRect();
    query.exec((res) => {
      const headerRect = res[0];
      const headerH = headerRect?.height || 55;
      const safeAreaBottom = windowInfo.safeArea
        ? windowInfo.screenHeight - windowInfo.safeArea.bottom
        : 0;
      const contentHeight = Math.max(windowHeight - headerH - safeAreaBottom - 24, 300);
      this.setData({
        contentHeight,
        placeholderHeight: safeAreaBottom + 24,
      });
    });
  },

  async loadGoodsOrders() {
    const app = getApp();
    const isLoggedIn = app ? app.checkLogin() : false;
    const phone = String(wx.getStorageSync('user_phone') || '').trim();

    if (!isLoggedIn || !phone) {
      this.setData({ isLoggedIn: false, goodsOrders: [] });
      return;
    }

    let goodsOrders = [];
    this.beginLoading('加载订单中');
    try {
      const [cloudRes, bookingsRes, hoursRes] = await Promise.all([
        listCoursePurchases(),
        getMyBookings({ includePending: true }),
        listAllMemberCourseHours(),
      ]);
      const raw =
        cloudRes && cloudRes.result && Array.isArray(cloudRes.result.data)
          ? cloudRes.result.data
          : [];
      const bookingList =
        bookingsRes && bookingsRes.result && Array.isArray(bookingsRes.result.data)
          ? bookingsRes.result.data
          : [];
      const hoursRows =
        hoursRes && hoursRes.result && Array.isArray(hoursRes.result.data)
          ? hoursRes.result.data
          : [];
      const hasParticipatedExperience = hasExperienceCoachParticipation(bookingList);
      let courseRows = [];
      try {
        const coursePack = await getCourses(ALL_CATEGORY_ID);
        courseRows = coursePack.data || [];
      } catch (e2) {
        console.warn('拉取 db_course 失败，订单缩略图使用默认图', e2);
      }
      const courseById = indexDocsById(courseRows);
      const thumbRaws = raw.map((row) => {
        const course = pickCourse(courseById, row.courseId);
        return thumbUrlFromCourseDoc(course);
      });
      const thumbUrls = await resolveCloudImageUrls(thumbRaws);
      goodsOrders = raw.map((row, i) => {
        const ts = row.paidAt != null ? row.paidAt : row.createdAt;
        const fen = Number(row.totalFee) || 0;
        const yuan = fen > 0 ? Math.round(fen) / 100 : 0;
        const grantHours = Math.floor(Number(row.grantHours) || 0);
        const desc =
          row.goodDesc != null && String(row.goodDesc).trim() !== ''
            ? String(row.goodDesc).trim()
            : grantHours > 0
              ? `课程课时 ${grantHours} 小时`
              : '课程订单';
        const lessonKey = String(row.lessonKey || '').trim();
        const venueIdNorm = normalizeVenueId(row.venueId);
        const hoursRem = hoursSumForVenueLesson(hoursRows, row.venueId, lessonKey);
        const showRefundExperience =
          hasParticipatedExperience &&
          isExperienceLessonKey(lessonKey) &&
          hoursRem > 0 &&
          String(row.status || '') === 'paid' &&
          String(row.refundStatus || '') !== 'success';
        return {
          orderNumber: String(row.outTradeNo || row._id || ''),
          totalPrice: yuan,
          formattedTime: formatGoodsOrderTime(ts),
          goodItem: {
            image: thumbUrls[i] || DEFAULT_GOODS_IMAGE,
            desc,
          },
          showRefundExperience,
          refundVenueId: venueIdNorm,
          refundLessonKey: lessonKey,
        };
      });
    } catch (e) {
      console.error('拉取课程订单失败', e);
    } finally {
      this.endLoading();
    }

    this.setData({ isLoggedIn: true, goodsOrders });
  },

  onUnload() {
    this._loadingTaskCount = 0;
    this.setData({ lottieLoadingVisible: false });
  },

  beginLoading(title) {
    this._loadingTaskCount = (this._loadingTaskCount || 0) + 1;
    if (this._loadingTaskCount === 1) {
      this.setData({ lottieLoadingVisible: true });
    }
  },

  endLoading() {
    this._loadingTaskCount = Math.max(0, (this._loadingTaskCount || 0) - 1);
    if (this._loadingTaskCount === 0) {
      this.setData({ lottieLoadingVisible: false });
    }
  },

  onRefundExperienceTap(e) {
    const ds = e.currentTarget.dataset || {};
    const venueId = String(ds.venueid || '').trim();
    const lessonKey = String(ds.lessonkey || '').trim();
    if (!venueId || !lessonKey) return;
    wx.showModal({
      title: '确认退款',
      content:
        '仅适用于已参加过体验课但仍有余课时的情形。将按剩余课时比例原路退回微信，成功后对应课时将从账户扣除。是否继续？',
      confirmText: '确定退款',
      success: async (res) => {
        if (!res.confirm) return;
        this.beginLoading('处理中');
        try {
          const cloudRes = await refundExperienceCoursePurchase({ venueId, lessonKey });
          const r = cloudRes && cloudRes.result ? cloudRes.result : {};
          if (!r.ok) {
            wx.showToast({ title: r.errMsg || '退款失败', icon: 'none' });
            return;
          }
          const fen = Math.floor(Number(r.refundFee) || 0);
          const yuan = (fen / 100).toFixed(2);
          wx.showToast({ title: `已退款 ${yuan} 元`, icon: 'success' });
          await this.loadGoodsOrders();
        } catch (err) {
          console.error('refundExperience', err);
          wx.showToast({ title: '请求失败', icon: 'none' });
        } finally {
          this.endLoading();
        }
      },
    });
  },
});
