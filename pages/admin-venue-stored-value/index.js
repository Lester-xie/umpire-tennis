const { adminVenue, refreshSelectedVenueFromCloud } = require('../../api/tennisDb');
const { extractCategoryList } = require('../../utils/venueCategoryList');
const {
  extractStoredValuePlans,
  rowsFromPlans,
  plansFromRows,
  planDisplayLabel,
} = require('../../utils/storedValuePlans');
const sessionCard = require('../../utils/sessionCardPlans');

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

function sessionRowsWithPreview(rows) {
  return (rows || []).map((r) => {
    const payYuan = Number(r.payYuan);
    const grantTimes = Math.floor(Number(r.grantTimes));
    let previewLabel = '';
    if (Number.isFinite(payYuan) && payYuan > 0 && Number.isFinite(grantTimes) && grantTimes >= 1) {
      previewLabel = sessionCard.planDisplayLabel({ payYuan, grantTimes });
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
    sessionPlanRows: [],
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
      this.setData({
        loading: false,
        name: d.name != null ? String(d.name) : '',
        planRows: rowsWithPreview(rowsFromPlans(extractStoredValuePlans(d))),
        sessionPlanRows: sessionRowsWithPreview(
          sessionCard.rowsFromPlans(sessionCard.extractSessionCardPlans(d)),
        ),
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

  refreshSessionPreviewRows(sessionPlanRows) {
    this.setData({ sessionPlanRows: sessionRowsWithPreview(sessionPlanRows) });
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

  onSessionPayYuan(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const sessionPlanRows = [...(this.data.sessionPlanRows || [])];
    sessionPlanRows[idx] = { ...sessionPlanRows[idx], payYuan: e.detail.value };
    this.refreshSessionPreviewRows(sessionPlanRows);
  },

  onSessionGrantTimes(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const sessionPlanRows = [...(this.data.sessionPlanRows || [])];
    sessionPlanRows[idx] = { ...sessionPlanRows[idx], grantTimes: e.detail.value };
    this.refreshSessionPreviewRows(sessionPlanRows);
  },

  onSessionEnabledChange(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const sessionPlanRows = [...(this.data.sessionPlanRows || [])];
    sessionPlanRows[idx] = { ...sessionPlanRows[idx], enabled: !!e.detail.value };
    this.setData({ sessionPlanRows });
  },

  onAddSessionRow() {
    const sessionPlanRows = [
      ...(this.data.sessionPlanRows || []),
      { payYuan: '', grantTimes: '', enabled: true, previewLabel: '' },
    ];
    this.setData({ sessionPlanRows });
  },

  onRemoveSessionRow(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const sessionPlanRows = (this.data.sessionPlanRows || []).filter((_, i) => i !== idx);
    this.refreshSessionPreviewRows(
      sessionPlanRows.length ? sessionPlanRows : [{ payYuan: '', grantTimes: '', enabled: true }],
    );
  },

  async onSave() {
    const parsed = plansFromRows(this.data.planRows || []);
    if (!parsed.ok) {
      wx.showToast({ title: parsed.errMsg || '请检查储值档位', icon: 'none' });
      return;
    }
    const sessionParsed = sessionCard.plansFromRows(this.data.sessionPlanRows || []);
    if (!sessionParsed.ok) {
      wx.showToast({ title: sessionParsed.errMsg || '请检查次卡档位', icon: 'none' });
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
        categoryList: extractCategoryList(d),
        storedValuePlans: parsed.plans,
        sessionCardPlans: sessionParsed.plans,
        monthCard: d.monthCard,
        announcement: d.announcement,
        announcementTitle: d.announcementTitle,
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
