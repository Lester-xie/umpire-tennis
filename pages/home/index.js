Page({
  data: {
    headerHeight: 0, // header 高度
    contentHeight: 400,
    placeholderHeight: 0,
  },
  onLoad() {
    // wx.cloud.callFunction({
    //   name: 'pay',
    //   data: {
    //     // totalFee：订单金额，单位「分」，必须是整数（例如 1 表示 1 分，100 表示 1 元）
    //     totalFee: 1,
    //   },
    //   success: (res) => {
    //     const result = res.result || {};
    //     const payment = result.payment;
    //     // 统一下单失败时 returnCode 为 FAIL，不会有 payment；errMsg 仍可能是 cloudPay.unifiedOrder:ok（仅表示云函数调用成功）
    //     if (result.returnCode !== 'SUCCESS' || !payment) {
    //       console.error('unifiedOrder 失败', result);
    //       wx.showToast({
    //         title: result.returnMsg || '下单失败',
    //         icon: 'none',
    //       });
    //       return;
    //     }
    //     console.log('payment', payment);
    //     wx.requestPayment({
    //       ...payment,
    //       success(payRes) {
    //         console.log('pay success', payRes);
    //       },
    //       fail(err) {
    //         console.error('pay fail', err);
    //       },
    //     });
    //   },
    //   fail: console.error,
    // });
  },
  onReady() {
    // 页面渲染完成后计算 header 高度（只计算 title 部分）
    this.calculateHeaderHeight();
    this.calculateContentHeight();
  },
  // 计算 header 高度（只计算 title 部分）
  calculateHeaderHeight() {
    const query = wx.createSelectorQuery();
    query.select('.header-wrapper').boundingClientRect();
    query.exec((res) => {
      const headerRect = res[0];
      if (headerRect) {
        this.setData({
          headerHeight: headerRect.height,
        });
      } else {
        // 如果查询不到，使用默认值（安全区域顶部 + title 高度）
        const app = getApp();
        let headerPaddingTop = 0;
        if (app && app.globalData && app.globalData.screenInfo && app.globalData.screenInfo.headerInfo) {
          headerPaddingTop = app.globalData.screenInfo.headerInfo.headerPaddingTop || 0;
        }
        // title 高度约 55px（padding-top 30px + title 20px + margin-top 5px）
        this.setData({
          headerHeight: headerPaddingTop + 55,
        });
      }
    });
  },
  
  // 计算 content 高度：100vh - header 高度 - 底部安全距离 - custom-tab-bar 高度
  calculateContentHeight() {
    const windowInfo = wx.getWindowInfo();
    const windowHeight = windowInfo.windowHeight; // 100vh 对应的像素值
    
    // 查询 header 和 tab-bar 的实际高度
    const query = wx.createSelectorQuery();
    query.select('.header').boundingClientRect();
    query.select('.tab-bar').boundingClientRect();
    query.exec((res) => {
      const headerRect = res[0];
      const tabBarRect = res[1];
      
      // 获取 header 高度
      const headerHeight = headerRect ? headerRect.height : 0;
      
      // 如果查询不到 header，使用默认值（headerPaddingTop + 25）
      let finalHeaderHeight = headerHeight;
      if (!headerHeight || headerHeight === 0) {
        const app = getApp();
        let headerPaddingTop = 0;
        if (app && app.globalData && app.globalData.screenInfo && app.globalData.screenInfo.headerInfo) {
          headerPaddingTop = app.globalData.screenInfo.headerInfo.headerPaddingTop || 0;
        }
        finalHeaderHeight = headerPaddingTop + 35; // padding-top + title 高度
      }
      
      // 获取 tab-bar 高度
      const tabBarHeight = tabBarRect ? tabBarRect.height : 60; // 默认 60px
      
      // 计算底部安全距离：屏幕高度 - 安全区域底部
      const safeAreaBottom = windowInfo.safeArea
        ? windowInfo.screenHeight - windowInfo.safeArea.bottom
        : 0;
      
      const contentHeight = windowHeight - finalHeaderHeight;
      this.setData({
        contentHeight: Math.max(contentHeight, 400), // 最小高度 400px
        placeholderHeight: safeAreaBottom + tabBarHeight + 30,
      });
    });
  },
});
