const STORAGE_KEY = 'booking_success_payload';

function resolveSuccessKind(payload) {
  if (!payload || typeof payload !== 'object') return 'court';
  if (payload.successKind === 'coursePurchase') return 'coursePurchase';
  if (payload.successKind === 'coachCourse') return 'coachCourse';
  return 'court';
}

Page({
  data: {
    successKind: 'court',
    successTitle: '预约成功',
    successSub: '',
    campusName: '',
    orderItems: [],
    coachCapacityLabel: '',
    coachName: '',
    goodDesc: '',
    grantHours: 0,
    lessonLabel: '',
    footerButtonText: '返回预订',
    contentScrollHeight: 400,
  },

  onLoad() {
    try {
      const payload = wx.getStorageSync(STORAGE_KEY);
      wx.removeStorageSync(STORAGE_KEY);
      if (payload && typeof payload === 'object') {
        const kind = resolveSuccessKind(payload);
        if (kind === 'coursePurchase') {
          const gh = Math.floor(Number(payload.grantHours) || 0);
          this.setData({
            successKind: 'coursePurchase',
            successTitle: '购买成功',
            successSub: '课时将在几秒内计入账户，您可在「我的 — 我的课时」中查看余额。',
            campusName: payload.campusName || '',
            goodDesc: payload.goodDesc || '',
            grantHours: gh,
            lessonLabel: payload.lessonLabel || '',
            orderItems: [],
            coachCapacityLabel: '',
            coachName: '',
            footerButtonText: '返回首页',
          });
        } else if (kind === 'coachCourse') {
          this.setData({
            successKind: 'coachCourse',
            successTitle: '报名成功',
            successSub:
              '您已成功报名该课程，请按约定时间到场参加。如需取消请尽早操作，并遵守开课前退课时间要求。',
            campusName: payload.campusName || '',
            orderItems: Array.isArray(payload.orderItems) ? payload.orderItems : [],
            coachCapacityLabel: payload.coachCapacityLabel != null ? String(payload.coachCapacityLabel).trim() : '',
            coachName: payload.coachName != null ? String(payload.coachName).trim() : '',
            footerButtonText: '返回预订',
          });
        } else {
          this.setData({
            successKind: 'court',
            successTitle: '预约成功',
            successSub: '',
            campusName: payload.campusName || '',
            orderItems: Array.isArray(payload.orderItems) ? payload.orderItems : [],
            coachCapacityLabel: '',
            coachName: '',
            footerButtonText: '返回预订',
          });
        }
      }
    } catch (e) {
      console.error('读取成功页信息失败', e);
    }
    this.calculateContentScrollHeight();
  },

  onReady() {
    this.calculateContentScrollHeight();
  },

  calculateContentScrollHeight() {
    const windowInfo = wx.getWindowInfo();
    const windowHeight = windowInfo.windowHeight;
    const query = wx.createSelectorQuery();
    query.select('.header').boundingClientRect();
    query.exec((res) => {
      const headerRect = res[0];
      const headerHeight = headerRect ? headerRect.height : 0;
      const headerFallback = (windowInfo.statusBarHeight || 44) + 44;
      const finalHeaderHeight = headerHeight > 0 ? headerHeight : headerFallback;
      const safeAreaBottom = windowInfo.safeArea
        ? windowInfo.screenHeight - windowInfo.safeArea.bottom
        : 0;
      const footerHeight = 16 + 44 + safeAreaBottom + 8;
      const contentScrollHeight = Math.max(
        windowHeight - finalHeaderHeight - footerHeight - 10,
        200,
      );
      this.setData({ contentScrollHeight });
    });
  },

  handleFooterTap() {
    if (this.data.successKind === 'coursePurchase') {
      wx.switchTab({ url: '/pages/home/index' });
      return;
    }
    wx.switchTab({ url: '/pages/booking/index' });
  },

  handleViewCourseHours() {
    wx.navigateTo({ url: '/pages/profile-course-hours/index' });
  },
});
