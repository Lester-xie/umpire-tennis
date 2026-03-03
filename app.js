App({
  globalData: {
    brand: "昂湃网球",
    currentTabIndex: 0,
  },
  onLaunch() {
    this.initSystemInfo();
  },
  initSystemInfo() {
    wx.getSystemInfo({
      success: (res) => {
        this.globalData.screenInfo = {
          headerInfo: {
            headerHeaderPaddingTop: res.safeArea.top,
          },
        };
      },
    });
  }
});
