const { getMyBookings } = require('../../api/tennisDb');
const { buildCourtOrderDisplay } = require('../../utils/profileHistoryHelpers');

Page({
  data: {
    headerHeight: 0,
    contentHeight: 400,
    placeholderHeight: 0,
    isLoggedIn: false,
    courtOrders: [],
  },

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
    try {
      const cloudRes = await getMyBookings();
      const raw =
        cloudRes && cloudRes.result && Array.isArray(cloudRes.result.data)
          ? cloudRes.result.data
          : [];
      courtOrders = raw.map((order) => buildCourtOrderDisplay(order));
    } catch (e) {
      console.error('拉取订场历史失败', e);
    }
    this.setData({ courtOrders });
  },
});
