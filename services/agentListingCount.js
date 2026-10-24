const DEFAULT_AGENT_LISTING_PAGE_SIZE = 24;
const MAX_AGENT_LISTING_PAGE_SIZE = 48;

function sqlAlias(value = 'a') {
  const alias = String(value || 'a').trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) {
    throw new Error('Invalid SQL alias for agent listing count');
  }
  return alias;
}

// One count for the public directory and the public profile. Both count
// approved rows owned by agent_id. A broker_agent_id match is a different
// number and must not be mixed in, or the two pages can disagree.
function approvedAgentListingsCountSql(agentAlias = 'a') {
  const alias = sqlAlias(agentAlias);
  return `(SELECT COUNT(*)::int FROM properties p WHERE p.agent_id = ${alias}.id AND p.status = 'approved')`;
}

function parseAgentListingPage(query = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  let limit = parseInt(query.limit, 10);
  if (!Number.isFinite(limit) || limit <= 0) limit = DEFAULT_AGENT_LISTING_PAGE_SIZE;
  limit = Math.min(MAX_AGENT_LISTING_PAGE_SIZE, Math.floor(limit));
  return { page, limit, offset: (page - 1) * limit };
}

const APPROVED_AGENT_LISTING_SELECT = `
  p.id,
  p.title,
  p.description,
  p.listing_type,
  p.district,
  p.area,
  p.address,
  p.price,
  p.price_currency,
  p.price_original,
  p.price_fx_rate_ugx,
  p.price_fx_as_of,
  p.price_period,
  p.bedrooms,
  p.bathrooms,
  p.property_type,
  p.status,
  p.availability_status,
  p.last_confirmed_at,
  p.created_at,
  p.latitude,
  p.longitude,
  p.agent_id,
  p.extra_fields,
  img.url AS primary_image_url`;

async function countApprovedAgentListings(db, agentId) {
  const result = await db.query(
    `SELECT ${approvedAgentListingsCountSql('a')} AS listings_count
       FROM agents a
      WHERE a.id = $1`,
    [agentId]
  );
  return Number(result.rows[0]?.listings_count || 0);
}

async function listApprovedAgentListingPage(db, agentId, query = {}) {
  const paging = parseAgentListingPage(query);
  const total = await countApprovedAgentListings(db, agentId);
  const listings = await db.query(
    `SELECT ${APPROVED_AGENT_LISTING_SELECT}
       FROM properties p
       LEFT JOIN LATERAL (
         SELECT i.url
         FROM property_images i
         WHERE i.property_id = p.id
         ORDER BY i.is_primary DESC, i.sort_order ASC, i.created_at ASC
         LIMIT 1
       ) img ON true
      WHERE p.agent_id = $1 AND p.status = 'approved'
      ORDER BY COALESCE(p.approved_at, p.updated_at, p.created_at) DESC, p.id DESC
      LIMIT $2 OFFSET $3`,
    [agentId, paging.limit, paging.offset]
  );
  return {
    rows: listings.rows,
    page: {
      page: paging.page,
      limit: paging.limit,
      total,
      has_more: paging.offset + listings.rows.length < total
    }
  };
}

async function approvedListingPriceRange(db, agentId) {
  const result = await db.query(
    `SELECT MIN(p.price) AS listing_price_min, MAX(p.price) AS listing_price_max
       FROM properties p
      WHERE p.agent_id = $1
        AND p.status = 'approved'
        AND p.price > 0`,
    [agentId]
  );
  const min = Number(result.rows[0]?.listing_price_min);
  const max = Number(result.rows[0]?.listing_price_max);
  return {
    listing_price_min: Number.isFinite(min) && min > 0 ? min : null,
    listing_price_max: Number.isFinite(max) && max > 0 ? max : null
  };
}

module.exports = {
  DEFAULT_AGENT_LISTING_PAGE_SIZE,
  MAX_AGENT_LISTING_PAGE_SIZE,
  approvedAgentListingsCountSql,
  parseAgentListingPage,
  countApprovedAgentListings,
  listApprovedAgentListingPage,
  approvedListingPriceRange
};
