'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  factualListingTitle,
  isPlaceholderOrGenericTitle,
  cleanListingTitle,
  rewritePlaceholderDescription,
  placeholderTitleApprovalBlock,
  PLACEHOLDER_TITLE_APPROVAL_ERROR
} = require('../services/publicListingCopy');
const {
  looksLikePastedWhatsAppCopy,
  cleanPastedListingCopy
} = require('../utils/pastedListingCopy');
const { resolveCanonicalUgandaLocation } = require('../utils/ugandaLocationRegistry');

const KAWUKU_TEXT = `*Entebbe Kawuku 20 Acres at 260m ugx each*

*Bussi Island 9 Acres at 160M each*
Viewing entebbe

Directly touching the lake
Squater free

For real estate, recreation etc
Titled
Money needed urgently!`;

test('detects found-online placeholder titles and leaves real titles alone', () => {
  assert.equal(isPlaceholderOrGenericTitle('Found-online TikTok property post 55'), true);
  assert.equal(isPlaceholderOrGenericTitle('TikTok property post 37'), true);
  assert.equal(isPlaceholderOrGenericTitle('Found-online Facebook property post 12'), true);
  assert.equal(isPlaceholderOrGenericTitle('Found-online property source'), true);
  assert.equal(isPlaceholderOrGenericTitle('Property listing'), true);
  assert.equal(isPlaceholderOrGenericTitle(''), true);
  assert.equal(isPlaceholderOrGenericTitle('2-bed House for sale in Muyenga'), false);
  assert.equal(isPlaceholderOrGenericTitle('20 acres for sale in Kawuku, Entebbe'), false);
});

test('builds titles from type, beds, area and sale or rent instead of the numeric fallback', () => {
  assert.equal(
    factualListingTitle({
      listing_type: 'sale',
      property_type: 'House',
      bedrooms: 2,
      area: 'Muyenga',
      district: 'Kampala'
    }),
    '2-bed house for sale in Muyenga'
  );
  assert.equal(
    factualListingTitle({
      listing_type: 'rent',
      property_type: 'House',
      area: 'Kyaliwajjala',
      district: 'Wakiso'
    }),
    'House for rent in Kyaliwajjala'
  );
  assert.equal(
    cleanListingTitle({
      title: 'Found-online TikTok property post 55',
      listing_type: 'sale',
      property_type: 'House',
      bedrooms: 2,
      area: 'Muyenga'
    }),
    '2-bed house for sale in Muyenga'
  );
});

test('rewrites a description that opens with the placeholder title', () => {
  const next = rewritePlaceholderDescription(
    'Found-online TikTok property post 55',
    '2-bed house for sale in Muyenga',
    'Found-online TikTok property post 55 is a 2-bedroom home around Muyenga. It is presented as a 2-bedroom House.'
  );
  assert.equal(next.startsWith('2-bed house for sale in Muyenga is a 2-bedroom home around Muyenga.'), true);
  assert.equal(/Found-online TikTok property post 55/.test(next), false);
});

test('approval is blocked for a placeholder title and cannot be overridden', () => {
  const blocked = placeholderTitleApprovalBlock({ title: 'Found-online TikTok property post 55' });
  assert.ok(blocked);
  assert.equal(blocked.code, 'placeholder_or_generic_title');
  assert.equal(blocked.override_available, false);
  assert.equal(blocked.error, PLACEHOLDER_TITLE_APPROVAL_ERROR);
  assert.equal(placeholderTitleApprovalBlock({ title: '2-bed house for sale in Muyenga' }), null);

  const propertiesRoute = fs.readFileSync(path.join(__dirname, '../routes/properties.js'), 'utf8');
  assert.match(propertiesRoute, /placeholderTitleApprovalBlock/);
  assert.match(propertiesRoute, /placeholder_or_generic_title/);
  assert.match(propertiesRoute, /override_available: false/);
});

test('review copy cleaner turns a pasted WhatsApp land advert into a concise title and paragraph', () => {
  assert.equal(looksLikePastedWhatsAppCopy(KAWUKU_TEXT), true);
  const cleaned = cleanPastedListingCopy({
    title: KAWUKU_TEXT.replace(/\n+/g, ' '),
    description: KAWUKU_TEXT,
    listing_type: 'land',
    property_type: 'Residential Plot',
    area: 'Kawuku',
    district: 'Wakiso',
    land_size_value: 20,
    land_size_unit: 'acres',
    price_period: 'acre'
  });
  assert.equal(cleaned.title, '20 acres for sale in Kawuku');
  assert.match(cleaned.description, /20 acres for sale in Kawuku/i);
  assert.match(cleaned.description, /UGX 260 million per acre/);
  assert.match(cleaned.description, /Bussi Island/);
  assert.match(cleaned.description, /UGX 160 million/);
  assert.match(cleaned.description, /squatter-free/);
  assert.match(cleaned.description, /lake/);
  assert.match(cleaned.description, /should be split/);
  assert.equal(cleaned.shouldSplit, true);
  assert.equal(cleaned.offers.length, 2);
  assert.doesNotMatch(cleaned.title, /\*/);
  assert.doesNotMatch(cleaned.description, /\*/);
  assert.doesNotMatch(cleaned.description, /Money needed urgently/i);
});

test('Kawuku Entebbe and Bussi Island resolve in the catalogue', () => {
  const kawuku = resolveCanonicalUgandaLocation('Kawuku Entebbe');
  assert.equal(kawuku.status || (kawuku.name && 'matched'), 'matched');
  const kawukuPlace = kawuku.match || kawuku;
  assert.equal(kawukuPlace.name, 'Kawuku');
  assert.equal(kawukuPlace.district, 'Wakiso');

  const comma = resolveCanonicalUgandaLocation('Kawuku, Entebbe');
  const commaPlace = comma.match || comma;
  assert.equal((comma.status || 'matched'), 'matched');
  assert.equal(commaPlace.name, 'Kawuku');

  const bussi = resolveCanonicalUgandaLocation('Bussi Island');
  const bussiPlace = bussi.match || bussi;
  assert.equal((bussi.status || 'matched'), 'matched');
  assert.equal(bussiPlace.name, 'Bussi');
  assert.equal(bussiPlace.district, 'Wakiso');
});
