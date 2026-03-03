Component({
  data: {
    currentPath: '', // 使用路径而不是索引
    color: '#7A7E83',
    selectedColor: '#7a987a',
    list: [
      {
        pagePath: 'pages/home/index',
        iconPath: '/assets/images/tab-bar-home.svg',
        selectedIconPath: '/assets/images/tab-bar-home-active.svg',
        text: '主页',
      },
      {
        pagePath: 'pages/booking/index',
        iconPath: '/assets/images/tab-bar-booking.svg',
        selectedIconPath: '/assets/images/tab-bar-booking-active.svg',
        text: '预约',
      },
      {
        pagePath: 'pages/profile/index',
        iconPath: '/assets/images/tab-bar-user.svg',
        selectedIconPath: '/assets/images/tab-bar-user-active.svg',
        text: '个人',
      },
    ],
  },
  attached() {
    // 组件初始化时设置当前路径
    this.updateCurrentPath();
  },
  ready() {
    // 组件渲染完成后再次更新，确保路径正确
    this.updateCurrentPath();
  },
  pageLifetimes: {
    show() {
      // 每次页面显示时，更新当前路径
      this.updateCurrentPath();
    },
  },
  methods: {
    // 根据当前页面路径更新 currentPath
    updateCurrentPath() {
      const pages = getCurrentPages();
      if (pages.length === 0) return;
      
      const currentPage = pages[pages.length - 1];
      // currentPage.route 返回的格式是 'pages/home/index'，不需要加前导斜杠
      const currentPath = currentPage.route;
      
      // 直接更新，确保状态同步
      this.setData({
        currentPath: currentPath,
      });
    },
    switchTab(e) {
      const { path } = e.currentTarget.dataset;
      
      // 如果点击的是当前页面，不执行切换
      if (this.data.currentPath === path) {
        return;
      }
      
      // 切换到对应的 tab 页面，需要加前导斜杠
      wx.switchTab({
        url: '/' + path,
        fail: (err) => {
          console.error('切换页面失败:', err);
          // 切换失败时，恢复正确的状态
          this.updateCurrentPath();
        },
      });
    },
  },
});
