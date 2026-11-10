'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const client = read('assets', 'short-term.js');
const options = read('assets', 'short-term-options.js');
const map = read('assets', 'makaug-app.js');
const service = require('../services/shortTermService');

assert.ok(client.includes('makaugShortTermOptions.searchHtml(optionHelpers())'), 'the photo grid is the search page');
assert.ok(client.includes('makaugShortTermOptions.detailHtml(payload, optionHelpers())'), 'the map detail is the stay page');
assert.ok(!client.includes('designOption'), 'the design switch is gone');
assert.ok(!/Option C|compact list|st-opt-list/.test(options), 'the compact list option is gone');
assert.ok(!options.includes('?design='), 'the page must not depend on a design query');

assert.ok(options.includes('mountSharedListingMap'), 'the stay and search maps use the shared listing map');
assert.ok(options.includes('id="map-short-term"'));
assert.ok(!/L\.tileLayer|L\.map\(/.test(options), 'the short-stay file must not build its own map');
assert.ok(!/wa\.me\/\d/.test(options), 'no phone number is hardcoded in the page');
assert.ok(!/tel:\+\d/.test(options), 'no tel number is hardcoded in the page');
assert.ok(options.includes('blocksDirectContact'), 'imported stays are blocked before a link is built');
assert.ok(options.includes('Found online'));
assert.ok(options.includes('See original post'));
assert.ok(!options.includes('>Original post</a>'));
assert.ok(options.includes('Request these dates'));
assert.ok(options.includes('Request stay'));
assert.ok(options.includes('paymentDirect'));

const mountAt = map.indexOf('async function mountSharedListingMap');
const mountBody = map.slice(mountAt, mountAt + 900);
assert.ok(mountBody.includes('L.tileLayer(OSM_TILE_URL'));
assert.ok(mountBody.includes('setMapMarkers(mapId, rows || [])'));

const sandbox = { window: {}, document: { getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; } }, fetch() { return Promise.resolve(); }, encodeURIComponent, URLSearchParams, Date, Number, String, isFinite, Math };
vm.createContext(sandbox);
vm.runInContext(options, sandbox);
const message = sandbox.window.makaugShortTermOptions.stayMessage({
  title: 'Garden flat',
  reference: 'ST-000003',
  url: '/short-term/garden-flat'
}, '2026-12-12', '2026-12-15', '2');
assert.strictEqual(message, service.buildStayWhatsAppMessage({
  title: 'Garden flat',
  reference: 'ST-000003',
  url: 'https://makaug.com/short-term/garden-flat',
  checkIn: '2026-12-12',
  checkOut: '2026-12-15',
  guests: 2
}));
const open = sandbox.window.makaugShortTermOptions.stayMessage({
  title: 'Garden flat',
  reference: 'ST-000003',
  url: '/short-term/garden-flat'
}, '', '', '');
assert.strictEqual(open, service.buildStayWhatsAppMessage({
  title: 'Garden flat',
  reference: 'ST-000003',
  url: 'https://makaug.com/short-term/garden-flat'
}));


const helpers = {
  esc(value) { return String(value == null ? '' : value); },
  t(key) { return key; },
  qs() { return {}; },
  badge() { return { label: 'Found online', approved: false }; },
  stayDayStrip() { return ''; },
  quoteHtml() { return ''; },
  availabilityHtml() { return ''; }
};
const withSource = sandbox.window.makaugShortTermOptions.detailHtml({
  listing: {
    title: 'Bunga stay',
    source: 'imported',
    found_online: true,
    do_not_message: true,
    source_url: 'https://www.tiktok.com/@example/video/1',
    url: '/short-term/bunga-one-bedroom-stay-st-000003',
    nightly_display: 'USh 150k'
  },
  quote: null,
  availability: null
}, helpers);
assert.match(withSource, /See original post/);
assert.match(withSource, /https:\/\/www\.tiktok\.com\/@example\/video\/1/);
assert.doesNotMatch(withSource, /Request these dates|Request a callback|Ask a question/);

const noSource = sandbox.window.makaugShortTermOptions.detailHtml({
  listing: {
    title: 'Kisaasi stay',
    source: 'imported',
    found_online: true,
    do_not_message: true,
    source_url: '',
    url: '/short-term/kisaasi-short-stay-st-000002',
    nightly_display: 'POA'
  },
  quote: null,
  availability: null
}, helpers);
assert.match(noSource, /Found online/);
assert.match(noSource, /No original post is listed for this stay/);
assert.doesNotMatch(noSource, /See original post|Request these dates|Request a callback|Ask a question|st-enquire-open|st-intent-tabs/);

const hostedVideo = sandbox.window.makaugShortTermOptions.detailHtml({
  listing: {
    title: 'Kisaasi stay',
    source: 'imported',
    found_online: true,
    source_url: 'https://media.makaug.com/whatsapp-employee-intake/video/1791'
  },
  quote: null,
  availability: null
}, helpers);
assert.doesNotMatch(hostedVideo, /See original post|media\.makaug\.com|Request these dates/);


assert.strictEqual(service.publicSourceUrl({ extra_fields: { source_url: 'https://www.tiktok.com/@example/video/1' } }), 'https://www.tiktok.com/@example/video/1');
assert.strictEqual(service.publicSourceUrl({ extra_fields: { source_post_url: 'https://www.youtube.com/watch?v=abcdefghijk' } }), 'https://www.youtube.com/watch?v=abcdefghijk');
assert.strictEqual(service.publicSourceUrl({ extra_fields: { video_urls: ['https://media.makaug.com/whatsapp-employee-intake/video/1791'] } }), null);
assert.strictEqual(service.publicSourceUrl({ extra_fields: { source_url: 'https://media.makaug.com/whatsapp-employee-intake/video/1791' } }), null);

console.log('short-term design options: ok');
