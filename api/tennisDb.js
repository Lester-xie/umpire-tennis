// 云数据库封装：给前端提供“读 court_slot_prices 等数据”的方法

function getDb() {
  return wx.cloud.database();
}

/**
 * 获取某场馆/球场的 slot 价格规则
 * court_slot_prices 建议字段：
 * - venueId
 * - courtId
 * - slotIndex（0..14）
 * - price（number）
 */
function getCourtSlotPrices({ venueId, courtIds } = {}) {
  const db = getDb();
  const cond = {};
  if (venueId != null) cond.venueId = venueId;

  if (courtIds && Array.isArray(courtIds) && courtIds.length > 0) {
    cond.courtId = db.command.in(courtIds);
  }

  return db.collection('court_slot_prices').where(cond).get();
}

/**
 * 获取场馆列表
 * venue 集合建议字段：
 * - name
 * - address
 * - latitude
 * - longitude
 * - （可选）image
 * - courtList: [{ name, priceList, specialPrice? }] — priceList 长度 14；周六日单价用 specialPrice（可选）
 */
function getVenues() {
  const db = getDb();
  return db.collection('venue').get();
}

/**
 * 按手机号查询用户
 * user 集合字段建议：
 * - phone
 * - name
 * - avatar
 */
function getUserByPhone(phone) {
  if (!phone) return Promise.resolve({ data: [] });
  const db = getDb();
  return db.collection('user').where({ phone }).get();
}

/**
 * 新增用户
 */
function createUser({ phone, name, avatar } = {}) {
  const db = getDb();
  const data = {
    phone: phone || '',
    name: name || '',
    avatar: avatar || '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  return db.collection('user').add({ data });
}

function decryptPhoneNumber({ code, encryptedData, iv, appid } = {}) {
  return wx.cloud.callFunction({
    name: 'decryptPhoneNumber',
    data: {
      code,
      encryptedData,
      iv,
      appid,
    },
  });
}

/**
 * 根据手机号更新 user 集合字段（例如头像/昵称）
 */
function updateUserByPhone({ phone, update } = {}) {
  const db = getDb();
  const data = update || {};
  if (!phone) return Promise.reject(new Error('MISSING_PHONE'));
  if (!data || Object.keys(data).length === 0) return Promise.resolve({ stats: { updated: 0 } });

  return db
    .collection('user')
    .where({ phone })
    .update({
      data: {
        ...data,
        updatedAt: Date.now(),
      },
    });
}

module.exports = {
  getCourtSlotPrices,
  getVenues,
  getUserByPhone,
  createUser,
  decryptPhoneNumber,
  updateUserByPhone,
};

