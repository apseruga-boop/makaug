#!/usr/bin/env node
'use strict';

// Does the Hotelbeds connection actually work?
//
//   node scripts/check-hotelbeds.js
//
// Run it in the Render shell, where the credentials live. It makes one small
// Content API request for Uganda hotels and prints what came back.
//
// It never prints the API key or the secret, and it scrubs them out of any
// error text before that is printed either - an error body that echoes a
// request header is exactly how a key ends up in a log.

const {
  baseUrl,
  credentials,
  isConfigured,
  requestHeaders,
  toListingCard,
  CONTENT_FIELDS,
  COUNTRY_CODE,
  fetchRates,
  markupPercent
} = require('../services/hotelbedsSupplyService');

function scrub(text) {
  const { key, secret } = credentials();
  let out = String(text == null ? '' : text);
  if (key) out = out.split(key).join('<api-key>');
  if (secret) out = out.split(secret).join('<secret>');
  // Any 32+ hex run is a signature or a key; never worth printing.
  return out.replace(/\b[0-9a-f]{32,}\b/gi, '<redacted>');
}

async function main() {
  if (!isConfigured()) {
    console.error('NOT CONFIGURED - HOTELBEDS_API_KEY and HOTELBEDS_SECRET must both be set.');
    console.error('  key set:    ' + (credentials().key ? 'yes' : 'no'));
    console.error('  secret set: ' + (credentials().secret ? 'yes' : 'no'));
    process.exitCode = 1;
    return;
  }

  const base = baseUrl();
  const url = base
    + '/hotel-content-api/1.0/hotels'
    + '?fields=' + CONTENT_FIELDS
    + '&countryCode=' + COUNTRY_CODE
    + '&from=1&to=5&language=ENG';

  console.log('environment: ' + (base.includes('api.test.') ? 'test (sandbox)' : 'LIVE'));
  console.log('requesting:  ' + COUNTRY_CODE + ' hotels, first 5');

  let response;
  try {
    response = await fetch(url, { headers: requestHeaders() });
  } catch (error) {
    console.error('REQUEST FAILED: ' + scrub(error && error.message));
    process.exitCode = 1;
    return;
  }

  console.log('http status: ' + response.status);

  const raw = await response.text();
  if (!response.ok) {
    // 401/403 here almost always means the key and secret do not match, or the
    // clock is skewed - the signature is only valid for a short window.
    console.error('FAILED. Body:');
    console.error(scrub(raw).slice(0, 600));
    if (response.status === 401 || response.status === 403) {
      console.error('\n401/403 usually means the key and secret are mismatched,');
      console.error('or this machine\'s clock is off - the signature is time-based.');
    }
    process.exitCode = 1;
    return;
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch (error) {
    console.error('Response was not JSON:');
    console.error(scrub(raw).slice(0, 400));
    process.exitCode = 1;
    return;
  }

  const hotels = Array.isArray(body.hotels) ? body.hotels : [];
  console.log('total Uganda hotels: ' + (body.total == null ? 'unknown' : body.total));
  console.log('returned in this page: ' + hotels.length);

  if (!hotels.length) {
    console.log('\nConnected, but Uganda returned nothing. On the evaluation plan the');
    console.log('sandbox carries a limited demo portfolio, so this can be normal -');
    console.log('it is a commercial question, not a broken integration.');
    return;
  }

  console.log('\nMapped through toListingCard(), which is what the section would show:');
  hotels.slice(0, 5).forEach((hotel) => {
    const card = toListingCard(hotel);
    console.log('  - ' + (card.title || '(no name)')
      + '  [' + [card.area, card.district].filter(Boolean).join(', ') + ']'
      + (card.latitude == null ? '  (no coordinates)' : '  ' + card.latitude + ',' + card.longitude));
  });

  // The fields that decide whether a row is usable on a map and in a card.
  const mapped = hotels.map(toListingCard);
  const count = (predicate) => mapped.filter(predicate).length;
  console.log('\nfield coverage in this sample:');
  console.log('  name:        ' + count((c) => c.title) + '/' + mapped.length);
  console.log('  coordinates: ' + count((c) => c.latitude != null) + '/' + mapped.length);
  console.log('  district:    ' + count((c) => c.district) + '/' + mapped.length);
  console.log('  photo:       ' + count((c) => c.primary_image) + '/' + mapped.length);
  console.log('  own website: ' + count((c) => c.external_url) + '/' + mapped.length);
  console.log('  stars:       ' + count((c) => c.star_rating != null) + '/' + mapped.length);

  // ---------------------------------------------------------------------
  // Rates. The Content API has none; this is the Booking API availability
  // call, and it is the one that decides whether a partner card can carry a
  // price at all.
  // ---------------------------------------------------------------------
  const checkIn = isoDaysFromNow(30);
  const checkOut = isoDaysFromNow(33);
  console.log('\nrates for ' + checkIn + ' to ' + checkOut + ', 2 adults:');
  console.log('markup configured: ' + markupPercent() + '%'
    + (markupPercent() === 0 ? '  (none - showing the rate as quoted)' : ''));

  const rates = await fetchRates({
    hotelCodes: hotels.map((h) => h.code),
    checkIn,
    checkOut
  });

  const keys = Object.keys(rates);
  if (!keys.length) {
    console.log('  none returned.');
    console.log('  On the evaluation plan the generic key carries no pricing or');
    console.log('  commission rules, so this is expected until the account is');
    console.log('  certified. It is a commercial step, not a code problem.');
    return;
  }
  keys.forEach((key) => {
    const rate = rates[key];
    const card = mapped.find((c) => c.reference === key);
    console.log('  ' + (card ? card.title : key)
      + ': ' + rate.currency + ' ' + rate.per_night + '/night'
      + '  (' + rate.nights + ' nights, total ' + rate.total + ')');
  });
}

function isoDaysFromNow(days) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}

main().catch((error) => {
  console.error('UNEXPECTED: ' + scrub(error && error.stack));
  process.exitCode = 1;
});
