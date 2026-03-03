const { courts, coaches } = require("../../data/mock");

Page({
  data: {
    currentTab: "court",
    courts,
    coaches,
    timeSlots: [
      "09:00-10:00",
      "10:00-11:00",
      "11:00-12:00",
      "14:00-15:00",
      "15:00-16:00",
      "19:00-20:00"
    ]
  },
  handleTabChange(e) {
    const { tab } = e.currentTarget.dataset;
    this.setData({ currentTab: tab });
  },
  handleBook() {
    wx.showToast({
      title: "已提交预订",
      icon: "success"
    });
  }
});
