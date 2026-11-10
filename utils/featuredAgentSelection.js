'use strict';

const crypto = require('crypto');
const { foundOnlinePropertySql } = require('./foundOnlineSql');

const FEATURED_AGENT_TIME_ZONE = 'Africa/Kampala';

function featuredAgentDateKey(now = new Date(), timeZone = FEATURED_AGENT_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now instanceof Date ? now : new Date(now));
  const value = (type) => parts.find((part) => part.type === type)?.value || '';
  const key = `${value('year')}-${value('month')}-${value('day')}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : '1970-01-01';
}

// Live listing from an agent who signed up and whose account is approved
// (or verified, where that status exists). Found-online imports are excluded
// even when they carry an agent id.
function approvedSignedUpAgentListingSql(alias = 'p') {
  const a = alias ? `${alias}.` : '';
  return `(
    NOT ${foundOnlinePropertySql(alias)}
    AND ${a}agent_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM agents featured_agent
      WHERE featured_agent.id = ${a}agent_id
        AND lower(featured_agent.status) IN ('approved', 'verified')
        AND featured_agent.user_id IS NOT NULL
        AND featured_agent.removed_at IS NULL
    )
  )`;
}

function featuredAgentDailyRank(id, dateKey) {
  return crypto.createHash('md5').update(`${dateKey}${id}`).digest('hex');
}

// Same order as featuredAgentDailyRank: md5(date || id). Stable for the Kampala day.
function featuredAgentDailyOrderSql(alias = 'p', dateKey = '') {
  const a = alias ? `${alias}.` : '';
  const seed = String(dateKey).startsWith('$')
    ? String(dateKey)
    : `'${(/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey)) ? String(dateKey) : featuredAgentDateKey()).replace(/'/g, '')}'`;
  return `md5(${seed} || ${a}id::text) ASC`;
}

function sortFeaturedAgentListings(rows = [], dateKey = '') {
  const key = /^\d{4}-\d{2}-\d{2}$/.test(String(dateKey)) ? String(dateKey) : featuredAgentDateKey();
  return [...rows].sort((left, right) => featuredAgentDailyRank(left.id, key).localeCompare(featuredAgentDailyRank(right.id, key))
    || String(left.id).localeCompare(String(right.id)));
}

module.exports = {
  FEATURED_AGENT_TIME_ZONE,
  approvedSignedUpAgentListingSql,
  featuredAgentDailyOrderSql,
  featuredAgentDailyRank,
  featuredAgentDateKey,
  sortFeaturedAgentListings
};
