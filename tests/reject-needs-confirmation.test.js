'use strict';

/**
 * C2 addendum (10 Oct 2026): on 9 and 10 Oct, ten found-online listings went
 * from pending to rejected through the moderator1 session, each with the
 * listing's own default status note ("Pending King review of public
 * found-online source…") as the reason, e.g. MK-20261009-53BFE3, FA0B70,
 * 4B05C9, 5E27ED. The staff and admin Decision panels pre-filled the reason box
 * with that note, and Reject accepted it in one click.
 *
 * Now: Reject needs a real click, a typed reason (never the status note) and a
 * second click to confirm; the server refuses the status note and an
 * unconfirmed moderator reject, Save can't reject, and the event records the
 * UI control. C2 also: staff preview videos are created only on click.
 *
 * DB-backed tests need TEST_DATABASE_URL (local or staging, never production).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DB_URL = process.env.TEST_DATABASE_URL || '';
if (DB_URL) {
  process.env.DATABASE_URL = DB_URL;
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'reject-confirmation-secret';
}
const skip = DB_URL ? false : 'TEST_DATABASE_URL is not set';

const APP = fs.readFileSync(path.join(__dirname, '..', 'assets', 'makaug-app.js'), 'utf8');
const DEFAULT_NOTE = 'Pending King review of public found-online source, exact pin, latest availability, price, and image/source evidence. Needs review.';

function grab(name) {
  const start = APP.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  let depth = 0;
  for (let i = APP.indexOf(') {', start) + 2; i < APP.length; i += 1) {
    if (APP[i] === '{') depth += 1;
    else if (APP[i] === '}' && --depth === 0) return APP.slice(start, i + 1);
  }
  throw new Error(name);
}
const grabConst = (name) => {
  const start = APP.indexOf(`const ${name} =`);
  return APP.slice(start, APP.indexOf(';\n', start) + 1);
};

test('the server treats the listing\'s own status note as no reason', () => {
  const { isDefaultStatusNoteReason } = require('../routes/properties')._test;
  const pending = { status: 'pending', moderation_reason: DEFAULT_NOTE };
  assert.equal(isDefaultStatusNoteReason(DEFAULT_NOTE, pending), true);
  assert.equal(isDefaultStatusNoteReason('Pending King review of Carnelian source video', {}), true);
  assert.equal(isDefaultStatusNoteReason('  ', pending), true);
  assert.equal(isDefaultStatusNoteReason('Duplicate of MK-20261008-AB12CD, same TikTok post.', pending), false);
  const custom = { status: 'pending', moderation_reason: 'Owner asked us to hold it' };
  assert.equal(isDefaultStatusNoteReason('Owner asked us to hold it', custom), true, 'the stored note, unchanged');
});

function rejectSandbox() {
  const toasts = [];
  const sandbox = { toast: (message) => toasts.push(message), Date, setTimeout: () => 0, document: { querySelector: () => null } };
  vm.runInNewContext([
    grabConst('REJECT_CONFIRM_WINDOW_MS'), grabConst('DEFAULT_STATUS_NOTE_RE'), 'let pendingRejectConfirmation = null;',
    grab('isDefaultStatusNoteText'), grab('typedDecisionReasonForPrefill'), grab('rejectClickIsExplicit'), grab('confirmRejectClick'),
    'this.api = { isDefaultStatusNoteText, typedDecisionReasonForPrefill, rejectClickIsExplicit, confirmRejectClick };'
  ].join('\n'), sandbox);
  return { api: sandbox.api, toasts };
}

test('Reject needs a real click and a second click to confirm', () => {
  const { api, toasts } = rejectSandbox();
  assert.equal(api.rejectClickIsExplicit({ type: 'click', isTrusted: true }), true);
  assert.equal(api.rejectClickIsExplicit({ type: 'keydown', isTrusted: true }), false);
  assert.equal(api.rejectClickIsExplicit({ type: 'click', isTrusted: false }), false, 'a scripted click');
  assert.equal(api.rejectClickIsExplicit(null), false, 'a stale resubmit, no click at all');
  assert.equal(api.confirmRejectClick('staff:a', 'x'), false, 'the first click only arms it');
  assert.match(toasts[0], /click Reject again within 10 seconds/);
  assert.equal(api.confirmRejectClick('staff:b', 'x'), false, 'another listing does not confirm the first');
  assert.equal(api.confirmRejectClick('staff:b', 'x'), true);
});

test('the reason box is never pre-filled with the status note', () => {
  const { api } = rejectSandbox();
  assert.equal(api.typedDecisionReasonForPrefill({ moderation_reason: DEFAULT_NOTE, review: { reason: DEFAULT_NOTE } }), '');
  assert.equal(api.typedDecisionReasonForPrefill({ moderation_reason: DEFAULT_NOTE, review: { reason: 'Sold already, agent confirmed.' } }), 'Sold already, agent confirmed.');
  assert.equal(api.isDefaultStatusNoteText(DEFAULT_NOTE, {}), true);
  assert.match(APP, /placeholder="Type the reason \(required to reject\)">\$\{adminEscape\(typedDecisionReasonForPrefill\(preview\)\)\}<\/textarea>/);
  assert.match(APP, /const decisionReason = typedDecisionReasonForPrefill\(review\) \|\| generatedDecisionReason \|\| "";/);
  assert.doesNotMatch(APP, /preview\.review\?\.reason \|\| preview\.moderation_reason/);
  // Both Reject buttons send the confirmation and the control.
  assert.match(APP, /reject_confirmed: true,\n\s*ui_control: "staff_preview_reject_button"/);
  assert.match(APP, /\{ reject_confirmed: true, ui_control: options\.ui_control \|\| "admin_listing_status" \}/);
  assert.match(APP, /onclick="adminSetListingStatus\(\$\{reviewIdArg\}, 'rejected', \$\{reviewIdArg\}, \{ ui_control: 'admin_review_reject_button' \}\)"/);
});

test('staff preview videos are created only on click', () => {
  const sandbox = { translateListingLabel: (value) => value, adminAttr: (value) => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;') };
  vm.runInNewContext(`${grab('videoPlayerSlotHtml')}\n${grab('playVideoEmbed')}\nthis.slot = videoPlayerSlotHtml; this.play = playVideoEmbed;`, sandbox);
  const iframe = '<iframe src="https://www.tiktok.com/embed/v2/123"></iframe>';
  const html = sandbox.slot(iframe, { clickToPlay: true });
  assert.doesNotMatch(html, /<iframe/);
  assert.match(html, /data-video-click-to-play="true"/);
  assert.equal(sandbox.slot(iframe, {}), iframe, 'public pages unchanged');
  const slot = { innerHTML: '' };
  assert.equal(sandbox.play({ parentElement: slot, getAttribute: () => iframe }), true);
  assert.equal(slot.innerHTML, iframe);
  assert.match(APP, /renderVideoEmbedCard\(url, \{\n\s*clickToPlay: true,\n\s*title: `Property video \$\{index \+ 1\}`/);
  assert.match(APP, /modal\.querySelectorAll\("iframe"\)\.forEach\(\(frame\) => \{/, 'closing the modal destroys the players');
});

let db;
let app;
let request;
let token;
let moderatorId;
const ids = [];
const TAG = `REJECT${crypto.randomBytes(3).toString('hex')}`;

test.after(async () => {
  if (!db) return;
  if (ids.length) {
    await db.query('DELETE FROM property_moderation_events WHERE property_id = ANY($1::uuid[])', [ids]).catch(() => {});
    await db.query('DELETE FROM properties WHERE id = ANY($1::uuid[])', [ids]).catch(() => {});
  }
  await db.query('DELETE FROM staff_activity_logs WHERE staff_user_id = $1', [moderatorId]).catch(() => {});
  await db.query('DELETE FROM users WHERE id = $1', [moderatorId]).catch(() => {});
  await db.pool.end().catch(() => {});
});

test('against a database: the status note, an unconfirmed reject and a Save-reject are refused; a confirmed one records the control', { skip }, async () => {
  const express = require('express');
  const jwt = require('jsonwebtoken');
  request = require('supertest');
  db = require('../config/database');
  moderatorId = (await db.query(
    `INSERT INTO users (first_name, last_name, phone, role, password_hash, status)
     VALUES ('Reject', 'Moderator', $1, 'moderator', 'x', 'active') RETURNING id`,
    [`+2567${String(Date.now()).slice(-8)}`]
  )).rows[0].id;
  token = jwt.sign({ sub: moderatorId, role: 'moderator' }, process.env.JWT_SECRET, { expiresIn: '10m' });
  app = express();
  app.use(express.json());
  app.use('/api/staff', require('../routes/staff'));
  app.use('/api/properties', require('../routes/properties'));
  const auth = (r) => r.set('Authorization', `Bearer ${token}`);
  const id = (await db.query(
    `INSERT INTO properties (listing_type, title, description, district, area, price, price_period, status, moderation_stage, moderation_reason, source, listed_via, extra_fields)
     VALUES ('rent', $1, 'Found-online flat to let in Kira with parking.', 'Wakiso', 'Kira', 900000, 'month', 'pending', 'pending', $2, 'found_online_property_source_v1', 'found_online', '{"found_online":true}'::jsonb)
     RETURNING id`,
    [`${TAG} flat`, DEFAULT_NOTE]
  )).rows[0].id;
  ids.push(id);
  const status = (body) => auth(request(app).patch(`/api/properties/${id}/status`)).send({ status: 'rejected', manual_notification_only: true, ...body });

  const unconfirmed = await status({ reason: 'Duplicate of another listing, same TikTok post.' });
  assert.equal(unconfirmed.status, 400);
  assert.equal(unconfirmed.body.code, 'reject_not_confirmed');
  const noteAsReason = await status({ reason: DEFAULT_NOTE, reject_confirmed: true, ui_control: 'staff_preview_reject_button' });
  assert.equal(noteAsReason.status, 400);
  assert.equal(noteAsReason.body.code, 'reject_reason_not_typed');
  const saveReject = await auth(request(app).patch(`/api/staff/properties/${id}/review`)).send({ listing: {}, stage: 'rejected', reason: 'x' });
  assert.equal(saveReject.status, 400);
  assert.equal(saveReject.body.code, 'reject_via_decision_panel');
  assert.equal((await db.query('SELECT status FROM properties WHERE id = $1', [id])).rows[0].status, 'pending', 'still pending');

  const rejected = await status({ reason: 'Duplicate of another listing, same TikTok post.', reject_confirmed: true, ui_control: 'staff_preview_reject_button' });
  assert.equal(rejected.status, 200, JSON.stringify(rejected.body).slice(0, 300));
  let event;
  for (let i = 0; i < 20 && !event; i += 1) {
    event = (await db.query(
      `SELECT delivery FROM property_moderation_events WHERE property_id = $1 AND action = 'listing_status_changed' AND status_to = 'rejected' LIMIT 1`,
      [id]
    )).rows[0];
    if (!event) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(event, 'moderation event written');
  assert.equal(event.delivery.rejection_ui_control, 'staff_preview_reject_button');
  assert.equal(event.delivery.rejection_confirmed, true);
});
