'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { employeePropertyFacts, perUnitPriceFacts } = require('../routes/whatsapp').__test;
const { deriveListingClassification } = require('../utils/listingDataIntegrity');
const { detectPropertyTypeEvidence } = require('../utils/propertyTypeVocabulary');
const { foreignSourceMarketStatus, safeSourcePriceCandidate } = require('../utils/sourceIntakeIntegrity');
const { resolveCanonicalUgandaLocationFromText } = require('../utils/ugandaLocationRegistry');
const { sourcePositiveListingGateForRecord } = require('../utils/sourceContentQuality');
const {
  decideIntakeRepeat,
  preferEachPlotPrice,
  quotedEachPlotAmount,
} = require('../utils/listingIntakeQuality');

test('a per-plot each price is the price of one plot', () => {
  const cases = [
    ['2 plots in Kira Nakwero each at 55m', 55_000_000],
    ['50x100 plots at Bukerere each at 35m', 35_000_000],
    ['100 plots at Namugongo each 120m', 120_000_000],
  ];
  for (const [caption, expected] of cases) {
    const parsed = employeePropertyFacts(caption, {});
    assert.equal(Number(parsed.price), expected, caption);
    assert.equal(parsed.pricePeriod, 'plot', caption);
  }
  const perPlot = perUnitPriceFacts('100 plots each at 35m', 35_000_000);
  assert.equal(perPlot.unit, 'plot');
  assert.equal(perPlot.quantity, 100);
  assert.equal(perPlot.total, 35_000_000);
  assert.equal(perPlot.eachNotTotal, true);
});

test('a per-acre rate is stored per acre, and a multiplied total is brought back to that rate', () => {
  const parsed = employeePropertyFacts('20 acres kayunga kitwe each at 8.5m with power', {});
  assert.equal(Number(parsed.price), 8_500_000);
  assert.equal(parsed.pricePeriod, 'acre');
  assert.equal(quotedEachPlotAmount('20 acres kayunga kitwe each at 8.5m'), null);
  assert.equal(preferEachPlotPrice('8000 acres for sale in Nwoya at 2.5m per acre', 20_000_000_000), 2_500_000);
  const safe = safeSourcePriceCandidate('20bn', '8000 acres of farmland for sale in Nwoya at 2.5m per acre (20bn if someone multiplies it)');
  assert.equal(Number(safe.value), 2_500_000);
  assert.equal(safe.reason, 'quoted_unit_price');
});

test('a social each-plot figure beats a multiplied total in the same caption', () => {
  const text = '50x100 plots for sale at Bukerere, 35m each, total written as 3.5bn';
  assert.equal(quotedEachPlotAmount(text), 35_000_000);
  assert.equal(preferEachPlotPrice(text, 3_500_000_000), 35_000_000);
  const safe = safeSourcePriceCandidate('3.5bn', text);
  assert.equal(Number(safe.value), 35_000_000);
  assert.equal(safe.reason, 'quoted_unit_price');
});

test('an apartment block on a plot is not land', () => {
  const caption = '2 bedroom apartment block on a 50x100 plot for sale in Kira at 800m';
  assert.equal(employeePropertyFacts(caption, {}).listingType, 'sale');
  const evidence = detectPropertyTypeEvidence(caption);
  assert.equal(evidence.physical_type, 'residential');
  assert.equal(evidence.property_type, 'apartment');
  const classified = deriveListingClassification({
    title: caption,
    listing_type: 'land',
    bedrooms: 2,
  });
  assert.equal(classified.listing_type, 'sale');
  assert.equal(classified.physical_type, 'residential');
  assert.equal(employeePropertyFacts('Plot for sale in Kira, Wakiso 50x100 at 90m', {}).listingType, 'land');
});

test('foreign posts and English-word parishes are not Uganda towns', () => {
  assert.equal(foreignSourceMarketStatus('Villa for sale in DHA Phase 6').allowed, false);
  assert.equal(foreignSourceMarketStatus('305 Lillian Drive Pickerington Ohio').allowed, false);
  assert.equal(foreignSourceMarketStatus('House in Hassan, Karnataka').allowed, false);
  assert.equal(foreignSourceMarketStatus('House for sale in Kololo Kampala UGX 500m').allowed, true);

  const complex = resolveCanonicalUgandaLocationFromText('Luxury housing complex for sale');
  assert.equal(complex.status, 'unmatched');
  const peace = resolveCanonicalUgandaLocationFromText('Peace of mind in your new home');
  assert.equal(peace.status, 'unmatched');
  const corroborated = resolveCanonicalUgandaLocationFromText('Plot in Peace ward, Yumbe');
  assert.equal(corroborated.status, 'matched');
  assert.equal(corroborated.match.district, 'Yumbe');

  const gate = sourcePositiveListingGateForRecord({
    title: 'House for sale',
    description: '305 Lillian Drive Pickerington Ohio',
  });
  assert.equal(gate.ok, false);
  assert.equal(gate.reason, 'non_uganda_location');
});

test('repeats match on video, phone plus area plus price, or caption, and a drop updates', () => {
  const phoneAreaPrice = decideIntakeRepeat({
    phone: '256700111222',
    area: 'Nakwero',
    price: 55_000_000,
    caption: 'plots in Nakwero',
  }, [{
    id: 'live-1',
    status: 'approved',
    price: 55_000_000,
    area: 'Nakwero',
    phone_digits: '256700111222',
  }]);
  assert.equal(phoneAreaPrice.match_type, 'duplicate');

  const videoDrop = decideIntakeRepeat({
    videoId: '7123456789012345678',
    price: 140_000_000,
    caption: 'same house now 140m',
  }, [{
    id: 'live-2',
    status: 'approved',
    price: 170_000_000,
    tiktok_video_id: '7123456789012345678',
    area: 'Kira',
    phone_digits: '256700111222',
  }]);
  assert.equal(videoDrop.match_type, 'price_update');
  assert.equal(videoDrop.id, 'live-2');

  const captionDrop = decideIntakeRepeat({
    phone: '0700111222',
    area: 'Bukerere',
    price: 160_000_000,
    caption: 'House for sale in Bukerere Wakiso with a title and photos now 160m',
  }, [{
    id: 'live-3',
    status: 'approved',
    price: 170_000_000,
    area: 'Bukerere',
    phone_digits: '256700111222',
    source_caption: 'House for sale in Bukerere Wakiso with a title and photos now 170m',
  }]);
  assert.equal(captionDrop.match_type, 'price_update');

  const differentPlot = decideIntakeRepeat({
    phone: '256700111222',
    area: 'Kira',
    price: 90_000_000,
    caption: 'A different plot in Kira near the market',
  }, [{
    id: 'live-4',
    status: 'approved',
    price: 140_000_000,
    area: 'Kira',
    phone_digits: '256700111222',
    source_caption: 'House for sale in Kira on a completely different road',
  }]);
  assert.equal(differentPlot, null);

  const route = fs.readFileSync(path.join(__dirname, '../routes/whatsapp.js'), 'utf8');
  assert.match(route, /source_caption_sha256/);
  assert.match(route, /status IN \('pending','approved'\)/);
  assert.match(route, /price_updated_from_repeat_intake/);
  const report = fs.readFileSync(path.join(__dirname, '../scripts/report-listing-data-quality.js'), 'utf8');
  assert.match(report, /assertReadOnly/);
  assert.doesNotMatch(report, /\bINSERT INTO\b/i);
  assert.doesNotMatch(report, /\bUPDATE properties\b/i);
});
