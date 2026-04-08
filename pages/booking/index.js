const { getBookedSlots, refreshSelectedVenueFromCloud, getUserByPhone } = require('../../api/tennisDb');
const { getTodayDateStr, buildBookingDateList } = require('../../utils/bookingDate');
const {
  buildSlotPriceMapFromCourtList,
  resolveCourtSlotPrice,
} = require('../../utils/bookingSlotPrice');
const { buildBookingTimeSlots } = require('../../utils/bookingTimeSlots');
const {
  computeBookingMainContentHeightPx,
  estimateBookingHeaderHeightPx,
} = require('../../utils/bookingLayout');
const lottie = require('lottie-miniprogram');
const loadingAnimationData = require('../../assets/images/loading.js');

function normalizeDateForWatch(raw) {
  const s = String(raw || '').trim();
  const parts = s.split('-');
  if (parts.length !== 3) return s;
  const y = parseInt(parts[0], 10);
  const mo = parseInt(parts[1], 10);
  const d = parseInt(parts[2], 10);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return s;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** 云库 watch 依赖 WebSocket；开发者工具/弱网下常报 -402002，属环境问题非业务逻辑错误 */
function isRealtimeWatchTransportError(err) {
  if (!err) return false;
  const code = err.errCode !== undefined ? err.errCode : err.code;
  const msg = String(err.errMsg || err.message || err || '');
  if (code === -402002) return true;
  return /ws connection|login fail|invalid state|init watch fail|realtime listener/i.test(msg);
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
    selectedVenueId: '', // 当前选定的球场 id
    priceLoading: false, // 加载价格规则状态
    isVipUser: false, // db_user.isVip，用于 VIP 时段价与周末价规则
  },
  
  // 动画定时器
  rippleTimer: null,
  slotRippleTimer: null,
  /** 已支付订单占用的格子键 Set，元素为 `${courtId}-${slotIndex}` */
  bookedSlotKeySet: null,
  /** 每次发起 getBookedSlots 自增，用于丢弃过期响应 */
  _bookedSlotsFetchToken: 0,
  /** 订场实时信号 watch 句柄 */
  bookingSignalWatcher: null,
  /** 当前 watch 绑定 key：venueId__date */
  _bookingSignalWatchKey: '',
  /** 实时刷新防抖定时器 */
  _realtimeRefreshTimer: null,
  /** watch 重连定时器 */
  _realtimeReconnectTimer: null,
  /** onError 里 setTimeout(0) 延迟清理的 id，须在 onHide/onUnload 清除 */
  _watchErrorDeferTimer: null,
  /** 仅随 onHide/onUnload 递增，用于丢弃离开页面后的 watch 异步回调 */
  _watchSessionGen: 0,
  /** loading lottie 动画实例 */
  loadingAnimation: null,
  /** loading 并发计数，避免多个请求互相提前关闭 */
  _loadingTaskCount: 0,
  /** 首次进入页面：是否已执行过首轮数据加载 */
  _initialLoadFinished: false,
  /** 是否正在跳转到选场页，避免重复触发 */
  _navigatingToLocation: false,
  /** watch 连续失败次数，用于重连退避 */
  _realtimeWatchFailCount: 0,
  /** 是否已输出过「watch 不可用」提示，避免刷屏 */
  _realtimeWatchLoggedNoise: false,
  /** watch 不可用时轮询已订格子的定时器 */
  _bookingSlotsPollTimer: null,

  /** 标题：去选场页，选完后返回本页 */
  handleContentHeaderTitleTap() {
    wx.navigateTo({
      url: '/pages/location/index?from=booking',
    });
  },

  onLoad() {
    this._bookingIsVipUser = false;
    this.coachHoldMeta = {};
    this.syncSelectedVenueName();
    this.ensureVenueSelected();
    // 生成最近两个月的日期列表
    this.generateDateList();
    // 先渲染页面骨架，避免首次进入时白屏等待
    this.generateTimeSchedule();
  },

  onShow() {
    if (!this.ensureVenueSelected()) {
      return;
    }
    if (!this._initialLoadFinished) {
      return;
    }
    const newVenueId = this.syncSelectedVenueName();
    /** 仅 id/名变时 sync 才非空；改价后二者不变也需重拉 courtList */
    const venueIdToReload =
      newVenueId != null && String(newVenueId).trim() !== ''
        ? newVenueId
        : this.data.selectedVenueId;
    if (venueIdToReload) {
      this.loadSlotPricesAndRender(venueIdToReload);
    }
    this._realtimeWatchFailCount = 0;
    this._realtimeWatchLoggedNoise = false;
    this.restartRealtimeWatch();
    this.refreshBookedSlotsNow({ showLoading: true });
    // 检查是否需要清空数据（下单成功后返回）
    const app = getApp();
    if (app && app.globalData && app.globalData.shouldClearBookingData) {
      this.clearBookingData();
      app.globalData.shouldClearBookingData = false;
    }
  },

  onHide() {
    this._watchSessionGen = (this._watchSessionGen || 0) + 1;
    if (this._watchErrorDeferTimer) {
      clearTimeout(this._watchErrorDeferTimer);
      this._watchErrorDeferTimer = null;
    }
    if (this._realtimeReconnectTimer) {
      clearTimeout(this._realtimeReconnectTimer);
      this._realtimeReconnectTimer = null;
    }
    this.stopBookedSlotsPollFallback();
    this.stopRealtimeWatch();
  },

  onUnload() {
    this._watchSessionGen = (this._watchSessionGen || 0) + 1;
    if (this._watchErrorDeferTimer) {
      clearTimeout(this._watchErrorDeferTimer);
      this._watchErrorDeferTimer = null;
    }
    this.stopBookedSlotsPollFallback();
    this.stopRealtimeWatch();
    this.destroyLoadingAnimation();
    if (this._realtimeRefreshTimer) {
      clearTimeout(this._realtimeRefreshTimer);
      this._realtimeRefreshTimer = null;
    }
    if (this._realtimeReconnectTimer) {
      clearTimeout(this._realtimeReconnectTimer);
      this._realtimeReconnectTimer = null;
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

  /**
   * 未选择场地时，优先引导至选场页（扫码进预订页时也生效）。
   * 返回 true 表示已有场地，false 表示已触发跳转。
   */
  ensureVenueSelected() {
    const app = getApp();
    const venue = app && app.globalData ? app.globalData.selectedVenue : null;
    const venueId = venue && venue.id ? String(venue.id).trim() : '';
    if (venueId) return true;

    if (this._navigatingToLocation) return false;
    this._navigatingToLocation = true;
    wx.navigateTo({
      url: '/pages/location/index?from=booking',
      complete: () => {
        this._navigatingToLocation = false;
      },
    });
    return false;
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
    this.initLoadingAnimation();
    this._initialLoadFinished = true;
    // 首次进入：页面先渲染，再进行异步加载并显示 loading
    this.loadSlotPricesAndRender();
  },
  
  calculateContentHeight() {
    const windowInfo = wx.getWindowInfo();
    const app = getApp();
    const screenInfo = app && app.globalData && app.globalData.screenInfo;

    const query = wx.createSelectorQuery();
    query.select('.header').boundingClientRect();
    query.select('.tab-bar').boundingClientRect();
    query.exec((res) => {
      const headerRect = res[0];
      const tabBarRect = res[1];

      const finalHeaderHeight = estimateBookingHeaderHeightPx(
        headerRect ? headerRect.height : 0,
        screenInfo
      );
      const tabBarHeight = tabBarRect ? tabBarRect.height : 60;

      const safeAreaBottom = windowInfo.safeArea
        ? windowInfo.screenHeight - windowInfo.safeArea.bottom
        : 0;

      const contentHeight = computeBookingMainContentHeightPx({
        windowHeight: windowInfo.windowHeight,
        finalHeaderHeight,
        safeAreaBottom,
        tabBarHeight,
      });
      this.setData({ contentHeight });
    });
  },

  loadSlotPricesAndRender(venueIdOverride) {
    this.beginLoading();
    refreshSelectedVenueFromCloud()
      .then(() => {
        this.syncSelectedVenueName();
        this.loadSlotPricesAndRenderCore(venueIdOverride);
      })
      .catch(() => {
        this.loadSlotPricesAndRenderCore(venueIdOverride);
      });
  },

  async loadSlotPricesAndRenderCore(venueIdOverride) {
    const venueId =
      venueIdOverride !== undefined ? venueIdOverride : this.data.selectedVenueId;

    this.slotPriceMap = {}; // { 'courtId-slotIndex': price }

    const selectedDate = this.data.selectedDate || getTodayDateStr();

    let isVipUser = false;
    const phone = String(wx.getStorageSync('user_phone') || '').trim();
    if (phone) {
      try {
        const res = await getUserByPhone(phone);
        const user = res && res.data && res.data[0];
        isVipUser = !!(user && user.isVip);
      } catch (e) {
        console.warn('getUserByPhone booking', e);
      }
    }
    this._bookingIsVipUser = isVipUser;
    this.setData({ isVipUser });

    const afterFetchBooked = () => {
      this.fetchBookedSlotsForDate(selectedDate).then((applied) => {
        if (applied) this.generateTimeSchedule();
        this.restartRealtimeWatch();
        this.endLoading();
      }).catch(() => {
        this.endLoading();
      });
    };

    // 没有 venueId 时直接走旧逻辑（不可用/无价格）
    if (!venueId) {
      this.bookedSlotKeySet = new Set();
      this.coachHoldMeta = {};
      this.generateTimeSchedule();
      afterFetchBooked();
      return;
    }

    const app = getApp();
    const venue = app && app.globalData && app.globalData.selectedVenue;
    const courtList = venue && Array.isArray(venue.courtList) ? venue.courtList : [];

    // 优先使用 venue 文档里的 courtList（VIP 用户用 vipPriceList 建图）
    if (courtList.length > 0) {
      this.slotPriceMap = buildSlotPriceMapFromCourtList(courtList, {
        useVipPrices: isVipUser,
      });
      this.bookedSlotKeySet = new Set();
      this.coachHoldMeta = {};
      this.generateTimeSchedule();
      afterFetchBooked();
      return;
    }

    // 无 courtList / priceList 时无法在客户端展示单价
    this.slotPriceMap = {};
    wx.showToast({ title: '场馆未配置场地价格', icon: 'none' });
    this.bookedSlotKeySet = new Set();
    this.coachHoldMeta = {};
    this.generateTimeSchedule();
    afterFetchBooked();
  },

  beginLoading() {
    this._loadingTaskCount = (this._loadingTaskCount || 0) + 1;
    if (this._loadingTaskCount === 1) {
      this.setPriceLoading(true);
    }
  },

  endLoading() {
    this._loadingTaskCount = Math.max(0, (this._loadingTaskCount || 0) - 1);
    if (this._loadingTaskCount === 0) {
      this.setPriceLoading(false);
    }
  },

  setPriceLoading(flag) {
    const next = !!flag;
    if (this.data.priceLoading === next) return;
    this.setData({ priceLoading: next }, () => {
      this.updateLoadingAnimation(next);
    });
  },

  initLoadingAnimation() {
    const query = wx.createSelectorQuery().in(this);
    query
      .select('#booking-loading-canvas')
      .node()
      .exec((res) => {
        const canvasNode = res && res[0] ? res[0].node : null;
        if (!canvasNode) return;

        const dpr = (wx.getWindowInfo && wx.getWindowInfo().pixelRatio)
          || wx.getSystemInfoSync().pixelRatio
          || 1;
        const sizePx = 210;
        canvasNode.width = sizePx * dpr;
        canvasNode.height = sizePx * dpr;

        const ctx = canvasNode.getContext('2d');
        if (!ctx) return;
        ctx.scale(dpr, dpr);

        this.loadingAnimation = lottie.loadAnimation({
          renderer: 'canvas',
          loop: true,
          autoplay: false,
          animationData: loadingAnimationData,
          rendererSettings: {
            context: ctx,
            clearCanvas: true,
          },
        });

        this.updateLoadingAnimation(this.data.priceLoading);
      });
  },

  updateLoadingAnimation(isLoading) {
    if (!this.loadingAnimation) return;
    if (isLoading) {
      this.loadingAnimation.play();
    } else {
      this.loadingAnimation.stop();
    }
  },

  destroyLoadingAnimation() {
    if (!this.loadingAnimation) return;
    try {
      this.loadingAnimation.destroy();
    } catch (e) {
      console.warn('destroy loading animation failed', e);
    }
    this.loadingAnimation = null;
  },

  ensureBookedSlotsPollFallback() {
    if (this._bookingSlotsPollTimer) return;
    const tick = () => {
      this.refreshBookedSlotsNow({ showLoading: false });
    };
    this._bookingSlotsPollTimer = setInterval(tick, 30000);
  },

  stopBookedSlotsPollFallback() {
    if (this._bookingSlotsPollTimer) {
      clearInterval(this._bookingSlotsPollTimer);
      this._bookingSlotsPollTimer = null;
    }
  },

  restartRealtimeWatch() {
    const venueId = this.data.selectedVenueId;
    const selectedDate = this.data.selectedDate || getTodayDateStr();
    if (!venueId || !selectedDate || !wx.cloud || !wx.cloud.database) {
      this.stopRealtimeWatch();
      return;
    }
    const watchKey = `${String(venueId)}__${selectedDate}`;
    if (watchKey === this._bookingSignalWatchKey && this.bookingSignalWatcher) {
      return;
    }

    this.stopRealtimeWatch();
    this._bookingSignalWatchKey = watchKey;
    const sessionAtWatch = this._watchSessionGen;
    const db = wx.cloud.database();
    const venueIdNorm = String(venueId).trim();
    const dateNorm = normalizeDateForWatch(selectedDate);

    const watcher = db
      .collection('db_booking_realtime_signal')
      .where({
        venueId: venueIdNorm,
        orderDate: dateNorm,
      })
      .watch({
        onChange: () => {
          this._realtimeWatchFailCount = 0;
          this.stopBookedSlotsPollFallback();
          this.handleRealtimeSignalChange();
        },
        onError: (err) => {
          const transport = isRealtimeWatchTransportError(err);
          if (transport) {
            if (!this._realtimeWatchLoggedNoise) {
              this._realtimeWatchLoggedNoise = true;
              console.warn(
                '[预订] 实时监听暂不可用（多为开发者工具/网络导致 WebSocket 未就绪），已改为定时拉取已订场次；真机一般可正常监听。',
                err && err.errMsg ? err.errMsg : err,
              );
            }
            this.ensureBookedSlotsPollFallback();
          } else {
            console.error('booking realtime watch error', err);
          }
          this._realtimeWatchFailCount = (this._realtimeWatchFailCount || 0) + 1;
          const baseMs = transport ? 5000 : 1500;
          const reconnectMs = Math.min(
            60000,
            Math.round(baseMs * Math.pow(1.35, Math.min(this._realtimeWatchFailCount - 1, 14))),
          );
          if (this._realtimeReconnectTimer) {
            clearTimeout(this._realtimeReconnectTimer);
            this._realtimeReconnectTimer = null;
          }
          // 勿在 onError 同步栈内立刻 close：易与 SDK 内部 initWatchFail 状态机冲突，报
          // "current state (CLOSED) does not accept initWatchFail"
          if (this._watchErrorDeferTimer) {
            clearTimeout(this._watchErrorDeferTimer);
          }
          this._watchErrorDeferTimer = setTimeout(() => {
            this._watchErrorDeferTimer = null;
            if (sessionAtWatch !== this._watchSessionGen) return;
            if (this.bookingSignalWatcher != null && this.bookingSignalWatcher !== watcher) {
              return;
            }
            this.stopRealtimeWatch();
            this._realtimeReconnectTimer = setTimeout(() => {
              this._realtimeReconnectTimer = null;
              if (sessionAtWatch !== this._watchSessionGen) return;
              this.restartRealtimeWatch();
            }, reconnectMs);
          }, 0);
        },
      });
    this.bookingSignalWatcher = watcher;
  },

  stopRealtimeWatch() {
    const w = this.bookingSignalWatcher;
    this.bookingSignalWatcher = null;
    this._bookingSignalWatchKey = '';
    if (w && typeof w.close === 'function') {
      try {
        w.close();
      } catch (e) {
        // 已关闭或 SDK 内部已 teardown 时再 close 会抛错，忽略即可
      }
    }
  },

  handleRealtimeSignalChange() {
    if (this._realtimeRefreshTimer) {
      clearTimeout(this._realtimeRefreshTimer);
      this._realtimeRefreshTimer = null;
    }
    this._realtimeRefreshTimer = setTimeout(() => {
      this._realtimeRefreshTimer = null;
      this.refreshBookedSlotsNow();
    }, 200);
  },

  refreshBookedSlotsNow(options) {
    const showLoading = !!(options && options.showLoading);
    if (showLoading) this.beginLoading();
    const selectedDate = this.data.selectedDate || getTodayDateStr();
    this.fetchBookedSlotsForDate(selectedDate).then((applied) => {
      if (!applied) return;
      this.generateTimeSchedule(selectedDate);
      this.reconcileSelectedSlotsAfterRealtime();
    }).finally(() => {
      if (showLoading) this.endLoading();
    });
  },

  reconcileSelectedSlotsAfterRealtime() {
    const selected = Array.isArray(this.data.selectedSlots) ? this.data.selectedSlots : [];
    if (selected.length === 0) return;

    const selectedSlots = [];
    const selectedSlotsMap = {};
    selected.forEach((s) => {
      const court = this.data.courts.find((c) => c.id === s.courtId);
      const slot = court && court.slots ? court.slots[s.slotIndex] : null;
      if (slot && slot.available) {
        selectedSlots.push({ courtId: s.courtId, slotIndex: s.slotIndex });
        selectedSlotsMap[`${s.courtId}-${s.slotIndex}`] = true;
      }
    });
    if (selectedSlots.length === selected.length) return;

    this.setData({
      selectedSlots,
      selectedSlotsMap,
      totalPrice: this.calculateTotalPrice(selectedSlots),
    });
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
    return getBookedSlots({ venueId, orderDate })
      .then((res) => {
        if (token !== this._bookedSlotsFetchToken) {
          return false;
        }
        const r = res && res.result ? res.result : {};
        const keys = Array.isArray(r.keys) ? r.keys : [];
        const coachHoldMeta =
          r.coachHoldMeta && typeof r.coachHoldMeta === 'object' && !Array.isArray(r.coachHoldMeta)
            ? r.coachHoldMeta
            : {};
        this.bookedSlotKeySet = new Set(keys);
        this.coachHoldMeta = coachHoldMeta;
        return true;
      })
      .catch((e) => {
        console.error('getBookedSlots failed', e);
        return false;
      });
  },

  resolveSlotPrice(courtId, slotIndex, selectedDate) {
    const app = getApp();
    const venue = app && app.globalData && app.globalData.selectedVenue;
    const courtList = venue && Array.isArray(venue.courtList) ? venue.courtList : [];
    const isVipUser = this._bookingIsVipUser != null ? !!this._bookingIsVipUser : !!this.data.isVipUser;
    return resolveCourtSlotPrice(
      courtList,
      courtId,
      slotIndex,
      selectedDate,
      this.slotPriceMap,
      { isVipUser }
    );
  },
  
  generateDateList() {
    const { dateList, defaultSelectedDate } = buildBookingDateList(60, this.data.selectedDate);
    const patch = { dateList };
    if (!this.data.selectedDate && defaultSelectedDate) {
      patch.selectedDate = defaultSelectedDate;
    }
    this.setData(patch);
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
    const timeSlots = buildBookingTimeSlots();

    const selectedDate =
      selectedDateOverride != null
        ? selectedDateOverride
        : this.data.selectedDate || getTodayDateStr();

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

  /** slotIndex 从 0 对应 8:00，span 为连续小时数 */
  formatCoachSlotRange(startIndex, span) {
    const startH = 8 + startIndex;
    const endH = startH + span;
    const pad = (x) => (x < 10 ? `0${x}` : `${x}`);
    return `${pad(startH)}:00-${pad(endH)}:00`;
  },

  /**
   * 教练占用且用途文案一致时合并连续格；全列绝对定位与左侧时间列对齐。
   * 行高单元 ROW=128rpx（120+8），格内高 CELL=120rpx，缝 GAP=8rpx。
   */
  applyCoachHoldMergeAndLayout(slots, courtId) {
    const n = slots.length;
    const ROW = 126;
    const CELL = 120;
    const GAP = 8;

    for (let i = 0; i < n; i += 1) {
      slots[i].coachSpan = 1;
      slots[i].coachMergeSkip = false;
      slots[i].coachTimeRange = '';
      slots[i].coachHoldIdsStr = '';
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
      const metaMap = this.coachHoldMeta || {};
      for (let k = 0; k < span; k += 1) {
        const m = metaMap[`${courtId}-${i + k}`];
        if (m && m.holdId) ids.push(String(m.holdId));
      }
      cur.coachHoldIdsStr = ids.join(',');
      const m0 = metaMap[`${courtId}-${i}`] || {};
      cur.prefillLessonType = m0.lessonType || 'experience';
      cur.prefillPairMode = m0.pairMode || '1v1';
      cur.prefillGroupMode = m0.groupMode || '';
      cur.prefillCoachName = m0.coachName != null && String(m0.coachName).trim() !== ''
        ? String(m0.coachName).trim()
        : cur.prefillCoachName || '';
      cur.coachJoinedCount = m0.joinedCount != null ? Number(m0.joinedCount) : 0;
      cur.coachCapacityLimit = m0.capacityLimit != null ? Number(m0.capacityLimit) : 1;
      cur.coachMinParticipants =
        m0.minParticipants != null && Number.isFinite(Number(m0.minParticipants))
          ? Number(m0.minParticipants)
          : null;
      cur.coachSessionFull = !!m0.sessionFull;
      cur.coachViewerAlreadyJoined = !!m0.viewerAlreadyJoined;
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
    const todayStr = getTodayDateStr();
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
      const coachName = bookedByCoach && coachMeta.coachName ? String(coachMeta.coachName).trim() : '';

      const isAvailable =
        isAvailableTime && slotPrice != null && !isBookedByOrder;
      const past = !isAvailableTime;

      slots.push({
        available: isAvailable,
        price: isAvailable ? slotPrice : null,
        venueSlotPrice: slotPrice,
        booked: isBookedByOrder,
        bookedByCoach,
        coachPurpose,
        past,
        coachSpan: 1,
        coachMergeSkip: false,
        slotStyle: '',
        coachTimeRange: '',
        coachHoldIdsStr: '',
        prefillLessonType: 'experience',
        prefillPairMode: '1v1',
        prefillGroupMode: '',
        prefillCoachName: coachName,
        coachJoinedCount: 0,
        coachCapacityLimit: 1,
        coachMinParticipants: null,
        coachSessionFull: false,
        coachViewerAlreadyJoined: false,
      });
    }

    this.applyCoachHoldMergeAndLayout(slots, courtId);
    return slots;
  },

  /** 教练占用格：跳转订单页，可选课时抵扣或微信支付 */
  handleCoachHoldCellTap(e) {
    const ds = e.currentTarget.dataset || {};
    const holdIdsStr = ds.holdids || '';
    const courtId = parseInt(ds.courtid, 10);
    const startIndex = parseInt(ds.slotindex, 10);
    const span = parseInt(ds.span, 10) || 1;
    if (!Number.isFinite(courtId) || !Number.isFinite(startIndex)) {
      wx.showToast({ title: '参数异常', icon: 'none' });
      return;
    }
    const holdIds = holdIdsStr
      ? holdIdsStr
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    const bookedSlots = [];
    for (let k = 0; k < span; k += 1) {
      bookedSlots.push({ courtId, slotIndex: startIndex + k });
    }
    const coachPayload = {
      holdIds,
      bookedSlots,
      lessonType: ds.lessontype || 'experience',
      pairMode: ds.pairmode || '1v1',
      groupMode: ds.groupmode || '',
      capacityLabel: ds.purpose || '',
      coachName: ds.coachname != null ? String(ds.coachname).trim() : '',
    };
    const coachPayloadEnc = encodeURIComponent(JSON.stringify(coachPayload));
    const selectedDate = encodeURIComponent(this.data.selectedDate || '');
    const courtsEnc = encodeURIComponent(JSON.stringify(this.data.courts || []));
    const venueId = encodeURIComponent(this.data.selectedVenueId || '');
    const slotPast =
      ds.slotpast === 1 || ds.slotpast === '1' || ds.slotpast === true || ds.slotpast === 'true'
        ? '1'
        : '0';
    wx.navigateTo({
      url: `/pages/coach-session-detail/index?coachPayload=${coachPayloadEnc}&selectedDate=${selectedDate}&courts=${courtsEnc}&venueId=${venueId}&slotPast=${slotPast}`,
    });
  },

  // 切换日期：先按「无占用」立即刷新格子，再异步合并 getBookedSlots 结果
  updateSlotsAvailability(selectedDate) {
    this.beginLoading();
    this.bookedSlotKeySet = new Set();
    this.coachHoldMeta = {};
    this.generateTimeSchedule(selectedDate);
    this.setData({
      selectedDate,
      selectedSlots: [],
      selectedSlotsMap: {},
      totalPrice: 0,
    });
    this.fetchBookedSlotsForDate(selectedDate).then((applied) => {
      if (applied) this.generateTimeSchedule(selectedDate);
      this.restartRealtimeWatch();
      this.endLoading();
    }).catch(() => {
      this.endLoading();
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
  
  // 处理确认预订
  handleConfirmBooking() {
    if (this.data.selectedSlots.length === 0) {
      wx.showToast({
        title: '请选择时间段',
        icon: 'none',
      });
      return;
    }
    
    // 跳转到订单详情页
    const selectedSlots = encodeURIComponent(JSON.stringify(this.data.selectedSlots));
    const selectedDate = encodeURIComponent(this.data.selectedDate);
    const courts = encodeURIComponent(JSON.stringify(this.data.courts));
    const venueId = encodeURIComponent(this.data.selectedVenueId || '');
    
    wx.navigateTo({
      url: `/pages/order-detail/index?selectedSlots=${selectedSlots}&selectedDate=${selectedDate}&courts=${courts}&venueId=${venueId}`,
    });
  },
});
