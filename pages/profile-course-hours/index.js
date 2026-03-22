const { getVenues, listAllMemberCourseHours } = require('../../api/tennisDb');
const { formatLessonKeyDisplay } = require('../../utils/lessonKey');
const { normalizeVenueId } = require('../../utils/venueId');

function buildSections(venueRows, venueNameById) {
  const byVenue = {};
  (venueRows || []).forEach((row) => {
    const vid = normalizeVenueId(row.venueId);
    const hours = Number(row.hours) || 0;
    if (hours <= 0 || !vid) return;
    const lessonKey = String(row.lessonKey || '').trim() || '—';
    if (!byVenue[vid]) byVenue[vid] = {};
    const bucket = byVenue[vid];
    if (!bucket[lessonKey]) {
      bucket[lessonKey] = {
        lessonKey,
        lessonLabel: formatLessonKeyDisplay(row.lessonKey),
        hours: 0,
      };
    }
    bucket[lessonKey].hours += hours;
  });
  const sections = Object.keys(byVenue).map((vid) => ({
    venueId: vid,
    venueName: venueNameById[vid] || `场馆 ${vid}`,
    rows: Object.values(byVenue[vid]),
  }));
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
  },

  onShow() {
    this.refresh();
  },

  onReady() {
    this.calculateHeaderHeight();
    this.calculateContentHeight();
  },

  calculateHeaderHeight() {
    const query = wx.createSelectorQuery();
    query.select('.header').boundingClientRect();
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
    const windowHeight = windowInfo.windowHeight;
    const query = wx.createSelectorQuery();
    query.select('.header').boundingClientRect();
    query.exec((res) => {
      const headerRect = res[0];
      const headerH = headerRect?.height || 55;
      const safeAreaBottom = windowInfo.safeArea
        ? windowInfo.screenHeight - windowInfo.safeArea.bottom
        : 0;
      const contentHeight = Math.max(windowHeight - headerH - safeAreaBottom - 24, 300);
      this.setData({
        contentHeight,
        placeholderHeight: safeAreaBottom + 24,
      });
    });
  },

  async refresh() {
    const app = getApp();
    const isLoggedIn = app ? app.checkLogin() : false;
    const phone = String(wx.getStorageSync('user_phone') || '').trim();

    if (!isLoggedIn || !phone) {
      this.setData({ isLoggedIn: false, sections: [] });
      return;
    }

    try {
      const [venuesRes, hoursRes] = await Promise.all([getVenues(), listAllMemberCourseHours()]);
      const venues = (venuesRes && venuesRes.data) || [];
      const venueNameById = {};
      venues.forEach((v) => {
        const id = normalizeVenueId(v._id);
        if (id) venueNameById[id] = (v.name && String(v.name).trim()) || id;
      });
      const raw =
        hoursRes && hoursRes.result && Array.isArray(hoursRes.result.data)
          ? hoursRes.result.data
          : [];
      const sections = buildSections(raw, venueNameById);
      this.setData({ isLoggedIn: true, sections });
    } catch (e) {
      console.error('加载课时失败', e);
      wx.showToast({ title: '加载失败', icon: 'none' });
      this.setData({ isLoggedIn: true, sections: [] });
    }
  },
});
