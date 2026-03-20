// 云函数入口文件
const crypto = require('crypto')
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV }) // 使用当前云环境

/**
 * 生成 32 位纯数字商户订单号（仅 0-9，长度固定 32）
 * 形如：1217752501201407033233368018（毫秒时间戳 + 随机数字补满 32 位）
 */
function generateOutTradeNo32() {
  const ts = Date.now().toString();
  if (ts.length >= 32) {
    return ts.slice(0, 32);
  }
  const need = 32 - ts.length;
  const buf = crypto.randomBytes(need);
  let rand = '';
  for (let i = 0; i < need; i++) {
    rand += String(buf[i] % 10);
  }
  return ts + rand;
}

/**
 * 随机字符串（微信支付 nonceStr 常用 32 位）
 * 小程序/云函数均无内置 generateRandomString，云函数里用 Node crypto 即可
 */
function generateRandomString(length = 32) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += chars[bytes[i] % chars.length];
  }
  return out;
}

// 云函数入口函数
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  /** 当前用户在小程序下的 openid；子商户 JSAPI 下作为 subOpenid 传入 */
  const openid = wxContext.OPENID;
  /**
   * 子商户绑定的小程序 AppId（与 subOpenid 配对使用）
   * 优先读环境变量 SUB_APPID；未配置时用云函数上下文里的 APPID（一般为当前小程序 appid）
   */
  const subAppid =
    process.env.SUB_APPID ||
    process.env.subAppid ||
    event.subAppid ||
    wxContext.APPID;

  // 终端 IP：优先从云函数 context 取（更可靠）
  // 兜底：从 event 里取（如果你自己传了），最后用 127.0.0.1
  const terminalIp =
    context?.CLIENTIP ||
    context?.clientIP ||
    event?.spbillCreateIp ||
    event?.terminalIp ||
    '127.0.0.1';

  // 微信要求 out_trade_no ≤32 字符；此处固定为 32 位纯数字（仅 0-9）
  const outTradeNo = generateOutTradeNo32();
  if (!/^\d{1,32}$/.test(outTradeNo)) {
    return {
      returnCode: 'FAIL',
      returnMsg: '商户订单号必须为纯数字',
      payment: undefined,
    };
  }
  const envId = process.env.ENV_ID;
  const subMchId = process.env.subMchId;

  // totalFee 必须为「整数、单位：分」。传 0.1 等小数会报「参数格式校验错误」，且不会返回 payment
  const rawFee = event.totalFee != null ? Number(event.totalFee) : 1;
  const totalFee = Math.max(1, Math.round(rawFee));

  if (!subMchId || !envId) {
    return {
      returnCode: 'FAIL',
      returnMsg: '云函数缺少环境变量 subMchId 或 ENV_ID',
      payment: undefined,
    };
  }

  if (!openid) {
    return {
      returnCode: 'FAIL',
      returnMsg: '缺少用户 OPENID，请先在小程序端完成登录/授权后再调起支付',
      payment: undefined,
    };
  }

  // 子商户号模式：JSAPI 需 subMchId + subAppid + subOpenid（与 openid 二选一，不要同时混用）
  if (!subAppid) {
    return {
      returnCode: 'FAIL',
      returnMsg:
        '子商户支付需 subAppid：请在云函数环境变量配置 SUB_APPID，或确保 wxContext.APPID 可用',
      payment: undefined,
    };
  }
  const params = {
    body: '昂湃Tennis', // 商品描述
    outTradeNo, // 商户订单号：纯数字，固定 32 位（≤32 字符）
    spbillCreateIp: terminalIp, // 终端 IP（IPv4/IPv6）
    subMchId, // 子商户号（微信支付分配）
    subAppid, // 子商户小程序/公众号 appid（与 subOpenid 配套）
    totalFee, // 订单总金额，单位：分，整数
    envId, // 接收支付回调的云函数所在环境 ID
    functionName: 'payCallback', // 支付结果异步通知云函数名
    nonceStr: generateRandomString(32), // 随机字符串，≤32 位
    tradeType: 'JSAPI',
    subOpenid: openid, // 用户在子商户 subAppid 下的 openid
  }
  console.log('params', params);
  const res = await cloud.cloudPay.unifiedOrder(params);
  return res;
};