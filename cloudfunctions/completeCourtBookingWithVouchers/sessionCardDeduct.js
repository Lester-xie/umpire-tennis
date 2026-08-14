function roundYuan(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/**
 * 校验并规范化次卡抵扣（仅普通订场）
 * @param {object|null} opts.sessionCard { slotKeys, deductTimes?, deductYuan? }
 */
async function assertAndNormalizeSessionCard({
  db,
  phone,
  venueId,
  bookedSlots,
  vouchers,
  monthCardFreeSlotKey,
  sessionCard,
  slotPrices,
}) {
  const raw = sessionCard;
  if (!raw || typeof raw !== 'object') {
    return { ok: true, sessionCard: null };
  }
  const slotKeys = Array.isArray(raw.slotKeys)
    ? raw.slotKeys.map((k) => String(k || '').trim()).filter(Boolean)
    : [];
  let deductTimes = Math.floor(Number(raw.deductTimes));
  if (!Number.isFinite(deductTimes) || deductTimes < 0) deductTimes = 0;
  if (slotKeys.length === 0 || deductTimes <= 0) {
    return { ok: true, sessionCard: null };
  }
  if (slotKeys.length !== deductTimes) {
    return { ok: false, errMsg: '次卡抵扣次数与时段不一致' };
  }
  const keySet = new Set(slotKeys);
  if (keySet.size !== slotKeys.length) {
    return { ok: false, errMsg: '次卡时段重复' };
  }

  const used = new Set((vouchers || []).map((v) => String(v.slotKey || '')));
  const mcKey = monthCardFreeSlotKey != null ? String(monthCardFreeSlotKey).trim() : '';
  if (mcKey) used.add(mcKey);

  for (let i = 0; i < slotKeys.length; i += 1) {
    const key = slotKeys[i];
    if (used.has(key)) {
      return { ok: false, errMsg: '次卡时段与券/月卡冲突' };
    }
    const inOrder = (bookedSlots || []).some(
      (s) => `${Number(s.courtId)}-${Number(s.slotIndex)}` === key,
    );
    if (!inOrder) {
      return { ok: false, errMsg: '次卡时段不在本单内' };
    }
  }

  let deductYuan = 0;
  if (Array.isArray(slotPrices) && slotPrices.length > 0) {
    for (let i = 0; i < slotKeys.length; i += 1) {
      const key = slotKeys[i];
      const slot = slotPrices.find((s) => String(s.slotKey) === key);
      if (!slot) {
        return { ok: false, errMsg: '次卡时段价格不匹配' };
      }
      deductYuan = roundYuan(deductYuan + roundYuan(slot.priceYuan));
    }
    deductYuan = roundYuan(deductYuan);
  } else {
    deductYuan = roundYuan(raw.deductYuan);
    if (deductYuan <= 0) {
      return { ok: false, errMsg: '次卡抵扣金额无效' };
    }
  }

  const phoneNorm = String(phone || '').trim();
  const venueIdNorm = String(venueId || '').trim();
  if (!phoneNorm || !venueIdNorm) {
    return { ok: false, errMsg: '次卡校验缺少用户信息' };
  }

  const hit = await db
    .collection('db_member_venue_session_card')
    .where({ phone: phoneNorm, venueId: venueIdNorm })
    .limit(1)
    .get();
  const row = hit.data && hit.data[0];
  const remaining = Math.max(0, Math.floor(Number(row && row.remainingTimes) || 0));
  if (remaining < deductTimes) {
    return { ok: false, errMsg: '次卡剩余次数不足' };
  }

  return {
    ok: true,
    sessionCard: {
      slotKeys,
      deductTimes,
      deductYuan,
    },
  };
}

async function tryDeductSessionCardTimes({ db, _, phone, venueId, deductTimes, now }) {
  const times = Math.max(0, Math.floor(Number(deductTimes) || 0));
  if (times <= 0) return { ok: true };
  const phoneNorm = String(phone || '').trim();
  const venueIdNorm = String(venueId || '').trim();
  if (!phoneNorm || !venueIdNorm) {
    return { ok: false, errMsg: '次卡扣减缺少用户信息' };
  }
  const res = await db
    .collection('db_member_venue_session_card')
    .where({
      phone: phoneNorm,
      venueId: venueIdNorm,
      remainingTimes: _.gte(times),
    })
    .update({
      data: {
        remainingTimes: _.inc(-times),
        updatedAt: now,
      },
    });
  if (!res.stats || res.stats.updated < 1) {
    return { ok: false, errMsg: '次卡剩余次数不足' };
  }
  return { ok: true };
}

module.exports = {
  roundYuan,
  assertAndNormalizeSessionCard,
  tryDeductSessionCardTimes,
};
