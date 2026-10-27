'use strict';

// 26 Oct 2026: saves without an account, WhatsApp consent records and alert
// previews. Nothing here sends a message.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = 'test';

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const device = require('../services/deviceIdentity');
const consent = require('../services/marketingConsentService');
const digest = require('../services/whatsappAlertDigestService');
const saves = require('../routes/saves')._test;
const staff = require('../routes/staff-home-seekers')._test;

function fakeRunner() {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (/INSERT INTO marketing_consent_events/.test(sql)) {
        return { rows: [{ id: 'evt-1', source: params[6], wording_version: params[7], consented_at: params[11], granted: params[5] }] };
      }
      return { rows: [] };
    }
  };
}

test('device cookie: random, HttpOnly, long-lived, only valid ids are read', () => {
  const id = device.newDeviceId();
  assert.ok(device.isValidDeviceId(id));
  assert.notEqual(id, device.newDeviceId());
  assert.equal(device.DEVICE_COOKIE_NAME, 'mk_did');
  const opts = device.deviceCookieOptions({ secure: true });
  assert.equal(opts.httpOnly, true);
  assert.equal(opts.sameSite, 'lax');
  assert.equal(opts.maxAge, 400 * 24 * 60 * 60 * 1000);
  assert.equal(device.readDeviceId({ headers: { cookie: `a=1; mk_did=${id}` } }), id);
  assert.equal(device.readDeviceId({ headers: { cookie: 'mk_did=<script>' } }), '');
  assert.equal(device.readDeviceId({ headers: {} }), '');
});

test('saves helpers: Ugandan numbers only, categories normalised, unavailable listings hidden', () => {
  assert.equal(saves.normalizeUgMobile('0772 123 456'), '+256772123456');
  assert.equal(saves.normalizeUgMobile('256772123456'), '+256772123456');
  assert.equal(saves.normalizeUgMobile('+447700900123'), '');
  assert.equal(saves.normalizeCategory('students'), 'student');
  assert.equal(saves.normalizeCategory('for-sale'), 'sale');
  const payload = saves.savesPayload({ kind: 'device' }, [
    { property_id: 'a', available: true, title: 'A' },
    { property_id: 'b', available: false, title: 'B' }
  ]);
  assert.deepEqual(payload.ids, ['a']);
  assert.equal(payload.owner, 'device');
  assert.equal(payload.unavailable_count, 1);
});

test('sign-up consent wording is exact and versioned', () => {
  assert.equal(consent.SIGNUP_CONSENT_WORDING.text, 'Send me new property alerts and offers on WhatsApp. Reply STOP anytime.');
  assert.equal(consent.SIGNUP_CONSENT_WORDING.version, 'signup_whatsapp_2026_10_26');
  assert.match(consent.SEARCH_ALERT_CONSENT_WORDING.text, /Max one message a day\. Reply STOP anytime\./);
});

test('consent event stores channel, source, wording version, text and time', async () => {
  const runner = fakeRunner();
  const when = '2026-10-20T09:00:00.000Z';
  await consent.recordUserMarketingConsent(runner, {
    userId: 'u1', phone: '+256772123456', granted: true, source: 'signup_checkbox',
    wordingVersion: consent.SIGNUP_CONSENT_WORDING.version, wordingText: consent.SIGNUP_CONSENT_WORDING.text, consentedAt: when
  });
  const insert = runner.calls[0];
  assert.match(insert.sql, /INSERT INTO marketing_consent_events/);
  assert.equal(insert.params[3], 'whatsapp');
  assert.equal(insert.params[5], true);
  assert.equal(insert.params[6], 'signup_checkbox');
  assert.equal(insert.params[7], 'signup_whatsapp_2026_10_26');
  assert.equal(insert.params[11], when);
  assert.match(runner.calls[1].sql, /marketing_opt_in = TRUE/);
});

test('consent: a no clears the flag; unknown sources and missing wording are refused; future dates are not trusted', async () => {
  const runner = fakeRunner();
  await consent.recordUserMarketingConsent(runner, { userId: 'u1', granted: false, source: 'account_settings', wordingVersion: 'v' });
  assert.equal(runner.calls[0].params[5], false);
  assert.match(runner.calls[1].sql, /marketing_opt_in = FALSE/);
  await assert.rejects(consent.recordConsentEvent(runner, { userId: 'u1', source: 'made_up', wordingVersion: 'v' }));
  await assert.rejects(consent.recordConsentEvent(runner, { userId: 'u1', source: 'signup_checkbox' }));
  assert.equal(consent.validConsentedAt(new Date(Date.now() + 86400000)), null);
});

test('alert me is consent for that search only, never general marketing', async () => {
  const runner = fakeRunner();
  await consent.recordSearchAlertConsent(runner, { deviceId: 'dev', phone: '+256772123456', savedSearchId: 's1' });
  assert.equal(runner.calls.length, 1, 'no users update');
  assert.equal(runner.calls[0].params[4], 'search_alerts');
  assert.equal(runner.calls[0].params[6], 'search_alert_button');
});

test('staff in-person date: YYYY-MM-DD, not in the future', () => {
  assert.ok(staff.inPersonConsentDate('2026-10-01') instanceof Date);
  assert.ok(staff.inPersonConsentDate('') instanceof Date);
  assert.equal(staff.inPersonConsentDate('01/10/2026'), null);
  assert.equal(staff.inPersonConsentDate('2099-01-01'), null);
});

test('alert digests: opted-in only, one per person, no repeats, STOP respected', () => {
  const listing = (id, extra = {}) => ({ id, title: `Home ${id}`, listing_type: 'rent', district: 'Kampala', area: 'Ntinda', price: 900000, price_period: 'month', live_at: '2026-10-26T06:00:00Z', ...extra });
  const listings = [listing('l1'), listing('l2'), listing('l3', { listing_type: 'sale' })];
  const searches = [
    { id: 's1', category: 'rent', location: 'Ntinda', phone: '0772123456', alert_scope: 'search_alerts_whatsapp', consent_granted: true, consent_at: '2026-10-25T10:00:00Z' },
    { id: 's2', category: 'rent', phone: '+256772123456', alert_scope: 'search_alerts_whatsapp', consent_granted: true, consent_at: '2026-10-25T10:00:00Z' },
    { id: 's3', category: 'rent', phone: '0700000001', alert_scope: 'saved_search' },
    { id: 's4', category: 'rent', phone: '0700000002', alert_scope: 'search_alerts_whatsapp', consent_granted: true, consent_at: '2026-10-20T10:00:00Z' },
    { id: 's5', category: 'rent', phone: '0700000003', alert_scope: 'search_alerts_whatsapp', consent_granted: true }
  ];
  const withdrawals = new Map([['+256700000002', '2026-10-22T10:00:00Z']]);
  const groups = digest.groupDigests({
    listings, searches, withdrawals,
    alreadyAlerted: new Set(['phone:+256772123456|l2']),
    alreadyHadDigestToday: new Set(['phone:+256700000003'])
  });
  assert.equal(groups.length, 1);
  assert.equal(groups[0].phone, '+256772123456');
  assert.deepEqual(groups[0].listings.map((l) => l.id), ['l1']);
  assert.deepEqual(groups[0].searchIds.sort(), ['s1', 's2']);
});

test('digest matching: an empty max price does not hide every listing', () => {
  const l = { id: 'l1', listing_type: 'rent', district: 'Kampala', area: 'Ntinda', price: 900000 };
  assert.equal(digest.digestSearchMatchesListing({ category: 'rent', location: 'Ntinda', max_price: null }, l), true);
  assert.equal(digest.digestSearchMatchesListing({ category: 'rent', max_price: '500000' }, l), false);
  assert.equal(digest.digestSearchMatchesListing({ category: 'sale' }, l), false);
});

test('digest message names listings, links back and says how to stop', () => {
  const msg = digest.buildDigestMessage([{ id: 'abc', title: 'Ntinda flat', area: 'Ntinda', district: 'Kampala', price: 900000, price_period: 'month' }], { url: 'https://makaug.com' });
  assert.match(msg, /1 new property matches/);
  assert.match(msg, /UGX 900,000\/month/);
  assert.match(msg, /https:\/\/makaug\.com\/property\/abc/);
  assert.match(msg, /Reply STOP/);
});

test('WhatsApp alerts are off unless the flag is set', () => {
  const before = process.env.WHATSAPP_ALERTS_ENABLED;
  delete process.env.WHATSAPP_ALERTS_ENABLED;
  assert.equal(digest.alertsEnabled(), false);
  if (before !== undefined) process.env.WHATSAPP_ALERTS_ENABLED = before;
});

test('migration 186 records the existing opt-ins as in person, keeps their dates and queues no message', () => {
  const sql = read('db/migrations/186_whatsapp_consent_records_and_email_verified.sql');
  assert.match(sql, /'in_person_pre_2026_10_26'/);
  assert.match(sql, /'in_person'/);
  assert.match(sql, /marketing_consent_at IS NULL/, 'existing consent dates are left alone');
  assert.match(sql, /SET marketing_consent_at = u\.created_at/, 'no invented dates: account creation time');
  assert.doesNotMatch(sql, /pending_whatsapp_alerts|whatsapp_outbound/i);
  assert.match(sql, /ALTER COLUMN marketing_opt_in SET DEFAULT FALSE/);
  assert.ok(fs.existsSync(path.join(root, 'scripts/rollback-186-whatsapp-consent-records-and-email-verified.sql')));
});

test('staff consent route never queues a WhatsApp message', () => {
  const src = read('routes/staff-home-seekers.js');
  assert.doesNotMatch(src, /enqueueConsentMessage|whatsappOutbound|sendWhatsapp/i);
});

test('front end: unticked sign-up box with the exact wording; saves work signed out', () => {
  const html = read('index.html');
  const box = html.match(/<input id="auth-signup-whatsapp-consent"[^>]*>/);
  assert.ok(box, 'consent checkbox exists');
  assert.doesNotMatch(box[0], /\bchecked\b/);
  assert.match(html, />Send me new property alerts and offers on WhatsApp\. Reply STOP anytime\.</);
  assert.doesNotMatch(html, /auth-signup-weekly-tips/);
  assert.match(html, /id="nav-saved-btn"/);
  const app = read('assets/makaug-app.js');
  assert.match(app, /marketing_opt_in: whatsappConsent/);
  assert.match(app, /apiRequest\("\/api\/saves"\)/);
  assert.match(app, /Save this search \/ alert me/);
  assert.match(app, /Device cookie \(mk_did\)/);
});

test('live sign-up drawer: unticked WhatsApp box, phone-only behind the flag, brokers keep email', () => {
  const app = read('assets/makaug-app.js');
  const box = app.match(/<input id="account-access-whatsapp-consent"[^>]*>/);
  assert.ok(box, 'drawer consent checkbox exists');
  assert.doesNotMatch(box[0], /\bchecked\b/);
  assert.match(app, /<span>Send me new property alerts and offers on WhatsApp\. Reply STOP anytime\.<\/span>/);
  assert.match(app, /marketing_opt_in: whatsappConsent,\n\s+preferred_language: preferredLanguage/);
  assert.match(app, /window\.MAKAUG_CONFIG\?\.signupPhoneOnly === true && accountAccessDrawerAudience !== "agent"/);
  assert.match(app, /email: phoneOnlySignup \? undefined : email/);
});

test('public /cookie-policy page explains the device cookie', () => {
  const src = read('services/publicHtmlSanitizer.js');
  const block = src.slice(src.indexOf("'/cookie-policy': {"));
  assert.match(block, /id="cookie-policy-device-line"[^>]*>When you save a property or a search without an account/);
  assert.match(block, /up to 400 days, is not used for\s+advertising|up to 400 days, is not used for advertising/);
});

test('users who agreed in person count as opted in like any other consented user', () => {
  const base = { user_id: 'u1', user_phone: '+256700000011', user_marketing_opt_in: true };
  assert.ok(digest.searchRecipient({ ...base, user_marketing_consent_source: 'in_person' }));
  assert.ok(digest.searchRecipient({ ...base, user_marketing_consent_source: 'signup_checkbox' }));
  assert.equal(digest.searchRecipient({ ...base, user_marketing_opt_in: false }), null);
  const src = read('services/whatsappAlertDigestService.js');
  assert.doesNotMatch(src, /<> 'in_person'/);
});

test('hourly digest job is off unless WHATSAPP_ALERT_DIGEST_JOB=on', () => {
  const saved = process.env.WHATSAPP_ALERT_DIGEST_JOB;
  try {
    delete process.env.WHATSAPP_ALERT_DIGEST_JOB;
    assert.equal(digest.digestJobEnabled(), false);
    process.env.WHATSAPP_ALERT_DIGEST_JOB = 'off';
    assert.equal(digest.digestJobEnabled(), false);
    process.env.WHATSAPP_ALERT_DIGEST_JOB = 'true';
    assert.equal(digest.digestJobEnabled(), false);
    process.env.WHATSAPP_ALERT_DIGEST_JOB = 'on';
    assert.equal(digest.digestJobEnabled(), true);
  } finally {
    if (saved === undefined) delete process.env.WHATSAPP_ALERT_DIGEST_JOB;
    else process.env.WHATSAPP_ALERT_DIGEST_JOB = saved;
  }
  // With the flag unset no timer is registered, even outside tests.
  const env = { NODE_ENV: process.env.NODE_ENV, DATABASE_URL: process.env.DATABASE_URL };
  try {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgres://unused';
    delete process.env.WHATSAPP_ALERT_DIGEST_JOB;
    assert.equal(digest.startWhatsappAlertDigestSchedule({ runner: { query: async () => ({ rows: [] }) } }), null);
  } finally {
    process.env.NODE_ENV = env.NODE_ENV;
    if (env.DATABASE_URL === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = env.DATABASE_URL;
    if (saved !== undefined) process.env.WHATSAPP_ALERT_DIGEST_JOB = saved;
  }
});
