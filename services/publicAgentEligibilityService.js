const PUBLIC_AGENT_SUPPRESSED_MARKERS = [
  'QA TEST - DELETE',
  'SOFT LAUNCH TEST - DELETE',
  'TRAINING',
  'DEMO',
  'SAMPLE',
  'PLACEHOLDER'
];
const PUBLIC_AGENT_MIN_LIVE_LISTINGS = 2;
const PUBLIC_DIRECT_AGENT_MIN_LIVE_LISTINGS = 1;
const DIRECT_AGENT_PROFILE_MARKER = '[DIRECT_AGENT_AUTHORISED]';
const REVIEWED_PRIVATE_ID_PROFILE_MARKER = '[STAFF_REVIEWED_PRIVATE_ID_PROFILE]';

function sqlAlias(value = 'a') {
  const alias = String(value || 'a').trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) {
    throw new Error('Invalid SQL alias for public agent eligibility');
  }
  return alias;
}

function addPublicAgentLaunchTestFilter(filters, values, alias = 'a') {
  const a = sqlAlias(alias);
  PUBLIC_AGENT_SUPPRESSED_MARKERS.forEach((marker) => {
    values.push(`%${marker}%`);
    const idx = values.length;
    filters.push(`(
      COALESCE(${a}.full_name, '') NOT ILIKE $${idx}
      AND COALESCE(${a}.company_name, '') NOT ILIKE $${idx}
      AND COALESCE(${a}.bio, '') NOT ILIKE $${idx}
      AND COALESCE(${a}.verification_reason, '') NOT ILIKE $${idx}
    )`);
  });
  filters.push(`COALESCE(${a}.email, '') !~* '(qa-test|makaug\\.invalid|dummy|sample)'`);
  filters.push(`COALESCE(${a}.licence_number, '') !~* '^(QA|TEST|DUMMY|SAMPLE)-'`);
  filters.push(`COALESCE(${a}.specializations::text, '') !~* '(qa test delete|soft launch test|dummy|sample|training|demo|placeholder)'`);
}

function addPublicAgentInventoryFilter(filters, alias = 'a') {
  const a = sqlAlias(alias);
  filters.push(`(
    (
      COALESCE(${a}.verification_reason, '') ILIKE '%${DIRECT_AGENT_PROFILE_MARKER}%'
      AND (
        (
          COALESCE(${a}.verification_reason, '') ILIKE '%${REVIEWED_PRIVATE_ID_PROFILE_MARKER}%'
          AND NULLIF(BTRIM(COALESCE(${a}.identity_document_url, '')), '') IS NOT NULL
        )
        OR (
          SELECT COUNT(*)::int
          FROM properties p
          WHERE p.agent_id = ${a}.id
            AND p.status = 'approved'
        ) >= ${PUBLIC_DIRECT_AGENT_MIN_LIVE_LISTINGS}
      )
    )
    OR (
      COALESCE(${a}.verification_reason, '') NOT ILIKE '%${DIRECT_AGENT_PROFILE_MARKER}%'
      AND (
        SELECT COUNT(*)::int
        FROM properties p
        WHERE p.agent_id = ${a}.id
          AND p.status = 'approved'
      ) >= ${PUBLIC_AGENT_MIN_LIVE_LISTINGS}
    )
  )`);
}

function addPublicAgentSelfRegistrationFilter(filters, alias = 'a') {
  const a = sqlAlias(alias);
  filters.push(`(
    ${a}.user_id IS NOT NULL
    OR COALESCE(${a}.verification_reason, '') ILIKE '%${DIRECT_AGENT_PROFILE_MARKER}%'
  )`);
  filters.push(`COALESCE(${a}.verification_reason, '') NOT ILIKE '%public social source onboarding%'`);
  filters.push(`COALESCE(${a}.verification_reason, '') NOT ILIKE '%source profile%'`);
  filters.push(`COALESCE(${a}.licence_number, '') !~* '^(SOCIAL|FOUND-ONLINE|TIKTOK|FACEBOOK|X)-'`);
}

function addPublicAgentEligibilityFilters(filters, values, alias = 'a') {
  addPublicAgentLaunchTestFilter(filters, values, alias);
  addPublicAgentSelfRegistrationFilter(filters, alias);
  addPublicAgentInventoryFilter(filters, alias);
}

const BLOCKED_PUBLIC_AGENT_STATUSES = new Set([
  'rejected',
  'declined',
  'suspended',
  'deleted',
  'removed',
  'blocked'
]);

function markerPresent(value, marker) {
  return String(value || '').toLowerCase().includes(String(marker || '').toLowerCase());
}

function isSuppressedPublicAgent(row = {}) {
  const name = String(row.full_name || '');
  const company = String(row.company_name || '');
  const bio = String(row.bio || '');
  const reason = String(row.verification_reason || '');
  const email = String(row.email || '');
  const licence = String(row.licence_number || row.licence || '').trim();
  const specs = Array.isArray(row.specializations)
    ? row.specializations.join(' ')
    : String(row.specializations || '');
  for (const marker of PUBLIC_AGENT_SUPPRESSED_MARKERS) {
    if ([name, company, bio, reason].some((field) => markerPresent(field, marker))) return true;
  }
  if (/(qa-test|makaug\.invalid|dummy|sample)/i.test(email)) return true;
  if (/^(QA|TEST|DUMMY|SAMPLE)-/i.test(licence)) return true;
  if (/(qa test delete|soft launch test|dummy|sample|training|demo|placeholder)/i.test(specs)) return true;
  return false;
}

function isSelfRegisteredPublicAgent(row = {}) {
  const userId = row.user_id == null ? '' : String(row.user_id).trim();
  return Boolean(userId) || markerPresent(row.verification_reason, DIRECT_AGENT_PROFILE_MARKER);
}

function hasPublicAgentInventory(row = {}, approvedListingCount = 0) {
  const listings = Number(approvedListingCount);
  const count = Number.isFinite(listings) ? listings : 0;
  const direct = markerPresent(row.verification_reason, DIRECT_AGENT_PROFILE_MARKER);
  const reviewed = markerPresent(row.verification_reason, REVIEWED_PRIVATE_ID_PROFILE_MARKER);
  const idStored = row.identity_document_stored === true
    || String(row.identity_document_url || '').trim() !== '';
  if (direct) {
    if (reviewed && idStored) return true;
    return count >= PUBLIC_DIRECT_AGENT_MIN_LIVE_LISTINGS;
  }
  return count >= PUBLIC_AGENT_MIN_LIVE_LISTINGS;
}

// The HTML profile follows the public directory, including a staff-reviewed
// direct agent who is approved before any listing is live. An agent who
// already has an approved listing keeps the page they had before that rule.
function publicAgentProfileVisible(row = {}) {
  if (!row || typeof row !== 'object') return false;
  const status = String(row.status || 'pending').trim().toLowerCase();
  if (BLOCKED_PUBLIC_AGENT_STATUSES.has(status)) return false;
  const listings = Number(row.approved_listing_count ?? row.listings_count ?? 0);
  const count = Number.isFinite(listings) ? listings : 0;
  if (count >= 1) return true;
  if (status !== 'approved') return false;
  if (isSuppressedPublicAgent(row) || isRemoteImportedAgent(row)) return false;
  if (!isSelfRegisteredPublicAgent(row)) return false;
  return hasPublicAgentInventory(row, count);
}

function isRemoteImportedAgent(row = {}) {
  const reason = String(row?.verification_reason || '');
  const licence = String(row?.licence_number || row?.licence || '').trim();
  return /public social source onboarding/i.test(reason)
    || /source profile/i.test(reason)
    || /^(SOCIAL|FOUND-ONLINE|TIKTOK|FACEBOOK|X)-/i.test(licence);
}

/**
 * The public verified tick. Direct onboarding alone is not enough: that path
 * writes [DIRECT_AGENT_AUTHORISED] while identity verification is still pending.
 * The tick is the "Approve public profile" action, which is the only writer of
 * [STAFF_REVIEWED_PRIVATE_ID_PROFILE] and contact_phone_verified_at. It refuses
 * to run unless a private ID document is stored, a valid phone or WhatsApp is
 * stored, and staff confirm the ID review, contact permission, and profile facts.
 * registration_status is not used: it defaults to registered, and found-online
 * imports set it too.
 */
function isVerifiedByMakaug(row = {}) {
  if (!row || typeof row !== 'object') return false;
  if (String(row.status || '').toLowerCase() !== 'approved') return false;
  if (row.removed_at) return false;
  if (isRemoteImportedAgent(row)) return false;
  const reason = String(row.verification_reason || '');
  if (!reason.includes(REVIEWED_PRIVATE_ID_PROFILE_MARKER)) return false;
  const knowsEvidence = Object.prototype.hasOwnProperty.call(row, 'identity_document_url')
    || Object.prototype.hasOwnProperty.call(row, 'contact_phone_verified_at');
  if (!knowsEvidence) return row.verified_by_makaug === true;
  const idStored = row.identity_document_stored === true
    || String(row.identity_document_url || '').trim() !== '';
  const phoneChecked = row.contact_phone_verified_at != null && String(row.contact_phone_verified_at).trim() !== '';
  return idStored && phoneChecked;
}

function verifiedByMakaugSql(alias = 'a') {
  const a = sqlAlias(alias);
  return `(
    LOWER(COALESCE(${a}.status, '')) = 'approved'
    AND ${a}.removed_at IS NULL
    AND POSITION('${REVIEWED_PRIVATE_ID_PROFILE_MARKER}' IN COALESCE(${a}.verification_reason, '')) > 0
    AND ${a}.contact_phone_verified_at IS NOT NULL
    AND NULLIF(BTRIM(COALESCE(${a}.identity_document_url, '')), '') IS NOT NULL
    AND COALESCE(${a}.verification_reason, '') NOT ILIKE '%public social source onboarding%'
    AND COALESCE(${a}.verification_reason, '') NOT ILIKE '%source profile%'
    AND COALESCE(${a}.licence_number, '') !~* '^(SOCIAL|FOUND-ONLINE|TIKTOK|FACEBOOK|X)-'
  )`;
}

module.exports = {
  DIRECT_AGENT_PROFILE_MARKER,
  PUBLIC_DIRECT_AGENT_MIN_LIVE_LISTINGS,
  REVIEWED_PRIVATE_ID_PROFILE_MARKER,
  PUBLIC_AGENT_MIN_LIVE_LISTINGS,
  PUBLIC_AGENT_SUPPRESSED_MARKERS,
  addPublicAgentEligibilityFilters,
  addPublicAgentInventoryFilter,
  addPublicAgentLaunchTestFilter,
  addPublicAgentSelfRegistrationFilter,
  hasPublicAgentInventory,
  isRemoteImportedAgent,
  isSelfRegisteredPublicAgent,
  isSuppressedPublicAgent,
  isVerifiedByMakaug,
  publicAgentProfileVisible,
  verifiedByMakaugSql
};
