'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('duplicate candidate lookup is two indexable branches, not one OR scan', () => {
  const sql = require('../utils/duplicateEvidence').DUPLICATE_CANDIDATES_SQL;
  assert.match(sql, /UNION ALL/);
  assert.doesNotMatch(sql, /ILIKE '%' \|\| \$3 \|\| '%'\)\s*OR/);
  assert.match(sql, /RIGHT\(regexp_replace\(COALESCE\(p\.lister_phone, ''\), '\\D', '', 'g'\), 9\) = \$4/);
  assert.match(sql, /COALESCE\(p\.extra_fields->>'source_url', p\.extra_fields->>'source_post_url', p\.extra_fields->>'tiktok_url', p\.extra_fields->>'youtube_url', p\.extra_fields->>'video_url', ''\) <> ''/);
  assert.match(sql, /FROM properties p\n   WHERE p\.id <> \$1/);
  assert.match(sql, /p\.extra_fields->>'source_quality_suppressed'/);
});

test('migration 160 builds the preview indexes concurrently', () => {
  const sql = read('db/migrations/160_staff_preview_duplicate_indexes.sql');
  assert.match(sql, /CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_properties_preview_phone_suffix_area/);
  assert.match(sql, /CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_properties_preview_source_url_trgm/);
  assert.match(sql, /RIGHT\(regexp_replace\(COALESCE\(lister_phone, ''\), '\\D', '', 'g'\), 9\)/);
  assert.match(sql, /gin_trgm_ops/);
  assert.doesNotMatch(sql, /statement_timeout/);
  const numbers = fs.readdirSync(path.join(__dirname, '../db/migrations'))
    .map((name) => Number(name.split('_')[0]))
    .filter((n) => Number.isFinite(n));
  assert.ok(numbers.includes(160));
  assert.ok(Math.max(...numbers.filter((n) => n !== 160)) >= 161);
});

test('staff preview names each query and does not hash every image in one join', () => {
  const staff = read('routes/staff.js');
  for (const label of [
    'staff_preview_property',
    'staff_preview_images',
    'staff_preview_duplicates',
    'staff_preview_events',
    'staff_preview_previous_lister',
    'staff_preview_image_hashes',
    'staff_preview_id_number',
    'staff_preview_matching_users',
    'staff_panel_recent_activity',
    'staff_duplicate_groups',
    'staff_dashboard_listing_summary'
  ]) {
    assert.match(staff, new RegExp(label));
  }
  assert.match(staff, /md5\(i\.url\) = ANY\(\$2::text\[\]\)/);
  assert.doesNotMatch(staff, /current_image_hashes AS MATERIALIZED/);
  assert.match(staff, /UNION ALL/);
  assert.match(staff, /PREVIEW_SIGNAL_CACHE_TTL_MS = 60_000/);
  assert.match(staff, /STAFF_DUPLICATE_GROUP_CACHE_TTL_MS = 60_000/);
  assert.match(staff, /p\.created_at >= NOW\(\) - INTERVAL '180 days'/);
});

test('startup repairs, homepage SEO and the employee sweepers wait out the deploy', () => {
  const { BOOT_DELAY_MS } = require('../utils/schedulerStagger');
  const delays = Object.values(BOOT_DELAY_MS);
  assert.equal(new Set(delays).size, delays.length);
  for (let index = 1; index < delays.length; index += 1) {
    assert.ok(delays[index] - delays[index - 1] >= 20_000, `${delays[index]} is not 20s after ${delays[index - 1]}`);
  }
  assert.ok(BOOT_DELAY_MS.startup_data_repairs > BOOT_DELAY_MS.video_stills);
  assert.ok(BOOT_DELAY_MS.whatsapp_media_retry > BOOT_DELAY_MS.startup_data_repairs);
  assert.ok(BOOT_DELAY_MS.whatsapp_batch_summary > BOOT_DELAY_MS.whatsapp_media_retry);
  const server = read('server.js');
  assert.match(server, /scheduleHomepageSeoWarmup\(\)/);
  assert.match(server, /staggeredBootDelay\('startup_data_repairs'\)/);
  assert.match(server, /staggeredBootDelay\('whatsapp_media_retry'\)/);
  assert.match(server, /staggeredBootDelay\('whatsapp_batch_summary'\)/);
  assert.match(server, /Public inventory counts warming in the background/);
  assert.doesNotMatch(server, /await loadPublicOpportunitySummary\(\{ timeoutMs: 5000 \}\)/);
  const readyAt = server.indexOf('runtimeReady = true');
  const seoAt = server.indexOf('function scheduleHomepageSeoWarmup');
  const countWarmAt = server.indexOf('schedulePublicInventoryCountWarmup()');
  assert.ok(readyAt > 0 && seoAt > readyAt, 'SEO warmup is not awaited before the process accepts traffic');
  assert.ok(countWarmAt > readyAt, 'inventory count warmup is scheduled after the process accepts traffic');
});
