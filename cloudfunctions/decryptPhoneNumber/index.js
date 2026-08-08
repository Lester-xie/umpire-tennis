const cloud = require('wx-server-sdk');
const https = require('https');
const crypto = require('crypto');

cloud.init();

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

exports.main = async (event, context) => {
  const { code, encryptedData, iv } = event || {};
  if (!code || !encryptedData || !iv) {
    return {
      phoneNumber: null,
      error: 'MISSING_PARAMS',
    };
  }

  const { APPID } = cloud.getWXContext();

  // 需要在云函数环境变量里配置微信 app secret
  const appSecret = process.env.WECHAT_APP_SECRET;
  if (!appSecret) {
    return {
      phoneNumber: null,
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
      error: 'JSCODE2SESSION_FAILED',
      details: sessionRes,
    };
  }

  const sessionKey = sessionRes.session_key;
  const phoneNumber = decryptPhoneNumber({
    encryptedData,
    iv,
    sessionKey,
    appid: APPID,
  });

  /** 管理员预建教练等无 _openid 的账号：首次授权手机号时绑定当前微信 */
  try {
    const { OPENID } = cloud.getWXContext();
    const phone = phoneNumber != null ? String(phoneNumber).trim() : '';
    if (OPENID && phone) {
      const db = cloud.database();
      const hit = await db.collection('db_user').where({ phone }).limit(1).get();
      const row = hit.data && hit.data[0];
      if (row && row._id) {
        const existingOid = row._openid != null ? String(row._openid).trim() : '';
        if (!existingOid) {
          await db.collection('db_user').doc(row._id).update({
            data: { _openid: OPENID, updatedAt: Date.now() },
          });
        }
      }
    }
  } catch (e) {
    console.warn('bind openid on decryptPhoneNumber failed', e);
  }

  return { phoneNumber };
};

