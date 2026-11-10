'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { plotSaleBeatsStudentWords } = require('../utils/listingCategorySignals');
const { deriveListingClassification } = require('../utils/listingDataIntegrity');
const { normalizeFoundOnlineSourcePost } = require('../services/socialSearchSourcedListingsService');
const { tidyCreatorListingTitle, buildThirdPartyPublicTitle } = require('../services/publicListingCopy');

const CAPTION = 'BUGEMA HOSTEL ESTATE – PLOTS FOR SALE • Plot Size: 50×100 ft • Land Tenure: Ready Land Title • Price: UGX 40M • Suitable For: Hostels, Residential Development & Investment';
const SOURCE_TITLE = '50x100Fts Plots for sale in Bugema Gayaza for 40Million';

test('a plot for sale beats hostel in an estate name or a suitable-for line', () => {
  assert.equal(plotSaleBeatsStudentWords(`${SOURCE_TITLE} ${CAPTION}`), true);
  assert.equal(plotSaleBeatsStudentWords('Prime Kyambogo Plot for Sale – 25 Decimals'), true);
  assert.equal(plotSaleBeatsStudentWords('Plots of 50x100 fts near campus, good for hostels'), true);
  assert.equal(plotSaleBeatsStudentWords('Hostel room for rent near Makerere per semester'), false);
  assert.equal(plotSaleBeatsStudentWords('Luxury 5 bedroom duplex for sale near the university'), false);
});

test('the Bugema plots post is imported as land and keeps the creator title', () => {
  const post = normalizeFoundOnlineSourcePost({
    title: SOURCE_TITLE,
    caption: CAPTION,
    description: CAPTION,
    source_title: SOURCE_TITLE,
    platform: 'youtube',
  });
  assert.equal(post.listingType, 'land');
  assert.equal(post.title, SOURCE_TITLE);
  assert.doesNotMatch(post.title, /Student accommodation/i);
});

test('a stored student label still reclassifies when the source title is a plot sale', () => {
  const classification = deriveListingClassification({
    title: 'Student accommodation in Uganda',
    listing_type: 'student',
    description: CAPTION,
    extra_fields: { source_title: SOURCE_TITLE, source_caption: CAPTION },
  });
  assert.equal(classification.listing_type, 'land');
  assert.equal(classification.physical_type, 'land');
  assert.equal(classification.category_ambiguous, false);
});

test('preview and public copy tidy the creator title instead of a student template', () => {
  const property = {
    title: 'Student accommodation in Uganda',
    listing_type: 'student',
    property_type: 'Land',
    area: 'Gayaza',
    district: 'Wakiso',
    source: 'found_online_property_source_v1',
    listed_via: 'found_online',
  };
  const extra = { found_online: true, source_title: SOURCE_TITLE, source_caption: CAPTION, youtube_source_title: SOURCE_TITLE };
  assert.equal(tidyCreatorListingTitle(property, extra), SOURCE_TITLE);
  assert.equal(buildThirdPartyPublicTitle(property, extra), SOURCE_TITLE);
});

test('the editor and the review form keep that order', () => {
  const app = fs.readFileSync(path.join(__dirname, '../assets/makaug-app.js'), 'utf8');
  const staff = fs.readFileSync(path.join(__dirname, '../routes/staff.js'), 'utf8');
  const typeFn = app.slice(app.indexOf('function adminReviewListingTypeFromText'), app.indexOf('function adminReviewBuildConciseDescription'));
  assert.match(typeFn, /adminReviewPlotSaleBeatsStudent\(text\)/);
  assert.ok(typeFn.indexOf('adminReviewPlotSaleBeatsStudent') < typeFn.indexOf('return "student"'));
  const facts = app.slice(app.indexOf('function adminExtractReviewFacts'), app.indexOf('function adminReviewFactBadgesHtml'));
  assert.match(facts, /adminReviewCreatorTitle\(review\)/);
  assert.match(staff, /tidyCreatorListingTitle/);
  assert.doesNotMatch(staff.slice(staff.indexOf('function staffEditorTitle'), staff.indexOf('async function staffPreviewOcr')), /buildThirdPartyPublicTitle/);
});

test('migration 211 backs up affected rows and the rollback is separate', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../scripts/deferred-migrations/211_restore_plot_titles_and_category.sql'), 'utf8');
  const rollback = fs.readFileSync(path.join(__dirname, '../scripts/rollback-211-restore-plot-titles-and-category.sql'), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS plot_title_restore_211_backup/);
  assert.match(sql, /before_row jsonb NOT NULL/);
  assert.match(sql, /staff_corrected_fields/);
  assert.match(sql, /plots\?\|acres\?\|decimals\?/);
  assert.match(sql, /category_title_restore_211/);
  assert.doesNotMatch(sql, /DELETE FROM properties/);
  assert.match(sql, /MK-20261109-9F68D2/);
  assert.match(rollback, /Not run by scripts\/migrate\.js/);
  assert.match(rollback, /before_row->>'title'/);
  assert.match(rollback, /updated_at = b\.applied_at/);
  assert.doesNotMatch(rollback, /DELETE FROM properties/);
});

test('migration 216 only creates the backup table and stays off the boot path', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../db/migrations/216_restore_plot_titles_and_category.sql'), 'utf8');
  const runner = fs.readFileSync(path.join(__dirname, '../scripts/run-plot-title-restore-216.js'), 'utf8');
  const rollback = fs.readFileSync(path.join(__dirname, '../scripts/rollback-216-restore-plot-titles-and-category.sql'), 'utf8');
  const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

  assert.match(sql, /CREATE TABLE IF NOT EXISTS plot_title_restore_216_backup/);
  assert.match(sql, /lock_timeout = '3s'/);
  assert.match(sql, /statement_timeout = '15s'/);
  assert.match(sql, /MK-20261109-9F68D2/);
  assert.doesNotMatch(sql, /UPDATE properties/);
  assert.doesNotMatch(sql, /DISABLE TRIGGER/);
  assert.doesNotMatch(sql, /DELETE FROM properties/);

  assert.match(runner, /LIMIT \$1/);
  assert.match(runner, /SET LOCAL lock_timeout/);
  assert.match(runner, /SET LOCAL statement_timeout/);
  assert.match(runner, /plot_title_restore_216_backup/);
  assert.match(runner, /category_title_restore_216/);
  assert.match(runner, /staff_corrected_fields/);
  assert.match(runner, /plots\?\|acres\?\|decimals\?/);
  assert.match(runner, /MK-20261109-9F68D2/);
  assert.match(runner, /runBackgroundWork/);
  assert.doesNotMatch(runner, /ALTER TABLE\s+properties\s+DISABLE TRIGGER/);
  assert.doesNotMatch(runner, /DELETE FROM properties/);

  assert.match(rollback, /Not run by scripts\/migrate\.js/);
  assert.match(rollback, /before_row->>'title'/);
  assert.match(rollback, /updated_at = b\.applied_at/);
  assert.doesNotMatch(rollback, /DELETE FROM properties/);
  assert.doesNotMatch(rollback, /ALTER TABLE\s+\w+\s+DISABLE TRIGGER/);

  assert.match(server, /runPlotTitleRestore216/);
  assert.match(server, /scheduleStartupDataRepairs/);
});
