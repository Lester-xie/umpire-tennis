const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

/**
 * 订场归属以手机号为凭证（db_booking.phone）。
 * 用当前微信 openid + 入参 phone 校验 db_user，防止任意伪造手机号拉取他人订单。
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

  try {
    const res = await db.collection('db_booking').where({ phone }).get()

    const list = (res.data || [])
      .filter((doc) => doc.status === 'paid')
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .slice(0, 50)
    return { data: list }
  } catch (err) {
    console.error('listBookings failed', err)
    return { data: [], errMsg: err.message || String(err) }
  }
}
