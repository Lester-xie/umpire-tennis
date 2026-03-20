// pages/components/main/main.js
Component({

  /**
   * 组件的属性列表
   */
  properties: {

  },

  /**
   * 组件的初始数据
   */
  data: {

  },

  /**
   * 组件的方法列表
   */
  methods: {
    // 处理预订球场点击事件
    handleBookingClick() {
      wx.switchTab({
        url: '/pages/booking/index',
      });
    },
    // 处理全部团购点击事件
    handleGroupBuyClick() {
      wx.navigateTo({
        url: '/pages/group-buy/index',
      });
    },
  }
})