Page({
  data: {},
  attached: function () {
    const app = getApp();
    if (app) {
      const { headerInfo } = app.globalData.screenInfo;
      const title = app.globalData.brand;

      this.setData({
        headerInfo,
        title,
      });
    }
  },
});
