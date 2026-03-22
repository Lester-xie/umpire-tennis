const {
  getCourtSlotPrices,
  getBookedSlots,
  coachHoldSlots,
  listCoachHolds,
  cancelCoachHold,
  updateCoachHolds,
} = require('../../api/tennisDb');

/** 与云函数一致，用于和「我的场地占用」、接口返回的 orderDate 对齐 */
function normalizeOrderDateStr(d) {
  const s = String(d || '').trim();
  const parts = s.split('-');
  if (parts.length !== 3) return s;
  const y = parseInt(parts[0], 10);
  const mo = parseInt(parts[1], 10);
  const day = parseInt(parts[2], 10);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(day)) return s;
  return `${y}-${String(mo).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function venueIdLooseEqual(a, b) {
  const sa = a == null ? '' : String(a).trim();
  const sb = b == null ? '' : String(b).trim();
  if (sa === sb) return true;
  const na = Number(sa);
  const nb = Number(sb);
  return Number.isFinite(na) && Number.isFinite(nb) && na === nb;
}

/** 根据 YYYY-MM-DD 判断是否为周六(6)或周日(0) */
function isWeekendDateStr(dateStr) {
  const parts = String(dateStr || '').split('-');
  if (parts.length !== 3) return false;
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10) - 1;
  const d = parseInt(parts[2], 10);
  if (Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) return false;
  const wd = new Date(y, m, d).getDay();
  return wd === 0 || wd === 6;
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
    rippleSlot: null, // 当前显示波纹动画的时间段 {courtId, slotIndex}
    totalPrice: 0, // 总价
    selectedVenueName: '', // 当前选定的球场名称
    selectedVenueId: '', // 当前选定的球场 id（用于 court_slot_prices）
    priceLoading: false, // 加载价格规则状态
    showPurposeSheet: false,
    /** experience | regular | group */
    lessonType: 'experience',
    /** 体验课/正课：1v1 | 1v2 */
    pairMode: '1v1',
    /** 团课：group35 | groupOther */
    groupMode: 'group35',
    /** purpose 弹层：create 新占场 | edit 改本人占用 */
    purposeSheetMode: 'create',
    editingHoldIds: [],
  },
  
  // 动画定时器
  rippleTimer: null,
  slotRippleTimer: null,
  /** 已支付订单 + 教练占用 的格子键 Set */
  bookedSlotKeySet: null,
  /** 每次发起 getBookedSlots 自增，用于丢弃过期响应 */
  _bookedSlotsFetchToken: 0,

  /** 标题：去选场页，选完后返回本页 */
  handleContentHeaderTitleTap() {
    wx.navigateTo({
      url: '/pages/location/index?from=booking',
    });
  },

  onLoad() {
    this.coachHoldMeta = {};
    this.myCoachHoldIdSet = new Set();
    const newVenueId = this.syncSelectedVenueName();
    // 生成最近两个月的日期列表
    this.generateDateList();
    // 加载价格规则后再生成时间段和场地数据（保证展示/计算一致）
    this.loadSlotPricesAndRender(newVenueId);
  },

  onShow() {
    const newVenueId = this.syncSelectedVenueName();
    if (newVenueId) {
      this.loadSlotPricesAndRender(newVenueId);
    }
    // 检查是否需要清空数据（下单成功后返回）
    const app = getApp();
    if (app && app.globalData && app.globalData.shouldClearBookingData) {
      this.clearBookingData();
      app.globalData.shouldClearBookingData = false;
    }
  },

  syncSelectedVenueName() {
    const app = getApp();
    const venue = app && app.globalData && app.globalData.selectedVenue;
    const name = (venue && venue.name) ? venue.name : '';
    const venueId = (venue && venue.id) ? venue.id : '';

    if (name !== this.data.selectedVenueName || venueId !== this.data.selectedVenueId) {
      this.setData({ selectedVenueName: name, selectedVenueId: venueId });
      // 切换球馆后重置已选择的时间段，并重新加载价格规则
      this.resetSelectedSlots();
      return venueId;
    }
    return null;
  },

  // 仅重置已选时间段（不重新生成场地/时段数据）
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
  
  // 清空预订数据
  clearBookingData() {
    // 重新加载价格规则并生成时间段和场地数据
    this.loadSlotPricesAndRender();
    
    // 清空选中状态
    this.setData({
      selectedSlots: [],
      selectedSlotsMap: {},
      totalPrice: 0,
      rippleSlot: null,
    });
    
    // 清除动画定时器
    if (this.slotRippleTimer) {
      clearTimeout(this.slotRippleTimer);
      this.slotRippleTimer = null;
    }
  },
  
  onReady() {
    // 页面渲染完成后计算 content 高度
    this.calculateContentHeight();
  },
  
  // 计算 content 高度：100vh - header 高度 - 底部安全距离 - custom-tab-bar 高度
  calculateContentHeight() {
    const windowInfo = wx.getWindowInfo();
    const windowHeight = windowInfo.windowHeight; // 100vh 对应的像素值
    
    // 查询 header 和 tab-bar 的实际高度
    const query = wx.createSelectorQuery();
    query.select('.header').boundingClientRect();
    query.select('.tab-bar').boundingClientRect();
    query.exec((res) => {
      const headerRect = res[0];
      const tabBarRect = res[1];
      
      // 获取 header 高度
      const headerHeight = headerRect ? headerRect.height : 0;
      
      // 如果查询不到 header，使用默认值（headerPaddingTop + 25）
      let finalHeaderHeight = headerHeight;
      if (!headerHeight || headerHeight === 0) {
        const app = getApp();
        let headerPaddingTop = 0;
        if (app && app.globalData && app.globalData.screenInfo && app.globalData.screenInfo.headerInfo) {
          headerPaddingTop = app.globalData.screenInfo.headerInfo.headerPaddingTop || 0;
        }
        finalHeaderHeight = headerPaddingTop + 25; // padding-top + title 高度
      }
      
      // 获取 tab-bar 高度
      const tabBarHeight = tabBarRect ? tabBarRect.height : 60; // 默认 60px
      
      // 计算底部安全距离：屏幕高度 - 安全区域底部
      const safeAreaBottom = windowInfo.safeArea
        ? windowInfo.screenHeight - windowInfo.safeArea.bottom
        : 0;
      
      /** 与底部自定义 tabBar 留白，避免主内容区贴边 */
      const contentBottomGap = 46;
      const contentHeight =
        windowHeight - finalHeaderHeight - safeAreaBottom - contentBottomGap;
      this.setData({
        contentHeight: Math.max(contentHeight, 400), // 最小高度 400px
      });
    });
  },

  async loadSlotPricesAndRender(venueIdOverride) {
    const venueId =
      venueIdOverride !== undefined ? venueIdOverride : this.data.selectedVenueId;

    this.slotPriceMap = {}; // { 'courtId-slotIndex': price }

    const selectedDate = this.data.selectedDate || this.getTodayDateStr();

    // 没有 venueId 时直接走旧逻辑（不可用/无价格）
    if (!venueId) {
      this.bookedSlotKeySet = new Set();
      this.coachHoldMeta = {};
      this.myCoachHoldIdSet = new Set();
      this.generateTimeSchedule();
      this.fetchBookedSlotsForDate(selectedDate).then((applied) => {
        if (applied) this.generateTimeSchedule();
      });
      return;
    }

    const app = getApp();
    const venue = app && app.globalData && app.globalData.selectedVenue;
    const courtList = venue && Array.isArray(venue.courtList) ? venue.courtList : [];

    // 优先使用 venue 文档里的 courtList[].priceList（与时段索引一一对应）
    if (courtList.length > 0) {
      const priceMap = {};
      courtList.forEach((court, cIdx) => {
        const courtId = cIdx + 1;
        const prices = court.priceList || [];
        prices.forEach((price, slotIndex) => {
          const normalizedPrice = typeof price === 'number' ? price : Number(price);
          if (Number.isFinite(normalizedPrice)) {
            priceMap[`${courtId}-${slotIndex}`] = normalizedPrice;
          }
        });
      });
      this.slotPriceMap = priceMap;
      this.setData({ priceLoading: false });
      this.bookedSlotKeySet = new Set();
      this.coachHoldMeta = {};
      this.myCoachHoldIdSet = new Set();
      this.generateTimeSchedule();
      this.fetchBookedSlotsForDate(selectedDate).then((applied) => {
        if (applied) this.generateTimeSchedule();
      });
      return;
    }

    // 兼容旧数据：仍从 court_slot_prices 集合读取
    const courtIds = [1, 2];
    this.setData({ priceLoading: true });
    try {
      const res = await getCourtSlotPrices({ venueId, courtIds });
      const priceMap = {};

      (res && res.data ? res.data : []).forEach((p) => {
        if (p == null) return;
        const courtId = p.courtId;
        const slotIndex = p.slotIndex;
        const price = p.price;
        if (courtId == null || slotIndex == null) return;

        const key = `${courtId}-${slotIndex}`;
        const normalizedPrice = typeof price === 'number' ? price : Number(price);
        if (Number.isFinite(normalizedPrice)) {
          priceMap[key] = normalizedPrice;
        }
      });

      this.slotPriceMap = priceMap;

    } catch (e) {
      console.error('加载 court_slot_prices 失败', e);
      wx.showToast({ title: '加载价格失败', icon: 'none' });
      this.slotPriceMap = {};
    } finally {
      this.setData({ priceLoading: false });
      this.bookedSlotKeySet = new Set();
      this.coachHoldMeta = {};
      this.myCoachHoldIdSet = new Set();
      this.generateTimeSchedule();
      this.fetchBookedSlotsForDate(selectedDate).then((applied) => {
        if (applied) this.generateTimeSchedule();
      });
    }
  },

  /**
   * 拉取某日已支付占用，写入 bookedSlotKeySet（整表替换为本次 keys）。
   * resolve(true) 表示本次结果已采纳，可再调 generateTimeSchedule；false 表示跳过（无场馆/过期/失败）。
   */
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
      listCoachHolds().catch(() => ({ result: { data: [] } })),
    ])
      .then(([bookedRes, holdsRes]) => {
        if (token !== this._bookedSlotsFetchToken) {
          return false;
        }
        const r = bookedRes && bookedRes.result ? bookedRes.result : {};
        const keys = Array.isArray(r.keys) ? r.keys : [];
        const keySet = new Set(keys);
        const coachHoldMeta = {
          ...(r.coachHoldMeta && typeof r.coachHoldMeta === 'object' && !Array.isArray(r.coachHoldMeta)
            ? r.coachHoldMeta
            : {}),
        };
        const rows =
          holdsRes && holdsRes.result && Array.isArray(holdsRes.result.data)
            ? holdsRes.result.data
            : [];
        const myHoldIdSet = new Set();
        rows.forEach((row) => {
          if (!row || row.status !== 'active') return;
          if (!venueIdLooseEqual(row.venueId, venueId)) return;
          if (normalizeOrderDateStr(row.orderDate) !== normDate) return;
          const cid = Number(row.courtId);
          const idx = Number(row.slotIndex);
          if (!Number.isFinite(cid) || !Number.isFinite(idx)) return;
          myHoldIdSet.add(String(row._id));
          keySet.add(`${cid}-${idx}`);
          const k = `${cid}-${idx}`;
          const cur = coachHoldMeta[k] || {};
          coachHoldMeta[k] = {
            holdId: String(row._id),
            capacityLabel:
              (row.capacityLabel && String(row.capacityLabel).trim()) ||
              cur.capacityLabel ||
              '教练占用',
            lessonType: row.lessonType,
            pairMode: row.pairMode,
            groupMode: row.groupMode,
          };
        });
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

  getSlotPrice(courtId, slotIndex) {
    if (!this.slotPriceMap) return null;
    const key = `${courtId}-${slotIndex}`;
    const price = this.slotPriceMap[key];
    if (price == null) return null;
    return Number(price);
  },

  /**
   * 解析某时段展示/结算价格：周六、周日使用 court.specialPrice；其余日期用 priceList（slotPriceMap）
   */
  resolveSlotPrice(courtId, slotIndex, selectedDate) {
    const app = getApp();
    const venue = app && app.globalData && app.globalData.selectedVenue;
    const courtList = venue && Array.isArray(venue.courtList) ? venue.courtList : [];
    const court = courtList[courtId - 1];

    if (court && isWeekendDateStr(selectedDate)) {
      const sp = court.specialPrice;
      if (sp != null && sp !== '') {
        const n = typeof sp === 'number' ? sp : Number(sp);
        if (Number.isFinite(n) && n >= 0) {
          return n;
        }
      }
    }
    return this.getSlotPrice(courtId, slotIndex);
  },
  
  // 生成最近两个月的日期列表
  generateDateList() {
    const dateList = [];
    const today = new Date();
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    
    // 获取今天的年月日，用于比较
    const todayYear = today.getFullYear();
    const todayMonth = today.getMonth();
    const todayDate = today.getDate();
    
    // 生成未来60天的日期
    for (let i = 0; i < 60; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() + i);
      
      const month = date.getMonth() + 1; // 月份（1-12）
      const day = date.getDate(); // 日期
      
      // 判断是否是今天
      const isToday = date.getFullYear() === todayYear && 
                      date.getMonth() === todayMonth && 
                      date.getDate() === todayDate;
      
      // 如果是今天，显示"今天"，否则显示星期几
      const weekday = isToday ? '今天' : weekdays[date.getDay()];
      
      // 格式化月份和日期，确保是两位数
      const monthStr = month < 10 ? `0${month}` : `${month}`;
      const dayStr = day < 10 ? `0${day}` : `${day}`;
      
      const dateStr = `${date.getFullYear()}-${monthStr}-${dayStr}`;
      
      dateList.push({
        weekday: weekday,
        monthDay: `${month}.${day}`, // 格式：3.6, 4.15
        date: date, // 保存完整日期对象，方便后续使用
        dateStr: dateStr, // 标准日期字符串
        isToday: isToday, // 标记是否是今天
      });
      
      // 如果是今天，设置为默认选中（不触发动画）
      if (isToday && !this.data.selectedDate) {
        this.setData({
          selectedDate: dateStr,
        });
      }
    }
    
    this.setData({
      dateList: dateList,
    });
  },
  
  // 处理日期点击事件（先切日期与格子，占用查询异步；波纹不等待网络）
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
  
  // 生成时间段和场地数据（可选传入日期，避免与 data 不同步）
  generateTimeSchedule(selectedDateOverride) {
    // 与 venue.courtList[].priceList 对齐：14 个时段，8:00–21:00 开始（至 22:00 结束）
    const timeSlots = [];
    for (let hour = 8; hour <= 21; hour++) {
      const hourStr = hour < 10 ? `0${hour}` : `${hour}`;
      timeSlots.push({
        time: `${hourStr}:00`,
        hour: hour,
      });
    }

    const selectedDate =
      selectedDateOverride != null
        ? selectedDateOverride
        : this.data.selectedDate || this.getTodayDateStr();

    const app = getApp();
    const venue = app && app.globalData && app.globalData.selectedVenue;
    const courtList = venue && Array.isArray(venue.courtList) ? venue.courtList : [];

    let courts;
    if (courtList.length > 0) {
      courts = courtList.map((c, idx) => ({
        id: idx + 1,
        name: c.name || `${idx + 1}号场`,
        slots: this.generateCourtSlots(timeSlots, selectedDate, idx + 1),
      }));
    } else {
      courts = [
        {
          id: 1,
          name: '1号场',
          slots: this.generateCourtSlots(timeSlots, selectedDate, 1),
        },
        {
          id: 2,
          name: '2号场',
          slots: this.generateCourtSlots(timeSlots, selectedDate, 2),
        },
      ];
    }

    this.setData({
      timeSlots: timeSlots,
      courts: courts,
    });
  },

  // 获取今日日期字符串
  getTodayDateStr() {
    const today = new Date();
    const month = today.getMonth() + 1;
    const day = today.getDate();
    return `${today.getFullYear()}-${month < 10 ? '0' + month : month}-${day < 10 ? '0' + day : day}`;
  },

  formatCoachSlotRange(startIndex, span) {
    const startH = 8 + startIndex;
    const endH = startH + span;
    const pad = (x) => (x < 10 ? `0${x}` : `${x}`);
    return `${pad(startH)}:00-${pad(endH)}:00`;
  },

  applyCoachHoldMergeAndLayout(slots, courtId) {
    const n = slots.length;
    const ROW = 128;
    const CELL = 120;
    const GAP = 8;
    const metaMap = this.coachHoldMeta || {};
    const mySet = this.myCoachHoldIdSet || new Set();

    for (let i = 0; i < n; i += 1) {
      slots[i].coachSpan = 1;
      slots[i].coachMergeSkip = false;
      slots[i].coachTimeRange = '';
      slots[i].coachHoldIdsStr = '';
      slots[i].canManageCoachHold = false;
      slots[i].prefillLessonType = 'experience';
      slots[i].prefillPairMode = '1v1';
      slots[i].prefillGroupMode = 'group35';
    }

    let i = 0;
    while (i < n) {
      const cur = slots[i];
      if (!cur.booked || !cur.bookedByCoach) {
        i += 1;
        continue;
      }
      const label = (cur.coachPurpose || '').trim();
      let span = 1;
      let j = i + 1;
      while (j < n) {
        const next = slots[j];
        if (!next.booked || !next.bookedByCoach) break;
        if ((next.coachPurpose || '').trim() !== label) break;
        span += 1;
        j += 1;
      }
      cur.coachSpan = span;
      cur.coachTimeRange = this.formatCoachSlotRange(i, span);
      const ids = [];
      for (let k = 0; k < span; k += 1) {
        const m = metaMap[`${courtId}-${i + k}`];
        if (m && m.holdId) ids.push(String(m.holdId));
      }
      cur.coachHoldIdsStr = ids.join(',');
      cur.canManageCoachHold = ids.some((id) => mySet.has(id));
      const m0 = metaMap[`${courtId}-${i}`] || {};
      cur.prefillLessonType = m0.lessonType || 'experience';
      cur.prefillPairMode = m0.pairMode || '1v1';
      cur.prefillGroupMode = m0.groupMode || 'group35';
      for (let k = i + 1; k < i + span; k += 1) {
        slots[k].coachMergeSkip = true;
      }
      i += span;
    }

    let cursor = 0;
    for (let idx = 0; idx < n; idx += 1) {
      if (slots[idx].coachMergeSkip) {
        slots[idx].slotStyle = '';
        continue;
      }
      const span = slots[idx].coachSpan || 1;
      const h = span * CELL + (span - 1) * GAP;
      slots[idx].slotStyle = `top:${cursor}rpx;height:${h}rpx;`;
      cursor += span * ROW;
    }
  },

  // 生成场地的可预订时间段：当前时间以前的不可用，以后的都可预订
  generateCourtSlots(timeSlots, selectedDate, courtId) {
    const slots = [];
    const now = new Date();
    const todayStr = this.getTodayDateStr();
    const metaMap = this.coachHoldMeta || {};
    const bookedSet = this.bookedSlotKeySet || new Set();

    for (let i = 0; i < timeSlots.length; i++) {
      const slotHour = timeSlots[i].hour;
      let isAvailableTime = false;

      if (selectedDate > todayStr) {
        isAvailableTime = true;
      } else if (selectedDate === todayStr) {
        const slotTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), slotHour, 0, 0);
        isAvailableTime = slotTime > now;
      }

      const slotPrice = this.resolveSlotPrice(courtId, i, selectedDate);
      const key = `${courtId}-${i}`;
      const isBookedByOrder = bookedSet.has(key);
      const coachMeta = metaMap[key];
      const bookedByCoach = !!(isBookedByOrder && coachMeta);
      const coachPurpose = bookedByCoach
        ? (coachMeta.capacityLabel || '教练占用')
        : '';

      const isAvailable =
        isAvailableTime && slotPrice != null && !isBookedByOrder;
      const past = !isAvailableTime;

      slots.push({
        available: isAvailable,
        price: isAvailable ? slotPrice : null,
        booked: isBookedByOrder,
        bookedByCoach,
        coachPurpose,
        past,
        coachSpan: 1,
        coachMergeSkip: false,
        slotStyle: '',
        coachTimeRange: '',
        coachHoldIdsStr: '',
        canManageCoachHold: false,
        prefillLessonType: 'experience',
        prefillPairMode: '1v1',
        prefillGroupMode: 'group35',
      });
    }

    this.applyCoachHoldMergeAndLayout(slots, courtId);
    return slots;
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
    const mySet = this.myCoachHoldIdSet || new Set();
    const myIds = holdids
      .split(',')
      .map((s) => s.trim())
      .filter((id) => mySet.has(id));
    if (myIds.length === 0) {
      wx.showToast({ title: '无权限操作该占用', icon: 'none' });
      return;
    }
    wx.showActionSheet({
      itemList: ['更改场地类型', '取消预订'],
      success: (res) => {
        if (res.tapIndex === 0) {
          this.setData({
            showPurposeSheet: true,
            purposeSheetMode: 'edit',
            editingHoldIds: myIds,
            lessonType: ds.lessontype || 'experience',
            pairMode: ds.pairmode || '1v1',
            groupMode: ds.groupmode || 'group35',
          });
        } else if (res.tapIndex === 1) {
          this.confirmCancelCoachHolds(myIds.join(','));
        }
      },
    });
  },

  confirmCancelCoachHolds(holdidsStr) {
    const mySet = this.myCoachHoldIdSet || new Set();
    const ids = String(holdidsStr || '')
      .split(',')
      .map((s) => s.trim())
      .filter((id) => mySet.has(id));
    if (ids.length === 0) {
      wx.showToast({ title: '无可用占用记录', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '取消预订',
      content: '确定取消该时段占用？连续占用的时段将一并取消。',
      confirmText: '取消占用',
      confirmColor: '#c62828',
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '处理中...' });
        try {
          for (let i = 0; i < ids.length; i += 1) {
            const cloudRes = await cancelCoachHold({ holdId: ids[i] });
            const r = (cloudRes && cloudRes.result) || {};
            if (!r.ok) {
              wx.hideLoading();
              wx.showToast({ title: r.errMsg || '取消失败', icon: 'none' });
              return;
            }
          }
          wx.hideLoading();
          wx.showToast({ title: '已取消占用', icon: 'success' });
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
    wx.showLoading({ title: '保存中...' });
    try {
      const cloudRes = await updateCoachHolds({
        holdIds: ids,
        lessonType,
        pairMode,
        groupMode,
      });
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

  // 切换日期：先按「无占用」立即刷新格子，再异步合并 getBookedSlots 结果
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
  
  // 处理时间段点击事件
  handleSlotClick(e) {
    const { courtid, slotindex } = e.currentTarget.dataset;
    if (!courtid || slotindex === undefined) return;
    
    const courtId = parseInt(courtid);
    const slotIndex = parseInt(slotindex);
    
    // 检查该时间段是否可选
    const court = this.data.courts.find(c => c.id === courtId);
    if (!court || !court.slots[slotIndex] || !court.slots[slotIndex].available) {
      return;
    }
    
    // 清除之前的定时器
    if (this.slotRippleTimer) {
      clearTimeout(this.slotRippleTimer);
      this.slotRippleTimer = null;
    }
    
    // 检查是否已选中
    const slotKey = `${courtId}-${slotIndex}`;
    const isSelected = this.data.selectedSlots.some(
      s => s.courtId === courtId && s.slotIndex === slotIndex
    );
    
    // 切换选中状态
    let newSelectedSlots = [...this.data.selectedSlots];
    let newSelectedSlotsMap = { ...this.data.selectedSlotsMap };
    
    if (isSelected) {
      newSelectedSlots = newSelectedSlots.filter(
        s => !(s.courtId === courtId && s.slotIndex === slotIndex)
      );
      delete newSelectedSlotsMap[`${courtId}-${slotIndex}`];
    } else {
      newSelectedSlots.push({ courtId, slotIndex });
      newSelectedSlotsMap[`${courtId}-${slotIndex}`] = true;
    }
    
    // 合并 setData，减少渲染次数
    // 计算总价
    const totalPrice = this.calculateTotalPrice(newSelectedSlots);
    
    // 先清除旧的波纹状态，确保动画能重新触发
    this.setData({
      selectedSlots: newSelectedSlots,
      selectedSlotsMap: newSelectedSlotsMap,
      totalPrice: totalPrice,
      rippleSlot: null,
    }, () => {
      // 在 setData 回调中触发动画，确保 DOM 已更新
      // 使用 requestAnimationFrame 优化动画时机
      if (typeof requestAnimationFrame !== 'undefined') {
        requestAnimationFrame(() => {
          this.setData({
            rippleSlot: { courtId, slotIndex }, // 触发波纹动画
          });
          
          // 动画结束后清除波纹状态
          this.slotRippleTimer = setTimeout(() => {
            this.setData({
              rippleSlot: null,
            });
            this.slotRippleTimer = null;
          }, 600); // 动画持续时间
        });
      } else {
        // 兼容性处理
        setTimeout(() => {
          this.setData({
            rippleSlot: { courtId, slotIndex }, // 触发波纹动画
          });
          
          // 动画结束后清除波纹状态
          this.slotRippleTimer = setTimeout(() => {
            this.setData({
              rippleSlot: null,
            });
            this.slotRippleTimer = null;
          }, 600); // 动画持续时间
        }, 16); // 约一帧的时间
      }
    });
  },
  
  // 计算总价
  calculateTotalPrice(selectedSlots) {
    if (!selectedSlots || selectedSlots.length === 0) {
      return 0;
    }
    
    let total = 0;
    selectedSlots.forEach(slot => {
      const court = this.data.courts.find(c => c.id === slot.courtId);
      if (court && court.slots[slot.slotIndex] && court.slots[slot.slotIndex].available) {
        total += court.slots[slot.slotIndex].price || 0;
      }
    });
    
    return total;
  },
  
  /** 选完时段后打开用途表单 */
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
    this.setData({
      showPurposeSheet: true,
      purposeSheetMode: 'create',
      editingHoldIds: [],
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
    this.setData({ lessonType: v });
  },

  selectPairMode(e) {
    const { v } = e.currentTarget.dataset;
    if (!v) return;
    this.setData({ pairMode: v });
  },

  selectGroupMode(e) {
    const { v } = e.currentTarget.dataset;
    if (!v) return;
    this.setData({ groupMode: v });
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
    const venueName = (venue && venue.name) ? String(venue.name).trim() : '';

    try {
      const cloudRes = await coachHoldSlots({
        venueId: selectedVenueId,
        venueName,
        orderDate: selectedDate,
        slots: selectedSlots,
        lessonType,
        pairMode,
        groupMode,
      });
      const r = (cloudRes && cloudRes.result) || {};
      wx.hideLoading();
      if (!r.ok) {
        wx.showToast({
          title: r.errMsg || '占用失败',
          icon: 'none',
        });
        return;
      }
      /** 本次占用的格子键；避免 loadSlotPricesAndRender 先清空 bookedSlotKeySet 导致格子仍显示可选 */
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
