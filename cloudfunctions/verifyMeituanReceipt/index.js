const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const {
  evaluatePrepareDeal,
  normalizePlatform,
  platformLabel,
} = require('./meituanDealGrantMap');
const { grantMemberCourseHours, resolveAipaiVenueId } = require('./grantHours');
const { queryShopDeals, meituanPrepare, meituanConsume } = require('./meituanApi');

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
 * - action: listShopDeals | prepare | consume
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
        grant: preview.grant,
        traceId: prep.traceId,
      },
    };
  }

  if (action === 'consume') {
    let ticketInfo = event && event.ticketInfo != null ? String(event.ticketInfo).trim() : '';
    if (!ticketInfo) {
      const prep = await meituanPrepare(codeForApi, platform);
      if (!prep.ok) return prep;
      ticketInfo = prep.ticketInfo ? String(prep.ticketInfo).trim() : '';
    }
    if (!ticketInfo) {
      return { ok: false, errMsg: '核销失败，请稍后重试' };
    }

    const venueId = await resolveAipaiVenueId();
    if (!venueId) {
      return { ok: false, errMsg: '场馆配置异常，请联系客服' };
    }

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

    const consume = await meituanConsume(codeForApi, ticketInfo, 1, platform);
    if (!consume.ok) return consume;

    const dealForGrant = {
      dealId: consume.deal.dealId || dealHint.dealId,
      dealGroupId: consume.deal.dealGroupId || dealHint.dealGroupId,
      title: consume.deal.title || dealHint.title,
    };
    const preview = await grantPreviewFromDeal(dealForGrant, platform);
    if (!preview.ok) {
      return {
        ok: false,
        errMsg: preview.errMsg,
        blocked: !!preview.blocked,
        deal: dealForGrant,
        traceId: consume.traceId,
      };
    }

    const grantMeta = preview.grant;
    const grantRes = await grantMemberCourseHours({
      phone: memberPhone,
      venueId,
      lessonKey: grantMeta.lessonKey,
      grantHours: grantMeta.grantHours,
      sourceMeta: platform === 2 ? 'douyin_receipt' : 'meituan_receipt',
    });
    if (!grantRes.ok) return grantRes;

    const now = Date.now();
    const memberName = member.name != null ? String(member.name).trim() : '';
    const dealTitle = consume.deal.title || dealHint.title || '';
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
      },
    };
  }

  return { ok: false, errMsg: '未知 action' };
};
