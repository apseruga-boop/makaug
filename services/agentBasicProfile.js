const {
  isRemoteImportedAgent,
  isSuppressedPublicAgent,
  publicAgentProfileVisible
} = require('./publicAgentEligibilityService');

const BLOCKED_BASIC_PROFILE_STATUSES = new Set([
  'rejected',
  'declined',
  'suspended',
  'deleted',
  'removed',
  'blocked'
]);

// A lister who already has live listings but no public account and no
// direct-agent marker. The full profile stays hidden and has no verified tick.
// Approved listers can appear in the web directory. The page uses the listings they already
// show, and it says so.
function basicAgentProfileVisible(row = {}) {
  if (!row || typeof row !== 'object') return false;
  if (publicAgentProfileVisible(row)) return false;
  const status = String(row.status || 'pending').trim().toLowerCase();
  if (BLOCKED_BASIC_PROFILE_STATUSES.has(status)) return false;
  if (isSuppressedPublicAgent(row) || isRemoteImportedAgent(row)) return false;
  const listings = Number(row.approved_listing_count ?? row.listings_count ?? 0);
  return Number.isFinite(listings) && listings >= 1;
}

module.exports = {
  basicAgentProfileVisible
};
