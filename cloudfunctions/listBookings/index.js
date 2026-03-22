const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

/**
 * 返回当前 openid 下已支付的订场记录（db_booking），按创建时间倒序
 */
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  if (!openid) {
    return { data: [] }
  }

  try {
    const res = await db.collection('db_booking').where({ _openid: openid }).get()

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
