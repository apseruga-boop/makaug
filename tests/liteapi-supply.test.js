'use strict';

// ---------------------------------------------------------------------------
// The fixtures below are REAL responses, copied off the live API, not shapes
// invented from documentation. That distinction is the whole point of this
// file: the Hotelbeds mapping was written from the docs, shipped rows that
// rendered completely blank, and had a test that agreed with the bug because
// the test used the same guessed shape.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert/strict');

const svc = require('../services/liteapiSupplyService');

const ON = {
  SHORT_TERM_ENABLED: 'true',
  LITEAPI_ENABLED: 'true',
  LITEAPI_KEY: 'test-key',
  USD_TO_UGX_RATE: '3700'
};

// Verbatim from GET /data/hotels?countryCode=UG
const REAL_PROPERTY = {
  id: 'lp1b57b1',
  primaryHotelId: null,
  name: 'Hilton Garden Inn Kampala',
  hotelDescription: 'A description.',
  hotelTypeId: 204,
  chainId: 2117,
  chain: 'Hilton Garden Inn',
  currency: 'USD',
  country: 'ug',
  city: 'Kampala',
  latitude: 0.337637,
  longitude: 32.584014,
  address: 'Plot 72 Kira Road',
  zip: '',
  main_photo: 'https://static.cupid.travel/hotels/483763771.jpg',
  thumbnail: 'https://static.cupid.travel/hotels/thumbnail/483763771.jpg',
  stars: 4,
  rating: 9.2,
  reviewCount: 528
};

// Verbatim from POST /hotels/rates
const REAL_RATES = {
  data: [{
    hotelId: 'lp1b57b1',
    roomTypes: [
      {
        roomTypeId: 'HE3DQ',
        supplier: 'nuitee',
        offerRetailRate: { amount: 359.41, currency: 'USD' },
        suggestedSellingPrice: { amount: 413.32, currency: 'USD', source: '' },
        offerInitialPrice: { amount: 359.41, currency: 'USD' },
        priceType: 'commission'
      },
      {
        roomTypeId: 'OTHER',
        offerRetailRate: { amount: 512.00, currency: 'USD' }
      }
    ]
  }]
};

function stubFetch(body, calls, status = 200) {
  return async (url, init) => {
    calls.push({ url: String(url), init: init || {} });
    return { ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) };
  };
}

test('partner supply is dark unless it is switched on explicitly', () => {
  assert.equal(svc.partnerSupplyEnabled({}), false, 'default must be off');
  assert.equal(
    svc.partnerSupplyEnabled({ LITEAPI_ENABLED: 'true' }), false,
    'it must not come on while the section itself is off'
  );
  assert.equal(
    svc.partnerSupplyEnabled({ SHORT_TERM_ENABLED: 'true' }), false,
    'the section being on must not drag partner supply on with it'
  );
  assert.equal(svc.partnerSupplyEnabled(ON), true);
});

test('partner rows only ever fill an empty result', () => {
  // One real host and they are gone. The hosts are the product; this is the
  // fallback, and a fallback that competes with the thing it backs up is a bug.
  assert.equal(svc.shouldOfferPartnerSupply([], ON), true);
  assert.equal(svc.shouldOfferPartnerSupply([{ id: 1 }], ON), false);
  assert.equal(svc.shouldOfferPartnerSupply(0, ON), true);
  assert.equal(svc.shouldOfferPartnerSupply(3, ON), false);
  // Credentials absent: nothing, whatever the host count.
  assert.equal(svc.shouldOfferPartnerSupply([], { SHORT_TERM_ENABLED: 'true', LITEAPI_ENABLED: 'true' }), false);
});

test('the card is built from the field names the API actually sends', () => {
  // Every assertion here corresponds to a key read off a live response. If
  // LiteAPI renames one, this fails loudly instead of rendering blank rows.
  const card = svc.toListingCard(REAL_PROPERTY);

  assert.equal(card.reference, 'la-lp1b57b1', 'namespaced so it cannot collide with a host id');
  assert.equal(card.source, 'liteapi');
  assert.equal(card.title, 'Hilton Garden Inn Kampala');
  assert.equal(card.district, 'Kampala');
  assert.equal(card.area, 'Plot 72 Kira Road', 'a real street address, unlike the Hotelbeds PO boxes');
  assert.equal(card.latitude, 0.337637);
  assert.equal(card.longitude, 32.584014);
  assert.equal(card.star_rating, 4);

  // Photos arrive in the content response. No second call, no assembling a
  // path by hand, no 404 on the one card that had a price.
  assert.equal(card.primary_image, 'https://static.cupid.travel/hotels/483763771.jpg');
  assert.equal(card.image_candidates.length, 2, 'main photo and thumbnail, so a dead one can fall back');

  // Hotelbeds had no equivalent of these two at all.
  assert.equal(card.review_score, 9.2);
  assert.equal(card.review_count, 528);
});

test('a partner row never claims to be a host listing', () => {
  const card = svc.toListingCard(REAL_PROPERTY);
  assert.equal(card.is_private_listing, false);
  assert.equal(card.url, null, 'a makaug URL would imply we stand behind the stay');
  assert.equal(card.external_only, true);
  // Null until enrichWithContact fills it. A row that never gets enriched must
  // be honest about having no number rather than inventing one.
  assert.equal(card.host_phone, null);
  assert.equal(card.host_name, null);
  assert.equal(card.price_per_night, null, 'a card with no price must not render as free');
});

test('the phone number is read off the property record', async () => {
  // This is what a LiteAPI row can do and a Hotelbeds row never could: carry
  // the property's own number, so the card behaves like every other row on
  // makaug - here is the place, here is the number, ring them yourself.
  const calls = [];
  const real = global.fetch;
  global.fetch = stubFetch({
    data: {
      id: 'lp1b57b1',
      phone: '+256 31 3800800',
      email: null,
      checkinCheckoutTimes: { checkin_start: '02:00 PM', checkout: '12:00 PM' }
    }
  }, calls);
  try {
    svc.__resetCachesForTests();
    const rows = [svc.toListingCard(REAL_PROPERTY)];
    await svc.enrichWithContact(rows, ON);
    assert.equal(rows[0].host_phone, '+256 31 3800800');
    assert.equal(rows[0].check_in_from, '02:00 PM');

    // Second pass must come from cache: one call per property per day, not per
    // request. This endpoint is metered and a landline does not move.
    await svc.enrichWithContact([svc.toListingCard(REAL_PROPERTY)], ON);
    assert.equal(calls.length, 1, 'the contact lookup is not being cached');
  } finally {
    global.fetch = real;
  }
});

test('a dateless search costs nothing and quotes nothing', async () => {
  // Prices are per stay. Without dates there is nothing true to put on a card,
  // and a made-up sample window would answer a question nobody asked while
  // spending a metered call to do it.
  const calls = [];
  const real = global.fetch;
  global.fetch = stubFetch(REAL_RATES, calls);
  try {
    assert.deepEqual(await svc.fetchRates({ hotelIds: ['lp1b57b1'], checkIn: '', checkOut: '', env: ON }), {});
    assert.deepEqual(await svc.fetchRates({ hotelIds: ['lp1b57b1'], checkIn: '2026-10-16', checkOut: '', env: ON }), {});
    assert.deepEqual(await svc.fetchRates({ hotelIds: [], checkIn: '2026-10-16', checkOut: '2026-10-19', env: ON }), {});
    assert.deepEqual(await svc.fetchRates({ hotelIds: ['lp1b57b1'], checkIn: '2026-10-16', checkOut: '2026-10-19', env: {} }), {});
    assert.equal(calls.length, 0, 'a dateless search must not reach the network');
  } finally {
    global.fetch = real;
  }
});

test('a stay total becomes a per-night price, in shillings', async () => {
  const calls = [];
  const real = global.fetch;
  global.fetch = stubFetch(REAL_RATES, calls);
  try {
    const rates = await svc.fetchRates({
      hotelIds: ['lp1b57b1'],
      checkIn: '2026-10-16',
      checkOut: '2026-10-19',
      env: ON
    });
    const rate = rates['la-lp1b57b1'];
    assert.ok(rate, 'no rate came back');

    assert.equal(rate.currency, 'UGX', 'the section prices in shillings');
    assert.equal(rate.nights, 3);
    // 359.41 over three nights at 3,700 - the cheaper of the two rooms, not
    // the first one in the array.
    assert.equal(rate.per_night, 443272);
    assert.equal(rate.total, 1329817);

    // Shown undivided it would read as 359; unconverted, as 120. Both are
    // numbers a guest would act on.
    assert.equal(rate.source_currency, 'USD');
    assert.equal(rate.source_total, 359.41);
    assert.equal(rate.fx_rate, 3700);
    assert.equal(rate.markup_percent, 0);

    assert.equal(calls.length, 1, 'one call for the whole batch');
    assert.equal(calls[0].init.method, 'POST');
  } finally {
    global.fetch = real;
  }
});

test('the retail rate is used, not the suggested selling price', async () => {
  // suggestedSellingPrice (413.32) is a marked-up figure meant for resellers.
  // offerRetailRate (359.41) is what a guest actually pays. makaug is not
  // reselling anything, so showing the reseller's number would be showing a
  // price nobody is charged.
  const real = global.fetch;
  global.fetch = stubFetch(REAL_RATES, []);
  try {
    const rates = await svc.fetchRates({
      hotelIds: ['lp1b57b1'], checkIn: '2026-10-16', checkOut: '2026-10-19', env: ON
    });
    assert.equal(rates['la-lp1b57b1'].source_total, 359.41, 'the suggested selling price leaked in');
  } finally {
    global.fetch = real;
  }
});

test('a currency that is not dollars produces no price, not a wrong one', async () => {
  const real = global.fetch;
  global.fetch = stubFetch({
    data: [{ hotelId: 'x', roomTypes: [{ offerRetailRate: { amount: 100, currency: 'EUR' } }] }]
  }, []);
  try {
    const rates = await svc.fetchRates({
      hotelIds: ['x'], checkIn: '2026-10-16', checkOut: '2026-10-19', env: ON
    });
    assert.deepEqual(rates, {}, 'an unconvertible quote must yield no price at all');
  } finally {
    global.fetch = real;
  }
});

test('a caller cannot write into the cache through the rows it gets', async () => {
  // This exact bug shipped on the Hotelbeds path and the suite stayed green
  // throughout: the route writes prices onto the rows it is about to send, and
  // handing out the cache's own objects meant one dated search stamped its
  // prices into the cache and every later search served them back - dateless
  // ones included, which is the one thing the dateless guard exists to prevent.
  const calls = [];
  const real = global.fetch;
  global.fetch = stubFetch({ data: [REAL_PROPERTY] }, calls);
  try {
    svc.__resetCachesForTests();
    const first = await svc.fetchUgandaProperties({ env: ON });
    assert.equal(first.length, 1);

    first[0].price_display = 'UGX 999,999';
    first[0].image_candidates.push('https://example.invalid/injected.jpg');

    const second = await svc.fetchUgandaProperties({ env: ON });
    assert.equal(calls.length, 1, 'the second call should have been served from cache');
    assert.equal(second[0].price_display, undefined, 'a price leaked into the cache');
    assert.ok(
      second[0].image_candidates.indexOf('https://example.invalid/injected.jpg') === -1,
      'the candidate list is shared by reference'
    );
    assert.notEqual(first[0], second[0], 'the same object is handed to every caller');
  } finally {
    global.fetch = real;
  }
});

test('a missing exchange rate means no price, never a guessed one', async () => {
  svc.__setFxForTests(0, 0);
  const rate = await svc.usdToUgxRate({ USD_TO_UGX_RATE: '0' }, Date.now());
  assert.ok(rate === 0 || rate > 1000, 'a rate is either unusable or plausible, never small');

  svc.__setFxForTests(9999, Date.now());
  assert.equal(await svc.usdToUgxRate({ USD_TO_UGX_RATE: '3800' }), 3800, 'a pinned rate wins');
  assert.equal(await svc.usdToUgxRate({ USD_TO_UGX_RATE: 'abc' }), 9999, 'junk is not trusted');
  assert.equal(await svc.usdToUgxRate({ USD_TO_UGX_RATE: '-5' }), 9999);
});

test('the markup is off unless it is switched on deliberately', () => {
  assert.equal(svc.markupPercent({}), 0, 'the default must be zero');
  assert.equal(svc.markupPercent({ LITEAPI_MARKUP_PERCENT: '2' }), 2);
  assert.equal(svc.markupPercent({ LITEAPI_MARKUP_PERCENT: '200' }), 25, 'capped - 200 is a typo, not an intention');
  assert.equal(svc.markupPercent({ LITEAPI_MARKUP_PERCENT: '-3' }), 0, 'never negative');
  assert.equal(svc.applyMarkup(300000, {}), 300000);
  assert.equal(svc.applyMarkup(0, {}), null, 'a zero rate is no rate, not free');
});

test('only Uganda is ever requested', () => {
  assert.equal(svc.COUNTRY, 'UG');
  assert.ok(svc.BASE.startsWith('https://'), 'credentials must not cross the wire in the clear');
});

test('this service cannot make a booking', () => {
  // makaug says on every page of this section that it does not take bookings
  // and does not handle money. The code should make that structurally true,
  // not merely promised in copy.
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'services', 'liteapiSupplyService.js'), 'utf8'
  );
  assert.ok(!/rates-book|\/book\b|prebook/i.test(source), 'a booking call has appeared in this service');
  assert.ok(!/LITEAPI_KEY\s*=\s*['"][A-Za-z0-9]{20,}/.test(source), 'a key has been hard-coded');
});
