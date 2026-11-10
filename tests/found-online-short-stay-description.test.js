'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildFoundOnlineShortStayRecord,
  stripContradictoryPricePeriodText,
} = require('../services/foundOnlineShortStayIntake');

test('generated short-stay descriptions never keep contradictory price or period wording', () => {
  assert.equal(
    stripContradictoryPricePeriodText(
      'A stay in Kyanja. The source did not publish a price, so makaug shows Price upon application until the source confirms it. The guide price shown in the source is USh 150,000/month. Also 1,800,000 ugx per month, monthly available.'
    ),
    'A stay in Kyanja. The guide price shown in the source is USh 150,000. Also 1,800,000 ugx, available.'
  );
  const priced = buildFoundOnlineShortStayRecord({
    title: 'Kyanja Airbnb',
    description: '1 bedroom Airbnb in Kyanja. The source did not publish a price, so makaug shows Price upon application until the source confirms it. Guide price USh 150,000/month.',
    district: 'Kampala',
    area: 'Kyanja',
    price: 150000,
    sourceUrl: 'https://www.tiktok.com/@stay/video/7000000000000000999',
  }, {});
  assert.doesNotMatch(priced.description, /price (?:on|upon) application|\/month|per month|\bmonthly\b/i);
  assert.match(priced.description, /1 bedroom Airbnb in Kyanja/);
  assert.equal(priced.base_nightly_ugx, 150000);
  assert.equal(priced.extra_fields.price_on_application, false);
});
