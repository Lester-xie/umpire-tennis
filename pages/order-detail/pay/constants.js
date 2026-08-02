const STORAGE_KEYS = {
  userPhoneCode: 'user_phone_code',
  userPhone: 'user_phone',
  userNickname: 'user_nickname',
  userAvatar: 'user_avatar',
};

/** 与 pages/booking-success 约定：支付/纯课时订场成功后写入，成功页读取后删除 */
const BOOKING_SUCCESS_STORAGE_KEY = 'booking_success_payload';

module.exports = {
  STORAGE_KEYS,
  BOOKING_SUCCESS_STORAGE_KEY,
};
