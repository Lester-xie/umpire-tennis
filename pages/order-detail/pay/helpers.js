const { roundYuan } = require('../../../utils/storedValuePlans');
const {
  recalcCourtPlainPayment,
} = require('../../../utils/bookingVoucherMatch');
const { findCourtSlot } = require('../../../utils/bookingTimeSlots');
const { pickMonthCardFreeSlot } = require('../../../utils/monthCard');
const { pickSessionCardSlots } = require('../../../utils/sessionCardPlans');

/** 团课 / 畅打：仅允许微信支付，不可用课时或组合支付 */
function isCoachWechatOnlyLessonKey(lk) {
  const s = String(lk || '')
    .trim()
    .toLowerCase();
  return s.startsWith('group:') || s.startsWith('open_play:');
}

function buildCourtOrderSlotPrices(bookedSlots, courts) {
  const list = [];
  (bookedSlots || []).forEach((s) => {
    const courtId = Number(s.courtId);
    const slotIndex = Number(s.slotIndex);
    if (!Number.isFinite(courtId) || !Number.isFinite(slotIndex)) return;
    const court = (courts || []).find((c) => Number(c.id) === courtId);
    // slots 按展示序从 10:00 起，须按 slotIndex 字段查找，不能当数组下标
    const slotData = findCourtSlot(court, slotIndex);
    list.push({
      courtId,
      slotIndex,
      slotKey: `${courtId}-${slotIndex}`,
      priceYuan: roundYuan(slotData && slotData.price),
    });
  });
  return list;
}

/**
 * 教练课：各格 venueSlotPrice 仅首格为场次价、其余为 0，故合计为场次总价。
 */
function computeCoachSlotPrices(selectedSlots, courts) {
  const slots = (selectedSlots || [])
    .map((s) => ({
      courtId: Number(s.courtId),
      slotIndex: Number(s.slotIndex),
    }))
    .filter((s) => Number.isFinite(s.courtId) && Number.isFinite(s.slotIndex));
  slots.sort((a, b) =>
    (a.courtId !== b.courtId ? a.courtId - b.courtId : a.slotIndex - b.slotIndex));
  const prices = [];
  slots.forEach((s) => {
    const court = (courts || []).find((c) => Number(c.id) === s.courtId);
    if (!court || !court.slots) return;
    const slotData = findCourtSlot(court, s.slotIndex);
    if (!slotData) return;
    const raw =
      slotData.venueSlotPrice != null ? slotData.venueSlotPrice : slotData.price;
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    prices.push(roundYuan(n));
  });
  return prices;
}

/** 根据当前支付方式计算教练课课时抵扣与微信应付 */
function calcCoachPayAmounts({
  isCoachCourseOrder,
  requiredCourseHours,
  courseHoursBalance,
  coachSlotPrices,
  totalPrice,
  payMethod,
}) {
  if (!isCoachCourseOrder) {
    return {
      coachHoursDeductForPay: 0,
      comboCashYuan: 0,
      coachMixedPreviewDeduct: 0,
      coachMixedPreviewCash: 0,
    };
  }
  const need = requiredCourseHours || 0;
  const balance = Math.floor(Number(courseHoursBalance) || 0);
  const prices = coachSlotPrices || [];
  const total = Number(totalPrice) || 0;
  const pm = payMethod;
  let deduct = 0;
  let cash = total;
  if (pm === 'wechat') {
    deduct = 0;
    cash = total;
  } else if (pm === 'mixed') {
    deduct = Math.min(balance, need);
    if (prices.length === need && need > 0) {
      cash = roundYuan(prices.slice(deduct).reduce((a, b) => a + roundYuan(b), 0));
    } else if (need > 0) {
      const per = total / need;
      cash = per * Math.max(0, need - deduct);
    }
    cash = roundYuan(cash);
  } else {
    deduct = 0;
    cash = 0;
  }
  let mixedPreviewDeduct = 0;
  let mixedPreviewCash = 0;
  if (balance > 0 && balance < need && need > 0) {
    mixedPreviewDeduct = Math.min(balance, need);
    if (prices.length === need) {
      mixedPreviewCash = roundYuan(
        prices.slice(mixedPreviewDeduct).reduce((a, b) => a + roundYuan(b), 0),
      );
    } else {
      const per = total / need;
      mixedPreviewCash = per * Math.max(0, need - mixedPreviewDeduct);
    }
    mixedPreviewCash = roundYuan(mixedPreviewCash);
  }
  return {
    coachHoursDeductForPay: deduct,
    comboCashYuan: cash,
    coachMixedPreviewDeduct: mixedPreviewDeduct,
    coachMixedPreviewCash: mixedPreviewCash,
  };
}

/** 普通订场：券 + 月卡 + 次卡 + 储值 → 各抵扣字段 */
function calcCourtPayAmounts({
  totalPriceYuan,
  bookingVouchers,
  courtPayMethod,
  venueStoredBalanceYuan,
  monthCardUseFree,
  monthCardConfig,
  courtOrderSlotPrices,
  sessionCardRemainingTimes,
  sessionCardUse,
}) {
  let monthCardDeductYuan = 0;
  let monthCardFreeSlotKey = '';
  let useFree = !!monthCardUseFree;
  if (useFree && monthCardConfig) {
    const picked = pickMonthCardFreeSlot(
      courtOrderSlotPrices,
      bookingVouchers,
      monthCardConfig,
    );
    if (picked) {
      monthCardDeductYuan = picked.deductYuan;
      monthCardFreeSlotKey = picked.slotKey;
    } else {
      useFree = false;
    }
  }
  let sessionCardDeductTimes = 0;
  let sessionCardSlotKeys = [];
  let sessionCardDeductYuan = 0;
  const useSession = sessionCardUse !== false;
  const remainTimes = Math.max(0, Math.floor(Number(sessionCardRemainingTimes) || 0));
  if (useSession && remainTimes > 0) {
    const picked = pickSessionCardSlots(
      courtOrderSlotPrices,
      bookingVouchers,
      monthCardFreeSlotKey,
      remainTimes,
    );
    sessionCardDeductTimes = picked.sessionCardDeductTimes;
    sessionCardSlotKeys = picked.sessionCardSlotKeys;
    sessionCardDeductYuan = picked.sessionCardDeductYuan;
  }
  const pay = recalcCourtPlainPayment({
    totalPriceYuan,
    vouchers: bookingVouchers,
    courtPayMethod,
    storedBalanceYuan: venueStoredBalanceYuan,
    monthCardDeductYuan,
    sessionCardDeductYuan,
  });
  return {
    voucherDeductionYuan: pay.voucherDeductionYuan,
    monthCardUseFree: useFree,
    monthCardDeductYuan: pay.monthCardDeductYuan,
    monthCardFreeSlotKey,
    sessionCardDeductTimes,
    sessionCardSlotKeys,
    sessionCardDeductYuan: pay.sessionCardDeductYuan,
    cashDueYuan: pay.cashDueYuan,
    storedBalanceDeductYuan: pay.storedBalanceDeductYuan,
    wechatDueYuan: pay.wechatDueYuan,
  };
}

function buildGoodsPurchasePayload({ goodItem, totalPrice, goodsHasTypeMap, selectedGoodsFormat, selectedGoodsSession, phone }) {
  const g = goodItem;
  if (!g) return { ok: false, errMsg: '商品信息缺失' };
  const grantHours = Math.floor(Number(g.grantHours) || 0);
  const lessonKey = String(g.lessonKey || '').trim();
  const goodsVenueId = String(g.venueId || '').trim();
  if (!lessonKey || grantHours <= 0) {
    return {
      ok: false,
      errMsg: goodsHasTypeMap
        ? '请选择上课形式与节数套餐'
        : '无法识别课时或课程类型，请检查 db_course 的 typeMap / unit，或填写 grantHours、lessonKey',
    };
  }
  if (!goodsVenueId) {
    return {
      ok: false,
      errMsg: '课程未绑定场馆，请从首页选择场馆后再购买',
    };
  }
  let goodDesc = g.title ? String(g.title).trim() : '';
  if (!goodDesc) goodDesc = g.desc || '';
  if (
    goodsHasTypeMap &&
    selectedGoodsFormat &&
    selectedGoodsSession !== '' &&
    selectedGoodsSession != null
  ) {
    goodDesc = `${goodDesc} ${selectedGoodsFormat}×${selectedGoodsSession}节`.trim();
  }
  return {
    ok: true,
    goodsPurchase: {
      type: 'course_hours',
      phone,
      courseId: g.id,
      grantHours,
      lessonKey,
      venueId: goodsVenueId,
      goodDesc,
      listPriceCents: Math.max(1, Math.round(Number(totalPrice) * 100)),
    },
  };
}

function buildCourtBookingPayload(data, { isCourtPlain, phone, userNickname }) {
  return {
    type: 'court',
    orderNumber: data.orderNumber,
    campusName: data.campusName,
    venueId: data.venueId,
    orderDate: data.orderDate,
    formattedDate: data.formattedDate,
    orderItems: data.orderItems,
    bookedSlots: data.bookedSlots || [],
    totalPrice: data.totalPrice,
    coachHoldIds: data.isCoachCourseOrder ? data.coachHoldIds || [] : [],
    bookingSubtype: data.isCoachCourseOrder ? 'coach_course' : '',
    lessonKey: data.isCoachCourseOrder ? String(data.lessonKey || '').trim() : '',
    coachCapacityLabel: data.isCoachCourseOrder
      ? String(data.coachCapacityLabel || '').trim()
      : '',
    coachCourseHoursDeduct:
      data.isCoachCourseOrder && data.payMethod === 'mixed'
        ? Math.floor(Number(data.coachHoursDeductForPay) || 0)
        : 0,
    memberDisplayName: data.isCoachCourseOrder
      ? String(userNickname || '').trim().slice(0, 40)
      : '',
    bookingVouchers: isCourtPlain ? data.bookingVouchers || [] : [],
    voucherDeductionYuan: isCourtPlain ? Number(data.voucherDeductionYuan) || 0 : 0,
    storedBalanceDeductYuan: isCourtPlain ? Number(data.storedBalanceDeductYuan) || 0 : 0,
    cashDueYuan: isCourtPlain ? Number(data.wechatDueYuan) || 0 : Number(data.totalPrice),
    monthCardFree:
      isCourtPlain && data.monthCardUseFree && data.monthCardFreeSlotKey
        ? {
            slotKey: data.monthCardFreeSlotKey,
            deductYuan: Number(data.monthCardDeductYuan) || 0,
          }
        : null,
    sessionCard:
      isCourtPlain &&
      Number(data.sessionCardDeductTimes) > 0 &&
      Array.isArray(data.sessionCardSlotKeys) &&
      data.sessionCardSlotKeys.length > 0
        ? {
            slotKeys: data.sessionCardSlotKeys,
            deductTimes: Number(data.sessionCardDeductTimes) || 0,
            deductYuan: Number(data.sessionCardDeductYuan) || 0,
          }
        : null,
  };
}

module.exports = {
  isCoachWechatOnlyLessonKey,
  buildCourtOrderSlotPrices,
  computeCoachSlotPrices,
  calcCoachPayAmounts,
  calcCourtPayAmounts,
  buildGoodsPurchasePayload,
  buildCourtBookingPayload,
};
