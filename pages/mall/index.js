const { products } = require("../../data/mock");

Page({
  data: {
    products
  },
  handleBuy() {
    wx.showToast({
      title: "已加入购物车",
      icon: "success"
    });
  }
});
