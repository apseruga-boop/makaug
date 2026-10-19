'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  normalizeFoundOnlineSourcePost,
  sourcePostMeetsLaunchIntakeRule,
} = require('../services/socialSearchSourcedListingsService');
const { foreignSourceMarketStatus } = require('../utils/sourceIntakeIntegrity');
const { parseSourcePrice, propertyPriceMetadata } = require('../utils/propertyPriceCurrency');
const { rejectionForPendingRow } = require('../scripts/report-pending-intake-rejections');

function youtubePost(overrides = {}) {
  return {
    source_url: 'https://www.youtube.com/watch?v=overseas-example',
    source_platform: 'youtube',
    platform: 'YouTube',
    source_name: 'Overseas Homes',
    title: 'Home for sale',
    caption: 'Home for sale',
    area: '',
    district: '',
    ingested_at: '2026-10-19T08:30:00.000Z',
    ...overrides,
  };
}

const OVERSEAS = [
  {
    ref: '36CB17',
    source_name: 'Manto Property',
    title: 'Rumah dijual di Tangerang 1,1M',
    caption: 'Rumah dijual di Tangerang 1,1M',
    price: '1,1M',
    matched: /tangerang/i,
    forbiddenPrice: 108_000_000,
  },
  {
    ref: 'A25A85',
    source_name: 'Property Partner id',
    title: 'Rumah dijual di Bandung',
    caption: 'Rumah dijual di Bandung 2,4M',
    price: '2,4M',
    matched: /bandung/i,
  },
  {
    ref: '1E89E8',
    source_name: 'Manto Property',
    title: 'BADUNG 3,5M villa for sale',
    caption: 'BADUNG 3,5M villa for sale',
    price: '3,5M',
    matched: /badung/i,
    forbiddenPrice: 5_000_000,
  },
  {
    ref: 'E97EC5',
    source_name: 'Property Partner id',
    title: 'Rumah di Darmawangsa',
    caption: 'Rumah dijual Darmawangsa 4,2M',
    price: '4,2M',
    matched: /darmawangsa/i,
  },
  {
    ref: '655C5C',
    source_name: 'Manto Property',
    title: 'Rumah dijual Cirendeu cluster omel paduny',
    caption: 'Rumah dijual Cirendeu cluster omel paduny 1,1M',
    price: '1,1M',
    matched: /cirendeu/i,
    forbiddenDistrict: 'Gulu',
    forbiddenPrice: 108_000_000,
  },
  {
    ref: 'BD06DD',
    source_name: 'Property Partner id',
    title: 'Pondok Indah house for sale',
    caption: 'Pondok Indah house for sale 8,5M',
    price: '8,5M',
    matched: /pondok indah/i,
  },
  {
    ref: '32C923',
    source_name: 'Manto Property',
    title: 'BSD 18,5M kakwa nyadri',
    caption: 'BSD 18,5M kakwa nyadri',
    price: '18,5M',
    matched: /bsd/i,
    forbiddenDistrict: 'Maracha',
    forbiddenPrice: 5_000_000,
  },
  {
    ref: '731047',
    source_name: 'Just Property Umhlanga',
    title: 'House for sale in Umhlanga',
    caption: 'House for sale in Umhlanga Ridge. R 3,500,000.',
    price: 'R 3,500,000',
    matched: /umhlanga|zar|\br\b/i,
  },
  {
    ref: '5E71AE',
    source_name: 'Uttarakhand Property',
    title: 'House for sale in Uttarakhand',
    caption: 'Independent house for sale in Uttarakhand. 45 lakh.',
    price: '45 lakh',
    matched: /uttarakhand|lakh/i,
  },
  {
    ref: '0FD3FF',
    source_name: 'Godhavari-homes',
    title: 'Godhavari homes independent house',
    caption: 'Godhavari-homes independent house for sale.',
    price: 'Rs 60 lakh',
    matched: /godhavari|rs|lakh/i,
  },
  {
    ref: 'CB3C8C',
    source_name: 'AP Homes Jaipur',
    title: '3 BHK for sale in Jaipur',
    caption: 'AP Homes Jaipur 3 BHK for sale. 85 lakh.',
    price: '85 lakh',
    matched: /jaipur|lakh/i,
  },
  {
    ref: '190E7A',
    source_name: 'Bharat Ratna',
    title: 'Bharat Ratna apartment for sale',
    caption: 'Bharat Ratna apartment for sale. Rs 1.2 crore.',
    price: 'Rs 1.2 crore',
    matched: /bharat ratna|crore|rs/i,
  },
];

test('overseas YouTube homes are rejected by the Uganda allowlist and keep no UGX price or invented district', () => {
  for (const sample of OVERSEAS) {
    const listing = normalizeFoundOnlineSourcePost(youtubePost({
      source_url: `https://www.youtube.com/watch?v=${sample.ref}`,
      source_name: sample.source_name,
      channel_title: sample.source_name,
      title: sample.title,
      caption: sample.caption,
      price: sample.price,
      price_text: sample.price,
      district: sample.forbiddenDistrict || '',
    }));
    const intake = sourcePostMeetsLaunchIntakeRule(listing, listing.sourceAgent);
    assert.equal(listing.countryGate.allowed, false, sample.ref);
    assert.equal(intake.country_gate_passed, false, sample.ref);
    assert.equal(intake.eligible, false, sample.ref);
    assert.ok(listing.countryGate.reason, sample.ref);
    assert.match(listing.countryGate.reason, /^foreign_|^no_uganda_evidence$/, sample.ref);
    assert.match(String(listing.countryGate.matched || listing.countryGate.reason), sample.matched, sample.ref);
    assert.equal(listing.price, null, sample.ref);
    assert.equal(listing.priceOriginal, null, sample.ref);
    assert.equal(listing.district, '', sample.ref);
    assert.equal(listing.area, '', sample.ref);
    if (sample.forbiddenDistrict) assert.notEqual(listing.district, sample.forbiddenDistrict, sample.ref);
    if (sample.forbiddenPrice) assert.notEqual(listing.price, sample.forbiddenPrice, sample.ref);
    assert.equal(intake.country_gate_reason, listing.countryGate.reason, sample.ref);
  }
});

test('a fuzzy parish is not a Uganda district when the caption has no Uganda evidence', () => {
  const gulu = normalizeFoundOnlineSourcePost(youtubePost({
    source_name: 'Manto Property',
    title: 'Cluster house for sale omel paduny bungatira',
    caption: 'Cluster house for sale omel paduny bungatira 18,5M',
    price: '18,5M',
    price_text: '18,5M',
    district: 'Gulu',
  }));
  assert.equal(gulu.countryGate.allowed, false);
  assert.equal(gulu.countryGate.reason, 'no_uganda_evidence');
  assert.equal(gulu.district, '');
  assert.notEqual(gulu.district, 'Gulu');
  assert.equal(gulu.price, null);

  const maracha = normalizeFoundOnlineSourcePost(youtubePost({
    source_name: 'AP Homes Jaipur',
    title: 'House for sale kakwa nyadri oluvu',
    caption: 'House for sale kakwa nyadri oluvu',
    district: 'Maracha',
  }));
  assert.equal(maracha.countryGate.reason, 'foreign_market_location');
  assert.equal(maracha.district, '');
  assert.notEqual(maracha.district, 'Maracha');
});

test('ambiguous European millions are not stored as UGX without UGX, USh, or Uganda context', () => {
  assert.equal(parseSourcePrice('1,1M'), null);
  assert.equal(parseSourcePrice('18,5M'), null);
  assert.equal(parseSourcePrice('3,5M'), null);
  assert.equal(parseSourcePrice('BSD 18,5M'), null);
  assert.equal(propertyPriceMetadata('1,1M').price, null);
  assert.equal(propertyPriceMetadata('18,5M').price, null);
  assert.equal(propertyPriceMetadata('3,5M').price, null);
  assert.notEqual(propertyPriceMetadata('1,1M').price, 108_000_000);
  assert.notEqual(propertyPriceMetadata('18,5M').price, 5_000_000);
  assert.equal(propertyPriceMetadata('UGX 18,5M').price, 18_500_000);
  assert.equal(propertyPriceMetadata('USh 1,1M').price, 1_100_000);
  assert.equal(propertyPriceMetadata('Rp 1,1M').price, null);
  assert.equal(propertyPriceMetadata('Rp 1,1M').rejection_reason, 'unsupported_property_price_currency');

  const kira = normalizeFoundOnlineSourcePost(youtubePost({
    source_name: 'Kira Plots',
    title: 'Plot for sale in Kira',
    caption: 'Plot for sale in Kira 1,1M',
    price: '1,1M',
    price_text: '1,1M',
    listing_type: 'land',
  }));
  assert.equal(kira.countryGate.allowed, true);
  assert.equal(kira.district, 'Wakiso');
  assert.equal(kira.price, 1_100_000);
  assert.notEqual(kira.price, 108_000_000);

  const kajjansi = normalizeFoundOnlineSourcePost(youtubePost({
    source_name: 'Kajjansi Plots',
    title: 'Plot for sale in Kajjansi',
    caption: 'Plot for sale in Kajjansi 18,5M',
    price: '18,5M',
    price_text: '18,5M',
    listing_type: 'land',
  }));
  assert.equal(kajjansi.countryGate.allowed, true);
  assert.equal(kajjansi.area, 'Kajjansi');
  assert.equal(kajjansi.district, 'Wakiso');
  assert.equal(kajjansi.price, 18_500_000);
  assert.notEqual(kajjansi.price, 5_000_000);
});

test('Kira, Kajjansi, a USD Kampala listing, and a known Ugandan channel still pass', () => {
  const kira = normalizeFoundOnlineSourcePost(youtubePost({
    source_name: 'Walk-in agent',
    title: 'House for sale in Kira',
    caption: 'House for sale in Kira. UGX 350m. Call +256700000000.',
    price: 'UGX 350m',
    price_text: 'UGX 350m',
  }));
  assert.equal(kira.countryGate.allowed, true);
  assert.equal(kira.area, 'Kira');
  assert.equal(kira.district, 'Wakiso');
  assert.equal(kira.price, 350_000_000);
  assert.equal(sourcePostMeetsLaunchIntakeRule(kira, kira.sourceAgent).country_gate_passed, true);

  const kajjansi = normalizeFoundOnlineSourcePost(youtubePost({
    source_name: 'Walk-in agent',
    title: 'Plot for sale in Kajjansi',
    caption: 'Plot for sale in Kajjansi. USh 80m.',
    price: 'USh 80m',
    price_text: 'USh 80m',
    listing_type: 'land',
  }));
  assert.equal(kajjansi.countryGate.allowed, true);
  assert.equal(kajjansi.area, 'Kajjansi');
  assert.equal(kajjansi.district, 'Wakiso');
  assert.equal(kajjansi.price, 80_000_000);

  const usd = normalizeFoundOnlineSourcePost(youtubePost({
    source_name: 'Kololo Homes',
    title: 'Apartment for rent in Kololo',
    caption: 'Apartment for rent in Kololo, Kampala. $2,500/Month.',
    area: 'Kololo',
    district: 'Kampala',
    price: '$2,500/Month',
    price_text: '$2,500/Month',
    price_currency: 'USD',
    listing_type: 'rent',
  }));
  assert.equal(usd.countryGate.allowed, true);
  assert.equal(usd.district, 'Kampala');
  assert.equal(usd.priceOriginalCurrency, 'USD');
  assert.equal(usd.priceOriginal, 2500);
  assert.equal(usd.price, 9_500_000);

  const channel = normalizeFoundOnlineSourcePost(youtubePost({
    source_name: 'Legit Properties',
    channel_title: 'Legit Properties',
    title: '3 bedroom house for sale',
    caption: '3 bedroom house for sale.',
  }));
  assert.equal(channel.countryGate.allowed, true);
  assert.equal(channel.countryGate.evidence, 'channel');
  assert.equal(channel.district, '');

  const channelAbroad = normalizeFoundOnlineSourcePost(youtubePost({
    source_name: 'Legit Properties',
    title: 'Rumah dijual di Tangerang',
    caption: 'Rumah dijual di Tangerang 1,1M',
    price: '1,1M',
  }));
  assert.equal(channelAbroad.countryGate.allowed, false);
  assert.equal(channelAbroad.countryGate.reason, 'foreign_market_location');
  assert.equal(channelAbroad.price, null);

  assert.equal(foreignSourceMarketStatus('House for sale in Kitende, Wakiso UGX 35m').allowed, true);
  assert.equal(foreignSourceMarketStatus('House for sale. 3 bedrooms.').reason, 'no_uganda_evidence');
  assert.equal(foreignSourceMarketStatus('Call +256701234567 about this house.').allowed, true);
});

test('a stored Gulu or Maracha district does not keep a foreign caption in the rejection report', () => {
  const tangerang = rejectionForPendingRow({
    inquiry_reference: 'MK-20261019-36CB17',
    title: 'Rumah dijual di Tangerang 1,1M',
    description: 'Rumah dijual di Tangerang 1,1M',
    source_name: 'Manto Property',
    district: 'Gulu',
    area: 'Paduny',
    price: 108_000_000,
  });
  assert.equal(tangerang.reason, 'foreign_market_location');

  const bsd = rejectionForPendingRow({
    inquiry_reference: 'MK-20261019-32C923',
    title: 'BSD 18,5M',
    description: 'BSD 18,5M',
    source_name: 'Manto Property',
    district: 'Maracha',
    price: 5_000_000,
  });
  assert.equal(bsd.reason, 'foreign_market_location');

  assert.equal(rejectionForPendingRow({
    title: 'Plot for sale in Kitende',
    description: 'Plot for sale in Kitende, Wakiso. UGX 35m.',
    source_name: 'Segawa Frederick Kevin SFK',
    district: 'Wakiso',
  }), null);

  assert.equal(rejectionForPendingRow({
    title: 'House for sale',
    description: '3 bedroom house for sale.',
    source_name: 'Manto Property',
  }).reason, 'no_uganda_evidence');
});
