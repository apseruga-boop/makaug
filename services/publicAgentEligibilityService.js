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
        SELECT COUNT(*)::int
        FROM properties p
        WHERE p.agent_id = ${a}.id
          AND p.status = 'approved'
      ) >= ${PUBLIC_DIRECT_AGENT_MIN_LIVE_LISTINGS}
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

module.exports = {
  DIRECT_AGENT_PROFILE_MARKER,
  PUBLIC_AGENT_MIN_LIVE_LISTINGS,
  PUBLIC_AGENT_SUPPRESSED_MARKERS,
  addPublicAgentEligibilityFilters,
  addPublicAgentInventoryFilter,
  addPublicAgentLaunchTestFilter,
  addPublicAgentSelfRegistrationFilter
};
