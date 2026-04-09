const { adminVenue, refreshSelectedVenueFromCloud } = require('../../api/tennisDb');
const { extractCategoryList } = require('../../utils/venueCategoryList');
const { resolveImageUrlForDisplay, uploadTempImageToCloud } = require('../../utils/cloudImage');
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
    isNew: true,
    loading: false,
    name: '',
    address: '',
    latitude: '',
    longitude: '',
    image: '',
    imageDisplayUrl: '',
    uploadingImage: false,
    courts: [],
    slotLabels: buildSlotLabels(),
  },

  onLoad(options) {
    const id = options.id != null ? String(options.id).trim() : '';
    if (id) {
      this.setData({ venueId: id, isNew: false, loading: true });
      this.loadVenue(id);
    } else {
      this.setData({
        courts: [newCourt('1号场')],
      });
    }
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
    try {
      const res = await adminVenue({ action: 'get', venueId: id });
      const r = (res && res.result) || {};
      if (!r.ok || !r.data) {
        wx.showToast({ title: r.errMsg || '加载失败', icon: 'none' });
        this.setData({ loading: false });
        return;
      }
      const d = r.data;
      this.setData({
        loading: false,
        name: d.name != null ? String(d.name) : '',
        address: d.address != null ? String(d.address) : '',
        latitude: d.latitude != null ? String(d.latitude) : '',
        longitude: d.longitude != null ? String(d.longitude) : '',
        image: d.image != null ? String(d.image) : '',
        courts: [],
      });
      this.refreshVenueCoverDisplay();
    } catch (e) {
      console.error(e);
      this.setData({ loading: false });
      wx.showToast({ title: '请求失败', icon: 'none' });
    }
  },

  onName(e) {
    this.setData({ name: e.detail.value });
  },

  onAddress(e) {
    this.setData({ address: e.detail.value });
  },

  onLat(e) {
    this.setData({ latitude: e.detail.value });
  },

  onLon(e) {
    this.setData({ longitude: e.detail.value });
  },

  async refreshVenueCoverDisplay() {
    const url = await resolveImageUrlForDisplay(this.data.image);
    this.setData({ imageDisplayUrl: url });
  },

  async onPickVenueCover() {
    if (this.data.uploadingImage) return;
    this.setData({ uploadingImage: true });
    try {
      const fileID = await uploadTempImageToCloud('admin-media/venue');
      this.setData({ image: fileID });
      await this.refreshVenueCoverDisplay();
      wx.showToast({ title: '已上传', icon: 'success' });
    } catch (e) {
      const msg = (e && (e.errMsg || e.message)) || '';
      if (msg.includes('cancel') || msg.includes('取消')) return;
      console.error(e);
      wx.showToast({ title: '上传失败', icon: 'none' });
    } finally {
      this.setData({ uploadingImage: false });
    }
  },

  onClearVenueCover() {
    this.setData({ image: '', imageDisplayUrl: '' });
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
    const lat = Number(this.data.latitude);
    const lon = Number(this.data.longitude);
    if (!String(this.data.name || '').trim()) {
      wx.showToast({ title: '请填写场馆名称', icon: 'none' });
      return;
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      wx.showToast({ title: '请填写有效经纬度', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '保存中', mask: true });
    try {
      if (this.data.isNew) {
        const courts = this.data.courts || [];
        for (let i = 0; i < courts.length; i += 1) {
          if (!String(courts[i].name || '').trim()) {
            wx.hideLoading();
            wx.showToast({ title: `请填写「场地 ${i + 1}」的名称`, icon: 'none' });
            return;
          }
        }
        const courtList = courtsToPayload(courts);
        const payload = {
          name: this.data.name,
          address: this.data.address,
          latitude: lat,
          longitude: lon,
          image: this.data.image,
          courtList,
          categoryList: [],
        };
        const res = await adminVenue({ action: 'create', payload });
        wx.hideLoading();
        const r = (res && res.result) || {};
        if (r.ok) {
          refreshSelectedVenueFromCloud().catch(() => {});
          wx.showToast({ title: '已保存', icon: 'success' });
          setTimeout(() => wx.navigateBack(), 450);
        } else {
          wx.showToast({ title: r.errMsg || '失败', icon: 'none' });
        }
        return;
      }

      const fresh = await adminVenue({ action: 'get', venueId: this.data.venueId });
      const fr = (fresh && fresh.result) || {};
      if (!fr.ok || !fr.data) {
        wx.hideLoading();
        wx.showToast({ title: fr.errMsg || '读取场馆失败', icon: 'none' });
        return;
      }
      const d = fr.data;
      const payload = {
        name: String(this.data.name || '').trim(),
        address: this.data.address != null ? String(this.data.address) : '',
        latitude: lat,
        longitude: lon,
        image: this.data.image != null ? String(this.data.image) : '',
        courtList: d.courtList,
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

  onDelete() {
    if (this.data.isNew) return;
    const id = this.data.venueId;
    const name = this.data.name || id;
    wx.showModal({
      title: '删除场馆',
      content: `确定删除「${name}」？`,
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
            setTimeout(() => wx.navigateBack(), 400);
          } else {
            wx.showToast({ title: r.errMsg || '失败', icon: 'none' });
          }
        } catch (e) {
          wx.hideLoading();
          wx.showToast({ title: '请求失败', icon: 'none' });
        }
      },
    });
  },
});
