const STORAGE_KEYS = {
  userPhoneCode: 'user_phone_code',
  userPhone: 'user_phone',
  userNickname: 'user_nickname',
  userAvatar: 'user_avatar',
};

/** 与 pages/booking-success 约定：支付/纯课时订场成功后写入，成功页读取后删除 */
const BOOKING_SUCCESS_STORAGE_KEY = 'booking_success_payload';

const {
  getUserByPhone,
  createUser,
  decryptPhoneNumber,
  DEFAULT_USER_AVATAR,
  listMemberCourseHours,
  completeCoachBookingWithHours,
  getBookedSlots,
} = require('../../api/tennisDb');
const { buildLessonKey, formatLessonKeyDisplay } = require('../../utils/lessonKey');
const { lessonKeyFromTypeMapFormat, splitCourseDescriptionLines } = require('../../utils/courseCatalog');

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
    lottieLoadingVisible: false,
    /** 课时包：db_course.typeMap 多规格 */
    goodsHasTypeMap: false,
    goodsFormatKeys: [],
    goodsSessionKeys: [],
    selectedGoodsFormat: '',
    selectedGoodsSession: '',
  },
  _loadingTaskCount: 0,

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

    // 教练课程时段：从预订页点击教练占用格
    if (options.orderSource === 'coachCourse' && options.coachPayload) {
      try {
        const coachPayload = JSON.parse(decodeURIComponent(options.coachPayload || '{}'));
        const courts = JSON.parse(decodeURIComponent(options.courts || '[]'));
        const selectedDate = decodeURIComponent(options.selectedDate || '');
        const venueId = decodeURIComponent(options.venueId || '');
        const {
          holdIds,
          bookedSlots,
          lessonType,
          pairMode,
          groupMode,
          capacityLabel,
          coachName: coachNameRaw,
        } = coachPayload;
        if (
          Array.isArray(holdIds) &&
          holdIds.length > 0 &&
          Array.isArray(bookedSlots) &&
          bookedSlots.length > 0
        ) {
          const orderItems = this.processCoachCourseOrderItems(bookedSlots, courts);
          const totalPrice = this.calculateTotalPrice(orderItems);
          const formattedDate = this.formatDate(selectedDate);
          const lessonKey = buildLessonKey(lessonType, pairMode, groupMode);
          const requiredCourseHours = bookedSlots.length;
          const coachSlotPrices = this.computeCoachSlotPrices(bookedSlots, courts);
          this.setData({
            orderType: 'court',
            isCoachCourseOrder: true,
            coachHoldIds: holdIds.map((id) => String(id)),
            coachCapacityLabel: String(capacityLabel || '').trim(),
            coachName: String(coachNameRaw || '').trim(),
            lessonKey,
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
            coachCourseBalanceReady: false,
            coachCourseBalanceHint: '加载中...',
            coachSessionRosterReady: false,
            coachSessionJoined: 0,
            coachSessionLimit: 1,
            coachSessionFull: false,
            coachViewerAlreadyJoined: false,
            coachSessionParticipantNamesStr: '',
          });
          this.syncCampusName();
          return;
        }
      } catch (err) {
        console.error('解析教练课程订单失败', err);
      }
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

    this.setData({
      orderDate: selectedDate,
      formattedDate: formattedDate,
      orderNumber: orderNumber,
      orderItems: orderItems,
      bookedSlots,
      totalPrice: totalPrice,
      venueId: venueId,
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

  onShow() {
    this.syncCampusName();
    this.loadCoachCourseHoursBalance();
    this.loadCoachSessionRoster();
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

  selectPayMethod(e) {
    const method = e.currentTarget.dataset.method;
    if (method !== 'course_hours' && method !== 'wechat' && method !== 'mixed') return;
    const need = this.data.requiredCourseHours || 0;
    const bal = Math.floor(Number(this.data.courseHoursBalance) || 0);
    if (method === 'course_hours') {
      if (bal < need) return;
    }
    if (method === 'mixed') {
      if (!(bal > 0 && bal < need)) return;
    }
    this.setData({ payMethod: method, coachPayUserChose: true }, () => {
      this.recomputeCoachPayAmounts();
      this.updateFooterButtonText();
    });
  },

  /**
   * 与组合支付一致：先按 courtId、slotIndex 排序，前若干小时走课时，其余按各格 venueSlotPrice 累计为微信金额。
   */
  computeCoachSlotPrices(selectedSlots, courts) {
    const slots = (selectedSlots || [])
      .map((s) => ({
        courtId: Number(s.courtId),
        slotIndex: Number(s.slotIndex),
      }))
      .filter((s) => Number.isFinite(s.courtId) && Number.isFinite(s.slotIndex));
    slots.sort((a, b) =>
      a.courtId !== b.courtId ? a.courtId - b.courtId : a.slotIndex - b.slotIndex,
    );
    const prices = [];
    slots.forEach((s) => {
      const court = (courts || []).find((c) => c.id === s.courtId);
      if (!court || !court.slots) return;
      const slotData = court.slots[s.slotIndex];
      if (!slotData) return;
      const raw =
        slotData.venueSlotPrice != null ? slotData.venueSlotPrice : slotData.price;
      const price = Number(raw);
      if (!Number.isFinite(price)) return;
      prices.push(price);
    });
    return prices;
  },

  recomputeCoachPayAmounts() {
    if (!this.data.isCoachCourseOrder) return;
    const need = this.data.requiredCourseHours || 0;
    const balance = Math.floor(Number(this.data.courseHoursBalance) || 0);
    const prices = this.data.coachSlotPrices || [];
    const totalPrice = Number(this.data.totalPrice) || 0;
    const pm = this.data.payMethod;
    let deduct = 0;
    let cash = totalPrice;
    if (pm === 'wechat') {
      deduct = 0;
      cash = totalPrice;
    } else if (pm === 'mixed') {
      deduct = Math.min(balance, need);
      if (prices.length === need && need > 0) {
        cash = prices.slice(deduct).reduce((a, b) => a + b, 0);
      } else if (need > 0) {
        const per = totalPrice / need;
        cash = per * Math.max(0, need - deduct);
      }
      cash = Math.round(cash * 100) / 100;
    } else {
      deduct = 0;
      cash = 0;
    }
    let mixedPreviewDeduct = 0;
    let mixedPreviewCash = 0;
    if (balance > 0 && balance < need && need > 0) {
      mixedPreviewDeduct = Math.min(balance, need);
      if (prices.length === need) {
        mixedPreviewCash = prices.slice(mixedPreviewDeduct).reduce((a, b) => a + b, 0);
      } else {
        const per = totalPrice / need;
        mixedPreviewCash = per * Math.max(0, need - mixedPreviewDeduct);
      }
      mixedPreviewCash = Math.round(mixedPreviewCash * 100) / 100;
    }
    this.setData({
      coachHoursDeductForPay: deduct,
      comboCashYuan: cash,
      coachMixedPreviewDeduct: mixedPreviewDeduct,
      coachMixedPreviewCash: mixedPreviewCash,
    });
  },

  async loadCoachCourseHoursBalance() {
    if (!this.data.isCoachCourseOrder || !this.data.lessonKey) return;
    const app = getApp();
    if (!app || !app.checkLogin()) {
      this.setData(
        {
          courseHoursBalance: 0,
          payMethod: 'wechat',
          coachPayUserChose: false,
          coachCourseBalanceReady: false,
          coachCourseBalanceHint: '请登录后查看本场馆该课程类型的剩余课时',
        },
        () => {
          this.recomputeCoachPayAmounts();
          this.updateFooterButtonText();
        },
      );
      return;
    }
    const venueId = String(this.data.venueId || '').trim();
    if (!venueId) {
      this.setData({
        coachCourseBalanceReady: false,
        coachCourseBalanceHint: '缺少场馆信息，无法查询课时',
      });
      return;
    }
    this.setData({
      coachCourseBalanceReady: false,
      coachCourseBalanceHint: '加载中...',
    });
    this.beginLoading('加载课时中');
    try {
      const cloudRes = await listMemberCourseHours(venueId);
      const rows =
        cloudRes && cloudRes.result && Array.isArray(cloudRes.result.data)
          ? cloudRes.result.data
          : [];
      let hours = 0;
      const key = this.data.lessonKey;
      rows.forEach((r) => {
        if (String(r.lessonKey || '').trim() === key) {
          hours = Number(r.hours) || 0;
        }
      });
      const need = this.data.requiredCourseHours || 0;
      const bal = Math.floor(Number(hours) || 0);
      const defaultMethod = () => {
        if (need <= 0) return 'wechat';
        if (bal >= need) return 'course_hours';
        if (bal > 0) return 'mixed';
        return 'wechat';
      };
      let payMethod = defaultMethod();
      let nextChose = this.data.coachPayUserChose;
      if (nextChose) {
        const cur = this.data.payMethod;
        if (cur === 'course_hours' && bal < need) {
          payMethod = defaultMethod();
          nextChose = false;
        } else if (cur === 'mixed' && !(bal > 0 && bal < need)) {
          payMethod = defaultMethod();
          nextChose = false;
        } else {
          payMethod = cur;
        }
      }
      this.setData(
        {
          courseHoursBalance: hours,
          payMethod,
          coachPayUserChose: nextChose,
          coachCourseBalanceReady: true,
          coachCourseBalanceHint: '',
        },
        () => {
          this.recomputeCoachPayAmounts();
          this.updateFooterButtonText();
        },
      );
    } catch (e) {
      console.error('loadCoachCourseHoursBalance', e);
      this.setData({
        coachCourseBalanceReady: false,
        coachCourseBalanceHint: '课时加载失败，请稍后重试',
      });
      this.updateFooterButtonText();
    } finally {
      this.endLoading();
    }
  },

  onReady() {
    this.calculateContentScrollHeight();
    this.updateFooterButtonText();
  },

  // 根据登录状态更新底部按钮文案
  updateFooterButtonText() {
    const app = getApp();
    if (!app.checkLogin()) {
      this.setData({ footerButtonText: '去登录' });
      return;
    }
    if (this.data.orderType === 'court' && this.data.isCoachCourseOrder) {
      if (this.data.coachSessionRosterReady && this.data.coachSessionFull) {
        this.setData({ footerButtonText: '名额已满' });
        return;
      }
      if (this.data.coachSessionRosterReady && this.data.coachViewerAlreadyJoined) {
        this.setData({ footerButtonText: '您已在名单中' });
        return;
      }
      if (this.data.payMethod === 'course_hours') {
        const h = this.data.requiredCourseHours || 0;
        this.setData({ footerButtonText: `确认使用课时（${h} 小时）` });
        return;
      }
      if (this.data.payMethod === 'mixed') {
        const y = this.data.comboCashYuan;
        this.setData({ footerButtonText: `微信支付 ¥${y}` });
        return;
      }
      this.setData({ footerButtonText: '微信支付' });
      return;
    }
    this.setData({ footerButtonText: '确认付款' });
  },

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

  /** 教练占用格：用 venueSlotPrice 计价（与会员订场单价一致） */
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

  // 拉起支付前做一次实时占用校验（普通场地单）
  async validateCourtAvailabilityBeforePay() {
    if (this.data.orderType !== 'court' || this.data.isCoachCourseOrder) return true;
    const venueId = String(this.data.venueId || '').trim();
    const orderDate = String(this.data.orderDate || '').trim();
    const slots = Array.isArray(this.data.bookedSlots) ? this.data.bookedSlots : [];
    if (!venueId || !orderDate || slots.length === 0) {
      wx.showToast({ title: '订单数据异常，请返回重试', icon: 'none' });
      return false;
    }
    this.beginLoading('校验中');
    try {
      const res = await getBookedSlots({ venueId, orderDate });
      const result = res && res.result ? res.result : {};
      const keys = Array.isArray(result.keys) ? result.keys : [];
      const occupied = new Set(keys);
      const conflict = slots.some(
        (s) => occupied.has(`${Number(s.courtId)}-${Number(s.slotIndex)}`)
      );
      if (conflict) {
        wx.showToast({ title: '时段已被预订，请返回重选', icon: 'none' });
        return false;
      }
      return true;
    } catch (e) {
      console.error('validateCourtAvailabilityBeforePay', e);
      wx.showToast({ title: '校验失败，请重试', icon: 'none' });
      return false;
    } finally {
      this.endLoading();
    }
  },

  onUnload() {
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
  async saveOrderToDB() {
    const { orderType, totalPrice } = this.data;
    const yuan = Number(totalPrice);
    if (!Number.isFinite(yuan) || yuan <= 0) {
      wx.showToast({ title: '订单金额无效', icon: 'none' });
      return;
    }
    const isCoachWx =
      orderType === 'court' &&
      this.data.isCoachCourseOrder &&
      (this.data.payMethod === 'wechat' || this.data.payMethod === 'mixed');
    if (isCoachWx && this.data.payMethod === 'mixed') {
      const cash = Number(this.data.comboCashYuan);
      const d = Math.floor(Number(this.data.coachHoursDeductForPay) || 0);
      if (!Number.isFinite(cash) || cash <= 0) {
        wx.showToast({ title: '微信应付金额无效', icon: 'none' });
        return;
      }
      if (d <= 0) {
        wx.showToast({ title: '组合支付课时数无效', icon: 'none' });
        return;
      }
    }

    const courtOk = await this.validateCourtAvailabilityBeforePay();
    if (!courtOk) return;

    let totalFee = 1;
    if (isCoachWx) {
      const cashYuan =
        this.data.payMethod === 'mixed'
          ? Number(this.data.comboCashYuan)
          : Number(totalPrice);
      totalFee = Math.max(1, Math.round(cashYuan * 100));
    }

    const payPayload = {
      totalFee,
    };
    if (orderType === 'goods') {
      const phone = String(wx.getStorageSync(STORAGE_KEYS.userPhone) || '').trim();
      if (!phone) {
        wx.showToast({ title: '请先登录并授权手机号', icon: 'none' });
        return;
      }
      const g = this.data.goodItem;
      if (!g) {
        wx.showToast({ title: '商品信息缺失', icon: 'none' });
        return;
      }
      const grantHours = Math.floor(Number(g.grantHours) || 0);
      const lessonKey = String(g.lessonKey || '').trim();
      const goodsVenueId = String(g.venueId || '').trim();
      if (!lessonKey || grantHours <= 0) {
        wx.showToast({
          title: this.data.goodsHasTypeMap
            ? '请选择上课形式与节数套餐'
            : '无法识别课时或课程类型，请检查 db_course 的 typeMap / unit，或填写 grantHours、lessonKey',
          icon: 'none',
        });
        return;
      }
      if (!goodsVenueId) {
        wx.showToast({
          title: '课程未绑定场馆，请从首页选择场馆后再购买',
          icon: 'none',
        });
        return;
      }
      // booking-success 页「商品」只展示标题/规格，不展示 description（subtitle）
      let goodDesc = g.title ? String(g.title).trim() : '';
      if (!goodDesc) goodDesc = g.desc || '';
      if (
        this.data.goodsHasTypeMap &&
        this.data.selectedGoodsFormat &&
        this.data.selectedGoodsSession !== '' &&
        this.data.selectedGoodsSession != null
      ) {
        goodDesc = `${goodDesc} ${this.data.selectedGoodsFormat}×${this.data.selectedGoodsSession}节`.trim();
      }
      payPayload.goodsPurchase = {
        type: 'course_hours',
        phone,
        courseId: g.id,
        grantHours,
        lessonKey,
        venueId: goodsVenueId,
        goodDesc,
      };
    }
    if (orderType === 'court') {
      const phone = String(wx.getStorageSync(STORAGE_KEYS.userPhone) || '').trim();
      if (!phone) {
        wx.showToast({ title: '请先登录并授权手机号', icon: 'none' });
        return;
      }
      payPayload.phone = phone;
      payPayload.booking = {
        type: 'court',
        orderNumber: this.data.orderNumber,
        campusName: this.data.campusName,
        venueId: this.data.venueId,
        orderDate: this.data.orderDate,
        formattedDate: this.data.formattedDate,
        orderItems: this.data.orderItems,
        bookedSlots: this.data.bookedSlots || [],
        totalPrice: this.data.totalPrice,
        coachHoldIds: this.data.isCoachCourseOrder ? this.data.coachHoldIds || [] : [],
        bookingSubtype: this.data.isCoachCourseOrder ? 'coach_course' : '',
        lessonKey: this.data.isCoachCourseOrder ? String(this.data.lessonKey || '').trim() : '',
        coachCapacityLabel: this.data.isCoachCourseOrder
          ? String(this.data.coachCapacityLabel || '').trim()
          : '',
        coachCourseHoursDeduct:
          this.data.isCoachCourseOrder && this.data.payMethod === 'mixed'
            ? Math.floor(Number(this.data.coachHoursDeductForPay) || 0)
            : 0,
        memberDisplayName: this.data.isCoachCourseOrder
          ? String(wx.getStorageSync(STORAGE_KEYS.userNickname) || '').trim().slice(0, 40)
          : '',
      };
    }

    this.beginLoading('支付中...');
    wx.cloud.callFunction({
      name: 'pay',
      data: payPayload,
      success: (res) => {
        this.endLoading();
        const result = res.result || {};
        const payment = result.payment;
        if (result.returnCode !== 'SUCCESS' || !payment) {
          console.error('unifiedOrder 失败', result);
          wx.showToast({
            title: result.returnMsg || '下单失败',
            icon: 'none',
          });
          return;
        }
        wx.requestPayment({
          ...payment,
          success: () => {
            if (orderType === 'court') {
              try {
                wx.setStorageSync(BOOKING_SUCCESS_STORAGE_KEY, {
                  successKind: 'court',
                  campusName: this.data.campusName,
                  orderItems: this.data.orderItems,
                });
              } catch (e) {
                console.error('写入订场成功缓存失败', e);
              }
              const app = getApp();
              if (app && app.globalData) {
                app.globalData.shouldClearBookingData = true;
              }
              wx.redirectTo({ url: '/pages/booking-success/index' });
              return;
            }
            if (orderType === 'goods') {
              const g = this.data.goodItem;
              const gh = Math.floor(Number(g && g.grantHours) || 0);
              try {
                wx.setStorageSync(BOOKING_SUCCESS_STORAGE_KEY, {
                  successKind: 'coursePurchase',
                  campusName: this.data.campusName || (g && g.venueName) || '',
                  goodDesc: (g && g.desc) || '',
                  grantHours: gh,
                  lessonLabel: formatLessonKeyDisplay(String((g && g.lessonKey) || '')),
                });
              } catch (e) {
                console.error('写入买课成功缓存失败', e);
              }
              wx.redirectTo({ url: '/pages/booking-success/index' });
              return;
            }
            wx.showToast({ title: '支付成功', icon: 'success' });
          },
          fail: (err) => {
            console.error('pay fail', err);
            wx.showToast({
              title: err.errMsg && err.errMsg.indexOf('cancel') >= 0 ? '已取消支付' : '支付未完成',
              icon: 'none',
            });
          },
        });
      },
      fail: (err) => {
        this.endLoading();
        console.error('callFunction pay', err);
        wx.showToast({ title: '网络异常，请重试', icon: 'none' });
      },
    });
  },

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
      const phoneNumber =
        decryptRes && decryptRes.result ? decryptRes.result.phoneNumber : decryptRes.phoneNumber;

      if (!phoneNumber) {
        this.endLoading();
        wx.setStorageSync(STORAGE_KEYS.userPhoneCode, '');
        wx.setStorageSync(STORAGE_KEYS.userPhone, '');
        wx.showToast({ title: '手机号解密失败，请重试', icon: 'none' });
        return;
      }

      const phone = String(phoneNumber);
      const last4 = phone.slice(-4);
      const defaultNickname = `昂湃用户_${last4}`;

      const res = await getUserByPhone(phone);
      const user = res && res.data && res.data.length > 0 ? res.data[0] : null;

      if (user) {
        wx.setStorageSync(STORAGE_KEYS.userPhone, phone);
        wx.setStorageSync(STORAGE_KEYS.userAvatar, user.avatar || '');
        wx.setStorageSync(STORAGE_KEYS.userNickname, user.name || '');
        this.endLoading();
        this.setData({ showPhoneAuthModal: false });
        wx.showToast({ title: '登录成功', icon: 'success' });
        this.updateFooterButtonText();
        this.loadCoachCourseHoursBalance();
        this.loadCoachSessionRoster();
        return;
      }

      await createUser({
        phone,
        name: defaultNickname,
      });

      wx.setStorageSync(STORAGE_KEYS.userPhone, phone);
      wx.setStorageSync(STORAGE_KEYS.userNickname, defaultNickname);
      wx.setStorageSync(STORAGE_KEYS.userAvatar, DEFAULT_USER_AVATAR);

      this.endLoading();
      this.setData({ showPhoneAuthModal: false });
      wx.showToast({ title: '注册成功', icon: 'success' });
      this.updateFooterButtonText();
      this.loadCoachCourseHoursBalance();
      this.loadCoachSessionRoster();
    } catch (err2) {
      this.endLoading();
      wx.showToast({ title: '处理失败，请重试', icon: 'none' });
    }
  },

  // 处理底部按钮点击：未登录时去登录（先查库），已登录时确认付款
  async handleSubmitOrder() {
    const app = getApp();
    if (!app.checkLogin()) {
      // 1）本地已有手机号：查云库是否已注册 → 已注册则直接 wx.login 完成登录
      const storedPhone = wx.getStorageSync(STORAGE_KEYS.userPhone) || '';
      if (storedPhone) {
        this.beginLoading('验证中...');
        try {
          const res = await getUserByPhone(storedPhone);
          const user = res && res.data && res.data.length > 0 ? res.data[0] : null;
          if (user) {
            await app.doLogin();
            wx.setStorageSync(STORAGE_KEYS.userPhone, storedPhone);
            wx.setStorageSync(STORAGE_KEYS.userAvatar, user.avatar || '');
            wx.setStorageSync(STORAGE_KEYS.userNickname, user.name || '');
            this.endLoading();
            wx.showToast({ title: '登录成功', icon: 'success' });
            this.updateFooterButtonText();
            this.loadCoachCourseHoursBalance();
            this.loadCoachSessionRoster();
            return;
          }
        } catch (e) {
          console.error('getUserByPhone failed', e);
        }
        this.endLoading();
      }

      // 2）无手机号或库中无用户：弹出手机号授权
      this.setData({ showPhoneAuthModal: true });
      return;
    }

    if (
      this.data.orderType === 'court' &&
      this.data.isCoachCourseOrder &&
      this.data.coachSessionRosterReady &&
      (this.data.coachSessionFull || this.data.coachViewerAlreadyJoined)
    ) {
      wx.showToast({
        title: this.data.coachSessionFull ? '该课节名额已满' : '您已在该课节名单中',
        icon: 'none',
      });
      return;
    }

    if (
      this.data.orderType === 'court' &&
      this.data.isCoachCourseOrder &&
      this.data.payMethod === 'course_hours'
    ) {
      this.submitCoachCourseWithHours();
      return;
    }

    await this.saveOrderToDB();
  },

  async submitCoachCourseWithHours() {
    if (
      this.data.coachSessionRosterReady &&
      (this.data.coachSessionFull || this.data.coachViewerAlreadyJoined)
    ) {
      wx.showToast({
        title: this.data.coachSessionFull ? '该课节名额已满' : '您已在该课节名单中',
        icon: 'none',
      });
      return;
    }
    const phone = String(wx.getStorageSync(STORAGE_KEYS.userPhone) || '').trim();
    if (!phone) {
      wx.showToast({ title: '请先登录并授权手机号', icon: 'none' });
      return;
    }
    const need = this.data.requiredCourseHours || 0;
    if ((this.data.courseHoursBalance || 0) < need) {
      wx.showToast({ title: '课时不足', icon: 'none' });
      return;
    }
    const snapshot = {
      orderNumber: this.data.orderNumber,
      campusName: this.data.campusName,
      venueId: this.data.venueId,
      orderDate: this.data.orderDate,
      formattedDate: this.data.formattedDate,
      orderItems: this.data.orderItems,
      bookedSlots: this.data.bookedSlots || [],
      totalPrice: this.data.totalPrice,
      lessonKey: this.data.lessonKey,
      coachCapacityLabel: this.data.coachCapacityLabel,
      memberDisplayName: String(wx.getStorageSync(STORAGE_KEYS.userNickname) || '').trim().slice(0, 40),
    };
    this.beginLoading('提交中...');
    try {
      const cloudRes = await completeCoachBookingWithHours({
        phone,
        holdIds: this.data.coachHoldIds || [],
        snapshot,
      });
      this.endLoading();
      const r = cloudRes && cloudRes.result ? cloudRes.result : {};
      if (!r.ok) {
        wx.showToast({ title: r.errMsg || '提交失败', icon: 'none' });
        return;
      }
      try {
        wx.setStorageSync(BOOKING_SUCCESS_STORAGE_KEY, {
          successKind: 'court',
          campusName: this.data.campusName,
          orderItems: this.data.orderItems,
        });
      } catch (e) {
        console.error('写入订场成功缓存失败', e);
      }
      const app = getApp();
      if (app && app.globalData) {
        app.globalData.shouldClearBookingData = true;
      }
      wx.redirectTo({ url: '/pages/booking-success/index' });
    } catch (e) {
      this.endLoading();
      console.error('completeCoachBookingWithHours', e);
      wx.showToast({ title: '网络异常，请重试', icon: 'none' });
    }
  },
});
