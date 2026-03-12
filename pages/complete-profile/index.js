const STORAGE_KEYS = {
  userAvatar: 'user_avatar',
  userPhoneCode: 'user_phone_code',
  userPhone: 'user_phone',
  userNickname: 'user_nickname',
};

Page({
  data: {
    userAvatar: '',
    userNickname: '',
    userPhone: '',
    phoneAuthorized: false,
    contentScrollHeight: 400,
    nicknameFocus: false,
  },

  onLoad() {
    const userAvatar = wx.getStorageSync(STORAGE_KEYS.userAvatar) || '';
    const userNickname = wx.getStorageSync(STORAGE_KEYS.userNickname) || '';
    const userPhone = wx.getStorageSync(STORAGE_KEYS.userPhone) || '';
    const phoneAuthorized = !!(wx.getStorageSync(STORAGE_KEYS.userPhoneCode) || userPhone);
    this.setData({ userAvatar, userNickname, userPhone, phoneAuthorized });
  },

  onReady() {
    this.calculateContentHeight();
  },

  calculateContentHeight() {
    const systemInfo = wx.getSystemInfoSync();
    const windowHeight = systemInfo.windowHeight;
    const query = wx.createSelectorQuery();
    query.select('.header').boundingClientRect();
    query.exec((res) => {
      const headerRect = res[0];
      const headerHeight = headerRect?.height || 55;
      const contentHeight = windowHeight - headerHeight;
      this.setData({ contentScrollHeight: Math.max(contentHeight, 400) });
    });
  },

  // 完成
  handleComplete() {
    const { userNickname } = this.data;
    if ((userNickname || '').trim()) {
      wx.setStorageSync(STORAGE_KEYS.userNickname, (userNickname || '').trim());
    }
    wx.showToast({ title: '资料已保存', icon: 'success' });
    setTimeout(() => {
      wx.navigateBack();
    }, 1500);
  },

  onNicknameInput(e) {
    const value = (e.detail.value || '').trim().slice(0, 20);
    this.setData({ userNickname: value });
    if (value) {
      wx.setStorageSync(STORAGE_KEYS.userNickname, value);
    }
  },

  onNicknameFocus() {
    this.setData({ nicknameFocus: true });
  },

  onNicknameBlur() {
    this.setData({ nicknameFocus: false });
  },

  onGetPhoneNumber(e) {
    const { code, errMsg } = e.detail || {};
    if (code) {
      wx.setStorageSync(STORAGE_KEYS.userPhoneCode, code);
      this.setData({ phoneAuthorized: true });
      wx.showToast({ title: '手机号已授权', icon: 'success' });
    } else if (errMsg && !errMsg.includes('cancel')) {
      wx.showToast({ title: '授权失败', icon: 'none' });
    }
  },

  onPhoneInput(e) {
    const value = (e.detail.value || '').replace(/\D/g, '').slice(0, 11);
    this.setData({ userPhone: value });
    if (value.length === 11) {
      wx.setStorageSync(STORAGE_KEYS.userPhone, value);
    }
  },

  onChooseAvatar(e) {
    const { avatarUrl } = e.detail;
    if (!avatarUrl) return;

    const fs = wx.getFileSystemManager();
    const fileName = `${wx.env.USER_DATA_PATH}/avatar_${Date.now()}.png`;
    fs.saveFile({
      tempFilePath: avatarUrl,
      filePath: fileName,
      success: () => {
        wx.setStorageSync(STORAGE_KEYS.userAvatar, fileName);
        this.setData({ userAvatar: fileName });
        wx.showToast({ title: '头像已更新', icon: 'success' });
      },
      fail: (err) => {
        console.error('保存头像失败', err);
        wx.setStorageSync(STORAGE_KEYS.userAvatar, avatarUrl);
        this.setData({ userAvatar: avatarUrl });
        wx.showToast({ title: '头像已更新', icon: 'success' });
      },
    });
  },
});
