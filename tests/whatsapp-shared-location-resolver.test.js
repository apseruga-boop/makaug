'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  canonicalizeWhatsappSearchFilters,
  canonicalWhatsappLocationPatch,
  resolveWhatsappLocation,
  whatsappLocationPrompt
} = require('../services/whatsappLocationResolverService');

const exactCases = [
  ['Sentema', 'Sentema', 'Wakiso', 'Central'],
  ['Kawempe', 'Kawempe', 'Kampala', 'Central'],
  ['Banda', 'Banda', 'Kampala', 'Central'],
  ['Bala', 'Bala', 'Kole', 'Northern'],
  ['Bushenyi-Ishaka', 'Bushenyi-Ishaka', 'Bushenyi', 'Western']
];

for (const [query, area, district, region] of exactCases) {
  const resolution = resolveWhatsappLocation(query);
  assert.strictEqual(resolution.status, 'matched', `${query} should resolve exactly in WhatsApp`);
  assert.strictEqual(resolution.approval_blocked, false, `${query} should be safe to auto-resolve`);
  assert.strictEqual(resolution.confidence, 1, `${query} should have exact confidence`);
  assert.deepStrictEqual(
    [resolution.match.area, resolution.match.district, resolution.match.region],
    [area, district, region],
    `${query} should match the website location cascade`
  );
}

const natural = resolveWhatsappLocation('I need a 2-bed apartment in Ntinda', { allowText: true });
assert.strictEqual(natural.status, 'matched');
assert.strictEqual(natural.match.canonical_location_id, 'kampala:ntinda');
assert.strictEqual(natural.match_type, 'exact_alias_in_text');

const wrongLegacyParent = resolveWhatsappLocation('Banda', { district: 'Ibanda' });
assert.strictEqual(wrongLegacyParent.status, 'matched');
assert.strictEqual(wrongLegacyParent.match.canonical_location_id, 'kampala:banda');

const wrongBalaParent = canonicalizeWhatsappSearchFilters(
  { area: 'Bala', district: 'Butambala' },
  'land for sale in Bala'
);
assert.strictEqual(wrongBalaParent.canonical_location_id, 'kole:bala');
assert.strictEqual(wrongBalaParent.district, 'Kole');

const unknown = resolveWhatsappLocation('Zzxq');
assert.strictEqual(unknown.status, 'unmatched');
assert.strictEqual(unknown.approval_blocked, true);
assert.strictEqual(unknown.match, null);
assert.match(whatsappLocationPrompt(unknown), /not match.*not guessed or saved/i);

const prominentDuplicates = {
  Mateete: 'sembabule:mateete',
  Migyera: 'nakasongola:migyera',
  Bukuuku: 'kabarole:bukuuku',
  Kyeeya: 'kyenjojo:kyeeya'
};
for (const [query, canonicalId] of Object.entries(prominentDuplicates)) {
  const resolution = resolveWhatsappLocation(query);
  assert.strictEqual(resolution.status, 'matched', `${query} should use the prominent exact match in WhatsApp`);
  assert.strictEqual(resolution.approval_blocked, false, `${query} should be safe to auto-resolve`);
  assert.strictEqual(resolution.match.canonical_location_id, canonicalId);
  assert(resolution.candidates.length >= 2, `${query} should retain alternative districts`);
}

for (const query of ['Labongo']) {
  const resolution = resolveWhatsappLocation(query);
  assert.strictEqual(resolution.status, 'ambiguous', `${query} should require WhatsApp disambiguation`);
  assert.strictEqual(resolution.approval_blocked, true, `${query} must never auto-resolve`);
  assert.strictEqual(resolution.match, null);
  assert(resolution.candidates.length >= 2, `${query} should offer district choices`);
  assert.match(whatsappLocationPrompt(resolution), /will not guess/i);
}

const qualifiedMateete = resolveWhatsappLocation('Mateete, Sembabule');
assert.strictEqual(qualifiedMateete.status, 'matched');
assert.strictEqual(qualifiedMateete.match.canonical_location_id, 'sembabule:mateete');

const listingPatch = canonicalWhatsappLocationPatch(resolveWhatsappLocation('Sentema'));
assert.deepStrictEqual(
  {
    area: listingPatch.area,
    district: listingPatch.district,
    region: listingPatch.region,
    canonical_location_id: listingPatch.canonical_location_id,
    match: listingPatch.canonical_location_match,
    confidence: listingPatch.canonical_location_confidence
  },
  {
    area: 'Sentema',
    district: 'Wakiso',
    region: 'Central',
    canonical_location_id: 'wakiso:sentema',
    match: 'exact_alias',
    confidence: 1
  }
);

const searchFilters = canonicalizeWhatsappSearchFilters({
  searchType: 'rent',
  area: 'Banda',
  bedsMin: 2
}, '2-bed house for rent in Banda');
assert.strictEqual(searchFilters.canonical_location_id, 'kampala:banda');
assert.strictEqual(searchFilters.district, 'Kampala');
assert.strictEqual(searchFilters.location_blocked, false);

const ambiguousFilters = canonicalizeWhatsappSearchFilters({ area: 'Labongo' }, 'house in Labongo');
assert.strictEqual(ambiguousFilters.location_blocked, true);
assert.strictEqual(ambiguousFilters.canonical_location_id, undefined);

const routeSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'whatsapp.js'), 'utf8');
assert(!routeSource.includes('const SELLER_LOCATION_HINTS'), 'WhatsApp must not keep a private seller location list');
assert(routeSource.includes("COALESCE(${safeAlias}.extra_fields->>'canonical_location_id', '') = ANY"), 'WhatsApp search should query canonical IDs');
assert(routeSource.includes('canonical_location_source: d.canonical_location_source'), 'WhatsApp listings should persist shared-resolver provenance');
assert(routeSource.includes("return respond(whatsappLocationPrompt(locationResolution), 'area')"), 'Unknown or ambiguous WhatsApp listing areas should remain blocked');
assert(routeSource.includes("if (locationBlockReply) return respond(locationBlockReply, 'search_area')"), 'Unknown or ambiguous WhatsApp searches should ask for clarification');

console.log('WhatsApp shared location resolver parity checks passed');
