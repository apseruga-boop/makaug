'use strict';

// WhatsApp marketing consent records (26 Oct 2026, area E).
// Every yes or no is written to marketing_consent_events with the channel,
// purpose, source, wording version, wording shown and the time agreed.
// users.marketing_opt_in and the users.marketing_consent_* columns hold the
// current state for an account.

const db = require('../config/database');

const CONSENT_CHANNEL = 'whatsapp';

const SIGNUP_CONSENT_WORDING = Object.freeze({
  version: 'signup_whatsapp_2026_10_26',
  text: 'Send me new property alerts and offers on WhatsApp. Reply STOP anytime.'
});

const SEARCH_ALERT_CONSENT_WORDING = Object.freeze({
  version: 'search_alert_whatsapp_2026_10_26',
  text: 'Send me new properties that match this search on WhatsApp. Max one message a day. Reply STOP anytime.'
});

const STAFF_IN_PERSON_CONSENT_WORDING = Object.freeze({
  version: 'staff_in_person_2026_10_26',
  text: 'Agreed in person to new property alerts and offers on WhatsApp. Recorded by makaug staff.'
});

const CONSENT_SOURCES = new Set([
  'signup_checkbox',
  'search_alert_button',
  'in_person',
  'staff_in_person',
  'account_settings',
  'whatsapp_stop',
  'staff_withdrawn'
]);

const CONSENT_PURPOSES = new Set(['marketing', 'search_alerts']);

function clean(value, max = 500) {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, max) : null;
}

function validConsentedAt(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  if (date.getTime() > Date.now() + 5 * 60 * 1000) return null;
  return date;
}

async function recordConsentEvent(client, input = {}) {
  const runner = client || db;
  const source = clean(input.source, 64);
  const purpose = clean(input.purpose, 32) || 'marketing';
  if (!CONSENT_SOURCES.has(source)) throw new Error(`Unknown consent source: ${source}`);
  if (!CONSENT_PURPOSES.has(purpose)) throw new Error(`Unknown consent purpose: ${purpose}`);
  if (!input.userId && !input.deviceId && !input.phone) throw new Error('Consent needs a user, device or phone');
  const wordingVersion = clean(input.wordingVersion, 120);
  if (!wordingVersion) throw new Error('Consent needs a wording version');
  const consentedAt = validConsentedAt(input.consentedAt) || new Date();
  const result = await runner.query(
    `INSERT INTO marketing_consent_events (
       user_id, device_id, phone, channel, purpose, granted, source,
       wording_version, wording_text, saved_search_id, recorded_by, consented_at
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING *`,
    [
      input.userId || null,
      clean(input.deviceId, 64),
      clean(input.phone, 32),
      CONSENT_CHANNEL,
      purpose,
      input.granted === true,
      source,
      wordingVersion,
      clean(input.wordingText, 1000),
      input.savedSearchId || null,
      input.recordedBy || null,
      consentedAt.toISOString()
    ]
  );
  return result.rows[0] || null;
}

// Marketing consent for an account: one event plus the current state on
// users. A "no" clears marketing_opt_in but keeps the history in events.
async function recordUserMarketingConsent(client, input = {}) {
  const runner = client || db;
  if (!input.userId) throw new Error('userId is required');
  const event = await recordConsentEvent(runner, { ...input, purpose: 'marketing' });
  if (input.granted === true) {
    await runner.query(
      `UPDATE users
       SET marketing_opt_in = TRUE,
           marketing_consent_at = $2,
           marketing_consent_source = $3,
           marketing_consent_wording_version = $4,
           updated_at = NOW()
       WHERE id = $1`,
      [input.userId, event.consented_at, event.source, event.wording_version]
    );
  } else {
    await runner.query(
      `UPDATE users
       SET marketing_opt_in = FALSE,
           marketing_consent_at = NULL,
           marketing_consent_source = $2,
           marketing_consent_wording_version = $3,
           updated_at = NOW()
       WHERE id = $1`,
      [input.userId, event.source, event.wording_version]
    );
  }
  return event;
}

// An "alert me" request is consent for that search's alerts only. It never
// turns on general marketing.
async function recordSearchAlertConsent(client, input = {}) {
  return recordConsentEvent(client, {
    ...input,
    purpose: 'search_alerts',
    granted: true,
    source: 'search_alert_button',
    wordingVersion: SEARCH_ALERT_CONSENT_WORDING.version,
    wordingText: SEARCH_ALERT_CONSENT_WORDING.text
  });
}

// A STOP from a phone (website side). The WhatsApp side that reads the reply
// is not built here; it will call this. It records a "no" for marketing and
// for search alerts, turns off marketing on accounts with that phone, stops
// WhatsApp on that phone's saved searches and cancels unsent alert rows.
async function recordWhatsappStop(client, input = {}) {
  const runner = client || db;
  const phone = clean(input.phone, 32);
  if (!phone) throw new Error('phone is required');
  const source = input.source === 'staff_withdrawn' ? 'staff_withdrawn' : 'whatsapp_stop';
  const wordingVersion = clean(input.wordingVersion, 120) || 'whatsapp_stop_reply';
  const users = await runner.query('SELECT id FROM users WHERE phone = $1', [phone]);
  const events = [];
  for (const purpose of ['marketing', 'search_alerts']) {
    events.push(await recordConsentEvent(runner, {
      phone,
      userId: users.rows.length === 1 ? users.rows[0].id : null,
      purpose,
      granted: false,
      source,
      wordingVersion,
      wordingText: clean(input.wordingText, 1000),
      recordedBy: input.recordedBy || null
    }));
  }
  const updatedUsers = await runner.query(
    `UPDATE users
     SET marketing_opt_in = FALSE,
         marketing_consent_at = NULL,
         marketing_consent_source = $2,
         marketing_consent_wording_version = $3,
         updated_at = NOW()
     WHERE phone = $1 AND marketing_opt_in = TRUE
     RETURNING id`,
    [phone, source, wordingVersion]
  );
  const searches = await runner.query(
    `UPDATE saved_searches
     SET alert_scope = 'none', updated_at = NOW()
     WHERE alert_scope = 'search_alerts_whatsapp'
       AND (phone = $1 OR user_id IN (SELECT id FROM users WHERE phone = $1))
     RETURNING id`,
    [phone]
  );
  const cancelled = await runner.query(
    `UPDATE pending_whatsapp_alerts
     SET status = 'cancelled', status_reason = $2, updated_at = NOW()
     WHERE phone = $1 AND status IN ('preview', 'pending')
     RETURNING id`,
    [phone, source]
  );
  return {
    events,
    users_opted_out: updatedUsers.rowCount || 0,
    searches_stopped: searches.rowCount || 0,
    alerts_cancelled: cancelled.rowCount || 0
  };
}

module.exports = {
  recordWhatsappStop,
  CONSENT_CHANNEL,
  CONSENT_PURPOSES,
  CONSENT_SOURCES,
  SEARCH_ALERT_CONSENT_WORDING,
  SIGNUP_CONSENT_WORDING,
  STAFF_IN_PERSON_CONSENT_WORDING,
  recordConsentEvent,
  recordSearchAlertConsent,
  recordUserMarketingConsent,
  validConsentedAt
};
