'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  FEATURED_CATEGORIES,
  featuredCleanliness,
  featuredPoolHealth,
  selectFeaturedCandidates,
  timeZoneParts
} = require('../services/featuredRotationService');

function row(category, id, createdAt, overrides = {}) {
  const period = category === 'rent' ? 'month' : (category === 'student' ? 'sem' : 'once');
  return {
    id,
    listing_type: category,
    title: `${category} listing in Kira`,
    description: `A genuine ${category} property listing in Kira.`,
    district: 'Wakiso',
    area: 'Kira',
    price: category === 'student' ? 800000 : 120000000,
    price_period: period,
    property_type: category === 'land' ? 'residential_land' : 'house',
    created_at: createdAt,
    extra_fields: {},
    ...overrides
  };
}

test('selects exactly the two newest clean rows from every public category', () => {
  const rows = [];
  FEATURED_CATEGORIES.forEach((category, categoryIndex) => {
    rows.push(row(category, `${category}-bad`, `2026-07-25T09:0${categoryIndex}:00.000Z`, {
      price: category === 'student' ? 6000000 : 500000000,
      price_period: 'month'
    }));
    rows.push(row(category, `${category}-new`, `2026-07-25T08:0${categoryIndex}:00.000Z`));
    rows.push(row(category, `${category}-older`, `2026-07-25T07:0${categoryIndex}:00.000Z`));
  });

  const selection = selectFeaturedCandidates(rows, 2);

  assert.deepEqual(selection.missing, []);
  assert.equal(selection.selectedRows.length, 10);
  FEATURED_CATEGORIES.forEach((category) => {
    assert.deepEqual(
      selection.selected[category].map((item) => item.id),
      [`${category}-new`, `${category}-older`]
    );
  });
});

test('cleanliness gate blocks the launch price and location failure modes', () => {
  assert.deepEqual(
    featuredCleanliness(row('land', 'land-monthly', '2026-07-25', { price_period: 'month' })).reasons,
    ['land_priced_recurring']
  );
  assert.ok(
    featuredCleanliness(row('commercial', 'huge-monthly', '2026-07-25', {
      price: 400000000,
      price_period: 'month'
    })).reasons.includes('implausible_high_recurring_price')
  );
  assert.ok(
    featuredCleanliness(row('student', 'student-monthly', '2026-07-25', {
      price: 5000001,
      price_period: 'month'
    })).reasons.includes('implausible_student_monthly_price')
  );
  assert.ok(
    featuredCleanliness(row('rent', 'low-monthly-rent', '2026-07-25', {
      price: 2000,
      price_period: 'month'
    })).reasons.includes('implausible_low_recurring_price')
  );
  assert.equal(
    featuredCleanliness(row('rent', 'valid-nightly-rent', '2026-07-25', {
      price: 60000,
      price_period: 'night'
    })).clean,
    true
  );
  assert.ok(
    featuredCleanliness(row('student', 'student-sale-asset', '2026-07-25', {
      title: 'Apartment block for sale in Ntinda',
      price: 1450000000,
      price_period: 'once'
    })).reasons.includes('student_sale_asset')
  );
  assert.ok(
    featuredCleanliness(row('sale', 'sale-monthly', '2026-07-25', {
      price_period: 'month'
    })).reasons.includes('sale_priced_recurring')
  );
  assert.ok(
    featuredCleanliness(row('sale', 'location-conflict', '2026-07-25', {
      title: 'House for sale in Fort Portal',
      area: 'Kira',
      district: 'Wakiso'
    })).reasons.includes('title_location_conflict')
  );
});

test('completed daily rotation repairs a pool that no longer passes current cleanliness rules', () => {
  const healthyRows = FEATURED_CATEGORIES.flatMap((category, categoryIndex) => [
    row(category, `${category}-a`, `2026-07-25T0${categoryIndex}:00:00.000Z`),
    row(category, `${category}-b`, `2026-07-24T0${categoryIndex}:00:00.000Z`)
  ]);

  assert.equal(featuredPoolHealth(healthyRows, 2).healthy, true);
  const unhealthyRows = healthyRows.map((item) => ({ ...item }));
  const studentIndex = unhealthyRows.findIndex((item) => item.listing_type === 'student');
  unhealthyRows[studentIndex].price_period = 'once';
  unhealthyRows[studentIndex].price = 1450000000;
  const result = featuredPoolHealth(unhealthyRows, 2);
  assert.equal(result.healthy, false);
  assert.deepEqual(result.dirty[0].reasons, ['student_sale_asset']);
});

test('Kampala rotation window uses East Africa time rather than server time', () => {
  assert.deepEqual(
    timeZoneParts(new Date('2026-07-25T04:00:00.000Z'), 'Africa/Kampala'),
    { dateKey: '2026-07-25', hour: 7, minute: 0 }
  );
});
