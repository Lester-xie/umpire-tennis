const { DEFAULT_USER_AVATAR, adminGetUserByPhone, adminSetUserRoles } = require('../../api/tennisDb');
const { resolveImageUrlForDisplay } = require('../../utils/cloudImage');

Page({
  data: {
    scrollHeight: 400,
    targetPhone: '',
    querying: false,
    userCardVisible: false,
    queriedPhone: '',
    userName: '',
    avatarDisplayUrl: DEFAULT_USER_AVATAR,
    isCoach: false,
    isVip: false,
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

  onPhoneInput(e) {
    const targetPhone = (e.detail.value || '').trim();
    this.setData({
      targetPhone,
      userCardVisible: false,
      queriedPhone: '',
      userName: '',
      avatarDisplayUrl: DEFAULT_USER_AVATAR,
      isCoach: false,
      isVip: false,
    });
  },

  onToggleCoach(e) {
    this.setData({ isCoach: !!e.detail.value });
  },

  onToggleVip(e) {
    this.setData({ isVip: !!e.detail.value });
  },

  async onQueryUser() {
    const targetPhone = String(this.data.targetPhone || '').trim();
    if (!/^1\d{10}$/.test(targetPhone)) {
      wx.showToast({ title: '请输入有效手机号', icon: 'none' });
      return;
    }
    this.setData({ querying: true });
    try {
      const res = await adminGetUserByPhone({ phone: targetPhone });
      const r = (res && res.result) || {};
      if (!r.ok || !r.data) {
        wx.showToast({ title: r.errMsg || '查询失败', icon: 'none' });
        this.setData({
          userCardVisible: false,
          queriedPhone: '',
          querying: false,
        });
        return;
      }
      const d = r.data;
      const avatarRaw = d.avatar != null ? String(d.avatar).trim() : '';
      let avatarDisplayUrl = DEFAULT_USER_AVATAR;
      if (avatarRaw) {
        const resolved = await resolveImageUrlForDisplay(avatarRaw);
        avatarDisplayUrl = resolved || DEFAULT_USER_AVATAR;
      }
      this.setData({
        querying: false,
        userCardVisible: true,
        queriedPhone: d.phone != null ? String(d.phone) : targetPhone,
        userName: d.name != null ? String(d.name) : '',
        avatarDisplayUrl,
        isCoach: !!d.isCoach,
        isVip: !!d.isVip,
      });
    } catch (e) {
      console.error(e);
      this.setData({ querying: false });
      wx.showToast({ title: '请求失败', icon: 'none' });
    }
  },

  async onSubmit() {
    const targetPhone = String(this.data.targetPhone || '').trim();
    const queriedPhone = String(this.data.queriedPhone || '').trim();
    if (!this.data.userCardVisible || !queriedPhone) {
      wx.showToast({ title: '请先查询用户', icon: 'none' });
      return;
    }
    if (targetPhone !== queriedPhone) {
      wx.showToast({ title: '手机号已变更，请重新查询', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '保存中', mask: true });
    try {
      const res = await adminSetUserRoles({
        targetPhone: queriedPhone,
        isCoach: this.data.isCoach,
        isVip: this.data.isVip,
      });
      wx.hideLoading();
      const r = (res && res.result) || {};
      if (r.ok) {
        wx.showToast({ title: '已保存', icon: 'success' });
      } else {
        wx.showToast({ title: r.errMsg || '失败', icon: 'none' });
      }
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '请求失败', icon: 'none' });
    }
  },
});
