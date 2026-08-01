const { adminVenue, refreshSelectedVenueFromCloud } = require('../../api/tennisDb');
const {
  monthCardFormFromVenue,
  monthCardFromForm,
  monthCardDisplayLabel,
  MONTH_CARD_DAYS,
  DEFAULT_WINDOW_START_HOUR,
  DEFAULT_WINDOW_END_HOUR,
  buildHourPickerRange,
  formatHourLabel,
} = require('../../utils/monthCard');

const HOUR_PICKER = buildHourPickerRange();

function hourToIndex(hour) {
  const idx = HOUR_PICKER.values.indexOf(Math.floor(Number(hour)));
  return idx >= 0 ? idx : 0;
}

Page({
  data: {
    scrollHeight: 400,
    venueId: '',
    loading: true,
    name: '',
    priceYuan: '',
    days: String(MONTH_CARD_DAYS),
    enabled: true,
    previewLabel: '',
    hourLabels: HOUR_PICKER.labels,
    windowStartHour: DEFAULT_WINDOW_START_HOUR,
    windowEndHour: DEFAULT_WINDOW_END_HOUR,
    windowStartIndex: hourToIndex(DEFAULT_WINDOW_START_HOUR),
    windowEndIndex: hourToIndex(DEFAULT_WINDOW_END_HOUR),
    windowStartLabel: formatHourLabel(DEFAULT_WINDOW_START_HOUR),
    windowEndLabel: formatHourLabel(DEFAULT_WINDOW_END_HOUR),
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

  applyWindowHours(startHour, endHour) {
    const windowStartHour = Math.floor(Number(startHour));
    const windowEndHour = Math.floor(Number(endHour));
    this.setData({
      windowStartHour,
      windowEndHour,
      windowStartIndex: hourToIndex(windowStartHour),
      windowEndIndex: hourToIndex(windowEndHour),
      windowStartLabel: formatHourLabel(windowStartHour),
      windowEndLabel: formatHourLabel(windowEndHour),
    });
  },

  refreshPreview() {
    const parsed = monthCardFromForm({
      priceYuan: this.data.priceYuan,
      days: this.data.days,
      enabled: this.data.enabled,
      windowStartHour: this.data.windowStartHour,
      windowEndHour: this.data.windowEndHour,
    });
    this.setData({
      previewLabel: parsed.ok ? monthCardDisplayLabel(parsed.monthCard) : '',
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
      const form = monthCardFormFromVenue(d);
      this.setData({
        loading: false,
        name: d.name != null ? String(d.name) : '',
        priceYuan: form.priceYuan,
        days: form.days,
        enabled: form.enabled,
      });
      this.applyWindowHours(form.windowStartHour, form.windowEndHour);
      this.refreshPreview();
    } catch (e) {
      console.error(e);
      this.setData({ loading: false });
      wx.showToast({ title: '请求失败', icon: 'none' });
    }
  },

  onPriceYuan(e) {
    this.setData({ priceYuan: e.detail.value });
    this.refreshPreview();
  },

  onDays(e) {
    this.setData({ days: e.detail.value });
    this.refreshPreview();
  },

  onWindowStartChange(e) {
    const idx = Number(e.detail.value);
    const hour = HOUR_PICKER.values[idx];
    if (hour == null) return;
    this.applyWindowHours(hour, this.data.windowEndHour);
    this.refreshPreview();
  },

  onWindowEndChange(e) {
    const idx = Number(e.detail.value);
    const hour = HOUR_PICKER.values[idx];
    if (hour == null) return;
    this.applyWindowHours(this.data.windowStartHour, hour);
    this.refreshPreview();
  },

  onEnabledChange(e) {
    this.setData({ enabled: !!e.detail.value });
  },

  async onSave() {
    const parsed = monthCardFromForm({
      priceYuan: this.data.priceYuan,
      days: this.data.days,
      enabled: this.data.enabled,
      windowStartHour: this.data.windowStartHour,
      windowEndHour: this.data.windowEndHour,
    });
    if (!parsed.ok) {
      wx.showToast({ title: parsed.errMsg || '请检查设置', icon: 'none' });
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
        monthCard: parsed.monthCard,
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
