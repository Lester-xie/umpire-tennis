const {
  getUserByPhone,
  adminListCoaches,
  adminUpsertCoach,
  adminSetUserRoles,
} = require('../../api/tennisDb');

Page({
  data: {
    scrollHeight: 400,
    loading: false,
    saving: false,
    coachList: [],
    showForm: false,
    formMode: 'add', // add | edit
    formPhone: '',
    formName: '',
    formPhoneDisabled: false,
  },

  onShow() {
    this.ensureAdmin().then((ok) => {
      if (ok) this.loadCoaches();
    });
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
      return false;
    }
    try {
      const res = await getUserByPhone(phone);
      const u = res && res.data && res.data[0];
      if (!u || !u.isManager) {
        wx.showModal({
          title: '无权限',
          content: '当前账号不是管理员。',
          showCancel: false,
          success: () => wx.navigateBack(),
        });
        return false;
      }
      return true;
    } catch (e) {
      wx.showToast({ title: '校验失败', icon: 'none' });
      return false;
    }
  },

  async loadCoaches() {
    this.setData({ loading: true });
    try {
      const cloudRes = await adminListCoaches();
      const r = (cloudRes && cloudRes.result) || {};
      if (!r.ok || !r.data) {
        wx.showToast({ title: r.errMsg || '加载失败', icon: 'none' });
        this.setData({ loading: false, coachList: [] });
        return;
      }
      const coaches = Array.isArray(r.data.coaches) ? r.data.coaches : [];
      const coachList = coaches
        .map((c) => {
          const phone = String(c.phone || '').trim();
          const name = c.name != null && String(c.name).trim() !== '' ? String(c.name).trim() : '';
          return {
            phone,
            name,
            displayName: name || phone || '教练',
            isManager: !!c.isManager,
          };
        })
        .filter((c) => /^1\d{10}$/.test(c.phone))
        .sort((a, b) => {
          const an = a.name || a.phone;
          const bn = b.name || b.phone;
          return an.localeCompare(bn, 'zh');
        });
      this.setData({ loading: false, coachList });
    } catch (e) {
      console.warn('loadCoaches', e);
      this.setData({ loading: false, coachList: [] });
      wx.showToast({ title: '请部署云函数 adminGetUserByPhone', icon: 'none' });
    }
  },

  openAddForm() {
    this.setData({
      showForm: true,
      formMode: 'add',
      formPhone: '',
      formName: '',
      formPhoneDisabled: false,
    });
  },

  openEditForm(e) {
    const phone = String(e.currentTarget.dataset.phone || '').trim();
    const name = String(e.currentTarget.dataset.name || '').trim();
    if (!/^1\d{10}$/.test(phone)) return;
    this.setData({
      showForm: true,
      formMode: 'edit',
      formPhone: phone,
      formName: name,
      formPhoneDisabled: true,
    });
  },

  closeForm() {
    if (this.data.saving) return;
    this.setData({ showForm: false });
  },

  preventMove() {},

  onFormNameInput(e) {
    this.setData({ formName: e.detail.value != null ? String(e.detail.value) : '' });
  },

  onFormPhoneInput(e) {
    this.setData({ formPhone: e.detail.value != null ? String(e.detail.value) : '' });
  },

  async onSubmitForm() {
    const name = String(this.data.formName || '').trim();
    const phone = String(this.data.formPhone || '').trim();
    if (!name) {
      wx.showToast({ title: '请填写教练姓名', icon: 'none' });
      return;
    }
    if (name.length > 32) {
      wx.showToast({ title: '姓名最多 32 个字', icon: 'none' });
      return;
    }
    if (!/^1\d{10}$/.test(phone)) {
      wx.showToast({ title: '请输入有效手机号', icon: 'none' });
      return;
    }

    this.setData({ saving: true });
    wx.showLoading({ title: '保存中', mask: true });
    try {
      let res;
      if (this.data.formMode === 'add') {
        res = await adminUpsertCoach({ targetPhone: phone, name });
      } else {
        res = await adminSetUserRoles({ targetPhone: phone, name });
      }
      wx.hideLoading();
      this.setData({ saving: false });
      const r = (res && res.result) || {};
      if (!r.ok) {
        wx.showToast({ title: r.errMsg || '保存失败', icon: 'none' });
        return;
      }
      wx.showToast({
        title: this.data.formMode === 'add' ? (r.created ? '已新增' : '已设为教练') : '已更新',
        icon: 'success',
      });
      this.setData({ showForm: false });
      this.loadCoaches();
    } catch (e) {
      wx.hideLoading();
      this.setData({ saving: false });
      wx.showToast({ title: '请求失败', icon: 'none' });
    }
  },

  onTapStats(e) {
    const phone = String(e.currentTarget.dataset.phone || '').trim();
    const name = String(e.currentTarget.dataset.name || '').trim();
    if (!/^1\d{10}$/.test(phone)) return;
    const q = `phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}`;
    wx.navigateTo({ url: `/pages/admin-coach-stats/index?${q}` });
  },

  onRemoveCoach(e) {
    const phone = String(e.currentTarget.dataset.phone || '').trim();
    const name = String(e.currentTarget.dataset.name || '').trim() || phone;
    if (!/^1\d{10}$/.test(phone)) return;
    wx.showModal({
      title: '删除教练',
      content: `确定移除「${name}」的教练身份？账号与历史订单仍会保留，仅不再出现在教练列表中。`,
      confirmText: '删除',
      confirmColor: '#c62828',
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '处理中', mask: true });
        try {
          const cloudRes = await adminSetUserRoles({
            targetPhone: phone,
            isCoach: false,
          });
          wx.hideLoading();
          const r = (cloudRes && cloudRes.result) || {};
          if (!r.ok) {
            wx.showToast({ title: r.errMsg || '删除失败', icon: 'none' });
            return;
          }
          wx.showToast({ title: '已删除', icon: 'success' });
          this.loadCoaches();
        } catch (err) {
          wx.hideLoading();
          wx.showToast({ title: '请求失败', icon: 'none' });
        }
      },
    });
  },
});
