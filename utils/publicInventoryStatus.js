const PUBLIC_LIVE_PROPERTY_STATUSES = ['approved', 'live', 'published'];

function sqlLiteral(value = '') {
  return String(value).replace(/'/g, "''");
}

// A listing marked sold stays on the site with its SOLD badge for this long,
// then comes off by itself. Same window the King's "live" count already used.
const SOLD_PUBLIC_WINDOW_DAYS = 7;

function publicLivePropertyStatusSql(alias = 'p') {
  const column = alias ? `${alias}.status` : 'status';
  const soldAt = alias ? `${alias}.sold_at` : 'sold_at';
  const statuses = PUBLIC_LIVE_PROPERTY_STATUSES.map((status) => `'${sqlLiteral(status)}'`).join(', ');
  return `(LOWER(COALESCE(${column}, '')) IN (${statuses}) OR (LOWER(COALESCE(${column}, '')) = 'sold' AND ${soldAt} >= NOW() - INTERVAL '${SOLD_PUBLIC_WINDOW_DAYS} days'))`;
}

function isPublicLivePropertyStatus(value = '') {
  return PUBLIC_LIVE_PROPERTY_STATUSES.includes(String(value || '').trim().toLowerCase());
}

module.exports = {
  PUBLIC_LIVE_PROPERTY_STATUSES,
  SOLD_PUBLIC_WINDOW_DAYS,
  isPublicLivePropertyStatus,
  publicLivePropertyStatusSql
};
