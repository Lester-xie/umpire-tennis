const { adminVenue, refreshSelectedVenueFromCloud } = require('../../api/tennisDb');
const { extractCategoryList } = require('../../utils/venueCategoryList');
const {
  buildSlotLabels,
  newCourt,
  courtFromDoc,
  courtsToPayload,
} = require('../../utils/adminVenueForm');

Page({
  data: {
    scrollHeight: 400,
    venueId: '',
    loading: true,
    name: '',
    courts: [],
    slotLabels: buildSlotLabels(),
  },

  onLoad(options) {
    const id = options.id != null ? String(options.id).trim() : '';
    if (!id) {
      wx.showToast({ title: '缺少场馆', icon: 'none' });
      this.setData({ loading: false });
      return;
    }
    this.setData({ venueId: id });
    this.loadVenue(id);
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

  async loadVenue(id) {
    this.setData({ loading: true });
    try {
      const res = await adminVenue({ action: 'get', venueId: id });
      const r = (res && res.result) || {};
      if (!r.ok || !r.data) {
        wx.showToast({ title: r.errMsg || '加载失败', icon: 'none' });
        this.setData({ loading: false });
        return;
      }
      const d = r.data;
      let courts = [];
      if (Array.isArray(d.courtList) && d.courtList.length > 0) {
        courts = d.courtList.map((c) => courtFromDoc(c));
      } else {
        courts = [newCourt('1号场')];
      }
      this.setData({
        loading: false,
        name: d.name != null ? String(d.name) : '',
        courts,
      });
    } catch (e) {
      console.error(e);
      this.setData({ loading: false });
      wx.showToast({ title: '请求失败', icon: 'none' });
    }
  },

  onCourtName(e) {
    const cIdx = Number(e.currentTarget.dataset.cidx);
    this.setData({ [`courts[${cIdx}].name`]: e.detail.value });
  },

  onCourtPriceTab(e) {
    const cIdx = Number(e.currentTarget.dataset.cidx);
    const tab = e.currentTarget.dataset.tab === 'vip' ? 'vip' : 'regular';
    this.setData({ [`courts[${cIdx}].priceTab`]: tab });
  },

  onSlotPrice(e) {
    const cIdx = Number(e.currentTarget.dataset.cidx);
    const sIdx = Number(e.currentTarget.dataset.sidx);
    const tab = e.currentTarget.dataset.tab === 'vip' ? 'vip' : 'regular';
    const key =
      tab === 'vip'
        ? `courts[${cIdx}].vipPriceList[${sIdx}]`
        : `courts[${cIdx}].priceList[${sIdx}]`;
    this.setData({ [key]: e.detail.value });
  },

  onSpecialPrice(e) {
    const cIdx = Number(e.currentTarget.dataset.cidx);
    this.setData({ [`courts[${cIdx}].specialPrice`]: e.detail.value });
  },

  onAddCourt() {
    const n = this.data.courts.length + 1;
    const courts = [...this.data.courts, newCourt(`${n}号场`)];
    this.setData({ courts });
  },

  onRemoveCourt(e) {
    const cIdx = Number(e.currentTarget.dataset.cidx);
    if (this.data.courts.length <= 1) {
      wx.showToast({ title: '至少保留一片场地', icon: 'none' });
      return;
    }
    const courts = this.data.courts.filter((_, i) => i !== cIdx);
    this.setData({ courts });
  },

  async onSave() {
    const courts = this.data.courts || [];
    for (let i = 0; i < courts.length; i += 1) {
      if (!String(courts[i].name || '').trim()) {
        wx.showToast({ title: `请填写「场地 ${i + 1}」的名称`, icon: 'none' });
        return;
      }
    }
    const courtList = courtsToPayload(courts);
    wx.showLoading({ title: '保存中', mask: true });
    try {
      const fresh = await adminVenue({ action: 'get', venueId: this.data.venueId });
      const fr = (fresh && fresh.result) || {};
      if (!fr.ok || !fr.data) {
        wx.hideLoading();
        wx.showToast({ title: fr.errMsg || '读取场馆失败', icon: 'none' });
        return;
      }
      const d = fr.data;
      const lat = Number(d.latitude);
      const lon = Number(d.longitude);
      const payload = {
        name: d.name != null ? String(d.name) : '',
        address: d.address != null ? String(d.address) : '',
        latitude: lat,
        longitude: lon,
        image: d.image != null ? String(d.image) : '',
        courtList,
        categoryList: extractCategoryList(d),
      };
      const res = await adminVenue({ action: 'update', venueId: this.data.venueId, payload });
      wx.hideLoading();
      const r = (res && res.result) || {};
      if (r.ok) {
        refreshSelectedVenueFromCloud().catch(() => {});
        wx.showToast({ title: '已保存', icon: 'success' });
        setTimeout(() => wx.navigateBack(), 450);
      } else {
        wx.showToast({ title: r.errMsg || '失败', icon: 'none' });
      }
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '请求失败', icon: 'none' });
    }
  },
});
