const {
  getVenues,
  listAllMemberCourseHours,
  refundExperienceCoursePurchase,
  getMyBookings,
} = require('../../api/tennisDb');
const { formatLessonKeyDisplay } = require('../../utils/lessonKey');
const { normalizeVenueId } = require('../../utils/venueId');
const { hasExperienceCoachParticipation } = require('../../utils/experienceParticipation');

function buildSections(venueRows, venueNameById, hasParticipatedExperience) {
  const byVenue = {};
  (venueRows || []).forEach((row) => {
    const vid = normalizeVenueId(row.venueId);
    const hours = Number(row.hours) || 0;
    if (hours <= 0 || !vid) return;
    const lessonKey = String(row.lessonKey || '').trim() || '—';
    if (!byVenue[vid]) byVenue[vid] = {};
    const bucket = byVenue[vid];
    if (!bucket[lessonKey]) {
      bucket[lessonKey] = {
        lessonKey,
        lessonLabel: formatLessonKeyDisplay(row.lessonKey),
        hours: 0,
      };
    }
    bucket[lessonKey].hours += hours;
  });
  const sections = Object.keys(byVenue).map((vid) => ({
    venueId: vid,
    venueName: venueNameById[vid] || `场馆 ${vid}`,
    rows: Object.values(byVenue[vid]).map((row) => {
      const lk = String(row.lessonKey || '').trim();
      const isExp = lk.toLowerCase().startsWith('experience:');
      return {
        ...row,
        showRefundExperience: isExp && row.hours > 0 && !!hasParticipatedExperience,
      };
    }),
  }));
  sections.sort((a, b) => a.venueName.localeCompare(b.venueName, 'zh-CN'));
  return sections;
}

Page({
  data: {
    headerHeight: 0,
    contentHeight: 400,
    placeholderHeight: 0,
    isLoggedIn: false,
    sections: [],
    /** 与「申请退款」按钮一致：已参加过体验课且仍有余下体验课时 */
    showRefundExperienceHint: false,
    lottieLoadingVisible: false,
  },
  _loadingTaskCount: 0,

  onShow() {
    this.refresh();
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

  async refresh() {
    const app = getApp();
    const isLoggedIn = app ? app.checkLogin() : false;
    const phone = String(wx.getStorageSync('user_phone') || '').trim();

    if (!isLoggedIn || !phone) {
      this.setData({ isLoggedIn: false, sections: [], showRefundExperienceHint: false });
      return;
    }

    this.beginLoading('加载课时中');
    try {
      const [venuesRes, hoursRes, bookingsRes] = await Promise.all([
        getVenues(),
        listAllMemberCourseHours(),
        getMyBookings({ includePending: true }),
      ]);
      const venues = (venuesRes && venuesRes.data) || [];
      const venueNameById = {};
      venues.forEach((v) => {
        const id = normalizeVenueId(v._id);
        if (id) venueNameById[id] = (v.name && String(v.name).trim()) || id;
      });
      const raw =
        hoursRes && hoursRes.result && Array.isArray(hoursRes.result.data)
          ? hoursRes.result.data
          : [];
      const bookingList =
        bookingsRes && bookingsRes.result && Array.isArray(bookingsRes.result.data)
          ? bookingsRes.result.data
          : [];
      const hasParticipatedExperience = hasExperienceCoachParticipation(bookingList);
      const sections = buildSections(raw, venueNameById, hasParticipatedExperience);
      const showRefundExperienceHint = sections.some((s) =>
        (s.rows || []).some((r) => r.showRefundExperience),
      );
      this.setData({ isLoggedIn: true, sections, showRefundExperienceHint });
    } catch (e) {
      console.error('加载课时失败', e);
      wx.showToast({ title: '加载失败', icon: 'none' });
      this.setData({ isLoggedIn: true, sections: [], showRefundExperienceHint: false });
    } finally {
      this.endLoading();
    }
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
          await this.refresh();
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
