const {
  verifyMeituanReceiptPrepare,
  verifyMeituanReceiptConsume,
  verifyMeituanReceiptCheckStatus,
  listTicketShopDeals,
} = require('../../api/tennisDb');

function platformLabelOf(pf) {
  return pf === 2 ? '抖音' : '美团';
}

Page({
  data: {
    headerHeight: 0,
    contentHeight: 400,
    placeholderHeight: 0,
    isLoggedIn: false,
    platform: 1,
    platformLabel: '美团',
    receiptCode: '',
    preparing: false,
    consuming: false,
    canConsume: false,
    preview: null,
    prepareCache: null,
    resultMsg: '',
    resultOk: false,
    lottieLoadingVisible: false,
  },
  _loadingTaskCount: 0,

  onShow() {
    this.syncLogin();
    this.prefetchShopDeals();
  },

  onReady() {
    this.calculateHeaderHeight();
    this.calculateContentHeight();
  },

  syncLogin() {
    const app = getApp();
    const isLoggedIn = app ? app.checkLogin() : false;
    this.setData({ isLoggedIn });
  },

  async prefetchShopDeals() {
    const app = getApp();
    if (!app || !app.checkLogin()) return;
    try {
      await listTicketShopDeals();
    } catch (e) {
      /* 静默预拉取，失败不影响验券 */
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
        const pad = app?.globalData?.screenInfo?.headerInfo?.headerPaddingTop || 0;
        this.setData({ headerHeight: pad + 55 });
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
      this.setData({
        contentHeight: Math.max(windowInfo.windowHeight - headerH - safeAreaBottom - 24, 300),
        placeholderHeight: safeAreaBottom + 24,
      });
    });
  },

  clearReceiptState() {
    this.setData({
      canConsume: false,
      preview: null,
      prepareCache: null,
      resultMsg: '',
    });
  },

  onSelectPlatform(e) {
    const pf = Number(e.currentTarget.dataset.platform);
    if (pf !== 1 && pf !== 2) return;
    if (pf === this.data.platform) return;
    this.setData({
      platform: pf,
      platformLabel: platformLabelOf(pf),
      receiptCode: '',
    });
    this.clearReceiptState();
  },

  onReceiptInput(e) {
    this.setData({
      receiptCode: e.detail && e.detail.value != null ? String(e.detail.value) : '',
    });
    this.clearReceiptState();
  },

  onScanCode() {
    wx.scanCode({
      onlyFromCamera: false,
      success: (res) => {
        const raw = res && res.result ? String(res.result).trim() : '';
        if (!raw) return;
        this.setData({ receiptCode: raw });
        this.clearReceiptState();
      },
    });
  },

  async onPrepare() {
    const receiptCode = String(this.data.receiptCode || '').trim();
    const platform = this.data.platform;
    if (!receiptCode) {
      wx.showToast({ title: '请输入券码', icon: 'none' });
      return;
    }
    this.setData({
      preparing: true,
      resultMsg: '',
      preview: null,
      prepareCache: null,
      canConsume: false,
    });
    try {
      const res = await verifyMeituanReceiptPrepare({ receiptCode, platform });
      const r = (res && res.result) || {};
      if (r.duplicate && r.data) {
        this.setData({
          resultOk: true,
          resultMsg: `您已于 ${this.formatTime(r.data.consumedAt)} 验过此券，已入账 ${r.data.grantLabel} ${r.data.grantHours} 小时`,
        });
        return;
      }
      if (!r.ok || !r.data) {
        const msg = r.errMsg || '查询失败';
        this.setData({
          resultOk: false,
          resultMsg: msg,
          preview: null,
          prepareCache: null,
          canConsume: false,
        });
        return;
      }
      const g = r.data.grant || {};
      const ticketName = r.data.ticketName || '';
      this.setData({
        preview: {
          ticketName,
          grantLabel: g.label || '课时',
          grantHours: g.grantHours,
        },
        prepareCache: {
          platform,
          ticketName,
          dealId: r.data.dealId != null ? String(r.data.dealId) : '',
          dealGroupId: r.data.dealGroupId != null ? String(r.data.dealGroupId) : '',
          ticketInfo: r.data.ticketInfo != null ? String(r.data.ticketInfo) : '',
        },
        canConsume: true,
        resultOk: true,
        resultMsg: '',
      });
    } catch (e) {
      console.error('verifyMeituanReceiptPrepare', e);
      const msg = (e && (e.errMsg || e.message)) ? String(e.errMsg || e.message) : '请求失败';
      wx.showToast({ title: msg.length > 24 ? `${msg.slice(0, 24)}…` : msg, icon: 'none' });
    } finally {
      this.setData({ preparing: false });
    }
  },

  async tryRecoverConsumeSuccess(receiptCode, platform) {
    try {
      const res = await verifyMeituanReceiptCheckStatus({ receiptCode, platform });
      const r = (res && res.result) || {};
      if (r.duplicate && r.data) {
        this.setData({
          resultOk: true,
          resultMsg: `验券已成功！已入账 ${r.data.grantLabel} ${r.data.grantHours} 小时，可在「我的课时」查看`,
          canConsume: false,
          preview: null,
          prepareCache: null,
          receiptCode: '',
        });
        return true;
      }
    } catch (e) {
      console.error('tryRecoverConsumeSuccess', e);
    }
    return false;
  },

  async onConsume() {
    const receiptCode = String(this.data.receiptCode || '').trim();
    const cache = this.data.prepareCache;
    const platform = this.data.platform;
    if (!receiptCode) {
      wx.showToast({ title: '请输入券码', icon: 'none' });
      return;
    }
    if (!cache || cache.platform !== platform) {
      wx.showToast({ title: '请先查询券信息', icon: 'none' });
      return;
    }
    this.setData({ consuming: true });
    try {
      const res = await verifyMeituanReceiptConsume({
        receiptCode,
        platform,
        ticketName: cache.ticketName,
        dealId: cache.dealId,
        dealGroupId: cache.dealGroupId,
        ticketInfo: cache.ticketInfo,
      });
      const r = (res && res.result) || {};
      if (r.duplicate && r.data) {
        this.setData({
          resultOk: true,
          resultMsg: `此券已验过，${r.data.grantLabel} ${r.data.grantHours} 小时`,
          canConsume: false,
        });
        return;
      }
      if (!r.ok || !r.data) {
        const recovered = await this.tryRecoverConsumeSuccess(receiptCode, platform);
        if (recovered) return;
        wx.showToast({ title: r.errMsg || '验券失败', icon: 'none' });
        return;
      }
      const g = r.data.grant || {};
      const pending = r.data.grantPending;
      this.setData({
        resultOk: true,
        canConsume: false,
        preview: null,
        prepareCache: null,
        resultMsg: pending
          ? `验券成功，课时入账异常：${pending}，请联系客服`
          : `验券成功！已入账 ${g.label || '课时'} ${g.grantHours} 小时，可在「我的课时」查看`,
        receiptCode: '',
      });
    } catch (e) {
      console.error('verifyMeituanReceiptConsume', e);
      const recovered = await this.tryRecoverConsumeSuccess(receiptCode, platform);
      if (recovered) return;
      const msg = (e && (e.errMsg || e.message)) ? String(e.errMsg || e.message) : '请求失败';
      wx.showToast({ title: msg.length > 24 ? `${msg.slice(0, 24)}…` : msg, icon: 'none' });
    } finally {
      this.setData({ consuming: false });
    }
  },

  formatTime(ts) {
    const t = new Date(Number(ts));
    if (Number.isNaN(t.getTime())) return '—';
    const p = (n) => (n < 10 ? '0' + n : String(n));
    return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}`;
  },

  onPhoneLogin() {
    wx.showToast({ title: '请先在账户页授权登录', icon: 'none' });
    wx.switchTab({ url: '/pages/profile/index' });
  },
});
