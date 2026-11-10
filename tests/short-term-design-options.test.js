'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const client = read('assets', 'short-term.js');
const options = read('assets', 'short-term-options.js');
const map = read('assets', 'makaug-app.js');
const css = read('assets', 'short-term-options.css');

assert.ok(client.includes('function designOption()'), 'design switch missing');
assert.ok(client.includes("view.innerHTML = searchViewHtml()"), 'the live search view must stay the default');
assert.ok(client.includes('makaugShortTermOptions.searchHtml'), 'options must replace the search view only when requested');
assert.ok(client.includes('syncDesignMap'), 'option pages must mount the shared map');
assert.ok(!/design=grid/.test(client.slice(client.indexOf('function searchViewHtml()'), client.indexOf('function cardHtml'))), 'the default search markup must not force an option');

assert.ok(options.includes('mountSharedListingMap'), 'options must call the shared listing map');
assert.ok(options.includes('shortStayPinForMap'), 'pins must use the shared short-stay pin shape');
assert.ok(options.includes('id="map-short-term"'), 'map host missing');
assert.ok(options.includes('listing-map-col'), 'map column must use the listing-page shell');
assert.ok(options.includes('data-map-card-id'), 'cards must hover the shared pins');
assert.ok(!/L\.tileLayer|L\.map\(/.test(options), 'options must not create their own map');
assert.ok(!/unsplash|placeholder\.com|picsum|stock/i.test(options + css), 'no stock photo sources');
assert.ok(options.includes('Found online') === false, 'the Found online label comes from the existing badge helper');
assert.ok(options.includes('helpers.badge'), 'source badge must be the existing one');
assert.ok(options.includes('paymentDirect'), 'payment line missing');
assert.ok(options.includes('perNight'), 'nightly price missing');
assert.ok(options.includes('name="guests"'), 'guests search missing');
assert.ok(options.includes('name="check_in"'), 'check-in missing');
assert.ok(options.includes('Preview · not approved'), 'pending rows need a preview label');
assert.ok(!/Makaug/.test(options), 'branding stays lowercase makaug');
assert.ok(options.includes("grid: 'Option A · photo grid'"));
assert.ok(options.includes("split: 'Option B · map split'"));
assert.ok(options.includes("list: 'Option C · compact list'"));

assert.ok(map.includes('map-short-term'), 'shared price-tag maps must accept the short-stay map');
assert.ok(map.includes('async function mountSharedListingMap'), 'shared map mount missing');
assert.ok(map.includes('window.mountSharedListingMap = mountSharedListingMap'));
const mountAt = map.indexOf('async function mountSharedListingMap');
const mountBody = map.slice(mountAt, mountAt + 1200);
assert.ok(mountBody.includes('L.tileLayer(OSM_TILE_URL'), 'shared tiles');
assert.ok(mountBody.includes('maxZoom: 18'), 'same tile zoom as the other listing maps');
assert.ok(mountBody.includes('setMapMarkers(mapId, rows || [])'), 'shared markers, clustering and popups');
assert.ok(!mountBody.includes('scrollWheelZoom'), 'do not override the listing-map controls');

const service = require('../services/shortTermService');
const quoted = service.quoteStay({ nightly_ugx: 170000, min_nights: 1, max_guests: 2 }, {
  checkIn: '2026-12-12', checkOut: '2026-12-15', guests: 2
});
assert.strictEqual(quoted.nights, 3);
assert.strictEqual(quoted.total_ugx, 510000);

assert.ok(css.includes('[data-st-design="grid"]'));
assert.ok(css.includes('[data-st-design="split"]'));
assert.ok(css.includes('[data-st-design="list"]'));

console.log('short-term design options: ok');
