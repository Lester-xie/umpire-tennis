const { adminVenue } = require('../../api/tennisDb');

Page({
  data: {
    scrollHeight: 400,
    venues: [],
    loading: true,
  },

  onShow() {
    this.loadList();
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

  async loadList() {
    this.setData({ loading: true });
    try {
      const res = await adminVenue({ action: 'list' });
      const r = (res && res.result) || {};
      if (!r.ok) {
        wx.showToast({ title: r.errMsg || '加载失败', icon: 'none' });
        this.setData({ venues: [], loading: false });
        return;
      }
      const rows = (r.data || []).map((v) => ({
        ...v,
        courtCount: Array.isArray(v.courtList) ? v.courtList.length : 0,
      }));
      this.setData({ venues: rows, loading: false });
    } catch (e) {
      console.error(e);
      this.setData({ venues: [], loading: false });
      wx.showToast({ title: '请求失败', icon: 'none' });
    }
  },

  goAdd() {
    wx.navigateTo({ url: '/pages/admin-venue-edit/index' });
  },

  onDeleteTap(e) {
    const id = e.currentTarget.dataset.id != null ? String(e.currentTarget.dataset.id).trim() : '';
    const name = e.currentTarget.dataset.name != null ? String(e.currentTarget.dataset.name) : '';
    if (!id) return;
    wx.showModal({
      title: '删除场馆',
      content: `确定删除「${name || id}」？若课程、订单仍引用该场馆，可能导致数据异常。`,
      confirmText: '删除',
      confirmColor: '#c62828',
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '删除中', mask: true });
        try {
          const cloudRes = await adminVenue({ action: 'remove', venueId: id });
          wx.hideLoading();
          const r = (cloudRes && cloudRes.result) || {};
          if (r.ok) {
            wx.showToast({ title: '已删除', icon: 'success' });
            this.loadList();
          } else {
            wx.showToast({ title: r.errMsg || '失败', icon: 'none' });
          }
        } catch (err) {
          wx.hideLoading();
          wx.showToast({ title: '请求失败', icon: 'none' });
        }
      },
    });
  },
});
