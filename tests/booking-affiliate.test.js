'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  affiliateOffersFor,
  agodaSearchUrl,
  bookingLinkFor,
  bookingSearchUrl,
  fromTemplate,
  isConfigured
} = require('../services/bookingAffiliateService');

const CJ_LIVE = {
  BOOKING_AFFILIATE_ENABLED: 'true',
  CJ_PUBLISHER_PID: '101885222',
  BOOKING_CJ_AD_ID: '15735418'
};

const TP_LIVE = {
  TRAVELPAYOUTS_BOOKING_TEMPLATE: 'https://tp.media/r?marker=123456&p=4976&campaign_id=101&u={url}',
  TRAVELPAYOUTS_AGODA_TEMPLATE: 'https://tp.media/r?marker=123456&p=5873&campaign_id=102&u={url}'
};

const STAY = { q: 'Entebbe', check_in: '2026-11-10', check_out: '2026-11-13', guests: '3' };

test('nothing configured means no click-out at all', () => {
  assert.deepEqual(affiliateOffersFor(STAY, {}), []);
  assert.equal(bookingLinkFor(STAY, {}), null);
  assert.equal(isConfigured({}), false);
});

test('a pasted Travelpayouts template carries the visitor stay through', () => {
  const offers = affiliateOffersFor(STAY, TP_LIVE);
  assert.deepEqual(offers.map((o) => o.provider), ['booking.com', 'agoda']);
  offers.forEach((offer) => {
    assert.equal(offer.network, 'travelpayouts');
    assert.ok(offer.url.startsWith('https://tp.media/r?marker=123456&'));
    const inner = new URL(decodeURIComponent(offer.url.split('&u=')[1]));
    assert.equal(inner.toString(), offer.destination);
  });

  const booking = new URL(offers[0].destination);
  assert.equal(booking.hostname, 'www.booking.com');
  assert.equal(booking.searchParams.get('ss'), 'Entebbe, Uganda');
  assert.equal(booking.searchParams.get('checkin'), '2026-11-10');
  assert.equal(booking.searchParams.get('group_adults'), '3');

  const agoda = new URL(offers[1].destination);
  assert.equal(agoda.hostname, 'www.agoda.com');
  assert.equal(agoda.searchParams.get('text'), 'Entebbe, Uganda');
  assert.equal(agoda.searchParams.get('checkIn'), '2026-11-10');
  assert.equal(agoda.searchParams.get('adults'), '3');
});

test('a template with no {url} is used as pasted', () => {
  const offers = affiliateOffersFor(STAY, { TRAVELPAYOUTS_AGODA_TEMPLATE: 'https://tp.media/r?marker=123456&p=5873' });
  assert.equal(offers.length, 1);
  assert.equal(offers[0].url, 'https://tp.media/r?marker=123456&p=5873');
});

test('a malformed or insecure template is ignored, never rendered', () => {
  assert.equal(fromTemplate('tp.media/r?u={url}', 'https://x.test'), null);
  assert.equal(fromTemplate('http://tp.media/r?u={url}', 'https://x.test'), null);
  assert.equal(fromTemplate('javascript:alert(1)', 'https://x.test'), null);
  assert.equal(fromTemplate('   ', 'https://x.test'), null);
  assert.deepEqual(affiliateOffersFor(STAY, { TRAVELPAYOUTS_BOOKING_TEMPLATE: 'not a url' }), []);
});

test('CJ fills in for Booking.com only while Travelpayouts does not', () => {
  const cjOnly = affiliateOffersFor(STAY, CJ_LIVE);
  assert.deepEqual(cjOnly.map((o) => o.network), ['cj']);
  assert.ok(cjOnly[0].url.startsWith('https://www.dpbolvw.net/click-101885222-15735418?url='));

  const both = affiliateOffersFor(STAY, Object.assign({}, CJ_LIVE, TP_LIVE));
  assert.deepEqual(both.map((o) => o.network), ['travelpayouts', 'travelpayouts']);
  assert.equal(both.filter((o) => o.provider === 'booking.com').length, 1);
});

test('bad dates and parties are dropped rather than passed on', () => {
  const url = new URL(bookingSearchUrl({ check_in: '2026-11-13', check_out: '2026-11-10', guests: 'x' }));
  assert.equal(url.searchParams.get('ss'), 'Uganda');
  assert.equal(url.searchParams.get('checkin'), null);
  assert.equal(url.searchParams.get('group_adults'), '2');

  const agoda = new URL(agodaSearchUrl({ q: 'Jinja, Uganda', guests: 99 }));
  assert.equal(agoda.searchParams.get('text'), 'Jinja, Uganda');
  assert.equal(agoda.searchParams.get('adults'), '16');
});
