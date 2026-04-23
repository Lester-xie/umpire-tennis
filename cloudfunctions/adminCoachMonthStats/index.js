const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

function isStaffUser(u) {
  return !!(u && u.isManager);
}

async function assertStaffCaller(openid) {
  const res = await db.collection('db_user').where({ _openid: openid }).limit(1).get();
  const u = res.data && res.data[0];
  if (!isStaffUser(u)) return null;
  return u;
}

function monthRangeMs(year, month1to12) {
  const y = Math.floor(Number(year));
  const m = Math.floor(Number(month1to12));
  const start = new Date(y, m - 1, 1).getTime();
  const end = new Date(y, m, 1).getTime();
  return { start, end };
}

/** 教练课订单金额：以 totalPrice（元）为准；无则 totalFee（分）/100 */
function bookingAmountCents(b) {
  const tp = Number(b.totalPrice);
  if (Number.isFinite(tp) && tp >= 0) {
    return Math.round(tp * 100);
  }
  const tf = Math.floor(Number(b.totalFee) || 0);
  return Math.max(0, tf);
}

function emptyBreakdown() {
  return {
    experience: { count: 0, amountCents: 0 },
    regular1v1: { count: 0, amountCents: 0 },
    regular1v2: { count: 0, amountCents: 0 },
    regularOther: { count: 0, amountCents: 0 },
    other: { count: 0, amountCents: 0 },
    /** 正课课包 ≥10h：已上过该教练体验课的会员在当月付款，每单计 1 次，归 experienceCourseCoachId 教练 */
    packageReward: { count: 0, amountCents: 0 },
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

/** 与 db_user 匹配用：去非数字，取后 11 位（国内手机） */
function normPhone(s) {
  const d = String(s || '').replace(/\D/g, '');
  if (d.length >= 11) return d.slice(-11);
  return d;
}

/**
 * 统计归属教练：以占用记录上的占用人（教练）为准，与会员 A 的 booking.phone 无关。
 * 优先 _openid 匹配 db_user，再按规范化手机号匹配。
 */
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
  const keys = Object.keys(b);
  const o = {};
  for (let i = 0; i < keys.length; i += 1) {
    const k = keys[i];
    const { count, amountCents } = b[k];
    o[k] = {
      count: Math.floor(Number(count) || 0),
      amountYuan: (Math.floor(amountCents) / 100).toFixed(2),
    };
  }
  return o;
}

/** 正课课时包且 grant≥10、非体验课 lessonKey */
function isEligiblePackageForCoachReward(p) {
  const gh = Math.floor(Number(p && p.grantHours) || 0);
  if (gh < 10) return false;
  const lk = String((p && p.lessonKey) || '')
    .trim()
    .toLowerCase();
  if (lk.startsWith('experience:')) return false;
  return lk.startsWith('regular:');
}

/** 供管理端课包奖励明细 */
function packageRewardItemForClient(pr, exp) {
  const ph = String(pr && pr.phone != null ? pr.phone : '').trim();
  const grantHours = Math.floor(Number(pr && pr.grantHours) || 0);
  const lessonKey = pr && pr.lessonKey != null ? String(pr.lessonKey).trim() : '';
  const goodDesc = pr && pr.goodDesc != null ? String(pr.goodDesc).trim() : '';
  const fee = Math.floor(Number(pr && pr.totalFee) || 0);
  const paidAt = pr && pr.paidAt != null ? Number(pr.paidAt) : 0;
  return {
    phone: ph,
    userName: exp && exp.userName != null && String(exp.userName).trim() !== '' ? String(exp.userName).trim() : '',
    grantHours,
    lessonKey,
    goodDesc,
    specLabel: goodDesc || lessonKey || '课时包',
    amountFen: fee,
    amountYuan: (fee / 100).toFixed(2),
    paidAt: Number.isFinite(paidAt) ? paidAt : 0,
  };
}

async function userExperienceFieldsByPhoneMap(phones) {
  const list = [...new Set((phones || []).map((p) => String(p || '').trim()).filter(Boolean))];
  if (list.length === 0) return {};
  const out = {};
  const chunkSize = 20;
  for (let i = 0; i < list.length; i += chunkSize) {
    const chunk = list.slice(i, i + chunkSize);
    try {
      const ur = await db
        .collection('db_user')
        .where({ phone: _.in(chunk) })
        .field({ phone: true, name: true, experienceCourseCoachId: true, experienceCourseCoachName: true })
        .get();
      (ur.data || []).forEach((row) => {
        const ph = row.phone != null ? String(row.phone).trim() : '';
        if (!ph) return;
        out[ph] = {
          userName: row.name != null ? String(row.name).trim() : '',
          experienceCourseCoachId:
            row.experienceCourseCoachId != null && String(row.experienceCourseCoachId).trim() !== ''
              ? String(row.experienceCourseCoachId).trim()
              : '',
          experienceCourseCoachName:
            row.experienceCourseCoachName != null ? String(row.experienceCourseCoachName).trim() : '',
        };
      });
    } catch (e) {
      console.error('adminCoachMonthStats userExperienceByPhone', e);
    }
  }
  return out;
}

/**
 * event: { year, month }  month 1–12
 * 已付教练课 db_booking：paidAt 落在该月；用 coachHoldIds[0] 查占用，按占用人（教练）openid/手机计入。
 * 已付正课课包 db_course_purchase：grantHours≥10、非体验课 lessonKey，且会员有 experienceCourseCoachId 时
 * 计入该教练的 packageReward。教练列表为 isCoach 用户，无法匹配时追加「未在教练列表中」行。
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

  const { start, end } = monthRangeMs(year, month);

  try {
    const [userRes, bookingRes, purchaseRes] = await Promise.all([
      db
        .collection('db_user')
        .where({ isCoach: true })
        .limit(500)
        .get(),
      db
        .collection('db_booking')
        .where({
          status: 'paid',
          paidAt: _.gte(start).and(_.lt(end)),
          bookingSubtype: 'coach_course',
        })
        .limit(1000)
        .get(),
      db
        .collection('db_course_purchase')
        .where({
          status: 'paid',
          paidAt: _.gte(start).and(_.lt(end)),
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

    /** openid / 手机 / 文档 _id -> 行下标；课包奖励按 experienceCourseCoachId（多存为教练 db_user._id）匹配 */
    const indexByOpenid = new Map();
    const indexByPhoneNorm = new Map();
    const indexByCoachUserId = new Map();
    for (let ci = 0; ci < coachUsers.length; ci += 1) {
      const c = coachUsers[ci];
      if (c.openid) indexByOpenid.set(c.openid, ci);
      if (c.phoneNorm) indexByPhoneNorm.set(c.phoneNorm, ci);
      if (c._id) indexByCoachUserId.set(c._id, ci);
    }

    const rowBreakdowns = coachUsers.map(() => emptyBreakdown());
    const rowPackageDetails = coachUsers.map(() => []);
    const unmatchedBreakdowns = [];
    const unmatchedMeta = [];
    const unmatchedPackageDetails = [];

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
      const cents = bookingAmountCents(b);
      const kind = classifyLessonKey(b.lessonKey);
      if (idx >= 0) {
        rowBreakdowns[idx][kind].count += 1;
        rowBreakdowns[idx][kind].amountCents += cents;
      } else {
        const coachLabel = h.coachName != null && String(h.coachName).trim() !== '' ? String(h.coachName).trim() : '未在教练列表中';
        const phoneShow = h.phone != null ? String(h.phone).trim() : '';
        let u = unmatchedMeta.findIndex(
          (m) => m.holdOpenid && holdOid && m.holdOpenid === holdOid,
        );
        if (u < 0 && holdPn) {
          u = unmatchedMeta.findIndex((m) => m.holdPhoneNorm && m.holdPhoneNorm === holdPn);
        }
        if (u < 0) {
          u = unmatchedMeta.length;
          unmatchedMeta.push({
            holdOpenid: holdOid,
            holdPhoneNorm: holdPn,
            expCoachId: '',
            coachLabel,
            phoneShow,
          });
          unmatchedBreakdowns.push(emptyBreakdown());
          unmatchedPackageDetails.push([]);
        }
        unmatchedBreakdowns[u][kind].count += 1;
        unmatchedBreakdowns[u][kind].amountCents += cents;
      }
    }

    const purchaseRows = (purchaseRes.data || []).filter((row) => isEligiblePackageForCoachReward(row));
    const purchasePhones = [...new Set(purchaseRows.map((r) => String(r.phone || '').trim()).filter(Boolean))];
    const expByPhone = await userExperienceFieldsByPhoneMap(purchasePhones);

    for (let pi = 0; pi < purchaseRows.length; pi += 1) {
      const pr = purchaseRows[pi];
      const ph = String(pr.phone || '').trim();
      const exp = expByPhone[ph];
      if (!exp || !exp.experienceCourseCoachId) continue;
      const coachRef = String(exp.experienceCourseCoachId).trim();
      const fee = Math.floor(Number(pr.totalFee) || 0);
      const item = packageRewardItemForClient(pr, exp);
      let idx = -1;
      if (indexByCoachUserId.has(coachRef)) idx = indexByCoachUserId.get(coachRef);
      else if (indexByOpenid.has(coachRef)) idx = indexByOpenid.get(coachRef);
      if (idx >= 0) {
        rowBreakdowns[idx].packageReward.count += 1;
        rowBreakdowns[idx].packageReward.amountCents += fee;
        rowPackageDetails[idx].push(item);
      } else {
        const label =
          exp.experienceCourseCoachName && String(exp.experienceCourseCoachName).trim() !== ''
            ? String(exp.experienceCourseCoachName).trim()
            : '课包奖励·未在教练列表';
        let u = unmatchedMeta.findIndex((m) => m.expCoachId && m.expCoachId === coachRef);
        if (u < 0) {
          u = unmatchedMeta.length;
          unmatchedMeta.push({
            holdOpenid: '',
            holdPhoneNorm: '',
            expCoachId: coachRef,
            coachLabel: label,
            phoneShow: '',
          });
          unmatchedBreakdowns.push(emptyBreakdown());
          unmatchedPackageDetails.push([]);
        }
        unmatchedBreakdowns[u].packageReward.count += 1;
        unmatchedBreakdowns[u].packageReward.amountCents += fee;
        unmatchedPackageDetails[u].push(item);
      }
    }

    const coaches = coachUsers.map((c, idx) => ({
      phone: c.phone,
      openid: c.openid,
      name: c.name,
      displayName: c.displayName,
      stats: breakdownToClient(rowBreakdowns[idx]),
      packageRewardDetails: rowPackageDetails[idx],
    }));

    const extraCoaches = unmatchedMeta.map((m, j) => ({
      phone: m.phoneShow,
      openid: m.holdOpenid,
      name: '',
      displayName: m.coachLabel,
      stats: breakdownToClient(unmatchedBreakdowns[j]),
      packageRewardDetails: unmatchedPackageDetails[j] || [],
    }));

    return {
      ok: true,
      data: {
        year,
        month,
        coaches: extraCoaches.length > 0 ? coaches.concat(extraCoaches) : coaches,
        coachBookingTruncated: bookings.length >= 1000,
        coursePurchaseTruncated: (purchaseRes.data || []).length >= 1000,
      },
    };
  } catch (e) {
    console.error('adminCoachMonthStats', e);
    return { ok: false, errMsg: e.message || '统计失败' };
  }
};
