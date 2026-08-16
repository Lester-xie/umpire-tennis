const { getCourses, adminVenue, adminUpdateCourse, invalidateCourseCache } = require('../../api/tennisDb');
const { ALL_CATEGORY_ID } = require('../../utils/constants');
const { venueIdLooseEqual, normalizeVenueId } = require('../../utils/venueId');

Page({
  data: {
    scrollHeight: 400,
    loading: true,
    venueLoading: true,
    venueOptions: [],
    venueNames: [],
    venueIndex: 0,
    selectedVenueId: '',
    selectedVenueName: '',
    allCourses: [],
    courses: [],
    otherCourses: [],
    copying: false,
  },

  onShow() {
    this.bootstrap();
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

  async bootstrap() {
    this.setData({ loading: true, venueLoading: true });
    try {
      await this.loadVenues();
      await this.loadCourses();
    } catch (e) {
      console.error(e);
      this.setData({ loading: false, venueLoading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  async loadVenues() {
    const cloudRes = await adminVenue({ action: 'list' });
    const r = (cloudRes && cloudRes.result) || {};
    if (!r.ok) {
      this.setData({
        venueOptions: [],
        venueNames: [],
        venueIndex: 0,
        selectedVenueId: '',
        selectedVenueName: '',
        venueLoading: false,
      });
      wx.showToast({ title: r.errMsg || '场馆加载失败', icon: 'none' });
      return;
    }
    const docs = r.data || [];
    const venueOptions = docs
      .map((d) => ({
        id: normalizeVenueId(d._id != null ? d._id : d.id),
        name: d.name != null ? String(d.name).trim() || '未命名场馆' : '未命名场馆',
      }))
      .filter((v) => v.id);
    const venueNames = venueOptions.map((v) => v.name);

    let venueIndex = 0;
    let selectedVenueId = '';
    let selectedVenueName = '';
    if (venueOptions.length) {
      const prevId = normalizeVenueId(this.data.selectedVenueId);
      if (prevId) {
        const idx = venueOptions.findIndex((v) => venueIdLooseEqual(v.id, prevId));
        venueIndex = idx >= 0 ? idx : 0;
      }
      selectedVenueId = venueOptions[venueIndex].id;
      selectedVenueName = venueOptions[venueIndex].name;
    }

    this.setData({
      venueOptions,
      venueNames,
      venueIndex,
      selectedVenueId,
      selectedVenueName,
      venueLoading: false,
    });
  },

  async loadCourses() {
    this.setData({ loading: true });
    try {
      invalidateCourseCache();
      const pack = await getCourses(ALL_CATEGORY_ID, { forceRefresh: true });
      const allCourses = pack.data || [];
      this.setData({ allCourses });
      this.applyVenueFilter(allCourses, this.data.selectedVenueId);
      this.setData({ loading: false });
    } catch (e) {
      console.error(e);
      this.setData({ allCourses: [], courses: [], otherCourses: [], loading: false });
      wx.showToast({ title: '课程加载失败', icon: 'none' });
    }
  },

  applyVenueFilter(allCourses, venueId) {
    const vid = normalizeVenueId(venueId);
    if (!vid) {
      this.setData({ courses: [], otherCourses: [] });
      return;
    }
    const list = allCourses || [];
    const courses = [];
    const otherCourses = [];
    list.forEach((c) => {
      const cVid = c.venueId != null ? c.venueId : c.venue;
      if (venueIdLooseEqual(cVid, vid)) courses.push(c);
      else otherCourses.push(c);
    });
    this.setData({ courses, otherCourses });
  },

  onVenuePick(e) {
    const idx = Number(e.detail.value);
    const opt = (this.data.venueOptions || [])[idx];
    if (!opt) return;
    this.setData({
      venueIndex: idx,
      selectedVenueId: opt.id,
      selectedVenueName: opt.name,
    });
    this.applyVenueFilter(this.data.allCourses, opt.id);
  },

  onOpenCourse(e) {
    const id = e.currentTarget.dataset.id;
    const venueId = this.data.selectedVenueId;
    if (!id || !venueId) return;
    wx.navigateTo({
      url: `/pages/admin-course-edit/index?id=${encodeURIComponent(id)}&venueId=${encodeURIComponent(venueId)}`,
    });
  },

  async onCopyToVenue(e) {
    const sourceId = e.currentTarget.dataset.id;
    const venueId = this.data.selectedVenueId;
    const venueName = this.data.selectedVenueName || '本馆';
    if (!sourceId || !venueId || this.data.copying) return;

    const ok = await new Promise((resolve) => {
      wx.showModal({
        title: '复制到本馆',
        content: `将在「${venueName}」新建一份独立课程（含名称与价格），不影响原场馆课程。是否继续？`,
        success: (res) => resolve(!!res.confirm),
        fail: () => resolve(false),
      });
    });
    if (!ok) return;

    this.setData({ copying: true });
    wx.showLoading({ title: '复制中', mask: true });
    try {
      const res = await adminUpdateCourse({
        action: 'copyToVenue',
        sourceCourseId: sourceId,
        venueId,
      });
      wx.hideLoading();
      const r = (res && res.result) || {};
      if (!r.ok || !r.courseId) {
        wx.showToast({ title: r.errMsg || '复制失败', icon: 'none' });
        return;
      }
      invalidateCourseCache();
      wx.showToast({ title: '已复制到本馆', icon: 'success' });
      await this.loadCourses();
      wx.navigateTo({
        url: `/pages/admin-course-edit/index?id=${encodeURIComponent(r.courseId)}&venueId=${encodeURIComponent(venueId)}`,
      });
    } catch (err) {
      wx.hideLoading();
      console.error(err);
      wx.showToast({ title: '请求失败', icon: 'none' });
    } finally {
      this.setData({ copying: false });
    }
  },
});
