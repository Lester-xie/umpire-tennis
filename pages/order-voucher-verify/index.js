const {
  verifyMeituanReceiptPrepareForBooking,
  listTicketShopDeals,
} = require('../../api/tennisDb');

Page({
  data: {
    headerHeight: 88,
    isLoggedIn: false,
    platform: 1,
    receiptCode: '',
    allowedPrices: [],
    usedReceiptCodes: [],
    canConfirm: false,
    preparing: false,
    resultMsg: '',
    resultOk: false,
  },

  _shopDealsByPlatform: { 1: null, 2: null },
  _shopDealsPrefetchPromise: null,

  onShow() {
    this.syncLogin();
    this.prefetchShopDeals();
  },

  syncLogin() {
    const app = getApp();
    const isLoggedIn = app ? app.checkLogin() : false;
    this.setData({ isLoggedIn });
  },

  onGoLogin() {
    wx.switchTab({ url: '/pages/profile/index' });
  },

  onLoad() {
    const query = wx.createSelectorQuery();
    query.select('.header-wrapper').boundingClientRect();
    query.exec((res) => {
      if (res[0] && res[0].height > 0) {
        this.setData({ headerHeight: res[0].height });
      }
    });
    this.syncLogin();
    const channel = this.getOpenerEventChannel && this.getOpenerEventChannel();
    if (channel && channel.on) {
      channel.on('initData', (payload) => {
        const allowedPrices = Array.isArray(payload && payload.allowedPrices)
          ? payload.allowedPrices
          : [];
        const usedReceiptCodes = Array.isArray(payload && payload.usedReceiptCodes)
          ? payload.usedReceiptCodes
          : [];
        this.setData({
          allowedPrices,
          usedReceiptCodes,
          canConfirm: !!String(this.data.receiptCode || '').trim(),
        });
      });
    }
    this.prefetchShopDeals();
  },

  shopDealsReadyForPlatform(platform) {
    const pf = platform === 2 ? 2 : 1;
    return Array.isArray(this._shopDealsByPlatform[pf]);
  },

  getShopDealsForPlatform(platform) {
    const pf = platform === 2 ? 2 : 1;
    const cached = this._shopDealsByPlatform[pf];
    return Array.isArray(cached) ? cached : [];
  },

  async prefetchShopDeals() {
    const app = getApp();
    if (!app || !app.checkLogin()) return;
    if (this.shopDealsReadyForPlatform(1) && this.shopDealsReadyForPlatform(2)) return;
    if (this._shopDealsPrefetchPromise) return this._shopDealsPrefetchPromise;

    this._shopDealsPrefetchPromise = (async () => {
      try {
        const res = await listTicketShopDeals();
        const r = (res && res.result) || {};
        if (r.ok && r.data) {
          this._shopDealsByPlatform[1] = Array.isArray(r.data.meituan) ? r.data.meituan : [];
          this._shopDealsByPlatform[2] = Array.isArray(r.data.douyin) ? r.data.douyin : [];
        } else {
          if (!this.shopDealsReadyForPlatform(1)) this._shopDealsByPlatform[1] = [];
          if (!this.shopDealsReadyForPlatform(2)) this._shopDealsByPlatform[2] = [];
        }
      } catch (e) {
        console.error('prefetchShopDeals', e);
        if (!this.shopDealsReadyForPlatform(1)) this._shopDealsByPlatform[1] = [];
        if (!this.shopDealsReadyForPlatform(2)) this._shopDealsByPlatform[2] = [];
      } finally {
        this._shopDealsPrefetchPromise = null;
      }
    })();

    return this._shopDealsPrefetchPromise;
  },

  onSelectPlatform(e) {
    const pf = Number(e.currentTarget.dataset.platform);
    if (pf !== 1 && pf !== 2 || pf === this.data.platform) return;
    this.setData({
      platform: pf,
      receiptCode: '',
      resultMsg: '',
      canConfirm: false,
    });
  },

  onReceiptInput(e) {
    const receiptCode = e.detail && e.detail.value != null ? String(e.detail.value) : '';
    this.setData({
      receiptCode,
      resultMsg: '',
      canConfirm: !!String(receiptCode).trim(),
    });
  },

  onScanCode() {
    wx.scanCode({
      onlyFromCamera: false,
      success: (res) => {
        const raw = res && res.result ? String(res.result).trim() : '';
        if (!raw) return;
        this.setData({ receiptCode: raw, resultMsg: '', canConfirm: true });
      },
    });
  },

  async onConfirm() {
    if (!this.data.isLoggedIn) {
      wx.showModal({
        title: '请先登录',
        content: '添加团购券需先登录并授权手机号',
        confirmText: '去登录',
        cancelText: '取消',
        success: (res) => {
          if (res.confirm) this.onGoLogin();
        },
      });
      return;
    }
    const receiptCode = String(this.data.receiptCode || '').trim();
    const platform = this.data.platform;
    if (!receiptCode) {
      wx.showToast({ title: '请输入券码', icon: 'none' });
      return;
    }
    this.setData({ preparing: true, resultMsg: '' });
    try {
      await this.prefetchShopDeals();
      const shopDeals = this.getShopDealsForPlatform(platform);
      const res = await verifyMeituanReceiptPrepareForBooking({
        receiptCode,
        platform,
        allowedPrices: this.data.allowedPrices,
        usedReceiptCodes: this.data.usedReceiptCodes,
        shopDeals,
      });
      const r = (res && res.result) || {};
      if (r.duplicate) {
        this.setData({
          resultOk: false,
          resultMsg: r.errMsg || '该团购券已被使用',
        });
        return;
      }
      if (!r.ok || !r.data) {
        this.setData({
          resultOk: false,
          resultMsg: r.errMsg || '验券失败',
        });
        return;
      }
      const channel = this.getOpenerEventChannel && this.getOpenerEventChannel();
      if (channel && channel.emit) {
        channel.emit('voucherAdded', r.data);
      }
      wx.navigateBack();
    } catch (e) {
      console.error('verifyMeituanReceiptPrepareForBooking', e);
      const msg = (e && (e.errMsg || e.message)) ? String(e.errMsg || e.message) : '请求失败';
      wx.showToast({ title: msg.length > 24 ? `${msg.slice(0, 24)}…` : msg, icon: 'none' });
    } finally {
      this.setData({ preparing: false });
    }
  },
});
