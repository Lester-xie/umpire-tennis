const STORAGE_KEYS = {
  selectedVenue: 'selected_venue',
};

// 地图中心：贵州省贵阳市云岩区友谊路新印厂1950T2栋5楼（昂湃网球学练馆）
const MAP_CENTER_LAT = 26.5889;
const MAP_CENTER_LON = 106.7153;
const MAP_SCALE = 16;

const { getVenues } = require('../../api/tennisDb');
const { venueIdLooseEqual } = require('../../utils/venueId');

Page({
  data: {
    headerTitle: '选择球场',
    headerHeight: 0,
    venues: [],
    selectedVenueId: '', // 当前选中的球场 id，用于高亮 list-item
    userLocation: null,
    mapLatitude: MAP_CENTER_LAT,
    mapLongitude: MAP_CENTER_LON,
    mapScale: MAP_SCALE,
    mapMarkers: [],
    lottieLoadingVisible: false,
  },
  _loadingTaskCount: 0,

  onLoad(options) {
    /** 从预订页进入：选场后 navigateBack，不跳首页 */
    this.returnToBooking = !!(options && options.from === 'booking');

    const selected = wx.getStorageSync(STORAGE_KEYS.selectedVenue) || null;
    const selectedVenueId = (selected && selected.id) ? selected.id : '';

    const app = getApp();
    const pages = getCurrentPages();
    // 仅在小程序冷启动且首屏是 location 时：已选过球场则直接进首页
    const isFirstPage = pages.length === 1;

    this.beginLoading('加载场馆中');
    this.loadVenues()
      .then((venues) => {
        this.setData({ venues });

        // 如果是冷启动首屏且已有选择：直接跳首页（但仍确保全局数据在字段上是完整的）
        if (isFirstPage && selectedVenueId) {
          const matched = venues.find((v) => v.id === selectedVenueId);
          if (matched) {
            app.globalData.selectedVenue = matched;
            wx.switchTab({ url: '/pages/home/index' });
            return;
          }
        }

        this.setData({ selectedVenueId });
        this.setMapMarkers(selectedVenueId);
        this.getUserLocation();
      })
      .catch((err) => {
        console.error('loadVenues failed', err);
        // 兜底：即使拉取失败，也保留页面可用（只是不展示具体场馆列表）
        this.setData({ venues: [], selectedVenueId });
        this.setMapMarkers(selectedVenueId);
        this.getUserLocation();
      })
      .finally(() => {
        this.endLoading();
      });
  },

  onUnload() {
    this._loadingTaskCount = 0;
    this.setData({ lottieLoadingVisible: false });
  },

  onShow() {
    const selected = wx.getStorageSync(STORAGE_KEYS.selectedVenue);
    const selectedVenueId = (selected && selected.id) ? selected.id : '';
    if (selectedVenueId !== this.data.selectedVenueId) {
      this.setData({ selectedVenueId });
      this.setMapMarkers(selectedVenueId);
    }
    const curId = selectedVenueId || this.data.selectedVenueId;
    this.loadVenues()
      .then((venues) => {
        this.setData({ venues });
        const app = getApp();
        if (curId) {
          const matched = venues.find((v) => venueIdLooseEqual(v.id, curId));
          if (matched) {
            app.globalData.selectedVenue = matched;
            try {
              wx.setStorageSync(STORAGE_KEYS.selectedVenue, matched);
            } catch (e) {
              console.warn('location onShow persist venue', e);
            }
          }
        }
        this.setMapMarkers(curId);
        if (this.data.userLocation) {
          this.updateDistances();
        }
      })
      .catch((err) => {
        console.warn('location onShow loadVenues', err);
      });
  },

  onReady() {
    this.calculateHeaderHeight();
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
        const paddingTop = app?.globalData?.screenInfo?.headerInfo?.headerPaddingTop || 0;
        this.setData({ headerHeight: paddingTop + 55 });
      }
    });
  },

  setMapMarkers(selectedVenueId) {
    const venues = this.data.venues || [];
    const markers = venues.map((v, idx) => ({
      // map 组件要求 markers[].id 为数字
      id: idx + 1,
      latitude: v.latitude,
      longitude: v.longitude,
      title: v.name,
      width: 32,
      height: 32,
    }));
    const selected = selectedVenueId ? venues.find((v) => v.id === selectedVenueId) : null;
    const lat = selected ? selected.latitude : MAP_CENTER_LAT;
    const lon = selected ? selected.longitude : MAP_CENTER_LON;
    this.setData({
      mapMarkers: markers,
      mapLatitude: lat,
      mapLongitude: lon,
      mapScale: MAP_SCALE,
    });
  },

  getUserLocation() {
    wx.getLocation({
      type: 'wgs84',
      success: (res) => {
        const userLoc = { latitude: res.latitude, longitude: res.longitude };
        this.setData({ userLocation: userLoc });
        this.setMapMarkers(this.data.selectedVenueId);
        this.updateDistances();
      },
      fail: () => {
        // 仅保留当前 venues，不强制覆盖
      },
    });
  },

  updateDistances() {
    const { userLocation } = this.data;
    if (!userLocation) return;
    const venues = (this.data.venues || []).map((v) => {
      const km = this.calcDistanceKm(userLocation.latitude, userLocation.longitude, v.latitude, v.longitude);
      const distanceText = km < 1 ? (km * 1000).toFixed(0) + 'm' : km.toFixed(1) + 'km';
      return { ...v, distanceKm: km, distanceText };
    });
    venues.sort((a, b) => a.distanceKm - b.distanceKm);
    this.setData({ venues });
  },

  calcDistanceKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  },

  onSelectVenue(e) {
    const id = e.currentTarget.dataset.id;
    const venue = (this.data.venues || []).find((v) => v.id === id);
    if (!venue) return;
    this.setData({
      mapLatitude: venue.latitude,
      mapLongitude: venue.longitude,
      selectedVenueId: id,
    });
    wx.setStorageSync(STORAGE_KEYS.selectedVenue, venue);
    getApp().globalData.selectedVenue = venue;
    if (this.returnToBooking) {
      wx.navigateBack();
      return;
    }
    wx.switchTab({ url: '/pages/home/index' });
  },

  async loadVenues() {
    const res = await getVenues();
    const docs = res && res.data ? res.data : [];

    return docs.map((v, idx) => {
      const id = v.id || v.venueId || v._id || String(v._id || idx);
      const image =
        v.image ||
        (idx % 2 === 0 ? '/assets/images/court1.jpg' : '/assets/images/court2.jpg');

      return {
        id,
        name: v.name || '',
        address: v.address || '',
        latitude: v.latitude,
        longitude: v.longitude,
        image,
        // 场地列表：name + priceList（14 个时段，对应 8:00–21:00 每小时单价，至 22:00 结束）
        courtList: Array.isArray(v.courtList) ? v.courtList : [],
      };
    });
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
