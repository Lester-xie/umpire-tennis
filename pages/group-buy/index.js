const { goods } = require('../../data/goods');

Page({
  data: {
    goods,
    contentScrollHeight: 400, // scroll-view 可滚动区域高度，动态计算
  },

  onReady() {
    this.calculateContentScrollHeight();
  },

  // 点击商品，跳转订单详情页结算
  handleGoodClick(e) {
    const index = e.currentTarget.dataset.index;
    const good = this.data.goods[index];
    if (!good) return;
    const goodData = encodeURIComponent(JSON.stringify({
      id: good.id,
      image: good.image,
      desc: good.desc,
      price: good.price,
    }));
    wx.navigateTo({
      url: `/pages/order-detail/index?type=goods&goodData=${goodData}`,
    });
  },

  // 动态计算 scroll-view 高度：窗口高度 - header - 间距
  calculateContentScrollHeight() {
    const systemInfo = wx.getSystemInfoSync();
    const windowHeight = systemInfo.windowHeight;

    const query = wx.createSelectorQuery();
    query.select('.header').boundingClientRect();
    query.exec((res) => {
      const headerRect = res[0];
      const headerHeight = headerRect ? headerRect.height : 0;
      const headerFallback = (systemInfo.statusBarHeight || 44) + 44;
      const finalHeaderHeight = headerHeight > 0 ? headerHeight : headerFallback;

      const contentScrollHeight = Math.max(
        windowHeight - finalHeaderHeight - 16,
        200
      );

      this.setData({
        contentScrollHeight,
      });
    });
  },
});
