#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'assets', 'makaug-app.js'), 'utf8');
const catalog = fs.readFileSync(path.join(root, 'services', 'advertisingCatalogService.js'), 'utf8');

assert(html.includes('data-advertising-placement-preview="20260910"'), 'advertising preview modal marker should render');
assert(html.includes('id="advertising-placement-preview-visual"'), 'preview modal should include a visual placement stage');
assert(html.includes('What this placement does'), 'preview modal should explain the selected placement');
assert(html.includes('Where it can appear'), 'preview modal should list selected placement locations');
assert(html.includes('Best for'), 'preview modal should explain the intended advertiser');
assert(html.includes('Example only:'), 'preview modal should distinguish the preview from an approved live position');
assert(html.includes('id="advertise-contact-whatsapp"'), 'advertise page should expose WhatsApp help');
assert(html.includes('WhatsApp 0760 112 587'), 'advertise page should show the WhatsApp number');
assert(html.includes('id="advertise-contact-email"'), 'advertise page should expose email help');
assert(html.includes('Email info@makaug.com'), 'advertise page should show the support email');
assert(html.includes('href="/advertiser-dashboard" onclick="return openAdvertiserDashboard(event)"'), 'advertiser dashboard action should use the auth-aware route handler');

assert(app.includes('function openAdvertisingPlacementPreview'), 'package preview action should be implemented');
assert(app.includes('function confirmAdvertisingPlacementPreview'), 'preview confirmation should preserve package selection');
assert(app.includes('function openAdvertiserDashboard'), 'advertiser dashboard button should be interactive');
assert(app.includes('openAuthSignIn("advertiser")'), 'signed-out dashboard users should enter advertiser sign-in');
assert(app.includes('advertising_placement_preview_opened'), 'preview opens should be tracked');
assert(app.includes('Preview where it appears'), 'every rendered package should include a preview action');

const packageCatalog = catalog.slice(0, catalog.indexOf('const ADVERTISING_PLACEMENTS'));
const packageKeys = Array.from(packageCatalog.matchAll(/\n\s{4}key: '([^']+)'/g), (match) => match[1]);
assert(packageKeys.length >= 10, 'advertising catalogue should expose the expected package range');
for (const key of packageKeys) {
  assert(app.includes(`${key}: {`), `preview content should cover advertising package ${key}`);
}

const aboutStart = html.indexOf('id="page-about"');
const aboutEnd = html.indexOf('id="about-discovery-title"', aboutStart);
const aboutProducts = html.slice(aboutStart, aboutEnd);
assert(aboutProducts.includes('data-about-product-images="20260910"'), 'About product imagery marker should render');
assert((aboutProducts.match(/class="about-product-image"/g) || []).length === 10, 'all ten About product cards should have images');
assert(aboutProducts.includes('class="about-advertising-image"'), 'Advertise with makaug summary should have an image');
assert(aboutProducts.includes('These options promote one property; broader brand and multi-channel campaigns sit under Advertise with makaug.'), 'About page should distinguish listing boosts from advertising campaigns');

const imagePaths = Array.from(aboutProducts.matchAll(/<img src="(\/assets\/[^"]+)"/g), (match) => match[1]);
for (const imagePath of imagePaths) {
  assert(fs.existsSync(path.join(root, imagePath.replace(/^\//, ''))), `About image should exist: ${imagePath}`);
}

console.log(`advertising placement previews passed (${packageKeys.length} packages, ${imagePaths.length} About images checked)`);
