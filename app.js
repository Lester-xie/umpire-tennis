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
    wx.getSystemInfo({
      success: (res) => {
        console.log(res);
        
        this.globalData.screenInfo = {
          headerInfo: {
            headerPaddingTop: res.safeArea.top,
          },
        };
      },
    });
  }
});
