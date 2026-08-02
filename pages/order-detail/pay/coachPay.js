/**
 * 教练课支付：课时 / 组合 / 微信
 */
const { listMemberCourseHours } = require('../../../api/tennisDb');
const {
  isCoachWechatOnlyLessonKey,
  computeCoachSlotPrices,
  calcCoachPayAmounts,
} = require('./helpers');

module.exports = Behavior({
  methods: {
    selectPayMethod(e) {
      const method = e.currentTarget.dataset.method;
      if (method !== 'course_hours' && method !== 'wechat' && method !== 'mixed') return;
      if (this.data.coachPayWechatOnly && method !== 'wechat') {
        wx.showToast({ title: '团课/畅打仅支持微信支付', icon: 'none' });
        return;
      }
      const need = this.data.requiredCourseHours || 0;
      const bal = Math.floor(Number(this.data.courseHoursBalance) || 0);
      if (method === 'course_hours') {
        if (bal < need) return;
      }
      if (method === 'mixed') {
        if (!(bal > 0 && bal < need)) return;
      }
      this.setData({ payMethod: method, coachPayUserChose: true }, () => {
        this.recomputeCoachPayAmounts();
        this.updateFooterButtonText();
      });
    },

    computeCoachSlotPrices(selectedSlots, courts) {
      return computeCoachSlotPrices(selectedSlots, courts);
    },

    recomputeCoachPayAmounts() {
      if (!this.data.isCoachCourseOrder) return;
      const patch = calcCoachPayAmounts({
        isCoachCourseOrder: this.data.isCoachCourseOrder,
        requiredCourseHours: this.data.requiredCourseHours,
        courseHoursBalance: this.data.courseHoursBalance,
        coachSlotPrices: this.data.coachSlotPrices,
        totalPrice: this.data.totalPrice,
        payMethod: this.data.payMethod,
      });
      this.setData(patch);
    },

    async loadCoachCourseHoursBalance() {
      if (!this.data.isCoachCourseOrder || !this.data.lessonKey) return;
      if (
        this.data.coachPayWechatOnly ||
        isCoachWechatOnlyLessonKey(this.data.lessonKey)
      ) {
        this.setData(
          {
            coachPayWechatOnly: true,
            courseHoursBalance: 0,
            payMethod: 'wechat',
            coachPayUserChose: false,
            coachCourseBalanceReady: true,
            coachCourseBalanceHint: '',
            coachHoursDeductForPay: 0,
            comboCashYuan: Number(this.data.totalPrice) || 0,
          },
          () => {
            this.recomputeCoachPayAmounts();
            this.updateFooterButtonText();
          },
        );
        return;
      }
      const app = getApp();
      if (!app || !app.checkLogin()) {
        this.setData(
          {
            courseHoursBalance: 0,
            payMethod: 'wechat',
            coachPayUserChose: false,
            coachCourseBalanceReady: false,
            coachCourseBalanceHint: '请登录后查看本场馆该课程类型的剩余课时',
          },
          () => {
            this.recomputeCoachPayAmounts();
            this.updateFooterButtonText();
          },
        );
        return;
      }
      const venueId = String(this.data.venueId || '').trim();
      if (!venueId) {
        this.setData({
          coachCourseBalanceReady: false,
          coachCourseBalanceHint: '缺少场馆信息，无法查询课时',
        });
        return;
      }
      this.setData({
        coachCourseBalanceReady: false,
        coachCourseBalanceHint: '加载中...',
      });
      this.beginLoading('加载课时中');
      try {
        const cloudRes = await listMemberCourseHours(venueId);
        const rows =
          cloudRes && cloudRes.result && Array.isArray(cloudRes.result.data)
            ? cloudRes.result.data
            : [];
        let hours = 0;
        const key = this.data.lessonKey;
        rows.forEach((r) => {
          if (String(r.lessonKey || '').trim() === key) {
            hours += Number(r.hours) || 0;
          }
        });
        const need = this.data.requiredCourseHours || 0;
        const bal = Math.floor(Number(hours) || 0);
        const defaultMethod = () => {
          if (need <= 0) return 'wechat';
          if (bal >= need) return 'course_hours';
          if (bal > 0) return 'mixed';
          return 'wechat';
        };
        let payMethod = defaultMethod();
        let nextChose = this.data.coachPayUserChose;
        if (nextChose) {
          const cur = this.data.payMethod;
          if (cur === 'course_hours' && bal < need) {
            payMethod = defaultMethod();
            nextChose = false;
          } else if (cur === 'mixed' && !(bal > 0 && bal < need)) {
            payMethod = defaultMethod();
            nextChose = false;
          } else {
            payMethod = cur;
          }
        }
        this.setData(
          {
            courseHoursBalance: hours,
            payMethod,
            coachPayUserChose: nextChose,
            coachCourseBalanceReady: true,
            coachCourseBalanceHint: '',
          },
          () => {
            this.recomputeCoachPayAmounts();
            this.updateFooterButtonText();
          },
        );
      } catch (e) {
        console.error('loadCoachCourseHoursBalance', e);
        this.setData({
          coachCourseBalanceReady: false,
          coachCourseBalanceHint: '课时加载失败，请稍后重试',
        });
        this.updateFooterButtonText();
      } finally {
        this.endLoading();
      }
    },
  },
});
