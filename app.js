App({
  globalData: {
    brand: "昂湃网球",
    currentTabIndex: 0,
    shouldClearBookingData: false, // 是否需要清空预订页面数据
    isLoggedIn: false, // 仅当 wx.login 成功后为 true
    selectedVenue: null, // 用户选择的球场 { id, name, address, latitude, longitude }
  },
  onLaunch() {
    this.initSystemInfo();
    this.initCloud();
  },
  initCloud() {
    try {
      if (wx.cloud && wx.cloud.init) {
        wx.cloud.init();
      }
    } catch (e) {
      console.warn('wx.cloud.init failed', e);
    }
  },
  checkLogin() {
    return !!this.globalData.isLoggedIn;
  },
  // 调用微信小程序 wx.login 接口登录
  doLogin() {
    const app = this;
    return new Promise((resolve, reject) => {
      wx.login({
        success: (res) => {
          if (res.code) {
            app.globalData.isLoggedIn = true;
            // code 可发送至开发者后端，用于换取 openid、session_key 等
            resolve(res.code);
          } else {
            reject(new Error(res.errMsg || '登录失败'));
          }
        },
        fail: (err) => reject(err),
      });
    });
  },
  initSystemInfo() {
    const windowInfo = wx.getWindowInfo();
    const safeTop = windowInfo?.safeArea?.top;
    const fallback = windowInfo?.statusBarHeight || 0;
    this.globalData.screenInfo = {
      headerInfo: {
        headerPaddingTop: safeTop != null ? safeTop : fallback,
      },
    };
  }
});
