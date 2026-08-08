const { getUserByPhone, adminCoachMonthStats } = require('../../api/tennisDb');

function padMonth(d) {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}

function normPhone(s) {
  const d = String(s || '').replace(/\D/g, '');
  if (d.length >= 11) return d.slice(-11);
  return d;
}

function emptyStats() {
  return {
    experienceCount: 0,
    regularTotal: { count: 0, valueYuan: '0.00' },
    regular1v1: { count: 0, valueYuan: '0.00' },
    regular1v2: { count: 0, valueYuan: '0.00' },
    regularOther: { count: 0, valueYuan: '0.00' },
    other: { count: 0, valueYuan: '0.00' },
  };
}

Page({
  data: {
    scrollHeight: 400,
    coachPhone: '',
    coachName: '',
    displayName: '',
    monthValue: '',
    loaded: false,
    truncated: false,
    stats: emptyStats(),
  },

  onLoad(options) {
    const phone = options && options.phone != null ? decodeURIComponent(String(options.phone)) : '';
    const name = options && options.name != null ? decodeURIComponent(String(options.name)) : '';
    const displayName = (name && String(name).trim()) || phone || '教练';
    this.setData({
      coachPhone: String(phone).trim(),
      coachName: String(name).trim(),
      displayName,
      monthValue: padMonth(new Date()),
    });
  },

  onReady() {
    this.layout();
  },

  onShow() {
    this.ensureAdmin().then((ok) => {
      if (ok && this.data.coachPhone && !this.data.loaded) {
        this.onQuery();
      }
    });
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

  onMonthChange(e) {
    const v = e.detail && e.detail.value ? String(e.detail.value) : '';
    if (v) this.setData({ monthValue: v });
  },

  async onQuery() {
    const coachPhone = String(this.data.coachPhone || '').trim();
    if (!/^1\d{10}$/.test(coachPhone)) {
      wx.showToast({ title: '教练手机号无效', icon: 'none' });
      return;
    }
    const mv = String(this.data.monthValue || '').trim();
    const parts = mv.split('-');
    if (parts.length < 2) {
      wx.showToast({ title: '请选择月份', icon: 'none' });
      return;
    }
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);
    if (!Number.isFinite(year) || !Number.isFinite(month)) {
      wx.showToast({ title: '月份无效', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '统计中', mask: true });
    try {
      const resCoach = await adminCoachMonthStats({ year, month });
      wx.hideLoading();
      const rc = (resCoach && resCoach.result) || {};
      if (!rc.ok || !rc.data) {
        wx.showToast({ title: rc.errMsg || '统计失败', icon: 'none' });
        this.setData({ loaded: true, stats: emptyStats(), truncated: false });
        return;
      }
      const coaches = Array.isArray(rc.data.coaches) ? rc.data.coaches : [];
      const targetPn = normPhone(coachPhone);
      const row =
        coaches.find((c) => normPhone(c.phone) === targetPn) ||
        coaches.find((c) => String(c.phone || '').trim() === coachPhone) ||
        null;

      const s = row && row.stats ? row.stats : null;
      const experienceCount = s && s.experience ? Math.floor(Number(s.experience.count) || 0) : 0;
      const pick = (key) => {
        const block = s && s[key] ? s[key] : null;
        return {
          count: block ? Math.floor(Number(block.count) || 0) : 0,
          valueYuan: block && block.valueYuan != null ? String(block.valueYuan) : '0.00',
        };
      };

      this.setData({
        loaded: true,
        truncated: !!rc.data.coachBookingTruncated,
        displayName: (row && row.displayName) || this.data.displayName,
        stats: {
          experienceCount,
          regularTotal: pick('regularTotal'),
          regular1v1: pick('regular1v1'),
          regular1v2: pick('regular1v2'),
          regularOther: pick('regularOther'),
          other: pick('other'),
        },
      });
    } catch (e) {
      wx.hideLoading();
      console.warn('adminCoachMonthStats', e);
      wx.showToast({ title: '请部署云函数 adminCoachMonthStats', icon: 'none' });
      this.setData({ loaded: true, stats: emptyStats() });
    }
  },
});
