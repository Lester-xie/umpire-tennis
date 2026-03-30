// pages/components/header.js
Component({

  /**
   * 组件的属性列表
   */
  properties: {
    // 是否显示返回按钮
    showBackButton: {
      type: Boolean,
      value: false,
    },
    // 标题文案，不传则使用 app.globalData.brand
    title: {
      type: String,
      value: '',
    },
    // 是否显示「选择球场」按钮，点击进入定位选球场页
    showLocationButton: {
      type: Boolean,
      value: false,
    },
    // 是否显示「切换账号」按钮（与 back-button 同位置、同样式）
    showSwitchAccountButton: {
      type: Boolean,
      value: false,
    },
  },

  observers: {
    title(v) {
      if (v != null && v !== this.data.title) {
        this.setData({ title: String(v).trim() || (getApp() && getApp().globalData.brand) || '昂湃网球' });
      }
    },
  },

  data: {
    headerInfo: {},
  },

  /**
   * 组件的方法列表
   */
  methods: {
    handleBack() {
      wx.navigateBack();
    },
    handleSwitchAccount() {
      this.triggerEvent('switchaccount', {});
    },
    handleLocationTap() {
      wx.navigateTo({ url: '/pages/location/index' });
    },
  },
  attached: function () {
    const app = getApp();
    const customTitle = this.properties.title;
    const title = (customTitle && customTitle.trim()) ? customTitle.trim() : (app && app.globalData.brand) || '昂湃网球';
    if (app) {
      const { headerInfo } = app.globalData.screenInfo || {};
      this.setData({
        headerInfo: headerInfo || {},
        title,
      });
    } else {
      this.setData({ title });
    }
  },
});
