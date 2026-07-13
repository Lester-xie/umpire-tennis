const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const {
  lessonHoursForBooking,
  lessonValueCentsForBooking,
} = require('./courseHourUnit');

function isStaffUser(u) {
  return !!(u && u.isManager);
}

async function assertStaffCaller(openid) {
  const res = await db.collection('db_user').where({ _openid: openid }).limit(1).get();
  const u = res.data && res.data[0];
  if (!isStaffUser(u)) return null;
  return u;
}

function pad2(n) {
  return n < 10 ? `0${n}` : String(n);
}

/** 上课月份范围：orderDate 字符串 YYYY-MM-DD */
function orderDateRangeForMonth(year, month1to12) {
  const y = Math.floor(Number(year));
  const m = Math.floor(Number(month1to12));
  const start = `${y}-${pad2(m)}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const end = `${y}-${pad2(m)}-${pad2(lastDay)}`;
  return { start, end };
}

function emptyBreakdown() {
  return {
    experience: { count: 0 },
    regular1v1: { count: 0, valueCents: 0 },
    regular1v2: { count: 0, valueCents: 0 },
    regularOther: { count: 0, valueCents: 0 },
    other: { count: 0, valueCents: 0 },
  };
}

function classifyLessonKey(lkRaw) {
  const lk = String(lkRaw || '').trim().toLowerCase();
  if (lk.startsWith('experience:')) return 'experience';
  if (lk === 'regular:1v1') return 'regular1v1';
  if (lk === 'regular:1v2') return 'regular1v2';
  if (lk.startsWith('regular:')) return 'regularOther';
  return 'other';
}

function normPhone(s) {
  const d = String(s || '').replace(/\D/g, '');
  if (d.length >= 11) return d.slice(-11);
  return d;
}

function coachMatchKeysFromHold(h) {
  if (!h || typeof h !== 'object') return { openid: '', phoneNorm: '' };
  const openid = h._openid != null ? String(h._openid).trim() : '';
  const phoneNorm = normPhone(h.phone);
  return { openid, phoneNorm };
}

async function fetchHoldsMap(ids) {
  const unique = [...new Set((ids || []).map((id) => String(id || '').trim()).filter(Boolean))];
  const out = {};
  const chunk = 40;
  for (let i = 0; i < unique.length; i += chunk) {
    const slice = unique.slice(i, i + chunk);
    const results = await Promise.all(
      slice.map((id) =>
        db
          .collection('db_coach_slot_hold')
          .doc(id)
          .get()
          .then((r) => ({ id, r }))
          .catch(() => ({ id, r: null })),
      ),
    );
    results.forEach(({ id, r }) => {
      if (r && r.data) out[id] = r.data;
    });
  }
  return out;
}

function breakdownToClient(b) {
  const regularCount =
    b.regular1v1.count + b.regular1v2.count + b.regularOther.count + b.other.count;
  const regularValueCents =
    b.regular1v1.valueCents +
    b.regular1v2.valueCents +
    b.regularOther.valueCents +
    b.other.valueCents;

  const toRow = (row) => ({
    count: Math.floor(Number(row.count) || 0),
    valueYuan: row.valueCents != null ? (Math.floor(row.valueCents) / 100).toFixed(2) : undefined,
  });

  return {
    experience: { count: Math.floor(Number(b.experience.count) || 0) },
    regular1v1: toRow(b.regular1v1),
    regular1v2: toRow(b.regular1v2),
    regularOther: toRow(b.regularOther),
    other: toRow(b.other),
    regularTotal: {
      count: regularCount,
      valueYuan: (Math.floor(regularValueCents) / 100).toFixed(2),
    },
  };
}

function addBookingToBreakdown(breakdown, booking) {
  const kind = classifyLessonKey(booking.lessonKey);
  const hours = lessonHoursForBooking(booking);
  const valueCents = lessonValueCentsForBooking(booking);

  if (kind === 'experience') {
    breakdown.experience.count += hours;
    return;
  }

  breakdown[kind].count += hours;
  breakdown[kind].valueCents += valueCents;
}

/**
 * event: { year, month }  month 1–12
 * 按 orderDate（实际上课日期）所在自然月统计；
 * 正课：节数 + 课包单价合计（lessonValueCents）；体验课：仅节数。
 */
exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  if (!openid) return { ok: false, errMsg: '未登录' };

  const admin = await assertStaffCaller(openid);
  if (!admin) return { ok: false, errMsg: '无权限' };

  const year = event && event.year != null ? Number(event.year) : NaN;
  const month = event && event.month != null ? Number(event.month) : NaN;
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return { ok: false, errMsg: '年月无效' };
  }

  const { start, end } = orderDateRangeForMonth(year, month);

  try {
    const [userRes, bookingRes] = await Promise.all([
      db.collection('db_user').where({ isCoach: true }).limit(500).get(),
      db
        .collection('db_booking')
        .where({
          status: 'paid',
          bookingSubtype: 'coach_course',
          orderDate: _.gte(start).and(_.lte(end)),
        })
        .limit(1000)
        .get(),
    ]);

    const coachUsers = (userRes.data || [])
      .map((u) => {
        const idStr = u._id != null ? String(u._id) : '';
        const phone = u.phone != null ? String(u.phone).trim() : '';
        const phoneNorm = normPhone(phone);
        const oid = u._openid != null ? String(u._openid).trim() : '';
        const name = u.name != null ? String(u.name).trim() : '';
        return {
          _id: idStr,
          phone,
          phoneNorm,
          openid: oid,
          name,
          displayName: name || phone || (oid && oid.length > 6 ? oid.slice(-6) : '') || '教练',
        };
      })
      .filter((c) => c.phone || c.openid);

    const indexByOpenid = new Map();
    const indexByPhoneNorm = new Map();
    for (let ci = 0; ci < coachUsers.length; ci += 1) {
      const c = coachUsers[ci];
      if (c.openid) indexByOpenid.set(c.openid, ci);
      if (c.phoneNorm) indexByPhoneNorm.set(c.phoneNorm, ci);
    }

    const rowBreakdowns = coachUsers.map(() => emptyBreakdown());
    const unmatchedBreakdowns = [];
    const unmatchedMeta = [];

    const bookings = bookingRes.data || [];
    const holdIdFirst = [];
    for (let i = 0; i < bookings.length; i += 1) {
      const arr = Array.isArray(bookings[i].coachHoldIds) ? bookings[i].coachHoldIds : [];
      if (arr[0]) holdIdFirst.push(String(arr[0]).trim());
    }
    const holdMap = await fetchHoldsMap(holdIdFirst);

    for (let i = 0; i < bookings.length; i += 1) {
      const b = bookings[i];
      const arr = Array.isArray(b.coachHoldIds) ? b.coachHoldIds : [];
      const hid = arr[0] ? String(arr[0]).trim() : '';
      const h = hid ? holdMap[hid] : null;
      if (!h) continue;

      const { openid: holdOid, phoneNorm: holdPn } = coachMatchKeysFromHold(h);
      let idx = -1;
      if (holdOid && indexByOpenid.has(holdOid)) {
        idx = indexByOpenid.get(holdOid);
      } else if (holdPn && indexByPhoneNorm.has(holdPn)) {
        idx = indexByPhoneNorm.get(holdPn);
      }

      if (idx >= 0) {
        addBookingToBreakdown(rowBreakdowns[idx], b);
      } else {
        const coachLabel =
          h.coachName != null && String(h.coachName).trim() !== ''
            ? String(h.coachName).trim()
            : '未在教练列表中';
        const phoneShow = h.phone != null ? String(h.phone).trim() : '';
        let u = unmatchedMeta.findIndex((m) => m.holdOpenid && holdOid && m.holdOpenid === holdOid);
        if (u < 0 && holdPn) {
          u = unmatchedMeta.findIndex((m) => m.holdPhoneNorm && m.holdPhoneNorm === holdPn);
        }
        if (u < 0) {
          u = unmatchedMeta.length;
          unmatchedMeta.push({
            holdOpenid: holdOid,
            holdPhoneNorm: holdPn,
            coachLabel,
            phoneShow,
          });
          unmatchedBreakdowns.push(emptyBreakdown());
        }
        addBookingToBreakdown(unmatchedBreakdowns[u], b);
      }
    }

    const coaches = coachUsers.map((c, idx) => ({
      phone: c.phone,
      openid: c.openid,
      name: c.name,
      displayName: c.displayName,
      stats: breakdownToClient(rowBreakdowns[idx]),
    }));

    const extraCoaches = unmatchedMeta.map((m, j) => ({
      phone: m.phoneShow,
      openid: m.holdOpenid,
      name: '',
      displayName: m.coachLabel,
      stats: breakdownToClient(unmatchedBreakdowns[j]),
    }));

    return {
      ok: true,
      data: {
        year,
        month,
        orderDateStart: start,
        orderDateEnd: end,
        coaches: extraCoaches.length > 0 ? coaches.concat(extraCoaches) : coaches,
        coachBookingTruncated: bookings.length >= 1000,
      },
    };
  } catch (e) {
    console.error('adminCoachMonthStats', e);
    return { ok: false, errMsg: e.message || '统计失败' };
  }
};
