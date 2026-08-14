const cloud = require('wx-server-sdk');
const https = require('https');
const crypto = require('crypto');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const DEFAULT_AVATAR = '/assets/images/default-avatar.jpg';
/** 同号历史脏数据可能多条，取足够条数再选规范记录 */
const PHONE_HIT_LIMIT = 20;

function requestJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject);
  });
}

function decryptPhoneNumber({ encryptedData, iv, sessionKey, appid }) {
  const bufferKey = Buffer.from(sessionKey, 'base64');
  const bufferIv = Buffer.from(iv, 'base64');
  const encrypted = Buffer.from(encryptedData, 'base64');

  const decipher = crypto.createDecipheriv('aes-128-cbc', bufferKey, bufferIv);
  decipher.setAutoPadding(true);

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  const text = decrypted.toString('utf8');
  const data = JSON.parse(text);

  // 结果校验：appid 必须匹配
  if (data.watermark && data.watermark.appid !== appid) {
    throw new Error('appid mismatch');
  }

  return data.phoneNumber;
}

/**
 * 同一手机号只保留一条业务账号：优先当前 openid，其次无 openid，再次最早创建。
 * 手机号已由微信授权校验，故允许把 _openid 绑到当前微信（换设备/换微信号仍用同一会员资产）。
 */
function pickCanonicalUser(rows, openid) {
  if (!rows || !rows.length) return null;
  const oid = String(openid || '').trim();
  const sameOid = rows.find((r) => String(r._openid || '').trim() === oid);
  if (sameOid) return sameOid;
  const emptyOid = rows.find((r) => !String(r._openid || '').trim());
  if (emptyOid) return emptyOid;
  return [...rows].sort((a, b) => {
    const ca = Number(a.createdAt) || 0;
    const cb = Number(b.createdAt) || 0;
    if (ca !== cb) return ca - cb;
    return String(a._id || '').localeCompare(String(b._id || ''));
  })[0];
}

function publicUser(doc) {
  if (!doc) return null;
  return {
    _id: doc._id,
    phone: doc.phone != null ? String(doc.phone) : '',
    name: doc.name != null ? String(doc.name) : '',
    avatar: doc.avatar != null ? String(doc.avatar) : '',
    isVip: !!doc.isVip,
    isCoach: !!doc.isCoach,
    isManager: !!doc.isManager,
    _openid: doc._openid != null ? String(doc._openid) : '',
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/**
 * 服务端按 phone 查全库并 upsert，避免客户端安全规则读不到旧记录而重复 add。
 */
async function ensureUserByPhone(db, { phone, openid }) {
  const now = Date.now();
  const hit = await db.collection('db_user').where({ phone }).limit(PHONE_HIT_LIMIT).get();
  const rows = (hit && hit.data) || [];

  if (!rows.length) {
    const last4 = phone.length >= 4 ? phone.slice(-4) : phone;
    const name = `昂湃用户_${last4}`;
    const data = {
      phone,
      name,
      avatar: DEFAULT_AVATAR,
      createdAt: now,
      updatedAt: now,
    };
    const addRes = await db.collection('db_user').add({ data });
    return {
      created: true,
      user: publicUser({
        _id: addRes._id,
        _openid: openid,
        ...data,
      }),
    };
  }

  const canonical = pickCanonicalUser(rows, openid);
  const existingOid = canonical._openid != null ? String(canonical._openid).trim() : '';
  const patch = { updatedAt: now };
  let needUpdate = false;

  if (!existingOid || existingOid !== String(openid || '').trim()) {
    patch._openid = openid;
    needUpdate = true;
  }

  if (needUpdate) {
    try {
      await db.collection('db_user').doc(canonical._id).update({ data: patch });
      Object.assign(canonical, patch);
    } catch (e) {
      console.warn('ensureUserByPhone bind openid failed', e);
      // 绑定失败仍返回已有账号，绝不再 insert，避免同号双档
    }
  }

  return {
    created: false,
    user: publicUser(canonical),
    duplicateCount: rows.length > 1 ? rows.length : undefined,
  };
}

exports.main = async (event, context) => {
  const { code, encryptedData, iv } = event || {};
  if (!code || !encryptedData || !iv) {
    return {
      phoneNumber: null,
      user: null,
      created: false,
      error: 'MISSING_PARAMS',
    };
  }

  const { APPID, OPENID } = cloud.getWXContext();

  // 需要在云函数环境变量里配置微信 app secret
  const appSecret = process.env.WECHAT_APP_SECRET;
  if (!appSecret) {
    return {
      phoneNumber: null,
      user: null,
      created: false,
      error: 'MISSING_APP_SECRET',
    };
  }

  // code -> session_key
  const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${encodeURIComponent(
    APPID
  )}&secret=${encodeURIComponent(appSecret)}&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`;

  const sessionRes = await requestJson(url);
  if (!sessionRes || sessionRes.errcode) {
    return {
      phoneNumber: null,
      user: null,
      created: false,
      error: 'JSCODE2SESSION_FAILED',
      details: sessionRes,
    };
  }

  let phoneNumber;
  try {
    phoneNumber = decryptPhoneNumber({
      encryptedData,
      iv,
      sessionKey: sessionRes.session_key,
      appid: APPID,
    });
  } catch (e) {
    return {
      phoneNumber: null,
      user: null,
      created: false,
      error: 'DECRYPT_FAILED',
      errMsg: e.message || String(e),
    };
  }

  const phone = phoneNumber != null ? String(phoneNumber).trim() : '';
  if (!phone || !OPENID) {
    return {
      phoneNumber: phone || null,
      user: null,
      created: false,
      error: !phone ? 'EMPTY_PHONE' : 'MISSING_OPENID',
    };
  }

  try {
    const db = cloud.database();
    const ensured = await ensureUserByPhone(db, { phone, openid: OPENID });
    return {
      phoneNumber: phone,
      user: ensured.user,
      created: !!ensured.created,
      duplicateCount: ensured.duplicateCount,
    };
  } catch (e) {
    console.error('ensureUserByPhone failed', e);
    return {
      phoneNumber: phone,
      user: null,
      created: false,
      error: 'ENSURE_USER_FAILED',
      errMsg: e.message || String(e),
    };
  }
};
