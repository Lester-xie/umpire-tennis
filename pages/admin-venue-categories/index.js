const { adminVenue, refreshSelectedVenueFromCloud } = require('../../api/tennisDb');
const { extractCategoryList } = require('../../utils/venueCategoryList');

function rowsFromCategoryList(list) {
  const arr = Array.isArray(list) ? list : [];
  if (arr.length === 0) {
    return [{ name: '体验课', kind: 'scale', p1: '', p2: '' }];
  }
  return arr.map((item) => {
    const name = String(item.name || '').trim();
    const groupLike = name === '团课' || name === '畅打';
    if (groupLike || (item.price != null && String(item.price).trim() !== '')) {
      return {
        name,
        kind: 'single',
        ps: item.price != null ? String(item.price) : '',
      };
    }
    const sl = item.scaleList || {};
    return {
      name,
      kind: 'scale',
      p1: sl['1V1'] != null ? String(sl['1V1']) : '',
      p2: sl['1V2'] != null ? String(sl['1V2']) : '',
    };
  });
}

function categoryListFromRows(rows) {
  const out = [];
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i];
    const name = String(r.name || '').trim();
    if (!name) continue;
    if (r.kind === 'single') {
      const item = { name };
      const p = Number(r.ps);
      if (Number.isFinite(p) && p >= 0) item.price = p;
      out.push(item);
      continue;
    }
    const item = { name, scaleList: {} };
    const a = Number(r.p1);
    const b = Number(r.p2);
    if (Number.isFinite(a) && a >= 0) item.scaleList['1V1'] = a;
    if (Number.isFinite(b) && b >= 0) item.scaleList['1V2'] = b;
    out.push(item);
  }
  return out;
}

const KIND_LABELS = ['体验课/正课（1V1·1V2 分项）', '团课/畅打（单场价）'];

Page({
  data: {
    scrollHeight: 400,
    venueId: '',
    loading: true,
    name: '',
    categoryRows: [],
    kindLabels: KIND_LABELS,
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
      const categoryRows = rowsFromCategoryList(extractCategoryList(d));
      this.setData({
        loading: false,
        name: d.name != null ? String(d.name) : '',
        categoryRows,
      });
    } catch (e) {
      console.error(e);
      this.setData({ loading: false });
      wx.showToast({ title: '请求失败', icon: 'none' });
    }
  },

  onCatName(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    this.setData({ [`categoryRows[${idx}].name`]: e.detail.value });
  },

  onKindChange(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const k = Number(e.detail.value);
    const kind = k === 1 ? 'single' : 'scale';
    this.setData({
      [`categoryRows[${idx}].kind`]: kind,
    });
  },

  onP1(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    this.setData({ [`categoryRows[${idx}].p1`]: e.detail.value });
  },

  onP2(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    this.setData({ [`categoryRows[${idx}].p2`]: e.detail.value });
  },

  onPs(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    this.setData({ [`categoryRows[${idx}].ps`]: e.detail.value });
  },

  onAddRow() {
    const categoryRows = [
      ...this.data.categoryRows,
      { name: '', kind: 'scale', p1: '', p2: '' },
    ];
    this.setData({ categoryRows });
  },

  onRemoveRow(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    if (this.data.categoryRows.length <= 1) {
      wx.showToast({ title: '至少保留一条用途', icon: 'none' });
      return;
    }
    const categoryRows = this.data.categoryRows.filter((_, i) => i !== idx);
    this.setData({ categoryRows });
  },

  async onSave() {
    const categoryList = categoryListFromRows(this.data.categoryRows || []);
    if (categoryList.length === 0) {
      wx.showToast({ title: '请至少填写一条有效用途', icon: 'none' });
      return;
    }
    for (let i = 0; i < categoryList.length; i += 1) {
      if (!String(categoryList[i].name || '').trim()) {
        wx.showToast({ title: `第 ${i + 1} 条用途名称不能为空`, icon: 'none' });
        return;
      }
    }
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
        courtList: d.courtList,
        categoryList,
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
