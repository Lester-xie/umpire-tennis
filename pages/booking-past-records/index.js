const { listVenueBookingsByDate } = require('../../api/tennisDb');
const { buildCourtOrderDisplay } = require('../../utils/profileHistoryHelpers');
const { slotIndexToHour } = require('../../utils/bookingTimeSlots');

function formatSlotLabel(slotIndex) {
  const h = slotIndexToHour(slotIndex);
  if (!Number.isFinite(h)) return '';
  const h2 = h + 1;
  const a = `${h < 10 ? `0${h}` : h}:00`;
  const b = `${h2 < 10 ? `0${h2}` : h2}:00`;
  return `${a}-${b}`;
}

Page({
  data: {
    headerHeight: 0,
    loading: true,
    venueId: '',
    orderDate: '',
    courtId: '',
    slotIndex: '',
    filterLabel: '',
    titleDate: '',
    records: [],
  },

  onLoad(options) {
    const venueId = options && options.venueId != null ? decodeURIComponent(String(options.venueId)) : '';
    const orderDate =
      options && options.orderDate != null ? decodeURIComponent(String(options.orderDate)) : '';
    const courtId =
      options && options.courtId != null && String(options.courtId).trim() !== ''
        ? String(options.courtId).trim()
        : '';
    const slotIndex =
      options && options.slotIndex != null && String(options.slotIndex).trim() !== ''
        ? String(options.slotIndex).trim()
        : '';

    let filterLabel = '';
    if (courtId && slotIndex !== '') {
      filterLabel = `${courtId}号场 · ${formatSlotLabel(Number(slotIndex))}`;
    }

    const parts = String(orderDate || '').split('-');
    const titleDate =
      parts.length === 3
        ? `${parseInt(parts[1], 10)}月${parseInt(parts[2], 10)}日`
        : orderDate;

    this.setData({
      venueId,
      orderDate,
      courtId,
      slotIndex,
      filterLabel,
      titleDate,
    });
    this.loadRecords();
  },

  onReady() {
    this.layout();
  },

  layout() {
    const query = wx.createSelectorQuery();
    query.select('.header-wrapper').boundingClientRect();
    query.exec((res) => {
      const headerRect = res && res[0];
      const app = getApp();
      const pad = app?.globalData?.screenInfo?.headerInfo?.headerPaddingTop || 0;
      const headerH = headerRect && headerRect.height > 0 ? headerRect.height : pad + 55;
      this.setData({ headerHeight: headerH });
    });
  },

  async loadRecords() {
    const { venueId, orderDate, courtId, slotIndex } = this.data;
    if (!venueId || !orderDate) {
      this.setData({ loading: false, records: [] });
      wx.showToast({ title: '参数缺失', icon: 'none' });
      return;
    }
    this.setData({ loading: true });
    try {
      const cloudRes = await listVenueBookingsByDate({
        venueId,
        orderDate,
        ...(courtId ? { courtId: Number(courtId) } : {}),
        ...(slotIndex !== '' ? { slotIndex: Number(slotIndex) } : {}),
      });
      const r = (cloudRes && cloudRes.result) || {};
      if (!r.ok) {
        this.setData({ loading: false, records: [] });
        wx.showToast({ title: r.errMsg || '加载失败', icon: 'none' });
        return;
      }
      const records = (r.data || []).map((order) => {
        const disp = buildCourtOrderDisplay(order);
        const name = String(order.memberDisplayName || '').trim();
        const phone = String(order.phone || '').trim();
        const subtype = String(order.bookingSubtype || '').trim();
        let subtypeLabel = '';
        if (subtype === 'coach_course') subtypeLabel = '教练课';
        else if (subtype) subtypeLabel = subtype;
        return {
          ...disp,
          memberLabel: name || phone || '会员',
          phoneLabel: phone && name ? phone : '',
          subtypeLabel,
        };
      });
      this.setData({ loading: false, records });
    } catch (e) {
      console.error(e);
      this.setData({ loading: false, records: [] });
      wx.showToast({ title: '请求失败', icon: 'none' });
    }
  },
});
