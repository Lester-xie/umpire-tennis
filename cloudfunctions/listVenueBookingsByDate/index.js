const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const LOOKBACK_DAYS = 3;
const FORWARD_DAYS = 60;

function normalizeOrderDate(raw) {
  const s = String(raw || '').trim();
  const parts = s.split('-');
  if (parts.length !== 3) return s;
  const y = parseInt(parts[0], 10);
  const mo = parseInt(parts[1], 10);
  const d = parseInt(parts[2], 10);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return s;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function formatLocalDateStr(date) {
  const y = date.getFullYear();
  const mo = date.getMonth() + 1;
  const d = date.getDate();
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function addDaysStr(baseStr, delta) {
  const parts = String(baseStr || '').split('-');
  if (parts.length !== 3) return '';
  const y = parseInt(parts[0], 10);
  const mo = parseInt(parts[1], 10);
  const d = parseInt(parts[2], 10);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return '';
  const dt = new Date(y, mo - 1, d);
  dt.setDate(dt.getDate() + delta);
  return formatLocalDateStr(dt);
}

function venueIdInValues(venueIdRaw) {
  const s = String(venueIdRaw || '').trim();
  if (!s) return [];
  const out = new Set([s]);
  const n = Number(s);
  if (Number.isFinite(n)) out.add(n);
  return [...out];
}

function orderDateInValues(orderDateRaw, normalized) {
  const raw = String(orderDateRaw || '').trim();
  const set = new Set();
  if (normalized) set.add(normalized);
  if (raw) set.add(raw);
  return [...set];
}

function slotMatches(bookedSlots, courtId, slotIndex) {
  if (!Number.isFinite(courtId) || !Number.isFinite(slotIndex)) return true;
  return (bookedSlots || []).some(
    (s) => Number(s.courtId) === courtId && Number(s.slotIndex) === slotIndex
  );
}

/**
 * 管理员/教练：按场馆+日期查看订场记录（可回溯 3 天）。
 * event: { venueId, orderDate, courtId?, slotIndex? }
 */
exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  if (!openid) {
    return { ok: false, errMsg: '未登录', data: [] };
  }

  const userRes = await db.collection('db_user').where({ _openid: openid }).limit(1).get();
  const user = userRes.data && userRes.data[0];
  if (!user || (!user.isManager && !user.isCoach)) {
    return { ok: false, errMsg: '无权限', data: [] };
  }

  const venueId = String((event && event.venueId) || '').trim();
  const orderDateNorm = normalizeOrderDate((event && event.orderDate) || '');
  if (!venueId || !orderDateNorm) {
    return { ok: false, errMsg: '参数不完整', data: [] };
  }

  const todayStr = formatLocalDateStr(new Date());
  const minDate = addDaysStr(todayStr, -LOOKBACK_DAYS);
  const maxDate = addDaysStr(todayStr, FORWARD_DAYS - 1);
  if (orderDateNorm < minDate || orderDateNorm > maxDate) {
    return { ok: false, errMsg: '仅可查看近 3 天至未来订场记录', data: [] };
  }

  const courtIdRaw = event && event.courtId;
  const slotIndexRaw = event && event.slotIndex;
  const filterCourtId =
    courtIdRaw != null && String(courtIdRaw).trim() !== ''
      ? Number(courtIdRaw)
      : NaN;
  const filterSlotIndex =
    slotIndexRaw != null && String(slotIndexRaw).trim() !== ''
      ? Number(slotIndexRaw)
      : NaN;

  const venueIds = venueIdInValues(venueId);
  const dateValues = orderDateInValues(event.orderDate, orderDateNorm);
  if (!venueIds.length || !dateValues.length) {
    return { ok: false, errMsg: '参数无效', data: [] };
  }

  try {
    const res = await db
      .collection('db_booking')
      .where({
        venueId: _.in(venueIds),
        orderDate: _.in(dateValues),
        status: _.in(['paid', 'payment_confirming']),
      })
      .limit(100)
      .get();

    const rows = (res.data || [])
      .filter((b) => slotMatches(b.bookedSlots, filterCourtId, filterSlotIndex))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .map((b) => ({
        _id: b._id,
        phone: b.phone != null ? String(b.phone) : '',
        memberDisplayName:
          b.memberDisplayName != null
            ? String(b.memberDisplayName)
            : b.userName != null
              ? String(b.userName)
              : '',
        orderDate: b.orderDate,
        formattedDate: b.formattedDate || '',
        status: b.status,
        bookingSubtype: b.bookingSubtype || '',
        totalPrice: b.totalPrice,
        orderItems: Array.isArray(b.orderItems) ? b.orderItems : [],
        bookedSlots: Array.isArray(b.bookedSlots) ? b.bookedSlots : [],
        campusName: b.campusName || '',
        coachCapacityLabel: b.coachCapacityLabel || '',
        lessonKey: b.lessonKey || '',
        createdAt: b.createdAt || 0,
        orderNumber: b.orderNumber || '',
      }));

    return { ok: true, data: rows };
  } catch (e) {
    console.error('listVenueBookingsByDate', e);
    return { ok: false, errMsg: e.message || '查询失败', data: [] };
  }
};
