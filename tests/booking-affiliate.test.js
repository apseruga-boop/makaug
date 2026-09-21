'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  bookingLinkFor,
  bookingSearchUrl,
  isConfigured
} = require('../services/bookingAffiliateService');

const LIVE = {
  BOOKING_AFFILIATE_ENABLED: 'true',
  CJ_PUBLISHER_PID: '101885222',
  BOOKING_CJ_AD_ID: '15735418'
};

test('dark unless all three env vars are set', () => {
  assert.equal(isConfigured({}), false);
  assert.equal(isConfigured({ ...LIVE, BOOKING_AFFILIATE_ENABLED: 'false' }), false);
  assert.equal(isConfigured({ ...LIVE, BOOKING_CJ_AD_ID: '' }), false);
  assert.equal(isConfigured({ ...LIVE, CJ_PUBLISHER_PID: 'abc' }), false);
  assert.equal(bookingLinkFor({ q: 'Kampala' }, {}), null);
  assert.equal(isConfigured(LIVE), true);
});

test('builds a CJ tracked deep link to the same Booking.com search', () => {
  const link = bookingLinkFor({ q: 'Entebbe', check_in: '2026-10-01', check_out: '2026-10-04', guests: '3' }, LIVE);
  assert.ok(link.url.startsWith('https://www.dpbolvw.net/click-101885222-15735418?url='));
  assert.ok(link.url.endsWith('&sid=makaug-short-term'));
  const inner = new URL(decodeURIComponent(link.url.split('?url=')[1].split('&sid=')[0]));
  assert.equal(inner.hostname, 'www.booking.com');
  assert.equal(inner.searchParams.get('ss'), 'Entebbe, Uganda');
  assert.equal(inner.searchParams.get('checkin'), '2026-10-01');
  assert.equal(inner.searchParams.get('checkout'), '2026-10-04');
  assert.equal(inner.searchParams.get('group_adults'), '3');
  assert.equal(link.destination, inner.toString());
});

test('drops bad dates and defaults the party and place', () => {
  const url = new URL(bookingSearchUrl({ checkIn: '2026-10-05', checkOut: '2026-10-01', guests: 'x' }));
  assert.equal(url.searchParams.get('ss'), 'Uganda');
  assert.equal(url.searchParams.get('checkin'), null);
  assert.equal(url.searchParams.get('group_adults'), '2');
  const again = new URL(bookingSearchUrl({ q: 'Jinja, Uganda', guests: 99 }));
  assert.equal(again.searchParams.get('ss'), 'Jinja, Uganda');
  assert.equal(again.searchParams.get('group_adults'), '16');
});
