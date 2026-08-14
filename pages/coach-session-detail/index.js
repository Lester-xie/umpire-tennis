const {
  getBookedSlots,
  getMyBookings,
  cancelMemberBooking,
  refreshSelectedVenueFromCloud,
  getUserByPhone,
  decryptPhoneNumber,
  DEFAULT_USER_AVATAR,
} = require('../../api/tennisDb');
const { hasExperienceCoachParticipation } = require('../../utils/experienceParticipation');
const { getTodayDateStr } = require('../../utils/bookingDate');
const { preventTouchMove } = require('../../utils/preventTouchMove');
const { buildLessonKey } = require('../../utils/lessonKey');

const STORAGE_KEYS = {
  userPhoneCode: 'user_phone_code',
  userPhone: 'user_phone',
  userNickname: 'user_nickname',
  userAvatar: 'user_avatar',
};

function isExperienceLessonType(lt) {
  return String(lt || '').trim().toLowerCase() === 'experience';
}

function lessonTypeShareLabel(lt) {
  const s = String(lt || '').trim();
  if (s === 'regular') return '正课';
  if (s === 'group') return '团课';
  if (s === 'open_play') return '畅打';
  return '体验课';
}

function sessionKeyFromHoldIds(ids) {
  return [...(ids || [])]
    .map((id) => String(id || '').trim())
    .filter(Boolean)
    .sort()
    .join('|');
}

/** 与云函数一致：便于订单日期、场馆 id 与 db 中写法不一致时仍能匹配 */
function normalizeOrderDateLocal(raw) {
  const s = String(raw || '').trim();
  const parts = s.split(/[-/]/);
  if (parts.length >= 3) {
    const y = parseInt(parts[0], 10);
    const mo = parseInt(parts[1], 10);
    const d = parseInt(parts[2], 10);
    if (Number.isFinite(y) && Number.isFinite(mo) && Number.isFinite(d)) {
      return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }
  return s;
}

function venueIdLooseEqual(a, b) {
  const sa = a == null ? '' : String(a).trim();
  const sb = b == null ? '' : String(b).trim();
  if (sa === sb) return true;
  const na = Number(sa);
  const nb = Number(sb);
  return Number.isFinite(na) && Number.isFinite(nb) && na === nb;
}

/** 场次格点指纹（与占用 id 无关，支付后占用可能释放重建，holdIds 会变） */
function sessionKeyFromBookedSlots(slots) {
  return [...(slots || [])]
    .map((s) => `${Number(s.courtId)}-${Number(s.slotIndex)}`)
    .filter((k) => /^\d+-\d+$/.test(k))
    .sort()
    .join('|');
}

function parseBookedSlotsParam(raw) {
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
}

function encodeBookedSlotsParam(slots) {
  return [...(slots || [])]
    .map((s) => `${Number(s.courtId)}-${Number(s.slotIndex)}`)
    .filter((k) => /^\d+-\d+$/.test(k))
    .join(',');
}

/** 分享用短链：不传 courts，避免超长 */
function buildSessionSharePath({ venueId, orderDate, bookedSlots, lessonType, pairMode, groupMode }) {
  const v = encodeURIComponent(String(venueId || '').trim());
  const d = encodeURIComponent(normalizeOrderDateLocal(orderDate));
  const slots = encodeURIComponent(encodeBookedSlotsParam(bookedSlots));
  const lt = encodeURIComponent(String(lessonType || 'experience').trim() || 'experience');
  let path = `/pages/coach-session-detail/index?v=${v}&d=${d}&slots=${slots}&lt=${lt}`;
  const pm = String(pairMode || '').trim();
  const gm = String(groupMode || '').trim();
  if (pm) path += `&pm=${encodeURIComponent(pm)}`;
  if (gm) path += `&gm=${encodeURIComponent(gm)}`;
  return path;
}

function computeSessionSlotPast(orderDate, firstSlotIndex) {
  const od = normalizeOrderDateLocal(orderDate);
  const todayStr = getTodayDateStr();
  if (!od) return false;
  if (od > todayStr) return false;
  if (od < todayStr) return true;
  const now = new Date();
  const slotHour = 8 + Number(firstSlotIndex);
  if (!Number.isFinite(slotHour)) return false;
  const slotTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), slotHour, 0, 0);
  return !(slotTime > now);
}

function courtsFromVenue(venue) {
  const courtList = venue && Array.isArray(venue.courtList) ? venue.courtList : [];
  if (courtList.length === 0) return [];
  return courtList.map((c, idx) => ({
    id: idx + 1,
    name: (c && c.name) || `${idx + 1}号场`,
  }));
}

/** 当前场次对应的教练课订单 id（用于取消报名） */
function findCoachCourseBookingIdForSession(bookings, venueId, orderDate, holdIds, bookedSlotsPage) {
  const wantSkHolds = sessionKeyFromHoldIds(holdIds);
  const wantSkSlots = sessionKeyFromBookedSlots(bookedSlotsPage);
  const odNorm = normalizeOrderDateLocal(orderDate);
  const list = Array.isArray(bookings) ? bookings : [];
  for (let i = 0; i < list.length; i += 1) {
    const b = list[i];
    if (String(b.bookingSubtype || '') !== 'coach_course') continue;
    const st = String(b.status || '');
    if (!['paid', 'pending', 'payment_confirming'].includes(st)) continue;
    if (!venueIdLooseEqual(b.venueId, venueId)) continue;
    if (normalizeOrderDateLocal(b.orderDate) !== odNorm) continue;
    const skH = sessionKeyFromHoldIds(b.coachHoldIds);
    const skS = sessionKeyFromBookedSlots(b.bookedSlots);
    if (wantSkHolds && skH === wantSkHolds) {
      return b._id != null ? String(b._id) : '';
    }
    if (wantSkSlots && skS === wantSkSlots) {
      return b._id != null ? String(b._id) : '';
    }
  }
  return '';
}

Page({
  data: {
    headerHeight: 0,
    contentHeight: 400,
    loading: true,
    errMsg: '',
    campusName: '',
    formattedDate: '',
    courtName: '',
    timeRange: '',
    capacityLabel: '',
    coachName: '',
    joinedCount: 0,
    capacityLimit: 1,
    participants: [],
    defaultAvatar: '/assets/images/default-avatar.jpg',
    sessionFull: false,
    viewerAlreadyJoined: false,
    slotPast: false,
    canBook: false,
    canCancelEnrollment: false,
    myCoachBookingId: '',
    holdIds: [],
    bookedSlots: [],
    lessonType: 'experience',
    pairMode: '1v1',
    groupMode: '',
    venueId: '',
    orderDate: '',
    courts: [],
    lottieLoadingVisible: false,
    /** 体验课：当前手机号是否曾报名有效体验教练课 */
    experienceParticipatedBefore: false,
    experienceParticipationReady: false,
    sessionShareReady: false,
    showPhoneAuthModal: false,
  },
  _loadingTaskCount: 0,
  preventTouchMove,

  onReady() {
    this.measureLayoutAndContentHeight();
  },

  measureLayoutAndContentHeight() {
    const query = wx.createSelectorQuery();
    query.select('.header').boundingClientRect();
    query.exec((res) => {
      const headerRect = res[0];
      let headerH = 55;
      if (headerRect && headerRect.height > 0) {
        headerH = headerRect.height;
      } else {
        const app = getApp();
        headerH = (app?.globalData?.screenInfo?.headerInfo?.headerPaddingTop || 0) + 55;
      }
      const contentHeight = this.computeScrollHeight(headerH);
      this.setData({ headerHeight: headerH, contentHeight });
    });
  },

  computeScrollHeight(headerH) {
    const windowInfo = wx.getWindowInfo();
    const windowHeight = windowInfo.windowHeight;
    const sw = windowInfo.screenWidth || 375;
    const rpxToPx = (rpx) => (rpx * sw) / 750;
    const safeBottom = windowInfo.safeArea
      ? windowInfo.screenHeight - windowInfo.safeArea.bottom
      : 0;
    let btnCount = 0;
    if (this.data.canBook) btnCount += 1;
    if (this.data.canCancelEnrollment) btnCount += 1;
    const footerBarRpx =
      btnCount > 0 ? 16 + btnCount * 88 + Math.max(0, btnCount - 1) * 16 + 16 : 0;
    const footerReserve = btnCount > 0 ? rpxToPx(footerBarRpx) + safeBottom : 0;
    return Math.max(windowHeight - headerH - footerReserve, 300);
  },

  onLoad(options) {
    try {
      wx.showShareMenu({
        withShareTicket: true,
        menus: ['shareAppMessage', 'shareTimeline'],
      });
    } catch (e) {
      /* ignore */
    }
    const parsed = this.parseSessionLaunchOptions(options || {});
    if (!parsed.ok) {
      this.setData({ loading: false, errMsg: parsed.errMsg || '参数不完整', sessionShareReady: false });
      return;
    }
    this.applySessionLaunch(parsed);
  },

  parseSessionLaunchOptions(options) {
    const shareVenueId = options.v != null ? decodeURIComponent(String(options.v)) : '';
    const shareDate = options.d != null ? decodeURIComponent(String(options.d)) : '';
    const shareSlotsRaw = options.slots != null ? decodeURIComponent(String(options.slots)) : '';
    if (shareVenueId && shareDate && shareSlotsRaw) {
      const bookedSlots = parseBookedSlotsParam(shareSlotsRaw);
      if (bookedSlots.length === 0) {
        return { ok: false, errMsg: '场次参数无效' };
      }
      return {
        ok: true,
        venueId: String(shareVenueId).trim(),
        selectedDate: normalizeOrderDateLocal(shareDate),
        bookedSlots,
        holdIds: [],
        lessonType: options.lt != null ? decodeURIComponent(String(options.lt)) : 'experience',
        pairMode: options.pm != null ? decodeURIComponent(String(options.pm)) : '1v1',
        groupMode: options.gm != null ? decodeURIComponent(String(options.gm)) : '',
        capacityLabel: '',
        coachName: '',
        courts: [],
        slotPast: computeSessionSlotPast(shareDate, bookedSlots[0].slotIndex),
      };
    }

    try {
      const coachPayload = JSON.parse(decodeURIComponent(options.coachPayload || '{}'));
      const venueId = decodeURIComponent(options.venueId || '');
      const selectedDate = normalizeOrderDateLocal(decodeURIComponent(options.selectedDate || ''));
      const courts = JSON.parse(decodeURIComponent(options.courts || '[]'));
      const slotPastOpt =
        options.slotPast === '1' ||
        options.slotPast === 1 ||
        options.slotPast === true ||
        options.slotPast === 'true';
      const {
        holdIds,
        bookedSlots,
        lessonType,
        pairMode,
        groupMode,
        capacityLabel,
        coachName: coachNameRaw,
      } = coachPayload;
      if (!Array.isArray(bookedSlots) || bookedSlots.length === 0 || !venueId || !selectedDate) {
        return { ok: false, errMsg: '参数不完整' };
      }
      const firstIdx = Number(bookedSlots[0].slotIndex);
      return {
        ok: true,
        venueId: String(venueId).trim(),
        selectedDate,
        bookedSlots,
        holdIds: Array.isArray(holdIds) ? holdIds.map((id) => String(id)).filter(Boolean) : [],
        lessonType: lessonType || 'experience',
        pairMode: pairMode || '1v1',
        groupMode: groupMode || '',
        capacityLabel: String(capacityLabel || '').trim() || '教练课程',
        coachName: String(coachNameRaw || '').trim(),
        courts: Array.isArray(courts) ? courts : [],
        slotPast: slotPastOpt || computeSessionSlotPast(selectedDate, firstIdx),
      };
    } catch (e) {
      console.error('parseSessionLaunchOptions', e);
      return { ok: false, errMsg: '无法打开页面' };
    }
  },

  async applySessionLaunch(parsed) {
    const {
      venueId,
      selectedDate,
      bookedSlots,
      holdIds,
      lessonType,
      pairMode,
      groupMode,
      capacityLabel,
      coachName,
      courts: courtsIn,
      slotPast,
    } = parsed;

    let courts = Array.isArray(courtsIn) ? courtsIn : [];
    try {
      const venue = await this.ensureVenueContext(venueId);
      if ((!courts || courts.length === 0) && venue) {
        courts = courtsFromVenue(venue);
      }
    } catch (e) {
      console.warn('ensureVenueContext', e);
    }

    const courtId = Number(bookedSlots[0].courtId);
    const court = (courts || []).find((c) => c.id === courtId);
    const courtName = court && court.name ? String(court.name) : `${courtId}号场`;
    const span = bookedSlots.length;
    const startIdx = Number(bookedSlots[0].slotIndex);
    const timeRange = this.formatCoachSlotRange(startIdx, span);

    this.setData({
      holdIds: Array.isArray(holdIds) ? holdIds : [],
      bookedSlots,
      lessonType: lessonType || 'experience',
      pairMode: pairMode || '1v1',
      groupMode: groupMode || '',
      capacityLabel: String(capacityLabel || '').trim() || '教练课程',
      coachName: String(coachName || '').trim(),
      venueId,
      orderDate: selectedDate,
      courts,
      courtName,
      timeRange,
      formattedDate: this.formatDate(selectedDate),
      slotPast: !!slotPast,
      loading: true,
      errMsg: '',
      sessionShareReady: true,
    });
    this.syncCampusName();
    this.loadDetail();
  },

  async ensureVenueContext(venueId) {
    const wantId = String(venueId || '').trim();
    if (!wantId) return null;
    const app = getApp();
    if (!app || !app.globalData) return null;
    const cur = app.globalData.selectedVenue;
    if (!cur || !venueIdLooseEqual(cur.id, wantId)) {
      app.globalData.selectedVenue = { id: wantId };
    }
    const venue = await refreshSelectedVenueFromCloud(app);
    return venue;
  },

  onShareAppMessage() {
    if (this.data.slotPast) {
      return {
        title: '昂湃网球',
        path: '/pages/home/index',
      };
    }
    const path = buildSessionSharePath({
      venueId: this.data.venueId,
      orderDate: this.data.orderDate,
      bookedSlots: this.data.bookedSlots,
      lessonType: this.data.lessonType,
      pairMode: this.data.pairMode,
      groupMode: this.data.groupMode,
    });
    const typeLabel = lessonTypeShareLabel(this.data.lessonType);
    const titleParts = [
      this.data.capacityLabel || typeLabel,
      this.data.formattedDate,
      this.data.timeRange,
    ].filter(Boolean);
    return {
      title: titleParts.join(' · ') || '昂湃网球课程',
      path,
    };
  },

  onShareTimeline() {
    if (this.data.slotPast) {
      return { title: '昂湃网球', query: '' };
    }
    const path = buildSessionSharePath({
      venueId: this.data.venueId,
      orderDate: this.data.orderDate,
      bookedSlots: this.data.bookedSlots,
      lessonType: this.data.lessonType,
      pairMode: this.data.pairMode,
      groupMode: this.data.groupMode,
    });
    const query = path.includes('?') ? path.split('?')[1] : '';
    const typeLabel = lessonTypeShareLabel(this.data.lessonType);
    const titleParts = [
      this.data.capacityLabel || typeLabel,
      this.data.formattedDate,
      this.data.timeRange,
    ].filter(Boolean);
    return {
      title: titleParts.join(' · ') || '昂湃网球课程',
      query,
    };
  },

  onShow() {
    /** 支付成功返回、从后台切回时刷新名单与订单匹配，避免仍依赖旧 holdIds */
    if (this._coachSessionDetailHasLoadedOnce) {
      this.loadDetail();
    }
  },

  onUnload() {
    this._coachSessionDetailHasLoadedOnce = false;
    this._loadingTaskCount = 0;
    this.setData({ lottieLoadingVisible: false });
  },

  syncCampusName() {
    const app = getApp();
    const venue = app && app.globalData && app.globalData.selectedVenue;
    const campusName = venue && venue.name ? String(venue.name) : '昂湃网球学练馆';
    this.setData({ campusName });
  },

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

  formatCoachSlotRange(startIndex, span) {
    const startH = 8 + startIndex;
    const endH = startH + span;
    const pad = (x) => (x < 10 ? `0${x}` : `${x}`);
    return `${pad(startH)}:00-${pad(endH)}:00`;
  },

  async loadDetail() {
    const { venueId, orderDate, bookedSlots } = this.data;
    const first = bookedSlots[0];
    const key = `${Number(first.courtId)}-${Number(first.slotIndex)}`;
    this.beginLoading('加载中');
    try {
      const phone = String(wx.getStorageSync('user_phone') || '').trim();
      const slotReq = getBookedSlots({ venueId, orderDate });
      const bookingReq = phone
        ? getMyBookings({ includePending: true })
        : Promise.resolve({ result: { data: [] } });
      const [res, bookRes] = await Promise.all([slotReq, bookingReq]);
      const r = res && res.result ? res.result : {};
      const metaMap =
        r.coachHoldMeta && typeof r.coachHoldMeta === 'object' && !Array.isArray(r.coachHoldMeta)
          ? r.coachHoldMeta
          : {};
      const m = metaMap[key] || {};
      const participants = Array.isArray(m.participants) ? m.participants : [];
      const joinedCount = m.joinedCount != null ? Number(m.joinedCount) : participants.length;
      const capacityLimit = m.capacityLimit != null ? Number(m.capacityLimit) : 1;
      const sessionFull = !!m.sessionFull;
      const viewerAlreadyJoined = !!m.viewerAlreadyJoined;
      const fromReleased = !!m.fromReleasedSession;
      const holdIdCloud = m.holdId != null ? String(m.holdId).trim() : '';
      const slotPast = this.data.slotPast;
      const bookings = (bookRes && bookRes.result && bookRes.result.data) || [];

      const holdIdSet = new Set();
      for (let bi = 0; bi < (bookedSlots || []).length; bi += 1) {
        const bs = bookedSlots[bi];
        if (!bs || bs.courtId == null || bs.slotIndex == null) continue;
        const kk = `${Number(bs.courtId)}-${Number(bs.slotIndex)}`;
        const mm = metaMap[kk] || {};
        if (Array.isArray(mm.sessionHoldIds) && mm.sessionHoldIds.length > 0) {
          mm.sessionHoldIds.forEach((hid) => {
            const h = String(hid || '').trim();
            if (h) holdIdSet.add(h);
          });
        } else if (mm.holdId) {
          holdIdSet.add(String(mm.holdId).trim());
        }
      }
      const refreshedHoldIds = [...holdIdSet].filter(Boolean);
      const nextHoldIds = refreshedHoldIds.length > 0 ? refreshedHoldIds : this.data.holdIds;

      const lessonTypeCloud =
        m.lessonType != null && String(m.lessonType).trim() !== ''
          ? String(m.lessonType).trim()
          : this.data.lessonType;
      const pairModeCloud =
        m.pairMode != null && String(m.pairMode).trim() !== ''
          ? String(m.pairMode).trim()
          : this.data.pairMode;
      const groupModeCloud =
        m.groupMode != null ? String(m.groupMode).trim() : this.data.groupMode;

      const myCoachBookingId = findCoachCourseBookingIdForSession(
        bookings,
        venueId,
        orderDate,
        nextHoldIds,
        bookedSlots,
      );
      /** 以订单匹配为准；占用释放后 holdIds 可能与订单不一致，不能依赖 viewerAlreadyJoined */
      const canCancelEnrollment = !!myCoachBookingId && !slotPast;
      const experienceParticipatedBefore =
        isExperienceLessonType(lessonTypeCloud) && hasExperienceCoachParticipation(bookings);
      const experienceParticipationReady = true;
      const experienceBlocked =
        isExperienceLessonType(lessonTypeCloud) && experienceParticipatedBefore;
      const canBook =
        !experienceBlocked &&
        !slotPast &&
        !sessionFull &&
        !viewerAlreadyJoined &&
        !!holdIdCloud &&
        !fromReleased;

      let coachName = '';
      for (let bi = 0; bi < (bookedSlots || []).length; bi += 1) {
        const bs = bookedSlots[bi];
        if (!bs || bs.courtId == null || bs.slotIndex == null) continue;
        const kk = `${Number(bs.courtId)}-${Number(bs.slotIndex)}`;
        const mm = metaMap[kk] || {};
        const cn =
          mm.coachName != null && String(mm.coachName).trim() !== ''
            ? String(mm.coachName).trim()
            : '';
        if (cn) {
          coachName = cn;
          break;
        }
      }
      if (!coachName) {
        const cn0 =
          m.coachName != null && String(m.coachName).trim() !== ''
            ? String(m.coachName).trim()
            : '';
        coachName = cn0 || String(this.data.coachName || '').trim();
      }

      const capacityLabel =
        m.capacityLabel != null && String(m.capacityLabel).trim() !== ''
          ? String(m.capacityLabel).trim()
          : this.data.capacityLabel;

      this.setData(
        {
          loading: false,
          participants,
          joinedCount,
          capacityLimit,
          sessionFull,
          viewerAlreadyJoined,
          myCoachBookingId,
          canCancelEnrollment,
          experienceParticipatedBefore,
          experienceParticipationReady,
          canBook,
          coachName,
          capacityLabel,
          holdIds: nextHoldIds,
          lessonType: lessonTypeCloud,
          pairMode: pairModeCloud,
          groupMode: groupModeCloud,
          sessionShareReady: true,
        },
        () => {
          try {
            if (this.data.slotPast) {
              wx.hideShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] });
            } else {
              wx.showShareMenu({
                withShareTicket: true,
                menus: ['shareAppMessage', 'shareTimeline'],
              });
            }
          } catch (e) {
            /* ignore */
          }
          const h = this.data.headerHeight || 55;
          this.setData({ contentHeight: this.computeScrollHeight(h) });
        },
      );
      this._coachSessionDetailHasLoadedOnce = true;
    } catch (e) {
      console.error('loadDetail', e);
      this.setData({
        loading: false,
        errMsg: '加载失败，请稍后重试',
        experienceParticipationReady: true,
      });
    } finally {
      this.endLoading();
    }
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

  onCancelEnrollmentTap() {
    if (!this.data.canCancelEnrollment || !this.data.myCoachBookingId) return;
    wx.showModal({
      title: '取消报名',
      content:
        '确定取消该报名？微信实付将原路退回；已使用的课时将退回账户。储值不可用于教练课。距场次开始不足规定时间时无法在线取消。',
      confirmText: '确定取消',
      confirmColor: '#c62828',
      success: async (res) => {
        if (!res.confirm) return;
        this.beginLoading('处理中');
        try {
          const cloudRes = await cancelMemberBooking({ bookingId: this.data.myCoachBookingId });
          const r = (cloudRes && cloudRes.result) || {};
          this.endLoading();
          if (!r.ok) {
            wx.showToast({ title: r.errMsg || '取消失败', icon: 'none' });
            return;
          }
          wx.showToast({ title: '已取消', icon: 'success' });
          await this.loadDetail();
        } catch (err) {
          this.endLoading();
          console.error('cancelMemberBooking', err);
          wx.showToast({ title: '网络异常', icon: 'none' });
        }
      },
    });
  },

  handleClosePhoneAuthModal() {
    this.setData({ showPhoneAuthModal: false });
  },

  /**
   * 手机号授权登录/注册（与订单页一致）
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
      const appid = miniProgram && miniProgram.appId;
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
      await this.loadDetail();
      if (this.data.canBook) {
        this.navigateToCoachOrder();
      }
    } catch (err2) {
      this.endLoading();
      wx.showToast({ title: '处理失败，请重试', icon: 'none' });
    }
  },

  /** 未登录时先校验本地手机号 / 弹出授权，再进入订单页选课时或微信支付 */
  async onBookTap() {
    if (!this.data.canBook) return;
    if (!Array.isArray(this.data.bookedSlots) || this.data.bookedSlots.length === 0) {
      wx.showToast({ title: '该课程暂不可在线报名', icon: 'none' });
      return;
    }
    const app = getApp();
    if (!app || !app.checkLogin()) {
      const storedPhone = String(wx.getStorageSync(STORAGE_KEYS.userPhone) || '').trim();
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
            await this.loadDetail();
            if (this.data.canBook) {
              this.navigateToCoachOrder();
            }
            return;
          }
        } catch (e) {
          console.error('getUserByPhone failed', e);
        }
        this.endLoading();
      }
      this.setData({ showPhoneAuthModal: true });
      return;
    }
    this.navigateToCoachOrder();
  },

  navigateToCoachOrder() {
    const bookedSlots = Array.isArray(this.data.bookedSlots) ? this.data.bookedSlots : [];
    if (bookedSlots.length === 0) {
      wx.showToast({ title: '该课程暂不可在线报名', icon: 'none' });
      return;
    }
    const lessonType = String(this.data.lessonType || 'experience').trim() || 'experience';
    const pairMode = String(this.data.pairMode || '1v1').trim() || '1v1';
    const groupMode = String(this.data.groupMode || '').trim();
    const lessonKey = buildLessonKey(lessonType, pairMode, groupMode);
    const capacityLabel =
      String(this.data.capacityLabel || '').trim() ||
      (lessonType === 'experience'
        ? `体验课·${String(pairMode).toUpperCase()}`
        : lessonType === 'regular'
          ? `正课·${String(pairMode).toUpperCase()}`
          : lessonType === 'group'
            ? '团课'
            : '教练课程');
    const coachPayload = {
      holdIds: Array.isArray(this.data.holdIds) ? this.data.holdIds : [],
      bookedSlots,
      lessonType,
      pairMode,
      groupMode,
      lessonKey,
      capacityLabel,
      coachName: this.data.coachName,
      venueId: String(this.data.venueId || '').trim(),
      orderDate: String(this.data.orderDate || '').trim(),
    };
    /** 避免 URL 过长被截断后误进「普通订场」；订单页优先读 storage */
    try {
      wx.setStorageSync('coach_course_order_payload', coachPayload);
    } catch (e) {
      console.warn('coach_course_order_payload storage', e);
    }
    const slots = bookedSlots
      .map((s) => `${Number(s.courtId)}-${Number(s.slotIndex)}`)
      .filter((k) => /^\d+-\d+$/.test(k))
      .join(',');
    const q = [
      'orderSource=coachCourse',
      `v=${encodeURIComponent(coachPayload.venueId)}`,
      `d=${encodeURIComponent(coachPayload.orderDate)}`,
      `slots=${encodeURIComponent(slots)}`,
      `lt=${encodeURIComponent(lessonType)}`,
      `pm=${encodeURIComponent(pairMode)}`,
      `lk=${encodeURIComponent(lessonKey)}`,
    ];
    if (groupMode) q.push(`gm=${encodeURIComponent(groupMode)}`);
    wx.navigateTo({
      url: `/pages/order-detail/index?${q.join('&')}`,
    });
  },
});
