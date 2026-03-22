/** 云库 venueId 可能是字符串或数字，与 db_venue._id / db_course.venue 对齐比较 */
function venueIdLooseEqual(a, b) {
  const sa = a == null ? '' : String(a).trim();
  const sb = b == null ? '' : String(b).trim();
  if (sa === sb) return true;
  const na = Number(sa);
  const nb = Number(sb);
  return Number.isFinite(na) && Number.isFinite(nb) && na === nb;
}

function normalizeVenueId(v) {
  return v == null ? '' : String(v).trim();
}

module.exports = {
  venueIdLooseEqual,
  normalizeVenueId,
};
