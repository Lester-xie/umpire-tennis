const crypto = require('crypto')
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

function generateRandomString(length = 32) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = crypto.randomBytes(length)
  let out = ''
  for (let i = 0; i < length; i += 1) {
    out += chars[bytes[i] % chars.length]
  }
  return out
}

function isExperienceLessonKey(lk) {
  return String(lk || '').trim().toLowerCase().startsWith('experience:')
}

function venueIdLooseEqual(a, b) {
  const sa = a == null ? '' : String(a).trim()
  const sb = b == null ? '' : String(b).trim()
  if (sa === sb) return true
  const na = Number(sa)
  const nb = Number(sb)
  return Number.isFinite(na) && Number.isFinite(nb) && na === nb
}

/**
 * 体验课课时包原路退款（未使用或按剩余课时比例退）
 * event: { phone, venueId, lessonKey } — phone 须与当前 openid 在 db_user 中一致
 */
exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const phone = String((event && event.phone) || '').trim()
  const venueIdRaw = String((event && event.venueId) || '').trim()
  const lessonKeyNorm = String((event && event.lessonKey) || '').trim()

  if (!openid || !phone || !venueIdRaw || !lessonKeyNorm) {
    return { ok: false, errMsg: '参数不完整' }
  }
  if (!isExperienceLessonKey(lessonKeyNorm)) {
    return { ok: false, errMsg: '仅支持体验课课时退款' }
  }

  const userRes = await db.collection('db_user').where({ _openid: openid, phone }).limit(1).get()
  if (!userRes.data || userRes.data.length === 0) {
    return { ok: false, errMsg: '用户校验失败' }
  }

  const bookingRes = await db.collection('db_booking').where({ phone }).get()
  const participated = (bookingRes.data || []).some((doc) => {
    if (String(doc.bookingSubtype || '') !== 'coach_course') return false
    if (!isExperienceLessonKey(doc.lessonKey)) return false
    const st = String(doc.status || '')
    return ['paid', 'pending', 'payment_confirming'].includes(st)
  })
  if (!participated) {
    return {
      ok: false,
      errMsg: '仅已参加过体验课且仍有余课时可申请退款',
    }
  }

  const subMchId = process.env.subMchId
  if (!subMchId) {
    return { ok: false, errMsg: '服务端未配置 subMchId，无法退款' }
  }

  const balRes = await db.collection('db_member_course_hours').where({ phone }).get()
  const balRow = (balRes.data || []).find(
    (d) =>
      venueIdLooseEqual(d.venueId, venueIdRaw) &&
      String(d.lessonKey || '').trim() === lessonKeyNorm,
  )
  if (!balRow || !balRow._id) {
    return { ok: false, errMsg: '未找到对应课时记录' }
  }

  const hoursRem = Math.floor(Number(balRow.hours) || 0)
  if (hoursRem <= 0) {
    return { ok: false, errMsg: '当前无可退课时' }
  }

  const purchaseRes = await db.collection('db_course_purchase').where({ phone }).get()
  const candidates = (purchaseRes.data || [])
    .filter(
      (d) =>
        venueIdLooseEqual(d.venueId, venueIdRaw) &&
        String(d.lessonKey || '').trim() === lessonKeyNorm &&
        String(d.status || '') === 'paid' &&
        String(d.refundStatus || '') !== 'success',
    )
    .sort((a, b) => (b.paidAt || b.createdAt || 0) - (a.paidAt || a.createdAt || 0))

  if (candidates.length > 1) {
    return { ok: false, errMsg: '检测到多笔相关订单，请联系场馆协助退款' }
  }

  const purchase = candidates[0]
  if (!purchase || !purchase.outTradeNo) {
    return { ok: false, errMsg: '未找到可退款的体验课购买订单' }
  }

  const grantHours = Math.floor(Number(purchase.grantHours) || 0)
  const totalFee = Math.floor(Number(purchase.totalFee) || 0)
  if (grantHours <= 0 || totalFee <= 0) {
    return { ok: false, errMsg: '订单数据异常' }
  }

  const refundFee = Math.floor((totalFee * hoursRem) / grantHours)
  if (refundFee < 1) {
    return { ok: false, errMsg: '退款金额过小，请联系场馆处理' }
  }

  const outTradeNo = String(purchase.outTradeNo).trim()
  const outRefundNo = `rfe${Date.now()}${crypto.randomBytes(3).toString('hex')}`.slice(0, 32)
  const now = Date.now()

  try {
    const res = await cloud.cloudPay.refund({
      outTradeNo,
      outRefundNo,
      totalFee,
      refundFee,
      subMchId,
      nonceStr: generateRandomString(32),
      refundDesc: '体验课课时包退款',
    })
    const refundOk = res.returnCode === 'SUCCESS' || res.resultCode === 'SUCCESS'
    if (!refundOk) {
      return {
        ok: false,
        errMsg: res.returnMsg || res.errMsg || res.errmsg || res.return_msg || '微信退款失败',
      }
    }
  } catch (err) {
    console.error('refundExperienceCoursePurchase refund', err)
    return { ok: false, errMsg: err.message || '退款异常' }
  }

  try {
    await db.collection('db_course_purchase').doc(purchase._id).update({
      data: {
        status: 'refunded',
        refundStatus: 'success',
        refundFee,
        refundedHours: hoursRem,
        outRefundNo,
        refundedAt: now,
        updatedAt: now,
      },
    })

    await db.collection('db_member_course_hours').doc(balRow._id).update({
      data: {
        hours: Math.max(0, Math.floor(Number(balRow.hours) || 0) - hoursRem),
        updatedAt: now,
      },
    })
  } catch (err) {
    console.error('refundExperienceCoursePurchase db update', err)
    return { ok: false, errMsg: '退款已成功，但更新记录失败，请联系客服' }
  }

  return {
    ok: true,
    refundFee,
    refundedHours: hoursRem,
  }
}
