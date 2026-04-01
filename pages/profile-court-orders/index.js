const { getMyBookings, cancelMemberBooking } = require('../../api/tennisDb');
const { buildCourtOrderDisplay } = require('../../utils/profileHistoryHelpers');

Page({
  data: {
    headerHeight: 0,
    contentHeight: 400,
    placeholderHeight: 0,
    isLoggedIn: false,
    courtOrders: [],
    lottieLoadingVisible: false,
  },
  _loadingTaskCount: 0,

  onShow() {
    const app = getApp();
    const isLoggedIn = app ? app.checkLogin() : false;
    this.setData({ isLoggedIn });
    this.loadCourtOrders();
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

  async loadCourtOrders() {
    let courtOrders = [];
    this.beginLoading('加载订单中');
    try {
      const cloudRes = await getMyBookings({ includePending: true });
      const raw =
        cloudRes && cloudRes.result && Array.isArray(cloudRes.result.data)
          ? cloudRes.result.data
          : [];
      courtOrders = raw.map((order) => buildCourtOrderDisplay(order));
    } catch (e) {
      console.error('拉取订场历史失败', e);
    } finally {
      this.endLoading();
    }
    this.setData({ courtOrders });
  },

  handleCancelBooking(e) {
    const bookingId = e.currentTarget.dataset.bookingid;
    if (!bookingId) return;
    wx.showModal({
      title: '取消订单',
      content:
        '确定取消该订单？已支付的金额将原路退回微信，已使用的课时将退回账户。距场次开始不足 6 小时时无法在线取消。',
      confirmText: '确定取消',
      confirmColor: '#c62828',
      success: async (res) => {
        if (!res.confirm) return;
        this.beginLoading('处理中');
        try {
          const cloudRes = await cancelMemberBooking({ bookingId });
          const r = (cloudRes && cloudRes.result) || {};
          this.endLoading();
          if (!r.ok) {
            wx.showToast({ title: r.errMsg || '取消失败', icon: 'none' });
            return;
          }
          wx.showToast({ title: '已取消', icon: 'success' });
          this.loadCourtOrders();
        } catch (err) {
          this.endLoading();
          console.error('cancelMemberBooking', err);
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
