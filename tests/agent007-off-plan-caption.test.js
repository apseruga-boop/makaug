'use strict';

/**
 * 6 Nov 2026: Vanta House's progress caption came through Agent 007 and went
 * to review as a "7-bed property for rent in Naguru" at UGX 204M, after
 * asking staff "which district October is in". A developer's project caption
 * is an off-plan project: months and floors are not places or rooms, a
 * construction pace is not rent, and an off-plan draft is opened for the
 * off-plan desk alongside the review listing.
 */
const test = require('node:test');
const assert = require('node:assert');
const db = require('../config/database');
const t = require('../routes/whatsapp').__test;

const VANTA = 'Vanta House has reached the 7th floor, maintaining an average construction pace of 2.5 floors per month. We aim to complete the structural topping-out by the end of 2026 and deliver the apartments for occupancy in October 2027.\n1BHK starts from USD 53,800\n2BHK starts from USD 95,000\n3BHK starts from USD 166,000\n\nThese are the 1st-floor prices. The price increases by 1% for each additional floor.';

test('a developer\'s progress caption is read as an off-plan project, not a 7-bed rental in October', () => {
  assert.strictEqual(t.employeeCaptionLooksOffPlan(VANTA), true);
  assert.strictEqual(t.offPlanProjectNameFromCaption(VANTA), 'Vanta House');
  const facts = t.employeePropertyFacts(VANTA, {});
  assert.strictEqual(facts.offPlan, true);
  assert.strictEqual(facts.listingType, 'sale', 'sold off plan, not rented');
  assert.strictEqual(facts.pricePeriod, 'once');
  assert.strictEqual(facts.bedroomDraft.bedrooms, 1, 'the smallest home, not the floor count');
  assert.strictEqual(facts.bedroomDraft.bedroom_options_max, 3);
  assert.deepStrictEqual(t.employeePropertyMissing(facts), ['exact area and district'], 'October is not a place');
  const placed = t.employeePropertyFacts(`${VANTA}\nNaguru`, {});
  assert.strictEqual(placed.locationPatch.area, 'Naguru');
  assert.strictEqual(placed.locationPatch.district, 'Kampala');
  assert.deepStrictEqual(t.employeePropertyMissing(placed), []);
});

test('ordinary captions are untouched', () => {
  const house = t.employeePropertyFacts('HOUSE FOR SALE KITENDE KITOVU ENTEBBE ROAD. 3BEDROOMS SELF CONTAINED ON 18 DECIMALS WITH TITTLE AT ASKING PRICE 370M', {});
  assert.strictEqual(house.offPlan, false);
  assert.strictEqual(house.bedroomDraft.bedrooms, 3);
  const rental = t.employeePropertyFacts('2 bedroom apartment for rent in Ntinda at 1.2m per month', {});
  assert.strictEqual(rental.listingType, 'rent');
  assert.strictEqual(rental.pricePeriod, 'month');
  assert.strictEqual(t.employeeCaptionLooksOffPlan('3 bedroom house for sale in Kira at 450m, 2nd floor master ensuite'), false);
});

test('the review listing is titled as an off-plan project and a draft is opened for the off-plan desk', async () => {
  const originalQuery = db.query;
  const calls = [];
  db.query = async (sql, params = []) => {
    calls.push({ sql: String(sql), params });
    if (/INSERT INTO off_plan_developments/i.test(sql)) return { rows: [{ id: 'dev-1', slug: 'vanta-house', name: params[1] || 'Vanta House', status: 'pending_review', verification_status: 'needs_verification', unit_types: '[]', payment_plan: '[]', images: '[]', videos: '[]', floor_plans: '[]', amenities: '[]', nearby_places: '[]', brochure_settings: '{}', walkthrough_settings: '{}', extra_fields: '{}' }] };
    return { rows: [] };
  };
  try {
    const facts = t.employeePropertyFacts(`${VANTA}\nNaguru`, {});
    const development = await t.createOffPlanDraftFromIntake({
      propertyId: 'f69916f7-f487-4e4f-b198-0200a2921027',
      caption: `${VANTA}\nNaguru`,
      facts,
      storedMedia: [{ url: 'https://media.makaug.com/a.jpg', kind: 'image' }, { url: 'https://media.makaug.com/b.mp4', kind: 'video' }],
      agent: { id: 'ed1197fd-6f6d-46fe-9b8d-2ca8a1f96c92', full_name: 'John Yan', company_name: 'Independent agent' }
    });
    assert.strictEqual(development.id, 'dev-1');
    const insert = calls.find((call) => /INSERT INTO off_plan_developments/i.test(call.sql));
    assert.ok(insert, 'a draft development was inserted');
    const columns = insert.sql.match(/INSERT INTO off_plan_developments \(([^)]+)\)/)[1].split(',').map((c) => c.trim());
    const row = Object.fromEntries(columns.map((column, index) => [column, insert.params[index]]));
    assert.strictEqual(row.name, 'Vanta House');
    assert.strictEqual(row.slug, 'vanta-house');
    assert.strictEqual(row.status, 'pending_review');
    assert.strictEqual(row.verification_status, 'needs_verification');
    assert.strictEqual(row.area, 'Naguru');
    assert.strictEqual(row.district, 'Kampala');
    assert.strictEqual(row.source_agent_id, 'ed1197fd-6f6d-46fe-9b8d-2ca8a1f96c92');
    assert.strictEqual(row.developer_name, null, '"Independent agent" is not a developer');
    const units = JSON.parse(row.unit_types);
    assert.deepStrictEqual(units.map((unit) => [unit.bedrooms, unit.price_original, unit.price_original_currency]), [[1, 53800, 'USD'], [2, 95000, 'USD'], [3, 166000, 'USD']]);
    assert.ok(units.every((unit) => unit.price_ugx > 100000000), 'converted to shillings');
    assert.strictEqual(JSON.parse(row.images).length, 1);
    assert.strictEqual(JSON.parse(row.videos).length, 1);
    assert.strictEqual(JSON.parse(row.extra_fields).source_property_id, 'f69916f7-f487-4e4f-b198-0200a2921027');
    const link = calls.find((call) => /UPDATE properties SET extra_fields/i.test(call.sql) && /off_plan_development_id/.test(call.sql));
    assert.ok(link, 'the review listing points at the draft');
    assert.deepStrictEqual(link.params, ['f69916f7-f487-4e4f-b198-0200a2921027', 'dev-1', 'Vanta House']);
  } finally {
    db.query = originalQuery;
  }
});
