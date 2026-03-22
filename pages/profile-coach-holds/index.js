const { listCoachHolds, cancelCoachHold, getUserByPhone } = require('../../api/tennisDb');
const { buildCoachHoldRow } = require('../../utils/profileHistoryHelpers');

const STORAGE_KEYS = {
  userPhone: 'user_phone',
};

Page({
  data: {
    headerHeight: 0,
    contentHeight: 400,
    placeholderHeight: 0,
    isCoach: false,
    coachHolds: [],
  },

  onShow() {
    this.refreshRoleAndHolds();
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

  async refreshRoleAndHolds() {
    const app = getApp();
    const isLoggedIn = app ? app.checkLogin() : false;
    const userPhone = wx.getStorageSync(STORAGE_KEYS.userPhone) || '';
    let isCoach = false;
    if (isLoggedIn && userPhone) {
      try {
        const res = await getUserByPhone(userPhone);
        const user = res && res.data && res.data.length > 0 ? res.data[0] : null;
        isCoach = !!(user && user.isCoach);
      } catch (e) {
        console.warn('profile-coach-holds role', e);
      }
    }
    this.setData({ isCoach });
    if (!isCoach) {
      this.setData({ coachHolds: [] });
      wx.showToast({ title: '仅教练可查看', icon: 'none' });
      const pages = getCurrentPages();
      if (pages.length > 1) {
        setTimeout(() => wx.navigateBack(), 400);
      }
      return;
    }
    try {
      const cloudRes = await listCoachHolds();
      const raw =
        cloudRes && cloudRes.result && Array.isArray(cloudRes.result.data)
          ? cloudRes.result.data
          : [];
      const coachHolds = raw.map((row) => buildCoachHoldRow(row)).filter(Boolean);
      this.setData({ coachHolds });
    } catch (e) {
      console.error('loadCoachHolds failed', e);
      this.setData({ coachHolds: [] });
    }
  },

  handleCancelCoachHold(e) {
    if (!this.data.isCoach) return;
    const holdId = e.currentTarget.dataset.holdid;
    if (!holdId) return;
    wx.showModal({
      title: '取消占用',
      content: '取消后该时段将重新对会员开放预订。',
      confirmText: '取消占用',
      confirmColor: '#c62828',
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '处理中...' });
        try {
          const cloudRes = await cancelCoachHold({ holdId });
          const r = (cloudRes && cloudRes.result) || {};
          wx.hideLoading();
          if (!r.ok) {
            wx.showToast({
              title: r.errMsg || '取消失败',
              icon: 'none',
            });
            return;
          }
          wx.showToast({ title: '已取消占用', icon: 'success' });
          this.refreshRoleAndHolds();
        } catch (err) {
          wx.hideLoading();
          console.error('cancelCoachHold', err);
          wx.showToast({ title: '网络异常', icon: 'none' });
        }
      },
    });
  },
});
