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

const VANTA_SALES = 'Luxury apartments for sale at Vanta House, Naguru Vale, Kampala — starting from USD 53,800. 1, 2, 3 and 4-bedroom apartments available, with flexible payment plans. The project is under construction, with completion and handover expected in October 2027.';
const KNOWN = { known_projects: [{ id: '7a732f80-0e14-49d0-ac2d-7f972b373763', name: 'Vanta House', slug: 'vanta-house', status: 'published' }], whatsapp_agent_self_intake: true, agent: { id: 'ed1197fd-6f6d-46fe-9b8d-2ca8a1f96c92', full_name: 'John Yan' } };

test('a sales caption with a menu of home sizes is a project, and "at Vanta House" names it', () => {
  // 6 Nov 2026, an hour after the page went live: this went to review as a
  // "4-bed property for sale in Naguru".
  assert.strictEqual(t.employeeCaptionLooksOffPlan(VANTA_SALES), true);
  assert.strictEqual(t.offPlanProjectNameFromCaption(VANTA_SALES), 'Vanta House');
  const facts = t.employeePropertyFacts(VANTA_SALES, {});
  assert.strictEqual(facts.offPlan, true);
  assert.strictEqual(facts.offPlanName, 'Vanta House');
  assert.strictEqual(facts.bedroomDraft.bedrooms, 1, 'the smallest home, not the largest');
  assert.strictEqual(facts.bedroomDraft.bedroom_options_max, 4);
  assert.strictEqual(facts.locationPatch.district, 'Kampala');
  assert.strictEqual(facts.knownDevelopment, null);
  assert.strictEqual(t.employeeCaptionLooksOffPlan('1-3 bedroom apartments available from UGX 250m in Kira, under construction'), true);
  assert.strictEqual(t.employeeCaptionLooksOffPlan('Spacious 1 and 2 bedroom apartments for rent in Ntinda at 1.2m and 1.8m'), false, 'a rental block is not a project');
  const lines = t.agentPropertyDetailLines(facts, VANTA_SALES);
  assert.match(lines[0], /^🏗️ Off-plan project: Vanta House · 1–4 bedroom homes · for sale$/);
  assert.match(lines[lines.length - 1], /^💰 from /);
});

test('a caption naming a project the agent already has on makaug is an update for that page', () => {
  const facts = t.employeePropertyFacts('Vanta House is now at the 8th floor, see the photos', KNOWN);
  assert.strictEqual(facts.offPlan, true);
  assert.deepStrictEqual(facts.knownDevelopment, { id: '7a732f80-0e14-49d0-ac2d-7f972b373763', name: 'Vanta House', slug: 'vanta-house', status: 'published' });
  assert.deepStrictEqual(t.employeePropertyMissing(facts), [], 'an update needs no price or district');
  assert.strictEqual(t.knownProjectInCaption('Nice 2 bedroom house in Kira at 300m', KNOWN), null);
  const reply = t.agentSelfIntakeSavedReply({
    data: KNOWN,
    facts,
    storedMedia: [{ kind: 'image' }, { kind: 'video' }, { kind: 'video' }],
    caption: 'Vanta House is now at the 8th floor, see the photos'
  });
  assert.match(reply, /✅ \*Thanks — received for Vanta House\.\*/);
  assert.match(reply, /1 photo · 2 videos and your note are with the team/);
  assert.match(reply, /makaug\.com\/off-plan\/vanta-house/);
  assert.doesNotMatch(reply, /goes live under your name/);
});

test('the update is recorded on the project for the off-plan desk and the review listing is linked, no second draft', async () => {
  const originalQuery = db.query;
  const calls = [];
  const existingRow = {
    id: '7a732f80-0e14-49d0-ac2d-7f972b373763', slug: 'vanta-house', name: 'Vanta House', status: 'published', verification_status: 'partially_verified',
    country_code: 'UG', unit_types: '[]', payment_plan: '[]', images: '[]', videos: '[]', floor_plans: '[]', amenities: '[]', nearby_places: '[]', brochure_settings: '{}', walkthrough_settings: '{}',
    extra_fields: JSON.stringify({ contact_mode: 'listing_request', project_updates: [{ id: 'older', received_at: '2026-11-01T00:00:00.000Z' }] })
  };
  db.query = async (sql, params = []) => {
    calls.push({ sql: String(sql), params });
    if (/FROM off_plan_developments d/i.test(sql) && /WHERE d\.id = \$1/i.test(sql)) return { rows: [existingRow] };
    if (/UPDATE off_plan_developments SET/i.test(sql)) return { rows: [{ ...existingRow, extra_fields: params[1] }] };
    if (/INSERT INTO off_plan_development_events/i.test(sql)) return { rows: [{ id: 'event-1' }] };
    return { rows: [] };
  };
  try {
    const facts = t.employeePropertyFacts('Vanta House is now at the 8th floor', KNOWN);
    const development = await t.createOffPlanDraftFromIntake({
      propertyId: '1a4bfcc8-31eb-4d9f-a773-1a9a0edee4a9',
      caption: 'Vanta House is now at the 8th floor',
      facts,
      storedMedia: [{ url: 'https://media.makaug.com/new.jpg', kind: 'image', publicEligible: true }, { url: 'https://media.makaug.com/new.mp4', kind: 'video' }, { url: 'data:image/jpeg;base64,xx', kind: 'image' }],
      agent: KNOWN.agent,
      phone: '256709973205'
    });
    assert.strictEqual(development.id, '7a732f80-0e14-49d0-ac2d-7f972b373763');
    assert.ok(!calls.some((call) => /INSERT INTO off_plan_developments/i.test(call.sql)), 'no second project is opened');
    const update = calls.find((call) => /UPDATE off_plan_developments SET/i.test(call.sql));
    assert.ok(update, 'the project row is updated');
    const extra = JSON.parse(update.params[1]);
    assert.strictEqual(extra.contact_mode, 'listing_request', 'the other extra fields are kept');
    assert.strictEqual(extra.project_updates.length, 2);
    const entry = extra.project_updates[1];
    assert.strictEqual(entry.status, 'pending_review');
    assert.strictEqual(entry.from, 'John Yan');
    assert.strictEqual(entry.caption, 'Vanta House is now at the 8th floor');
    assert.deepStrictEqual(entry.media.map((item) => [item.url, item.kind]), [['https://media.makaug.com/new.jpg', 'image'], ['https://media.makaug.com/new.mp4', 'video']], 'only stored media, never a data URL');
    assert.strictEqual(entry.property_id, '1a4bfcc8-31eb-4d9f-a773-1a9a0edee4a9');
    const event = calls.find((call) => /INSERT INTO off_plan_development_events/i.test(call.sql) && call.params.includes('developer_update_received'));
    assert.ok(event, 'the project log records the update');
    const link = calls.find((call) => /UPDATE properties SET extra_fields/i.test(call.sql));
    assert.ok(link, 'the review listing points at the project');
    assert.deepStrictEqual(link.params, ['1a4bfcc8-31eb-4d9f-a773-1a9a0edee4a9', '7a732f80-0e14-49d0-ac2d-7f972b373763', 'Vanta House', entry.id]);
  } finally {
    db.query = originalQuery;
  }
});

test('photos with no words from a developer are offered to their project first', () => {
  const notice = t.agentPendingNotice({
    ...KNOWN,
    pending_property_media: [{ kind: 'image', mimeType: 'image/jpeg', url: 'https://media.makaug.com/x.jpg', sha256: 'a' }, { kind: 'video', mimeType: 'video/mp4', url: 'https://media.makaug.com/y.mp4', sha256: 'b' }]
  });
  assert.match(notice, /Got your 1 photo and 1 video/);
  assert.match(notice, /for \*Vanta House\*, reply with a line about it/);
  assert.match(notice, /A different property\? Tell me what it is/);
});
