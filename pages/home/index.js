/** 与 welcome 页一致：未授权手机号且未看过欢迎页时需先走欢迎流程 */
const STORAGE_USER_PHONE = 'user_phone';
const STORAGE_WELCOME_SEEN = 'welcome_seen';

Page({
  data: {
    headerHeight: 0, // header 高度
    contentHeight: 400,
    placeholderHeight: 0,
    courseLoadingVisible: false,
    announcement: '',
    announcementTitle: '公告',
  },
  onLoad() {
    // 小程序码等可直达首页；首次用户仍先进入欢迎页
    const phone = wx.getStorageSync(STORAGE_USER_PHONE);
    const seen = wx.getStorageSync(STORAGE_WELCOME_SEEN);
    if (!phone && !seen) {
      wx.reLaunch({ url: '/pages/welcome/index' });
      return;
    }
    this.syncVenueAnnouncement();
  },

  onShow() {
    this.syncVenueAnnouncement();
  },

  /** 展示当前已选场馆的首页公告（支持换行） */
  syncVenueAnnouncement() {
    const app = getApp();
    const venue = app && app.globalData && app.globalData.selectedVenue;
    const raw = venue && venue.announcement != null ? String(venue.announcement) : '';
    const announcement = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/^\s+|\s+$/g, '');
    const titleRaw =
      venue && venue.announcementTitle != null ? String(venue.announcementTitle).trim() : '';
    const announcementTitle = titleRaw || '公告';
    this.setData({ announcement, announcementTitle });
  },

  onCourseLoading(e) {
    const loading = e.detail && e.detail.loading;
    this.setData({ courseLoadingVisible: !!loading });
  },

  goStoredValue() {
    wx.navigateTo({ url: '/pages/stored-value/index' });
  },

  goMonthCard() {
    wx.navigateTo({ url: '/pages/month-card/index' });
  },

  onReady() {
    // 页面渲染完成后计算 header 高度（只计算 title 部分）
    this.calculateHeaderHeight();
    this.calculateContentHeight();
  },
  // 计算 header 高度（只计算 title 部分）
  calculateHeaderHeight() {
    const query = wx.createSelectorQuery();
    query.select('.header-wrapper').boundingClientRect();
    query.exec((res) => {
      const headerRect = res[0];
      if (headerRect) {
        this.setData({
          headerHeight: headerRect.height,
        });
      } else {
        // 如果查询不到，使用默认值（安全区域顶部 + title 高度）
        const app = getApp();
        let headerPaddingTop = 0;
        if (app && app.globalData && app.globalData.screenInfo && app.globalData.screenInfo.headerInfo) {
          headerPaddingTop = app.globalData.screenInfo.headerInfo.headerPaddingTop || 0;
        }
        // title 高度约 55px（padding-top 30px + title 20px + margin-top 5px）
        this.setData({
          headerHeight: headerPaddingTop + 55,
        });
      }
    });
  },
  
  // 计算 content 高度：100vh - header 高度 - 底部安全距离 - custom-tab-bar 高度
  calculateContentHeight() {
    const windowInfo = wx.getWindowInfo();
    const windowHeight = windowInfo.windowHeight; // 100vh 对应的像素值
    
    // 查询 header 和 tab-bar 的实际高度
    const query = wx.createSelectorQuery();
    query.select('.header').boundingClientRect();
    query.select('.tab-bar').boundingClientRect();
    query.exec((res) => {
      const headerRect = res[0];
      const tabBarRect = res[1];
      
      // 获取 header 高度
      const headerHeight = headerRect ? headerRect.height : 0;
      
      // 如果查询不到 header，使用默认值（headerPaddingTop + 25）
      let finalHeaderHeight = headerHeight;
      if (!headerHeight || headerHeight === 0) {
        const app = getApp();
        let headerPaddingTop = 0;
        if (app && app.globalData && app.globalData.screenInfo && app.globalData.screenInfo.headerInfo) {
          headerPaddingTop = app.globalData.screenInfo.headerInfo.headerPaddingTop || 0;
        }
        finalHeaderHeight = headerPaddingTop + 35; // padding-top + title 高度
      }
      
      // 获取 tab-bar 高度
      const tabBarHeight = tabBarRect ? tabBarRect.height : 60; // 默认 60px
      
      // 计算底部安全距离：屏幕高度 - 安全区域底部
      const safeAreaBottom = windowInfo.safeArea
        ? windowInfo.screenHeight - windowInfo.safeArea.bottom
        : 0;
      
      const contentHeight = windowHeight - finalHeaderHeight;
      this.setData({
        contentHeight: Math.max(contentHeight, 400), // 最小高度 400px
        placeholderHeight: safeAreaBottom + tabBarHeight + 30,
      });
    });
  },
});
