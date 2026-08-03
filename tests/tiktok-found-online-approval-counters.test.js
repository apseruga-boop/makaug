'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Found Online approval bypasses owner identity and price confirmation without weakening owner listings', () => {
  const app = read('assets/makaug-app.js');
  const properties = read('routes/properties.js');
  assert.match(app, /foundOnlineApproval\s*=\s*staffSafeFoundOnlineApproval\(preview\)/);
  assert.match(app, /identityRequired\s*=\s*!foundOnlineApproval && moderationRequiresIdentity\(preview\)/);
  assert.match(app, /identityRequired\s*=\s*!foundOnlineApproval && moderationRequiresIdentity\(adminActiveReview\)/);
  assert.match(app, /identityRequired\s*=\s*!isSourcedCandidate && moderationRequiresIdentity\(review\)/);
  assert.match(app, /priceConfirmationRequired\s*=\s*!isSourcedCandidate && moderationRequiresHighMonthlyPriceConfirmation\(review\)/);
  assert.match(app, /isSourcedCandidate \? "" : moderationPriceBasisConfirmationHtml\(review, "admin-review"\)/);
  assert.match(properties, /requestedSourcedCandidateOverride\s*=\s*nextStatus === 'approved'[\s\S]*?parseBooleanLike\(req\.body\.sourced_candidate_override/);
  assert.match(properties, /if \(nextStatus === 'approved' && !\(requestedSourcedCandidateOverride && isSourcedCandidate\)\)/);
});

test('partial review edits cannot erase an existing area by omission', () => {
  const properties = read('routes/properties.js');
  const app = read('assets/makaug-app.js');
  assert.match(properties, /if \(\['title', 'description', 'area', 'district', 'listing_type'\]\.includes\(key\) && !value\) return/);
  assert.match(app, /Object\.entries\(\{[\s\S]*?area: get\("staff-preview-area"\)[\s\S]*?\}\)\.filter\(\(\[, value\]\) => String\(value \?\? ""\)\.trim\(\) !== ""\)/);
});

test('dashboard query failures expose unavailable values and are never cached as zero truth', () => {
  const staff = read('routes/staff.js');
  const admin = read('routes/admin.js');
  const app = read('assets/makaug-app.js');
  assert.match(staff, /_fallback_reason/);
  assert.match(staff, /miss_degraded_not_cached/);
  assert.match(staff, /stale_backoff/);
  assert.match(staff, /runStaffDashboardTasks\(\[/);
  assert.match(admin, /const statusUnavailable = Boolean\(statusRow\?\._fallback_reason\)/);
  assert.match(admin, /const pending = pendingResult\.value/);
  assert.match(admin, /admin_summary.*last_known_good/s);
  assert.match(app, /if \(value == null \|\| value === "" \|\| !Number\.isFinite\(Number\(value\)\)\) return "—"/);
});

test('launch markers are present', () => {
  const html = read('index.html');
  assert.match(html, /tiktok-manual-review-ready-20260802/);
  assert.match(html, /tiktok-found-online-approval-20260802/);
  assert.match(html, /staff-dashboard-nonzero-fallback-20260802/);
});

test('K25 moderation queues recover without poisoned cache or catalogue flooding', () => {
  const staff = read('routes/staff.js');
  const app = read('assets/makaug-app.js');
  const html = read('index.html');
  const migration = read('db/migrations/109_k25_staff_queue_recovery.sql');

  assert.match(staff, /payload\?\.review_queue_meta\?\.query_ok === true/);
  assert.match(staff, /status: queryOk \? 'miss' : 'miss_degraded_not_cached'/);
  assert.match(staff, /ttl_ms: queryOk \? STAFF_DASHBOARD_PANEL_CACHE_TTL_MS : 0/);
  assert.match(staff, /const includeTotal = includeTotalParam == null \? false/);
  assert.match(staff, /filters\.push\(actionablePendingReviewWhere\('p'\)\)/);
  assert.match(staff, /status && status !== 'all'/);

  assert.match(app, /function staffPanelRetryEndpoint/);
  assert.match(app, /cache_bypass=1&_cb=/);
  assert.match(app, /hydrateStaffDashboardPanels\(\s*"\/api\/staff\/dashboard\?panels=1",\s*String\(authState\?\.user\?\.id/);
  assert.doesNotMatch(app, /hydrateStaffDashboardPanels\(\s*"\/api\/staff\/dashboard\?panels=1",\s*authState\.token/);
  assert.match(app, /fetchAdminPaginatedRows\("\/api\/properties\?status=all", headers, \{ limit: 100, maxPages: 1 \}\)/);
  assert.doesNotMatch(app, /fetchAdminPaginatedRows\("\/api\/properties\?status=all", headers, \{ maxPages: 500 \}\)/);
  assert.match(app, /const ADMIN_SNAPSHOT_PANEL_TIMEOUT_MS = 8000/);
  assert.match(app, /Promise\.race\(\[\s*requestFn\(\)/);
  assert.match(app, /fetchAdminPaginatedRows\("\/api\/admin\/properties\/live", headers, \{ limit: 100, maxPages: 1 \}\)/);
  assert.match(app, /fetchAdminPaginatedRows\("\/api\/admin\/properties\/actioned\?include_total=0", headers, \{ limit: 100, maxPages: 1 \}\)/);
  assert.match(app, /hydrateStaffReviewQueueFallback\(userIdentityAtStart\)/);
  assert.match(app, /mergedData\?\.review_queue_meta\?\.query_ok !== true/);
  assert.match(app, /\/api\/staff\/properties\?status=pending&limit=24&include_total=0/);
  assert.match(app, /Moderation rows loaded through the protected fast queue\./);
  assert.match(app, /remoteValue == null \? "—" : remoteValue/);
  assert.match(app, /const liveMetric = \(value, localValue = 0\) => \{/);
  assert.match(app, /return selected == null \? "—" : Number\(selected\)/);
  assert.match(app, /remoteSnap \? \[\] : buildLocalAdminAreaInsights/);

  assert.match(migration, /idx_properties_staff_visible_order_v2/);
  assert.match(migration, /updated_at DESC NULLS LAST/);
  assert.match(html, /k24-intake-integrity-20260803/);
  assert.match(html, /k25-moderation-queue-recovery-20260803/);
});
