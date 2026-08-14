/**
 * 拉起支付 / 全额抵扣提交 / 课时提交
 */
const {
  completeCoachBookingWithHours,
  completeCourtBookingWithVouchers,
  requestWechatPay,
  abandonCheckoutPayment,
  markProfileSummaryStale,
} = require('../../../api/tennisDb');
const { formatLessonKeyDisplay } = require('../../../utils/lessonKey');
const { roundYuan, formatYuanText } = require('../../../utils/storedValuePlans');
const { STORAGE_KEYS, BOOKING_SUCCESS_STORAGE_KEY } = require('./constants');
const {
  isCoachWechatOnlyLessonKey,
  buildGoodsPurchasePayload,
  buildCourtBookingPayload,
} = require('./helpers');

module.exports = Behavior({
  methods: {
    updateFooterButtonText() {
      const app = getApp();
      if (!app.checkLogin()) {
        this.setData({ footerButtonText: '去登录' });
        return;
      }
      if (this.data.orderType === 'court' && this.data.isCoachCourseOrder) {
        if (this.data.coachSessionRosterReady && this.data.coachSessionFull) {
          this.setData({ footerButtonText: '名额已满' });
          return;
        }
        if (this.data.coachSessionRosterReady && this.data.coachViewerAlreadyJoined) {
          this.setData({ footerButtonText: '您已在名单中' });
          return;
        }
        if (this.data.payMethod === 'course_hours') {
          const h = this.data.requiredCourseHours || 0;
          this.setData({ footerButtonText: `确认使用课时（${h} 小时）` });
          return;
        }
        if (this.data.payMethod === 'mixed') {
          const y = this.data.comboCashYuan;
          this.setData({ footerButtonText: `微信支付 ¥${y}` });
          return;
        }
        this.setData({ footerButtonText: '微信支付' });
        return;
      }
      if (this.data.orderType === 'court' && !this.data.isCoachCourseOrder) {
        const wechatDue = roundYuan(this.data.wechatDueYuan);
        const balanceDeduct = roundYuan(this.data.storedBalanceDeductYuan);
        const monthCardDeduct = roundYuan(this.data.monthCardDeductYuan);
        const sessionTimes = Math.floor(Number(this.data.sessionCardDeductTimes) || 0);
        if (wechatDue <= 0.009) {
          if (balanceDeduct > 0 && (this.data.bookingVouchers || []).length > 0) {
            this.setData({ footerButtonText: '确认支付（券+储值）' });
            return;
          }
          if (balanceDeduct > 0 && monthCardDeduct > 0) {
            this.setData({ footerButtonText: '确认支付（月卡+储值）' });
            return;
          }
          if (balanceDeduct > 0 && sessionTimes > 0) {
            this.setData({ footerButtonText: '确认支付（次卡+储值）' });
            return;
          }
          if (balanceDeduct > 0) {
            this.setData({ footerButtonText: '确认使用储值余额' });
            return;
          }
          if (monthCardDeduct > 0 && (this.data.bookingVouchers || []).length > 0) {
            this.setData({ footerButtonText: '确认支付（券+月卡）' });
            return;
          }
          if (monthCardDeduct > 0) {
            this.setData({ footerButtonText: '确认使用月卡免费' });
            return;
          }
          if (sessionTimes > 0 && (this.data.bookingVouchers || []).length > 0) {
            this.setData({ footerButtonText: '确认支付（券+次卡）' });
            return;
          }
          if (sessionTimes > 0) {
            this.setData({ footerButtonText: `确认使用次卡（${sessionTimes} 次）` });
            return;
          }
          if ((this.data.bookingVouchers || []).length > 0) {
            this.setData({ footerButtonText: '确认使用团购券' });
            return;
          }
        }
        if (balanceDeduct > 0 && wechatDue > 0) {
          this.setData({
            footerButtonText: `储值 ¥${formatYuanText(balanceDeduct)} + 微信 ¥${formatYuanText(wechatDue)}`,
          });
          return;
        }
        this.setData({ footerButtonText: '确认付款' });
        return;
      }
      this.setData({ footerButtonText: '确认付款' });
    },

    async saveOrderToDB() {
      const { orderType, totalPrice } = this.data;
      const isCourtPlain =
        orderType === 'court' && !this.data.isCoachCourseOrder;
      if (isCourtPlain) {
        this.recomputeCourtPayAmounts();
        const wechatDue = roundYuan(this.data.wechatDueYuan);
        if (wechatDue <= 0.009) {
          await this.submitCourtBookingFullyCovered();
          return;
        }
      }
      let payYuan = isCourtPlain
        ? Number(this.data.wechatDueYuan)
        : Number(totalPrice);
      if (
        orderType === 'court' &&
        this.data.isCoachCourseOrder &&
        this.data.payMethod === 'mixed'
      ) {
        payYuan = Number(this.data.comboCashYuan);
      }
      if (!Number.isFinite(payYuan) || payYuan <= 0) {
        wx.showToast({ title: '订单金额无效', icon: 'none' });
        return;
      }
      const isCoachWx =
        orderType === 'court' &&
        this.data.isCoachCourseOrder &&
        (this.data.payMethod === 'wechat' || this.data.payMethod === 'mixed');
      if (isCoachWx && this.data.payMethod === 'mixed') {
        const cash = Number(this.data.comboCashYuan);
        const d = Math.floor(Number(this.data.coachHoursDeductForPay) || 0);
        if (!Number.isFinite(cash) || cash <= 0) {
          wx.showToast({ title: '微信应付金额无效', icon: 'none' });
          return;
        }
        if (d <= 0) {
          wx.showToast({ title: '组合支付课时数无效', icon: 'none' });
          return;
        }
      }

      const totalFee = Math.max(1, Math.round(payYuan * 100));
      const payPayload = { totalFee };

      if (orderType === 'goods') {
        const phone = String(wx.getStorageSync(STORAGE_KEYS.userPhone) || '').trim();
        if (!phone) {
          wx.showToast({ title: '请先登录并授权手机号', icon: 'none' });
          return;
        }
        const built = buildGoodsPurchasePayload({
          goodItem: this.data.goodItem,
          totalPrice: this.data.totalPrice,
          goodsHasTypeMap: this.data.goodsHasTypeMap,
          selectedGoodsFormat: this.data.selectedGoodsFormat,
          selectedGoodsSession: this.data.selectedGoodsSession,
          phone,
        });
        if (!built.ok) {
          wx.showToast({ title: built.errMsg || '商品信息无效', icon: 'none' });
          return;
        }
        payPayload.goodsPurchase = built.goodsPurchase;
      }

      if (orderType === 'court') {
        const phone = String(wx.getStorageSync(STORAGE_KEYS.userPhone) || '').trim();
        if (!phone) {
          wx.showToast({ title: '请先登录并授权手机号', icon: 'none' });
          return;
        }
        payPayload.phone = phone;
        payPayload.booking = buildCourtBookingPayload(this.data, {
          isCourtPlain,
          phone,
          userNickname: wx.getStorageSync(STORAGE_KEYS.userNickname) || '',
        });
      }

      this.beginLoading('支付中...');
      try {
        const res = await requestWechatPay(payPayload);
        this.endLoading();
        const result = (res && res.result) || {};
        const payment = result.payment;
        const outTradeNo = String(result.outTradeNo || '').trim();
        if (result.returnCode !== 'SUCCESS' || !payment) {
          console.error('unifiedOrder 失败', result);
          wx.showToast({
            title: result.returnMsg || '下单失败',
            icon: 'none',
          });
          return;
        }
        wx.requestPayment({
          ...payment,
          success: () => {
            if (orderType === 'court') {
              try {
                const payload = {
                  campusName: this.data.campusName,
                  orderItems: this.data.orderItems,
                };
                if (this.data.isCoachCourseOrder) {
                  payload.successKind = 'coachCourse';
                  payload.coachCapacityLabel = String(this.data.coachCapacityLabel || '').trim();
                  payload.coachName = String(this.data.coachName || '').trim();
                } else {
                  payload.successKind = 'court';
                }
                wx.setStorageSync(BOOKING_SUCCESS_STORAGE_KEY, payload);
              } catch (e) {
                console.error('写入订场成功缓存失败', e);
              }
              const app = getApp();
              if (app && app.globalData) {
                app.globalData.shouldClearBookingData = true;
              }
              if (
                !this.data.isCoachCourseOrder &&
                (Number(this.data.storedBalanceDeductYuan) > 0 ||
                  Number(this.data.monthCardDeductYuan) > 0 ||
                  Number(this.data.sessionCardDeductTimes) > 0)
              ) {
                markProfileSummaryStale();
              }
              wx.redirectTo({ url: '/pages/booking-success/index' });
              return;
            }
            if (orderType === 'goods') {
              const g = this.data.goodItem;
              const gh = Math.floor(Number(g && g.grantHours) || 0);
              try {
                wx.setStorageSync(BOOKING_SUCCESS_STORAGE_KEY, {
                  successKind: 'coursePurchase',
                  campusName: this.data.campusName || (g && g.venueName) || '',
                  goodDesc: (g && g.desc) || '',
                  grantHours: gh,
                  lessonLabel: formatLessonKeyDisplay(String((g && g.lessonKey) || '')),
                });
              } catch (e) {
                console.error('写入买课成功缓存失败', e);
              }
              wx.redirectTo({ url: '/pages/booking-success/index' });
              return;
            }
            wx.showToast({ title: '支付成功', icon: 'success' });
          },
          fail: (err) => {
            console.error('pay fail', err);
            const isCancel = !!(err && err.errMsg && String(err.errMsg).indexOf('cancel') >= 0);
            // 用户取消支付：关闭已写入的 pending 订场单，避免残留在订场历史
            if (isCancel && orderType === 'court' && outTradeNo) {
              abandonCheckoutPayment({ outTradeNo }).catch((e) => {
                console.error('abandonCheckoutPayment', e);
              });
            }
            wx.showToast({
              title: isCancel ? '已取消支付' : '支付未完成',
              icon: 'none',
            });
          },
        });
      } catch (err) {
        this.endLoading();
        console.error('requestWechatPay', err);
        const raw = (err && (err.errMsg || err.message)) ? String(err.errMsg || err.message) : '';
        const isTimeout = /timeout|超时|time limit/i.test(raw);
        wx.showToast({
          title: isTimeout ? '下单超时，请重试' : '网络异常，请重试',
          icon: 'none',
        });
      }
    },

    async submitCourtBookingFullyCovered() {
      const phone = String(wx.getStorageSync(STORAGE_KEYS.userPhone) || '').trim();
      if (!phone) {
        wx.showToast({ title: '请先登录并授权手机号', icon: 'none' });
        return;
      }
      const snapshot = {
        orderNumber: this.data.orderNumber,
        campusName: this.data.campusName,
        venueId: this.data.venueId,
        orderDate: this.data.orderDate,
        formattedDate: this.data.formattedDate,
        orderItems: this.data.orderItems,
        bookedSlots: this.data.bookedSlots || [],
        totalPrice: this.data.totalPrice,
        slotPrices: this.data.courtSlotPrices || [],
      };
      this.beginLoading('提交中...');
      try {
        const cloudRes = await completeCourtBookingWithVouchers({
          phone,
          snapshot,
          vouchers: this.data.bookingVouchers || [],
          storedBalanceDeductYuan: Number(this.data.storedBalanceDeductYuan) || 0,
          monthCardFree:
            this.data.monthCardUseFree && this.data.monthCardFreeSlotKey
              ? {
                  slotKey: this.data.monthCardFreeSlotKey,
                  deductYuan: Number(this.data.monthCardDeductYuan) || 0,
                }
              : null,
          sessionCard:
            Number(this.data.sessionCardDeductTimes) > 0 &&
            Array.isArray(this.data.sessionCardSlotKeys) &&
            this.data.sessionCardSlotKeys.length > 0
              ? {
                  slotKeys: this.data.sessionCardSlotKeys,
                  deductTimes: Number(this.data.sessionCardDeductTimes) || 0,
                  deductYuan: Number(this.data.sessionCardDeductYuan) || 0,
                }
              : null,
        });
        this.endLoading();
        const r = cloudRes && cloudRes.result ? cloudRes.result : {};
        if (!r.ok) {
          if (r.data && r.data.outTradeNo) {
            wx.showToast({ title: r.errMsg || '提交异常，请联系客服', icon: 'none', duration: 3000 });
            return;
          }
          wx.showToast({ title: r.errMsg || '提交失败', icon: 'none' });
          if (r.errMsg && String(r.errMsg).indexOf('月卡') >= 0) {
            this.loadMonthCardBenefit();
          }
          if (r.errMsg && String(r.errMsg).indexOf('次卡') >= 0) {
            this.loadVenueSessionCard();
          }
          return;
        }
        try {
          wx.setStorageSync(BOOKING_SUCCESS_STORAGE_KEY, {
            successKind: 'court',
            campusName: this.data.campusName,
            orderItems: this.data.orderItems,
          });
        } catch (e) {
          console.error('写入订场成功缓存失败', e);
        }
        const app = getApp();
        if (app && app.globalData) {
          app.globalData.shouldClearBookingData = true;
        }
        if (
          Number(this.data.storedBalanceDeductYuan) > 0 ||
          Number(this.data.monthCardDeductYuan) > 0 ||
          Number(this.data.sessionCardDeductTimes) > 0
        ) {
          markProfileSummaryStale();
        }
        wx.redirectTo({ url: '/pages/booking-success/index' });
      } catch (e) {
        this.endLoading();
        console.error('completeCourtBookingWithVouchers', e);
        const raw = (e && (e.errMsg || e.message)) ? String(e.errMsg || e.message) : '请求失败';
        const isTimeout = /timeout|超时|time limit/i.test(raw);
        wx.showModal({
          title: '提交失败',
          content: isTimeout ? '提交超时，请重试' : raw,
          showCancel: false,
          confirmText: '知道了',
        });
      }
    },

    async submitCoachCourseWithHours() {
      if (
        this.data.coachSessionRosterReady &&
        (this.data.coachSessionFull || this.data.coachViewerAlreadyJoined)
      ) {
        wx.showToast({
          title: this.data.coachSessionFull ? '该课节名额已满' : '您已在该课节名单中',
          icon: 'none',
        });
        return;
      }
      const phone = String(wx.getStorageSync(STORAGE_KEYS.userPhone) || '').trim();
      if (!phone) {
        wx.showToast({ title: '请先登录并授权手机号', icon: 'none' });
        return;
      }
      const need = this.data.requiredCourseHours || 0;
      if ((this.data.courseHoursBalance || 0) < need) {
        wx.showToast({ title: '课时不足', icon: 'none' });
        return;
      }
      const snapshot = {
        orderNumber: this.data.orderNumber,
        campusName: this.data.campusName,
        venueId: this.data.venueId,
        orderDate: this.data.orderDate,
        formattedDate: this.data.formattedDate,
        orderItems: this.data.orderItems,
        bookedSlots: this.data.bookedSlots || [],
        totalPrice: this.data.totalPrice,
        lessonKey: this.data.lessonKey,
        coachCapacityLabel: this.data.coachCapacityLabel,
        memberDisplayName: String(wx.getStorageSync(STORAGE_KEYS.userNickname) || '').trim().slice(0, 40),
      };
      this.beginLoading('提交中...');
      try {
        const cloudRes = await completeCoachBookingWithHours({
          phone,
          holdIds: this.data.coachHoldIds || [],
          snapshot,
        });
        this.endLoading();
        const r = cloudRes && cloudRes.result ? cloudRes.result : {};
        if (!r.ok) {
          wx.showToast({ title: r.errMsg || '提交失败', icon: 'none' });
          return;
        }
        try {
          wx.setStorageSync(BOOKING_SUCCESS_STORAGE_KEY, {
            successKind: 'coachCourse',
            campusName: this.data.campusName,
            orderItems: this.data.orderItems,
            coachCapacityLabel: String(this.data.coachCapacityLabel || '').trim(),
            coachName: String(this.data.coachName || '').trim(),
          });
        } catch (e) {
          console.error('写入订场成功缓存失败', e);
        }
        const app = getApp();
        if (app && app.globalData) {
          app.globalData.shouldClearBookingData = true;
        }
        wx.redirectTo({ url: '/pages/booking-success/index' });
      } catch (e) {
        this.endLoading();
        console.error('completeCoachBookingWithHours', e);
        wx.showToast({ title: '网络异常，请重试', icon: 'none' });
      }
    },

    async handleSubmitOrder() {
      const app = getApp();
      if (!app.checkLogin()) {
        const storedPhone = wx.getStorageSync(STORAGE_KEYS.userPhone) || '';
        if (storedPhone) {
          this.beginLoading('验证中...');
          try {
            const { getUserByPhone } = require('../../../api/tennisDb');
            const res = await getUserByPhone(storedPhone);
            const user = res && res.data && res.data.length > 0 ? res.data[0] : null;
            if (user) {
              await app.doLogin();
              wx.setStorageSync(STORAGE_KEYS.userPhone, storedPhone);
              wx.setStorageSync(STORAGE_KEYS.userAvatar, user.avatar || '');
              wx.setStorageSync(STORAGE_KEYS.userNickname, user.name || '');
              this.endLoading();
              wx.showToast({ title: '登录成功', icon: 'success' });
              this.updateFooterButtonText();
              this.loadCoachCourseHoursBalance();
              this.loadCoachSessionRoster();
              return;
            }
          } catch (e) {
            console.error('getUserByPhone failed', e);
          }
          this.endLoading();
        }
        this.setData({ showPhoneAuthModal: true });
        return;
      }

      if (
        this.data.orderType === 'court' &&
        this.data.isCoachCourseOrder &&
        this.data.coachSessionRosterReady &&
        (this.data.coachSessionFull || this.data.coachViewerAlreadyJoined)
      ) {
        wx.showToast({
          title: this.data.coachSessionFull ? '该课节名额已满' : '您已在该课节名单中',
          icon: 'none',
        });
        return;
      }

      if (
        this.data.orderType === 'court' &&
        this.data.isCoachCourseOrder &&
        (this.data.coachPayWechatOnly || isCoachWechatOnlyLessonKey(this.data.lessonKey)) &&
        this.data.payMethod !== 'wechat'
      ) {
        wx.showToast({ title: '团课/畅打仅支持微信支付', icon: 'none' });
        this.setData({ payMethod: 'wechat' }, () => {
          this.recomputeCoachPayAmounts();
          this.updateFooterButtonText();
        });
        return;
      }

      if (
        this.data.orderType === 'court' &&
        this.data.isCoachCourseOrder &&
        this.data.payMethod === 'course_hours'
      ) {
        this.submitCoachCourseWithHours();
        return;
      }

      await this.saveOrderToDB();
    },
  },
});
