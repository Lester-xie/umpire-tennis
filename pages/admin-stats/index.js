const { adminOrderStatsByMonth, adminCoachMonthStats } = require('../../api/tennisDb');

function padMonth(d) {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}

function fenToYuanStr(fen) {
  const n = Math.floor(Number(fen) || 0);
  return (n / 100).toFixed(2);
}

Page({
  data: {
    scrollHeight: 400,
    monthValue: '',
    stats: null,
    bookingYuan: '0.00',
    purchaseYuan: '0.00',
    totalYuan: '0.00',
    coachList: [],
    coachStatsTruncated: false,
    selectedCoachIndex: -1,
  },

  onLoad() {
    const now = new Date();
    this.setData({ monthValue: padMonth(now) });
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

  onMonthChange(e) {
    const v = e.detail && e.detail.value ? String(e.detail.value) : '';
    if (v) this.setData({ monthValue: v });
  },

  async onQuery() {
    const mv = String(this.data.monthValue || '').trim();
    const parts = mv.split('-');
    if (parts.length < 2) {
      wx.showToast({ title: '请选择月份', icon: 'none' });
      return;
    }
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);
    if (!Number.isFinite(year) || !Number.isFinite(month)) {
      wx.showToast({ title: '月份无效', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '统计中', mask: true });
    try {
      const resOrder = await adminOrderStatsByMonth({ year, month });
      wx.hideLoading();
      const r = (resOrder && resOrder.result) || {};
      if (!r.ok || !r.data) {
        wx.showToast({ title: r.errMsg || '失败', icon: 'none' });
        this.setData({
          coachList: [],
          selectedCoachIndex: -1,
          coachStatsTruncated: false,
        });
        return;
      }
      const d = r.data;
      let coachList = [];
      let coachStatsTruncated = false;
      try {
        const resCoach = await adminCoachMonthStats({ year, month });
        const rc = (resCoach && resCoach.result) || {};
        if (rc.ok && rc.data) {
          coachList = Array.isArray(rc.data.coaches) ? rc.data.coaches : [];
          coachStatsTruncated = !!rc.data.coachBookingTruncated;
        } else if (rc.errMsg) {
          wx.showToast({ title: rc.errMsg, icon: 'none' });
        }
      } catch (e) {
        console.warn('adminCoachMonthStats', e);
        wx.showToast({ title: '教练统计失败，请部署云函数 adminCoachMonthStats', icon: 'none' });
      }
      this.setData({
        stats: d,
        bookingYuan: fenToYuanStr(d.bookingAmountFen),
        purchaseYuan: fenToYuanStr(d.coursePurchaseAmountFen),
        totalYuan: fenToYuanStr(d.totalAmountFen),
        coachList,
        coachStatsTruncated,
        selectedCoachIndex: coachList.length > 0 ? 0 : -1,
      });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '请求失败', icon: 'none' });
    }
  },

  onSelectCoach(e) {
    const idx = Number(e.currentTarget.dataset.index);
    if (!Number.isFinite(idx) || idx < 0) return;
    this.setData({ selectedCoachIndex: idx });
  },
});
