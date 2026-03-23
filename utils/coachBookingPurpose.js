const {
  scalesForLessonType,
  coerceModes,
} = require('./coachPurposeScales');

function applyPurposeScalesForLessonType(
  lessonType,
  pairModeIn,
  groupModeIn,
  coachCategoryIndex,
  courseScaleById
) {
  const idx = coachCategoryIndex || {};
  const scaleById = courseScaleById || {};
  const { pairScales, groupScales } = scalesForLessonType(lessonType, idx, scaleById);
  const { pairMode, groupMode } = coerceModes(
    lessonType,
    pairModeIn,
    groupModeIn,
    pairScales,
    groupScales
  );
  return {
    purposePairScales: pairScales,
    purposeGroupScales: groupScales,
    pairMode,
    groupMode,
  };
}

function resolveSelectedScaleDisplayName(
  lessonType,
  pairMode,
  groupMode,
  purposePairScales,
  purposeGroupScales
) {
  if (lessonType === 'group' || lessonType === 'open_play') {
    const row = (purposeGroupScales || []).find((s) => s.modeCode === groupMode);
    return row ? row.name : '';
  }
  const row = (purposePairScales || []).find((s) => s.modeCode === pairMode);
  return row ? row.name : '';
}

function resolveSelectedCapacityLimit(
  lessonType,
  pairMode,
  groupMode,
  purposePairScales,
  purposeGroupScales
) {
  if (lessonType === 'group' || lessonType === 'open_play') {
    const row = (purposeGroupScales || []).find((s) => s.modeCode === groupMode);
    const fb = lessonType === 'open_play' ? 6 : 5;
    const lim = row && row.limit != null ? Math.floor(Number(row.limit)) : fb;
    return Number.isFinite(lim) && lim >= 1 ? lim : fb;
  }
  const row = (purposePairScales || []).find((s) => s.modeCode === pairMode);
  const fb = pairMode === '1v2' ? 2 : 1;
  const lim = row && row.limit != null ? Math.floor(Number(row.limit)) : fb;
  return Number.isFinite(lim) && lim >= 1 ? lim : fb;
}

module.exports = {
  applyPurposeScalesForLessonType,
  resolveSelectedScaleDisplayName,
  resolveSelectedCapacityLimit,
};
