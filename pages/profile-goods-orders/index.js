const { formatGoodsOrderTime } = require('../../utils/profileHistoryHelpers');

const STORAGE_KEYS = {
  goodsOrders: 'goods_orders',
};

Page({
  data: {
    headerHeight: 0,
    contentHeight: 400,
    placeholderHeight: 0,
    goodsOrders: [],
  },

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

  loadGoodsOrders() {
    let goodsOrders = wx.getStorageSync(STORAGE_KEYS.goodsOrders) || [];
    if (!Array.isArray(goodsOrders)) goodsOrders = [];
    goodsOrders = goodsOrders.map((order) => {
      const time = order.createdAt ? formatGoodsOrderTime(order.createdAt) : '';
      return { ...order, formattedTime: time };
    });
    this.setData({ goodsOrders });
  },
});
