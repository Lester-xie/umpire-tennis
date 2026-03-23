const STORAGE_KEYS = {
  userAvatar: 'user_avatar',
  userPhone: 'user_phone',
  userNickname: 'user_nickname',
};

const { updateUserByPhone } = require('../../api/tennisDb');

function getTempFileURLFromFileID(fileID) {
  if (!fileID) return Promise.resolve('');
  return new Promise((resolve, reject) => {
    wx.cloud.getTempFileURL({
      fileList: [{ fileID }],
      // 一周缓存，避免频繁生成 temp url
      maxAge: 60 * 60 * 24 * 7,
      success: (res) => {
        const url = res?.fileList?.[0]?.tempFileURL || '';
        resolve(url);
      },
      fail: reject,
    });
  });
}

/** 本地缓存的 avatar：云 fileID、https、或包内静态路径 */
async function resolveAvatarForDisplay(stored) {
  if (!stored) return '';
  const v = String(stored);
  if (v.startsWith('http://') || v.startsWith('https://')) return v;
  if (v.startsWith('cloud://')) return getTempFileURLFromFileID(v);
  return v;
}

Page({
  data: {
    // 展示用临时 URL（来源于 fileID）
    userAvatar: '',
    // 用于写入数据库的 fileID
    userAvatarFileID: '',
    userNickname: '',
    userPhone: '',
    contentScrollHeight: 400,
    nicknameFocus: false,
    lottieLoadingVisible: false,
  },
  _loadingTaskCount: 0,

  async onLoad() {
    this.beginLoading('加载中');
    const userAvatarFileID = wx.getStorageSync(STORAGE_KEYS.userAvatar) || '';
    const userNickname = wx.getStorageSync(STORAGE_KEYS.userNickname) || '';
    const userPhone = wx.getStorageSync(STORAGE_KEYS.userPhone) || '';

    try {
      const userAvatarUrl = await resolveAvatarForDisplay(userAvatarFileID);
      this.setData({
        userAvatar: userAvatarUrl || '',
        userAvatarFileID,
        userNickname,
        userPhone,
      });
    } finally {
      this.endLoading();
    }
  },

  onReady() {
    this.calculateContentHeight();
  },

  calculateContentHeight() {
    const windowInfo = wx.getWindowInfo();
    const windowHeight = windowInfo.windowHeight;
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
    const { userNickname, userAvatarFileID, userPhone } = this.data;
    const trimmedNickname = (userNickname || '').trim();

    // 先落本地，保证 UI 立即可见
    if (trimmedNickname) {
      wx.setStorageSync(STORAGE_KEYS.userNickname, trimmedNickname);
    }
    if (userAvatarFileID) {
      wx.setStorageSync(STORAGE_KEYS.userAvatar, userAvatarFileID);
    }

    this.beginLoading('正在保存资料...');

    // 再更新云数据库 user.avatar（以及昵称，若有）
    const updateData = {};
    if (trimmedNickname) updateData.name = trimmedNickname;
    if (userAvatarFileID) updateData.avatar = userAvatarFileID;

    // userPhone 为空时无法按手机号更新云端字段
    if (!userPhone || Object.keys(updateData).length === 0) {
      this.endLoading();
      wx.showToast({ title: '资料已保存', icon: 'success' });
      setTimeout(() => {
        wx.navigateBack();
      }, 800);
      return;
    }

    updateUserByPhone({ phone: userPhone, update: updateData })
      .then(() => {
        this.endLoading();
        wx.showToast({ title: '资料已保存', icon: 'success' });
        setTimeout(() => {
          wx.navigateBack();
        }, 800);
      })
      .catch((err) => {
        this.endLoading();
        console.error('updateUserByPhone failed', err);
        wx.showToast({ title: '保存失败，请重试', icon: 'none' });
      });
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

  onChooseAvatar(e) {
    const { avatarUrl } = e.detail;
    if (!avatarUrl) return;

    const fs = wx.getFileSystemManager();
    const fileName = `${wx.env.USER_DATA_PATH}/avatar_${Date.now()}.png`;
    fs.saveFile({
      tempFilePath: avatarUrl,
      filePath: fileName,
      success: () => {
        // 上传到云存储：cloudPath = user-avatar/avatar_xxx.png
        const cloudPath = `user-avatar/avatar_${Date.now()}.png`;

        this.beginLoading('上传头像...');
        wx.cloud.uploadFile({
          cloudPath,
          filePath: fileName,
        })
          .then(async (res) => {
            const fileID = res?.fileID || '';
            wx.setStorageSync(STORAGE_KEYS.userAvatar, fileID);
            this.setData({ userAvatarFileID: fileID });

            const tempUrl = await getTempFileURLFromFileID(fileID);
            this.setData({ userAvatar: tempUrl || '' });
            this.endLoading();
            wx.showToast({ title: '头像已更新', icon: 'success' });
          })
          .catch((err) => {
            this.endLoading();
            console.error('upload avatar failed', err);
            wx.showToast({ title: '上传失败，请重试', icon: 'none' });
          });
      },
      fail: (err) => {
        console.error('保存头像失败', err);
        wx.showToast({ title: '保存头像失败', icon: 'none' });
      },
    });
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
});
