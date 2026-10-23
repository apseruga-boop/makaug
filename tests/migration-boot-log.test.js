'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  AREA_INDEX_MIGRATION,
  classifyMigrationFiles,
  logMigrationPlan
} = require('../scripts/migrate');

test.after(async () => {
  try { await require('../config/database').pool.end(); } catch (_error) { /* pool may already be closed */ }
});

test('migration 168 is the area index and the runner names applied and skipped files', () => {
  const file = path.join(__dirname, '..', 'db', 'migrations', AREA_INDEX_MIGRATION);
  assert.equal(fs.existsSync(file), true);
  assert.match(fs.readFileSync(file, 'utf8'), /CREATE INDEX CONCURRENTLY/i);

  const pending = classifyMigrationFiles(['001_a.sql', AREA_INDEX_MIGRATION], new Set(['001_a.sql']));
  assert.equal(pending.areaIndex, 'pending');
  assert.deepEqual(pending.pending, [AREA_INDEX_MIGRATION]);
  assert.deepEqual(pending.skipped, ['001_a.sql']);

  const already = classifyMigrationFiles(['001_a.sql', AREA_INDEX_MIGRATION], new Set(['001_a.sql', AREA_INDEX_MIGRATION]));
  assert.equal(already.areaIndex, 'skipped');
  assert.deepEqual(already.pending, []);

  const absent = classifyMigrationFiles(['001_a.sql'], new Set());
  assert.equal(absent.areaIndex, 'missing');

  const pendingLines = [];
  logMigrationPlan(pending, { info: (line) => pendingLines.push(String(line)) });
  const pendingLog = pendingLines.join('\n');
  assert.match(pendingLog, /Migration skipped \(already applied\): 001_a\.sql/);
  assert.match(pendingLog, /Migration pending: 168_area_category_lookup_indexes\.sql/);
  assert.match(pendingLog, /Migration 168 area index: pending \(168_area_category_lookup_indexes\.sql\)/);

  const skippedLines = [];
  logMigrationPlan(already, { info: (line) => skippedLines.push(String(line)) });
  const skippedLog = skippedLines.join('\n');
  assert.match(skippedLog, /Migration skipped \(already applied\): 168_area_category_lookup_indexes\.sql/);
  assert.match(skippedLog, /Migration 168 area index: skipped/);

  const runner = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'migrate.js'), 'utf8');
  assert.match(runner, /const plan = logMigrationPlan\(classifyMigrationFiles\(files, applied\)\)/);
  assert.match(runner, /for \(const file of plan\.pending\)/);
  assert.match(runner, /logger\.info\('Migrations complete'/);
  assert.match(runner, /areaIndex/);
  assert.doesNotMatch(runner, /logger\.debug\(/);
});
