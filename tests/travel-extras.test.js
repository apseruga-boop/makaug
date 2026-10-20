'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');
const travelpayouts = require('../services/travelpayoutsAffiliate');
const flags = require('../utils/shortTermFeatureFlags');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const client = read('assets/short-term.js');

function grab(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  let depth = 0;
  for (let i = source.indexOf(') {', start) + 2; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(name);
}

const PLACE = /entebbe|kampala|uganda|\bEBB\b/i;

test('travel extras stay hidden until a partner program id is set', () => {
  const empty = travelpayouts.extrasConfig({});
  assert.equal(empty.enabled, false);
  assert.deepEqual(empty.groups, []);
  assert.deepEqual(travelpayouts.extraLinks({ marker: '', groups: empty.groups }), []);

  const campaignOnly = travelpayouts.extrasConfig({
    TRAVELPAYOUTS_MARKER: 'marker-from-env',
    TRAVELPAYOUTS_KIWITAXI_CAMPAIGN_ID: '66'
  });
  assert.equal(campaignOnly.enabled, false);
  assert.deepEqual(campaignOnly.groups, []);

  const hotelsOnly = travelpayouts.publicConfig({
    TRAVELPAYOUTS_MARKER: 'marker-from-env',
    TRAVELPAYOUTS_KIWITAXI_PROGRAM_ID: '55',
    TRAVELPAYOUTS_KIWITAXI_CAMPAIGN_ID: '66',
    TRAVELPAYOUTS_AGODA_PROGRAM_ID: '11'
  });
  assert.deepEqual(hotelsOnly.brands.map((brand) => brand.key), ['agoda']);
  assert.deepEqual(travelpayouts.BRAND_DEFS.map((brand) => brand.key), ['agoda', 'booking', 'trip']);
});

test('travel extra links use the env marker, campaign id and a Uganda destination', () => {
  const env = { TRAVELPAYOUTS_MARKER: 'marker-from-env' };
  travelpayouts.EXTRA_GROUPS.forEach((group) => {
    group.partners.forEach((partner) => {
      assert.match(partner.url, PLACE, partner.key);
      assert.match(partner.programEnv, /^TRAVELPAYOUTS_[A-Z0-9_]+_PROGRAM_ID$/);
      assert.match(partner.campaignEnv, /^TRAVELPAYOUTS_[A-Z0-9_]+_CAMPAIGN_ID$/);
      env[partner.programEnv] = `p-${partner.key}`;
    });
  });
  env.TRAVELPAYOUTS_KIWITAXI_CAMPAIGN_ID = '66';

  const config = travelpayouts.extrasConfig(env);
  assert.equal(config.enabled, true);
  const keys = config.groups.flatMap((group) => group.partners.map((partner) => partner.key));
  assert.deepEqual(keys, [
    'kiwitaxi', 'welcome_pickups', 'gettransfer',
    'airalo', 'yesim', 'saily',
    'klook', 'kkday', 'tiqets',
    'localrent', 'economybookings',
    'kiwi', 'aviasales'
  ]);

  const links = travelpayouts.extraLinks({
    marker: config.marker,
    groups: config.groups,
    subId: 'st_extra_short-term'
  });
  assert.equal(links.length, keys.length);
  links.forEach((link) => {
    assert.match(link.href, /^https:\/\/tp\.media\/r\?/);
    assert.match(link.href, /marker=marker-from-env/);
    assert.match(link.href, /(?:^|&)p=/);
    assert.equal(link.href.includes('785967'), false);
    assert.match(decodeURIComponent(link.href), PLACE);
  });
  const kiwiTaxi = links.find((link) => link.key === 'kiwitaxi');
  assert.match(kiwiTaxi.href, /campaign_id=66/);
  assert.match(kiwiTaxi.href, /sub_id=st_extra_short_term/);
  const airalo = links.find((link) => link.key === 'airalo');
  assert.equal(airalo.href.includes('campaign_id='), false);
});

test('the short-term block is empty without extras and sets rel on each link', () => {
  const label = client.slice(client.indexOf('var EXTRA_GROUP_LABEL'), client.indexOf('function fireAffiliateClick'));
  const sandbox = {
    window: { __makaugShortTerm: { travelpayouts: {} } },
    URLSearchParams,
    calls: []
  };
  vm.runInNewContext([
    'function t(key) {',
    '  var phrases = {',
    '    extrasTitle: "Travel extras for your stay",',
    '    extrasLead: "Opens on the partner site. makaug does not take the booking or the payment.",',
    '    extrasNote: "Affiliate links: MakaUG may earn a commission",',
    '    extrasTransfers: "Airport transfers"',
    '  };',
    '  return phrases[key] || key;',
    '}',
    grab(client, 'esc'),
    grab(client, 'sanitizeSubId'),
    grab(client, 'travelpayoutsConfig'),
    grab(client, 'trackedHref'),
    label,
    grab(client, 'fireAffiliateClick'),
    grab(client, 'travelExtrasHtml'),
    'this.api = { travelExtrasHtml: travelExtrasHtml, fireAffiliateClick: fireAffiliateClick };'
  ].join('\n'), sandbox);

  assert.equal(sandbox.api.travelExtrasHtml('short-term'), '');
  sandbox.window.__makaugShortTerm = {
    travelpayouts: { marker: 'marker-from-env', extras: [] }
  };
  assert.equal(sandbox.api.travelExtrasHtml('short-term'), '');

  sandbox.window.__makaugShortTerm = {
    travelpayouts: {
      marker: 'marker-from-env',
      extras: [{
        key: 'transfers',
        partners: [{
          key: 'kiwitaxi',
          label: 'Kiwitaxi',
          programId: '55',
          campaignId: '66',
          url: 'https://kiwitaxi.com/en/uganda/entebbe'
        }]
      }]
    }
  };
  const html = sandbox.api.travelExtrasHtml('short-term-listing');
  assert.match(html, /Travel extras for your stay/);
  assert.match(html, /Affiliate links: MakaUG may earn a commission/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="sponsored nofollow noopener"/);
  assert.match(html, /data-st-extra="kiwitaxi"/);
  assert.match(html, /data-st-extra-placement="short-term-listing"/);
  assert.match(html, /marker=marker-from-env/);
  assert.match(html, /campaign_id=66/);
  assert.match(decodeURIComponent(html), /kiwitaxi\.com\/en\/uganda\/entebbe/);
  assert.equal(html.includes('785967'), false);

  const expected = travelpayouts.extraLinks({
    marker: 'marker-from-env',
    groups: sandbox.window.__makaugShortTerm.travelpayouts.extras,
    subId: 'st_extra_short-term-listing'
  });
  assert.ok(html.includes(expected[0].href.replace(/&/g, '&amp;')));

  sandbox.fireClientGaEvent = (name, params) => sandbox.calls.push([name, params]);
  sandbox.api.fireAffiliateClick('kiwitaxi', 'short-term-listing');
  assert.equal(JSON.stringify(sandbox.calls), JSON.stringify([['affiliate_click', { partner: 'kiwitaxi', placement: 'short-term-listing' }]]));
});

test('extras are on the short-term pages, not inside compare prices, and not hard-coded', () => {
  assert.match(client, /travelExtrasHtml\('short-term'\)/);
  assert.match(client, /travelExtrasHtml\('short-term-listing'\)/);
  assert.match(client, /rel="sponsored noopener"/);
  assert.match(client, /fireClientGaEvent\('affiliate_click'/);
  assert.equal(client.includes('785967'), false);
  const compare = grab(client, 'compareButtonsHtml');
  assert.equal(compare.includes('travelExtrasHtml'), false);
  assert.equal(compare.includes('nofollow'), false);

  const hidden = flags.injectShortTermRuntimeConfig('<html><head></head></html>', {
    SHORT_TERM_ENABLED: 'true',
    TRAVELPAYOUTS_MARKER: 'marker-from-env'
  });
  assert.match(hidden, /"extras":\[\]/);

  const shown = flags.injectShortTermRuntimeConfig('<html><head></head></html>', {
    SHORT_TERM_ENABLED: 'true',
    TRAVELPAYOUTS_MARKER: 'marker-from-env',
    TRAVELPAYOUTS_AIRALO_PROGRAM_ID: '77'
  });
  assert.match(shown, /"key":"airalo"/);
  assert.doesNotMatch(shown, /"key":"kiwitaxi"/);
  assert.equal(shown.includes('785967'), false);

  const langs = ['ac', 'am', 'ar', 'en', 'lg', 'ny', 'rn', 'sm', 'sw'];
  assert.equal((client.match(/"extrasTitle":/g) || []).length, langs.length);
  for (const lang of ['lg', 'sw', 'ac', 'ny', 'rn', 'sm', 'am', 'ar']) {
    const pack = JSON.parse(read(`assets/i18n/site-${lang}.json`));
    const title = pack.phrases['Travel extras for your stay'];
    const note = pack.phrases['Affiliate links: MakaUG may earn a commission'];
    assert.ok(title && title !== 'Travel extras for your stay', lang);
    assert.ok(note && note !== 'Affiliate links: MakaUG may earn a commission', lang);
  }
});
