const { orders, user } = require("../../data/mock");

Page({
  data: {
    orders,
    user
  },
  handleLogin() {
    wx.showToast({
      title: "登录成功",
      icon: "success"
    });
  }
});
