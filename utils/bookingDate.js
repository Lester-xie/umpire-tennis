/** 与云函数一致，用于和接口返回的 orderDate 对齐 */
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

function formatLocalDateStr(date) {
  const y = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const monthStr = month < 10 ? `0${month}` : `${month}`;
  const dayStr = day < 10 ? `0${day}` : `${day}`;
  return `${y}-${monthStr}-${dayStr}`;
}

/**
 * 订场 / 教练占场共用的横向日期条数据
 * @param {number} numDays 从今天起向前（含今天）的天数
 * @param {string} existingSelectedDate 已有选中日期时不自动改为「今天」
 * @param {number} [lookbackDays=0] 今天之前可回溯的天数（管理员/教练看历史）
 */
function buildBookingDateList(numDays, existingSelectedDate, lookbackDays) {
  const dateList = [];
  const today = new Date();
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  const todayYear = today.getFullYear();
  const todayMonth = today.getMonth();
  const todayDate = today.getDate();
  const todayStr = formatLocalDateStr(today);

  const lookback = Math.max(0, Math.floor(Number(lookbackDays) || 0));
  const forward = Math.max(1, Math.floor(Number(numDays) || 1));

  let defaultSelectedDate = String(existingSelectedDate || '').trim();

  for (let i = -lookback; i < forward; i += 1) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);

    const month = date.getMonth() + 1;
    const day = date.getDate();
    const dateStr = formatLocalDateStr(date);

    const isToday =
      date.getFullYear() === todayYear &&
      date.getMonth() === todayMonth &&
      date.getDate() === todayDate;

    let weekday;
    if (isToday) {
      weekday = '今天';
    } else if (i === -1) {
      weekday = '昨天';
    } else {
      weekday = weekdays[date.getDay()];
    }

    dateList.push({
      weekday,
      monthDay: `${month}.${day}`,
      date,
      dateStr,
      isToday,
      isPastDay: dateStr < todayStr,
    });

    if (isToday && !defaultSelectedDate) {
      defaultSelectedDate = dateStr;
    }
  }

  if (defaultSelectedDate) {
    const inList = dateList.some((d) => d.dateStr === defaultSelectedDate);
    if (!inList) defaultSelectedDate = todayStr;
  }

  return { dateList, defaultSelectedDate };
}

module.exports = {
  normalizeOrderDateStr,
  getTodayDateStr,
  buildBookingDateList,
};
