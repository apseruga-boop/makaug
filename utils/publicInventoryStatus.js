const PUBLIC_LIVE_PROPERTY_STATUSES = ['approved', 'live', 'published'];

function sqlLiteral(value = '') {
  return String(value).replace(/'/g, "''");
}

function publicLivePropertyStatusSql(alias = 'p') {
  const column = alias ? `${alias}.status` : 'status';
  const statuses = PUBLIC_LIVE_PROPERTY_STATUSES.map((status) => `'${sqlLiteral(status)}'`).join(', ');
  return `LOWER(COALESCE(${column}, '')) IN (${statuses})`;
}

function isPublicLivePropertyStatus(value = '') {
  return PUBLIC_LIVE_PROPERTY_STATUSES.includes(String(value || '').trim().toLowerCase());
}

module.exports = {
  PUBLIC_LIVE_PROPERTY_STATUSES,
  isPublicLivePropertyStatus,
  publicLivePropertyStatusSql
};
