const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const {
  evaluatePrepareDeal,
  evaluateBookingVoucher,
  normalizePlatform,
  platformLabel,
} = require('./meituanDealGrantMap');
const { grantMemberCourseHours, resolveAipaiVenueId } = require('./grantHours');
const { queryShopDeals, meituanPrepare, meituanConsume } = require('./meituanApi');
const { consumeBookingVoucherBatch } = require('./bookingVoucherConsume');

function parseReceiptCode(raw) {
  const codeForApi = String(raw || '').trim();
  const receiptCodeKey = codeForApi.replace(/\s+/g, '');
  return { codeForApi, receiptCodeKey };
}

async function assertMemberCaller(openid, phoneFromEvent) {
  const phone = String(phoneFromEvent || '').trim();
  if (!openid) return { ok: false, errMsg: '未登录' };
  if (!/^1\d{10}$/.test(phone)) {
    return { ok: false, errMsg: '请先登录并授权手机号' };
  }
  const userRes = await db.collection('db_user').where({ _openid: openid, phone }).limit(1).get();
  const member = userRes.data && userRes.data[0];
  if (!member) return { ok: false, errMsg: '用户校验失败，请重新登录' };
  return { ok: true, member, phone };
}

async function findConsumedReceipt(receiptCodeKey, platform) {
  const key = String(receiptCodeKey || '').trim();
  const pf = normalizePlatform(platform);
  if (!key || !pf) return null;
  const hit = await db
    .collection('db_ticket_receipt')
    .where({ receiptCode: key, platform: pf })
    .limit(1)
    .get();
  return hit.data && hit.data[0] ? hit.data[0] : null;
}

function duplicatePayload(existed, forPhone) {
  const mine =
    forPhone &&
    existed &&
    String(existed.memberPhone || '').trim() === String(forPhone).trim();
  if (mine) {
    return {
      ok: true,
      duplicate: true,
      data: {
        receiptCode: existed.receiptCode,
        platform: existed.platform,
        platformLabel: platformLabel(existed.platform),
        grantHours: existed.grantHours,
        lessonKey: existed.lessonKey,
        grantLabel: existed.grantLabel,
        consumedAt: existed.consumedAt,
      },
    };
  }
  return { ok: false, errMsg: '该团购券已被核销' };
}

function parseAllowedPrices(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((v) => Math.round(Number(v) * 100) / 100)
    .filter((v) => Number.isFinite(v) && v > 0);
}

function parseShopDealsFromEvent(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      if (!row || typeof row !== 'object') return null;
      return {
        dealId: row.dealId != null ? String(row.dealId) : '',
        dealGroupId: row.dealGroupId != null ? String(row.dealGroupId) : '',
        title: row.title != null ? String(row.title).trim() : '',
        price: row.price != null ? Number(row.price) : 0,
        marketPrice: row.marketPrice != null ? Number(row.marketPrice) : 0,
        saleStatus: row.saleStatus,
      };
    })
    .filter(Boolean);
}

function parseUsedReceiptKeys(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      if (!row || typeof row !== 'object') return '';
      const pf = normalizePlatform(row.platform);
      const key = String(row.receiptCode || row.receiptCodeKey || '')
        .trim()
        .replace(/\s+/g, '');
      return pf > 0 && key ? `${pf}:${key}` : '';
    })
    .filter(Boolean);
}

async function assertBookingForVoucherConsume(outTradeNo, phone) {
  const tradeNo = String(outTradeNo || '').trim();
  const ph = String(phone || '').trim();
  if (!tradeNo || !ph) return { ok: false, errMsg: '订场单参数无效' };
  const hit = await db.collection('db_booking').where({ outTradeNo: tradeNo }).limit(1).get();
  const booking = hit.data && hit.data[0];
  if (!booking) return { ok: false, errMsg: '订场单不存在' };
  if (String(booking.phone || '').trim() !== ph) {
    return { ok: false, errMsg: '订场单校验失败' };
  }
  const st = String(booking.status || '');
  if (st !== 'paid' && st !== 'payment_confirming' && st !== 'pending') {
    return { ok: false, errMsg: '订场单状态不可核销团购券' };
  }
  return { ok: true, booking };
}

async function grantPreviewFromDeal(deal, platform) {
  const shopRes = await queryShopDeals(platform);
  const shopDeals = shopRes.ok ? shopRes.deals : [];
  const ticketName =
    (deal && deal.ticketName) ||
    (deal && deal.title) ||
    '';
  const preview = evaluatePrepareDeal({
    dealId: deal && deal.dealId,
    dealGroupId: deal && deal.dealGroupId,
    title: ticketName,
    platform,
    shopDeals,
  });
  if (!preview.ok) {
    return {
      ok: false,
      errMsg: preview.errMsg,
      blocked: !!preview.blocked,
      deal: {
        dealId: deal && deal.dealId,
        dealGroupId: deal && deal.dealGroupId,
        title: preview.dealTitle || ticketName,
      },
    };
  }
  return {
    ok: true,
    grant: preview.grant,
    deal: {
      dealId: deal && deal.dealId,
      dealGroupId: deal && deal.dealGroupId,
      title: preview.dealTitle || ticketName,
    },
  };
}

/**
 * 会员自助团购验券（昂湃网球学练馆 · open.elys.cn Hexiao V2）
 * event:
 * - action: listShopDeals | prepare | prepareForBooking | consume | consumeForBookingBatch
 * - platform: 1 美团，2 抖音（必填）
 * - phone, receiptCode, ticketName, dealId, dealGroupId
 */
exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const action = String((event && event.action) || 'prepare').trim();
  const platform = normalizePlatform(event && event.platform);

  if (action === 'listShopDeals') {
    const auth = await assertMemberCaller(openid, event && event.phone);
    if (!auth.ok) return auth;
    if (platform) {
      const res = await queryShopDeals(platform);
      if (!res.ok) return res;
      return {
        ok: true,
        data: {
          platform,
          platformLabel: platformLabel(platform),
          deals: res.deals,
          traceId: res.traceId,
        },
      };
    }
    const [meituanRes, douyinRes] = await Promise.all([
      queryShopDeals(1),
      queryShopDeals(2),
    ]);
    return {
      ok: true,
      data: {
        meituan: meituanRes.ok ? meituanRes.deals : [],
        douyin: douyinRes.ok ? douyinRes.deals : [],
        meituanError: meituanRes.ok ? '' : meituanRes.errMsg || '拉取美团团购失败',
        douyinError: douyinRes.ok ? '' : douyinRes.errMsg || '拉取抖音团购失败',
      },
    };
  }

  if (action === 'prepareForBooking') {
    if (!platform) {
      return { ok: false, errMsg: '请选择验券平台（美团或抖音）' };
    }
    const { codeForApi, receiptCodeKey } = parseReceiptCode(event && event.receiptCode);
    if (!receiptCodeKey) {
      return { ok: false, errMsg: '请输入团购券码' };
    }
    const usedKeys = parseUsedReceiptKeys(event && event.usedReceiptCodes);
    const selfKey = `${platform}:${receiptCodeKey}`;
    if (usedKeys.indexOf(selfKey) >= 0) {
      return { ok: false, errMsg: '该券码已在本次订单中添加' };
    }
    const allowedPrices = parseAllowedPrices(event && event.allowedPrices);
    if (!allowedPrices.length) {
      return { ok: false, errMsg: '当前订单无可匹配的时段价格' };
    }
    const [auth, existed] = await Promise.all([
      assertMemberCaller(openid, event && event.phone),
      findConsumedReceipt(receiptCodeKey, platform),
    ]);
    if (!auth.ok) return auth;
    const { phone: memberPhone } = auth;
    if (existed) {
      return duplicatePayload(existed, memberPhone);
    }
    const prep = await meituanPrepare(codeForApi, platform);
    if (!prep.ok) return prep;
    const deal = prep.deal || {};
    const titleFromPrepare = String(deal.ticketName || deal.title || '').trim();
    let shopDeals = parseShopDealsFromEvent(event && event.shopDeals);
    if (!shopDeals.length) {
      const shopRes = await queryShopDeals(platform);
      shopDeals = shopRes.ok ? shopRes.deals : [];
    }
    const evalRes = evaluateBookingVoucher({
      deal,
      dealId: deal.dealId,
      dealGroupId: deal.dealGroupId,
      title: titleFromPrepare,
      shopDeals,
      allowedPrices,
    });
    if (!evalRes.ok) {
      return {
        ok: false,
        errMsg: evalRes.errMsg,
        deal: { title: evalRes.ticketName || prep.deal.title || '' },
        traceId: prep.traceId,
      };
    }
    return {
      ok: true,
      data: {
        platform,
        platformLabel: platformLabel(platform),
        receiptCode: receiptCodeKey,
        receiptCodeDisplay: codeForApi,
        ticketName: evalRes.ticketName,
        priceYuan: evalRes.priceYuan,
        dealId: evalRes.dealId,
        dealGroupId: evalRes.dealGroupId,
        ticketInfo: prep.ticketInfo || prep.deal.ticketInfo || '',
        traceId: prep.traceId,
      },
    };
  }

  if (action === 'checkReceiptStatus') {
    const auth = await assertMemberCaller(openid, event && event.phone);
    if (!auth.ok) return auth;
    const { phone: memberPhone } = auth;
    const { receiptCodeKey } = parseReceiptCode(event && event.receiptCode);
    if (!receiptCodeKey) {
      return { ok: false, errMsg: '请输入团购券码' };
    }
    const pf = normalizePlatform(event && event.platform);
    if (!pf) {
      return { ok: false, errMsg: '请选择验券平台' };
    }
    const existed = await findConsumedReceipt(receiptCodeKey, pf);
    if (existed) {
      return duplicatePayload(existed, memberPhone);
    }
    return { ok: false, errMsg: '未找到核销记录' };
  }

  if (action === 'consumeForBookingBatch') {
    const phone = String((event && event.phone) || '').trim();
    if (!phone) return { ok: false, errMsg: '缺少手机号' };
    const skipBookingCheck = !!(event && event.skipBookingCheck);
    let memberOpenid = openid || '';
    let venueId = '';
    let bookingCheck = null;

    if (skipBookingCheck) {
      if (event && event.fromSiblingFunction) {
        memberOpenid = String(event.memberOpenid || '').trim();
        if (!memberOpenid || !/^1\d{10}$/.test(phone)) {
          return { ok: false, errMsg: '参数无效' };
        }
      } else {
        const auth = await assertMemberCaller(openid, phone);
        if (!auth.ok) return auth;
        memberOpenid = openid;
      }
      venueId =
        (event && event.venueId != null ? String(event.venueId).trim() : '') ||
        (await resolveAipaiVenueId());
    } else {
      bookingCheck = await assertBookingForVoucherConsume(
        event && event.outTradeNo,
        phone,
      );
      if (!bookingCheck.ok) return bookingCheck;
      if (!memberOpenid && event && event.fromPayCallback) {
        memberOpenid =
          bookingCheck.booking && bookingCheck.booking.memberOpenid
            ? String(bookingCheck.booking.memberOpenid)
            : '';
      } else if (!event || !event.fromPayCallback) {
        const auth = await assertMemberCaller(openid, phone);
        if (!auth.ok) return auth;
      }
      venueId =
        (bookingCheck.booking && bookingCheck.booking.venueId != null
          ? String(bookingCheck.booking.venueId)
          : '') || (await resolveAipaiVenueId());
    }

    let vouchers = Array.isArray(event && event.vouchers) ? event.vouchers : [];
    if (!vouchers.length && bookingCheck && bookingCheck.booking) {
      vouchers = Array.isArray(bookingCheck.booking.bookingVouchers)
        ? bookingCheck.booking.bookingVouchers
        : [];
    }
    if (!vouchers.length) {
      return { ok: false, errMsg: '订场单未包含团购券' };
    }

    const batch = await consumeBookingVoucherBatch(db, {
      openid: memberOpenid,
      memberPhone: phone,
      venueId,
      bookingOutTradeNo: String(event.outTradeNo || '').trim(),
      vouchers,
    });

    if (!skipBookingCheck && bookingCheck.booking && bookingCheck.booking._id) {
      const now = Date.now();
      await db
        .collection('db_booking')
        .doc(bookingCheck.booking._id)
        .update({
          data: {
            voucherConsumeStatus: batch.ok ? 'done' : 'failed',
            voucherConsumeErrMsg: batch.ok ? '' : String(batch.errMsg || '核销失败'),
            updatedAt: now,
          },
        });
    }

    return batch;
  }

  if (!platform) {
    return { ok: false, errMsg: '请选择验券平台（美团或抖音）' };
  }

  const auth = await assertMemberCaller(openid, event && event.phone);
  if (!auth.ok) return auth;
  const { member, phone: memberPhone } = auth;

  const { codeForApi, receiptCodeKey } = parseReceiptCode(event && event.receiptCode);
  if (!receiptCodeKey) {
    return { ok: false, errMsg: '请输入团购券码' };
  }

  const existed = await findConsumedReceipt(receiptCodeKey, platform);
  if (existed) {
    return duplicatePayload(existed, memberPhone);
  }

  if (action === 'prepare') {
    const prep = await meituanPrepare(codeForApi, platform);
    if (!prep.ok) return prep;
    const preview = await grantPreviewFromDeal(prep.deal, platform);
    if (!preview.ok) {
      return {
        ok: false,
        errMsg: preview.errMsg,
        blocked: !!preview.blocked,
        deal: preview.deal,
        traceId: prep.traceId,
      };
    }
    return {
      ok: true,
      data: {
        platform,
        platformLabel: platformLabel(platform),
        receiptCode: receiptCodeKey,
        ticketName: prep.deal.ticketName || prep.deal.title || '',
        dealId: prep.deal.dealId,
        dealGroupId: prep.deal.dealGroupId,
        ticketInfo: prep.ticketInfo || prep.deal.ticketInfo || '',
        grant: preview.grant,
        traceId: prep.traceId,
      },
    };
  }

  if (action === 'consume') {
    const dealHint = {
      dealId: event && event.dealId != null ? String(event.dealId) : '',
      dealGroupId: event && event.dealGroupId != null ? String(event.dealGroupId) : '',
      title:
        event && event.ticketName != null
          ? String(event.ticketName)
          : event && event.dealTitle != null
            ? String(event.dealTitle)
            : '',
    };

    const preview = await grantPreviewFromDeal(dealHint, platform);
    if (!preview.ok) {
      return {
        ok: false,
        errMsg: preview.errMsg,
        blocked: !!preview.blocked,
        deal: preview.deal,
      };
    }

    const venueId = await resolveAipaiVenueId();
    if (!venueId) {
      return { ok: false, errMsg: '场馆配置异常，请联系客服' };
    }

    let ticketInfo = event && event.ticketInfo != null ? String(event.ticketInfo).trim() : '';
    if (!ticketInfo) {
      const prep = await meituanPrepare(codeForApi, platform);
      if (!prep.ok) return prep;
      ticketInfo = prep.ticketInfo ? String(prep.ticketInfo).trim() : '';
    }
    if (!ticketInfo) {
      return { ok: false, errMsg: '核销失败，请稍后重试' };
    }

    const consume = await meituanConsume(codeForApi, ticketInfo, 1, platform);
    if (!consume.ok) return consume;

    const dealForGrant = {
      dealId: consume.deal.dealId || dealHint.dealId || preview.deal.dealId,
      dealGroupId: consume.deal.dealGroupId || dealHint.dealGroupId || preview.deal.dealGroupId,
      title: consume.deal.title || dealHint.title || preview.deal.title,
    };
    const grantMeta = preview.grant;
    const now = Date.now();
    const memberName = member.name != null ? String(member.name).trim() : '';
    const dealTitle = dealForGrant.title || '';

    try {
      await db.collection('db_ticket_receipt').add({
        data: {
          receiptCode: receiptCodeKey,
          receiptCodeDisplay: codeForApi,
          platform,
          platformLabel: platformLabel(platform),
          memberPhone,
          memberOpenid: openid,
          venueId,
          dealId: dealForGrant.dealId != null ? String(dealForGrant.dealId) : '',
          dealGroupId: dealForGrant.dealGroupId != null ? String(dealForGrant.dealGroupId) : '',
          dealTitle,
          kind: grantMeta.kind,
          lessonKey: grantMeta.lessonKey,
          grantHours: grantMeta.grantHours,
          grantLabel: grantMeta.label,
          traceId: consume.traceId || '',
          consumedAt: now,
          createdAt: now,
        },
      });
    } catch (e) {
      const again = await findConsumedReceipt(receiptCodeKey, platform);
      if (again) {
        return duplicatePayload(again, memberPhone);
      }
      console.error('db_ticket_receipt add failed after meituan consume', receiptCodeKey, e);
    }

    const grantRes = await grantMemberCourseHours({
      phone: memberPhone,
      venueId,
      lessonKey: grantMeta.lessonKey,
      grantHours: grantMeta.grantHours,
      sourceMeta: platform === 2 ? 'douyin_receipt' : 'meituan_receipt',
    });

    return {
      ok: true,
      data: {
        platform,
        platformLabel: platformLabel(platform),
        receiptCode: receiptCodeKey,
        memberPhone,
        memberName,
        venueId,
        grant: grantMeta,
        traceId: consume.traceId || '',
        grantPending: grantRes.ok ? false : grantRes.errMsg || '课时入账失败，请联系客服',
      },
    };
  }

  return { ok: false, errMsg: '未知 action' };
};
