const {
  getVenues,
  requestWechatPay,
  markProfileSummaryStale,
  listMemberVenueMonthCard,
} = require('../../api/tennisDb');
const { normalizeVenueId } = require('../../utils/venueId');
const {
  activeMonthCard,
  monthCardDisplayLabel,
  monthCardWindowLabel,
  formatYuanText,
  MONTH_CARD_DAYS,
} = require('../../utils/monthCard');

function formatExpiresText(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return '';
  const d = new Date(n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

Page({
  data: {
    headerHeight: 0,
    contentHeight: 400,
    placeholderHeight: 0,
    isLoggedIn: false,
    venueId: '',
    venueName: '',
    hasCard: false,
    priceYuan: 0,
    priceText: '',
    days: MONTH_CARD_DAYS,
    cardLabel: '',
    windowLabel: '',
    expiresText: '',
    paying: false,
    lottieLoadingVisible: false,
  },
  _loadingTaskCount: 0,

  onShow() {
    this.syncVenueAndCard();
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

  async syncVenueAndCard() {
    const app = getApp();
    const isLoggedIn = app ? app.checkLogin() : false;
    const venue = app && app.globalData && app.globalData.selectedVenue;
    const venueId = venue && venue.id != null ? normalizeVenueId(venue.id) : '';
    const venueName = venue && venue.name ? String(venue.name) : '';
    this.setData({ isLoggedIn, venueId, venueName, expiresText: '' });
    if (!venueId) {
      this.setData({ hasCard: false });
      return;
    }
    this.beginLoading();
    try {
      const res = await getVenues();
      const rows = (res && res.data) || [];
      const hit = rows.find((v) => normalizeVenueId(v._id) === venueId);
      const card = activeMonthCard(hit || { monthCard: venue.monthCard });
      if (!card) {
        this.setData({ hasCard: false, windowLabel: '' });
      } else {
        this.setData({
          hasCard: true,
          priceYuan: card.priceYuan,
          priceText: formatYuanText(card.priceYuan),
          days: card.days || MONTH_CARD_DAYS,
          cardLabel: monthCardDisplayLabel(card),
          windowLabel: monthCardWindowLabel(card),
        });
      }
      if (isLoggedIn) {
        await this.loadMyMonthCard(venueId);
      }
    } catch (e) {
      console.error('syncVenueAndCard', e);
      this.setData({ hasCard: false });
    } finally {
      this.endLoading();
    }
  },

  async loadMyMonthCard(venueId) {
    if (!venueId) return;
    try {
      const res = await listMemberVenueMonthCard({ venueId });
      const rows = (res && res.result && res.result.data) || [];
      const expiresAt = rows[0] && rows[0].expiresAt;
      if (Number(expiresAt) > Date.now()) {
        this.setData({ expiresText: formatExpiresText(expiresAt) });
      }
    } catch (e) {
      console.warn('loadMyMonthCard', e);
    }
  },

  onSwitchVenue() {
    wx.navigateTo({ url: '/pages/location/index?from=monthCard' });
  },

  async onBuyTap() {
    if (!this.data.isLoggedIn) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      wx.switchTab({ url: '/pages/profile/index' });
      return;
    }
    if (this.data.paying || !this.data.hasCard || !this.data.venueId) return;
    const phone = String(wx.getStorageSync('user_phone') || '').trim();
    if (!phone) {
      wx.showToast({ title: '请先授权手机号', icon: 'none' });
      return;
    }
    const priceYuan = Number(this.data.priceYuan);
    const days = Math.max(1, Math.floor(Number(this.data.days) || MONTH_CARD_DAYS));
    const totalFee = Math.max(1, Math.round(priceYuan * 100));
    this.setData({ paying: true });
    this.beginLoading();
    try {
      const res = await requestWechatPay({
        totalFee,
        monthCardPurchase: {
          type: 'venue_month_card',
          phone,
          venueId: this.data.venueId,
          venueName: this.data.venueName,
          priceYuan,
          days,
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
          wx.showToast({ title: '购买成功', icon: 'success' });
          setTimeout(() => this.syncVenueAndCard(), 800);
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
      console.error('month card pay', err);
      wx.showToast({ title: '网络异常，请重试', icon: 'none' });
    } finally {
      this.setData({ paying: false });
    }
  },
});
