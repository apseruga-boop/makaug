'use strict';

// How many districts have a live listing right now (PR G6). Replaces the
// "all 146 districts" claim: on 8 Oct 2026 it was 58. Counted at most once an
// hour from the public-live predicate (utils/publicInventoryStatus.js) with a
// non-empty district; pages read the last value and never wait on the query.

const logger = require('../config/logger');
const { publicLivePropertyStatusSql } = require('../utils/publicInventoryStatus');

const REFRESH_MS = 60 * 60 * 1000;
const state = { count: null, at: 0, inFlight: null };

function liveDistrictsSql() {
  return `SELECT COUNT(DISTINCT LOWER(TRIM(p.district)))::int AS districts
            FROM properties p
           WHERE ${publicLivePropertyStatusSql('p')}
             AND NULLIF(TRIM(COALESCE(p.district, '')), '') IS NOT NULL`;
}

async function refreshLiveDistricts(db) {
  if (state.inFlight) return state.inFlight;
  state.inFlight = db.query(liveDistrictsSql())
    .then((result) => {
      const count = Number(result.rows?.[0]?.districts);
      if (Number.isFinite(count) && count > 0) state.count = count;
      state.at = Date.now();
      return state.count;
    })
    .catch((error) => {
      logger.warn('Live district count failed', { error: error.message });
      state.at = Date.now();
      return state.count;
    })
    .finally(() => { state.inFlight = null; });
  return state.inFlight;
}

/** The last known count (or null), refreshing in the background when stale. */
function liveDistrictCount(db) {
  if (db && Date.now() - state.at > REFRESH_MS && !state.inFlight) refreshLiveDistricts(db).catch(() => {});
  return state.count;
}

function footerCoverageSentence(count) {
  return Number(count) > 0
    ? `Web or WhatsApp, from any district — live listings in ${Number(count)} so far.`
    : 'Web or WhatsApp, anywhere in Uganda.';
}

function setLiveDistrictCountForTests(count) {
  state.count = count;
  state.at = Date.now();
}

module.exports = {
  liveDistrictsSql,
  refreshLiveDistricts,
  liveDistrictCount,
  footerCoverageSentence,
  setLiveDistrictCountForTests
};
