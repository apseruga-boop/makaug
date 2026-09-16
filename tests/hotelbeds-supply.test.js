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
  const card = svc.toListingCard({
    code: 12345,
    name: { content: 'Kampala Serena Hotel' },
    destinationName: { content: 'Kampala' },
    zoneName: 'Nakasero',
    coordinates: { latitude: 0.3213, longitude: 32.5811 }
  });

  assert.equal(card.is_private_listing, false, 'it must not present as a private host');
  assert.equal(card.host_phone, null, 'there is no host to ring - it must not invent one');
  assert.equal(card.host_name, null);
  assert.equal(card.source, 'hotelbeds', 'the origin must be traceable');
  assert.ok(card.reference.startsWith('hb-'), 'ids must be namespaced against host listings');

  // No makaug detail page: a makaug URL implies makaug stands behind the stay.
  assert.equal(card.url, null);
  assert.equal(card.external_only, true);

  // Price comes from the rate APIs, not content. Null is "on request", and it
  // must never default to 0, which would render as free.
  assert.equal(card.price_per_night, null);

  assert.equal(card.title, 'Kampala Serena Hotel');
  assert.equal(card.district, 'Kampala');
  assert.equal(card.latitude, 0.3213);
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
