'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const client = read('assets/short-term.js');
const options = read('assets/short-term-options.js');
const app = read('assets/makaug-app.js');
const index = read('index.html');

test('the short-stay search page reuses the looking-for-property form after the results grid', () => {
  assert.match(options, /id="st-results"/);
  assert.match(options, /id="st-lead-slot"/);
  assert.ok(options.indexOf('id="st-results"') < options.indexOf('id="st-lead-slot"'), 'lead form sits after the results slot');
  assert.match(client, /function shortStayLeadFormHtml/);
  assert.match(client, /function fillShortStayPageExtras/);
  assert.match(client, /fillShortStayPageExtras\(\)/);
  assert.match(client, /submitMapAssistRequest\('short_term'\)/);
  assert.match(client, /data-map-assist-submit="short_term"/);
  assert.match(client, /data-map-assist-name="short_term"/);
  assert.match(client, /data-map-assist-checkin="short_term"/);
  assert.match(client, /data-map-assist-checkout="short_term"/);
  assert.match(client, /data-map-assist-guests="short_term"/);
  assert.match(client, /data-map-assist-budget="short_term"/);
  assert.ok(client.includes("Can't find what you're looking for?") || client.includes("Can't find what you\\'re looking for?") || /Can\\?'t find what you\\?'re looking for\?/.test(client));
  assert.match(client, /Tell makaug what you need/);
  assert.match(app, /apiRequest\("\/api\/contact\/looking-for-property"/);
  assert.match(app, /listingType = normalized === "students" \? "student" : normalized/);
  assert.match(app, /Budget per night/);
  assert.match(app, /Check-in: \$\{checkIn\}/);
  assert.match(app, /Guests: \$\{guests\}/);
  assert.match(app, /short_term: "short stays"/);
  assert.doesNotMatch(client, /routes\/whatsapp/);
});

test('the coming-to-Uganda guide is on the live options layout, open, and uses AI photos', () => {
  assert.match(options, /id="st-worth-slot"/);
  assert.ok(options.indexOf('id="st-lead-slot"') < options.indexOf('id="st-worth-slot"'));
  assert.match(client, /function guestInfoBlock/);
  assert.match(client, /<article class="st-info-card st-info-tile">/);
  assert.doesNotMatch(client, /<details class="st-info-card/);
  assert.match(client, /type="image\/webp"/);
  assert.match(client, /\/assets\/img\/uganda-guide\//);
  assert.match(client, /esc\(img\) \+ '\.webp/);
  assert.match(client, /esc\(img\) \+ '\.jpg/);
  assert.match(client, /st-info-btn/);
  assert.doesNotMatch(client, /st-photo-credit/); // one AI-photo note (gNote) only
  assert.doesNotMatch(client, /Wikimedia Commons/);
  for (const slug of ['visa', 'money', 'transport', 'power', 'tax', 'tourism']) {
    const webp = path.join(root, 'assets/img/uganda-guide', `${slug}.webp`);
    const jpg = path.join(root, 'assets/img/uganda-guide', `${slug}.jpg`);
    assert.ok(fs.existsSync(webp), `missing ${slug}.webp`);
    assert.ok(fs.existsSync(jpg), `missing ${slug}.jpg`);
  }
});

test('photoCredit is translated in all nine languages and no longer credits Wikimedia', () => {
  const at = client.indexOf('var ST_I18N =');
  const open = client.indexOf('{', at);
  const close = client.indexOf('\n};', open);
  const table = JSON.parse(client.slice(open, close + 2));
  const langs = ['en', 'lg', 'sw', 'ac', 'ny', 'rn', 'sm', 'am', 'ar'];
  langs.forEach((code) => {
    assert.ok(table[code].photoCredit, `missing photoCredit in ${code}`);
    assert.doesNotMatch(table[code].photoCredit, /Wikimedia/);
  });
  assert.match(table.en.photoCredit, /AI-generated/);
  langs.filter((code) => code !== 'en').forEach((code) => {
    assert.notEqual(table[code].photoCredit, table.en.photoCredit, `${code} photoCredit is still English`);
  });
});

test('short-stay lead form labels exist in all nine site languages', () => {
  const at = app.indexOf('const SHORT_STAY_LEAD_LABELS_I18N =');
  assert.ok(at > 0, 'SHORT_STAY_LEAD_LABELS_I18N is missing');
  const open = app.indexOf('{', at);
  let depth = 0;
  let close = -1;
  for (let i = open; i < app.length; i += 1) {
    if (app[i] === '{') depth += 1;
    else if (app[i] === '}') {
      depth -= 1;
      if (depth === 0) { close = i; break; }
    }
  }
  const table = Function(`return (${app.slice(open, close + 1)})`)();
  const langs = ['lg', 'sw', 'ac', 'ny', 'rn', 'sm', 'am', 'ar'];
  const keys = [
    'Budget per night (USh)',
    'Check-in',
    'Check-out',
    'Guests',
    'Apartment',
    'Guest house',
    'Cottage',
    'Whole house',
    'Hotel or serviced apartment'
  ];
  langs.forEach((code) => {
    assert.ok(table[code], `missing ${code}`);
    keys.forEach((key) => {
      assert.ok(table[code][key], `${code} is missing ${key}`);
      assert.notEqual(table[code][key], key, `${code} left ${key} in English`);
    });
  });
  assert.match(app, /LISTING_LABEL_I18N_SUPPLEMENTAL\[lang\] \|\|= \{\}, labels\)/);
});

test('short-stay pin labels are USh 150k/night, POA, or never a bare currency', () => {
  assert.match(app, /function shortStayNightlyFromRow/);
  assert.match(app, /function shortStayPinForMap/);
  assert.match(app, /Never show a bare currency/);

  const sandbox = {
    Number,
    String,
    Boolean,
    Math,
    Date,
    JSON,
    console,
    window: {},
    translateListingLabel(text) { return text; },
    formatCompact(v) {
      const amount = Number(v);
      if (!Number.isFinite(amount)) return '';
      if (Math.abs(amount) >= 1000) return `${Math.round(amount / 1000)}k`;
      return String(Math.round(amount));
    },
    listingUgxToday(p) { return Number(p?.price) || 0; },
    normalizeType(v) { return String(v || ''); },
    fxRateToUgx() { return 1; },
    activeCur: 'UGX',
    CURRENCY_SYMBOLS: { UGX: 'USh ' }
  };
  vm.createContext(sandbox);

  const nightlyAt = app.indexOf('function shortStayNightlyFromRow');
  const pinEnd = app.indexOf('async function fetchHomeMapPins');
  assert.ok(nightlyAt > 0 && pinEnd > nightlyAt);
  vm.runInContext(app.slice(nightlyAt, pinEnd), sandbox);

  const tagAt = app.indexOf('function mapTagPriceText');
  const tagEnd = app.indexOf('function mapMiniCardHtml');
  vm.runInContext(app.slice(tagAt, tagEnd), sandbox);

  const live = JSON.parse(fs.readFileSync('/tmp/st-search.json', 'utf8')).listings;
  const wouldHaveShownBareUgx = [];
  live.forEach((row) => {
    const parsed = sandbox.shortStayNightlyFromRow(row);
    const pin = sandbox.shortStayPinForMap(row);
    const label = sandbox.mapTagPriceText(pin);
    assert.doesNotMatch(label, /^(UGX|USh|USH)\s*$/i, `${row.title} pin was ${label}`);
    if (parsed.poa) {
      assert.equal(label, 'POA', `${row.id} should be POA, got ${label}`);
      assert.equal(pin.price_on_application, true);
    } else {
      assert.match(label, /^USh \S+\/night$/, `${row.id} should be USh …/night, got ${label}`);
    }
    // A pin built from currency + empty amount, or nightly_display "UGX"
    // with a null nightly_ugx and no POA flag, used to read "UGX".
    const rawDisplay = String(row.nightly_display || '').trim();
    const bare = rawDisplay === 'UGX' || rawDisplay === 'USh'
      || ((row.nightly_ugx == null || Number(row.nightly_ugx) <= 0) && !row.price_on_application && rawDisplay.startsWith('UGX') && !/\d/.test(rawDisplay));
    if (bare || ((row.nightly_ugx == null || Number(row.nightly_ugx) <= 0) && !row.price_on_application && rawDisplay !== 'POA')) {
      wouldHaveShownBareUgx.push(row);
    }
  });

  // Live search: every stay with no nightly amount is already flagged POA
  // or labelled "POA", so the broken path is the one that ignored that flag
  // (map pins omit price_on_application; shortStayPinForMap used to look only
  // at nightly_ugx and then a formatter could emit a bare currency).
  const poaLive = live.filter((row) => row.price_on_application === true || row.nightly_display === 'POA' || !(Number(row.nightly_ugx) > 0));
  assert.ok(poaLive.length >= 1, 'expected live POA stays to audit');
  poaLive.forEach((row) => {
    const pin = sandbox.shortStayPinForMap({ ...row, price_on_application: undefined });
    assert.equal(sandbox.mapTagPriceText(pin), 'POA');
  });

  assert.equal(sandbox.mapTagPriceText({ price: 150000, period: 'night', listing_type: 'short_term' }), 'USh 150k/night');
  assert.equal(sandbox.mapTagPriceText({ price: 0, period: 'night', price_on_application: true }), 'POA');
  assert.equal(sandbox.shortStayNightlyFromRow({ nightly_display: 'UGX' }).poa, true);
  assert.equal(sandbox.shortStayNightlyFromRow({ nightly_ugx: null, nightly_display: 'UGX 150,000' }).amount, 150000);

  // Legacy paintMap must not concatenate "UGX " with an empty amount.
  assert.match(client, /label \? 'USh ' \+ esc\(label\) \+ '\/night' : 'POA'/);
  assert.doesNotMatch(client, /'UGX ' \+ esc\(label \|\| '•'\)/);
});

test('cache-bust versions were bumped with this change', () => {
  assert.match(index, /short-term\.js\?v=20261110-st-lead-guide/);
  assert.match(index, /short-term-options\.js\?v=20261110-st-lead-guide/);
  assert.match(index, /short-term-options\.css\?v=20261110-st-lead-guide/);
  assert.match(index, /short-term\.css\?v=20261110-st-lead-guide/);
});
