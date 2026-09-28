'use strict';

// A listing sourced from social media / third-party sites ("Found online").
// Shared by the public listing routes and the lead handoff so both agree.
function foundOnlinePropertySql(alias = 'p') {
  const a = alias ? `${alias}.` : '';
  return `(
    LOWER(COALESCE(${a}source, '')) = 'found_online_property_source_v1'
    OR LOWER(COALESCE(${a}listed_via, '')) = 'found_online'
    OR LOWER(COALESCE(${a}extra_fields->>'source_badge', '')) IN ('found_online', 'found online', 'sourced_online', 'sourced online')
    OR LOWER(COALESCE(${a}extra_fields->>'found_online', 'false')) IN ('true', '1', 'yes')
    OR LOWER(COALESCE(${a}extra_fields->>'found_online_candidate', 'false')) IN ('true', '1', 'yes')
    OR LOWER(COALESCE(${a}extra_fields->>'social_search_candidate', 'false')) IN ('true', '1', 'yes')
    OR LOWER(COALESCE(${a}extra_fields->>'sourced_inventory_candidate', 'false')) IN ('true', '1', 'yes')
  )`;
}

module.exports = { foundOnlinePropertySql };
