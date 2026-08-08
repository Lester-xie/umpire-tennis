/**
 * 普通订场支付：团购券 / 月卡免费 / 次卡 / 储值余额
 */
const {
  listMemberVenueBalance,
  listMemberVenueMonthCard,
  listMemberVenueSessionCard,
  getVenues,
} = require('../../../api/tennisDb');
const {
  getUncoveredSlotPrices,
  findMatchingSlot,
  recalcVoucherPayment,
  defaultCourtPayMethod,
} = require('../../../utils/bookingVoucherMatch');
const { roundYuan } = require('../../../utils/storedValuePlans');
const { normalizeVenueId } = require('../../../utils/venueId');
const {
  normalizeMonthCard,
  monthCardWindowLabel,
  pickMonthCardFreeSlot,
} = require('../../../utils/monthCard');
const { calcCourtPayAmounts } = require('./helpers');

module.exports = Behavior({
  methods: {
    recalcBookingVoucherTotals(bookingVouchers) {
      const pay = recalcVoucherPayment(this.data.totalPrice, bookingVouchers);
      this.setData({
        bookingVouchers,
        voucherDeductionYuan: pay.voucherDeductionYuan,
        cashDueYuan: pay.cashDueYuan,
      }, () => this.recomputeCourtPayAmounts());
    },

    recomputeCourtPayAmounts() {
      if (this.data.orderType !== 'court' || this.data.isCoachCourseOrder) return;
      const patch = calcCourtPayAmounts({
        totalPriceYuan: this.data.totalPrice,
        bookingVouchers: this.data.bookingVouchers,
        courtPayMethod: this.data.courtPayMethod,
        venueStoredBalanceYuan: this.data.venueStoredBalanceYuan,
        monthCardUseFree: this.data.monthCardUseFree,
        monthCardConfig: this._monthCardConfig,
        courtOrderSlotPrices: this.data.courtOrderSlotPrices,
        sessionCardRemainingTimes: this.data.sessionCardRemainingTimes,
        sessionCardUse: this.data.sessionCardUse,
      });
      this.setData(patch, () => this.updateFooterButtonText());
    },

    toggleMonthCardFree() {
      if (!this.data.monthCardEligible || this.data.monthCardFreeUsedToday) return;
      const next = !this.data.monthCardUseFree;
      this.setData({ monthCardUseFree: next }, () => this.recomputeCourtPayAmounts());
    },

    toggleSessionCardUse() {
      if (Math.floor(Number(this.data.sessionCardRemainingTimes) || 0) <= 0) return;
      const next = !this.data.sessionCardUse;
      // 开启次卡时与「仅微信支付」互斥：取消微信选中态（余款仍可走微信，但不与次卡同时高亮）
      const patch = { sessionCardUse: next };
      if (next && this.data.courtPayMethod === 'wechat') {
        patch.courtPayUserChose = false;
      }
      this.setData(patch, () => this.recomputeCourtPayAmounts());
    },

    selectCourtPayMethod(e) {
      const method = e.currentTarget.dataset.method;
      if (method !== 'wechat' && method !== 'stored_balance' && method !== 'mixed_balance') return;
      const bal = roundYuan(this.data.venueStoredBalanceYuan);
      const due = roundYuan(this.data.cashDueYuan);
      if (method === 'stored_balance' && bal < due) return;
      if (method === 'mixed_balance' && !(bal > 0 && bal < due)) return;
      const patch = { courtPayMethod: method, courtPayUserChose: true };
      // 选「仅微信支付」时关闭次卡，二者互斥
      if (method === 'wechat') {
        patch.sessionCardUse = false;
      }
      this.setData(patch, () => {
        this.recomputeCourtPayAmounts();
      });
    },

    onAddBookingVoucher() {
      if (this.data.orderType !== 'court' || this.data.isCoachCourseOrder) return;
      const app = getApp();
      if (!app || !app.checkLogin()) {
        wx.showModal({
          title: '请先登录',
          content: '添加团购券需先登录并授权手机号',
          confirmText: '去登录',
          cancelText: '取消',
          success: (res) => {
            if (res.confirm) {
              wx.switchTab({ url: '/pages/profile/index' });
            }
          },
        });
        return;
      }
      const uncovered = getUncoveredSlotPrices(
        this.data.courtSlotPrices,
        this.data.bookingVouchers,
      );
      if (!uncovered.length) {
        wx.showToast({ title: '所有时段已添加团购券', icon: 'none' });
        return;
      }
      if (this.data.bookingVouchers.length >= this.data.bookedSlots.length) {
        wx.showToast({ title: '每张券仅可抵扣1小时', icon: 'none' });
        return;
      }
      wx.navigateTo({
        url: '/pages/order-voucher-verify/index',
        events: {
          voucherAdded: (data) => this.applyBookingVoucher(data),
        },
        success: (res) => {
          res.eventChannel.emit('initData', {
            allowedPrices: uncovered,
            usedReceiptCodes: (this.data.bookingVouchers || []).map((v) => ({
              platform: v.platform,
              receiptCode: v.receiptCode,
            })),
          });
        },
      });
    },

    applyBookingVoucher(data) {
      if (!data) return;
      const slot = findMatchingSlot(
        this.data.courtSlotPrices,
        this.data.bookingVouchers,
        data.priceYuan,
      );
      if (!slot) {
        wx.showToast({ title: '该券无可用时段', icon: 'none' });
        return;
      }
      const voucher = {
        platform: data.platform,
        platformLabel: data.platformLabel || (data.platform === 2 ? '抖音' : '美团'),
        receiptCode: data.receiptCode,
        receiptCodeDisplay: data.receiptCodeDisplay || data.receiptCode,
        ticketName: data.ticketName || '',
        priceYuan: data.priceYuan,
        dealId: data.dealId != null ? String(data.dealId) : '',
        dealGroupId: data.dealGroupId != null ? String(data.dealGroupId) : '',
        ticketInfo: data.ticketInfo || '',
        slotKey: slot.slotKey,
        timeLabel: slot.timeLabel,
      };
      this.recalcBookingVoucherTotals([...(this.data.bookingVouchers || []), voucher]);
    },

    onRemoveBookingVoucher(e) {
      const idx = Number(e.currentTarget.dataset.index);
      if (!Number.isFinite(idx) || idx < 0) return;
      const list = [...(this.data.bookingVouchers || [])];
      list.splice(idx, 1);
      this.recalcBookingVoucherTotals(list);
    },

    async loadMonthCardBenefit() {
      if (this.data.orderType !== 'court' || this.data.isCoachCourseOrder || !this.data.venueId) {
        return;
      }
      const app = getApp();
      if (!app || !app.checkLogin()) {
        this._monthCardConfig = null;
        this.setData({
          monthCardEligible: false,
          monthCardUseFree: false,
          monthCardFreeUsedToday: false,
          monthCardHint: '',
          monthCardWindowLabel: '',
          monthCardDeductYuan: 0,
          monthCardFreeSlotKey: '',
        }, () => this.recomputeCourtPayAmounts());
        return;
      }
      try {
        let venueMonthCard = null;
        const selected = app.globalData && app.globalData.selectedVenue;
        if (selected && normalizeVenueId(selected.id) === normalizeVenueId(this.data.venueId)) {
          venueMonthCard = normalizeMonthCard(selected.monthCard);
        }
        if (!venueMonthCard) {
          const venuesRes = await getVenues();
          const rows = (venuesRes && venuesRes.data) || [];
          const hit = rows.find((v) => normalizeVenueId(v._id) === normalizeVenueId(this.data.venueId));
          venueMonthCard = normalizeMonthCard(hit && hit.monthCard);
        }
        this._monthCardConfig = venueMonthCard;

        const mcRes = await listMemberVenueMonthCard({
          venueId: this.data.venueId,
          orderDate: this.data.orderDate,
        });
        const result = (mcRes && mcRes.result) || {};
        const rows = Array.isArray(result.data) ? result.data : [];
        const row = rows[0];
        const active = !!(row && Number(row.expiresAt) > Date.now());
        const freeUsedOnDate = !!result.freeUsedOnDate;
        const windowSlots = pickMonthCardFreeSlot(
          this.data.courtOrderSlotPrices,
          [],
          venueMonthCard,
        );
        const eligible = !!(active && venueMonthCard && windowSlots);
        let monthCardHint = '';
        if (active && venueMonthCard && !windowSlots) {
          monthCardHint = `月卡生效时段为 ${monthCardWindowLabel(venueMonthCard)}，当前所选时段不可用免费小时`;
        } else if (active && freeUsedOnDate) {
          monthCardHint = '当日月卡免费 1 小时已使用';
        } else if (eligible) {
          monthCardHint = `生效时段 ${monthCardWindowLabel(venueMonthCard)}，每天可免费订 1 小时`;
        }

        const useFree = eligible && !freeUsedOnDate && this.data.monthCardUseFree;
        this.setData({
          monthCardEligible: eligible && !freeUsedOnDate,
          monthCardFreeUsedToday: freeUsedOnDate,
          monthCardUseFree: useFree,
          monthCardWindowLabel: venueMonthCard ? monthCardWindowLabel(venueMonthCard) : '',
          monthCardHint,
        }, () => this.recomputeCourtPayAmounts());
      } catch (e) {
        console.error('loadMonthCardBenefit', e);
        this._monthCardConfig = null;
        this.setData({
          monthCardEligible: false,
          monthCardHint: '',
        }, () => this.recomputeCourtPayAmounts());
      }
    },

    async loadVenueStoredBalance() {
      if (this.data.orderType !== 'court' || this.data.isCoachCourseOrder || !this.data.venueId) return;
      const app = getApp();
      if (!app || !app.checkLogin()) {
        this.setData({
          venueStoredBalanceYuan: 0,
          venueStoredBalanceReady: false,
          venueStoredBalanceHint: '请登录后查看本场馆储值余额',
          courtPayMethod: 'wechat',
        }, () => this.recomputeCourtPayAmounts());
        return;
      }
      try {
        const res = await listMemberVenueBalance({ venueId: this.data.venueId });
        const rows = (res && res.result && res.result.data) || [];
        const row = rows[0];
        const balance = roundYuan(row && row.balanceYuan);
        const defaultMethod = () =>
          defaultCourtPayMethod({
            cashDueYuan: this.data.cashDueYuan || this.data.totalPrice,
            storedBalanceYuan: balance,
          });
        let courtPayMethod = this.data.courtPayMethod;
        if (!this.data.courtPayUserChose) {
          courtPayMethod = defaultMethod();
        } else if (courtPayMethod === 'stored_balance' && balance < roundYuan(this.data.cashDueYuan)) {
          courtPayMethod = balance > 0 ? 'mixed_balance' : 'wechat';
        } else if (courtPayMethod === 'mixed_balance' && !(balance > 0 && balance < roundYuan(this.data.cashDueYuan))) {
          courtPayMethod = defaultMethod();
        }
        this.setData({
          venueStoredBalanceYuan: balance,
          venueStoredBalanceReady: true,
          venueStoredBalanceHint: '',
          courtPayMethod,
        }, () => this.recomputeCourtPayAmounts());
      } catch (e) {
        console.error('loadVenueStoredBalance', e);
        this.setData({
          venueStoredBalanceReady: false,
          venueStoredBalanceHint: '储值余额加载失败',
        });
      }
    },

    async loadVenueSessionCard() {
      if (this.data.orderType !== 'court' || this.data.isCoachCourseOrder || !this.data.venueId) {
        return;
      }
      const app = getApp();
      if (!app || !app.checkLogin()) {
        this.setData({
          sessionCardRemainingTimes: 0,
          sessionCardUse: false,
          sessionCardHint: '请登录后查看本场馆次卡',
        }, () => this.recomputeCourtPayAmounts());
        return;
      }
      try {
        const res = await listMemberVenueSessionCard({ venueId: this.data.venueId });
        const rows = (res && res.result && res.result.data) || [];
        const row = rows[0];
        const remaining = Math.max(0, Math.floor(Number(row && row.remainingTimes) || 0));
        const use = remaining > 0 ? this.data.sessionCardUse !== false : false;
        this.setData({
          sessionCardRemainingTimes: remaining,
          sessionCardUse: use,
          sessionCardHint: remaining > 0 ? '订场时每次抵扣 1 小时，教练课不可用' : '',
        }, () => this.recomputeCourtPayAmounts());
      } catch (e) {
        console.error('loadVenueSessionCard', e);
        this.setData({
          sessionCardRemainingTimes: 0,
          sessionCardHint: '次卡加载失败',
        }, () => this.recomputeCourtPayAmounts());
      }
    },
  },
});
