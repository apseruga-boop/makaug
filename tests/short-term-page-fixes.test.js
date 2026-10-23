'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const travelpayouts = require('../services/travelpayoutsAffiliate');
const flags = require('../utils/shortTermFeatureFlags');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('affiliate links use the env marker and hide brands with no program id', () => {
  const empty = travelpayouts.publicConfig({});
  assert.equal(empty.marker, '');
  assert.equal(empty.enabled, false);
  assert.equal(empty.driveEnabled, false);
  assert.equal(travelpayouts.trackedLink({ marker: '', programId: '1', url: 'https://www.booking.com' }), '');

  const config = travelpayouts.publicConfig({
    TRAVELPAYOUTS_MARKER: 'marker-from-env',
    TRAVELPAYOUTS_AGODA_PROGRAM_ID: '11',
    TRAVELPAYOUTS_BOOKING_PROGRAM_ID: '',
    TRAVELPAYOUTS_TRIP_PROGRAM_ID: '33',
    TRAVELPAYOUTS_TRIP_CAMPAIGN_ID: '44'
  });
  assert.equal(config.enabled, true);
  assert.deepEqual(config.brands.map((brand) => brand.key), ['agoda', 'trip']);

  const links = travelpayouts.compareLinks({
    marker: config.marker,
    brands: config.brands,
    hotelName: 'Speke Hotel',
    checkIn: '2026-11-01',
    checkOut: '2026-11-03',
    adults: 2,
    subId: travelpayouts.hotelSubId('la-speke', 'eago')
  });
  assert.equal(links.length, 2);
  assert.match(links[0].href, /^https:\/\/tp\.media\/r\?/);
  assert.match(links[0].href, /marker=marker-from-env/);
  assert.match(links[1].href, /campaign_id=44/);
  assert.match(links[1].href, /sub_id=st_hotel_la_speke_eago/);
  assert.match(decodeURIComponent(links[0].href), /agoda\.com\/search/);
  assert.equal(travelpayouts.trafficExtra({ ref: 'eago', utm_source: 'ads' }), 'eago');
  assert.equal(travelpayouts.trafficExtra({ utm_source: 'ads' }), 'ads');
});

test('the drive snippet is off unless TRAVELPAYOUTS_DRIVE_ENABLED is on', () => {
  assert.equal(travelpayouts.driveHeadSnippet({}), '');
  const html = travelpayouts.driveHeadSnippet({ TRAVELPAYOUTS_DRIVE_ENABLED: 'true' });
  assert.match(html, /id="makaug-tp-drive"/);
  assert.match(html, /emrldtp\.cc\/NTgxODU0\.js\?t=581854/);
  assert.match(html, /data-cookie-consent/);
  assert.doesNotMatch(html, /785967/);
});

test('the live marker is not hard-coded and the public Drive tag follows TRAVELPAYOUTS_DRIVE_ENABLED', () => {
  const server = read('server.js');
  const client = read('assets/short-term.js');
  const bundled = [server, client, read('utils/shortTermFeatureFlags.js'), read('services/travelpayoutsAffiliate.js')].join('\n');
  assert.equal(bundled.includes('785967'), false);
  const shortTermRoute = server.slice(server.indexOf("app.get('/short-term'"), server.indexOf("app.get('/short-term/list-your-place'"));
  assert.equal(shortTermRoute.length > 0, true);
  assert.equal(server.split('driveHeadSnippet()').length, 1);
  assert.match(server, /rendered = injectTravelpayoutsDriveHeadTag\(rendered, normalizedBasePath\)/);
  assert.match(server, /drivePublicHeadTag\(process\.env\)/);
  assert.match(server, /TRAVELPAYOUTS_DRIVE_PROJECT_ID/);
  assert.doesNotMatch(server, /const TRAVELPAYOUTS_DRIVE_HEAD_TAG|emrldtp\.cc\/NTgxODU0/);
  assert.match(client, /if \(!cfg\.driveEnabled \|\| currentPath\(\) !== '\/short-term'\) return;/);
  assert.match(client, /travelpayoutsDriveScriptSrc\(cfg\.driveProjectId\)/);
  assert.doesNotMatch(client, /var DRIVE_SRC = /);
  const hotelAt = server.indexOf("app.get('/short-term/hotel/:slug'");
  const listAt = server.indexOf("app.get('/short-term/list-your-place'");
  const slugAt = server.indexOf("app.get('/short-term/:slug'");
  assert.ok(listAt < hotelAt && hotelAt < slugAt);
  const slugHandler = server.slice(slugAt, slugAt + 2500);
  assert.match(slugHandler, /sendPublicNotFound\(req, res\)/);
});

test('short-term runtime config carries affiliate brands and the public WhatsApp number', () => {
  const html = flags.injectShortTermRuntimeConfig('<html><head></head></html>', {
    SHORT_TERM_ENABLED: 'true',
    TRAVELPAYOUTS_MARKER: 'marker-from-env',
    TRAVELPAYOUTS_AGODA_PROGRAM_ID: '11',
    MAKAUG_WHATSAPP_NUMBER: '+256780863394',
    TRAVELPAYOUTS_DRIVE_ENABLED: 'true'
  });
  assert.match(html, /"marker":"marker-from-env"/);
  assert.match(html, /"whatsappNumber":"256780863394"/);
  assert.match(html, /"driveEnabled":true/);
  assert.doesNotMatch(html, /emrldtp\.cc/);
});

test('titles, one landing page view, and short-stay ask-ai stay on this section', () => {
  const app = read('assets/makaug-app.js');
  assert.match(app, /hasOwnDocumentTitle = \/\^\\\/short-term/);
  assert.match(app, /function skipDuplicateLandingPageView/);
  assert.match(app, /landingAnalyticsPageViewSkipped/);
  assert.match(app, /page === "short-term" && \/\^\\\/short-term/);
  assert.match(app, /searchIntent === "search_short_term"/);
  assert.match(app, /window\.makaugShortTerm\?\.search/);
  const ai = read('routes/ai.js');
  assert.match(ai, /effectiveIntent = 'search_short_term'/);
  assert.match(ai, /searchShortTermListings\(db/);
});

test('host listings can store an optional UTB licence and a map pin', () => {
  const migration = read('db/migrations/151_short_term_utb_licence.sql');
  assert.match(migration, /utb_licence_number/);
  const service = read('services/shortTermService.js');
  assert.match(service, /utb_licence_number/);
  const client = read('assets/short-term.js');
  assert.match(client, /id="f-bedrooms"/);
  assert.match(client, /for="f-bedrooms">Bedrooms/);
  assert.match(client, /for="f-beds">Beds/);
  assert.match(client, /for="f-bathrooms">Bathrooms/);
  assert.match(client, /id="st-pin-map"/);
  assert.match(client, /function stepErrors/);
  assert.match(client, /No places in \{town\} yet|emptyTown/);
  assert.match(client, /data-whatsapp-static="true"/);
  assert.match(client, /Hotels in Kampala & Entebbe|hotelsFallback/);
  assert.match(client, /st_affiliate_click/);
  assert.match(client, /st_request_click/);
  assert.match(client, /rel="sponsored noopener"/);
  assert.match(client, /history: false/);
  const footer = read('index.html');
  assert.match(footer, /id="footer-link-short-term"/);
  assert.match(footer, /data-short-term-entry/);
});
