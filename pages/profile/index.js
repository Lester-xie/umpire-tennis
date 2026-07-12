const STORAGE_KEYS = {
  profileVisited: 'profile_has_visited',
  profileSummaryCache: 'profile_summary_cache',
  avatarUrlCache: 'profile_avatar_temp_url',
  userAvatar: 'user_avatar',
  userPhoneCode: 'user_phone_code',
  userPhone: 'user_phone',
  userNickname: 'user_nickname',
};

/** 同一会话内切回「我的」tab 时，距上次拉取未超过该间隔则跳过重复请求 */
const PROFILE_REFRESH_MS = 45 * 1000;

const {
  getUserByPhone,
  createUser,
  decryptPhoneNumber,
  listAllMemberCourseHours,
  listAllMemberVenueBalances,
  DEFAULT_USER_AVATAR,
} = require('../../api/tennisDb');
const { roundYuan, formatYuanText } = require('../../utils/storedValuePlans');
const {
  attachPageMemberAssetRealtime,
  detachPageMemberAssetRealtime,
  restartMemberAssetRealtimeWatch,
} = require('../../utils/memberAssetRealtime');

function readAvatarUrlCache(fileID) {
  if (!fileID) return '';
  try {
    const cache = wx.getStorageSync(STORAGE_KEYS.avatarUrlCache) || {};
    const hit = cache[fileID];
    if (hit && hit.url && Date.now() - (hit.ts || 0) < 7 * 24 * 60 * 60 * 1000) {
      return hit.url;
    }
  } catch (e) {
    console.warn('readAvatarUrlCache', e);
  }
  return '';
}

function writeAvatarUrlCache(fileID, url) {
  if (!fileID || !url) return;
  try {
    const cache = wx.getStorageSync(STORAGE_KEYS.avatarUrlCache) || {};
    cache[fileID] = { url, ts: Date.now() };
    wx.setStorageSync(STORAGE_KEYS.avatarUrlCache, cache);
  } catch (e) {
    console.warn('writeAvatarUrlCache', e);
  }
}

function resolveAvatarForUI(avatarValue) {
  // user.avatar/userAvatar：云 fileID（cloud://）、https、或包内路径如 /assets/...
  // 旧逻辑：可能存的是本地文件路径（仍允许回退显示）
  if (!avatarValue) return Promise.resolve('');
  const v = String(avatarValue).trim();
  if (!v) return Promise.resolve('');
  if (v.startsWith('http://') || v.startsWith('https://')) return Promise.resolve(v);
  if (!v.startsWith('cloud://')) return Promise.resolve(v);

  const cachedUrl = readAvatarUrlCache(v);
  if (cachedUrl) return Promise.resolve(cachedUrl);

  return new Promise((resolve, reject) => {
    wx.cloud.getTempFileURL({
      fileList: [{ fileID: v }],
      // 7天缓存，减少重复生成
      maxAge: 60 * 60 * 24 * 7,
      success: (res) => {
        const url = res?.fileList?.[0]?.tempFileURL || '';
        if (url) writeAvatarUrlCache(v, url);
        resolve(url);
      },
      fail: reject,
    });
  }).catch((err) => {
    console.error('resolveAvatarForUI failed', err);
    return '';
  });
}

function readProfileSummaryCache(phone) {
  if (!phone) return null;
  try {
    const raw = wx.getStorageSync(STORAGE_KEYS.profileSummaryCache);
    if (!raw || raw.phone !== phone) return null;
    if (Date.now() - (raw.ts || 0) > PROFILE_REFRESH_MS) return null;
    return raw;
  } catch (e) {
    console.warn('readProfileSummaryCache', e);
    return null;
  }
}

function writeProfileSummaryCache(phone, summary) {
  if (!phone || !summary) return;
  try {
    wx.setStorageSync(STORAGE_KEYS.profileSummaryCache, {
      phone,
      ts: Date.now(),
      ...summary,
    });
  } catch (e) {
    console.warn('writeProfileSummaryCache', e);
  }
}

function clearProfileSummaryCache() {
  try {
    wx.removeStorageSync(STORAGE_KEYS.profileSummaryCache);
  } catch (e) {
    console.warn('clearProfileSummaryCache', e);
  }
}

function buildSummaryFromFlags(flags, totalCourseHours, totalStoredBalanceYuan) {
  const isVip = !!flags.isVip;
  const isCoach = !!flags.isCoach;
  const isManager = !!flags.isManager;
  return {
    isVip,
    isCoach,
    isManager,
    userIdentity: buildUserIdentity(isCoach, isVip, isManager),
    identityBadgeKind: identityBadgeKind(isCoach, isVip, isManager),
    totalCourseHours,
    totalCourseHoursText: formatHoursNumberStatic(totalCourseHours),
    totalStoredBalanceYuan,
    totalStoredBalanceText: formatYuanText(totalStoredBalanceYuan),
  };
}

function formatHoursNumberStatic(n) {
  const x = Number(n) || 0;
  if (Number.isInteger(x) || Math.abs(x - Math.round(x)) < 1e-6) {
    return String(Math.round(x));
  }
  return x.toFixed(1);
}

function syncAvatarForDisplay(avatarFileID, cachedSummary) {
  const fileID = String(avatarFileID || '').trim();
  if (!fileID) return '';
  if (fileID.startsWith('http://') || fileID.startsWith('https://') || !fileID.startsWith('cloud://')) {
    return fileID;
  }
  if (cachedSummary && cachedSummary.userAvatar) return cachedSummary.userAvatar;
  return readAvatarUrlCache(fileID);
}

/** 管理员（isManager）> 教练 > VIP：徽章只展示最高一档 */
function buildUserIdentity(isCoach, isVip, isManager) {
  if (isManager) return '管理员';
  if (isCoach) return '教练';
  if (isVip) return 'VIP';
  return '';
}

/** 与 buildUserIdentity 同优先级，用于 profile-badge 背景色 */
function identityBadgeKind(isCoach, isVip, isManager) {
  if (isManager) return 'manager';
  if (isCoach) return 'coach';
  if (isVip) return 'vip';
  return '';
}

Page({
  data: {
    isLoggedIn: false,
    userAvatar: '',
    userAvatarFileID: '',
    userNickname: '',
    userDisplayName: '点击登录', // 用于 user-name 展示：未登录为「点击登录」，登录后为昵称或「昂湃用户」
    userPhone: '', // 展示用，或手动填写
    headerHeight: 0,
    contentHeight: 400,
    placeholderHeight: 0,
    isVip: false, // db_user.isVip
    isCoach: false, // db_user.isCoach
    isManager: false, // db_user.isManager（畅打 + 后台管理）
    userIdentity: '', // 管理员 | 教练 | VIP | ''（优先级见 buildUserIdentity）
    identityBadgeKind: '', // manager | coach | vip | ''
    lottieLoadingVisible: false,
    /** 全部场馆剩余课时合计（展示在账户卡片） */
    totalCourseHours: 0,
    totalCourseHoursText: '—',
    /** 全部场馆储值余额合计 */
    totalStoredBalanceYuan: 0,
    totalStoredBalanceText: '—',
  },
  _loadingTaskCount: 0,
  _profileSummary: null,
  _profileRefreshPromise: null,

  onLoad() {
    const app = getApp();
    if (app) {
      const isLoggedIn = app.checkLogin();
      const userNickname = wx.getStorageSync(STORAGE_KEYS.userNickname) || '';
      const userDisplayName = isLoggedIn ? (userNickname || '昂湃用户') : '点击登录';
      this.setData({ isLoggedIn, userNickname, userDisplayName });
    }
  },

  onShow() {
    const app = getApp();
    if (app && app.globalData && app.globalData.profileSummaryStale) {
      clearProfileSummaryCache();
      this._profileSummary = null;
    }
    this.applyProfileFromLocal();
    this.refreshProfileSummary();
    this._memberAssetWatchSessionGen = this._memberAssetWatchSessionGen || 0;
    attachPageMemberAssetRealtime(this, () => this.handleMemberAssetRealtimeChange());
  },

  onHide() {
    detachPageMemberAssetRealtime(this);
  },

  handleMemberAssetRealtimeChange() {
    clearProfileSummaryCache();
    this._profileSummary = null;
    this.refreshProfileSummary({ force: true });
  },

  /** 先用本地 storage / 缓存即时渲染，避免等网络再出首屏 */
  applyProfileFromLocal() {
    const app = getApp();
    const isLoggedIn = app ? app.checkLogin() : false;
    const userNickname = wx.getStorageSync(STORAGE_KEYS.userNickname) || '';
    const userPhone = wx.getStorageSync(STORAGE_KEYS.userPhone) || '';
    const userAvatarFileID = wx.getStorageSync(STORAGE_KEYS.userAvatar) || '';
    const userDisplayName = isLoggedIn ? (userNickname || '昂湃用户') : '点击登录';
    const cached = isLoggedIn && userPhone ? readProfileSummaryCache(userPhone) : null;
    const syncAvatar = isLoggedIn
      ? (syncAvatarForDisplay(userAvatarFileID, cached) || '/assets/images/default-avatar.jpg')
      : '';

    const patch = {
      isLoggedIn,
      userNickname,
      userDisplayName,
      userPhone,
      userAvatarFileID,
      userAvatar: syncAvatar,
    };

    if (cached) {
      Object.assign(patch, {
        isVip: !!cached.isVip,
        isCoach: !!cached.isCoach,
        isManager: !!cached.isManager,
        userIdentity: cached.userIdentity || '',
        identityBadgeKind: cached.identityBadgeKind || '',
        totalCourseHours: Number(cached.totalCourseHours) || 0,
        totalCourseHoursText: cached.totalCourseHoursText || '0',
        totalStoredBalanceYuan: Number(cached.totalStoredBalanceYuan) || 0,
        totalStoredBalanceText: cached.totalStoredBalanceText || '0',
      });
    } else if (!isLoggedIn || !userPhone) {
      Object.assign(patch, {
        isVip: false,
        isCoach: false,
        isManager: false,
        userIdentity: '',
        identityBadgeKind: '',
        totalCourseHours: 0,
        totalCourseHoursText: '—',
        totalStoredBalanceYuan: 0,
        totalStoredBalanceText: '—',
      });
    }

    this.setData(patch);
  },

  shouldSkipProfileRefresh(userPhone) {
    const app = getApp();
    if (app && app.globalData && app.globalData.profileSummaryStale) {
      return false;
    }
    const mem = this._profileSummary;
    if (!mem || mem.phone !== userPhone) return false;
    return Date.now() - (mem.ts || 0) < PROFILE_REFRESH_MS;
  },

  async refreshProfileSummary(options) {
    const force = !!(options && options.force);
    const app = getApp();
    const isLoggedIn = app ? app.checkLogin() : false;
    const userPhone = wx.getStorageSync(STORAGE_KEYS.userPhone) || '';
    const userAvatarFileID = wx.getStorageSync(STORAGE_KEYS.userAvatar) || '';

    if (!isLoggedIn || !userPhone) {
      this._profileSummary = null;
      return;
    }

    if (force) {
      if (app && app.globalData) {
        app.globalData.profileSummaryStale = false;
      }
      this._profileRefreshPromise = null;
    } else if (app && app.globalData && app.globalData.profileSummaryStale) {
      app.globalData.profileSummaryStale = false;
    } else if (this.shouldSkipProfileRefresh(userPhone)) {
      return;
    }

    if (!force && this._profileRefreshPromise) {
      return this._profileRefreshPromise;
    }

    const firstVisit = !wx.getStorageSync(STORAGE_KEYS.profileVisited);
    const task = (async () => {
      try {
        const [userAvatar, flags, totalCourseHours, totalStoredBalanceYuan] = await Promise.all([
          resolveAvatarForUI(userAvatarFileID),
          this.fetchUserRoleFlags(userPhone),
          this.fetchTotalCourseHoursSum(),
          this.fetchTotalStoredBalanceSum(),
        ]);
        const summary = buildSummaryFromFlags(flags, totalCourseHours, totalStoredBalanceYuan);
        const ts = Date.now();
        this._profileSummary = { phone: userPhone, ts, userAvatar, ...summary };
        writeProfileSummaryCache(userPhone, { userAvatar, ...summary });
        this.setData({
          userAvatar: userAvatar || '/assets/images/default-avatar.jpg',
          userAvatarFileID,
          ...summary,
        });
      } catch (e) {
        console.warn('refreshProfileSummary', e);
      } finally {
        this._profileRefreshPromise = null;
        if (firstVisit) {
          try {
            wx.setStorageSync(STORAGE_KEYS.profileVisited, true);
          } catch (e) {
            console.warn('set profileVisited failed', e);
          }
        }
      }
    })();

    this._profileRefreshPromise = task;
    return task;
  },

  formatHoursNumber(n) {
    return formatHoursNumberStatic(n);
  },

  async fetchTotalCourseHoursSum() {
    try {
      const res = await listAllMemberCourseHours();
      const rows = (res && res.result && Array.isArray(res.result.data)) ? res.result.data : [];
      let sum = 0;
      rows.forEach((r) => {
        sum += Number(r.hours) || 0;
      });
      return sum;
    } catch (e) {
      console.warn('fetchTotalCourseHoursSum', e);
      return 0;
    }
  },

  async fetchTotalStoredBalanceSum() {
    try {
      const res = await listAllMemberVenueBalances();
      const rows = (res && res.result && Array.isArray(res.result.data)) ? res.result.data : [];
      let sum = 0;
      rows.forEach((r) => {
        sum += roundYuan(r.balanceYuan);
      });
      return sum;
    } catch (e) {
      console.warn('fetchTotalStoredBalanceSum', e);
      return 0;
    }
  },

  /** 从 db_user 读取角色 */
  async fetchUserRoleFlags(phone) {
    if (!phone) {
      return { isVip: false, isCoach: false, isManager: false };
    }
    try {
      const res = await getUserByPhone(phone);
      const user = res && res.data && res.data.length > 0 ? res.data[0] : null;
      if (!user) {
        return { isVip: false, isCoach: false, isManager: false };
      }
      return {
        isVip: !!user.isVip,
        isCoach: !!user.isCoach,
        isManager: !!user.isManager,
      };
    } catch (e) {
      console.warn('fetchUserRoleFlags failed', e);
      return { isVip: false, isCoach: false, isManager: false };
    }
  },

  onReady() {
    this.calculateHeaderHeight();
    this.calculateContentHeight();
  },

  calculateHeaderHeight() {
    const query = wx.createSelectorQuery();
    query.select('.header-wrapper').boundingClientRect();
    query.exec((res) => {
      const headerRect = res[0];
      if (headerRect && headerRect.height > 0) {
        this.setData({ headerHeight: headerRect.height });
      } else {
        const app = getApp();
        const headerPaddingTop = app?.globalData?.screenInfo?.headerInfo?.headerPaddingTop || 0;
        this.setData({ headerHeight: headerPaddingTop + 55 });
      }
    });
  },

  calculateContentHeight() {
    const windowInfo = wx.getWindowInfo();
    const windowHeight = windowInfo.windowHeight;
    const query = wx.createSelectorQuery();
    query.select('.header-wrapper').boundingClientRect();
    query.select('.tab-bar').boundingClientRect();
    query.exec((res) => {
      const headerRect = res[0];
      const tabBarRect = res[1];
      const headerHeight = headerRect?.height || 55;
      const tabBarHeight = tabBarRect?.height || 60;
      const safeAreaBottom = windowInfo.safeArea
        ? windowInfo.screenHeight - windowInfo.safeArea.bottom
        : 0;
      const contentHeight = windowHeight - headerHeight - safeAreaBottom - tabBarHeight - 20;
      this.setData({
        contentHeight: Math.max(contentHeight, 400),
        placeholderHeight: safeAreaBottom + tabBarHeight + 30,
      });
    });
  },

  goCourtOrders() {
    wx.navigateTo({ url: '/pages/profile-court-orders/index' });
  },

  goGoodsOrders() {
    wx.navigateTo({ url: '/pages/profile-goods-orders/index' });
  },

  goMeituanVerify() {
    if (!this.data.isLoggedIn) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: '/pages/profile-meituan-verify/index' });
  },

  // 授权手机号注册：成功后再执行 wx.login，并跳转完善资料
  async onPhoneRegister(e) {
    const { errMsg, encryptedData, iv } = e.detail || {};
    if (!errMsg || !errMsg.includes('ok')) {
      return;
    }

    const app = getApp();
    if (!app) return;

    this.beginLoading('检查注册信息...');
    try {
      const loginCode = await app.doLogin();
      if (!loginCode) {
        this.endLoading();
        wx.showToast({ title: '登录失败，请重试', icon: 'none' });
        return;
      }
      // userPhoneCode 在 complete-profile 里用于判断是否已授权手机号
      wx.setStorageSync(STORAGE_KEYS.userPhoneCode, loginCode);

      if (!encryptedData || !iv) {
        // 解密所需参数缺失：让用户走完善资料里的手动输入路径
        this.endLoading();
        wx.setStorageSync(STORAGE_KEYS.userPhoneCode, '');
        wx.setStorageSync(STORAGE_KEYS.userPhone, '');
        // wx.navigateTo({ url: '/pages/complete-profile/index' });
        return;
      }

      // 注意：这里用于 jscode2session 的 code 一定要来自 wx.login
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
        // wx.navigateTo({ url: '/pages/complete-profile/index' });
        return;
      }

      const phone = String(phoneNumber);
      const last4 = phone.slice(-4);
      const defaultNickname = `昂湃用户_${last4}`;

      const res = await getUserByPhone(phone);
      const user = (res && res.data && res.data.length > 0) ? res.data[0] : null;

      if (user) {
        // 已注册：直接读用户信息，不跳转 complete-profile
        const avatar = user.avatar || '';
        const nickname = user.name || '';
        const resolvedAvatar = await resolveAvatarForUI(avatar);

        wx.setStorageSync(STORAGE_KEYS.userPhone, phone);
        wx.setStorageSync(STORAGE_KEYS.userAvatar, avatar);
        wx.setStorageSync(STORAGE_KEYS.userNickname, nickname);
        restartMemberAssetRealtimeWatch(this, () => this.handleMemberAssetRealtimeChange());

        const isVip = !!user.isVip;
        const isCoach = !!user.isCoach;
        const isManager = !!user.isManager;
        const [totalCourseHours, totalStoredBalanceYuan] = await Promise.all([
          this.fetchTotalCourseHoursSum(),
          this.fetchTotalStoredBalanceSum(),
        ]);
        const summary = buildSummaryFromFlags(
          { isVip, isCoach, isManager },
          totalCourseHours,
          totalStoredBalanceYuan,
        );
        writeProfileSummaryCache(phone, { userAvatar: resolvedAvatar, ...summary });
        this._profileSummary = { phone, ts: Date.now(), userAvatar: resolvedAvatar, ...summary };
        this.setData({
          isLoggedIn: true,
          userAvatar: resolvedAvatar,
          userAvatarFileID: avatar,
          userNickname: nickname,
          userPhone: phone,
          userDisplayName: nickname || '昂湃用户',
          ...summary,
        });

        this.endLoading();
        // 保持在当前 profile 页
        return;
      }

      // 未注册：写入 user 集合并继续走完善资料流程（默认头像：包内 default-avatar.jpg）
      await createUser({
        phone,
        name: defaultNickname,
      });

      // 必须先写 storage，再 setData，否则 onShow 可能先读到空 user_avatar 并覆盖头像
      wx.setStorageSync(STORAGE_KEYS.userPhone, phone);
      restartMemberAssetRealtimeWatch(this, () => this.handleMemberAssetRealtimeChange());
      wx.setStorageSync(STORAGE_KEYS.userNickname, defaultNickname);
      wx.setStorageSync(STORAGE_KEYS.userAvatar, DEFAULT_USER_AVATAR);

      this.endLoading();
      this.setData({
        isLoggedIn: true,
        userAvatar: DEFAULT_USER_AVATAR,
        userAvatarFileID: DEFAULT_USER_AVATAR,
        userDisplayName: defaultNickname,
        isVip: false,
        isCoach: false,
        isManager: false,
        userIdentity: '',
        identityBadgeKind: '',
        totalCourseHours: 0,
        totalCourseHoursText: '0',
      });

      // wx.navigateTo({ url: '/pages/complete-profile/index' });
    } catch (err2) {
      this.endLoading();
      wx.showToast({ title: '注册失败，请重试', icon: 'none' });
    }
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

  // 点击头像区域：已登录则进入完善资料
  handleUserCardTap() {
    if (this.data.isLoggedIn) {
      wx.navigateTo({ url: '/pages/complete-profile/index' });
    }
  },

  handleRedeemTap() {
    if (!this.data.isLoggedIn) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: '/pages/profile-course-hours/index' });
  },

  handleStoredValueTap() {
    if (!this.data.isLoggedIn) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: '/pages/profile-stored-value/index' });
  },

  /** 教练或管理员：进入教练约场页（需已选场馆） */
  handleCoachBookCourt() {
    if (!this.data.isCoach && !this.data.isManager) return;
    const app = getApp();
    const venue = app && app.globalData && app.globalData.selectedVenue;
    if (!venue || venue.id == null || venue.id === '') {
      wx.showModal({
        title: '请先选择场馆',
        content: '需要先在选场馆页选定要占用的球馆，再进入教练约场。',
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
    wx.navigateTo({ url: '/pages/coach-booking/index' });
  },

  // 头部「切换账号」：清除本地登录态与用户信息，便于重新授权手机号
  onSwitchAccount() {
    wx.showModal({
      title: '切换账号',
      content: '将退出当前账号并清除本机保存的手机号与资料，是否继续？',
      confirmText: '切换',
      confirmColor: '#134E35',
      success: (res) => {
        if (!res.confirm) return;
        try {
          wx.removeStorageSync(STORAGE_KEYS.userPhone);
          wx.removeStorageSync(STORAGE_KEYS.userPhoneCode);
          wx.removeStorageSync(STORAGE_KEYS.userAvatar);
          wx.removeStorageSync(STORAGE_KEYS.userNickname);
          clearProfileSummaryCache();
        } catch (e) {
          console.warn('clear user storage', e);
        }
        const app = getApp();
        if (app) {
          app.globalData.isLoggedIn = false;
          app.globalData.profileSummaryStale = false;
        }
        detachPageMemberAssetRealtime(this);
        this._profileSummary = null;
        this._profileRefreshPromise = null;
        this.setData({
          isLoggedIn: false,
          userAvatar: '',
          userAvatarFileID: '',
          userNickname: '',
          userPhone: '',
          userDisplayName: '点击登录',
          isVip: false,
          isCoach: false,
          isManager: false,
          userIdentity: '',
          identityBadgeKind: '',
          totalCourseHours: 0,
          totalCourseHoursText: '—',
          totalStoredBalanceYuan: 0,
          totalStoredBalanceText: '—',
        });
      },
    });
  },

  goAdminConsole() {
    if (!this.data.isManager) return;
    wx.navigateTo({ url: '/pages/admin/index' });
  },
});
