const { getUserByPhone } = require('../../api/tennisDb');

Page({
  data: {
    scrollHeight: 400,
  },

  onShow() {
    this.ensureAdmin();
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

  async ensureAdmin() {
    const phone = String(wx.getStorageSync('user_phone') || '').trim();
    if (!phone) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 800);
      return;
    }
    try {
      const res = await getUserByPhone(phone);
      const u = res && res.data && res.data[0];
      if (!u || !u.isManager) {
        wx.showModal({
          title: '无权限',
          content: '当前账号不是管理员。请在云数据库 db_user 中为该用户设置 isManager: true。',
          showCancel: false,
          success: () => wx.navigateBack(),
        });
      }
    } catch (e) {
      wx.showToast({ title: '校验失败', icon: 'none' });
    }
  },
});
