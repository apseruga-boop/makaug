'use strict';

// ---------------------------------------------------------------------------
// Does LiteAPI have anything worth showing a Ugandan visitor?
//
// This script exists because of how the Hotelbeds integration went wrong. There
// I read the documentation, wrote the field mapping from it, and shipped rows
// that rendered completely blank - the response sends `city.content`, not the
// `destinationName` the docs implied. The test agreed with the bug because the
// test used my guessed shape too.
//
// So this one assumes nothing. It prints the ACTUAL keys the API returns and an
// actual Uganda count, and only then is there anything worth mapping. It is a
// discovery tool, not a health check: a failure here is information.
//
//   node scripts/check-liteapi.js
// ---------------------------------------------------------------------------

const BASE = 'https://api.liteapi.travel/v3.0';
const COUNTRY = 'UG';

function key() {
  return String(process.env.LITEAPI_KEY || '').trim();
}

// Nothing below prints a raw error body without passing through here. An API
// key in a log is an API key in a log, whoever is reading.
function scrub(text) {
  const k = key();
  let out = String(text == null ? '' : text);
  if (k) out = out.split(k).join('<api-key>');
  return out.replace(/\b[0-9a-f]{32,}\b/gi, '<redacted>');
}

async function get(path, params = {}) {
  const url = new URL(BASE + path);
  Object.keys(params).forEach((name) => {
    if (params[name] != null) url.searchParams.set(name, String(params[name]));
  });

  const response = await fetch(url, {
    headers: { accept: 'application/json', 'X-API-Key': key() }
  });

  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch (_error) {
    // Left null deliberately. A non-JSON body is itself the finding.
  }
  return { ok: response.ok, status: response.status, body, text };
}

// The interesting thing about an unfamiliar response is its shape, so this
// walks a couple of levels and reports keys and types rather than dumping
// megabytes of JSON nobody will read.
function shapeOf(value, depth = 0) {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    return value.length ? '[' + shapeOf(value[0], depth + 1) + ' x' + value.length + ']' : '[]';
  }
  if (typeof value !== 'object') {
    const sample = String(value);
    return typeof value + (depth > 0 && sample.length < 40 ? '(' + sample + ')' : '');
  }
  if (depth > 2) return '{...}';
  return '{' + Object.keys(value).slice(0, 14).map((k) => k + ': ' + shapeOf(value[k], depth + 1)).join(', ') + '}';
}

function rows(body) {
  // Every API spells its envelope differently. Rather than guess which one this
  // is, find the first array of objects and say where it was found.
  if (Array.isArray(body)) return { at: '(root)', list: body };
  if (!body || typeof body !== 'object') return { at: null, list: [] };
  const names = ['data', 'hotels', 'results', 'items', 'countries', 'cities'];
  for (const name of names) {
    if (Array.isArray(body[name])) return { at: name, list: body[name] };
  }
  for (const name of Object.keys(body)) {
    if (Array.isArray(body[name])) return { at: name, list: body[name] };
  }
  return { at: null, list: [] };
}

async function main() {
  if (!key()) {
    console.log('LITEAPI_KEY is not set. Nothing to check.');
    console.log('A sandbox key is free at dashboard.liteapi.travel/register - no card needed.');
    process.exit(1);
  }
  console.log('key: present (' + key().length + ' chars)\n');

  // 1. Does the key work at all? Cheapest possible call.
  const countries = await get('/data/countries');
  console.log('GET /data/countries -> ' + countries.status);
  if (!countries.ok) {
    console.log('  ' + scrub(countries.text).slice(0, 300));
    console.log('\nThe key is being refused, so nothing below would mean anything. Stopping.');
    process.exit(1);
  }
  const countryRows = rows(countries.body);
  console.log('  envelope: ' + shapeOf(countries.body));
  console.log('  list found under: ' + countryRows.at + ' (' + countryRows.list.length + ' entries)');
  const ug = countryRows.list.find((row) => JSON.stringify(row).includes('"UG"')
    || /uganda/i.test(JSON.stringify(row)));
  console.log('  Uganda present: ' + (ug ? 'yes -> ' + JSON.stringify(ug).slice(0, 160) : 'NO'));

  // 2. What is actually in Uganda? This is the question the whole thing turns
  //    on: if the answer is a handful of the same hotels Hotelbeds already
  //    gives us, this integration is not worth building.
  console.log('\n--- Uganda properties ---');
  const attempts = [
    { countryCode: COUNTRY, limit: 50 },
    { countryCode: COUNTRY },
    { country: COUNTRY, limit: 50 }
  ];

  let hotels = null;
  for (const params of attempts) {
    const result = await get('/data/hotels', params);
    console.log('GET /data/hotels ' + JSON.stringify(params) + ' -> ' + result.status);
    if (result.ok) { hotels = result; break; }
    console.log('  ' + scrub(result.text).slice(0, 200));
  }

  if (!hotels) {
    console.log('\nNo parameter spelling worked. The endpoint or its arguments differ from');
    console.log('what was assumed here - which is exactly why this runs before any mapping.');
    process.exit(1);
  }

  const hotelRows = rows(hotels.body);
  console.log('  list found under: ' + hotelRows.at);
  console.log('  count returned:   ' + hotelRows.list.length);

  if (!hotelRows.list.length) {
    console.log('\n  Nothing in Uganda. On a sandbox key that may only mean the test data set');
    console.log('  is small - but it is not evidence of coverage either way.');
    return;
  }

  // 3. The actual field names. This is the part that would have saved the
  //    Hotelbeds mapping.
  console.log('\n--- the real shape of one property ---');
  console.log(shapeOf(hotelRows.list[0]));
  console.log('\ntop-level keys: ' + Object.keys(hotelRows.list[0]).join(', '));

  console.log('\n--- a sample, to judge whether this is worth having ---');
  hotelRows.list.slice(0, 12).forEach((row) => {
    const name = row.name || row.hotelName || row.title || '(no name field)';
    const city = row.city || row.cityName || (row.address && row.address.city) || '';
    const kind = row.hotelType || row.propertyType || row.type || row.category || '';
    console.log('  - ' + name + (city ? '  [' + city + ']' : '') + (kind ? '  {' + kind + '}' : ''));
  });

  // 4. The question behind the question. Hotelbeds gave us 214 Uganda hotels
  //    and almost no apartments or guesthouses, and apartments are what a
  //    short-stay search is actually for.
  const blob = JSON.stringify(hotelRows.list).toLowerCase();
  console.log('\nself-catering signals in this sample:');
  ['apartment', 'guest house', 'guesthouse', 'hostel', 'lodge', 'villa', 'cottage']
    .forEach((word) => {
      const count = blob.split(word).length - 1;
      console.log('  ' + word.padEnd(12) + (count ? count : '-'));
    });
}

main().catch((error) => {
  console.error('failed: ' + scrub(error && error.message));
  process.exit(1);
});
