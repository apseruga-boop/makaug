'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const svc = require('../services/hotelbedsSupplyService');

const ON = {
  SHORT_TERM_ENABLED: 'true',
  HOTELBEDS_ENABLED: 'true',
  HOTELBEDS_API_KEY: 'test-key',
  HOTELBEDS_SECRET: 'test-secret'
};

test('partner supply is dark unless it is switched on explicitly', () => {
  assert.equal(svc.partnerSupplyEnabled({}), false, 'default must be off');
  assert.equal(
    svc.partnerSupplyEnabled({ HOTELBEDS_ENABLED: 'true' }), false,
    'it must not come on while the section itself is off'
  );
  assert.equal(
    svc.partnerSupplyEnabled({ SHORT_TERM_ENABLED: 'true' }), false,
    'the section being on must not drag partner supply on with it'
  );
  assert.equal(svc.partnerSupplyEnabled(ON), true);

  // Turning the section off is the whole rollback, so it must take this too.
  assert.equal(
    svc.partnerSupplyEnabled({ ...ON, SHORT_TERM_ENABLED: 'false' }), false,
    'SHORT_TERM_ENABLED=false must switch partner supply off as well'
  );
});

test('partner rows only ever fill an empty result', () => {
  // THE RULE THIS EXISTS FOR: makaug's promise is that every listing carries
  // the host's own phone number. A Hotelbeds row has no host. The moment
  // partner rows appear NEXT TO host rows that promise stops being true of the
  // page, so they are a fallback and never a peer.
  assert.equal(svc.shouldOfferPartnerSupply([], ON), true, 'an empty search may fall back');
  assert.equal(svc.shouldOfferPartnerSupply(0, ON), true, 'a zero count may fall back');

  assert.equal(
    svc.shouldOfferPartnerSupply([{ id: 1 }], ON), false,
    'one host result must be enough to suppress partner rows entirely'
  );
  assert.equal(svc.shouldOfferPartnerSupply(3, ON), false);

  // And never when it is off or unconfigured, whatever the result count.
  assert.equal(svc.shouldOfferPartnerSupply([], {}), false);
  assert.equal(
    svc.shouldOfferPartnerSupply([], { SHORT_TERM_ENABLED: 'true', HOTELBEDS_ENABLED: 'true' }),
    false,
    'it must not offer partner supply with no credentials configured'
  );
});

test('credentials are read from the environment and never hard-coded', () => {
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'services', 'hotelbedsSupplyService.js'),
    'utf8'
  );
  assert.ok(
    !/['"][A-Za-z0-9]{28,}['"]/.test(source),
    'a long literal in this file looks like a committed key'
  );
  assert.ok(source.includes('env.HOTELBEDS_API_KEY'), 'the key must come from the environment');
  assert.ok(source.includes('env.HOTELBEDS_SECRET'), 'the secret must come from the environment');

  assert.equal(svc.isConfigured({}), false);
  assert.equal(svc.isConfigured({ HOTELBEDS_API_KEY: 'k' }), false, 'a key alone is not enough');
  assert.equal(svc.isConfigured(ON), true);
});

test('the request signature is per-request and matches their scheme', () => {
  // Hotelbeds: SHA-256 of apiKey + secret + unix seconds, valid for a short
  // window. A cached signature starts failing a few seconds later.
  const at = 1700000000;
  const expected = require('node:crypto')
    .createHash('sha256').update('test-key' + 'test-secret' + at).digest('hex');
  assert.equal(svc.signature(ON, at), expected);
  assert.notEqual(svc.signature(ON, at), svc.signature(ON, at + 1), 'it must change with the clock');
  assert.equal(svc.signature({}), null, 'unconfigured must not produce a signature');
});

test('only Uganda is ever requested', () => {
  assert.equal(svc.COUNTRY_CODE, 'UG');
  // The evaluation quota is small and makaug has no use for other countries.
  assert.ok(svc.MAX_HOTELS_PER_REQUEST <= 100, 'the evaluation plan is rate limited');
});

test('the test environment is the default', () => {
  assert.match(svc.baseUrl({}), /api\.test\.hotelbeds\.com/);
  assert.match(svc.baseUrl({ HOTELBEDS_ENV: 'live' }), /^https:\/\/api\.hotelbeds\.com/);
  assert.match(svc.baseUrl({ HOTELBEDS_ENV: 'anything-else' }), /api\.test\.hotelbeds\.com/);
});

test('a partner row never claims to be a host listing', () => {
  // This sample is copied from a real sandbox response for Uganda, not from
  // the documentation. The first version of this test used destinationName
  // and zoneName, which this API does not return - so it agreed with the bug
  // and every row rendered with a blank location.
  const card = svc.toListingCard({
    code: 172359,
    name: { content: 'Kampala Serena Hotel' },
    city: { content: 'KAMPALA' },
    address: { content: 'P.O. Box 7814', street: 'P.O. Box 7814' },
    categoryCode: '5EST',
    coordinates: { latitude: 0.31861, longitude: 32.58639 },
    web: 'https://www.serenahotels.com/kampala',
    images: [
      { imageTypeCode: 'HAB', path: '17/172359/172359a_hb_w_001.jpg', visualOrder: 40 },
      { imageTypeCode: 'GEN', path: '17/172359/172359a_hb_f_002.jpg', visualOrder: 822 }
    ]
  });

  assert.equal(card.is_private_listing, false, 'it must not present as a private host');
  assert.equal(card.host_phone, null, 'there is no host to ring - it must not invent one');
  assert.equal(card.host_name, null);
  assert.equal(card.source, 'hotelbeds', 'the origin must be traceable');
  assert.ok(card.reference.startsWith('hb-'), 'ids must be namespaced against host listings');

  assert.equal(card.title, 'Kampala Serena Hotel');
  assert.equal(card.latitude, 0.31861);

  // "KAMPALA" is how it arrives. Shouting it on a card is not acceptable.
  assert.equal(card.district, 'Kampala', 'the city must be normalised, not echoed in caps');

  // The address on these records is a PO box. A PO box is not an area, and
  // showing one is worse than showing nothing.
  assert.equal(card.area, null, 'a PO box must never be presented as an area');

  assert.equal(card.star_rating, 5, '5EST is a five star hotel');

  // GEN is the general exterior view - the picture someone recognises the
  // place by - and it must win even though its visualOrder is worse.
  assert.equal(card.primary_image, svc.PHOTO_BASE + '17/172359/172359a_hb_f_002.jpg',
    'the general view must be preferred over a room shot');

  // No makaug detail page: a makaug URL implies makaug stands behind the stay.
  assert.equal(card.url, null);
  assert.equal(card.external_only, true);
  // But the card still needs somewhere honest to send a visitor.
  assert.equal(card.external_url, 'https://www.serenahotels.com/kampala');

  // Price comes from the rate APIs, not content. Null is "on request", and it
  // must never default to 0, which would render as free.
  assert.equal(card.price_per_night, null);
});

test('the mapping degrades rather than inventing', () => {
  // Not every record carries every field, and a half-filled card must not
  // produce "undefined" or a broken image on the page.
  const bare = svc.toListingCard({ code: 1, name: { content: 'Small Guest House' } });
  assert.equal(bare.title, 'Small Guest House');
  assert.equal(bare.district, '', 'a missing city must be empty, never "undefined"');
  assert.equal(bare.primary_image, null, 'no images must mean no image, not a broken path');
  assert.equal(bare.star_rating, null, 'unrated must be null, not 0');
  assert.equal(bare.external_url, null);
  assert.equal(bare.latitude, null);

  // A non-https website must not be passed through into an href.
  assert.equal(svc.toListingCard({ web: 'javascript:alert(1)' }).external_url, null,
    'only http(s) may reach an href');
  assert.equal(svc.toListingCard({ web: 'serenahotels.com' }).external_url, null,
    'a scheme-less string is not a safe link');

  // Codes without a leading digit are simply unrated.
  assert.equal(svc.starRating('LL'), null);
  assert.equal(svc.starRating('3EST'), 3);

  assert.equal(svc.titleCase('FORT PORTAL'), 'Fort Portal');
  assert.equal(svc.titleCase("JINJA"), 'Jinja');
});

// Only the fields that are used are requested. On a metered evaluation plan,
// asking for everything drags back rooms, facilities and wildcards for every
// hotel - a lot of payload for data that is never rendered.
test('the content request asks only for what is rendered', () => {
  const fields = svc.CONTENT_FIELDS.split(',');
  ['code', 'name', 'city', 'coordinates', 'images'].forEach((needed) => {
    assert.ok(fields.includes(needed), `${needed} is used but not requested`);
  });
  ['rooms', 'facilities', 'wildcards', 'boardCodes', 'segmentCodes'].forEach((unused) => {
    assert.ok(!fields.includes(unused), `${unused} is requested but never used`);
  });
  // And never the fields that do not exist on this response.
  ['destinationName', 'zoneName'].forEach((wrong) => {
    assert.ok(!fields.includes(wrong), `${wrong} is not returned by this API`);
  });
});

test('a missing exchange rate means no price, never a guessed one', async () => {
  // THE TRAP THIS EXISTS FOR: utils/propertyPriceCurrency.js only knows UGX
  // and USD on a Uganda site. Asking it for EUR falls through to the ZAR
  // defaults and returns 21, so EUR 155 would have rendered as UGX 3,255
  // instead of roughly 640,000 - wrong by a factor of two hundred, silently.
  //
  // A card with no price is a worse card. A card with a wrong price is a lie
  // about what a room costs.
  svc.__setFxForTests(0, 0);
  const rate = await svc.eurToUgxRate({ EUR_TO_UGX_RATE: '0' }, Date.now());
  assert.ok(rate === 0 || rate > 1000, 'a rate is either unusable or plausible, never small');
});

test('a pinned rate always beats the live one', async () => {
  svc.__setFxForTests(9999, Date.now());
  assert.equal(await svc.eurToUgxRate({ EUR_TO_UGX_RATE: '4200' }), 4200,
    'EUR_TO_UGX_RATE is the lever for pinning a rate deliberately');
  // Junk in the variable must not be trusted either.
  assert.equal(await svc.eurToUgxRate({ EUR_TO_UGX_RATE: 'abc' }), 9999);
  assert.equal(await svc.eurToUgxRate({ EUR_TO_UGX_RATE: '-5' }), 9999);
});

test('the markup is off unless it is switched on deliberately', () => {
  // Hotelbeds quotes NET rates to a merchant who collects the guest's money.
  // makaug does not: it links out to the hotel. A markup here is added to a
  // number makaug never collects, on a stay it never books, and the guest
  // sees the real price the moment they click through.
  assert.equal(svc.markupPercent({}), 0, 'the default must be zero');
  assert.equal(svc.markupPercent({ HOTELBEDS_MARKUP_PERCENT: '2' }), 2);
  assert.equal(svc.applyMarkup(300000, {}), 300000, 'no markup means the rate as quoted');
  assert.equal(svc.applyMarkup(300000, { HOTELBEDS_MARKUP_PERCENT: '2' }), 306000);

  // 200 is far likelier to be 2.00 mistyped than an intention, and it would
  // be charged to a guest.
  assert.equal(svc.markupPercent({ HOTELBEDS_MARKUP_PERCENT: '200' }), 25, 'capped');
  assert.equal(svc.markupPercent({ HOTELBEDS_MARKUP_PERCENT: '-3' }), 0, 'never negative');

  assert.equal(svc.applyMarkup(0, {}), null, 'a zero rate is no rate, not free');
  assert.equal(svc.applyMarkup('nonsense', {}), null);
});

test('a stay total is never shown as a nightly rate', () => {
  // minRate is the cheapest room for the WHOLE stay. Treating it as nightly
  // would treble the price on a three night search.
  assert.equal(svc.nightsBetween('2027-06-19', '2027-06-22'), 3);
  assert.equal(svc.nightsBetween('2027-06-19', '2027-06-20'), 1);
  // A check-out on or before check-in is not a stay.
  assert.equal(svc.nightsBetween('2027-06-19', '2027-06-19'), 0);
  assert.equal(svc.nightsBetween('2027-06-22', '2027-06-19'), 0);
  assert.equal(svc.nightsBetween('', ''), 0);
});

test('this service cannot make a booking', () => {
  // makaug's stated position, on every short term page, is that it does not
  // take bookings and does not handle money. Adding a booking call here is a
  // legal decision, not a technical one.
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'services', 'hotelbedsSupplyService.js'),
    'utf8'
  );
  assert.ok(!/\/bookings/.test(source), 'no booking endpoint may be called from here');
  assert.ok(!/checkRate|confirmBooking/i.test(source), 'no booking flow may live here');
  assert.deepEqual(
    Object.keys(module.exports || {}).filter((k) => /book/i.test(k)), [],
    'nothing booking-shaped may be exported'
  );
});
