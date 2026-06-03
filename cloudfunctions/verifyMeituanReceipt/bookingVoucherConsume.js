const { platformLabel } = require('./meituanDealGrantMap');
const { meituanPrepare, meituanConsume } = require('./meituanApi');

function parseReceiptCode(raw) {
  const codeForApi = String(raw || '').trim();
  const receiptCodeKey = codeForApi.replace(/\s+/g, '');
  return { codeForApi, receiptCodeKey };
}

async function consumeOneBookingVoucher(db, ctx) {
  const {
    openid,
    memberPhone,
    venueId,
    bookingOutTradeNo,
    voucher,
  } = ctx;
  const platform = Math.floor(Number(voucher && voucher.platform));
  const { codeForApi, receiptCodeKey } = parseReceiptCode(voucher && voucher.receiptCode);
  if (!receiptCodeKey || (platform !== 1 && platform !== 2)) {
    return { ok: false, errMsg: '团购券参数无效' };
  }

  const existed = await db
    .collection('db_ticket_receipt')
    .where({ receiptCode: receiptCodeKey, platform })
    .limit(1)
    .get();
  if (existed.data && existed.data[0]) {
    const row = existed.data[0];
    const samePhone = String(row.memberPhone || '').trim() === String(memberPhone || '').trim();
    const sameBooking =
      bookingOutTradeNo &&
      String(row.bookingOutTradeNo || '').trim() === String(bookingOutTradeNo).trim();
    if (samePhone && sameBooking) {
      return { ok: true, receiptCode: receiptCodeKey, platform, duplicate: true };
    }
    return { ok: false, errMsg: '团购券已被使用' };
  }

  let ticketInfo =
    voucher && voucher.ticketInfo != null ? String(voucher.ticketInfo).trim() : '';
  let prep = {
    ok: true,
    deal: {
      dealId: voucher && voucher.dealId != null ? String(voucher.dealId) : '',
      dealGroupId: voucher && voucher.dealGroupId != null ? String(voucher.dealGroupId) : '',
      ticketName: voucher && voucher.ticketName != null ? String(voucher.ticketName) : '',
      title: voucher && voucher.ticketName != null ? String(voucher.ticketName) : '',
    },
    ticketInfo,
  };
  if (!ticketInfo) {
    prep = await meituanPrepare(codeForApi, platform);
    if (!prep.ok) return prep;
    ticketInfo = prep.ticketInfo ? String(prep.ticketInfo).trim() : '';
  }
  if (!ticketInfo) {
    return { ok: false, errMsg: '核销失败，请稍后重试' };
  }

  const consume = await meituanConsume(codeForApi, ticketInfo, 1, platform);
  if (!consume.ok) return consume;

  const dealTitle =
    (voucher && voucher.ticketName) ||
    consume.deal.title ||
    prep.deal.ticketName ||
    prep.deal.title ||
    '';
  const now = Date.now();
  await db.collection('db_ticket_receipt').add({
    data: {
      receiptCode: receiptCodeKey,
      receiptCodeDisplay: codeForApi,
      platform,
      platformLabel: platformLabel(platform),
      memberPhone,
      memberOpenid: openid || '',
      venueId,
      dealId:
        (voucher && voucher.dealId != null ? String(voucher.dealId) : '') ||
        consume.deal.dealId ||
        prep.deal.dealId ||
        '',
      dealGroupId:
        (voucher && voucher.dealGroupId != null ? String(voucher.dealGroupId) : '') ||
        consume.deal.dealGroupId ||
        prep.deal.dealGroupId ||
        '',
      dealTitle,
      kind: 'court',
      lessonKey: 'court:ball_machine',
      grantHours: 0,
      grantLabel: '订场支付核销',
      voucherPriceYuan: Number(voucher && voucher.priceYuan) || 0,
      usageType: 'booking_pay',
      bookingOutTradeNo: bookingOutTradeNo || '',
      slotKey: voucher && voucher.slotKey != null ? String(voucher.slotKey) : '',
      traceId: consume.traceId || '',
      consumedAt: now,
      createdAt: now,
    },
  });

  return { ok: true, receiptCode: receiptCodeKey, platform };
}

async function consumeBookingVoucherBatch(db, ctx) {
  const list = Array.isArray(ctx.vouchers) ? ctx.vouchers : [];
  if (!list.length) return { ok: true, consumed: [] };
  const consumed = [];
  for (let i = 0; i < list.length; i += 1) {
    const one = await consumeOneBookingVoucher(db, { ...ctx, voucher: list[i] });
    if (!one.ok) {
      return { ok: false, errMsg: one.errMsg || '团购券核销失败', failedIndex: i, consumed };
    }
    consumed.push(one);
  }
  return { ok: true, consumed };
}

module.exports = {
  consumeOneBookingVoucher,
  consumeBookingVoucherBatch,
};
