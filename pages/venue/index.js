const { courts } = require("../../data/mock");

Page({
  data: {
    venues: courts
  },
  onLoad() {
    this.ensureLocationPermission();
    const selectedVenueId = wx.getStorageSync("selectedVenueId");
    if (selectedVenueId) {
      wx.switchTab({
        url: "/pages/home/index"
      });
    }
  },
  ensureLocationPermission() {
    const asked = wx.getStorageSync("locationAsked");
    wx.getSetting({
      success: (res) => {
        const authorized = res.authSetting && res.authSetting["scope.userLocation"];
        if (authorized) {
          return;
        }
        if (asked) {
          return;
        }
        wx.setStorageSync("locationAsked", true);
        wx.authorize({
          scope: "scope.userLocation",
          success: () => {
            wx.getLocation();
          },
          fail: () => {
            wx.showModal({
              title: "需要定位权限",
              content: "用于展示附近场馆与距离信息",
              confirmText: "去设置",
              success: (modalRes) => {
                if (modalRes.confirm) {
                  wx.openSetting();
                }
              }
            });
          }
        });
      }
    });
  },
  handleSelect(e) {
    const { id } = e.currentTarget.dataset;
    wx.setStorageSync("selectedVenueId", id);
    wx.switchTab({
      url: "/pages/home/index"
    });
  }
});
