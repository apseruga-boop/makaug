const { approvedAgentListingsCountSql } = require('./agentListingCount');
const { basicAgentProfileVisible } = require('./agentBasicProfile');
const {
  DIRECT_AGENT_PROFILE_MARKER,
  publicAgentProfileVisible
} = require('./publicAgentEligibilityService');

const SHORT_LINK_TTL_MS = 60 * 1000;
const BUSINESS_TAILS = new Set([
  'properties',
  'property',
  'auctioneers',
  'auctioneer',
  'estates',
  'estate',
  'realtors',
  'realtor',
  'realty',
  'homes',
  'housing',
  'developers',
  'developer',
  'consultants',
  'consultant',
  'limited',
  'ltd',
  'agency',
  'agencies',
  'bailiffs',
  'bailiff'
]);

let shortLinkCache = { at: 0, bySlug: new Map(), byId: new Map() };

function slugToken(value = '') {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// A person's first name (francis, segawa, sewa, george, sharif). A business
// second word keeps the business name (quick-auctioneers, kelham-properties,
// quickway-auctioneers) and one more business word when there is one.
function agentSlugBase(name = '') {
  const tokens = slugToken(name).split(/\s+/).filter(Boolean);
  if (!tokens.length) return 'agent';
  if (tokens[1] && BUSINESS_TAILS.has(tokens[1])) {
    const parts = [tokens[0], tokens[1]];
    if (tokens[2] && BUSINESS_TAILS.has(tokens[2])) parts.push(tokens[2]);
    return parts.join('-');
  }
  return tokens[0];
}

function agentDisplayName(row = {}) {
  return String(row.full_name || row.company_name || '').trim();
}

function agentCreatedValue(row = {}) {
  const ms = new Date(row.created_at || 0).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function assignAgentSlugs(rows = []) {
  const eligible = (Array.isArray(rows) ? rows : []).filter((row) => (
    row && row.id && (publicAgentProfileVisible(row) || basicAgentProfileVisible(row))
  ));
  eligible.sort((a, b) => (
    agentCreatedValue(a) - agentCreatedValue(b)
    || String(a.id).localeCompare(String(b.id))
  ));
  const used = new Map();
  const bySlug = new Map();
  const byId = new Map();
  for (const row of eligible) {
    const base = agentSlugBase(agentDisplayName(row));
    const seen = (used.get(base) || 0) + 1;
    used.set(base, seen);
    const slug = seen === 1 ? base : `${base}-${seen}`;
    bySlug.set(slug, row);
    byId.set(String(row.id), slug);
  }
  return { bySlug, byId };
}

function clearAgentShortLinkCache() {
  shortLinkCache = { at: 0, bySlug: new Map(), byId: new Map() };
}

async function loadAgentShortLinkIndex(db) {
  if (shortLinkCache.at && Date.now() - shortLinkCache.at < SHORT_LINK_TTL_MS) return shortLinkCache;
  const result = await db.query(
    `SELECT
        a.id,
        a.full_name,
        a.company_name,
        a.created_at,
        a.user_id,
        a.licence_number,
        a.verification_reason,
        a.status,
        a.bio,
        a.email,
        a.specializations,
        (NULLIF(BTRIM(COALESCE(a.identity_document_url, '')), '') IS NOT NULL) AS identity_document_stored,
        ${approvedAgentListingsCountSql('a')} AS approved_listing_count
      FROM agents a
      WHERE LOWER(COALESCE(a.status, 'pending')) NOT IN ('rejected', 'declined', 'suspended', 'deleted', 'removed', 'blocked')
        AND (
          a.user_id IS NOT NULL
          OR COALESCE(a.verification_reason, '') ILIKE '%${DIRECT_AGENT_PROFILE_MARKER}%'
          OR EXISTS (
            SELECT 1 FROM properties p
            WHERE p.agent_id = a.id AND p.status = 'approved'
          )
        )`
  );
  const index = assignAgentSlugs(result.rows);
  shortLinkCache = { at: Date.now(), ...index };
  return shortLinkCache;
}

async function shortPathForAgent(db, agentId) {
  const id = String(agentId || '').trim();
  if (!id) return '';
  const index = await loadAgentShortLinkIndex(db);
  const slug = index.byId.get(id);
  return slug ? `/a/${slug}` : '';
}

async function lookupAgentByShortSlug(db, slug) {
  const key = String(slug || '').trim().toLowerCase();
  if (!/^[a-z0-9-]+$/.test(key)) return null;
  const index = await loadAgentShortLinkIndex(db);
  const row = index.bySlug.get(key);
  if (!row?.id) return null;
  return { id: row.id, slug: key };
}

module.exports = {
  BUSINESS_TAILS,
  agentSlugBase,
  assignAgentSlugs,
  clearAgentShortLinkCache,
  loadAgentShortLinkIndex,
  shortPathForAgent,
  lookupAgentByShortSlug
};
