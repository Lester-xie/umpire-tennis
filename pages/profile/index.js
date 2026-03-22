const STORAGE_KEYS = {
  profileVisited: 'profile_has_visited',
  userAvatar: 'user_avatar',
  userPhoneCode: 'user_phone_code',
  userPhone: 'user_phone',
  userNickname: 'user_nickname',
};

const { getUserByPhone, createUser, decryptPhoneNumber } = require('../../api/tennisDb');
const { getRandomSchmoeAvatarUrl } = require('../../utils/schmoeAvatar');

function resolveAvatarForUI(avatarValue) {
  // 新逻辑：user.avatar/userAvatar 存的是云 fileID（cloud://）、或网络图 https://（如 Joe Schmoe）
  // 旧逻辑：可能存的是本地文件路径（仍允许回退显示）
  if (!avatarValue) return Promise.resolve('');
  const v = String(avatarValue).trim();
  if (!v) return Promise.resolve('');
  if (v.startsWith('http://') || v.startsWith('https://')) return Promise.resolve(v);
  if (!v.startsWith('cloud://')) return Promise.resolve(v);

  return new Promise((resolve, reject) => {
    wx.cloud.getTempFileURL({
      fileList: [{ fileID: v }],
      // 7天缓存，减少重复生成
      maxAge: 60 * 60 * 24 * 7,
      success: (res) => {
        const url = res?.fileList?.[0]?.tempFileURL || '';
        resolve(url);
      },
      fail: reject,
    });
  }).catch((err) => {
    console.error('resolveAvatarForUI failed', err);
    return '';
  });
}

/** isCoach 优先于 isVip；均为 false 时为空串 */
function buildUserIdentity(isCoach, isVip) {
  if (isCoach) return '教练';
  if (isVip) return 'VIP';
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
    userIdentity: '', // 教练 | VIP | ''
  },

  onLoad() {
    const app = getApp();
    if (app) {
      const isLoggedIn = app.checkLogin();
      const userNickname = wx.getStorageSync(STORAGE_KEYS.userNickname) || '';
      const userDisplayName = isLoggedIn ? (userNickname || '昂湃用户') : '点击登录';
      this.setData({ isLoggedIn, userNickname, userDisplayName });
    }
  },

  async onShow() {
    const app = getApp();
    const isLoggedIn = app ? app.checkLogin() : false;
    const userAvatarFileID = wx.getStorageSync(STORAGE_KEYS.userAvatar) || '';
    const userAvatar = await resolveAvatarForUI(userAvatarFileID);
    const userNickname = wx.getStorageSync(STORAGE_KEYS.userNickname) || '';
    const userPhone = wx.getStorageSync(STORAGE_KEYS.userPhone) || '';
    const userDisplayName = isLoggedIn ? (userNickname || '昂湃用户') : '点击登录';
    let isVip = false;
    let isCoach = false;
    if (isLoggedIn && userPhone) {
      const flags = await this.fetchUserRoleFlags(userPhone);
      isVip = flags.isVip;
      isCoach = flags.isCoach;
    }
    const userIdentity = buildUserIdentity(isCoach, isVip);
    this.setData({
      isLoggedIn,
      userAvatar,
      userAvatarFileID,
      userNickname,
      userDisplayName,
      userPhone,
      isVip,
      isCoach,
      userIdentity,
    });
  },

  /** 从 db_user 读取 isVip、isCoach（一次查询） */
  async fetchUserRoleFlags(phone) {
    if (!phone) return { isVip: false, isCoach: false };
    try {
      const res = await getUserByPhone(phone);
      const user = res && res.data && res.data.length > 0 ? res.data[0] : null;
      if (!user) return { isVip: false, isCoach: false };
      return {
        isVip: !!user.isVip,
        isCoach: !!user.isCoach,
      };
    } catch (e) {
      console.warn('fetchUserRoleFlags failed', e);
      return { isVip: false, isCoach: false };
    }
  },

  onReady() {
    this.calculateHeaderHeight();
    this.calculateContentHeight();
  },

  calculateHeaderHeight() {
    const query = wx.createSelectorQuery();
    query.select('.header').boundingClientRect();
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
    query.select('.header').boundingClientRect();
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

  goCoachHolds() {
    if (!this.data.isCoach) return;
    wx.navigateTo({ url: '/pages/profile-coach-holds/index' });
  },

  goCourtOrders() {
    wx.navigateTo({ url: '/pages/profile-court-orders/index' });
  },

  goGoodsOrders() {
    wx.navigateTo({ url: '/pages/profile-goods-orders/index' });
  },

  // 授权手机号注册：成功后再执行 wx.login，并跳转完善资料
  async onPhoneRegister(e) {
    const { errMsg, encryptedData, iv } = e.detail || {};
    if (!errMsg || !errMsg.includes('ok')) {
      return;
    }

    const app = getApp();
    if (!app) return;

    wx.showLoading({ title: '检查注册信息...' });
    try {
      const loginCode = await app.doLogin();
      if (!loginCode) {
        wx.hideLoading();
        wx.showToast({ title: '登录失败，请重试', icon: 'none' });
        return;
      }
      // userPhoneCode 在 complete-profile 里用于判断是否已授权手机号
      wx.setStorageSync(STORAGE_KEYS.userPhoneCode, loginCode);

      if (!encryptedData || !iv) {
        // 解密所需参数缺失：让用户走完善资料里的手动输入路径
        wx.hideLoading();
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
      console.log('phoneNumber', decryptRes);

      if (!phoneNumber) {
        wx.hideLoading();
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

        const isVip = !!user.isVip;
        const isCoach = !!user.isCoach;
        this.setData({
          isLoggedIn: true,
          userAvatar: resolvedAvatar,
          userAvatarFileID: avatar,
          userNickname: nickname,
          userPhone: phone,
          userDisplayName: nickname || '昂湃用户',
          isVip,
          isCoach,
          userIdentity: buildUserIdentity(isCoach, isVip),
        });

        wx.hideLoading();
        // 保持在当前 profile 页
        return;
      }

      // 未注册：写入 user 集合并继续走完善资料流程（默认头像：Joe Schmoe 随机官方名）
      const schmoeAvatarUrl = getRandomSchmoeAvatarUrl();
      await createUser({
        phone,
        name: defaultNickname,
        avatar: schmoeAvatarUrl,
      });

      // 必须先写 storage，再 setData，否则 onShow 可能先读到空 user_avatar 并覆盖头像
      wx.setStorageSync(STORAGE_KEYS.userPhone, phone);
      wx.setStorageSync(STORAGE_KEYS.userNickname, defaultNickname);
      wx.setStorageSync(STORAGE_KEYS.userAvatar, schmoeAvatarUrl);

      wx.hideLoading();
      this.setData({
        isLoggedIn: true,
        userAvatar: schmoeAvatarUrl,
        userAvatarFileID: schmoeAvatarUrl,
        userDisplayName: defaultNickname,
        isVip: false,
        isCoach: false,
        userIdentity: '',
      });

      // wx.navigateTo({ url: '/pages/complete-profile/index' });
    } catch (err2) {
      wx.hideLoading();
      wx.showToast({ title: '注册失败，请重试', icon: 'none' });
    }
  },

  // 点击用户卡片：已登录则进入完善资料
  handleUserCardTap() {
    if (this.data.isLoggedIn) {
      wx.navigateTo({ url: '/pages/complete-profile/index' });
    }
  },

  /** 教练：进入教练约场页（需已选场馆） */
  handleCoachBookCourt() {
    if (!this.data.isCoach) return;
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
        } catch (e) {
          console.warn('clear user storage', e);
        }
        const app = getApp();
        if (app) {
          app.globalData.isLoggedIn = false;
        }
        this.setData({
          isLoggedIn: false,
          userAvatar: '',
          userAvatarFileID: '',
          userNickname: '',
          userPhone: '',
          userDisplayName: '点击登录',
          isVip: false,
          isCoach: false,
          userIdentity: '',
        });
      },
    });
  },
});
