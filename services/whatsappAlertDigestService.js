'use strict';

// New-property WhatsApp alerts, website side only (26 Oct 2026, area C).
//
// A daily job matches listings that went live recently against saved searches
// whose owner agreed to WhatsApp alerts, and writes at most ONE digest row per
// person per Kampala day into pending_whatsapp_alerts. It also writes the
// one-off "welcome" and "consent confirmation" rows.
//
// Nothing here sends a message. Rows are written with status 'preview' while
// WHATSAPP_ALERTS_ENABLED is not 'true', and 'pending' when it is. Only a
// sender built later (see makaug-health/2026-10-26-claude-whatsapp-items.md)
// may claim 'pending' rows. This file never touches outbound_message_queue.

const db = require('../config/database');
const logger = require('../config/logger');
const { normalizeUgPhone } = require('../utils/adminOtpOverride');
const { publicVisibleInventoryWhere } = require('./publicInventoryMetricsService');
const { savedSearchMatchesListing } = require('./alertSchedulerService');

const KAMPALA_OFFSET_MS = 3 * 60 * 60 * 1000;
const DEFAULT_WINDOW_HOURS = 48;
const MAX_LISTINGS_PER_DIGEST = 10;
const LISTINGS_SHOWN_IN_MESSAGE = 5;
const DIGEST_HOURS_KAMPALA = { from: 9, to: 18 };

function alertsEnabled() {
  return String(process.env.WHATSAPP_ALERTS_ENABLED || '').trim().toLowerCase() === 'true';
}

function rowStatus() {
  return alertsEnabled() ? 'pending' : 'preview';
}

function siteUrl() {
  return String(process.env.PUBLIC_SITE_URL || 'https://makaug.com').replace(/\/+$/, '');
}

function kampalaDate(now = new Date()) {
  return new Date(now.getTime() + KAMPALA_OFFSET_MS).toISOString().slice(0, 10);
}

function kampalaHour(now = new Date()) {
  return new Date(now.getTime() + KAMPALA_OFFSET_MS).getUTCHours();
}

function phoneKey(phone) {
  const normalized = normalizeUgPhone(phone);
  return normalized ? `phone:${normalized}` : '';
}

function formatPrice(listing = {}) {
  const amount = Number(listing.price);
  if (!Number.isFinite(amount) || amount <= 0) return 'Price on request';
  const currency = String(listing.price_currency || 'UGX').toUpperCase();
  const period = String(listing.price_period || '').toLowerCase();
  const suffix = ['mo', 'month', 'monthly', 'per_month'].includes(period) ? '/month' : '';
  return `${currency} ${Math.round(amount).toLocaleString('en-US')}${suffix}`;
}

function buildDigestMessage(listings = [], { url = siteUrl() } = {}) {
  const count = listings.length;
  const lines = [
    `MakaUG: ${count} new ${count === 1 ? 'property matches' : 'properties match'} your saved search.`,
    ''
  ];
  listings.slice(0, LISTINGS_SHOWN_IN_MESSAGE).forEach((listing, index) => {
    const place = [listing.area, listing.district].filter(Boolean).join(', ');
    lines.push(`${index + 1}. ${listing.title || 'Property'}${place ? ` - ${place}` : ''} - ${formatPrice(listing)}`);
    lines.push(`${url}/property/${listing.id}`);
  });
  if (count > LISTINGS_SHOWN_IN_MESSAGE) lines.push(`...and ${count - LISTINGS_SHOWN_IN_MESSAGE} more.`);
  lines.push('', `Your saved searches: ${url}/saved`, 'Reply STOP to stop these messages.');
  return lines.join('\n');
}

function buildWelcomeMessage({ firstName = '' } = {}) {
  const name = String(firstName || '').trim();
  return [
    `Welcome to MakaUG${name ? `, ${name}` : ''}!`,
    'You asked us to send new property alerts and offers on WhatsApp.',
    'Reply STOP anytime to stop.'
  ].join(' ');
}

function buildConsentConfirmationMessage({ label = '' } = {}) {
  const what = String(label || '').trim() || 'your saved search';
  return [
    `MakaUG: you asked for WhatsApp alerts for "${what}".`,
    'We send at most one message a day, only when new matching properties go live.',
    'Reply STOP anytime to stop.'
  ].join(' ');
}

// A search may alert on WhatsApp when its owner agreed to it: either an
// "alert me" consent for that search, or the account's marketing consent.
// A STOP recorded for the phone after the consent switches it off.
function searchRecipient(search = {}, withdrawals = new Map()) {
  const phone = normalizeUgPhone(search.phone || search.user_phone || '');
  if (!phone) return null;
  const searchConsent = search.alert_scope === 'search_alerts_whatsapp' && search.consent_granted === true;
  // The users who agreed in person before 26 Oct 2026 (migration 186,
  // source 'in_person') are never put in a digest on that consent alone:
  // Arthur, 26 Oct 2026, "we're not sending anything to them".
  const accountConsent = Boolean(search.user_id)
    && search.user_marketing_opt_in === true
    && search.user_marketing_consent_source !== 'in_person';
  if (!searchConsent && !accountConsent) return null;
  const withdrawnAt = withdrawals.get(phone);
  if (withdrawnAt && !accountConsent) {
    const consentAt = search.consent_at ? new Date(search.consent_at).getTime() : 0;
    if (new Date(withdrawnAt).getTime() >= consentAt) return null;
  }
  return {
    key: `phone:${phone}`,
    phone,
    userId: search.user_id || null,
    deviceId: search.user_id ? null : (search.guest_session_id || null)
  };
}

// alertSchedulerService.money('') is 0, not null, so a search with no max
// price would reject every listing there. The price check is done here and the
// rest (category, beds, type, place, campus) is left to the shared matcher.
function priceBound(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const parsed = Number(String(value).replace(/[^\d.]/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function digestSearchMatchesListing(search = {}, listing = {}) {
  const price = priceBound(listing.price);
  const min = priceBound(search.min_price);
  const max = priceBound(search.max_price);
  if (price != null && min != null && price < min) return false;
  if (price != null && max != null && price > max) return false;
  const { price: _p, price_ugx: _pu, pricePerMonth: _ppm, price_per_month: _ppm2, ...withoutPrice } = listing;
  const { min_price: _min, max_price: _max, minPrice: _mn, maxPrice: _mx, ...searchWithoutPrice } = search;
  return savedSearchMatchesListing({ ...searchWithoutPrice, filters: { ...(search.filters || {}), minPrice: undefined, maxPrice: undefined, min_price: undefined, max_price: undefined } }, withoutPrice);
}

// Pure grouping: one entry per person, newest listings first, without the
// listings that person was already told about.
function groupDigests({ listings = [], searches = [], alreadyAlerted = new Set(), alreadyHadDigestToday = new Set(), withdrawals = new Map() } = {}) {
  const byRecipient = new Map();
  for (const search of searches) {
    const recipient = searchRecipient(search, withdrawals);
    if (!recipient || alreadyHadDigestToday.has(recipient.key)) continue;
    for (const listing of listings) {
      if (alreadyAlerted.has(`${recipient.key}|${listing.id}`)) continue;
      if (!digestSearchMatchesListing(search, listing)) continue;
      const entry = byRecipient.get(recipient.key) || { ...recipient, listings: new Map(), searchIds: new Set() };
      if (!entry.userId && recipient.userId) entry.userId = recipient.userId;
      if (!entry.deviceId && recipient.deviceId) entry.deviceId = recipient.deviceId;
      entry.listings.set(listing.id, listing);
      entry.searchIds.add(search.id);
      byRecipient.set(recipient.key, entry);
    }
  }
  return [...byRecipient.values()].map((entry) => {
    const ordered = [...entry.listings.values()]
      .sort((a, b) => new Date(b.live_at || 0) - new Date(a.live_at || 0))
      .slice(0, MAX_LISTINGS_PER_DIGEST);
    return {
      key: entry.key,
      phone: entry.phone,
      userId: entry.userId,
      deviceId: entry.deviceId,
      listings: ordered,
      searchIds: [...entry.searchIds]
    };
  });
}

async function loadRecentListings(runner, since) {
  const result = await runner.query(
    `SELECT p.id, p.title, p.listing_type, p.property_type, p.price, p.price_currency, p.price_period,
            p.bedrooms, p.district, p.area, p.address, p.inquiry_reference, p.students_welcome,
            COALESCE(p.approved_at, p.created_at) AS live_at
     FROM properties p
     WHERE ${publicVisibleInventoryWhere('p')}
       AND COALESCE(p.approved_at, p.created_at) >= $1
     ORDER BY COALESCE(p.approved_at, p.created_at) DESC
     LIMIT 500`,
    [since.toISOString()]
  );
  return result.rows;
}

async function loadAlertSearches(runner) {
  const result = await runner.query(
    `SELECT ss.*, u.phone AS user_phone, u.marketing_opt_in AS user_marketing_opt_in,
            u.marketing_consent_source AS user_marketing_consent_source,
            ce.granted AS consent_granted, ce.consented_at AS consent_at
     FROM saved_searches ss
     LEFT JOIN users u ON u.id = ss.user_id
     LEFT JOIN marketing_consent_events ce ON ce.id = ss.consent_record_id
     WHERE ss.status = 'active'
       AND COALESCE(ss.alert_frequency, 'daily') <> 'off'
       AND (
         (ss.alert_scope = 'search_alerts_whatsapp' AND ce.granted IS TRUE)
         OR (ss.user_id IS NOT NULL AND u.marketing_opt_in IS TRUE AND COALESCE(u.status, 'active') = 'active'
             AND COALESCE(u.marketing_consent_source, '') <> 'in_person')
       )
     ORDER BY ss.created_at ASC
     LIMIT 5000`
  );
  return result.rows;
}

async function loadWithdrawals(runner) {
  const result = await runner.query(
    `SELECT phone, MAX(consented_at) AS withdrawn_at
     FROM marketing_consent_events
     WHERE granted = FALSE AND phone IS NOT NULL
     GROUP BY phone`
  );
  const map = new Map();
  for (const row of result.rows) {
    const phone = normalizeUgPhone(row.phone);
    if (phone) map.set(phone, row.withdrawn_at);
  }
  return map;
}

async function runWhatsappAlertDigest(runner = db, { now = new Date(), windowHours = DEFAULT_WINDOW_HOURS } = {}) {
  const digestDate = kampalaDate(now);
  const status = rowStatus();
  const since = new Date(now.getTime() - windowHours * 60 * 60 * 1000);
  const listings = await loadRecentListings(runner, since);
  const summary = { digest_date: digestDate, status, listings_checked: listings.length, searches_checked: 0, digests_written: 0, listings_in_digests: 0 };
  if (!listings.length) return summary;

  const searches = await loadAlertSearches(runner);
  summary.searches_checked = searches.length;
  if (!searches.length) return summary;

  const [alerted, today, withdrawals] = await Promise.all([
    runner.query(
      `SELECT recipient_key, listing_id FROM pending_whatsapp_alert_listings WHERE listing_id = ANY($1::uuid[])`,
      [listings.map((row) => row.id)]
    ),
    runner.query(
      `SELECT recipient_key FROM pending_whatsapp_alerts WHERE kind = 'digest' AND digest_date = $1`,
      [digestDate]
    ),
    loadWithdrawals(runner)
  ]);
  const digests = groupDigests({
    listings,
    searches,
    alreadyAlerted: new Set(alerted.rows.map((row) => `${row.recipient_key}|${row.listing_id}`)),
    alreadyHadDigestToday: new Set(today.rows.map((row) => row.recipient_key)),
    withdrawals
  });

  for (const digest of digests) {
    if (!digest.listings.length) continue;
    const listingIds = digest.listings.map((row) => row.id);
    const inserted = await runner.query(
      `INSERT INTO pending_whatsapp_alerts (
         kind, recipient_key, user_id, device_id, phone, digest_date,
         listing_ids, saved_search_ids, message_preview, status, status_reason
       )
       VALUES ('digest', $1, $2, $3, $4, $5, $6::uuid[], $7::uuid[], $8, $9, $10)
       ON CONFLICT (recipient_key, kind, digest_date) DO NOTHING
       RETURNING id`,
      [
        digest.key,
        digest.userId,
        digest.deviceId,
        digest.phone,
        digestDate,
        listingIds,
        digest.searchIds,
        buildDigestMessage(digest.listings),
        status,
        status === 'preview' ? 'WHATSAPP_ALERTS_ENABLED is off' : null
      ]
    );
    const alertId = inserted.rows[0]?.id;
    if (!alertId) continue;
    await runner.query(
      `INSERT INTO pending_whatsapp_alert_listings (recipient_key, listing_id, alert_id)
       SELECT $1, listing_id, $3 FROM unnest($2::uuid[]) AS listing_id
       ON CONFLICT (recipient_key, listing_id) DO NOTHING`,
      [digest.key, listingIds, alertId]
    );
    summary.digests_written += 1;
    summary.listings_in_digests += listingIds.length;
  }
  return summary;
}

// One welcome / consent-confirmation row per person per day at most.
async function enqueueConsentMessage(runner = db, input = {}) {
  const kind = input.kind === 'welcome' ? 'welcome' : 'consent_confirmation';
  const key = phoneKey(input.phone);
  if (!key) return null;
  const message = kind === 'welcome'
    ? buildWelcomeMessage({ firstName: input.firstName })
    : buildConsentConfirmationMessage({ label: input.label });
  const status = rowStatus();
  const result = await runner.query(
    `INSERT INTO pending_whatsapp_alerts (
       kind, recipient_key, user_id, device_id, phone, digest_date,
       saved_search_ids, consent_event_id, message_preview, status, status_reason
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7::uuid[], $8, $9, $10, $11)
     ON CONFLICT (recipient_key, kind, digest_date) DO NOTHING
     RETURNING id, kind, status`,
    [
      kind,
      key,
      input.userId || null,
      input.deviceId || null,
      normalizeUgPhone(input.phone),
      kampalaDate(input.now || new Date()),
      input.savedSearchId ? [input.savedSearchId] : [],
      input.consentEventId || null,
      message,
      status,
      status === 'preview' ? 'WHATSAPP_ALERTS_ENABLED is off' : null
    ]
  );
  return result.rows[0] || null;
}

async function getPendingAlertSummary(runner = db) {
  const [counts, recent] = await Promise.all([
    runner.query(
      `SELECT kind, status, COUNT(*)::int AS count
       FROM pending_whatsapp_alerts
       GROUP BY kind, status
       ORDER BY kind, status`
    ),
    runner.query(
      `SELECT id, kind, status, phone, digest_date, cardinality(listing_ids) AS listing_count,
              message_preview, created_at
       FROM pending_whatsapp_alerts
       ORDER BY created_at DESC
       LIMIT 20`
    )
  ]);
  return { enabled: alertsEnabled(), counts: counts.rows, recent: recent.rows };
}

// Hourly check; writes a digest between 09:00 and 18:00 Kampala time. The
// unique (recipient, kind, day) key keeps it to one digest a day even with
// more than one instance running.
function startWhatsappAlertDigestSchedule({ runner = db, intervalMs = 60 * 60 * 1000 } = {}) {
  if (process.env.NODE_ENV === 'test' || !process.env.DATABASE_URL) return null;
  if (String(process.env.WHATSAPP_ALERT_DIGEST_JOB || '').toLowerCase() === 'off') return null;
  const tick = async () => {
    const hour = kampalaHour();
    if (hour < DIGEST_HOURS_KAMPALA.from || hour >= DIGEST_HOURS_KAMPALA.to) return;
    try {
      const summary = await runWhatsappAlertDigest(runner);
      if (summary.digests_written) logger.info('WhatsApp alert digest rows written (not sent)', summary);
    } catch (error) {
      if (!['42P01', '42703'].includes(error.code)) {
        logger.warn('WhatsApp alert digest job failed', { error: error.message });
      }
    }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return timer;
}

module.exports = {
  alertsEnabled,
  buildConsentConfirmationMessage,
  buildDigestMessage,
  buildWelcomeMessage,
  digestSearchMatchesListing,
  enqueueConsentMessage,
  getPendingAlertSummary,
  groupDigests,
  kampalaDate,
  runWhatsappAlertDigest,
  searchRecipient,
  startWhatsappAlertDigestSchedule
};
