const { adminVenue, refreshSelectedVenueFromCloud } = require('../../api/tennisDb');
const {
  extractStoredValuePlans,
  rowsFromPlans,
  plansFromRows,
  planDisplayLabel,
} = require('../../utils/storedValuePlans');

function rowsWithPreview(rows) {
  return (rows || []).map((r) => {
    const payYuan = Number(r.payYuan);
    const creditYuan = Number(r.creditYuan);
    let previewLabel = '';
    if (Number.isFinite(payYuan) && payYuan > 0 && Number.isFinite(creditYuan) && creditYuan > 0) {
      previewLabel = planDisplayLabel({ payYuan, creditYuan });
    }
    return { ...r, previewLabel };
  });
}

Page({
  data: {
    scrollHeight: 400,
    venueId: '',
    loading: true,
    name: '',
    planRows: [],
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
      const planRows = rowsWithPreview(rowsFromPlans(extractStoredValuePlans(d)));
      this.setData({
        loading: false,
        name: d.name != null ? String(d.name) : '',
        planRows,
      });
    } catch (e) {
      console.error(e);
      this.setData({ loading: false });
      wx.showToast({ title: '请求失败', icon: 'none' });
    }
  },

  refreshPreviewRows(planRows) {
    this.setData({ planRows: rowsWithPreview(planRows) });
  },

  onPayYuan(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const planRows = [...(this.data.planRows || [])];
    planRows[idx] = { ...planRows[idx], payYuan: e.detail.value };
    this.refreshPreviewRows(planRows);
  },

  onCreditYuan(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const planRows = [...(this.data.planRows || [])];
    planRows[idx] = { ...planRows[idx], creditYuan: e.detail.value };
    this.refreshPreviewRows(planRows);
  },

  onEnabledChange(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const planRows = [...(this.data.planRows || [])];
    planRows[idx] = { ...planRows[idx], enabled: !!e.detail.value };
    this.setData({ planRows });
  },

  onAddRow() {
    const planRows = [
      ...(this.data.planRows || []),
      { payYuan: '', creditYuan: '', enabled: true, previewLabel: '' },
    ];
    this.setData({ planRows });
  },

  onRemoveRow(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const planRows = (this.data.planRows || []).filter((_, i) => i !== idx);
    this.refreshPreviewRows(planRows.length ? planRows : [{ payYuan: '', creditYuan: '', enabled: true }]);
  },

  async onSave() {
    const parsed = plansFromRows(this.data.planRows || []);
    if (!parsed.ok) {
      wx.showToast({ title: parsed.errMsg || '请检查档位', icon: 'none' });
      return;
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
        categoryList: d.categoryList != null ? d.categoryList : d.category_list,
        storedValuePlans: parsed.plans,
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
