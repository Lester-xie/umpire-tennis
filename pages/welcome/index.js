/** 与 app.js / profile 一致：本地有手机号视为已注册 */
const STORAGE_USER_PHONE = 'user_phone';
/** 未注册用户首次欢迎页看完后不再展示 */
const STORAGE_WELCOME_SEEN = 'welcome_seen';
/** 已选择球场缓存（与 location 页一致） */
const STORAGE_SELECTED_VENUE = 'selected_venue';

/** 滑到末端比例超过此值则视为完成 */
const UNLOCK_THRESHOLD = 0.88;

Page({
  data: {
    visible: false,
    thumbTranslate: 0,
    thumbTransition: 'none',
  },

  _maxOffset: 0,
  _touchStartX: 0,
  _touchStartTranslate: 0,
  _completing: false,

  onLoad() {
    const phone = wx.getStorageSync(STORAGE_USER_PHONE);
    const seen = wx.getStorageSync(STORAGE_WELCOME_SEEN);
    // 首次用户：先展示 welcome，不直接跳转场馆选择
    if (!phone && !seen) {
      this.setData({ visible: true });
      return;
    }

    const selectedVenue = wx.getStorageSync(STORAGE_SELECTED_VENUE);
    if (selectedVenue && selectedVenue.id) {
      wx.switchTab({ url: '/pages/home/index' });
      return;
    }
    wx.reLaunch({ url: '/pages/location/index' });
  },

  onReady() {
    setTimeout(() => this.measureSlideMax(), 50);
    setTimeout(() => this.measureSlideMax(), 200);
  },

  rpxToPx(rpx) {
    const w = wx.getWindowInfo().windowWidth;
    return (rpx / 750) * w;
  },

  measureSlideMax() {
    const query = wx.createSelectorQuery().in(this);
    query.select('.slide-track').boundingClientRect();
    query.select('.slide-thumb').boundingClientRect();
    query.exec((res) => {
      const track = res[0];
      const thumb = res[1];
      if (!track || !thumb || thumb.width == null) return;
      const pad = this.rpxToPx(8);
      /** 拇指右缘最多到达轨道内右侧（与 padding 对齐） */
      this._maxOffset = Math.max(0, track.right - pad - thumb.left - thumb.width);
    });
  },

  onThumbTouchStart(e) {
    if (this._completing) return;
    if (!this._maxOffset) {
      this.measureSlideMax();
    }
    const t = e.touches[0];
    this._touchStartX = t.clientX;
    this._touchStartTranslate = this.data.thumbTranslate;
    this.setData({ thumbTransition: 'none' });
  },

  onThumbTouchMove(e) {
    if (this._completing) return;
    const t = e.touches[0];
    const delta = t.clientX - this._touchStartX;
    let next = this._touchStartTranslate + delta;
    next = Math.max(0, Math.min(next, this._maxOffset));
    this.setData({ thumbTranslate: next });
  },

  onThumbTouchEnd() {
    if (this._completing) return;
    const { thumbTranslate } = this.data;
    const max = this._maxOffset;
    if (max <= 0) {
      this.setData({
        thumbTransition: 'transform 0.22s ease-out',
        thumbTranslate: 0,
      });
      return;
    }
    if (thumbTranslate >= max * UNLOCK_THRESHOLD) {
      this._completing = true;
      this.setData({
        thumbTransition: 'transform 0.18s ease-out',
        thumbTranslate: max,
      });
      setTimeout(() => {
        wx.setStorageSync(STORAGE_WELCOME_SEEN, true);
        const selectedVenue = wx.getStorageSync(STORAGE_SELECTED_VENUE);
        if (selectedVenue && selectedVenue.id) {
          wx.switchTab({ url: '/pages/home/index' });
        } else {
          wx.reLaunch({ url: '/pages/location/index' });
        }
      }, 220);
      return;
    }
    this.setData({
      thumbTransition: 'transform 0.22s ease-out',
      thumbTranslate: 0,
    });
  },
});
