const {
  getBookedSlots,
  getUserByPhone,
  coachHoldSlots,
  adminCoachHoldForCoach,
  adminVenueSlotLock,
  listCoachHolds,
  cancelCoachHold,
  updateCoachHolds,
  refreshSelectedVenueFromCloud,
} = require('../../api/tennisDb');
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
const { defaultMemberPriceYuanFromVenue } = require('../../utils/venueCategoryList');
const {
  buildCoachHoldSlotsPayload,
  buildUpdateCoachHoldsPayload,
} = require('../../utils/coachHoldPayload');

/** 每格 1 小时；团课至少 2 小时 */
const GROUP_LESSON_MIN_SLOTS = 2;

/**
 * 团课：时段须在同一场地，且 slotIndex 连续，总时长 ≥2 小时。
 * @param {{ courtId: number, slotIndex: number }[]} slots
 * @returns {{ ok: boolean, errMsg?: string }}
 */
function validateGroupLessonSlots(slots) {
  const list = Array.isArray(slots) ? slots : [];
  if (list.length < GROUP_LESSON_MIN_SLOTS) {
    return { ok: false, errMsg: '团课至少选择连续 2 小时' };
  }
  const byCourt = new Map();
  list.forEach((s) => {
    const cid = Number(s.courtId);
    const idx = Number(s.slotIndex);
    if (!Number.isFinite(cid) || !Number.isFinite(idx)) return;
    if (!byCourt.has(cid)) byCourt.set(cid, new Set());
    byCourt.get(cid).add(idx);
  });
  if (byCourt.size !== 1) {
    return { ok: false, errMsg: '团课需在同一场地选择时段' };
  }
  const indices = [...byCourt.values()][0];
  const sorted = [...indices].sort((a, b) => a - b);
  if (sorted.length < GROUP_LESSON_MIN_SLOTS) {
    return { ok: false, errMsg: '团课至少选择连续 2 小时' };
  }
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i] !== sorted[i - 1] + 1) {
      return { ok: false, errMsg: '团课需选择连续的时间段' };
    }
  }
  return { ok: true };
}

/**
 * 根据 coachHoldMeta 解析 editingHoldIds 对应的场地格子（用于编辑用途时校验团课）
 * @returns {{ courtId: number, slotIndex: number }[]}
 */
function collectSlotPairsForCoachHoldIds(coachHoldMeta, editingHoldIds) {
  const want = new Set(
    (Array.isArray(editingHoldIds) ? editingHoldIds : [])
      .map((id) => String(id || '').trim())
      .filter(Boolean)
  );
  if (want.size === 0) return [];
  const pairSet = new Set();
  const pairs = [];
  Object.keys(coachHoldMeta || {}).forEach((k) => {
    const m = coachHoldMeta[k];
    if (!m) return;
    const hid = m.holdId != null ? String(m.holdId).trim() : '';
    const sessionIds = Array.isArray(m.sessionHoldIds) ? m.sessionHoldIds : [];
    const match =
      (hid && want.has(hid)) ||
      sessionIds.some((x) => want.has(String(x || '').trim()));
    if (!match) return;
    const parts = k.split('-');
    const courtId = Number(parts[0]);
    const slotIndex = Number(parts[1]);
    if (!Number.isFinite(courtId) || !Number.isFinite(slotIndex)) return;
    const key = `${courtId}-${slotIndex}`;
    if (pairSet.has(key)) return;
    pairSet.add(key);
    pairs.push({ courtId, slotIndex });
  });
  pairs.sort((a, b) => a.courtId - b.courtId || a.slotIndex - b.slotIndex);
  return pairs;
}

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
    /** 管理员多选解锁：已锁定格 [{ courtId, slotIndex, holdIds: string[] }] */
    selectedUnlockSlots: [],
    selectedUnlockSlotsMap: {},
    rippleSlot: null, // 当前显示波纹动画的时间段 {courtId, slotIndex}
    totalPrice: 0, // 总价
    selectedVenueName: '', // 当前选定的球场名称
    selectedVenueId: '', // 当前选定的球场 id
    priceLoading: false, // 加载价格规则状态
    showPurposeSheet: false,
    /** experience | regular | group | open_play（畅打仅管理员可选） */
    lessonType: 'experience',
    /** 管理员：与 bookingCoachSlots 中「可管理全部占用」一致 */
    purposeOnlyOpenPlay: false,
    isManagerUser: false,
    /** 管理员可见「畅打」类型 */
    showOpenPlayChip: false,
    /** 教练或管理员：展示体验/正课/团课 */
    purposeShowStandardTypes: false,
    /** 管理员指定教练：db_user.isCoach */
    coachPickerList: [],
    coachPickerLabels: [],
    coachPickerIndex: 0,
    selectedCoachPhone: '',
    /** 体验课/正课：1v1 | 1v2 */
    pairMode: '1v1',
    /** 团课：固定 group35（3-5人） */
    groupMode: 'group35',
    /** purpose 弹层：create 新占场 | edit 改本人占用 */
    purposeSheetMode: 'create',
    editingHoldIds: [],
    /** 1v1/1v2 等规模选项（内置默认） */
    purposePairScales: [],
    purposeGroupScales: [],
    lottieLoadingVisible: false,
    /** 团课/畅打：人数与退课、成团检查 */
    minParticipants: 3,
    maxParticipants: 12,
    refundHoursBeforeStart: 6,
    /** 会员应付场次价（元）；与占用 1 格或多格无关；场馆 categoryList 有配置时自动填入；必填 */
    purposeMemberPriceYuan: '',
    purposeMemberPricePlaceholder: '必填，元/次',
  },

  // 动画定时器
  rippleTimer: null,
  slotRippleTimer: null,
  /** 已支付订单 + 教练占用 的格子键 Set */
  bookedSlotKeySet: null,
  /** 每次发起 getBookedSlots 自增，用于丢弃过期响应 */
  _bookedSlotsFetchToken: 0,
  /** loading 并发计数 */
  _loadingTaskCount: 0,

  async refreshManagerAndCoachCatalog() {
    this.beginLoading('加载中');
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
    const isManagerUser = !!isManager;
    const purposeShowStandardTypes = !!(isCoach || isManager);
    const showOpenPlayChip = isManagerUser;

    this.setData({
      isManagerUser,
      purposeOnlyOpenPlay: isManagerUser,
      showOpenPlayChip,
      purposeShowStandardTypes,
    });

    if (!purposeShowStandardTypes && !showOpenPlayChip) {
      this.endLoading();
      return;
    }

    let lt = this.data.lessonType || 'experience';
    if (!isManagerUser && lt === 'open_play') {
      lt = 'experience';
    }
    let patch;
    if (lt === 'open_play') {
      patch = this.applyPurposeScalesForLessonType('open_play', '', this.data.groupMode || 'group35');
    } else if (lt === 'group') {
      patch = this.applyPurposeScalesForLessonType('group', '', this.data.groupMode || 'group35');
    } else {
      patch = this.applyPurposeScalesForLessonType(
        lt,
        this.data.pairMode || '1v1',
        'group35'
      );
    }
    this.setData({ lessonType: lt, ...patch });
    this.endLoading();
  },

  async ensureCoachPickerLoaded() {
    if (!this.data.isManagerUser || this.data.coachPickerList.length > 0) return;
    try {
      const db = wx.cloud.database();
      const res = await db.collection('db_user').where({ isCoach: true }).get();
      const rows = (res && res.data) || [];
      const coachPickerList = rows
        .filter((u) => u && u.phone && /^1\d{10}$/.test(String(u.phone).trim()))
        .map((u) => ({
          phone: String(u.phone).trim(),
          name: u.name != null && String(u.name).trim() !== '' ? String(u.name).trim() : '教练',
        }));
      const coachPickerLabels = coachPickerList.map((c) => `${c.name} · ${c.phone}`);
      const coachPickerIndex = 0;
      const selectedCoachPhone = coachPickerList[0] ? coachPickerList[0].phone : '';
      this.setData({
        coachPickerList,
        coachPickerLabels,
        coachPickerIndex,
        selectedCoachPhone,
      });
    } catch (e) {
      console.warn('ensureCoachPickerLoaded', e);
      wx.showToast({ title: '教练列表加载失败，请检查数据库权限', icon: 'none' });
    }
  },

  onCoachPickerChange(e) {
    const idx = Number(e.detail.value);
    const item = this.data.coachPickerList[idx];
    this.setData({
      coachPickerIndex: Number.isFinite(idx) ? idx : 0,
      selectedCoachPhone: item ? item.phone : '',
    });
  },

  async onCoachPickEmptyTap() {
    await this.ensureCoachPickerLoaded();
    if (this.data.coachPickerLabels.length === 0) {
      wx.showToast({
        title: '仍无教练，请在管理后台先添加教练',
        icon: 'none',
      });
    }
  },

  applyPurposeScalesForLessonType(lessonType, pairModeIn, groupModeIn) {
    const lt = String(lessonType || '').trim();
    const gmIn =
      lt === 'open_play'
        ? 'group36'
        : lt === 'group'
          ? 'group35'
          : groupModeIn;
    const app = getApp();
    const venue = app && app.globalData && app.globalData.selectedVenue;
    const out = coachPurpose.applyPurposeScalesForLessonType(lt, pairModeIn, gmIn, venue);
    if (lt === 'group') {
      return { ...out, purposeGroupScales: [], groupMode: 'group35' };
    }
    if (lt === 'open_play') {
      return { ...out, purposeGroupScales: [], groupMode: 'group36' };
    }
    return out;
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
    this.refreshManagerAndCoachCatalog();
    const newVenueId = this.syncSelectedVenueName();
    this.generateDateList();
    this.loadSlotPricesAndRender(newVenueId);
  },

  onShow() {
    this.refreshManagerAndCoachCatalog();
    const newVenueId = this.syncSelectedVenueName();
    const venueIdToReload =
      newVenueId != null && String(newVenueId).trim() !== ''
        ? newVenueId
        : this.data.selectedVenueId;
    if (venueIdToReload) {
      this.loadSlotPricesAndRender(venueIdToReload);
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
      selectedUnlockSlots: [],
      selectedUnlockSlotsMap: {},
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
      selectedUnlockSlots: [],
      selectedUnlockSlotsMap: {},
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

  onUnload() {
    this._loadingTaskCount = 0;
    this.setData({ lottieLoadingVisible: false });
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
    this.beginLoading('加载中');
    refreshSelectedVenueFromCloud()
      .then(() => {
        this.syncSelectedVenueName();
        this.loadSlotPricesAndRenderCore(venueIdOverride);
      })
      .catch(() => {
        this.loadSlotPricesAndRenderCore(venueIdOverride);
      });
  },

  loadSlotPricesAndRenderCore(venueIdOverride) {
    const venueId =
      venueIdOverride !== undefined ? venueIdOverride : this.data.selectedVenueId;

    this.slotPriceMap = {};

    const selectedDate = this.data.selectedDate || getTodayDateStr();

    const resetAndFetch = () => {
      this.fetchBookedSlotsForDate(selectedDate).then((applied) => {
        if (applied === null) return;
        if (!applied) {
          this.bookedSlotKeySet = new Set();
          this.coachHoldMeta = {};
          this.myCoachHoldIdSet = new Set();
        }
        this.generateTimeSchedule();
      }).finally(() => {
        this.endLoading();
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
      this.slotPriceMap = buildSlotPriceMapFromCourtList(courtList, { useVipPrices: false });
      this.setData({ priceLoading: false });
      resetAndFetch();
      return;
    }

    this.slotPriceMap = {};
    wx.showToast({ title: '场馆未配置场地价格', icon: 'none' });
    this.setData({ priceLoading: false });
    resetAndFetch();
  },

  beginLoading(title) {
    this._loadingTaskCount = (this._loadingTaskCount || 0) + 1;
    if (this._loadingTaskCount === 1) {
      this.setData({ lottieLoadingVisible: true });
    }
  },

  endLoading() {
    this._loadingTaskCount = Math.max(0, (this._loadingTaskCount || 0) - 1);
    if (this._loadingTaskCount === 0) {
      this.setData({ lottieLoadingVisible: false });
    }
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
          return null;
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
      isVipUser: false,
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
    const tapDs = e.currentTarget.dataset || {};
    const ds = tapDs;
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
    const isMgr = this.data.isManagerUser;
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
      success: async (res) => {
        if (res.tapIndex === 0) {
          const pm = ds.pairmode || '1v1';
          const gm = ds.groupmode || 'group35';
          let lt = ds.lessontype || 'experience';
          if (!this.data.isManagerUser && lt === 'open_play') {
            lt = 'experience';
          }
          const scalePatch = this.applyPurposeScalesForLessonType(lt, pm, gm);
          const courtId = parseInt(ds.courtid, 10);
          const slotIndex = parseInt(ds.slotindex, 10);
          const metaKey =
            Number.isFinite(courtId) && Number.isFinite(slotIndex)
              ? `${courtId}-${slotIndex}`
              : '';
          const m = metaKey ? this.coachHoldMeta[metaKey] : null;
          const minP =
            tapDs.minparticipants != null && String(tapDs.minparticipants).trim() !== ''
              ? Math.floor(Number(tapDs.minparticipants))
              : NaN;
          const maxP =
            tapDs.maxparticipants != null && String(tapDs.maxparticipants).trim() !== ''
              ? Math.floor(Number(tapDs.maxparticipants))
              : NaN;
          const rh =
            tapDs.refundhours != null && String(tapDs.refundhours).trim() !== ''
              ? Math.floor(Number(tapDs.refundhours))
              : NaN;
          const rhMeta =
            m && m.refundHoursBeforeStart != null
              ? Math.floor(Number(m.refundHoursBeforeStart))
              : NaN;
          let enrollPatch = {};
          if (lt === 'group' || lt === 'open_play') {
            enrollPatch = {
              minParticipants: Number.isFinite(minP) && minP >= 1 ? minP : 3,
              maxParticipants: Number.isFinite(maxP) && maxP >= 1 ? maxP : 12,
              refundHoursBeforeStart: Number.isFinite(rh) && rh >= 0 ? rh : 6,
            };
          } else if (lt === 'experience' || lt === 'regular') {
            const rhEff =
              Number.isFinite(rh) && rh >= 0
                ? rh
                : Number.isFinite(rhMeta) && rhMeta >= 0
                  ? rhMeta
                  : 6;
            enrollPatch = { refundHoursBeforeStart: rhEff };
          }
          if (this.data.isManagerUser) {
            await this.ensureCoachPickerLoaded();
          }
          let existingPrice = '';
          const mpEx =
            m && m.memberPricePerSessionYuan != null
              ? m.memberPricePerSessionYuan
              : m && m.memberPricePerSlotYuan != null
                ? m.memberPricePerSlotYuan
                : null;
          if (mpEx != null) {
            const v = Number(mpEx);
            if (Number.isFinite(v) && v > 0) existingPrice = String(v);
          }
          this.setData(
            {
              showPurposeSheet: true,
              purposeSheetMode: 'edit',
              editingHoldIds: myIds,
              lessonType: lt,
              ...scalePatch,
              ...enrollPatch,
              purposeMemberPriceYuan: existingPrice,
              purposeMemberPricePlaceholder: '必填，元/次',
            },
            () => {
              if (!existingPrice) this.applyPurposeMemberPriceDefault();
            }
          );
        } else if (res.tapIndex === 1) {
          this.confirmCancelCoachHolds(myIds.join(','));
        }
      },
    });
  },

  async handleLockVenueSlots() {
    if (!this.data.isManagerUser) return;
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
    const selectedSlots = this.data.selectedSlots || [];
    if (selectedSlots.length === 0) {
      wx.showToast({ title: '请选择时间段', icon: 'none' });
      return;
    }
    const app = getApp();
    const venue = app && app.globalData && app.globalData.selectedVenue;
    const venueName = venue && venue.name ? String(venue.name).trim() : '';
    wx.showModal({
      title: '锁场',
      content: `确定锁定已选 ${selectedSlots.length} 个时段？会员将无法预订，界面显示为已占用。`,
      confirmText: '锁定',
      confirmColor: '#134E35',
      success: async (res) => {
        if (!res.confirm) return;
        this.beginLoading('锁定中...');
        try {
          const cloudRes = await adminVenueSlotLock({
            venueId: this.data.selectedVenueId,
            orderDate: this.data.selectedDate,
            venueName,
            slots: selectedSlots,
          });
          const r = (cloudRes && cloudRes.result) || {};
          this.endLoading();
          if (!r.ok) {
            wx.showToast({ title: r.errMsg || '锁定失败', icon: 'none' });
            return;
          }
          wx.showToast({ title: '已锁定', icon: 'success' });
          this.setData({
            selectedSlots: [],
            selectedSlotsMap: {},
            selectedUnlockSlots: [],
            selectedUnlockSlotsMap: {},
            totalPrice: 0,
            rippleSlot: null,
          });
          this.loadSlotPricesAndRender();
        } catch (e) {
          this.endLoading();
          console.error('handleLockVenueSlots', e);
          wx.showToast({ title: '网络异常', icon: 'none' });
        }
      },
    });
  },

  handleVenueLockSlotClick(e) {
    if (!this.data.isManagerUser) return;
    const { courtid, slotindex, holdids } = e.currentTarget.dataset;
    if (!courtid || slotindex === undefined) return;
    const raw = holdids != null ? String(holdids) : '';
    const holdIds = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (holdIds.length === 0) {
      wx.showToast({ title: '无法识别占用', icon: 'none' });
      return;
    }
    const courtId = parseInt(courtid, 10);
    const slotIndex = parseInt(slotindex, 10);
    if (!Number.isFinite(courtId) || !Number.isFinite(slotIndex)) return;

    const court = this.data.courts.find((c) => c.id === courtId);
    const slot = court && court.slots[slotIndex];
    if (!slot || !slot.venueLock || slot.past) return;

    if (this.slotRippleTimer) {
      clearTimeout(this.slotRippleTimer);
      this.slotRippleTimer = null;
    }

    const slotKey = `${courtId}-${slotIndex}`;
    const isSelected = this.data.selectedUnlockSlots.some(
      (s) => s.courtId === courtId && s.slotIndex === slotIndex
    );

    let newUnlock = [...this.data.selectedUnlockSlots];
    let newUnlockMap = { ...this.data.selectedUnlockSlotsMap };

    const resetBook =
      this.data.selectedSlots.length > 0
        ? { selectedSlots: [], selectedSlotsMap: {}, totalPrice: 0 }
        : {};

    if (isSelected) {
      newUnlock = newUnlock.filter((s) => !(s.courtId === courtId && s.slotIndex === slotIndex));
      delete newUnlockMap[slotKey];
    } else {
      newUnlock.push({ courtId, slotIndex, holdIds });
      newUnlockMap[slotKey] = true;
    }

    const patch = {
      selectedUnlockSlots: newUnlock,
      selectedUnlockSlotsMap: newUnlockMap,
      rippleSlot: null,
      ...resetBook,
    };

    this.setData(patch, () => {
      const playRipple = () => {
        this.setData({
          rippleSlot: { courtId, slotIndex },
        });
        this.slotRippleTimer = setTimeout(() => {
          this.setData({ rippleSlot: null });
          this.slotRippleTimer = null;
        }, 600);
      };
      if (typeof requestAnimationFrame !== 'undefined') {
        requestAnimationFrame(playRipple);
      } else {
        setTimeout(playRipple, 16);
      }
    });
  },

  handleUnlockVenueSlots() {
    if (!this.data.isManagerUser) return;
    const list = this.data.selectedUnlockSlots || [];
    if (list.length === 0) {
      wx.showToast({ title: '请选择要解锁的时段', icon: 'none' });
      return;
    }
    const idSet = new Set();
    list.forEach((row) => {
      (row.holdIds || []).forEach((id) => {
        const h = String(id || '').trim();
        if (h) idSet.add(h);
      });
    });
    const holdIdsFlat = [...idSet];
    if (holdIdsFlat.length === 0) {
      wx.showToast({ title: '无法识别占用', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '解锁场地',
      content: `确定解除已选 ${list.length} 个时段的锁定？`,
      confirmText: '解锁',
      confirmColor: '#134E35',
      success: async (res) => {
        if (!res.confirm) return;
        this.beginLoading('处理中...');
        try {
          const cloudRes = await cancelCoachHold({ holdIds: holdIdsFlat });
          const r = (cloudRes && cloudRes.result) || {};
          this.endLoading();
          if (!r.ok) {
            wx.showToast({ title: r.errMsg || '解锁失败', icon: 'none' });
            return;
          }
          wx.showToast({ title: '已解锁', icon: 'success' });
          this.setData({
            selectedUnlockSlots: [],
            selectedUnlockSlotsMap: {},
            rippleSlot: null,
          });
          this.loadSlotPricesAndRender();
        } catch (err) {
          this.endLoading();
          console.error('handleUnlockVenueSlots', err);
          wx.showToast({ title: '网络异常', icon: 'none' });
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
    const isMgr = this.data.isManagerUser;
    const ids = isMgr ? raw : raw.filter((id) => mySet.has(id));
    if (ids.length === 0) {
      wx.showToast({ title: '无可用占用记录', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '取消预订',
      content:
        '确定取消该时段？连续占用将一并取消。若已有学员报名，相关订单将作废；已扣课时将自动退回；微信支付部分将原路退回。若退款失败会中止取消并提示原因。',
      confirmText: '取消占用',
      confirmColor: '#c62828',
      success: async (res) => {
        if (!res.confirm) return;
        this.beginLoading('处理中...');
        try {
          const cloudRes = await cancelCoachHold({ holdIds: ids });
          const r = (cloudRes && cloudRes.result) || {};
          this.endLoading();
          if (!r.ok) {
            wx.showToast({ title: r.errMsg || '取消失败', icon: 'none' });
            return;
          }
          wx.showToast({ title: '已取消', icon: 'success' });
          this.loadSlotPricesAndRender();
        } catch (err) {
          this.endLoading();
          console.error('confirmCancelCoachHolds', err);
          wx.showToast({ title: '网络异常', icon: 'none' });
        }
      },
    });
  },

  confirmPurposeSheet() {
    const { lessonType, purposeSheetMode } = this.data;
    if (lessonType === 'group') {
      let check;
      if (purposeSheetMode === 'edit') {
        const pairs = collectSlotPairsForCoachHoldIds(
          this.coachHoldMeta,
          this.data.editingHoldIds
        );
        const hasIds = (this.data.editingHoldIds || []).length > 0;
        if (hasIds && pairs.length === 0) {
          check = { ok: false, errMsg: '无法识别占用时段，请刷新后重试' };
        } else {
          check = validateGroupLessonSlots(pairs);
        }
      } else {
        check = validateGroupLessonSlots(this.data.selectedSlots);
      }
      if (!check.ok) {
        wx.showToast({ title: check.errMsg || '团课时段不符合要求', icon: 'none' });
        return;
      }
    }
    if (lessonType === 'group' || lessonType === 'open_play') {
      const mn = Math.floor(Number(this.data.minParticipants));
      const mx = Math.floor(Number(this.data.maxParticipants));
      const rh = Math.floor(Number(this.data.refundHoursBeforeStart));
      if (!Number.isFinite(mn) || mn < 1) {
        wx.showToast({ title: '请填写最少参加人数', icon: 'none' });
        return;
      }
      if (!Number.isFinite(mx) || mx < mn) {
        wx.showToast({ title: '最多人数须不少于最少人数', icon: 'none' });
        return;
      }
      if (!Number.isFinite(rh) || rh < 0) {
        wx.showToast({ title: '请填写开课前时间（小时）', icon: 'none' });
        return;
      }
    }
    if (lessonType === 'experience' || lessonType === 'regular') {
      const rh = Math.floor(Number(this.data.refundHoursBeforeStart));
      if (!Number.isFinite(rh) || rh < 0) {
        wx.showToast({ title: '请填写开课前可退课时间（小时）', icon: 'none' });
        return;
      }
    }
    const rawPurposePrice = String(this.data.purposeMemberPriceYuan || '').trim();
    if (rawPurposePrice === '') {
      wx.showToast({ title: '请填写会员支付单价', icon: 'none' });
      return;
    }
    const pn = Number(rawPurposePrice);
    if (!Number.isFinite(pn) || pn <= 0) {
      wx.showToast({ title: '会员支付单价须为正数', icon: 'none' });
      return;
    }
    if (purposeSheetMode === 'edit') {
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
    const mpU = this.parseMemberPriceForUpdate();
    if (mpU === 'empty') {
      wx.showToast({ title: '请填写会员支付单价', icon: 'none' });
      return;
    }
    if (Number.isNaN(mpU)) {
      wx.showToast({ title: '会员支付单价须为正数', icon: 'none' });
      return;
    }
    this.beginLoading('保存中...');
    try {
      const capacityLimit =
        lessonType === 'group' || lessonType === 'open_play'
          ? Math.floor(Number(this.data.maxParticipants))
          : this.resolveSelectedCapacityLimit(lessonType, pairMode, groupMode);
      const cloudRes = await updateCoachHolds(
        buildUpdateCoachHoldsPayload({
          holdIds: ids,
          lessonType,
          pairMode,
          groupMode,
          scaleDisplayName,
          capacityLimit,
          minParticipants: this.data.minParticipants,
          maxParticipants: this.data.maxParticipants,
          refundHoursBeforeStart: this.data.refundHoursBeforeStart,
          memberPricePerSlotYuan: mpU,
        })
      );
      const r = (cloudRes && cloudRes.result) || {};
      this.endLoading();
      if (!r.ok) {
        wx.showToast({ title: r.errMsg || '保存失败', icon: 'none' });
        return;
      }
      wx.showToast({ title: '已更新', icon: 'success' });
      this.setData({
        showPurposeSheet: false,
        purposeSheetMode: 'create',
        editingHoldIds: [],
        purposeMemberPriceYuan: '',
        purposeMemberPricePlaceholder: '必填，元/次',
      });
      this.loadSlotPricesAndRender();
    } catch (e) {
      this.endLoading();
      console.error('submitCoachHoldEdit', e);
      wx.showToast({ title: '网络异常', icon: 'none' });
    }
  },

  updateSlotsAvailability(selectedDate) {
    this.beginLoading('加载中');
    this.setData({
      selectedDate,
      selectedSlots: [],
      selectedSlotsMap: {},
      selectedUnlockSlots: [],
      selectedUnlockSlotsMap: {},
      totalPrice: 0,
    });
    this.fetchBookedSlotsForDate(selectedDate).then((applied) => {
      if (applied === null) return;
      if (!applied) {
        this.bookedSlotKeySet = new Set();
        this.coachHoldMeta = {};
        this.myCoachHoldIdSet = new Set();
      }
      this.generateTimeSchedule(selectedDate);
    }).finally(() => {
      this.endLoading();
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

    const resetUnlock =
      (this.data.selectedUnlockSlots || []).length > 0
        ? { selectedUnlockSlots: [], selectedUnlockSlotsMap: {} }
        : {};

    this.setData(
      {
        selectedSlots: newSelectedSlots,
        selectedSlotsMap: newSelectedSlotsMap,
        totalPrice,
        rippleSlot: null,
        ...resetUnlock,
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

  async handleNextToPurpose() {
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
    if (!this.data.isManagerUser && !this.data.purposeShowStandardTypes) {
      wx.showToast({ title: '无权限占用场地', icon: 'none' });
      return;
    }
    if (this.data.isManagerUser) {
      await this.ensureCoachPickerLoaded();
    }
    const lt = this.data.lessonType || 'experience';
    let scalePatch;
    if (lt === 'open_play') {
      scalePatch = this.applyPurposeScalesForLessonType(
        'open_play',
        '',
        this.data.groupMode || 'group35'
      );
    } else if (lt === 'group') {
      scalePatch = this.applyPurposeScalesForLessonType(
        'group',
        '',
        this.data.groupMode || 'group35'
      );
    } else {
      scalePatch = this.applyPurposeScalesForLessonType(
        lt,
        this.data.pairMode || '1v1',
        'group35'
      );
    }
    const patch = {
      showPurposeSheet: true,
      purposeSheetMode: 'create',
      editingHoldIds: [],
      lessonType: lt,
      ...scalePatch,
    };
    if (lt === 'group' || lt === 'open_play') {
      patch.minParticipants = 3;
      patch.maxParticipants = 12;
      patch.refundHoursBeforeStart = 6;
    } else if (lt === 'experience' || lt === 'regular') {
      patch.refundHoursBeforeStart = 6;
    }
    this.setData(patch, () => this.applyPurposeMemberPriceDefault());
  },

  closePurposeSheet() {
    this.setData({
      showPurposeSheet: false,
      purposeSheetMode: 'create',
      editingHoldIds: [],
      purposeMemberPriceYuan: '',
      purposeMemberPricePlaceholder: '必填，元/次',
    });
  },

  selectLessonType(e) {
    const { v } = e.currentTarget.dataset;
    if (!v) return;
    if (v === 'open_play') {
      if (!this.data.showOpenPlayChip) return;
      const scalePatch = this.applyPurposeScalesForLessonType(
        'open_play',
        '',
        this.data.groupMode || 'group35'
      );
      this.setData(
        {
          lessonType: 'open_play',
          ...scalePatch,
          minParticipants: 3,
          maxParticipants: 12,
          refundHoursBeforeStart: 6,
        },
        () => this.applyPurposeMemberPriceDefault()
      );
      return;
    }
    if (!this.data.purposeShowStandardTypes) return;
    const scalePatch = this.applyPurposeScalesForLessonType(v, '', '');
    const patch = {
      lessonType: v,
      ...scalePatch,
    };
    if (v === 'group') {
      patch.minParticipants = 3;
      patch.maxParticipants = 12;
      patch.refundHoursBeforeStart = 6;
    } else if (v === 'experience' || v === 'regular') {
      patch.refundHoursBeforeStart = 6;
    }
    this.setData(patch, () => this.applyPurposeMemberPriceDefault());
  },

  onMinParticipantsInput(e) {
    this.setData({ minParticipants: e.detail.value });
  },
  onMaxParticipantsInput(e) {
    this.setData({ maxParticipants: e.detail.value });
  },
  onRefundHoursInput(e) {
    this.setData({ refundHoursBeforeStart: e.detail.value });
  },

  onPurposeMemberPriceInput(e) {
    this.setData({ purposeMemberPriceYuan: e.detail.value });
  },

  applyPurposeMemberPriceDefault() {
    const app = getApp();
    const venue = app && app.globalData && app.globalData.selectedVenue;
    const { lessonType, pairMode } = this.data;
    const n = defaultMemberPriceYuanFromVenue(venue, lessonType, pairMode);
    const str = n != null && Number.isFinite(n) ? String(n) : '';
    this.setData({
      purposeMemberPriceYuan: str,
      purposeMemberPricePlaceholder:
        n != null && Number.isFinite(n)
          ? `场馆默认 ${n} 元/次，可改`
          : '必填，元/次',
    });
  },

  parseMemberPriceForCreate() {
    const raw = String(this.data.purposeMemberPriceYuan || '').trim();
    if (raw === '') return 'empty';
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return 'invalid';
    return Math.round(n * 100) / 100;
  },

  parseMemberPriceForUpdate() {
    const raw = String(this.data.purposeMemberPriceYuan || '').trim();
    if (raw === '') return 'empty';
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return NaN;
    return Math.round(n * 100) / 100;
  },

  selectPurposeScale(e) {
    const { kind, code } = e.currentTarget.dataset;
    if (!code || kind !== 'pair') return;
    this.setData({ pairMode: code }, () => this.applyPurposeMemberPriceDefault());
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

    const app = getApp();
    const venue = app && app.globalData && app.globalData.selectedVenue;
    const venueName = venue && venue.name ? String(venue.name).trim() : '';

    const scaleDisplayName = this.resolveSelectedScaleDisplayName(
      lessonType,
      pairMode,
      groupMode
    );
    const mpCreate = this.parseMemberPriceForCreate();
    if (mpCreate === 'empty') {
      wx.showToast({ title: '请填写会员支付单价', icon: 'none' });
      return;
    }
    if (mpCreate === 'invalid') {
      wx.showToast({ title: '会员支付单价须为正数', icon: 'none' });
      return;
    }
    this.beginLoading('提交中...');
    try {
      const capacityLimit =
        lessonType === 'group' || lessonType === 'open_play'
          ? Math.floor(Number(this.data.maxParticipants))
          : this.resolveSelectedCapacityLimit(lessonType, pairMode, groupMode);
      const payload = buildCoachHoldSlotsPayload({
        selectedVenueId,
        venueName,
        selectedDate,
        selectedSlots,
        lessonType,
        pairMode,
        groupMode,
        scaleDisplayName,
        capacityLimit,
        minParticipants: this.data.minParticipants,
        maxParticipants: this.data.maxParticipants,
        refundHoursBeforeStart: this.data.refundHoursBeforeStart,
        memberPricePerSlotYuan: mpCreate,
      });
      let coachPhoneArg = '';
      if (this.data.isManagerUser) {
        coachPhoneArg =
          lessonType === 'open_play' ? '' : String(this.data.selectedCoachPhone || '').trim();
      }
      const cloudRes = this.data.isManagerUser
        ? await adminCoachHoldForCoach({
            ...payload,
            coachPhone: coachPhoneArg,
          })
        : await coachHoldSlots(payload);
      const r = (cloudRes && cloudRes.result) || {};
      this.endLoading();
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
        purposeMemberPriceYuan: '',
        purposeMemberPricePlaceholder: '必填，元/次',
        selectedSlots: [],
        selectedSlotsMap: {},
        selectedUnlockSlots: [],
        selectedUnlockSlotsMap: {},
        totalPrice: 0,
        rippleSlot: null,
      });
      if (!this.bookedSlotKeySet) this.bookedSlotKeySet = new Set();
      heldKeys.forEach((k) => this.bookedSlotKeySet.add(k));
      this.generateTimeSchedule(selectedDate);
      this.fetchBookedSlotsForDate(selectedDate).then((applied) => {
        if (applied === null) return;
        if (!applied) return;
        heldKeys.forEach((k) => this.bookedSlotKeySet.add(k));
        this.generateTimeSchedule(selectedDate);
      });
    } catch (e) {
      this.endLoading();
      console.error('submitCoachHold', e);
      wx.showToast({ title: '网络异常', icon: 'none' });
    }
  },
});
