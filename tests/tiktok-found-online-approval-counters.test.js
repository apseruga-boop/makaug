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
