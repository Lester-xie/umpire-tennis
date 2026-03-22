const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

/**
 * 查询当前用户剩余课时（db_member_course_hours）
 * 文档字段：phone, venueId, lessonKey（如 experience:1v1）, hours（number）
 * - 传 venueId：仅该场馆
 * - 传 allVenues: true：该手机号下全部场馆（需与当前微信 openid 绑定一致）
 */
exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const phone = String((event && event.phone) || '').trim()
  const venueId = String((event && event.venueId) || '').trim()
  const allVenues = !!(event && event.allVenues)
  if (!openid || !phone) {
    return { data: [] }
  }

  const userRes = await db.collection('db_user').where({ _openid: openid, phone }).limit(1).get()
  if (!userRes.data || userRes.data.length === 0) {
    return { data: [] }
  }

  try {
    if (allVenues) {
      const res = await db.collection('db_member_course_hours').where({ phone }).get()
      return { data: res.data || [] }
    }
    if (!venueId) {
      return { data: [] }
    }
    const res = await db.collection('db_member_course_hours').where({ phone, venueId }).get()
    return { data: res.data || [] }
  } catch (err) {
    console.error('listMemberCourseHours', err)
    return { data: [], errMsg: err.message || String(err) }
  }
}
