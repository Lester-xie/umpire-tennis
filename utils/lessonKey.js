/**
 * 与云函数 completeCoachBookingWithHours / db_member_course_hours 一致
 * @param {string} lessonType experience | regular | group | open_play（畅打）
 * @param {string} pairMode 1v1 | 1v2（团课可忽略）
 * @param {string} groupMode 如 group35
 */
function buildLessonKey(lessonType, pairMode, groupMode) {
  const lt = String(lessonType || '').trim();
  if (lt === 'group') {
    const gm = String(groupMode || 'group35').trim() || 'group35';
    return `group:${gm}`;
  }
  if (lt === 'open_play') {
    const gm = String(groupMode || 'group36').trim() || 'group36';
    return `open_play:${gm}`;
  }
  const pm = String(pairMode || '1v1').trim() || '1v1';
  return `${lt}:${pm}`;
}

/** 将 lessonKey 转为列表展示文案（如 experience:1v1 → 体验课 1V1） */
function formatLessonKeyDisplay(key) {
  const k = String(key || '').trim();
  if (!k) return '课程';
  const idx = k.indexOf(':');
  if (idx < 0) return k;
  const type = k.slice(0, idx);
  const mode = k.slice(idx + 1);
  const typeMap = { experience: '体验课', regular: '正课', group: '团课', open_play: '畅打' };
  const t = typeMap[type] || type;
  if (type === 'group') {
    if (!mode) return '团课';
    if (mode === 'group35') return '团课（3-5人）';
    return `团课（${mode}）`;
  }
  if (type === 'open_play') {
    if (!mode) return '畅打';
    if (mode === 'group36') return '畅打（3-6人）';
    return `畅打（${mode}）`;
  }
  const modeUpper = String(mode || '').toUpperCase();
  return `${t} ${modeUpper}`.trim();
}

module.exports = {
  buildLessonKey,
  formatLessonKeyDisplay,
};
