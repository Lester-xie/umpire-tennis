const { getBookedSlots, getMyBookings, cancelMemberBooking } = require('../../api/tennisDb');
const { hasExperienceCoachParticipation } = require('../../utils/experienceParticipation');

function isExperienceLessonType(lt) {
  return String(lt || '').trim().toLowerCase() === 'experience';
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
  },
  _loadingTaskCount: 0,

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
    const footerBarRpx = 16 + 88 + 16;
    const showFooterBar = this.data.canBook || this.data.canCancelEnrollment;
    const footerReserve = showFooterBar ? rpxToPx(footerBarRpx) + safeBottom : 0;
    return Math.max(windowHeight - headerH - footerReserve, 300);
  },

  onLoad(options) {
    try {
      const coachPayload = JSON.parse(decodeURIComponent(options.coachPayload || '{}'));
      const venueId = decodeURIComponent(options.venueId || '');
      const selectedDate = decodeURIComponent(options.selectedDate || '');
      const courts = JSON.parse(decodeURIComponent(options.courts || '[]'));
      const slotPast =
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
        this.setData({ loading: false, errMsg: '参数不完整' });
        return;
      }
      const safeHoldIds = Array.isArray(holdIds) ? holdIds.map((id) => String(id)).filter(Boolean) : [];
      const courtId = Number(bookedSlots[0].courtId);
      const court = (courts || []).find((c) => c.id === courtId);
      const courtName = court && court.name ? String(court.name) : `${courtId}号场`;
      const span = bookedSlots.length;
      const startIdx = Number(bookedSlots[0].slotIndex);
      const timeRange = this.formatCoachSlotRange(startIdx, span);

      this.setData({
        holdIds: safeHoldIds,
        bookedSlots,
        lessonType: lessonType || 'experience',
        pairMode: pairMode || '1v1',
        groupMode: groupMode || '',
        capacityLabel: String(capacityLabel || '').trim() || '教练课程',
        coachName: String(coachNameRaw || '').trim(),
        venueId,
        orderDate: selectedDate,
        courts,
        courtName,
        timeRange,
        formattedDate: this.formatDate(selectedDate),
        slotPast: !!slotPast,
        loading: true,
        errMsg: '',
      });
      this.syncCampusName();
      this.loadDetail();
    } catch (e) {
      console.error('coach-session-detail onLoad', e);
      this.setData({ loading: false, errMsg: '无法打开页面' });
    }
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
    const { venueId, orderDate, bookedSlots, lessonType } = this.data;
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
      const myCoachBookingId = findCoachCourseBookingIdForSession(
        bookings,
        venueId,
        orderDate,
        this.data.holdIds,
        bookedSlots,
      );
      /** 以订单匹配为准；占用释放后 holdIds 可能与订单不一致，不能依赖 viewerAlreadyJoined */
      const canCancelEnrollment = !!myCoachBookingId && !slotPast;
      const experienceParticipatedBefore =
        isExperienceLessonType(lessonType) && hasExperienceCoachParticipation(bookings);
      const experienceParticipationReady = true;
      const experienceBlocked = isExperienceLessonType(lessonType) && experienceParticipatedBefore;
      const canBook =
        !experienceBlocked &&
        !slotPast &&
        !sessionFull &&
        !viewerAlreadyJoined &&
        !!holdIdCloud &&
        !fromReleased;

      const coachName =
        m.coachName != null && String(m.coachName).trim() !== ''
          ? String(m.coachName).trim()
          : this.data.coachName;

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
        },
        () => {
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
        '确定取消该报名？已支付的金额将原路退回微信，已使用的课时将退回账户。距场次开始不足 6 小时时无法在线取消。',
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

  onBookTap() {
    if (!this.data.canBook) return;
    if (!this.data.holdIds || this.data.holdIds.length === 0) {
      wx.showToast({ title: '该课程暂不可在线报名', icon: 'none' });
      return;
    }
    const coachPayload = {
      holdIds: this.data.holdIds,
      bookedSlots: this.data.bookedSlots,
      lessonType: this.data.lessonType,
      pairMode: this.data.pairMode,
      groupMode: this.data.groupMode,
      capacityLabel: this.data.capacityLabel,
      coachName: this.data.coachName,
    };
    const coachPayloadEnc = encodeURIComponent(JSON.stringify(coachPayload));
    const selectedDate = encodeURIComponent(this.data.orderDate || '');
    const courtsEnc = encodeURIComponent(JSON.stringify(this.data.courts || []));
    const venueId = encodeURIComponent(this.data.venueId || '');
    wx.navigateTo({
      url: `/pages/order-detail/index?orderSource=coachCourse&coachPayload=${coachPayloadEnc}&selectedDate=${selectedDate}&courts=${courtsEnc}&venueId=${venueId}`,
    });
  },
});
