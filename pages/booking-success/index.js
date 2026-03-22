const STORAGE_KEY = 'booking_success_payload';

Page({
  data: {
    campusName: '',
    orderItems: [],
    contentScrollHeight: 400,
  },

  onLoad() {
    try {
      const payload = wx.getStorageSync(STORAGE_KEY);
      wx.removeStorageSync(STORAGE_KEY);
      if (payload && typeof payload === 'object') {
        this.setData({
          campusName: payload.campusName || '',
          orderItems: Array.isArray(payload.orderItems) ? payload.orderItems : [],
        });
      }
    } catch (e) {
      console.error('读取订场成功信息失败', e);
    }
    this.calculateContentScrollHeight();
  },

  onReady() {
    this.calculateContentScrollHeight();
  },

  calculateContentScrollHeight() {
    const windowInfo = wx.getWindowInfo();
    const windowHeight = windowInfo.windowHeight;
    const query = wx.createSelectorQuery();
    query.select('.header').boundingClientRect();
    query.exec((res) => {
      const headerRect = res[0];
      const headerHeight = headerRect ? headerRect.height : 0;
      const headerFallback = (windowInfo.statusBarHeight || 44) + 44;
      const finalHeaderHeight = headerHeight > 0 ? headerHeight : headerFallback;
      const safeAreaBottom = windowInfo.safeArea
        ? windowInfo.screenHeight - windowInfo.safeArea.bottom
        : 0;
      const footerHeight = 16 + 44 + safeAreaBottom + 8;
      const contentScrollHeight = Math.max(
        windowHeight - finalHeaderHeight - footerHeight - 10,
        200
      );
      this.setData({ contentScrollHeight });
    });
  },

  handleBackToBooking() {
    wx.switchTab({ url: '/pages/booking/index' });
  },
});
