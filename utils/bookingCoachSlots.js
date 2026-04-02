const { resolveCourtSlotPrice } = require('./bookingSlotPrice');

const ROW = 126;
const CELL = 120;
const GAP = 8;

function formatCoachSlotRange(startIndex, span) {
  const startH = 8 + startIndex;
  const endH = startH + span;
  const pad = (x) => (x < 10 ? `0${x}` : `${x}`);
  return `${pad(startH)}:00-${pad(endH)}:00`;
}

function applyCoachHoldMergeAndLayout(slots, courtId, {
  coachHoldMeta,
  myCoachHoldIdSet,
  purposeOnlyOpenPlay,
}) {
  const n = slots.length;
  const metaMap = coachHoldMeta || {};
  const mySet = myCoachHoldIdSet || new Set();

  for (let i = 0; i < n; i += 1) {
    slots[i].coachSpan = 1;
    slots[i].coachMergeSkip = false;
    slots[i].coachTimeRange = '';
    slots[i].coachHoldIdsStr = '';
    slots[i].canManageCoachHold = false;
    slots[i].coachSessionReleased = false;
    slots[i].prefillLessonType = 'experience';
    slots[i].prefillPairMode = '1v1';
    slots[i].prefillGroupMode = 'group35';
    slots[i].prefillCoachName = '';
  }

  let i = 0;
  while (i < n) {
    const cur = slots[i];
    if (!cur.booked || !cur.bookedByCoach) {
      i += 1;
      continue;
    }
    const label = (cur.coachPurpose || '').trim();
    let span = 1;
    let j = i + 1;
    while (j < n) {
      const next = slots[j];
      if (!next.booked || !next.bookedByCoach) break;
      if ((next.coachPurpose || '').trim() !== label) break;
      span += 1;
      j += 1;
    }
    cur.coachSpan = span;
    cur.coachTimeRange = formatCoachSlotRange(i, span);
    const m0 = metaMap[`${courtId}-${i}`] || {};
    const idSet = new Set();
    if (Array.isArray(m0.sessionHoldIds)) {
      m0.sessionHoldIds.forEach((x) => {
        const h = String(x || '').trim();
        if (h) idSet.add(h);
      });
    }
    for (let k = 0; k < span; k += 1) {
      const m = metaMap[`${courtId}-${i + k}`];
      if (m && Array.isArray(m.sessionHoldIds)) {
        m.sessionHoldIds.forEach((x) => {
          const h = String(x || '').trim();
          if (h) idSet.add(h);
        });
      }
      if (m && m.holdId) idSet.add(String(m.holdId));
    }
    const ids = [...idSet];
    cur.coachHoldIdsStr = ids.join(',');
    const isMgr = purposeOnlyOpenPlay;
    cur.canManageCoachHold = ids.length > 0 && (isMgr || ids.some((id) => mySet.has(id)));
    cur.coachSessionReleased = !!m0.fromReleasedSession;
    cur.prefillLessonType = m0.lessonType || 'experience';
    cur.prefillPairMode = m0.pairMode || '1v1';
    cur.prefillGroupMode = 'group35';
    cur.prefillCoachName =
      m0.coachName != null && String(m0.coachName).trim() !== ''
        ? String(m0.coachName).trim()
        : '';
    for (let k = i + 1; k < i + span; k += 1) {
      slots[k].coachMergeSkip = true;
    }
    i += span;
  }

  let cursor = 0;
  for (let idx = 0; idx < n; idx += 1) {
    if (slots[idx].coachMergeSkip) {
      slots[idx].slotStyle = '';
      continue;
    }
    const span = slots[idx].coachSpan || 1;
    const h = span * CELL + (span - 1) * GAP;
    slots[idx].slotStyle = `top:${cursor}rpx;height:${h}rpx;`;
    cursor += span * ROW;
  }
}

function buildCourtSlotsRow({
  timeSlots,
  selectedDate,
  courtId,
  todayStr,
  now,
  courtList,
  slotPriceMap,
  coachHoldMeta,
  bookedSlotKeySet,
  purposeOnlyOpenPlay,
  myCoachHoldIdSet,
  isVipUser,
}) {
  const slots = [];
  const metaMap = coachHoldMeta || {};
  const bookedSet = bookedSlotKeySet || new Set();

  for (let i = 0; i < timeSlots.length; i += 1) {
    const slotHour = timeSlots[i].hour;
    let isAvailableTime = false;

    if (selectedDate > todayStr) {
      isAvailableTime = true;
    } else if (selectedDate === todayStr) {
      const slotTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), slotHour, 0, 0);
      isAvailableTime = slotTime > now;
    }

    const slotPrice = resolveCourtSlotPrice(
      courtList,
      courtId,
      i,
      selectedDate,
      slotPriceMap,
      { isVipUser: !!isVipUser }
    );
    const key = `${courtId}-${i}`;
    const isBookedByOrder = bookedSet.has(key);
    const coachMeta = metaMap[key];
    const bookedByCoach = !!(isBookedByOrder && coachMeta);
    const coachPurpose = bookedByCoach ? coachMeta.capacityLabel || '教练占用' : '';
    const coachName =
      bookedByCoach && coachMeta.coachName ? String(coachMeta.coachName).trim() : '';

    const isAvailable = isAvailableTime && slotPrice != null && !isBookedByOrder;
    const past = !isAvailableTime;

    slots.push({
      available: isAvailable,
      price: isAvailable ? slotPrice : null,
      booked: isBookedByOrder,
      bookedByCoach,
      coachPurpose,
      past,
      coachSpan: 1,
      coachMergeSkip: false,
      slotStyle: '',
      coachTimeRange: '',
      coachHoldIdsStr: '',
      canManageCoachHold: false,
      coachSessionReleased: false,
      prefillLessonType: 'experience',
      prefillPairMode: '1v1',
      prefillGroupMode: 'group35',
      prefillCoachName: coachName,
    });
  }

  applyCoachHoldMergeAndLayout(slots, courtId, {
    coachHoldMeta,
    myCoachHoldIdSet,
    purposeOnlyOpenPlay,
  });
  return slots;
}

function buildCoachCourts(params) {
  const {
    timeSlots,
    selectedDate,
    todayStr,
    now,
    courtList,
    slotPriceMap,
    coachHoldMeta,
    bookedSlotKeySet,
    purposeOnlyOpenPlay,
    myCoachHoldIdSet,
    isVipUser,
  } = params;
  const list = Array.isArray(courtList) ? courtList : [];

  if (list.length > 0) {
    return list.map((c, idx) => ({
      id: idx + 1,
      name: c.name || `${idx + 1}号场`,
      slots: buildCourtSlotsRow({
        timeSlots,
        selectedDate,
        courtId: idx + 1,
        todayStr,
        now,
        courtList: list,
        slotPriceMap,
        coachHoldMeta,
        bookedSlotKeySet,
        purposeOnlyOpenPlay,
        myCoachHoldIdSet,
        isVipUser,
      }),
    }));
  }

  return [1, 2].map((id) => ({
    id,
    name: `${id}号场`,
    slots: buildCourtSlotsRow({
      timeSlots,
      selectedDate,
      courtId: id,
      todayStr,
      now,
      courtList: list,
      slotPriceMap,
      coachHoldMeta,
      bookedSlotKeySet,
      purposeOnlyOpenPlay,
      myCoachHoldIdSet,
      isVipUser,
    }),
  }));
}

module.exports = {
  buildCoachCourts,
};
