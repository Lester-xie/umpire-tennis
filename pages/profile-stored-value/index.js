const {
  getVenues,
  listAllMemberVenueBalances,
  listAllMemberVenueSessionCards,
} = require('../../api/tennisDb');
const { normalizeVenueId } = require('../../utils/venueId');
const { formatYuanText, roundYuan } = require('../../utils/storedValuePlans');
const {
  attachPageMemberAssetRealtime,
  detachPageMemberAssetRealtime,
} = require('../../utils/memberAssetRealtime');

function buildSections(balanceRows, sessionRows, venueNameById) {
  const byVenue = {};
  (balanceRows || []).forEach((row) => {
    const vid = normalizeVenueId(row.venueId);
    const balanceYuan = roundYuan(row.balanceYuan);
    if (!vid) return;
    if (!byVenue[vid]) {
      byVenue[vid] = { balanceYuan: 0, remainingTimes: 0 };
    }
    byVenue[vid].balanceYuan = roundYuan(byVenue[vid].balanceYuan + balanceYuan);
  });
  (sessionRows || []).forEach((row) => {
    const vid = normalizeVenueId(row.venueId);
    const times = Math.max(0, Math.floor(Number(row.remainingTimes) || 0));
    if (!vid || times <= 0) return;
    if (!byVenue[vid]) {
      byVenue[vid] = { balanceYuan: 0, remainingTimes: 0 };
    }
    byVenue[vid].remainingTimes += times;
  });
  const sections = Object.keys(byVenue)
    .map((vid) => {
      const bal = roundYuan(byVenue[vid].balanceYuan);
      const times = Math.max(0, Math.floor(byVenue[vid].remainingTimes || 0));
      if (bal <= 0 && times <= 0) return null;
      return {
        venueId: vid,
        venueName: venueNameById[vid] || `场馆 ${vid}`,
        balanceYuan: bal,
        balanceText: formatYuanText(bal),
        remainingTimes: times,
        showBalance: bal > 0,
        showTimes: times > 0,
      };
    })
    .filter(Boolean);
  sections.sort((a, b) => a.venueName.localeCompare(b.venueName, 'zh-CN'));
  return sections;
}

Page({
  data: {
    headerHeight: 0,
    contentHeight: 400,
    placeholderHeight: 0,
    isLoggedIn: false,
    sections: [],
    lottieLoadingVisible: false,
  },
  _loadingTaskCount: 0,

  onShow() {
    this._memberAssetWatchSessionGen = this._memberAssetWatchSessionGen || 0;
    this.refresh();
    attachPageMemberAssetRealtime(this, () => this.refresh({ force: true }));
  },

  onHide() {
    detachPageMemberAssetRealtime(this);
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

  async refresh(options) {
    const force = !!(options && options.force);
    const app = getApp();
    const isLoggedIn = app ? app.checkLogin() : false;
    this.setData({ isLoggedIn });
    if (!isLoggedIn) {
      this.setData({ sections: [] });
      return;
    }
    if (!force && this._refreshPromise) {
      return this._refreshPromise;
    }
    this.beginLoading();
    const task = (async () => {
      try {
        const [venueRes, balRes, scRes] = await Promise.all([
          getVenues(),
          listAllMemberVenueBalances(),
          listAllMemberVenueSessionCards(),
        ]);
        const venueNameById = {};
        ((venueRes && venueRes.data) || []).forEach((v) => {
          const id = normalizeVenueId(v._id);
          if (id) venueNameById[id] = String(v.name || '').trim() || id;
        });
        const balRows = (balRes && balRes.result && balRes.result.data) || [];
        const scRows = (scRes && scRes.result && scRes.result.data) || [];
        this.setData({ sections: buildSections(balRows, scRows, venueNameById) });
      } catch (e) {
        console.error('profile-stored-value refresh', e);
        this.setData({ sections: [] });
      } finally {
        this.endLoading();
      }
    })();
    this._refreshPromise = task;
    try {
      await task;
    } finally {
      this._refreshPromise = null;
    }
    return task;
  },
});
