const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

/**
 * 订场归属以手机号为凭证（db_booking.phone）。
 * 用当前微信 openid + 入参 phone 校验 db_user，防止任意伪造手机号拉取他人订单。
 * event.includePending: 为 true 时包含待支付/确认中，便于「订场历史」取消未支付单
 */
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  if (!openid) {
    return { data: [] }
  }

  const phone = String((event && event.phone) || '').trim()
  if (!phone) {
    return { data: [] }
  }

  const userRes = await db.collection('db_user').where({ _openid: openid, phone }).limit(1).get()
  if (!userRes.data || userRes.data.length === 0) {
    return { data: [] }
  }

  const includePending =
    event && (event.includePending === true || event.includePending === 1 || event.includePending === '1')

  try {
    let res
    if (includePending) {
      res = await db
        .collection('db_booking')
        .where({
          phone,
          status: _.in(['paid', 'pending', 'payment_confirming']),
        })
        .get()
    } else {
      res = await db.collection('db_booking').where({ phone, status: 'paid' }).get()
    }

    const list = (res.data || [])
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .slice(0, 50)
    return { data: list }
  } catch (err) {
    console.error('listBookings failed', err)
    return { data: [], errMsg: err.message || String(err) }
  }
}
