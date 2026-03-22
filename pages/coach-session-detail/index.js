const { getBookedSlots } = require('../../api/tennisDb');

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
    holdIds: [],
    bookedSlots: [],
    lessonType: 'experience',
    pairMode: '1v1',
    groupMode: '',
    venueId: '',
    orderDate: '',
    courts: [],
  },

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
    const footerReserve = this.data.canBook ? rpxToPx(footerBarRpx) + safeBottom : 0;
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
    try {
      const res = await getBookedSlots({ venueId, orderDate });
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
      const canBook =
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
          canBook,
          coachName,
          capacityLabel,
        },
        () => {
          const h = this.data.headerHeight || 55;
          this.setData({ contentHeight: this.computeScrollHeight(h) });
        },
      );
    } catch (e) {
      console.error('loadDetail', e);
      this.setData({ loading: false, errMsg: '加载失败，请稍后重试' });
    }
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
