const { activities } = require("../../data/mock");

Page({
  data: {
    activities
  },
  handleSignup() {
    wx.showToast({
      title: "已提交报名",
      icon: "success"
    });
  }
});
