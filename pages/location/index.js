const STORAGE_KEYS = {
  selectedVenue: 'selected_venue',
};

// 球场列表（可扩展多个，按距离排序）
const VENUES = [
  {
    id: 'angpai_1950',
    name: '昂湃网球学练馆',
    address: '贵州省贵阳市云岩区友谊路新印厂1950T2栋5楼',
    latitude: 26.5889,
    longitude: 106.7153,
    image: '/assets/images/court1.jpg',
  },
  {
    id: 'angpai_guanshan',
    name: '昂湃网球 · 观山悦',
    address: '贵州省贵阳市观山湖区天一观山悦',
    latitude: 26.646,
    longitude: 106.595,
    image: '/assets/images/court2.jpg',
  },
];

// 地图中心：贵州省贵阳市云岩区友谊路新印厂1950T2栋5楼（昂湃网球学练馆）
const MAP_CENTER_LAT = 26.5889;
const MAP_CENTER_LON = 106.7153;
const MAP_SCALE = 16;

Page({
  data: {
    headerTitle: '选择球场',
    headerHeight: 0,
    venues: VENUES,
    selectedVenueId: '', // 当前选中的球场 id，用于高亮 list-item
    userLocation: null,
    mapLatitude: MAP_CENTER_LAT,
    mapLongitude: MAP_CENTER_LON,
    mapScale: MAP_SCALE,
    mapMarkers: [],
  },

  onLoad() {
    const app = getApp();
    const selected = wx.getStorageSync(STORAGE_KEYS.selectedVenue);
    const pages = getCurrentPages();
    // 仅在小程序冷启动且首屏是 location 时：已选过球场则直接进首页
    const isFirstPage = pages.length === 1;
    if (isFirstPage && selected && selected.id) {
      app.globalData.selectedVenue = selected;
      wx.switchTab({ url: '/pages/home/index' });
      return;
    }
    const selectedVenueId = (selected && selected.id) ? selected.id : '';
    this.setMapMarkers(selectedVenueId);
    this.setData({ venues: VENUES, selectedVenueId });
    this.getUserLocation();
  },

  onShow() {
    const selected = wx.getStorageSync(STORAGE_KEYS.selectedVenue);
    const selectedVenueId = (selected && selected.id) ? selected.id : '';
    if (selectedVenueId !== this.data.selectedVenueId) {
      this.setData({ selectedVenueId });
      this.setMapMarkers(selectedVenueId);
    }
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
    const markers = VENUES.map((v, i) => ({
      id: i + 1,
      latitude: v.latitude,
      longitude: v.longitude,
      title: v.name,
      width: 32,
      height: 32,
    }));
    const selected = selectedVenueId ? VENUES.find((v) => v.id === selectedVenueId) : null;
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
        this.setData({ venues: VENUES });
      },
    });
  },

  updateDistances() {
    const { userLocation } = this.data;
    if (!userLocation) return;
    const venues = VENUES.map((v) => {
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
    const venue = VENUES.find((v) => v.id === id);
    if (!venue) return;
    this.setData({
      mapLatitude: venue.latitude,
      mapLongitude: venue.longitude,
      selectedVenueId: id,
    });
    wx.setStorageSync(STORAGE_KEYS.selectedVenue, venue);
    getApp().globalData.selectedVenue = venue;
    wx.switchTab({ url: '/pages/home/index' });
  },
});
