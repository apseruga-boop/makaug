'use strict';

/**
 * C15 (10 Oct 2026). (a) the sitemap hub lastmod and (b) the agent review flags
 * were already fixed (#388 follow-up and C3 #403); this covers (c): found-online
 * rows showed lister_name / source_name "tiktok.com" (e.g. 7918f050…, posted by
 * @cheap_apartments_uganda). A bare domain is never shown as a name.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { publicSourceAccountName, isBareDomainName } = require('../utils/sourceAccountName');

const EXTRA = {
  found_online: true,
  source_platform: 'TikTok',
  source_name: 'tiktok.com',
  source_agent_name: 'tiktok.com',
  source_channel_url: 'https://www.tiktok.com/@cheap_apartments_uganda',
  source_url: 'https://www.tiktok.com/@cheap_apartments_uganda/video/7691604548967763208'
};

test('a bare domain becomes the account handle, or "<Platform> account"', () => {
  assert.equal(isBareDomainName('tiktok.com'), true);
  assert.equal(isBareDomainName('www.facebook.com'), true);
  assert.equal(isBareDomainName('Konso Realty'), false);
  assert.equal(publicSourceAccountName('tiktok.com', EXTRA), '@cheap_apartments_uganda');
  assert.equal(publicSourceAccountName('Konso Realty', EXTRA), 'Konso Realty', 'a real name is kept');
  assert.equal(publicSourceAccountName('www.facebook.com', { source_url: 'https://www.facebook.com/KonsoRealty/posts/123' }), '@KonsoRealty');
  assert.equal(publicSourceAccountName('tiktok.com', { source_platform: 'TikTok' }), 'TikTok account');
});

test('the public property payload and the found-online notice never show "tiktok.com" as a name', () => {
  const { publicPropertyRow } = require('../routes/properties')._test;
  const row = publicPropertyRow({
    id: '7918f050-f8f3-407b-aabe-718de3deb2c8',
    listing_type: 'rent',
    title: '1-bedroom apartment for rent in Kyanja',
    description: 'Spacious 1-bedroom apartment in Kyanja.',
    status: 'approved',
    source: 'found_online_property_source_v1',
    lister_name: 'tiktok.com',
    price: 1000000,
    price_period: 'month',
    created_at: '2026-10-09T08:00:00.000Z',
    extra_fields: EXTRA
  }, []);
  assert.equal(row.lister_name, '@cheap_apartments_uganda');
  assert.equal(row.extra_fields.source_name, '@cheap_apartments_uganda');
  assert.equal(row.extra_fields.source_agent_name, '@cheap_apartments_uganda');
  assert.equal(row.found_online_notice, 'Found on TikTok from @cheap_apartments_uganda. Check the original post before paying.');
  assert.doesNotMatch(JSON.stringify({ lister: row.lister_name, notice: row.found_online_notice, s: row.extra_fields.source_name }), /tiktok\.com"/);
});

test('(a) and (b) stay fixed: hub lastmod is the newest listing, agent review flags are private', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const seo = fs.readFileSync(path.join(__dirname, '..', 'services', 'publicSeoService.js'), 'utf8');
  assert.match(seo, /\{ loc: `\$\{root\}\/`, lastmod: isoFromMs\(snapshot\?\.overallLastmod\)/);
  const { publicAgentPayload } = require('../utils/publicListingPayload');
  const agent = publicAgentPayload({ id: 'a', private_id_profile_reviewed: true, profile_claim_pending: true });
  assert.ok(!('private_id_profile_reviewed' in agent) && !('profile_claim_pending' in agent));
});
