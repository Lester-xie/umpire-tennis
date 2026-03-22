// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV }) // 使用当前云环境

const db = cloud.database()

/**
 * 支付成功：将支付结果写入 db_pay_order 集合（按 outTradeNo 幂等更新，避免微信重复通知产生多条记录）
 */
async function savePaidOrderToDb({
  outTradeNo,
  totalFee,
  resultCode,
  transactionId,
  timeEnd,
}) {
  if (!outTradeNo) {
    console.error('savePaidOrderToDb: 缺少 outTradeNo，跳过写入');
    return;
  }
  const now = Date.now()
  const payload = {
    outTradeNo,
    totalFee,
    resultCode,
    transactionId,
    timeEnd,
    updatedAt: now,
  }

  const coll = db.collection('db_pay_order')
  const exist = await coll.where({ outTradeNo }).limit(1).get()

  if (exist.data && exist.data.length > 0) {
    const _id = exist.data[0]._id
    await coll.doc(_id).update({ data: payload })
    console.log('db_pay_order 已更新', _id, outTradeNo)
  } else {
    await coll.add({
      data: {
        ...payload,
        createdAt: now,
      },
    })
    console.log('db_pay_order 已新增', outTradeNo)
  }
}

/**
 * 支付成功：将 db_booking 中对应 outTradeNo 的订场单更新为已支付
 */
async function markBookingPaid({ outTradeNo, transactionId, timeEnd }) {
  if (!outTradeNo) return
  const coll = db.collection('db_booking')
  const exist = await coll.where({ outTradeNo }).limit(1).get()
  if (!exist.data || exist.data.length === 0) {
    console.log('markBookingPaid: 无匹配 db_booking', outTradeNo)
    return
  }
  const _id = exist.data[0]._id
  const now = Date.now()
  await coll.doc(_id).update({
    data: {
      status: 'paid',
      transactionId: transactionId || '',
      timeEnd: timeEnd || '',
      paidAt: now,
      updatedAt: now,
    },
  })
  console.log('db_booking 已标记已支付', _id, outTradeNo)
}

// 云函数入口函数
exports.main = async (event, context) => {
  const { outTradeNo, totalFee, resultCode, transactionId, timeEnd } = event;

  if (resultCode === 'SUCCESS') {
    console.log(`支付成功，订单号: ${outTradeNo}, 金额: ${totalFee}`);
    try {
      await savePaidOrderToDb({
        outTradeNo,
        totalFee,
        resultCode,
        transactionId,
        timeEnd,
      });
      await markBookingPaid({ outTradeNo, transactionId, timeEnd });
    } catch (err) {
      console.error('写入 db_pay_order 集合失败', err);
      // 返回非 0 可能导致微信侧重试；若需重试可保持抛出或返回错误码
      return {
        errcode: -1,
        errormessage: err.message || '写入订单失败',
      };
    }
  } else {
    console.log(`支付失败，订单号: ${outTradeNo}`);
  }

  return {
    errcode: 0,
    errormessage: '支付处理完成',
  };
};