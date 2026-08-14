const { STORAGE_KEYS } = require('./pay/constants');
const {
  isCoachWechatOnlyLessonKey,
  buildCourtOrderSlotPrices,
} = require('./pay/helpers');
const courtPayBehavior = require('./pay/courtPay');
const coachPayBehavior = require('./pay/coachPay');
const submitPayBehavior = require('./pay/submitPay');

const {
  decryptPhoneNumber,
  DEFAULT_USER_AVATAR,
  getBookedSlots,
  refreshSelectedVenueFromCloud,
} = require('../../api/tennisDb');
const { buildLessonKey, formatLessonKeyDisplay } = require('../../utils/lessonKey');
const { lessonKeyFromTypeMapFormat, splitCourseDescriptionLines } = require('../../utils/courseCatalog');
const { buildFlatCourtSlots } = require('../../utils/bookingVoucherMatch');
const { preventTouchMove } = require('../../utils/preventTouchMove');
const {
  attachPageMemberAssetRealtime,
  detachPageMemberAssetRealtime,
} = require('../../utils/memberAssetRealtime');
const { sessionMemberPriceFromMeta } = require('../../utils/coachSessionVenuePrice');

function enrichGoodItemDisplay(g) {
  if (!g) return null;
  const sub = g.subtitle != null ? String(g.subtitle).trim() : '';
  const { note, tail } = splitCourseDescriptionLines(sub);
  return {
    ...g,
    noteLine: note,
    tailLine: tail,
  };
}

function sortTypeMapFormatKeys(keys) {
  return [...keys].sort((a, b) => String(a).localeCompare(String(b), 'zh-CN'));
}

function sortTypeMapSessionKeys(inner) {
  if (!inner || typeof inner !== 'object') return [];
  return Object.keys(inner).sort((a, b) => {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb) && String(na) === String(a).trim() && String(nb) === String(b).trim()) {
      return na - nb;
    }
    return String(a).localeCompare(String(b), 'zh-CN');
  });
}

function parseTypeMapPrice(raw) {
  const n = Number(String(raw != null ? raw : '').replace(/,/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function grantHoursFromSessionKey(sessionKey) {
  const k = String(sessionKey || '').trim();
  const n = Number(k);
  if (Number.isFinite(n) && n > 0) return Math.min(999, Math.floor(n));
  const m = k.match(/(\d+)/);
  if (m) {
    const v = Math.floor(Number(m[1]));
    if (v > 0) return Math.min(999, v);
  }
  return 0;
}

Page({
  behaviors: [courtPayBehavior, coachPayBehavior, submitPayBehavior],

  preventTouchMove,
  data: {
    showPhoneAuthModal: false, // 需手机号注册/授权时展示
    orderType: 'court', // 订单类型：court 场地订单 | goods 商品订单
    orderDate: '', // 预订日期
    formattedDate: '', // 格式化后的日期
    campusName: '', // 球馆名称，来自当前选定的球场
    venueId: '', // 用于云端计算价格/订单（booking 传参）
    orderNumber: '', // 订单编号
    orderItems: [], // 场地订单项 [{courtId, courtName, timeSlots: [{timeRange, price, hours}], totalPrice}]
    bookedSlots: [], // 与预订页 selectedSlots 一致，写入 db_booking 用于占用时段
    goodItem: null, // 商品订单项 {id, image, desc, price}
    totalPrice: 0, // 总价
    contentScrollHeight: 400, // scroll-view 可滚动区域高度，动态计算
    footerButtonText: '确认付款', // 底部按钮文案：未登录时为「去登录」
    /** 教练占用时段订单：课时 / 微信支付 */
    isCoachCourseOrder: false,
    coachHoldIds: [],
    coachCapacityLabel: '',
    /** 占用教练的展示名（db_user.name，经 getBookedSlots / 订场页传入） */
    coachName: '',
    lessonKey: '',
    /** 如「体验课 1V1」，用于订单页展示与课时匹配说明 */
    lessonKeyDisplay: '',
    requiredCourseHours: 0,
    courseHoursBalance: 0,
    /** 是否已从云端拿到本单 lessonKey 在本场馆的课时余额（未登录等为 false） */
    coachCourseBalanceReady: false,
    /** 未就绪时的说明文案 */
    coachCourseBalanceHint: '',
    /** 教练课节报名情况（getBookedSlots） */
    coachSessionRosterReady: false,
    coachSessionJoined: 0,
    coachSessionLimit: 1,
    coachSessionFull: false,
    coachViewerAlreadyJoined: false,
    coachSessionParticipantNamesStr: '',
    payMethod: 'wechat', // course_hours | wechat | mixed
    /** 按场地、时段排序后的每格标价（元），与 bookedSlots 一一对应，用于组合支付拆分 */
    coachSlotPrices: [],
    /** 组合支付：本次微信支付前拟扣课时数（与 pay 云函数 coachCourseHoursDeduct 一致） */
    coachHoursDeductForPay: 0,
    /** 组合支付或纯微信时的微信应付金额（元） */
    comboCashYuan: 0,
    /** 有余额但不足整单时：组合支付的预览（与当前 payMethod 无关） */
    coachMixedPreviewDeduct: 0,
    coachMixedPreviewCash: 0,
    /** 用户是否手动切换过教练单支付方式（余额刷新时尽量保留「仅微信」等选择） */
    coachPayUserChose: false,
    /** 团课 / 畅打：仅微信支付 */
    coachPayWechatOnly: false,
    lottieLoadingVisible: false,
    /** 课时包：db_course.typeMap 多规格 */
    goodsHasTypeMap: false,
    goodsFormatKeys: [],
    goodsSessionKeys: [],
    selectedGoodsFormat: '',
    selectedGoodsSession: '',
    /** 普通订场：每格价格（用于团购券匹配） */
    courtSlotPrices: [],
    bookingVouchers: [],
    voucherDeductionYuan: 0,
    cashDueYuan: 0,
    /** 普通订场：本场馆储值余额 */
    venueStoredBalanceYuan: 0,
    venueStoredBalanceReady: false,
    venueStoredBalanceHint: '',
    /** 普通订场支付方式：wechat | stored_balance | mixed_balance */
    courtPayMethod: 'wechat',
    courtPayUserChose: false,
    storedBalanceDeductYuan: 0,
    wechatDueYuan: 0,
    /** 普通订场：订单价每格（VIP/会员价），月卡免费按此抵扣 */
    courtOrderSlotPrices: [],
    monthCardEligible: false,
    monthCardWindowLabel: '',
    monthCardFreeUsedToday: false,
    monthCardUseFree: false,
    monthCardFreeSlotKey: '',
    monthCardDeductYuan: 0,
    monthCardHint: '',
    /** 普通订场：次卡（1 次 = 1 小时） */
    sessionCardRemainingTimes: 0,
    sessionCardUse: true,
    sessionCardDeductTimes: 0,
    sessionCardSlotKeys: [],
    sessionCardDeductYuan: 0,
    sessionCardHint: '',
  },
  _loadingTaskCount: 0,
  _monthCardConfig: null,

  parseBookedSlotsCompact(raw) {
    const s = String(raw || '').trim();
    if (!s) return [];
    return s
      .split(',')
      .map((part) => {
        const bits = String(part || '').trim().split('-');
        if (bits.length < 2) return null;
        const courtId = Number(bits[0]);
        const slotIndex = Number(bits[1]);
        if (!Number.isFinite(courtId) || !Number.isFinite(slotIndex)) return null;
        return { courtId, slotIndex };
      })
      .filter(Boolean);
  },

  /**
   * 教练课报名入参：storage（优先）/ 短链 query / 旧版 coachPayload
   */
  parseCoachCourseLaunchOptions(options) {
    let fromStore = null;
    try {
      fromStore = wx.getStorageSync('coach_course_order_payload') || null;
      wx.removeStorageSync('coach_course_order_payload');
    } catch (e) {
      fromStore = null;
    }

    if (fromStore && typeof fromStore === 'object') {
      const bookedSlots = Array.isArray(fromStore.bookedSlots) ? fromStore.bookedSlots : [];
      if (bookedSlots.length > 0) {
        return {
          ok: true,
          holdIds: Array.isArray(fromStore.holdIds) ? fromStore.holdIds : [],
          bookedSlots,
          lessonType: fromStore.lessonType || 'experience',
          pairMode: fromStore.pairMode || '1v1',
          groupMode: fromStore.groupMode || '',
          lessonKeyRaw: fromStore.lessonKey,
          capacityLabel: fromStore.capacityLabel || '',
          coachNameRaw: fromStore.coachName || '',
          selectedDate: String(fromStore.orderDate || '').trim(),
          venueId: String(fromStore.venueId || '').trim(),
          courts: [],
        };
      }
    }

    const compactSlots = this.parseBookedSlotsCompact(
      options.slots != null ? decodeURIComponent(String(options.slots)) : '',
    );
    const compactVenue = options.v != null ? decodeURIComponent(String(options.v)) : '';
    const compactDate = options.d != null ? decodeURIComponent(String(options.d)) : '';
    if (compactSlots.length > 0 && compactVenue && compactDate) {
      return {
        ok: true,
        holdIds: [],
        bookedSlots: compactSlots,
        lessonType: options.lt != null ? decodeURIComponent(String(options.lt)) : 'experience',
        pairMode: options.pm != null ? decodeURIComponent(String(options.pm)) : '1v1',
        groupMode: options.gm != null ? decodeURIComponent(String(options.gm)) : '',
        lessonKeyRaw: options.lk != null ? decodeURIComponent(String(options.lk)) : '',
        capacityLabel: '',
        coachNameRaw: '',
        selectedDate: compactDate,
        venueId: String(compactVenue).trim(),
        courts: [],
      };
    }

    if (options.coachPayload) {
      try {
        const coachPayload = JSON.parse(decodeURIComponent(options.coachPayload || '{}'));
        const courts = JSON.parse(decodeURIComponent(options.courts || '[]'));
        const selectedDate = decodeURIComponent(options.selectedDate || '');
        const venueId = decodeURIComponent(options.venueId || '');
        const bookedSlots = Array.isArray(coachPayload.bookedSlots) ? coachPayload.bookedSlots : [];
        if (bookedSlots.length > 0 && venueId && selectedDate) {
          return {
            ok: true,
            holdIds: Array.isArray(coachPayload.holdIds) ? coachPayload.holdIds : [],
            bookedSlots,
            lessonType: coachPayload.lessonType || 'experience',
            pairMode: coachPayload.pairMode || '1v1',
            groupMode: coachPayload.groupMode || '',
            lessonKeyRaw: coachPayload.lessonKey,
            capacityLabel: coachPayload.capacityLabel || '',
            coachNameRaw: coachPayload.coachName || '',
            selectedDate,
            venueId: String(venueId).trim(),
            courts: Array.isArray(courts) ? courts : [],
          };
        }
      } catch (err) {
        console.error('parseCoachCourseLaunchOptions coachPayload', err);
      }
    }

    return { ok: false, errMsg: '课程参数无效' };
  },

  applyCoachCourseOrder(parsed) {
    const {
      holdIds,
      bookedSlots,
      lessonType,
      pairMode,
      groupMode,
      lessonKeyRaw,
      capacityLabel,
      coachNameRaw,
      selectedDate,
      venueId,
      courts,
    } = parsed;
    const orderItems = this.processCoachCourseOrderItems(bookedSlots, courts);
    let totalPrice = this.calculateTotalPrice(orderItems);
    const formattedDate = this.formatDate(selectedDate);
    const lessonKeyFromModes = buildLessonKey(lessonType, pairMode, groupMode);
    const lessonKey =
      lessonKeyRaw != null && String(lessonKeyRaw).trim() !== ''
        ? String(lessonKeyRaw).trim()
        : lessonKeyFromModes;
    const lessonKeyDisplay = formatLessonKeyDisplay(lessonKey);
    const coachPayWechatOnly = isCoachWechatOnlyLessonKey(lessonKey);
    const capacityLabelResolved =
      String(capacityLabel || '').trim() || lessonKeyDisplay || '教练课程';
    const requiredCourseHours = bookedSlots.length;
    const coachSlotPrices = this.computeCoachSlotPrices(bookedSlots, courts);
    if (!(totalPrice > 0) && coachSlotPrices.length > 0) {
      totalPrice = coachSlotPrices.reduce((a, b) => a + (Number(b) || 0), 0);
    }
    this.setData(
      {
        orderType: 'court',
        isCoachCourseOrder: true,
        coachHoldIds: (holdIds || []).map((id) => String(id)).filter(Boolean),
        coachCapacityLabel: capacityLabelResolved,
        coachName: String(coachNameRaw || '').trim(),
        lessonKey,
        lessonKeyDisplay,
        coachPayWechatOnly,
        requiredCourseHours,
        orderDate: selectedDate,
        formattedDate,
        orderNumber: this.generateOrderNumber(),
        orderItems,
        totalPrice,
        bookedSlots,
        venueId,
        payMethod: 'wechat',
        courseHoursBalance: 0,
        coachSlotPrices,
        coachPayUserChose: false,
        coachHoursDeductForPay: 0,
        comboCashYuan: totalPrice,
        coachCourseBalanceReady: coachPayWechatOnly,
        coachCourseBalanceHint: coachPayWechatOnly ? '' : '加载中...',
        coachSessionRosterReady: false,
        coachSessionJoined: 0,
        coachSessionLimit: 1,
        coachSessionFull: false,
        coachViewerAlreadyJoined: false,
        coachSessionParticipantNamesStr: '',
        courts: Array.isArray(courts) ? courts : [],
      },
      () => {
        this.ensureCoachOrderVenue(venueId);
        this.syncCampusName();
        this.loadCoachCourseHoursBalance();
        this.loadCoachSessionRoster();
        this.updateFooterButtonText();
      },
    );
  },

  onLoad(options) {
    this.syncCampusName();
    if (options.type === 'goods') {
      // 商品订单：从首页课程列表跳转
      try {
        const goodItem = JSON.parse(decodeURIComponent(options.goodData || '{}'));
        const tm = goodItem && goodItem.typeMap;
        if (
          goodItem &&
          tm &&
          typeof tm === 'object' &&
          !Array.isArray(tm) &&
          Object.keys(tm).length > 0
        ) {
          this.initGoodsTypeMapOrder(goodItem);
          return;
        }
        if (goodItem && goodItem.price != null) {
          this.setData({
            orderType: 'goods',
            goodItem: enrichGoodItemDisplay(goodItem),
            totalPrice: goodItem.price,
          });
          return;
        }
      } catch (e) {
        console.error('解析商品数据失败', e);
      }
    }

    // 教练课程报名（订场格 / 分享详情页）；绝不能落入下方普通订场分支
    if (String(options.orderSource || '').trim() === 'coachCourse') {
      const parsed = this.parseCoachCourseLaunchOptions(options);
      if (!parsed.ok) {
        console.error('解析教练课程订单失败', parsed.errMsg);
        wx.showToast({ title: parsed.errMsg || '课程参数无效', icon: 'none' });
        return;
      }
      this.applyCoachCourseOrder(parsed);
      return;
    }

    // 场地订单：从 booking 页面跳转
    const selectedSlots = JSON.parse(decodeURIComponent(options.selectedSlots || '[]'));
    const selectedDate = decodeURIComponent(options.selectedDate || '');
    const courts = JSON.parse(decodeURIComponent(options.courts || '[]'));
    const venueId = decodeURIComponent(options.venueId || '');
    
    const orderNumber = this.generateOrderNumber();
    const orderItems = this.processOrderItems(selectedSlots, courts);
    const totalPrice = this.calculateTotalPrice(orderItems);
    const formattedDate = this.formatDate(selectedDate);
    const bookedSlots = (selectedSlots || [])
      .map((s) => ({
        courtId: Number(s.courtId),
        slotIndex: Number(s.slotIndex),
      }))
      .filter((s) => Number.isFinite(s.courtId) && Number.isFinite(s.slotIndex));
    const courtSlotPrices = buildFlatCourtSlots(bookedSlots, courts, (idx) =>
      this.getTimeSlotTime(idx),
      {
        courtList:
          (() => {
            const app = getApp();
            const venue = app && app.globalData && app.globalData.selectedVenue;
            return venue && Array.isArray(venue.courtList) ? venue.courtList : [];
          })(),
        selectedDate,
      },
    );
    const courtOrderSlotPrices = buildCourtOrderSlotPrices(bookedSlots, courts);

    this.setData({
      orderDate: selectedDate,
      formattedDate: formattedDate,
      orderNumber: orderNumber,
      orderItems: orderItems,
      bookedSlots,
      totalPrice: totalPrice,
      venueId: venueId,
      courtSlotPrices,
      courtOrderSlotPrices,
      bookingVouchers: [],
      voucherDeductionYuan: 0,
      cashDueYuan: totalPrice,
      wechatDueYuan: totalPrice,
    });
    this.syncCampusName();
  },

  initGoodsTypeMapOrder(goodItem) {
    const formatKeys = sortTypeMapFormatKeys(Object.keys(goodItem.typeMap));
    const f0 = formatKeys[0];
    const inner = goodItem.typeMap[f0];
    const sessionKeys = sortTypeMapSessionKeys(inner);
    if (!f0 || !sessionKeys.length) {
      wx.showToast({ title: '课程价格配置不完整', icon: 'none' });
      this.setData({
        orderType: 'goods',
        goodItem: enrichGoodItemDisplay({ ...goodItem, grantHours: 0, lessonKey: '' }),
        totalPrice: Number(goodItem.price) || 0,
      });
      return;
    }
    const s0 = sessionKeys[0];
    const price = parseTypeMapPrice(inner[s0]);
    const grantHours = grantHoursFromSessionKey(s0);
    const lessonKey = lessonKeyFromTypeMapFormat(goodItem.lessonType, f0);
    const nextGood = enrichGoodItemDisplay({
      ...goodItem,
      price,
      grantHours,
      lessonKey,
    });
    this.setData({
      orderType: 'goods',
      goodItem: nextGood,
      totalPrice: price,
      goodsHasTypeMap: true,
      goodsFormatKeys: formatKeys,
      goodsSessionKeys: sessionKeys,
      selectedGoodsFormat: f0,
      selectedGoodsSession: s0,
    });
  },

  selectGoodsFormat(e) {
    const key = e.currentTarget.dataset.key;
    if (!key || key === this.data.selectedGoodsFormat) return;
    const g = this.data.goodItem;
    const tm = g && g.typeMap;
    if (!tm || !tm[key]) return;
    const sessionKeys = sortTypeMapSessionKeys(tm[key]);
    if (!sessionKeys.length) return;
    const s0 = sessionKeys[0];
    const price = parseTypeMapPrice(tm[key][s0]);
    const grantHours = grantHoursFromSessionKey(s0);
    const lessonKey = lessonKeyFromTypeMapFormat(g.lessonType, key);
    this.setData({
      selectedGoodsFormat: key,
      goodsSessionKeys: sessionKeys,
      selectedGoodsSession: s0,
      totalPrice: price,
      goodItem: {
        ...g,
        price,
        grantHours,
        lessonKey,
      },
    });
  },

  selectGoodsSession(e) {
    const session = e.currentTarget.dataset.session;
    if (session == null || String(session) === String(this.data.selectedGoodsSession)) return;
    const g = this.data.goodItem;
    const fmt = this.data.selectedGoodsFormat;
    const tm = g && g.typeMap;
    if (!tm || !tm[fmt]) return;
    const raw = tm[fmt][session];
    if (raw == null) return;
    const price = parseTypeMapPrice(raw);
    const grantHours = grantHoursFromSessionKey(session);
    const lessonKey = lessonKeyFromTypeMapFormat(g.lessonType, fmt);
    this.setData({
      selectedGoodsSession: session,
      totalPrice: price,
      goodItem: {
        ...g,
        price,
        grantHours,
        lessonKey,
      },
    });
  },

  syncCampusName() {
    const app = getApp();
    const venue = app && app.globalData && app.globalData.selectedVenue;
    const campusName = (venue && venue.name) ? venue.name : '昂湃网球学练馆';
    if (campusName !== this.data.campusName) {
      this.setData({ campusName });
    }
  },

  async ensureCoachOrderVenue(venueId) {
    const wantId = String(venueId || '').trim();
    if (!wantId) return;
    const app = getApp();
    if (!app || !app.globalData) return;
    const cur = app.globalData.selectedVenue;
    const same =
      cur &&
      cur.id != null &&
      (String(cur.id).trim() === wantId || Number(cur.id) === Number(wantId));
    if (!same) {
      app.globalData.selectedVenue = { id: wantId };
    }
    try {
      await refreshSelectedVenueFromCloud(app);
      this.syncCampusName();
      const venue = app.globalData.selectedVenue;
      const courtList = venue && Array.isArray(venue.courtList) ? venue.courtList : [];
      if (courtList.length > 0 && (!this.data.courts || this.data.courts.length === 0)) {
        const courts = courtList.map((c, idx) => ({
          id: idx + 1,
          name: (c && c.name) || `${idx + 1}号场`,
        }));
        this.setData({ courts });
      }
    } catch (e) {
      console.warn('ensureCoachOrderVenue', e);
    }
  },

  /**
   * 分享入口等：用占用元数据校正 lessonKey / 场次价 / holdIds，
   * 再拉课时余额以展示「使用课时 / 组合 / 微信」。
   */
  hydrateCoachCoursePricingFromMeta(metaMap) {
    if (!this.data.isCoachCourseOrder) return;
    const bs = Array.isArray(this.data.bookedSlots) ? [...this.data.bookedSlots] : [];
    if (bs.length === 0) return;
    bs.sort((a, b) =>
      Number(a.courtId) !== Number(b.courtId)
        ? Number(a.courtId) - Number(b.courtId)
        : Number(a.slotIndex) - Number(b.slotIndex),
    );
    const first = bs[0];
    const key = `${Number(first.courtId)}-${Number(first.slotIndex)}`;
    const m = (metaMap && metaMap[key]) || {};

    const lt =
      m.lessonType != null && String(m.lessonType).trim() !== ''
        ? String(m.lessonType).trim()
        : '';
    const pm =
      m.pairMode != null && String(m.pairMode).trim() !== ''
        ? String(m.pairMode).trim()
        : '1v1';
    const gm = m.groupMode != null ? String(m.groupMode).trim() : '';
    const nextLessonKey =
      lt && lt !== 'venue_lock' ? buildLessonKey(lt, pm, gm) : String(this.data.lessonKey || '').trim();
    const prevLessonKey = String(this.data.lessonKey || '').trim();
    const lessonKeyDisplay = formatLessonKeyDisplay(nextLessonKey || prevLessonKey);

    const holdIdSet = new Set();
    bs.forEach((s) => {
      const kk = `${Number(s.courtId)}-${Number(s.slotIndex)}`;
      const mm = (metaMap && metaMap[kk]) || {};
      if (Array.isArray(mm.sessionHoldIds) && mm.sessionHoldIds.length > 0) {
        mm.sessionHoldIds.forEach((hid) => {
          const h = String(hid || '').trim();
          if (h) holdIdSet.add(h);
        });
      } else if (mm.holdId) {
        holdIdSet.add(String(mm.holdId).trim());
      }
    });
    const nextHoldIds = [...holdIdSet].filter(Boolean);

    const labelFromMeta =
      m.capacityLabel != null && String(m.capacityLabel).trim() !== ''
        ? String(m.capacityLabel).trim()
        : '';
    const prevLabel = String(this.data.coachCapacityLabel || '').trim();
    const genericLabel = !prevLabel || prevLabel === '教练课程' || prevLabel === '教练占用';
    const coachCapacityLabel = labelFromMeta || (!genericLabel ? prevLabel : '') || lessonKeyDisplay || prevLabel;

    const patch = {
      coachCapacityLabel,
      coachName:
        m.coachName != null && String(m.coachName).trim() !== ''
          ? String(m.coachName).trim()
          : this.data.coachName,
      lessonKeyDisplay,
    };
    if (nextLessonKey) {
      patch.lessonKey = nextLessonKey;
      patch.coachPayWechatOnly = isCoachWechatOnlyLessonKey(nextLessonKey);
      if (patch.coachPayWechatOnly) {
        patch.payMethod = 'wechat';
        patch.coachPayUserChose = false;
        patch.courseHoursBalance = 0;
        patch.coachCourseBalanceReady = true;
        patch.coachCourseBalanceHint = '';
      }
    }
    if (nextHoldIds.length > 0) {
      patch.coachHoldIds = nextHoldIds;
    }

    const sessionYuan = sessionMemberPriceFromMeta(m);
    if (sessionYuan != null) {
      const courtId = Number(first.courtId);
      const courts = this.data.courts || [];
      const court = courts.find((c) => c.id === courtId);
      const courtName = court && court.name ? String(court.name) : `${courtId}号场`;
      const timeSlots = bs.map((s, i) => ({
        slotIndex: Number(s.slotIndex),
        time: this.getTimeSlotTime(Number(s.slotIndex)),
        price: i === 0 ? sessionYuan : 0,
      }));
      patch.totalPrice = sessionYuan;
      patch.orderItems = [
        {
          courtId,
          courtName,
          timeSlots: this.mergeTimeSlots(timeSlots),
          totalPrice: sessionYuan,
        },
      ];
      patch.coachSlotPrices = bs.map((_, i) => (i === 0 ? sessionYuan : 0));
    }

    const lessonKeyChanged = nextLessonKey && nextLessonKey !== prevLessonKey;
    this.setData(patch, () => {
      this.recomputeCoachPayAmounts();
      this.updateFooterButtonText();
      if (lessonKeyChanged || !this.data.coachCourseBalanceReady) {
        this.loadCoachCourseHoursBalance();
      }
    });
  },

  onShow() {
    this.syncCampusName();
    this.loadCoachCourseHoursBalance();
    this.loadVenueStoredBalance();
    this.loadMonthCardBenefit();
    this.loadVenueSessionCard();
    this.loadCoachSessionRoster();
    this.updateFooterButtonText();
    this._memberAssetWatchSessionGen = this._memberAssetWatchSessionGen || 0;
    attachPageMemberAssetRealtime(this, () => this.handleMemberAssetRealtimeChange());
  },

  onHide() {
    detachPageMemberAssetRealtime(this);
  },

  handleMemberAssetRealtimeChange() {
    this.loadCoachCourseHoursBalance();
    this.loadVenueStoredBalance();
    this.loadMonthCardBenefit();
    this.loadVenueSessionCard();
    this.updateFooterButtonText();
  },

  async loadCoachSessionRoster() {
    if (!this.data.isCoachCourseOrder || !this.data.venueId || !this.data.orderDate) return;
    const bs = this.data.bookedSlots;
    if (!bs || !bs[0]) return;
    this.beginLoading('加载中');
    try {
      const res = await getBookedSlots({
        venueId: this.data.venueId,
        orderDate: this.data.orderDate,
      });
      const r = res && res.result ? res.result : {};
      const metaMap =
        r.coachHoldMeta && typeof r.coachHoldMeta === 'object' && !Array.isArray(r.coachHoldMeta)
          ? r.coachHoldMeta
          : {};
      const first = bs[0];
      const key = `${Number(first.courtId)}-${Number(first.slotIndex)}`;
      const m = metaMap[key] || {};
      const participants = Array.isArray(m.participants) ? m.participants : [];
      const namesStr = participants
        .map((p) => (p && p.displayName ? String(p.displayName).trim() : ''))
        .filter(Boolean)
        .join('、');
      this.hydrateCoachCoursePricingFromMeta(metaMap);
      this.setData({
        coachSessionRosterReady: true,
        coachSessionJoined: m.joinedCount != null ? Number(m.joinedCount) : 0,
        coachSessionLimit: m.capacityLimit != null ? Number(m.capacityLimit) : 1,
        coachSessionFull: !!m.sessionFull,
        coachViewerAlreadyJoined: !!m.viewerAlreadyJoined,
        coachSessionParticipantNamesStr: namesStr,
      });
      this.updateFooterButtonText();
    } catch (e) {
      console.error('loadCoachSessionRoster', e);
    } finally {
      this.endLoading();
    }
  },

  /**
   * 教练课：各格 venueSlotPrice 仅首格为场次价、其余为 0，故合计为场次总价；组合支付按课时数切分。
   */

  onReady() {
    this.calculateContentScrollHeight();
    this.updateFooterButtonText();
  },

  // 根据登录状态更新底部按钮文案

  // 动态计算 scroll-view 高度：窗口高度 - header - footer - 间距
  calculateContentScrollHeight() {
    const windowInfo = wx.getWindowInfo();
    const windowHeight = windowInfo.windowHeight;

    const query = wx.createSelectorQuery();
    query.select('.header').boundingClientRect();
    query.exec((res) => {
      const headerRect = res[0];
      const headerHeight = headerRect ? headerRect.height : 0;
      const headerFallback = (windowInfo.statusBarHeight || 44) + 44; // statusBar + 导航栏
      const finalHeaderHeight = headerHeight > 0 ? headerHeight : headerFallback;

      // footer 高度：内边距 8*2 + 按钮约 36 + 底部安全区
      const safeAreaBottom = windowInfo.safeArea
        ? windowInfo.screenHeight - windowInfo.safeArea.bottom
        : 0;
      const footerHeight = 16 + 36 + safeAreaBottom + 8;

      const contentScrollHeight = Math.max(
        windowHeight - finalHeaderHeight - footerHeight - 10,
        200
      );

      this.setData({
        contentScrollHeight,
      });
    });
  },

  // 生成订单编号
  generateOrderNumber() {
    const date = new Date();
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const seconds = date.getSeconds();
    const random = Math.floor(Math.random() * 10000);
    
    const formatNumber = (num) => num < 10 ? `0${num}` : `${num}`;
    const formatRandom = (num) => {
      if (num < 10) return `000${num}`;
      if (num < 100) return `00${num}`;
      if (num < 1000) return `0${num}`;
      return `${num}`;
    };
    
    return `${year}${formatNumber(month)}${formatNumber(day)}${formatNumber(hours)}${formatNumber(minutes)}${formatNumber(seconds)}${formatRandom(random)}`;
  },

  /** 教练占用格：venueSlotPrice 为场次计价（合并块仅首格有价，见 coachSessionVenuePrice） */
  processCoachCourseOrderItems(selectedSlots, courts) {
    const orderMap = {};
    (selectedSlots || []).forEach((slot) => {
      const court = courts.find((c) => c.id === slot.courtId);
      if (!court) return;
      const slotData = court.slots[slot.slotIndex];
      if (!slotData) return;
      const raw =
        slotData.venueSlotPrice != null ? slotData.venueSlotPrice : slotData.price;
      const price = Number(raw);
      if (!Number.isFinite(price)) return;
      const key = slot.courtId;
      if (!orderMap[key]) {
        orderMap[key] = {
          courtId: slot.courtId,
          courtName: court.name,
          timeSlots: [],
          totalPrice: 0,
        };
      }
      const timeSlot = {
        slotIndex: slot.slotIndex,
        time: this.getTimeSlotTime(slot.slotIndex),
        price,
      };
      orderMap[key].timeSlots.push(timeSlot);
      orderMap[key].totalPrice += price;
    });
    Object.keys(orderMap).forEach((key) => {
      orderMap[key].timeSlots = this.mergeTimeSlots(orderMap[key].timeSlots);
    });
    return Object.values(orderMap);
  },

  // 处理订单项，按场地分组
  processOrderItems(selectedSlots, courts) {
    const orderMap = {};
    
    selectedSlots.forEach(slot => {
      const court = courts.find(c => c.id === slot.courtId);
      if (!court) return;
      
      const slotData = court.slots[slot.slotIndex];
      if (!slotData || !slotData.available) return;
      
      const key = slot.courtId;
      if (!orderMap[key]) {
        orderMap[key] = {
          courtId: slot.courtId,
          courtName: court.name,
          timeSlots: [],
          totalPrice: 0,
        };
      }
      
      // 找到对应的时间段
      const timeSlot = {
        slotIndex: slot.slotIndex,
        time: this.getTimeSlotTime(slot.slotIndex),
        price: slotData.price,
      };
      
      orderMap[key].timeSlots.push(timeSlot);
      orderMap[key].totalPrice += slotData.price;
    });
    
    // 对每个场地的时间段进行合并处理
    Object.keys(orderMap).forEach(key => {
      orderMap[key].timeSlots = this.mergeTimeSlots(orderMap[key].timeSlots);
    });
    
    return Object.values(orderMap);
  },
  
  // 合并连续的时间段
  mergeTimeSlots(timeSlots) {
    if (timeSlots.length === 0) return [];
    
    // 按 slotIndex 排序
    const sorted = [...timeSlots].sort((a, b) => a.slotIndex - b.slotIndex);
    const merged = [];
    
    let currentRange = {
      startIndex: sorted[0].slotIndex,
      endIndex: sorted[0].slotIndex,
      startTime: sorted[0].time,
      endTime: this.getTimeSlotEndTime(sorted[0].slotIndex),
      price: sorted[0].price,
      hours: 1,
    };
    
    for (let i = 1; i < sorted.length; i++) {
      const current = sorted[i];
      
      // 如果当前时间段与上一个连续
      if (current.slotIndex === currentRange.endIndex + 1) {
        currentRange.endIndex = current.slotIndex;
        currentRange.endTime = this.getTimeSlotEndTime(current.slotIndex);
        currentRange.price += current.price;
        currentRange.hours += 1;
      } else {
        // 不连续，保存当前范围，开始新范围
        merged.push({
          timeRange: `${currentRange.startTime}-${currentRange.endTime}`,
          hours: currentRange.hours,
          price: currentRange.price,
        });
        
        currentRange = {
          startIndex: current.slotIndex,
          endIndex: current.slotIndex,
          startTime: current.time,
          endTime: this.getTimeSlotEndTime(current.slotIndex),
          price: current.price,
          hours: 1,
        };
      }
    }
    
    // 添加最后一个范围
    merged.push({
      timeRange: `${currentRange.startTime}-${currentRange.endTime}`,
      hours: currentRange.hours,
      price: currentRange.price,
    });
    
    return merged;
  },

  // 根据索引获取时间段开始时间
  getTimeSlotTime(slotIndex) {
    const hour = 8 + slotIndex;
    const hourStr = hour < 10 ? `0${hour}` : `${hour}`;
    return `${hourStr}:00`;
  },
  
  // 根据索引获取时间段结束时间（显示为 15:59 格式）
  getTimeSlotEndTime(slotIndex) {
    const hour = 8 + slotIndex;
    const hourStr = hour < 10 ? `0${hour}` : `${hour}`;
    return `${hourStr}:59`;
  },
  
  // 格式化日期
  formatDate(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const weekday = weekdays[date.getDay()];
    
    return `${year}.${month < 10 ? '0' + month : month}.${day < 10 ? '0' + day : day} ${weekday}`;
  },

  // 计算总价
  calculateTotalPrice(orderItems) {
    return orderItems.reduce((total, item) => total + item.totalPrice, 0);
  },

  onUnload() {
    detachPageMemberAssetRealtime(this);
    this._loadingTaskCount = 0;
    this.setData({ lottieLoadingVisible: false });
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

  // 拉起微信支付；订场成功后跳转订场成功页并清空预订页已选时段

  handleClosePhoneAuthModal() {
    this.setData({ showPhoneAuthModal: false });
  },

  /**
   * 手机号授权登录/注册（逻辑与 profile 页一致）
   */
  async onPhoneRegister(e) {
    const { errMsg, encryptedData, iv } = e.detail || {};
    if (!errMsg || !errMsg.includes('ok')) {
      return;
    }

    const app = getApp();
    if (!app) return;

    this.beginLoading('处理中...');
    try {
      const loginCode = await app.doLogin();
      if (!loginCode) {
        this.endLoading();
        wx.showToast({ title: '登录失败，请重试', icon: 'none' });
        return;
      }
      wx.setStorageSync(STORAGE_KEYS.userPhoneCode, loginCode);

      if (!encryptedData || !iv) {
        this.endLoading();
        wx.setStorageSync(STORAGE_KEYS.userPhoneCode, '');
        wx.setStorageSync(STORAGE_KEYS.userPhone, '');
        wx.showToast({ title: '缺少授权数据，请重试', icon: 'none' });
        return;
      }

      const { miniProgram } = wx.getAccountInfoSync() || {};
      const appid = miniProgram?.appId;
      const decryptRes = await decryptPhoneNumber({
        code: loginCode,
        encryptedData,
        iv,
        appid,
      });
      const payload =
        decryptRes && decryptRes.result != null ? decryptRes.result : decryptRes;
      const phoneNumber = payload && payload.phoneNumber;
      const user = payload && payload.user ? payload.user : null;
      const created = !!(payload && payload.created);

      if (!phoneNumber || !user) {
        this.endLoading();
        wx.setStorageSync(STORAGE_KEYS.userPhoneCode, '');
        wx.setStorageSync(STORAGE_KEYS.userPhone, '');
        wx.showToast({
          title: payload && payload.error ? '登录失败，请重试' : '手机号解密失败，请重试',
          icon: 'none',
        });
        return;
      }

      const phone = String(phoneNumber);
      wx.setStorageSync(STORAGE_KEYS.userPhone, phone);
      wx.setStorageSync(STORAGE_KEYS.userAvatar, user.avatar || DEFAULT_USER_AVATAR);
      wx.setStorageSync(
        STORAGE_KEYS.userNickname,
        user.name || `昂湃用户_${phone.slice(-4)}`,
      );

      this.endLoading();
      this.setData({ showPhoneAuthModal: false });
      wx.showToast({ title: created ? '注册成功' : '登录成功', icon: 'success' });
      this.updateFooterButtonText();
      this.loadCoachCourseHoursBalance();
      this.loadCoachSessionRoster();
    } catch (err2) {
      this.endLoading();
      wx.showToast({ title: '处理失败，请重试', icon: 'none' });
    }
  },
});
