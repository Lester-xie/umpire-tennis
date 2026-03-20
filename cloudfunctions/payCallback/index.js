// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV }) // 使用当前云环境

// 云函数入口函数
exports.main = async (event, context) => {
  const { out_trade_no, total_fee, trade_state } = event;
  
  if (trade_state === "SUCCESS") {
    console.log(`支付成功，订单号: ${out_trade_no}, 金额: ${total_fee}`);
  } else {
    console.log(`支付失败，订单号: ${out_trade_no}`);
  }
  
  return {
    errcode: 0,
    errormessage: "支付处理完成"
  };
};