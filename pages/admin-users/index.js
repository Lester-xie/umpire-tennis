const {
  DEFAULT_USER_AVATAR,
  adminGetUserByPhone,
  adminGetUserMemberAssets,
  adminSetUserRoles,
  adminSetUserMemberAssets,
  getVenues,
} = require('../../api/tennisDb');
const { resolveImageUrlForDisplay } = require('../../utils/cloudImage');
const { formatLessonKeyDisplay } = require('../../utils/lessonKey');
const { venueIdLooseEqual, normalizeVenueId } = require('../../utils/venueId');
const { roundYuan } = require('../../utils/storedValuePlans');

/** 本页仅管理正课 1V1 / 1V2（db_member_course_hours.lessonKey） */
const MANAGED_LESSON_KEYS = ['regular:1v1', 'regular:1v2'];

function isManagedLessonKey(lessonKey) {
  return MANAGED_LESSON_KEYS.includes(String(lessonKey || '').trim());
}

function filterManagedCourseHours(rawRows) {
  return (rawRows || []).filter((row) => isManagedLessonKey(row.lessonKey));
}

function findVenueIndex(venueOptions, venueId) {
  const idx = (venueOptions || []).findIndex((v) => venueIdLooseEqual(v.id, venueId));
  return idx >= 0 ? idx : 0;
}

function findBalanceForVenue(balances, venueId) {
  return (balances || []).find((row) => venueIdLooseEqual(row.venueId, venueId)) || null;
}

function findHoursForVenueAndKey(courseHours, venueId, lessonKey) {
  const lk = String(lessonKey || '').trim();
  return (
    (courseHours || []).find(
      (row) => venueIdLooseEqual(row.venueId, venueId) && String(row.lessonKey || '').trim() === lk,
    ) || null
  );
}

function findMonthCardForVenue(monthCards, venueId) {
  return (monthCards || []).find((row) => venueIdLooseEqual(row.venueId, venueId)) || null;
}

function findSessionCardForVenue(sessionCards, venueId) {
  return (sessionCards || []).find((row) => venueIdLooseEqual(row.venueId, venueId)) || null;
}

function formatDateInputFromTs(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return '';
  const d = new Date(n);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** YYYY-MM-DD → 当天 23:59:59.999 本地时间戳；空串返回 0（清除） */
function parseExpiresAtFromDateInput(str) {
  const s = String(str || '').trim();
  if (!s) return 0;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return NaN;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(y, mo - 1, d, 23, 59, 59, 999);
  if (Number.isNaN(dt.getTime())) return NaN;
  return dt.getTime();
}

function todayDateInput() {
  return formatDateInputFromTs(Date.now());
}

function buildVenueAssetFields(venueId, assetCache) {
  const vid = normalizeVenueId(venueId);
  const balances = (assetCache && assetCache.balances) || [];
  const courseHours = filterManagedCourseHours((assetCache && assetCache.courseHours) || []);
  const monthCards = (assetCache && assetCache.monthCards) || [];
  const sessionCards = (assetCache && assetCache.sessionCards) || [];
  const bal = findBalanceForVenue(balances, vid);
  const h1 = findHoursForVenueAndKey(courseHours, vid, 'regular:1v1');
  const h2 = findHoursForVenueAndKey(courseHours, vid, 'regular:1v2');
  const mc = findMonthCardForVenue(monthCards, vid);
  const sc = findSessionCardForVenue(sessionCards, vid);
  const monthCardExpiresInput = formatDateInputFromTs(mc ? mc.expiresAt : 0);
  return {
    venueAssetsReady: !!vid,
    balanceDocId: bal && bal.docId ? String(bal.docId) : '',
    balanceInput: String(roundYuan(bal ? bal.balanceYuan : 0)),
    hour1v1DocId: h1 && h1.docId ? String(h1.docId) : '',
    hour1v1Input: String(Math.max(0, Math.floor(Number(h1 ? h1.hours : 0)))),
    hour1v1UnitPriceInput: String(roundYuan(h1 ? h1.unitPriceYuan : 0)),
    hour1v2DocId: h2 && h2.docId ? String(h2.docId) : '',
    hour1v2Input: String(Math.max(0, Math.floor(Number(h2 ? h2.hours : 0)))),
    hour1v2UnitPriceInput: String(roundYuan(h2 ? h2.unitPriceYuan : 0)),
    monthCardDocId: mc && mc.docId ? String(mc.docId) : '',
    monthCardExpiresInput,
    monthCardPickerValue: monthCardExpiresInput || todayDateInput(),
    sessionCardDocId: sc && sc.docId ? String(sc.docId) : '',
    sessionCardTimesInput: String(Math.max(0, Math.floor(Number(sc ? sc.remainingTimes : 0)))),
  };
}

Page({
  data: {
    scrollHeight: 400,
    targetPhone: '',
    querying: false,
    saving: false,
    userCardVisible: false,
    queriedPhone: '',
    userName: '',
    avatarDisplayUrl: DEFAULT_USER_AVATAR,
    isCoach: false,
    isVip: false,
    venueOptions: [],
    venuePickerLabels: [],
    selectedVenueIndex: 0,
    selectedVenueId: '',
    selectedVenueName: '',
    venueAssetsReady: false,
    balanceDocId: '',
    balanceInput: '0',
    hour1v1DocId: '',
    hour1v1Input: '0',
    hour1v1UnitPriceInput: '0',
    hour1v1Label: formatLessonKeyDisplay('regular:1v1'),
    hour1v2DocId: '',
    hour1v2Input: '0',
    hour1v2UnitPriceInput: '0',
    hour1v2Label: formatLessonKeyDisplay('regular:1v2'),
    monthCardDocId: '',
    monthCardExpiresInput: '',
    monthCardPickerValue: todayDateInput(),
    sessionCardDocId: '',
    sessionCardTimesInput: '0',
  },

  onLoad() {
    this.loadVenues();
  },

  onReady() {
    this.layout();
  },

  async loadVenues() {
    try {
      const res = await getVenues();
      const venueOptions = (res.data || []).map((v) => ({
        id: normalizeVenueId(v._id),
        name: v.name != null ? String(v.name).trim() : '',
      }));
      const first = venueOptions[0];
      this.setData({
        venueOptions,
        venuePickerLabels: venueOptions.map((v) => v.name || v.id),
        selectedVenueIndex: first ? 0 : -1,
        selectedVenueId: first ? first.id : '',
        selectedVenueName: first ? first.name || first.id : '',
      });
    } catch (e) {
      console.error('loadVenues', e);
    }
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

  resetUserCard() {
    this._assetCache = null;
    const first = (this.data.venueOptions || [])[0];
    this.setData({
      userCardVisible: false,
      queriedPhone: '',
      userName: '',
      avatarDisplayUrl: DEFAULT_USER_AVATAR,
      isCoach: false,
      isVip: false,
      selectedVenueIndex: first ? 0 : -1,
      selectedVenueId: first ? first.id : '',
      selectedVenueName: first ? first.name || first.id : '',
      venueAssetsReady: false,
      balanceDocId: '',
      balanceInput: '0',
      hour1v1DocId: '',
      hour1v1Input: '0',
      hour1v1UnitPriceInput: '0',
      hour1v2DocId: '',
      hour1v2Input: '0',
      hour1v2UnitPriceInput: '0',
      monthCardDocId: '',
      monthCardExpiresInput: '',
      monthCardPickerValue: todayDateInput(),
      sessionCardDocId: '',
      sessionCardTimesInput: '0',
    });
  },

  onPhoneInput(e) {
    const targetPhone = (e.detail.value || '').trim();
    this.setData({ targetPhone });
    this.resetUserCard();
  },

  onUserNameInput(e) {
    this.setData({ userName: e.detail.value != null ? String(e.detail.value) : '' });
  },

  onToggleCoach(e) {
    this.setData({ isCoach: !!e.detail.value });
  },

  onToggleVip(e) {
    this.setData({ isVip: !!e.detail.value });
  },

  onAdminVenueChange(e) {
    const pickIdx = Number(e.detail.value);
    const venue = (this.data.venueOptions || [])[pickIdx];
    if (!venue) return;
    const patch = {
      selectedVenueIndex: pickIdx,
      selectedVenueId: venue.id,
      selectedVenueName: venue.name || venue.id,
    };
    if (this.data.userCardVisible && this._assetCache) {
      Object.assign(patch, buildVenueAssetFields(venue.id, this._assetCache));
    }
    this.setData(patch);
  },

  async onQueryUser() {
    const targetPhone = String(this.data.targetPhone || '').trim();
    if (!/^1\d{10}$/.test(targetPhone)) {
      wx.showToast({ title: '请输入有效手机号', icon: 'none' });
      return;
    }
    if (!(this.data.venueOptions || []).length) {
      wx.showToast({ title: '暂无场馆数据', icon: 'none' });
      return;
    }
    this.setData({ querying: true });
    try {
      const [userRes, assetsRes] = await Promise.all([
        adminGetUserByPhone({ phone: targetPhone }),
        adminGetUserMemberAssets({ phone: targetPhone }),
      ]);
      const r = (userRes && userRes.result) || {};
      if (!r.ok || !r.data) {
        wx.showToast({ title: r.errMsg || '查询失败', icon: 'none' });
        this.setData({ querying: false });
        this.resetUserCard();
        return;
      }

      const assets = (assetsRes && assetsRes.result) || {};
      if (!assets.ok) {
        wx.showToast({ title: assets.errMsg || '资产查询失败', icon: 'none' });
        this.setData({ querying: false });
        this.resetUserCard();
        return;
      }

      const d = r.data;
      const avatarRaw = d.avatar != null ? String(d.avatar).trim() : '';
      let avatarDisplayUrl = DEFAULT_USER_AVATAR;
      if (avatarRaw) {
        const resolved = await resolveImageUrlForDisplay(avatarRaw);
        avatarDisplayUrl = resolved || DEFAULT_USER_AVATAR;
      }

      this._assetCache = assets.data || {
        balances: [],
        courseHours: [],
        monthCards: [],
        sessionCards: [],
      };
      const venueOptions = this.data.venueOptions || [];
      let selectedVenueIndex = this.data.selectedVenueIndex;
      if (selectedVenueIndex < 0 || selectedVenueIndex >= venueOptions.length) {
        selectedVenueIndex = 0;
      }
      const selectedVenue = venueOptions[selectedVenueIndex] || venueOptions[0];
      const assetFields = buildVenueAssetFields(selectedVenue.id, this._assetCache);

      this.setData({
        querying: false,
        userCardVisible: true,
        queriedPhone: d.phone != null ? String(d.phone) : targetPhone,
        userName: d.name != null ? String(d.name) : '',
        avatarDisplayUrl,
        isCoach: !!d.isCoach,
        isVip: !!d.isVip,
        selectedVenueIndex: findVenueIndex(venueOptions, selectedVenue.id),
        selectedVenueId: selectedVenue.id,
        selectedVenueName: selectedVenue.name || selectedVenue.id,
        ...assetFields,
      });
    } catch (e) {
      console.error(e);
      this.setData({ querying: false });
      wx.showToast({ title: '请求失败', icon: 'none' });
    }
  },

  onBalanceInput(e) {
    this.setData({ balanceInput: e.detail.value || '' });
  },

  onHour1v1Input(e) {
    this.setData({ hour1v1Input: e.detail.value || '' });
  },

  onHour1v1UnitPriceInput(e) {
    this.setData({ hour1v1UnitPriceInput: e.detail.value || '' });
  },

  onHour1v2Input(e) {
    this.setData({ hour1v2Input: e.detail.value || '' });
  },

  onHour1v2UnitPriceInput(e) {
    this.setData({ hour1v2UnitPriceInput: e.detail.value || '' });
  },

  onMonthCardExpiresChange(e) {
    const monthCardExpiresInput = String((e.detail && e.detail.value) || '').trim();
    this.setData({
      monthCardExpiresInput,
      monthCardPickerValue: monthCardExpiresInput || todayDateInput(),
    });
  },

  onClearMonthCard() {
    this.setData({
      monthCardExpiresInput: '',
      monthCardPickerValue: todayDateInput(),
    });
  },

  onSessionCardTimesInput(e) {
    this.setData({ sessionCardTimesInput: e.detail.value || '' });
  },

  assertQueriedPhone() {
    const targetPhone = String(this.data.targetPhone || '').trim();
    const queriedPhone = String(this.data.queriedPhone || '').trim();
    if (!this.data.userCardVisible || !queriedPhone) {
      wx.showToast({ title: '请先查询用户', icon: 'none' });
      return null;
    }
    if (targetPhone !== queriedPhone) {
      wx.showToast({ title: '手机号已变更，请重新查询', icon: 'none' });
      return null;
    }
    return queriedPhone;
  },

  async onSubmit() {
    const queriedPhone = this.assertQueriedPhone();
    if (!queriedPhone) return;

    const venueId = normalizeVenueId(this.data.selectedVenueId);
    if (!venueId) {
      wx.showToast({ title: '请先选择场馆', icon: 'none' });
      return;
    }

    const balanceYuan = roundYuan(this.data.balanceInput);
    if (!Number.isFinite(balanceYuan) || balanceYuan < 0) {
      wx.showToast({ title: '储值金额无效', icon: 'none' });
      return;
    }

    const hour1v1 = Math.floor(Number(this.data.hour1v1Input));
    const hour1v2 = Math.floor(Number(this.data.hour1v2Input));
    if (!Number.isFinite(hour1v1) || hour1v1 < 0 || !Number.isFinite(hour1v2) || hour1v2 < 0) {
      wx.showToast({ title: '课时数量无效', icon: 'none' });
      return;
    }

    const hour1v1UnitPriceYuan = roundYuan(this.data.hour1v1UnitPriceInput);
    const hour1v2UnitPriceYuan = roundYuan(this.data.hour1v2UnitPriceInput);
    if (
      !Number.isFinite(hour1v1UnitPriceYuan) ||
      hour1v1UnitPriceYuan < 0 ||
      !Number.isFinite(hour1v2UnitPriceYuan) ||
      hour1v2UnitPriceYuan < 0
    ) {
      wx.showToast({ title: '课时单价无效', icon: 'none' });
      return;
    }

    const monthCardExpiresAt = parseExpiresAtFromDateInput(this.data.monthCardExpiresInput);
    if (Number.isNaN(monthCardExpiresAt)) {
      wx.showToast({ title: '月卡到期日无效', icon: 'none' });
      return;
    }

    const sessionCardTimes = Math.floor(Number(this.data.sessionCardTimesInput));
    if (!Number.isFinite(sessionCardTimes) || sessionCardTimes < 0) {
      wx.showToast({ title: '次卡次数无效', icon: 'none' });
      return;
    }

    const userName = String(this.data.userName || '').trim();
    if (!userName) {
      wx.showToast({ title: '请填写用户名', icon: 'none' });
      return;
    }
    if (userName.length > 32) {
      wx.showToast({ title: '用户名最多 32 个字', icon: 'none' });
      return;
    }

    this.setData({ saving: true });
    wx.showLoading({ title: '保存中', mask: true });
    try {
      const [rolesRes, assetsRes] = await Promise.all([
        adminSetUserRoles({
          targetPhone: queriedPhone,
          name: userName,
          isCoach: this.data.isCoach,
          isVip: this.data.isVip,
        }),
        adminSetUserMemberAssets({
          targetPhone: queriedPhone,
          balances: [
            {
              docId: this.data.balanceDocId || '',
              venueId,
              balanceYuan,
            },
          ],
          courseHours: [
            {
              docId: this.data.hour1v1DocId || '',
              venueId,
              lessonKey: 'regular:1v1',
              hours: hour1v1,
              unitPriceYuan: hour1v1UnitPriceYuan,
            },
            {
              docId: this.data.hour1v2DocId || '',
              venueId,
              lessonKey: 'regular:1v2',
              hours: hour1v2,
              unitPriceYuan: hour1v2UnitPriceYuan,
            },
          ],
          monthCards: [
            {
              docId: this.data.monthCardDocId || '',
              venueId,
              expiresAt: monthCardExpiresAt > 0 ? monthCardExpiresAt : null,
            },
          ],
          sessionCards: [
            {
              docId: this.data.sessionCardDocId || '',
              venueId,
              remainingTimes: sessionCardTimes,
            },
          ],
        }),
      ]);
      wx.hideLoading();
      this.setData({ saving: false });

      const roles = (rolesRes && rolesRes.result) || {};
      const assets = (assetsRes && assetsRes.result) || {};
      if (!roles.ok) {
        wx.showToast({ title: roles.errMsg || '角色保存失败', icon: 'none' });
        return;
      }
      if (!assets.ok) {
        wx.showToast({ title: assets.errMsg || '账户保存失败', icon: 'none' });
        return;
      }

      wx.showToast({ title: '已保存', icon: 'success' });
      const refreshRes = await adminGetUserMemberAssets({ phone: queriedPhone });
      const refreshed = (refreshRes && refreshRes.result) || {};
      if (refreshed.ok) {
        this._assetCache = refreshed.data || {
          balances: [],
          courseHours: [],
          monthCards: [],
          sessionCards: [],
        };
        this.setData(buildVenueAssetFields(venueId, this._assetCache));
      }
    } catch (e) {
      wx.hideLoading();
      this.setData({ saving: false });
      wx.showToast({ title: '请求失败', icon: 'none' });
    }
  },
});
