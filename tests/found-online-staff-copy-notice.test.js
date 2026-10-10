'use strict';

/**
 * P2 (10 Oct 2026), MK-20261009-1B005F: staff's Preview & edit description
 * came back with "Found on TikTok from tiktok.com. Check the original post
 * before paying." appended. The reviewed copy is now returned unchanged and the
 * safety line is a separate found_online_notice, shown in the source panel.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  buildThirdPartyPublicTitle,
  buildThirdPartyPublicSummary,
  foundOnlinePublicNotice
} = require('../services/publicListingCopy');
const { publicPropertyRow, compactPublicCardRow } = require('../routes/properties')._test;
const { publicListingPayload } = require('../utils/publicListingPayload');

const TITLE = 'House for sale in Akright City';
const DESCRIPTION = '6-bedroom, 7-bathroom house for sale in Akright City (Akright Estate), Bwebajja, off Entebbe Road. Two living rooms, air conditioning, self-contained staff quarters.\nSits on 25 decimals with a private mailo land title.';
const NOTICE = 'Found on TikTok. Check the original post before paying.' /* C15c: no bare-domain name */;

const reviewed = {
  id: '56ec3ed3-3962-4aa1-aea1-4bf333279083',
  title: TITLE,
  description: DESCRIPTION,
  listing_type: 'sale',
  property_type: 'house',
  area: 'Akright City',
  district: 'Wakiso',
  status: 'approved',
  source: 'social_search',
  listed_via: 'found_online',
  extra_fields: {
    found_online: true,
    source_platform: 'TikTok',
    source_name: 'tiktok.com',
    staff_corrected_fields: ['title', 'description']
  }
};

test('reviewed copy comes back unchanged and the notice is a separate field', () => {
  assert.equal(buildThirdPartyPublicTitle(reviewed, reviewed.extra_fields), TITLE);
  assert.equal(buildThirdPartyPublicSummary(reviewed, reviewed.extra_fields), DESCRIPTION);
  assert.equal(foundOnlinePublicNotice(reviewed, reviewed.extra_fields), NOTICE);

  const row = publicListingPayload(publicPropertyRow(reviewed, []));
  assert.equal(row.title, TITLE);
  assert.equal(row.description, DESCRIPTION, 'description exactly as staff saved it');
  assert.doesNotMatch(row.description, /Check the original post before paying/);
  assert.equal(row.found_online_notice, NOTICE, 'the notice survives the public whitelist');
  assert.deepEqual(row.public_copy_reviewed, { title: true, description: true });
});

test('list and card rows carry the notice too', () => {
  const card = compactPublicCardRow({ ...reviewed, admin_extra_fields: reviewed.extra_fields });
  assert.equal(card.description, DESCRIPTION);
  assert.equal(card.found_online_notice, NOTICE);
});

test('unreviewed found-online rows keep the makaug template, plus the notice', () => {
  const raw = { ...reviewed, extra_fields: { found_online: true, source_platform: 'TikTok', source_name: 'tiktok.com' } };
  const row = publicPropertyRow(raw, []);
  assert.match(row.description, /is a third-party property result/);
  assert.equal(row.found_online_notice, NOTICE);
});

test('owner and agent listings have no notice', () => {
  const owner = { id: 'aaaaaaaa-0000-4000-8000-0000000000bb', title: 'Two bedroom flat in Ntinda', description: 'Owner text.', listing_type: 'rent', area: 'Ntinda', district: 'Kampala', status: 'approved', source: 'website', listed_via: 'website', extra_fields: {} };
  const row = publicPropertyRow(owner, []);
  assert.equal(row.found_online_notice, null);
  assert.equal(row.description, 'Owner text.');
});

test('the property page renders the notice in its own block, and the SPA source panel shows it', () => {
  const seo = require('../services/publicSeoRenderService');
  const listing = { id: reviewed.id, listing_type: 'sale', title: TITLE, description: DESCRIPTION, found_online_notice: NOTICE, area: 'Akright City', district: 'Wakiso', price: 2000000000 };
  const rendered = seo.renderPropertySeoHtml('<html><head><title>x</title></head><body><div id="detail-content"></div><footer></footer></body></html>', listing, { baseUrl: 'https://makaug.com' });
  assert.match(rendered.html, new RegExp(`data-found-online-notice>${NOTICE.replace(/\./g, '\\.')}</section>`));
  assert.ok(!rendered.html.includes(`${DESCRIPTION.split('\n')[0]}\n\n${NOTICE}`));
  const app = fs.readFileSync(path.join(__dirname, '../assets/makaug-app.js'), 'utf8');
  assert.match(app, /\$\{p\.found_online_notice \? `<div class="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-900" data-found-online-notice="1">/);
  assert.match(app, /const reviewedDescription = p\?\.public_copy_reviewed\?\.description === true/);
});

test.after(async () => {
  try { await require('../config/database').pool.end(); } catch (_) {}
});
