'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  planApprovalBoilerplateNoteRestore,
  isRecoverableStaffModerationNote,
  stripApprovalBoilerplatePrefix
} = require('../utils/moderationNotes');
const {
  BATCH_SIZE,
  MATCHING_SQL,
  runModerationNotesRestore220
} = require('../scripts/run-moderation-notes-restore-220');

const MIGRATION = path.join(__dirname, '../db/migrations/220_restore_wiped_moderation_notes.sql');
const RUNNER = path.join(__dirname, '../scripts/run-moderation-notes-restore-220.js');
const ROLLBACK = path.join(__dirname, '../scripts/rollback-220-restore-wiped-moderation-notes.sql');
const SERVER = path.join(__dirname, '../server.js');

const sql = fs.readFileSync(MIGRATION, 'utf8');
const runner = fs.readFileSync(RUNNER, 'utf8');
const rollback = fs.readFileSync(ROLLBACK, 'utf8');
const server = fs.readFileSync(SERVER, 'utf8');

test('migration 220 only creates the backup table and stays off the boot path', () => {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS moderation_notes_restore_220_backup/);
  assert.match(sql, /lock_timeout = '3s'/);
  assert.match(sql, /statement_timeout = '15s'/);
  assert.match(sql, /MK-20261110-7C1D37/);
  assert.doesNotMatch(sql, /UPDATE properties/);
  assert.doesNotMatch(sql, /DISABLE TRIGGER/);
  assert.doesNotMatch(sql, /DELETE FROM properties/);

  assert.equal(BATCH_SIZE, 20);
  assert.match(runner, /SET LOCAL lock_timeout/);
  assert.match(runner, /SET LOCAL statement_timeout/);
  assert.match(runner, /const STATEMENT_TIMEOUT = '30s'/);
  assert.match(runner, /runBackgroundWork/);
  assert.match(runner, /const BATCH_SIZE = 20/);
  assert.match(runner, /applied_at = p\.updated_at/);
  assert.match(MATCHING_SQL, /Staff preview completed before approval/);
  assert.match(MATCHING_SQL, /FOUND-ONLINE SOURCE POST IMPORT/);
  assert.match(MATCHING_SQL, /listing_notes/);
  assert.match(MATCHING_SQL, /created_at < a\.approval_at/);
  assert.match(MATCHING_SQL, /2026-11-04 00:00:00\+00/);
  assert.doesNotMatch(runner, /ALTER TABLE\s+properties\s+DISABLE TRIGGER/);
  assert.doesNotMatch(runner, /DELETE FROM properties/);
  // jsonb ? tests must be wrapped in COALESCE (none are required in MATCHING_SQL).
  assert.doesNotMatch(MATCHING_SQL, /[^L]extra_fields\s*\?/);
  assert.doesNotMatch(runner, /[^L]p\.extra_fields\s*\?/);

  assert.match(rollback, /Not run by scripts\/migrate\.js/);
  assert.match(rollback, /moderation_notes_restore_220_backup/);
  assert.match(rollback, /COALESCE\(p\.extra_fields, '\{\}'::jsonb\) \? 'moderation_notes_restore_220'/);
  assert.match(rollback, /updated_at = b\.applied_at/);
  assert.doesNotMatch(rollback, /DELETE FROM properties/);
  assert.doesNotMatch(rollback, /ALTER TABLE\s+\w+\s+DISABLE TRIGGER/);
  assert.doesNotMatch(rollback, /DROP TABLE/i);
  assert.equal(fs.existsSync(path.join(__dirname, '../db/migrations/rollback-220-restore-wiped-moderation-notes.sql')), false);

  assert.match(server, /runModerationNotesRestore220/);
  assert.match(server, /scheduleStartupDataRepairs/);
});

test('strip prefix, restore the prior real note, and skip templates', () => {
  const appended = 'Staff preview completed before approval\n[11 Nov 2026, 09:41 EAT] Moderator 1 Makaug: Re-verified original YouTube post';
  const strip = planApprovalBoilerplateNoteRestore(appended, []);
  assert.equal(strip.mode, 'strip_prefix');
  assert.equal(strip.restored_notes, '[11 Nov 2026, 09:41 EAT] Moderator 1 Makaug: Re-verified original YouTube post');
  assert.equal(stripApprovalBoilerplatePrefix(appended).startsWith('['), true);

  const prior = 'Verified original YouTube caption and video overlays: Flat House On Sale, 25 Dec 2025.';
  const restore = planApprovalBoilerplateNoteRestore('Staff preview completed before approval', [
    'Listing facts were updated as part of the moderation status action.',
    prior,
    'FOUND-ONLINE SOURCE POST IMPORT. Source: youtube',
  ]);
  assert.equal(restore.mode, 'restore_prior');
  assert.equal(restore.restored_notes, prior);

  const hold = planApprovalBoilerplateNoteRestore('Staff preview completed before approval', [
    'Rejected from staff preview\n[10 Nov 2026, 08:41 EAT] Moderator 1 Makaug: HOLD: re-check the pin',
  ]);
  assert.equal(hold.mode, 'restore_prior');
  assert.equal(hold.restored_notes, '[10 Nov 2026, 08:41 EAT] Moderator 1 Makaug: HOLD: re-check the pin');

  const skipped = planApprovalBoilerplateNoteRestore('Staff preview completed before approval', [
    'FOUND-ONLINE SOURCE POST IMPORT. Source: youtube',
    'SOCIAL SEARCH LISTING. TikTok import',
    'Listing facts were updated as part of the moderation status action.',
    'Rejected from staff preview',
    'Confirm the exact property pin and local amenities with the listing agent before approval.',
  ]);
  assert.equal(skipped.mode, 'skip_no_recoverable_note');
  assert.equal(skipped.restored_notes, null);

  const already = planApprovalBoilerplateNoteRestore(prior, [prior]);
  assert.equal(already.mode, 'already_ok');
  assert.equal(already.restored_notes, null);

  assert.equal(isRecoverableStaffModerationNote('FOUND-ONLINE SOURCE POST IMPORT. x'), false);
  assert.equal(isRecoverableStaffModerationNote('Staff preview completed before approval'), false);
  assert.equal(isRecoverableStaffModerationNote(prior), true);
});

test('the 220 runner skips a non-Uganda country and updates in batches of 20', async () => {
  const previous = process.env.COUNTRY_CODE;
  process.env.COUNTRY_CODE = 'KE';
  try {
    const result = await runModerationNotesRestore220({ getClient() { throw new Error('should not connect'); } });
    assert.equal(result.skipped, 'country_not_ug');
    assert.equal(result.updated, 0);
  } finally {
    if (previous == null) delete process.env.COUNTRY_CODE;
    else process.env.COUNTRY_CODE = previous;
  }
  assert.equal(BATCH_SIZE, 20);
});
