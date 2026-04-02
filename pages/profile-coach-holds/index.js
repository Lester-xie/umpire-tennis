const { listCoachHolds, cancelCoachHold, getUserByPhone } = require('../../api/tennisDb');
const { mergeCoachHoldDisplayRows } = require('../../utils/profileHistoryHelpers');

const STORAGE_KEYS = {
  userPhone: 'user_phone',
};

Page({
  data: {
    headerHeight: 0,
    contentHeight: 400,
    placeholderHeight: 0,
    isCoach: false,
    isManager: false,
    coachHolds: [],
    lottieLoadingVisible: false,
  },
  _loadingTaskCount: 0,

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
    this.beginLoading('加载中');
    const app = getApp();
    const isLoggedIn = app ? app.checkLogin() : false;
    const userPhone = wx.getStorageSync(STORAGE_KEYS.userPhone) || '';
    let isCoach = false;
    let isManager = false;
    if (isLoggedIn && userPhone) {
      try {
        const res = await getUserByPhone(userPhone);
        const user = res && res.data && res.data.length > 0 ? res.data[0] : null;
        isCoach = !!(user && user.isCoach);
        isManager = !!(user && user.isManager);
      } catch (e) {
        console.warn('profile-coach-holds role', e);
      }
    }
    this.setData({ isCoach, isManager });
    if (!isCoach) {
      this.setData({ coachHolds: [] });
      wx.showToast({ title: '仅教练可查看', icon: 'none' });
      const pages = getCurrentPages();
      if (pages.length > 1) {
        setTimeout(() => wx.navigateBack(), 400);
      }
      this.endLoading();
      return;
    }
    try {
      const cloudRes = await listCoachHolds();
      const raw =
        cloudRes && cloudRes.result && Array.isArray(cloudRes.result.data)
          ? cloudRes.result.data
          : [];
      const coachHolds = mergeCoachHoldDisplayRows(raw);
      this.setData({ coachHolds });
    } catch (e) {
      console.error('loadCoachHolds failed', e);
      this.setData({ coachHolds: [] });
    } finally {
      this.endLoading();
    }
  },

  handleCancelCoachHold(e) {
    if (!this.data.isCoach && !this.data.isManager) return;
    const idsStr = e.currentTarget.dataset.holdids != null ? String(e.currentTarget.dataset.holdids) : '';
    const holdIds = idsStr
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (holdIds.length === 0) return;
    const multi = holdIds.length > 1;
    wx.showModal({
      title: '取消占用',
      content: multi
        ? '将取消该次占用的全部时段，取消后将重新对会员开放预订。若已有学员报名，相关订单将一并处理。'
        : '取消后该时段将重新对会员开放预订。',
      confirmText: '取消占用',
      confirmColor: '#c62828',
      success: async (res) => {
        if (!res.confirm) return;
        this.beginLoading('处理中...');
        try {
          const cloudRes =
            holdIds.length === 1
              ? await cancelCoachHold({ holdId: holdIds[0] })
              : await cancelCoachHold({ holdIds });
          const r = (cloudRes && cloudRes.result) || {};
          this.endLoading();
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
          this.endLoading();
          console.error('cancelCoachHold', err);
          wx.showToast({ title: '网络异常', icon: 'none' });
        }
      },
    });
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
});
