'use strict';

// 1 Nov 2026: the same 43-link TikTok import was submitted twice ~33 s apart.
// Both transactions ran the duplicate lookup before either committed, so each
// of 34 videos was inserted twice. These checks pin the fix.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

async function run() {
  const service = require('../services/socialSearchSourcedListingsService');
  const { canonicalSourceKeyForItem, lockFoundOnlineCanonicalKeys } = service;

  // One canonical key per video, whatever URL form it arrives in.
  const a = canonicalSourceKeyForItem({ sourceUrl: 'https://www.tiktok.com/@rawlings2026/video/7703026151924567316?is_from_webapp=1' });
  const b = canonicalSourceKeyForItem({ postUrl: 'https://tiktok.com/@someone_else/video/7703026151924567316' });
  const c = canonicalSourceKeyForItem({ sourceUrl: 'https://www.tiktok.com/@rawlings2026/video/7703026151924567999' });
  assert.strictEqual(a, 'video:7703026151924567316');
  assert.strictEqual(a, b, 'the same TikTok video must share one key across handles and query strings');
  assert.notStrictEqual(a, c);

  // Every item is locked, sorted and once, even with no phone fingerprint.
  const calls = [];
  const client = { query: async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; } };
  const keys = await lockFoundOnlineCanonicalKeys(client, [
    { sourceUrl: 'https://www.tiktok.com/@x/video/7700000000000000002' },
    { sourceUrl: 'https://www.tiktok.com/@x/video/7700000000000000001' },
    { sourceUrl: 'https://www.tiktok.com/@y/video/7700000000000000002?lang=en' },
  ]);
  assert.deepStrictEqual(keys, ['video:7700000000000000001', 'video:7700000000000000002']);
  assert.strictEqual(calls.length, 2);
  assert(calls.every((call) => /pg_advisory_xact_lock/.test(call.sql)));
  assert.deepStrictEqual(calls.map((call) => call.params[0]), [
    'found-online-source:video:7700000000000000001',
    'found-online-source:video:7700000000000000002',
  ]);

  // The lock is taken inside the transaction, before the duplicate lookup.
  const source = read('services/socialSearchSourcedListingsService.js');
  const queueStart = source.indexOf('async function queueFoundOnlineSourcePostListings');
  const queueBody = source.slice(queueStart);
  const lockAt = queueBody.indexOf('await lockFoundOnlineCanonicalKeys(client, items);');
  const lookupAt = queueBody.indexOf('const existing = await existingFoundOnlineSourcePostListings(client, items);');
  const beginAt = queueBody.indexOf("await client.query('BEGIN');");
  assert(beginAt >= 0 && lockAt > beginAt && lookupAt > lockAt, 'lock canonical keys after BEGIN and before the duplicate lookup');

  // In-batch: a registered item makes its video id visible to later items.
  const registerSrc = source.slice(source.indexOf('function registerExistingFoundOnlineItem'));
  assert(/existing\.set\(`video:\$\{videoId\}`, payload\)/.test(registerSrc.slice(0, 2500)), 'in-batch registration must record the video id');

  // A resubmitted identical staff import reuses the in-flight job.
  const staff = read('routes/staff.js');
  assert(staff.includes('staff-source-intake-inflight-reuse-20261101'));
  assert(staff.includes('findActiveStaffSourceIntakeJob(payloadKey)'));
  assert(staff.includes('reused_inflight_job: true'));

  // Duplicate Risk: the panels payload carries the count, keyed by video id.
  assert(staff.includes('staff-panels-duplicate-risk-20261101'));
  const panelsStart = staff.indexOf('async function buildDashboardPanelsPayload');
  const panelsBody = staff.slice(panelsStart, staff.indexOf('\n}\n', panelsStart));
  assert(panelsBody.includes('staffDuplicateGroupSummary()'), 'panels payload must load the duplicate summary');
  assert(panelsBody.includes('duplicates: duplicateSummary'), 'panels payload must return summary.duplicates');
  const { duplicateGroupsCountSql } = require('../utils/duplicateEvidence');
  const sql = duplicateGroupsCountSql('TRUE');
  assert(sql.includes("'video:' ||"), 'source groups must key on the canonical video id');
  assert(sql.includes("tiktok\\.com/(?:@[^/]+/)?video/([0-9]{6,})"), 'TikTok id regex must keep its escaped dot');

  console.log('found-online concurrent import dedupe: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
