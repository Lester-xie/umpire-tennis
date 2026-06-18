const { getVenues, requestWechatPay, markProfileSummaryStale } = require('../../api/tennisDb');
const { normalizeVenueId } = require('../../utils/venueId');
const {
  activeStoredValuePlans,
  planDisplayLabel,
  formatYuanText,
} = require('../../utils/storedValuePlans');

Page({
  data: {
    headerHeight: 0,
    contentHeight: 400,
    placeholderHeight: 0,
    isLoggedIn: false,
    venueId: '',
    venueName: '',
    planCards: [],
    paying: false,
    lottieLoadingVisible: false,
  },
  _loadingTaskCount: 0,

  onShow() {
    this.syncVenueAndPlans();
  },

  onReady() {
    this.calculateHeaderHeight();
    this.calculateContentHeight();
  },

  beginLoading() {
    this._loadingTaskCount = (this._loadingTaskCount || 0) + 1;
    if (this._loadingTaskCount === 1) {
      this.setData({ lottieLoadingVisible: true });
    }
  },

  endLoading() {
    this._loadingTaskCount = Math.max(0, (this._loadingTaskCount || 0) - 1);
    if (this._loadingTaskCount === 0) {
      this.setData({ lottieLoadingVisible: false });
    }
  },

  calculateHeaderHeight() {
    const query = wx.createSelectorQuery();
    query.select('.header-wrapper').boundingClientRect();
    query.exec((res) => {
      const headerRect = res[0];
      if (headerRect && headerRect.height > 0) {
        this.setData({ headerHeight: headerRect.height });
      } else {
        const app = getApp();
        const headerPaddingTop = app?.globalData?.screenInfo?.headerInfo?.headerPaddingTop || 0;
        this.setData({ headerHeight: headerPaddingTop + 55 });
      }
    });
  },

  calculateContentHeight() {
    const windowInfo = wx.getWindowInfo();
    const query = wx.createSelectorQuery();
    query.select('.header-wrapper').boundingClientRect();
    query.exec((res) => {
      const headerRect = res[0];
      const headerH = headerRect?.height || 55;
      const safeAreaBottom = windowInfo.safeArea
        ? windowInfo.screenHeight - windowInfo.safeArea.bottom
        : 0;
      const contentHeight = Math.max(400, windowInfo.windowHeight - headerH);
      this.setData({
        contentHeight,
        placeholderHeight: safeAreaBottom + 24,
      });
    });
  },

  async syncVenueAndPlans() {
    const app = getApp();
    const isLoggedIn = app ? app.checkLogin() : false;
    const venue = app && app.globalData && app.globalData.selectedVenue;
    const venueId = venue && venue.id != null ? normalizeVenueId(venue.id) : '';
    const venueName = venue && venue.name ? String(venue.name) : '';
    this.setData({ isLoggedIn, venueId, venueName });
    if (!venueId) {
      this.setData({ planCards: [] });
      return;
    }
    this.beginLoading();
    try {
      const res = await getVenues();
      const rows = (res && res.data) || [];
      const hit = rows.find((v) => normalizeVenueId(v._id) === venueId);
      const plans = activeStoredValuePlans(hit || { storedValuePlans: venue.storedValuePlans });
      const planCards = plans.map((p, idx) => ({
        idx,
        payYuan: p.payYuan,
        creditYuan: p.creditYuan,
        payText: formatYuanText(p.payYuan),
        creditText: formatYuanText(p.creditYuan),
        label: planDisplayLabel(p),
      }));
      this.setData({ planCards });
    } catch (e) {
      console.error('syncVenueAndPlans', e);
      this.setData({ planCards: [] });
    } finally {
      this.endLoading();
    }
  },

  onSwitchVenue() {
    wx.navigateTo({ url: '/pages/location/index?from=storedValue' });
  },

  async onRechargeTap(e) {
    if (!this.data.isLoggedIn) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      wx.switchTab({ url: '/pages/profile/index' });
      return;
    }
    if (this.data.paying) return;
    const idx = Number(e.currentTarget.dataset.idx);
    const plan = (this.data.planCards || []).find((p) => p.idx === idx);
    if (!plan || !this.data.venueId) return;
    const phone = String(wx.getStorageSync('user_phone') || '').trim();
    if (!phone) {
      wx.showToast({ title: '请先授权手机号', icon: 'none' });
      return;
    }
    // TODO: 测试用 1 分，上线前改回 Math.max(1, Math.round(plan.payYuan * 100))
    const totalFee = 1;
    this.setData({ paying: true });
    this.beginLoading();
    try {
      const res = await requestWechatPay({
        totalFee,
        storedValuePurchase: {
          type: 'venue_stored_value',
          phone,
          venueId: this.data.venueId,
          venueName: this.data.venueName,
          payYuan: plan.payYuan,
          creditYuan: plan.creditYuan,
        },
      });
      this.endLoading();
      const result = (res && res.result) || {};
      const payment = result.payment;
      if (result.returnCode !== 'SUCCESS' || !payment) {
        wx.showToast({ title: result.returnMsg || '下单失败', icon: 'none' });
        return;
      }
      wx.requestPayment({
        ...payment,
        success: () => {
          markProfileSummaryStale();
          wx.showToast({ title: '充值成功', icon: 'success' });
        },
        fail: (err) => {
          const msg = (err && err.errMsg) ? String(err.errMsg) : '';
          wx.showToast({
            title: msg.indexOf('cancel') >= 0 ? '已取消支付' : '支付未完成',
            icon: 'none',
          });
        },
      });
    } catch (err) {
      this.endLoading();
      console.error('stored value pay', err);
      wx.showToast({ title: '网络异常，请重试', icon: 'none' });
    } finally {
      this.setData({ paying: false });
    }
  },
});
