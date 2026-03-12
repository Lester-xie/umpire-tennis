const STORAGE_KEYS = {
  profileVisited: 'profile_has_visited',
  courtOrders: 'court_orders',
  goodsOrders: 'goods_orders',
  userAvatar: 'user_avatar',
  userPhoneCode: 'user_phone_code',
  userPhone: 'user_phone',
  userNickname: 'user_nickname',
};

Page({
  data: {
    isLoggedIn: false,
    userAvatar: '',
    userNickname: '',
    userDisplayName: '点击登录', // 用于 user-name 展示：未登录为「点击登录」，登录后为昵称或「昂湃用户」
    userPhone: '', // 展示用，或手动填写
    headerHeight: 0,
    contentHeight: 400,
    placeholderHeight: 0,
    courtOrders: [],
    goodsOrders: [],
    showLoginModal: false,
  },

  onLoad() {
    const app = getApp();
    if (app) {
      const isLoggedIn = app.checkLogin();
      const userNickname = wx.getStorageSync(STORAGE_KEYS.userNickname) || '';
      const userDisplayName = isLoggedIn ? (userNickname || '昂湃用户') : '点击登录';
      this.setData({ isLoggedIn, userNickname, userDisplayName });
    }
  },

  onShow() {
    const app = getApp();
    const isLoggedIn = app ? app.checkLogin() : false;
    const userAvatar = wx.getStorageSync(STORAGE_KEYS.userAvatar) || '';
    const userNickname = wx.getStorageSync(STORAGE_KEYS.userNickname) || '';
    const userPhone = wx.getStorageSync(STORAGE_KEYS.userPhone) || '';
    const userDisplayName = isLoggedIn ? (userNickname || '昂湃用户') : '点击登录';
    this.setData({ isLoggedIn, userAvatar, userNickname, userDisplayName, userPhone });
    this.loadOrderHistory();
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
    const systemInfo = wx.getSystemInfoSync();
    const windowHeight = systemInfo.windowHeight;
    const query = wx.createSelectorQuery();
    query.select('.header').boundingClientRect();
    query.select('.tab-bar').boundingClientRect();
    query.exec((res) => {
      const headerRect = res[0];
      const tabBarRect = res[1];
      const headerHeight = headerRect?.height || 55;
      const tabBarHeight = tabBarRect?.height || 60;
      const safeAreaBottom = systemInfo.safeArea
        ? systemInfo.screenHeight - systemInfo.safeArea.bottom
        : 0;
      const contentHeight = windowHeight - headerHeight - safeAreaBottom - tabBarHeight - 20;
      this.setData({
        contentHeight: Math.max(contentHeight, 400),
        placeholderHeight: safeAreaBottom + tabBarHeight + 30,
      });
    });
  },

  loadOrderHistory() {
    try {
      let courtOrders = wx.getStorageSync(STORAGE_KEYS.courtOrders) || [];
      let goodsOrders = wx.getStorageSync(STORAGE_KEYS.goodsOrders) || [];
      if (!Array.isArray(courtOrders)) courtOrders = [];
      if (!Array.isArray(goodsOrders)) goodsOrders = [];

      // 为订场订单生成展示摘要
      courtOrders = courtOrders.map((order) => {
        const parts = [];
        (order.orderItems || []).forEach((oi) => {
          const slots = (oi.timeSlots || []).map((ts) => ts.timeRange).join('、');
          if (oi.courtName && slots) {
            parts.push(`${oi.courtName} ${slots}`);
          }
        });
        return { ...order, displaySummary: parts.join(' | ') || '场地预订' };
      });

      // 为团购订单生成展示时间
      goodsOrders = goodsOrders.map((order) => {
        const time = order.createdAt
          ? this.formatOrderTime(order.createdAt)
          : '';
        return { ...order, formattedTime: time };
      });

      this.setData({ courtOrders, goodsOrders });
    } catch (e) {
      console.error('加载订单历史失败', e);
    }
  },

  formatOrderTime(timestamp) {
    if (!timestamp) return '';
    const d = new Date(timestamp);
    const m = d.getMonth() + 1;
    const day = d.getDate();
    const h = d.getHours();
    const min = d.getMinutes();
    return `${m}月${day}日 ${h < 10 ? '0' + h : h}:${min < 10 ? '0' + min : min}`;
  },

  // 授权手机号注册：成功后再执行 wx.login，并跳转完善资料
  onPhoneRegister(e) {
    const { code, errMsg } = e.detail || {};
    if (code) {
      wx.setStorageSync(STORAGE_KEYS.userPhoneCode, code);
      this.setData({ showLoginModal: false });
      const app = getApp();
      if (!app) return;
      wx.showLoading({ title: '注册中...' });
      app
        .doLogin()
        .then(() => {
          wx.hideLoading();
          this.setData({
            isLoggedIn: true,
            userDisplayName: wx.getStorageSync(STORAGE_KEYS.userNickname) || '昂湃用户',
          });
          wx.navigateTo({ url: '/pages/complete-profile/index' });
        })
        .catch(() => {
          wx.hideLoading();
          wx.showToast({ title: '登录失败，请重试', icon: 'none' });
        });
    } else if (errMsg && !errMsg.includes('cancel')) {
      wx.showToast({ title: '授权失败，请重试', icon: 'none' });
    }
  },

  // 关闭登录弹窗
  handleCloseLoginModal() {
    this.setData({ showLoginModal: false });
  },

  // 点击用户卡片：未登录时弹出手机号注册弹窗，已登录时进入完善资料
  handleUserCardTap() {
    if (!this.data.isLoggedIn) {
      this.setData({ showLoginModal: true });
    } else {
      wx.navigateTo({ url: '/pages/complete-profile/index' });
    }
  },
});
