'use strict';

// Data fix 225 (Arthur, 14 Nov 2026): MK-20261112-003434 reopened to
// pending with its 3 removed photos back; MK-20261111-49C4BA rejected for
// "No specific area". Only those two rows, by id and reference, after boot,
// and nothing is sent to anyone.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fix = require('../scripts/run-moderation-reversal-225');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const migration = read('db', 'migrations', '225_reopen_003434_reject_49c4ba.sql');
const runner = read('scripts', 'run-moderation-reversal-225.js');
const rollback = read('scripts', 'rollback-225-moderation-reversal.sql');
const server = read('server.js');

test('migration 225 only creates the backup table; runner is post-boot with timeouts', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS moderation_reversal_225_backup/);
  assert.match(migration, /lock_timeout = '3s'/);
  assert.match(migration, /statement_timeout = '15s'/);
  assert.doesNotMatch(migration, /UPDATE properties|DELETE FROM|DISABLE TRIGGER/);
  assert.doesNotMatch(runner + rollback, /DISABLE TRIGGER/);
  assert.doesNotMatch(runner, /DELETE FROM/);
  assert.match(runner, /SET LOCAL lock_timeout/);
  assert.match(runner, /SET LOCAL statement_timeout/);
  assert.match(server, /runModerationReversal225\(db, \{ logger \}\)/);
  assert.ok(server.indexOf('runModerationReversal225') > server.indexOf('runBenardMukonoFix224'), 'after the 224 repair');
  assert.match(rollback, /p\.updated_at = b\.applied_at/);
  assert.ok(!fs.existsSync(path.join(__dirname, '..', 'db', 'migrations', 'rollback-225-moderation-reversal.sql')));
});

test('only the two rows, by id and reference, guarded on the 14 Nov state', () => {
  assert.deepEqual(fix.SPECS.map((s) => [s.id, s.ref]), [
    ['a6662954-76ba-4d54-818c-3275aa80baff', 'MK-20261112-003434'],
    ['b9cbe819-de60-48cc-be58-30ba6e3b5cd3', 'MK-20261111-49C4BA']
  ]);
  assert.match(runner, /WHERE id = \$1 AND inquiry_reference = \$2/);
  assert.match(fix.UPDATE_SQL.reopen_to_pending, /status = 'pending'/);
  assert.match(fix.UPDATE_SQL.reopen_to_pending, /moderation_stage = 'in_review'/);
  assert.match(fix.UPDATE_SQL.reopen_to_pending, /rejected_at = NULL/);
  assert.match(fix.UPDATE_SQL.reopen_to_pending, /moderation_reason = NULL/);
  assert.match(fix.UPDATE_SQL.reject_no_specific_area, /status = 'rejected'/);
  assert.match(fix.UPDATE_SQL.reject_no_specific_area, /rejected_at = NOW\(\)/);
  assert.equal(fix.REJECT_REASON, 'No specific area');
  assert.equal(fix.REOPEN_NOTE, "Held: exact pin unconfirmed. Reopened per Arthur 14 Nov; the 13 Nov 'No contacts' reject was reversed.");
  assert.equal(fix.REJECT_NOTE, 'Rejected per Arthur 14 Nov: no specific area beyond Uganda / Lake Victoria views.');
  // Notes are appended, never replaced.
  for (const sql of Object.values(fix.UPDATE_SQL)) assert.match(sql, /moderation_notes \|\| E'\\n'/);
  assert.doesNotMatch(runner, /sendWhatsApp|sendMessage|notif[a-z]*\(|require\([^)]*(whatsapp|notification|email|listingModeration)/i);
});

function removedEntry(id, url, slot, sort) {
  return { id, url, removed_at: '2026-11-13T11:56:20.310Z', removed_by: 'staff',
    images: [{ id, url, property_id: fix.REOPEN.id, is_primary: false, slot_key: slot, sort_order: sort, room_label: 'Source supporting image', created_at: '2026-11-12T13:52:18.075Z' }] };
}

function fakeDb({ guards = {}, done = {} } = {}) {
  const calls = [];
  const extra = {
    staff_removed_images: [
      removedEntry(fix.REOPEN.imageIds[0], 'https://i.ytimg.com/vi/x/mqdefault.jpg', 'source_image_4', 3),
      removedEntry(fix.REOPEN.imageIds[1], 'https://i.ytimg.com/vi/x/default.jpg', 'source_image_5', 4),
      removedEntry(fix.REOPEN.imageIds[2], 'https://i.ytimg.com/vi/x/sddefault.jpg', 'source_image_2', 1)
    ]
  };
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/^\s*SELECT id, updated_at/.test(sql)) {
        const spec = fix.SPECS.find((s) => s.id === params[0] && s.ref === params[1]);
        if (!spec) return { rows: [] };
        return { rows: [{ id: spec.id, updated_at: 't0', status: spec === fix.REOPEN ? 'rejected' : 'approved',
          extra_fields: spec === fix.REOPEN ? extra : {}, guard_ok: guards[spec.ref] !== false, already_done: !!done[spec.ref] }] };
      }
      if (/INSERT INTO property_images/.test(sql)) return { rows: [{ id: params[0] }] };
      if (/SELECT id FROM property_images/.test(sql)) return { rows: [{ id: 'primary-maxres' }] };
      if (/SELECT id, url, slot_key, is_primary FROM property_images/.test(sql)) return { rows: [{ id: 'primary-maxres', url: 'u', slot_key: null }] };
      return { rows: [] };
    },
    release() {}
  };
  return { calls, db: { async getClient() { return client; } } };
}

test('applies both rows, restores the 3 photos, logs events that say nothing was sent', async () => {
  const { db, calls } = fakeDb();
  const out = await fix.runModerationReversal225(db, { logger: { warn() {} } });
  assert.equal(out.updated, 2);
  assert.equal(out.results['MK-20261112-003434'].restored_images, 3);
  const inserts = calls.filter((c) => /INSERT INTO property_images/.test(c.sql));
  assert.deepEqual(inserts.map((c) => c.params[0]), fix.REOPEN.imageIds);
  assert.ok(inserts.every((c) => /VALUES \(\$1, \$2, \$3, false/.test(c.sql)), 'restored photos are never primary');
  const extraUpdate = calls.find((c) => /staff_removed_images/.test(c.sql) && c.params[1]);
  assert.equal(extraUpdate.params[1], '[]');
  const events = calls.filter((c) => /INSERT INTO property_moderation_events/.test(c.sql));
  assert.deepEqual(events.map((c) => (c.sql.match(/'(listing_status_changed|staff_listing_photo_restored)'/) || [])[1]),
    ['staff_listing_photo_restored', 'listing_status_changed', 'listing_status_changed']);
  for (const c of events.filter((e) => /listing_status_changed/.test(e.sql))) {
    const delivery = JSON.parse(c.params[c.params.length - 1]);
    assert.equal(delivery.email.sent, false);
    assert.equal(delivery.whatsapp.sent, false);
  }
  const reject = events[2];
  assert.equal(reject.params[1], 'approved');
  assert.equal(reject.params[2], 'No specific area');
  assert.ok(calls.some((c) => c.sql === 'COMMIT'));
});

test('skips a row whose state changed or that was already fixed', async () => {
  const { db, calls } = fakeDb({ guards: { 'MK-20261111-49C4BA': false }, done: { 'MK-20261112-003434': true } });
  const out = await fix.runModerationReversal225(db, { logger: { warn() {} } });
  assert.equal(out.updated, 0);
  assert.equal(out.results['MK-20261112-003434'].result, 'already_done');
  assert.equal(out.results['MK-20261111-49C4BA'].result, 'state_changed_skipped');
  assert.ok(!calls.some((c) => /UPDATE properties|INSERT INTO property_images|property_moderation_events/.test(c.sql)));
});
