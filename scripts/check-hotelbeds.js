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
  COUNTRY_CODE
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
    + '?fields=code,name,coordinates,destinationName,zoneName'
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
  const withCoords = mapped.filter((c) => c.latitude != null).length;
  const withName = mapped.filter((c) => c.title).length;
  console.log('\nfield coverage in this sample:');
  console.log('  name:        ' + withName + '/' + mapped.length);
  console.log('  coordinates: ' + withCoords + '/' + mapped.length);
}

main().catch((error) => {
  console.error('UNEXPECTED: ' + scrub(error && error.stack));
  process.exitCode = 1;
});
