'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  AUTO_VERIFIED_MARKER,
  agentHasCompleteDetails,
  agentHasCompleteDetailsSql,
  grantVerifiedTickIfComplete
} = require('../services/agentVerifiedTickService');
const { isVerifiedByMakaug, verifiedByMakaugSql } = require('../services/publicAgentEligibilityService');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const complete = {
  id: '00000000-0000-4000-8000-000000000001',
  status: 'approved',
  full_name: 'Charles Example',
  licence_number: 'AREA/UG/1',
  verification_reason: '',
  nin: 'CM12345678ABCD',
  identity_document_url: '',
  phone: '+256 772 000 000'
};

test('complete details: approved, not removed, not imported, ID on file, valid phone', () => {
  assert.equal(agentHasCompleteDetails(complete), true, 'NIN alone counts as an ID');
  assert.equal(agentHasCompleteDetails({ ...complete, nin: '', identity_document_url: 's3://private/id' }), true, 'an ID document counts');
  assert.equal(agentHasCompleteDetails({ ...complete, nin: '', has_id_file: true }), true, 'a staff-uploaded ID front counts');
  assert.equal(agentHasCompleteDetails({ ...complete, nin: '' }), false, 'no ID');
  assert.equal(agentHasCompleteDetails({ ...complete, nin: '123' }), false, 'a stub NIN is not an ID');
  assert.equal(agentHasCompleteDetails({ ...complete, phone: '', whatsapp: '' }), false, 'no phone');
  assert.equal(agentHasCompleteDetails({ ...complete, phone: '', whatsapp: '0772000000' }), true, 'WhatsApp counts');
  assert.equal(agentHasCompleteDetails({ ...complete, phone: '12' }), false, 'invalid phone');
  assert.equal(agentHasCompleteDetails({ ...complete, status: 'pending' }), false, 'pending is never ticked');
  assert.equal(agentHasCompleteDetails({ ...complete, status: 'suspended' }), false);
  assert.equal(agentHasCompleteDetails({ ...complete, removed_at: '2026-11-01' }), false);
  assert.equal(agentHasCompleteDetails({ ...complete, licence_number: 'FOUND-ONLINE-9' }), false);
  assert.equal(agentHasCompleteDetails({ ...complete, licence_number: 'SOCIAL-TIKTOK-1' }), false);
  assert.equal(agentHasCompleteDetails({ ...complete, verification_reason: 'Public social source onboarding' }), false);
});

test('the SQL rule checks the same things', () => {
  const sql = agentHasCompleteDetailsSql('a');
  for (const part of [/status, ''\)\) = 'approved'/, /removed_at IS NULL/, /a\.nin/, /identity_document_url/,
    /agent_identity_files/, /id_front/, /archived_at IS NULL/, /FOUND-ONLINE/, /\{9,15\}/]) assert.match(sql, part);
});

test('the public tick accepts a NIN or staff ID file and drops when the ID is gone', () => {
  const sql = verifiedByMakaugSql('a');
  assert.match(sql, /a\.nin/);
  assert.match(sql, /agent_identity_files/);
  const ticked = { ...complete, verification_reason: '[STAFF_REVIEWED_PRIVATE_ID_PROFILE] [AUTO_VERIFIED_COMPLETE_DETAILS]', contact_phone_verified_at: '2026-11-02T08:00:00Z' };
  assert.equal(isVerifiedByMakaug(ticked), true, 'NIN-only agent is ticked');
  assert.equal(isVerifiedByMakaug({ ...ticked, nin: '' }), false, 'ID removed: no tick');
  assert.equal(isVerifiedByMakaug({ ...ticked, status: 'suspended' }), false, 'suspended: no tick');
  assert.equal(isVerifiedByMakaug({ ...ticked, removed_at: '2026-11-02' }), false, 'removed: no tick');
});

function fakeDb(rows) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (/^UPDATE agents/.test(sql.trim())) return { rows };
      return { rows: [] };
    }
  };
}

test('grant: one guarded UPDATE that never touches status, plus an audit row', async () => {
  const db = fakeDb([{ id: complete.id, full_name: complete.full_name }]);
  const audits = [];
  const out = await grantVerifiedTickIfComplete(db, complete.id, {
    source: 'nin_edit', actorId: 'staff-1', writeAudit: async (...args) => audits.push(args)
  });
  assert.deepEqual(out, { granted: true, agent_id: complete.id });
  const { sql, params } = db.calls[0];
  assert.doesNotMatch(sql, /SET[\s\S]*\bstatus\s*=/i, 'never changes status');
  assert.match(sql, /POSITION\(\$2::text IN/, 'idempotent: skips agents already ticked');
  assert.match(sql, /contact_phone_verified_at = COALESCE/);
  assert.equal(params[1], '[STAFF_REVIEWED_PRIVATE_ID_PROFILE]');
  assert.ok(params[2].startsWith(AUTO_VERIFIED_MARKER));
  assert.equal(audits.length, 1);
  assert.equal(audits[0][0], 'agent_verified_tick_auto_granted');
  assert.equal(audits[0][1].source, 'nin_edit');
  assert.equal(audits[0][2], 'staff-1');
});

test('grant: no audit when nothing qualifies, default audit insert, and never throws', async () => {
  const none = fakeDb([]);
  const audits = [];
  assert.deepEqual(await grantVerifiedTickIfComplete(none, complete.id, { writeAudit: async (...a) => audits.push(a) }), { granted: false });
  assert.equal(audits.length, 0);

  const db = fakeDb([{ id: complete.id }]);
  await grantVerifiedTickIfComplete(db, complete.id, { source: 'register' });
  assert.match(db.calls[1].sql, /INSERT INTO audit_logs/);

  const broken = { query: async () => { throw new Error('db down'); } };
  const out = await grantVerifiedTickIfComplete(broken, complete.id);
  assert.equal(out.granted, false);
  assert.equal(out.error, 'db down');
});

test('every save path calls the shared helper', () => {
  const admin = read('routes/admin.js');
  assert.match(admin, /grantVerifiedTickIfComplete\(db, req\.params\.id, \{ source: 'approval'/);
  assert.match(admin, /grantVerifiedTickIfComplete\(db, req\.params\.id, \{ source: 'id_upload'/);
  const manager = read('routes/adminAgentManager.js');
  assert.match(manager, /'nin_edit' : 'staff_manage'/);
  assert.match(manager, /grantVerifiedTickIfComplete\(db, inserted\.id, \{ source: 'staff_manage'/);
  assert.match(read('routes/adminAgentIdFiles.js'), /grantVerifiedTickIfComplete\(db, agent\.id, \{ source: 'id_upload'/);
  assert.match(read('routes/agents.js'), /source: 'register'/);
});

test('migration 198 backs up, backfills with the same rule, audits, and has a rollback', () => {
  const sql = read('db/migrations/198_auto_verified_tick_backfill.sql');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS migration_198_verified_tick_backup/);
  assert.match(sql, /'approved'/);
  assert.match(sql, /removed_at IS NULL/);
  assert.match(sql, /agent_identity_files/);
  assert.match(sql, /FOUND-ONLINE/);
  assert.match(sql, /<> 'Fortune'/);
  assert.match(sql, /agent_verified_tick_auto_granted/);
  assert.doesNotMatch(sql, /SET\s+status/i, 'never changes status');
  const rollback = read('scripts/rollback-198-auto-verified-tick-backfill.sql');
  assert.match(rollback, /FROM migration_198_verified_tick_backup/);
  assert.match(rollback, /verification_reason = b\.verification_reason/);
});
