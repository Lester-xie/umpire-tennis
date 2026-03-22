const { listCoursePurchases } = require('../../api/tennisDb');
const { formatGoodsOrderTime } = require('../../utils/profileHistoryHelpers');

const DEFAULT_COURSE_THUMB = '/assets/images/goods/good1.jpg';

Page({
  data: {
    headerHeight: 0,
    contentHeight: 400,
    placeholderHeight: 0,
    isLoggedIn: false,
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

  async loadGoodsOrders() {
    const app = getApp();
    const isLoggedIn = app ? app.checkLogin() : false;
    const phone = String(wx.getStorageSync('user_phone') || '').trim();

    if (!isLoggedIn || !phone) {
      this.setData({ isLoggedIn: false, goodsOrders: [] });
      return;
    }

    let goodsOrders = [];
    try {
      const cloudRes = await listCoursePurchases();
      const raw =
        cloudRes && cloudRes.result && Array.isArray(cloudRes.result.data)
          ? cloudRes.result.data
          : [];
      goodsOrders = raw.map((row) => {
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
        return {
          orderNumber: String(row.outTradeNo || row._id || ''),
          totalPrice: yuan,
          formattedTime: formatGoodsOrderTime(ts),
          goodItem: {
            image: DEFAULT_COURSE_THUMB,
            desc,
          },
        };
      });
    } catch (e) {
      console.error('拉取课程订单失败', e);
    }

    this.setData({ isLoggedIn: true, goodsOrders });
  },
});
