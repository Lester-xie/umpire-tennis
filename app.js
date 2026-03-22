/** 与 profile/order-detail 等页一致：本地已存手机号表示用户曾完成注册/授权 */
const STORAGE_USER_PHONE = 'user_phone';

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
    this.restoreLoginSession();
  },
  /**
   * 冷启动时若本地已有手机号，静默 wx.login，恢复 globalData.isLoggedIn，
   * 避免每次重进小程序都显示未登录（仅内存态、未持久化导致）。
   */
  restoreLoginSession() {
    const phone = wx.getStorageSync(STORAGE_USER_PHONE);
    if (!phone) return;
    this.doLogin().catch((e) => {
      console.warn('restoreLoginSession failed', e);
    });
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
  /** 内存态 isLoggedIn 冷启动会丢；本地 user_phone 表示已注册，应视为已登录 */
  checkLogin() {
    if (this.globalData.isLoggedIn) return true;
    const phone = wx.getStorageSync(STORAGE_USER_PHONE);
    return !!phone;
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
