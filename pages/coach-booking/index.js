const {
  getBookedSlots,
  getCategories,
  getUserByPhone,
  coachHoldSlots,
  listCoachHolds,
  cancelCoachHold,
  updateCoachHolds,
} = require('../../api/tennisDb');
const { indexCategoriesByCoachLessonType } = require('../../utils/coachPurposeScales');
const { indexDocsById } = require('../../utils/courseCatalog');
const {
  normalizeOrderDateStr,
  getTodayDateStr,
  buildBookingDateList,
} = require('../../utils/bookingDate');
const { buildSlotPriceMapFromCourtList } = require('../../utils/bookingSlotPrice');
const coachPurpose = require('../../utils/coachBookingPurpose');
const { mergeBookedSlotsAndCoachHolds } = require('../../utils/coachBookingBookedMerge');
const { buildBookingTimeSlots } = require('../../utils/bookingTimeSlots');
const { buildCoachCourts } = require('../../utils/bookingCoachSlots');
const {
  computeBookingMainContentHeightPx,
  estimateBookingHeaderHeightPx,
} = require('../../utils/bookingLayout');
const {
  buildCoachHoldSlotsPayload,
  buildUpdateCoachHoldsPayload,
} = require('../../utils/coachHoldPayload');

Page({
  data: {
    dateList: [], // 日期列表
    selectedDate: '', // 选中的日期字符串
    rippleDate: '', // 当前显示波纹动画的日期
    timeSlots: [], // 时间段列表
    courts: [], // 场地列表
    contentHeight: 400, // content 高度
    selectedSlots: [], // 选中的时间段 [{courtId, slotIndex}]
    selectedSlotsMap: {}, // 选中状态映射 {courtId-slotIndex: true}
    rippleSlot: null, // 当前显示波纹动画的时间段 {courtId, slotIndex}
    totalPrice: 0, // 总价
    selectedVenueName: '', // 当前选定的球场名称
    selectedVenueId: '', // 当前选定的球场 id
    priceLoading: false, // 加载价格规则状态
    showPurposeSheet: false,
    /** experience | regular | group | open_play（畅打，仅管理员用途） */
    lessonType: 'experience',
    /** 管理员：用途仅畅打；与 isCoach 互斥展示（教练+管理员时管理员优先） */
    purposeOnlyOpenPlay: false,
    /** 非管理员教练：展示体验课/正课/团课，不含畅打 */
    purposeShowStandardTypes: false,
    /** 体验课/正课：1v1 | 1v2 */
    pairMode: '1v1',
    /** 团课：固定 group35（3-5人） */
    groupMode: 'group35',
    /** purpose 弹层：create 新占场 | edit 改本人占用 */
    purposeSheetMode: 'create',
    editingHoldIds: [],
    /** 来自 db_category.scaleList，随课程类型切换 */
    purposePairScales: [],
    purposeGroupScales: [],
  },

  // 动画定时器
  rippleTimer: null,
  slotRippleTimer: null,
  /** 已支付订单 + 教练占用 的格子键 Set */
  bookedSlotKeySet: null,
  /** 每次发起 getBookedSlots 自增，用于丢弃过期响应 */
  _bookedSlotsFetchToken: 0,

  /**
   * @param {boolean} [allowOpenPlayOpt] 传入时可避免 setData 尚未合并时读错 purposeOnlyOpenPlay
   */
  async loadCoachCategories(allowOpenPlayOpt) {
    try {
      const [catRes, scaleRes] = await Promise.all([
        getCategories(),
        wx.cloud
          .database()
          .collection('db_course_scale')
          .get()
          .catch(() => ({ data: [] })),
      ]);
      const list = (catRes && catRes.data) || [];
      const allowOpenPlay =
        allowOpenPlayOpt !== undefined ? !!allowOpenPlayOpt : !!this.data.purposeOnlyOpenPlay;
      this._coachCategoryIndex = indexCategoriesByCoachLessonType(list, { allowOpenPlay });
      this._courseScaleById = indexDocsById((scaleRes && scaleRes.data) || []);
    } catch (err) {
      console.error('loadCoachCategories', err);
      this._coachCategoryIndex = {};
      this._courseScaleById = {};
    }
  },

  async refreshManagerAndCoachCatalog() {
    let isManager = false;
    let isCoach = false;
    const phone = String(wx.getStorageSync('user_phone') || '').trim();
    if (phone) {
      try {
        const res = await getUserByPhone(phone);
        const u = res && res.data && res.data[0];
        isManager = !!(u && u.isManager);
        isCoach = !!(u && u.isCoach);
      } catch (e) {
        console.warn('refreshManagerAndCoachCatalog', e);
      }
    }
    const purposeOnlyOpenPlay = !!isManager;
    const purposeShowStandardTypes = !!isCoach && !isManager;
    const hadPurposeOnlyOpenPlay = this.data.purposeOnlyOpenPlay;
    this.setData({ purposeOnlyOpenPlay, purposeShowStandardTypes });
    await this.loadCoachCategories(purposeOnlyOpenPlay);
    if (purposeOnlyOpenPlay) {
      const patch = this.applyPurposeScalesForLessonType('open_play', '', '');
      this.setData({ lessonType: 'open_play', ...patch });
    } else if (hadPurposeOnlyOpenPlay && !purposeOnlyOpenPlay && this.data.lessonType === 'open_play') {
      const patch = this.applyPurposeScalesForLessonType('experience', '1v1', 'group35');
      this.setData({ lessonType: 'experience', ...patch });
    }
  },

  applyPurposeScalesForLessonType(lessonType, pairModeIn, groupModeIn) {
    return coachPurpose.applyPurposeScalesForLessonType(
      lessonType,
      pairModeIn,
      groupModeIn,
      this._coachCategoryIndex,
      this._courseScaleById
    );
  },

  resolveSelectedScaleDisplayName(lessonType, pairMode, groupMode) {
    return coachPurpose.resolveSelectedScaleDisplayName(
      lessonType,
      pairMode,
      groupMode,
      this.data.purposePairScales,
      this.data.purposeGroupScales
    );
  },

  resolveSelectedCapacityLimit(lessonType, pairMode, groupMode) {
    return coachPurpose.resolveSelectedCapacityLimit(
      lessonType,
      pairMode,
      groupMode,
      this.data.purposePairScales,
      this.data.purposeGroupScales
    );
  },

  /** 标题：去选场页，选完后返回本页 */
  handleContentHeaderTitleTap() {
    wx.navigateTo({
      url: '/pages/location/index?from=booking',
    });
  },

  onLoad() {
    this.coachHoldMeta = {};
    this.myCoachHoldIdSet = new Set();
    this._coachCategoryIndex = {};
    this._courseScaleById = {};
    this.refreshManagerAndCoachCatalog();
    const newVenueId = this.syncSelectedVenueName();
    this.generateDateList();
    this.loadSlotPricesAndRender(newVenueId);
  },

  onShow() {
    this.refreshManagerAndCoachCatalog();
    const newVenueId = this.syncSelectedVenueName();
    if (newVenueId) {
      this.loadSlotPricesAndRender(newVenueId);
    }
    const app = getApp();
    if (app && app.globalData && app.globalData.shouldClearBookingData) {
      this.clearBookingData();
      app.globalData.shouldClearBookingData = false;
    }
  },

  syncSelectedVenueName() {
    const app = getApp();
    const venue = app && app.globalData && app.globalData.selectedVenue;
    const name = venue && venue.name ? venue.name : '';
    const venueId = venue && venue.id ? venue.id : '';

    if (name !== this.data.selectedVenueName || venueId !== this.data.selectedVenueId) {
      this.setData({ selectedVenueName: name, selectedVenueId: venueId });
      this.resetSelectedSlots();
      return venueId;
    }
    return null;
  },

  resetSelectedSlots() {
    this.setData({
      selectedSlots: [],
      selectedSlotsMap: {},
      totalPrice: 0,
      rippleSlot: null,
    });
    if (this.slotRippleTimer) {
      clearTimeout(this.slotRippleTimer);
      this.slotRippleTimer = null;
    }
  },

  clearBookingData() {
    this.loadSlotPricesAndRender();

    this.setData({
      selectedSlots: [],
      selectedSlotsMap: {},
      totalPrice: 0,
      rippleSlot: null,
    });

    if (this.slotRippleTimer) {
      clearTimeout(this.slotRippleTimer);
      this.slotRippleTimer = null;
    }
  },

  onReady() {
    this.calculateContentHeight();
  },

  calculateContentHeight() {
    const windowInfo = wx.getWindowInfo();
    const app = getApp();
    const screenInfo = app && app.globalData && app.globalData.screenInfo;

    const query = wx.createSelectorQuery();
    query.select('.header').boundingClientRect();
    query.exec((res) => {
      const headerRect = res[0];
      const finalHeaderHeight = estimateBookingHeaderHeightPx(
        headerRect ? headerRect.height : 0,
        screenInfo
      );

      const safeAreaBottom = windowInfo.safeArea
        ? windowInfo.screenHeight - windowInfo.safeArea.bottom
        : 0;

      const contentHeight = computeBookingMainContentHeightPx({
        windowHeight: windowInfo.windowHeight,
        finalHeaderHeight,
        safeAreaBottom,
      });
      this.setData({ contentHeight });
    });
  },

  loadSlotPricesAndRender(venueIdOverride) {
    const venueId =
      venueIdOverride !== undefined ? venueIdOverride : this.data.selectedVenueId;

    this.slotPriceMap = {};

    const selectedDate = this.data.selectedDate || getTodayDateStr();

    const resetAndFetch = () => {
      this.bookedSlotKeySet = new Set();
      this.coachHoldMeta = {};
      this.myCoachHoldIdSet = new Set();
      this.generateTimeSchedule();
      this.fetchBookedSlotsForDate(selectedDate).then((applied) => {
        if (applied) this.generateTimeSchedule();
      });
    };

    if (!venueId) {
      resetAndFetch();
      return;
    }

    const app = getApp();
    const venue = app && app.globalData && app.globalData.selectedVenue;
    const courtList = venue && Array.isArray(venue.courtList) ? venue.courtList : [];

    if (courtList.length > 0) {
      this.slotPriceMap = buildSlotPriceMapFromCourtList(courtList);
      this.setData({ priceLoading: false });
      resetAndFetch();
      return;
    }

    this.slotPriceMap = {};
    wx.showToast({ title: '场馆未配置场地价格', icon: 'none' });
    this.setData({ priceLoading: false });
    resetAndFetch();
  },

  fetchBookedSlotsForDate(orderDate) {
    const venueId = this.data.selectedVenueId;
    if (!venueId || !orderDate) {
      return Promise.resolve(false);
    }
    this._bookedSlotsFetchToken = (this._bookedSlotsFetchToken || 0) + 1;
    const token = this._bookedSlotsFetchToken;
    const normDate = normalizeOrderDateStr(orderDate);
    return Promise.all([
      getBookedSlots({ venueId, orderDate }),
      listCoachHolds({
        venueId,
        orderDate: normDate,
        includeReleasedForSession: true,
      }).catch(() => ({ result: { data: [] } })),
    ])
      .then(([bookedRes, holdsRes]) => {
        if (token !== this._bookedSlotsFetchToken) {
          return false;
        }
        const r = bookedRes && bookedRes.result ? bookedRes.result : {};
        const rows =
          holdsRes && holdsRes.result && Array.isArray(holdsRes.result.data)
            ? holdsRes.result.data
            : [];
        const { keySet, coachHoldMeta, myHoldIdSet } = mergeBookedSlotsAndCoachHolds(
          r,
          rows,
          venueId,
          normDate
        );
        this.bookedSlotKeySet = keySet;
        this.coachHoldMeta = coachHoldMeta;
        this.myCoachHoldIdSet = myHoldIdSet;
        return true;
      })
      .catch((e) => {
        console.error('getBookedSlots failed', e);
        return false;
      });
  },

  generateDateList() {
    const { dateList, defaultSelectedDate } = buildBookingDateList(60, this.data.selectedDate);
    const patch = { dateList };
    if (!this.data.selectedDate && defaultSelectedDate) {
      patch.selectedDate = defaultSelectedDate;
    }
    this.setData(patch);
  },

  handleDateClick(e) {
    const { datestr } = e.currentTarget.dataset;
    if (!datestr) return;

    if (this.rippleTimer) {
      clearTimeout(this.rippleTimer);
      this.rippleTimer = null;
    }

    this.updateSlotsAvailability(datestr);

    this.setData({ rippleDate: '' }, () => {
      const playRipple = () => {
        this.setData({ rippleDate: datestr });
        this.rippleTimer = setTimeout(() => {
          this.setData({ rippleDate: '' });
          this.rippleTimer = null;
        }, 600);
      };
      if (typeof requestAnimationFrame !== 'undefined') {
        requestAnimationFrame(playRipple);
      } else {
        setTimeout(playRipple, 16);
      }
    });
  },

  generateTimeSchedule(selectedDateOverride) {
    const timeSlots = buildBookingTimeSlots();
    const selectedDate =
      selectedDateOverride != null
        ? selectedDateOverride
        : this.data.selectedDate || getTodayDateStr();

    const app = getApp();
    const venue = app && app.globalData && app.globalData.selectedVenue;
    const courtList = venue && Array.isArray(venue.courtList) ? venue.courtList : [];

    const courts = buildCoachCourts({
      timeSlots,
      selectedDate,
      todayStr: getTodayDateStr(),
      now: new Date(),
      courtList,
      slotPriceMap: this.slotPriceMap,
      coachHoldMeta: this.coachHoldMeta,
      bookedSlotKeySet: this.bookedSlotKeySet,
      purposeOnlyOpenPlay: this.data.purposeOnlyOpenPlay,
      myCoachHoldIdSet: this.myCoachHoldIdSet,
    });

    this.setData({
      timeSlots,
      courts,
    });
  },

  _isTruthyDataset(v) {
    return v === true || v === 1 || v === '1' || v === 'true';
  },

  handleCoachHoldCellTap(e) {
    const ds = e.currentTarget.dataset || {};
    if (!this._isTruthyDataset(ds.canmanage)) {
      wx.showToast({ title: '非本人占用，无法操作', icon: 'none' });
      return;
    }
    const holdids = ds.holdids != null ? String(ds.holdids) : '';
    const idList = holdids
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const mySet = this.myCoachHoldIdSet || new Set();
    const isMgr = this.data.purposeOnlyOpenPlay;
    const owned = idList.some((id) => mySet.has(id));
    const myIds = isMgr ? idList : idList.filter((id) => mySet.has(id));
    if (myIds.length === 0) {
      wx.showToast({ title: '无权限操作该占用', icon: 'none' });
      return;
    }
    const releasedOnly = this._isTruthyDataset(ds.released);
    if (releasedOnly) {
      wx.showActionSheet({
        itemList: ['取消场次（已报名将移除，课时将退回）'],
        success: (res) => {
          if (res.tapIndex === 0) {
            this.confirmCancelCoachHolds(myIds.join(','));
          }
        },
      });
      return;
    }
    const canEditPurpose = owned;
    if (!canEditPurpose) {
      wx.showActionSheet({
        itemList: ['取消预订'],
        success: (res) => {
          if (res.tapIndex === 0) {
            this.confirmCancelCoachHolds(myIds.join(','));
          }
        },
      });
      return;
    }
    wx.showActionSheet({
      itemList: ['更改场地类型', '取消预订'],
      success: (res) => {
        if (res.tapIndex === 0) {
          const pm = ds.pairmode || '1v1';
          const gm = ds.groupmode || 'group35';
          let lt = ds.lessontype || 'experience';
          if (this.data.purposeOnlyOpenPlay) {
            lt = 'open_play';
          } else if (lt === 'open_play') {
            lt = 'experience';
          }
          const scalePatch = this.applyPurposeScalesForLessonType(lt, pm, gm);
          this.setData({
            showPurposeSheet: true,
            purposeSheetMode: 'edit',
            editingHoldIds: myIds,
            lessonType: lt,
            ...scalePatch,
          });
        } else if (res.tapIndex === 1) {
          this.confirmCancelCoachHolds(myIds.join(','));
        }
      },
    });
  },

  confirmCancelCoachHolds(holdidsStr) {
    const raw = String(holdidsStr || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const mySet = this.myCoachHoldIdSet || new Set();
    const isMgr = this.data.purposeOnlyOpenPlay;
    const ids = isMgr ? raw : raw.filter((id) => mySet.has(id));
    if (ids.length === 0) {
      wx.showToast({ title: '无可用占用记录', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '取消预订',
      content:
        '确定取消该时段？连续占用将一并取消。若已有学员报名，相关订单将作废；使用课时的部分将自动退回，微信支付部分请联系场馆处理退款。',
      confirmText: '取消占用',
      confirmColor: '#c62828',
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '处理中...' });
        try {
          const cloudRes = await cancelCoachHold({ holdIds: ids });
          const r = (cloudRes && cloudRes.result) || {};
          wx.hideLoading();
          if (!r.ok) {
            wx.showToast({ title: r.errMsg || '取消失败', icon: 'none' });
            return;
          }
          wx.showToast({ title: '已取消', icon: 'success' });
          this.loadSlotPricesAndRender();
        } catch (err) {
          wx.hideLoading();
          console.error('confirmCancelCoachHolds', err);
          wx.showToast({ title: '网络异常', icon: 'none' });
        }
      },
    });
  },

  confirmPurposeSheet() {
    if (this.data.purposeSheetMode === 'edit') {
      this.submitCoachHoldEdit();
    } else {
      this.submitCoachHold();
    }
  },

  async submitCoachHoldEdit() {
    const { editingHoldIds, lessonType, pairMode, groupMode } = this.data;
    const mySet = this.myCoachHoldIdSet || new Set();
    const ids = (Array.isArray(editingHoldIds) ? editingHoldIds : [])
      .map((id) => String(id || '').trim())
      .filter((id) => id && mySet.has(id));
    if (ids.length === 0) {
      wx.showToast({ title: '缺少占用记录', icon: 'none' });
      return;
    }
    const scaleDisplayName = this.resolveSelectedScaleDisplayName(
      lessonType,
      pairMode,
      groupMode
    );
    wx.showLoading({ title: '保存中...' });
    try {
      const capacityLimit = this.resolveSelectedCapacityLimit(lessonType, pairMode, groupMode);
      const cloudRes = await updateCoachHolds(
        buildUpdateCoachHoldsPayload({
          holdIds: ids,
          lessonType,
          pairMode,
          groupMode,
          scaleDisplayName,
          capacityLimit,
        })
      );
      const r = (cloudRes && cloudRes.result) || {};
      wx.hideLoading();
      if (!r.ok) {
        wx.showToast({ title: r.errMsg || '保存失败', icon: 'none' });
        return;
      }
      wx.showToast({ title: '已更新', icon: 'success' });
      this.setData({
        showPurposeSheet: false,
        purposeSheetMode: 'create',
        editingHoldIds: [],
      });
      this.loadSlotPricesAndRender();
    } catch (e) {
      wx.hideLoading();
      console.error('submitCoachHoldEdit', e);
      wx.showToast({ title: '网络异常', icon: 'none' });
    }
  },

  updateSlotsAvailability(selectedDate) {
    this.bookedSlotKeySet = new Set();
    this.coachHoldMeta = {};
    this.myCoachHoldIdSet = new Set();
    this.generateTimeSchedule(selectedDate);
    this.setData({
      selectedDate,
      selectedSlots: [],
      selectedSlotsMap: {},
      totalPrice: 0,
    });
    this.fetchBookedSlotsForDate(selectedDate).then((applied) => {
      if (applied) this.generateTimeSchedule(selectedDate);
    });
  },

  handleSlotClick(e) {
    const { courtid, slotindex } = e.currentTarget.dataset;
    if (!courtid || slotindex === undefined) return;

    const courtId = parseInt(courtid, 10);
    const slotIndex = parseInt(slotindex, 10);

    const court = this.data.courts.find((c) => c.id === courtId);
    if (!court || !court.slots[slotIndex] || !court.slots[slotIndex].available) {
      return;
    }

    if (this.slotRippleTimer) {
      clearTimeout(this.slotRippleTimer);
      this.slotRippleTimer = null;
    }

    const slotKey = `${courtId}-${slotIndex}`;
    const isSelected = this.data.selectedSlots.some(
      (s) => s.courtId === courtId && s.slotIndex === slotIndex
    );

    let newSelectedSlots = [...this.data.selectedSlots];
    let newSelectedSlotsMap = { ...this.data.selectedSlotsMap };

    if (isSelected) {
      newSelectedSlots = newSelectedSlots.filter(
        (s) => !(s.courtId === courtId && s.slotIndex === slotIndex)
      );
      delete newSelectedSlotsMap[slotKey];
    } else {
      newSelectedSlots.push({ courtId, slotIndex });
      newSelectedSlotsMap[slotKey] = true;
    }

    const totalPrice = this.calculateTotalPrice(newSelectedSlots);

    this.setData(
      {
        selectedSlots: newSelectedSlots,
        selectedSlotsMap: newSelectedSlotsMap,
        totalPrice,
        rippleSlot: null,
      },
      () => {
        if (typeof requestAnimationFrame !== 'undefined') {
          requestAnimationFrame(() => {
            this.setData({
              rippleSlot: { courtId, slotIndex },
            });

            this.slotRippleTimer = setTimeout(() => {
              this.setData({
                rippleSlot: null,
              });
              this.slotRippleTimer = null;
            }, 600);
          });
        } else {
          setTimeout(() => {
            this.setData({
              rippleSlot: { courtId, slotIndex },
            });

            this.slotRippleTimer = setTimeout(() => {
              this.setData({
                rippleSlot: null,
              });
              this.slotRippleTimer = null;
            }, 600);
          }, 16);
        }
      }
    );
  },

  calculateTotalPrice(selectedSlots) {
    if (!selectedSlots || selectedSlots.length === 0) {
      return 0;
    }

    let total = 0;
    selectedSlots.forEach((slot) => {
      const court = this.data.courts.find((c) => c.id === slot.courtId);
      if (court && court.slots[slot.slotIndex] && court.slots[slot.slotIndex].available) {
        total += court.slots[slot.slotIndex].price || 0;
      }
    });

    return total;
  },

  handleNextToPurpose() {
    if (!this.data.selectedVenueId) {
      wx.showModal({
        title: '未选择场馆',
        content: '请先到选场馆页选择要占用的场馆。',
        confirmText: '去选场馆',
        confirmColor: '#134E35',
        success: (res) => {
          if (res.confirm) {
            wx.navigateTo({ url: '/pages/location/index?from=booking' });
          }
        },
      });
      return;
    }
    if (this.data.selectedSlots.length === 0) {
      wx.showToast({
        title: '请选择时间段',
        icon: 'none',
      });
      return;
    }
    if (!this.data.purposeOnlyOpenPlay && !this.data.purposeShowStandardTypes) {
      wx.showToast({ title: '无权限占用场地', icon: 'none' });
      return;
    }
    const onlyOpen = this.data.purposeOnlyOpenPlay;
    const lt = onlyOpen ? 'open_play' : this.data.lessonType;
    const scalePatch = this.applyPurposeScalesForLessonType(
      lt,
      onlyOpen ? '' : this.data.pairMode,
      onlyOpen ? '' : this.data.groupMode
    );
    this.setData({
      showPurposeSheet: true,
      purposeSheetMode: 'create',
      editingHoldIds: [],
      ...(onlyOpen ? { lessonType: 'open_play' } : {}),
      ...scalePatch,
    });
  },

  closePurposeSheet() {
    this.setData({
      showPurposeSheet: false,
      purposeSheetMode: 'create',
      editingHoldIds: [],
    });
  },

  selectLessonType(e) {
    const { v } = e.currentTarget.dataset;
    if (!v) return;
    if (this.data.purposeOnlyOpenPlay) return;
    if (v === 'open_play') return;
    const scalePatch = this.applyPurposeScalesForLessonType(v, '', '');
    this.setData({
      lessonType: v,
      ...scalePatch,
    });
  },

  selectPurposeScale(e) {
    const { kind, code } = e.currentTarget.dataset;
    if (!code) return;
    if (kind === 'group') {
      this.setData({ groupMode: code });
    } else {
      this.setData({ pairMode: code });
    }
  },

  async submitCoachHold() {
    const {
      selectedSlots,
      selectedDate,
      selectedVenueId,
      lessonType,
      pairMode,
      groupMode,
    } = this.data;

    wx.showLoading({ title: '提交中...' });
    const app = getApp();
    const venue = app && app.globalData && app.globalData.selectedVenue;
    const venueName = venue && venue.name ? String(venue.name).trim() : '';

    const scaleDisplayName = this.resolveSelectedScaleDisplayName(
      lessonType,
      pairMode,
      groupMode
    );
    try {
      const capacityLimit = this.resolveSelectedCapacityLimit(lessonType, pairMode, groupMode);
      const cloudRes = await coachHoldSlots(
        buildCoachHoldSlotsPayload({
          selectedVenueId,
          venueName,
          selectedDate,
          selectedSlots,
          lessonType,
          pairMode,
          groupMode,
          scaleDisplayName,
          capacityLimit,
        })
      );
      const r = (cloudRes && cloudRes.result) || {};
      wx.hideLoading();
      if (!r.ok) {
        wx.showToast({
          title: r.errMsg || '占用失败',
          icon: 'none',
        });
        return;
      }
      const heldKeys = selectedSlots.map(
        (s) => `${Number(s.courtId)}-${Number(s.slotIndex)}`
      );
      wx.showToast({ title: '已占用时段', icon: 'success' });
      this.setData({
        showPurposeSheet: false,
        purposeSheetMode: 'create',
        editingHoldIds: [],
        selectedSlots: [],
        selectedSlotsMap: {},
        totalPrice: 0,
        rippleSlot: null,
      });
      if (!this.bookedSlotKeySet) this.bookedSlotKeySet = new Set();
      heldKeys.forEach((k) => this.bookedSlotKeySet.add(k));
      this.generateTimeSchedule(selectedDate);
      this.fetchBookedSlotsForDate(selectedDate).then((applied) => {
        if (!applied) return;
        heldKeys.forEach((k) => this.bookedSlotKeySet.add(k));
        this.generateTimeSchedule(selectedDate);
      });
    } catch (e) {
      wx.hideLoading();
      console.error('submitCoachHold', e);
      wx.showToast({ title: '网络异常', icon: 'none' });
    }
  },
});
