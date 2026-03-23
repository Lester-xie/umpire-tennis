/** 与云函数一致，用于和「我的场地占用」、接口返回的 orderDate 对齐 */
function normalizeOrderDateStr(d) {
  const s = String(d || '').trim();
  const parts = s.split('-');
  if (parts.length !== 3) return s;
  const y = parseInt(parts[0], 10);
  const mo = parseInt(parts[1], 10);
  const day = parseInt(parts[2], 10);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(day)) return s;
  return `${y}-${String(mo).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function getTodayDateStr() {
  const today = new Date();
  const month = today.getMonth() + 1;
  const day = today.getDate();
  return `${today.getFullYear()}-${month < 10 ? '0' + month : month}-${day < 10 ? '0' + day : day}`;
}

/**
 * 订场 / 教练占场共用的横向日期条数据
 * @param {number} numDays
 * @param {string} existingSelectedDate 已有选中日期时不自动改为「今天」
 */
function buildBookingDateList(numDays, existingSelectedDate) {
  const dateList = [];
  const today = new Date();
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  const todayYear = today.getFullYear();
  const todayMonth = today.getMonth();
  const todayDate = today.getDate();

  let defaultSelectedDate = String(existingSelectedDate || '').trim();

  for (let i = 0; i < numDays; i += 1) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);

    const month = date.getMonth() + 1;
    const day = date.getDate();

    const isToday =
      date.getFullYear() === todayYear &&
      date.getMonth() === todayMonth &&
      date.getDate() === todayDate;

    const weekday = isToday ? '今天' : weekdays[date.getDay()];

    const monthStr = month < 10 ? `0${month}` : `${month}`;
    const dayStr = day < 10 ? `0${day}` : `${day}`;
    const dateStr = `${date.getFullYear()}-${monthStr}-${dayStr}`;

    dateList.push({
      weekday,
      monthDay: `${month}.${day}`,
      date,
      dateStr,
      isToday,
    });

    if (isToday && !defaultSelectedDate) {
      defaultSelectedDate = dateStr;
    }
  }

  return { dateList, defaultSelectedDate };
}

module.exports = {
  normalizeOrderDateStr,
  getTodayDateStr,
  buildBookingDateList,
};
