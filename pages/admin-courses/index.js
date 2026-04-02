const { getCourses, invalidateCourseCache } = require('../../api/tennisDb');
const { ALL_CATEGORY_ID } = require('../../utils/constants');

Page({
  data: {
    scrollHeight: 400,
    courses: [],
    loading: true,
  },

  onShow() {
    this.loadCourses();
  },

  onReady() {
    this.layout();
  },

  layout() {
    const windowInfo = wx.getWindowInfo();
    const query = wx.createSelectorQuery();
    query.select('.header-wrapper').boundingClientRect();
    query.exec((res) => {
      const headerRect = res && res[0];
      const app = getApp();
      const pad = app?.globalData?.screenInfo?.headerInfo?.headerPaddingTop || 0;
      const headerH = headerRect && headerRect.height > 0 ? headerRect.height : pad + 55;
      const safeBottom = windowInfo.safeArea
        ? windowInfo.screenHeight - windowInfo.safeArea.bottom
        : 0;
      const scrollHeight = Math.max(300, windowInfo.windowHeight - headerH - safeBottom - 8);
      this.setData({ scrollHeight });
    });
  },

  async loadCourses() {
    this.setData({ loading: true });
    try {
      invalidateCourseCache();
      const pack = await getCourses(ALL_CATEGORY_ID, { forceRefresh: true });
      this.setData({
        courses: pack.data || [],
        loading: false,
      });
    } catch (e) {
      console.error(e);
      this.setData({ courses: [], loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },
});
