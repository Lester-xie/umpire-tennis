const {
  getUserByPhone,
  adminVenue,
  adminListMemberAssets,
} = require('../../api/tennisDb');
const { formatLessonKeyDisplay } = require('../../utils/lessonKey');

const TAB_TYPES = ['balance', 'session_card', 'course_hours'];

Page({
  data: {
    scrollHeight: 400,
    loading: false,
    activeTab: 0,
    tabLabels: ['余额查询', '次卡查询', '课时查询'],
    venueOptions: [],
    venueNames: ['全部场馆'],
    venueIndex: 0,
    selectedVenueId: '',
    selectedVenueName: '全部场馆',
    list: [],
    summaryText: '',
    emptyHint: '暂无数据',
  },

  onShow() {
    this.ensureAdmin().then((ok) => {
      if (!ok) return;
      this.loadVenues().then(() => this.loadList());
    });
  },

  onReady() {
    this.layout();
  },

  layout() {
    const windowInfo = wx.getWindowInfo();
    const query = wx.createSelectorQuery();
    query.select('.header-wrapper').boundingClientRect();
    query.exec((res) => {
      const headerRect = res && res[0];
      const app = getApp();
      const pad = app?.globalData?.screenInfo?.headerInfo?.headerPaddingTop || 0;
      const headerH = headerRect && headerRect.height > 0 ? headerRect.height : pad + 55;
      const safeBottom = windowInfo.safeArea
        ? windowInfo.screenHeight - windowInfo.safeArea.bottom
        : 0;
      const scrollHeight = Math.max(300, windowInfo.windowHeight - headerH - safeBottom - 8);
      this.setData({ scrollHeight });
    });
  },

  async ensureAdmin() {
    const phone = String(wx.getStorageSync('user_phone') || '').trim();
    if (!phone) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 800);
      return false;
    }
    try {
      const res = await getUserByPhone(phone);
      const u = res && res.data && res.data[0];
      if (!u || !u.isManager) {
        wx.showModal({
          title: '无权限',
          content: '当前账号不是管理员。',
          showCancel: false,
          success: () => wx.navigateBack(),
        });
        return false;
      }
      return true;
    } catch (e) {
      wx.showToast({ title: '校验失败', icon: 'none' });
      return false;
    }
  },

  async loadVenues() {
    try {
      const cloudRes = await adminVenue({ action: 'list' });
      const r = (cloudRes && cloudRes.result) || {};
      if (!r.ok || !Array.isArray(r.data)) {
        this.setData({
          venueOptions: [],
          venueNames: ['全部场馆'],
          venueIndex: 0,
          selectedVenueId: '',
          selectedVenueName: '全部场馆',
        });
        return;
      }
      const venueOptions = r.data
        .map((v) => ({
          id: v._id != null ? String(v._id).trim() : '',
          name: v.name != null ? String(v.name).trim() : '',
        }))
        .filter((v) => v.id);
      const venueNames = ['全部场馆', ...venueOptions.map((v) => v.name || v.id)];
      this.setData({
        venueOptions,
        venueNames,
        venueIndex: 0,
        selectedVenueId: '',
        selectedVenueName: '全部场馆',
      });
    } catch (e) {
      console.warn('loadVenues', e);
    }
  },

  onTabTap(e) {
    const idx = Number(e.currentTarget.dataset.index);
    if (!Number.isFinite(idx) || idx === this.data.activeTab) return;
    this.setData({ activeTab: idx }, () => this.loadList());
  },

  onVenuePick(e) {
    const idx = Number(e.detail.value);
    if (!Number.isFinite(idx) || idx < 0) return;
    if (idx === 0) {
      this.setData(
        {
          venueIndex: 0,
          selectedVenueId: '',
          selectedVenueName: '全部场馆',
        },
        () => this.loadList()
      );
      return;
    }
    const venue = this.data.venueOptions[idx - 1];
    if (!venue) return;
    this.setData(
      {
        venueIndex: idx,
        selectedVenueId: venue.id,
        selectedVenueName: venue.name || venue.id,
      },
      () => this.loadList()
    );
  },

  async loadList() {
    const type = TAB_TYPES[this.data.activeTab] || 'balance';
    this.setData({ loading: true });
    try {
      const payload = { type };
      if (this.data.selectedVenueId) {
        payload.venueId = this.data.selectedVenueId;
      }
      const cloudRes = await adminListMemberAssets(payload);
      const r = (cloudRes && cloudRes.result) || {};
      if (!r.ok) {
        wx.showToast({ title: r.errMsg || '加载失败', icon: 'none' });
        this.setData({
          loading: false,
          list: [],
          summaryText: '',
          emptyHint: r.errMsg || '加载失败',
        });
        return;
      }
      const raw = Array.isArray(r.data) ? r.data : [];
      const list = raw.map((row, i) => this.mapRow(row, type, i));
      const summaryText = this.buildSummary(list, type);
      this.setData({
        loading: false,
        list,
        summaryText,
        emptyHint: this.emptyHintFor(type),
      });
    } catch (e) {
      console.warn('loadList', e);
      this.setData({
        loading: false,
        list: [],
        summaryText: '',
        emptyHint: '请先部署云函数 adminListMemberAssets',
      });
      wx.showToast({ title: '请部署云函数 adminListMemberAssets', icon: 'none' });
    }
  },

  mapRow(row, type, index) {
    const phone = String(row.phone || '').trim();
    const name = row.name != null ? String(row.name).trim() : '';
    const displayName = String(row.displayName || name || phone || '会员').trim();
    const venueName = String(row.venueName || row.venueId || '未知场馆').trim();
    const roleTag = String(row.roleTag || '').trim();
    const base = {
      key: `${type}-${phone}-${row.venueId || ''}-${row.lessonKey || ''}-${index}`,
      phone,
      displayName,
      venueName,
      roleTag,
    };
    if (type === 'balance') {
      const balanceYuan = Number(row.balanceYuan);
      const n = Number.isFinite(balanceYuan) ? balanceYuan : 0;
      return {
        ...base,
        remainingNum: n,
        valueLabel: `¥ ${n % 1 === 0 ? n : n.toFixed(2)}`,
        valueHint: '剩余余额',
      };
    }
    if (type === 'session_card') {
      const times = Math.max(0, Math.floor(Number(row.remainingTimes) || 0));
      return {
        ...base,
        remainingNum: times,
        valueLabel: `${times} 次`,
        valueHint: '剩余次数',
      };
    }
    const hours = Math.max(0, Math.floor(Number(row.hours) || 0));
    const lessonLabel = formatLessonKeyDisplay(row.lessonKey);
    return {
      ...base,
      remainingNum: hours,
      valueLabel: `${hours} 课时`,
      valueHint: lessonLabel,
      lessonLabel,
    };
  },

  buildSummary(list, type) {
    const n = list.length;
    const total = list.reduce((sum, row) => sum + (Number(row.remainingNum) || 0), 0);
    if (type === 'balance') {
      const totalText = total % 1 === 0 ? String(total) : total.toFixed(2);
      return `共 ${n} 条 · 余额合计 ¥ ${totalText}`;
    }
    if (type === 'session_card') {
      return `共 ${n} 条 · 剩余合计 ${total} 次`;
    }
    return `共 ${n} 条 · 剩余合计 ${total} 课时`;
  },

  emptyHintFor(type) {
    if (type === 'balance') return '暂无仍有余额的用户';
    if (type === 'session_card') return '暂无仍有次卡次数的用户';
    return '暂无仍有课时的用户';
  },

  onTapRow(e) {
    const phone = e.currentTarget.dataset.phone;
    if (!phone) return;
    wx.navigateTo({
      url: `/pages/admin-users/index?phone=${encodeURIComponent(phone)}`,
    });
  },
});
