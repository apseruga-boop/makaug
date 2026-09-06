'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { socialSweepPublishedAfter } = require('../utils/socialSweepWindow');

test('social sweeps default to an exact rolling 30-day window', () => {
  const now = new Date('2026-09-06T12:00:00.000Z');
  assert.strictEqual(socialSweepPublishedAfter(undefined, now), '2026-08-07T12:00:00.000Z');
});

test('social sweep window accepts a bounded explicit lookback', () => {
  const now = new Date('2026-09-06T12:00:00.000Z');
  assert.strictEqual(socialSweepPublishedAfter(7, now), '2026-08-30T12:00:00.000Z');
});

test('staff, admin, and scheduled sweep entry points use the rolling window', () => {
  const root = path.resolve(__dirname, '..');
  const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
  const frontend = read('assets/makaug-app.js');
  const staff = read('routes/staff.js');
  const admin = read('routes/admin.js');
  const monitor = read('scripts/run-continuous-social-monitor.js');
  const cli = read('scripts/sweep-social-platform-posts.js');

  assert.match(frontend, /ADMIN_SOCIAL_SWEEP_LOOKBACK_DAYS = 30/);
  assert.doesNotMatch(frontend, /published_after: "2026-01-01T00:00:00.000Z"/);
  assert.match(staff, /publishedAfter: cleanText\([^\n]+socialSweepPublishedAfter\(\)\)/);
  assert.match(admin, /const publishedAfter = [^\n]+socialSweepPublishedAfter\(\)/);
  assert.match(monitor, /CONTINUOUS_SOCIAL_MONITOR_LOOKBACK_DAYS \|\| 30/);
  assert.match(cli, /argValue\('--lookback-days', '30'\)/);
});
