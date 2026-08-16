const { adminUpdateCourse, invalidateCourseCache, adminVenue } = require('../../api/tennisDb');
const { venueIdLooseEqual, normalizeVenueId } = require('../../utils/venueId');
const { typeMapToRows, rowsToTypeMap, defaultTypeMapRows } = require('../../utils/adminTypeMap');
const { courseImageSource } = require('../../utils/courseCatalog');
const { resolveImageUrlForDisplay, uploadTempImageToCloud } = require('../../utils/cloudImage');

Page({
  data: {
    scrollHeight: 400,
    courseId: '',
    loading: true,
    name: '',
    description: '',
    image: '',
    imageDisplayUrl: '',
    uploadingImage: false,
    venueId: '',
    venueOptions: [],
    venueNames: [],
    venueIndex: 0,
    venueLocked: false,
    lockVenueId: '',
    typeMapRows: defaultTypeMapRows(),
  },

  onLoad(options) {
    const id = options && options.id != null ? String(options.id).trim() : '';
    const lockVenueId =
      options && options.venueId != null ? normalizeVenueId(decodeURIComponent(String(options.venueId))) : '';
    this._courseId = id;
    this._lockVenueId = lockVenueId;
    // 每馆独立课程：编辑页固定所属场馆，禁止改绑
    this.setData({
      courseId: id,
      venueLocked: true,
      lockVenueId,
    });
    if (!id) {
      this.setData({ loading: false });
      wx.showToast({ title: '缺少课程 ID', icon: 'none' });
      return;
    }
    this.loadCourse(id);
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

  async refreshVenuePicker(selectedVenueId) {
    try {
      const cloudRes = await adminVenue({ action: 'list' });
      const r = (cloudRes && cloudRes.result) || {};
      const docs = r.ok ? r.data || [] : [];
      let venueOptions = docs
        .map((d) => ({
          id: d._id != null ? String(d._id) : '',
          name: d.name != null ? String(d.name) : '未命名',
        }))
        .filter((v) => v.id);
      const vid = normalizeVenueId(selectedVenueId);
      if (vid && !venueOptions.some((v) => venueIdLooseEqual(v.id, vid))) {
        venueOptions = [{ id: vid, name: `当前绑定 (${vid})` }, ...venueOptions];
      }
      const venueNames = venueOptions.map((v) => v.name);
      let venueIndex = 0;
      if (vid) {
        const idx = venueOptions.findIndex((v) => venueIdLooseEqual(v.id, vid));
        if (idx >= 0) venueIndex = idx;
      }
      const picked = venueOptions[venueIndex];
      this.setData({
        venueOptions,
        venueNames,
        venueIndex,
        venueId: picked ? picked.id : vid,
      });
    } catch (e) {
      console.warn('refreshVenuePicker', e);
    }
  },

  async loadCourse(id) {
    this.setData({ loading: true });
    try {
      const db = wx.cloud.database();
      const doc = await db.collection('db_course').doc(id).get();
      const d = doc.data;
      if (!d) {
        wx.showToast({ title: '未找到课程', icon: 'none' });
        this.setData({ loading: false });
        return;
      }
      const typeMapRows = typeMapToRows(d.typeMap);
      const disp =
        d.displayImage != null && String(d.displayImage).trim() !== ''
          ? String(d.displayImage).trim()
          : '';
      const img = disp || courseImageSource(d) || '';
      this.setData({
        loading: false,
        name: d.name != null ? String(d.name) : '',
        description: d.description != null ? String(d.description) : '',
        image: img,
        venueId: d.venueId != null ? String(d.venueId) : '',
        typeMapRows,
      });
      await this.refreshCourseCoverDisplay();
      // 始终展示并锁定课程自身 venueId（不改绑）
      const preferredVenue = d.venueId != null ? String(d.venueId) : d.venue != null ? String(d.venue) : '';
      await this.refreshVenuePicker(preferredVenue);
      this.setData({
        venueId: preferredVenue,
        venueLocked: true,
      });
      if (this._lockVenueId && preferredVenue && !venueIdLooseEqual(this._lockVenueId, preferredVenue)) {
        wx.showToast({ title: '该课属其他场馆，请回列表「复制到本馆」', icon: 'none', duration: 2800 });
      }
    } catch (e) {
      console.error(e);
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  onName(e) {
    this.setData({ name: e.detail.value });
  },

  onDesc(e) {
    this.setData({ description: e.detail.value });
  },

  async refreshCourseCoverDisplay() {
    const url = await resolveImageUrlForDisplay(this.data.image);
    this.setData({ imageDisplayUrl: url });
  },

  async onPickCourseCover() {
    if (this.data.uploadingImage) return;
    this.setData({ uploadingImage: true });
    try {
      const fileID = await uploadTempImageToCloud('admin-media/course');
      this.setData({ image: fileID });
      await this.refreshCourseCoverDisplay();
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

  onClearCourseCover() {
    this.setData({ image: '', imageDisplayUrl: '' });
  },

  onVenuePick(e) {
    const idx = Number(e.detail.value);
    const opt = (this.data.venueOptions || [])[idx];
    if (!opt) return;
    this.setData({ venueIndex: idx, venueId: opt.id });
  },

  onFormatKeyInput(e) {
    const fi = Number(e.currentTarget.dataset.fi);
    this.setData({ [`typeMapRows[${fi}].formatKey`]: e.detail.value });
  },

  onSessionKeyInput(e) {
    const fi = Number(e.currentTarget.dataset.fi);
    const si = Number(e.currentTarget.dataset.si);
    this.setData({ [`typeMapRows[${fi}].sessions[${si}].sessionKey`]: e.detail.value });
  },

  onSessionPriceInput(e) {
    const fi = Number(e.currentTarget.dataset.fi);
    const si = Number(e.currentTarget.dataset.si);
    this.setData({ [`typeMapRows[${fi}].sessions[${si}].price`]: e.detail.value });
  },

  onAddFormat() {
    const n = this.data.typeMapRows.length + 1;
    const rows = [
      ...this.data.typeMapRows,
      { formatKey: `规格${n}`, sessions: [{ sessionKey: '1', price: '0' }] },
    ];
    this.setData({ typeMapRows: rows });
  },

  onRemoveFormat(e) {
    if (this.data.typeMapRows.length <= 1) {
      wx.showToast({ title: '至少保留一条上课形式', icon: 'none' });
      return;
    }
    const fi = Number(e.currentTarget.dataset.fi);
    const rows = this.data.typeMapRows.filter((_, i) => i !== fi);
    this.setData({ typeMapRows: rows });
  },

  onAddSession(e) {
    const fi = Number(e.currentTarget.dataset.fi);
    const rows = JSON.parse(JSON.stringify(this.data.typeMapRows));
    if (!rows[fi].sessions) rows[fi].sessions = [];
    rows[fi].sessions.push({ sessionKey: '1', price: '0' });
    this.setData({ typeMapRows: rows });
  },

  onRemoveSession(e) {
    const fi = Number(e.currentTarget.dataset.fi);
    const si = Number(e.currentTarget.dataset.si);
    const rows = JSON.parse(JSON.stringify(this.data.typeMapRows));
    if (!rows[fi] || !rows[fi].sessions || rows[fi].sessions.length <= 1) {
      wx.showToast({ title: '每种形式至少保留一条规格', icon: 'none' });
      return;
    }
    rows[fi].sessions = rows[fi].sessions.filter((_, i) => i !== si);
    this.setData({ typeMapRows: rows });
  },

  async onSave() {
    const courseId = this._courseId;
    if (!courseId) return;

    const rows = this.data.typeMapRows || [];
    for (let i = 0; i < rows.length; i += 1) {
      if (!String(rows[i].formatKey || '').trim()) {
        wx.showToast({ title: `请填写第 ${i + 1} 条的上课形式（如 1V1）`, icon: 'none' });
        return;
      }
    }

    const typeMap = rowsToTypeMap(rows);
    if (Object.keys(typeMap).length === 0) {
      wx.showToast({ title: '请填写有效的课时规格与单价', icon: 'none' });
      return;
    }

    const imgStr = String(this.data.image || '').trim();
    const venueId = normalizeVenueId(this.data.venueId);
    if (!venueId) {
      wx.showToast({ title: '课程未绑定场馆', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '保存中', mask: true });
    try {
      const res = await adminUpdateCourse({
        courseId,
        patch: {
          name: this.data.name,
          description: this.data.description,
          venueId,
          typeMap,
          image: imgStr,
          picture: imgStr,
          displayImage: imgStr,
        },
      });
      wx.hideLoading();
      const r = (res && res.result) || {};
      if (r.ok) {
        invalidateCourseCache();
        wx.showToast({ title: '已保存', icon: 'success' });
      } else {
        wx.showToast({ title: r.errMsg || '失败', icon: 'none' });
      }
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '请求失败', icon: 'none' });
    }
  },
});
