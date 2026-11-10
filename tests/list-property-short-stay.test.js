'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const service = require('../services/shortTermService');
const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

const html = read('index.html');
const app = read('assets/makaug-app.js');
const route = read('routes/short-term.js');

test('list-property offers a Short stay type and the mockup fields', () => {
  assert.match(html, /data-list-choice-type="short_stay"/);
  assert.match(html, /data-lp-type-chip="short_stay"/);
  assert.match(html, /id="lp-short-stay-panel"/);
  assert.match(html, /id="lp-st-nightly"/);
  assert.match(html, /Leave blank for price on application/);
  assert.match(html, /id="lp-st-guests"/);
  assert.match(html, /id="lp-st-bedrooms"/);
  assert.match(html, /id="lp-st-district"/);
  assert.match(html, /id="lp-st-area"/);
  assert.match(html, /No stock photos/);
  assert.match(html, /id="lp-st-rules"/);
  assert.match(html, /I own this place or have the owner's permission to let it for short stays/);
  assert.match(html, /id="lp-st-right-to-let"/);
  assert.match(html, /Owners pay UGX 20,000 a month/);
  assert.match(html, /Agents pay UGX 50,000 a month/);
  assert.match(html, /no free trial and no free days/i);
  assert.match(html, /Short stays review desk/);
  assert.match(html, /id="broker-short-stay-note"/);
  assert.match(html, /Agents can list short stays/);
  assert.match(app, /function submitListPropertyShortStay/);
  assert.match(app, /listed_from: "list-property"/);
  assert.match(app, /price_on_application: nightlyRaw === ""/);
  assert.match(app, /"short_stay"/);
  assert.match(route, /agent_broker/);
  assert.match(route, /listed_from/);
});

test('a blank nightly price is stored as POA and a generated title is enough', () => {
  const result = service.validateListingSubmission({
    district: 'Kampala',
    area: 'Kololo',
    bedrooms: 1,
    max_guests: 3,
    base_nightly_ugx: '',
    house_rules: 'No parties after 10pm.',
    host_name: 'Amina N',
    host_phone: '0780863394',
    right_to_let_declared: true,
    terms_accepted: true
  });
  assert.equal(result.ok, true, result.errors && result.errors.join('; '));
  assert.equal(result.value.price_on_application, true);
  assert.equal(result.value.base_nightly_ugx, 0);
  assert.match(result.value.title, /Kololo/);
  assert.ok(result.value.description.length >= 40);
  assert.doesNotMatch(result.value.description, /\/month|per month|monthly|price on application/i);
});

test('a priced short stay is not marked POA', () => {
  const result = service.validateListingSubmission({
    title: 'Quiet two bedroom apartment in Naguru',
    description: 'A bright, quiet two bedroom flat with secure parking and backup power, ten minutes from the city.',
    district: 'Kampala',
    area: 'Naguru',
    host_name: 'Sarah N',
    host_phone: '0780863394',
    base_nightly_ugx: 180000,
    right_to_let_declared: true,
    terms_accepted: true
  });
  assert.equal(result.ok, true, result.errors && result.errors.join('; '));
  assert.equal(result.value.price_on_application, false);
  assert.equal(result.value.base_nightly_ugx, 180000);
});

function fakeDb() {
  const queries = [];
  const client = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (/nextval/.test(sql)) return { rows: [{ n: 88 }] };
      if (/FROM agents/.test(sql)) return { rows: [] };
      if (/INSERT INTO st_listing \(/.test(sql)) {
        return { rows: [{ id: '22222222-2222-2222-2222-222222222222', reference: 'ST-000088', slug: 'stay', status: 'pending', moderation_stage: 'submitted', listed_via: 'website' }] };
      }
      return { rows: [] };
    },
    release() {}
  };
  return { queries, db: { getClient: async () => client } };
}

test('list-property submissions land on the desk as pending direct listings with a right-to-let timestamp', async () => {
  const { queries, db } = fakeDb();
  const created = await service.createShortTermListing(db, {
    district: 'Wakiso',
    area: 'Entebbe',
    bedrooms: 2,
    max_guests: 4,
    base_nightly_ugx: '',
    host_name: 'Harriet',
    host_phone: '0780863394',
    house_rules: 'No smoking indoors.',
    right_to_let_declared: true,
    terms_accepted: true,
    listed_from: 'list-property'
  }, { hostUserId: 'user-1' });
  assert.equal(created.status, 'pending');
  assert.equal(created.moderation_stage, 'submitted');
  const insert = queries.find((query) => /INSERT INTO st_listing \(/.test(query.sql));
  assert.ok(insert);
  assert.match(insert.sql, /'pending','submitted'/);
  assert.match(insert.sql, /'direct'/);
  assert.doesNotMatch(insert.sql, /found-online|imported/);
  const extra = insert.params[insert.params.length - 1];
  assert.equal(extra.price_on_application, true);
  assert.ok(extra.right_to_let_declared_at);
  assert.equal(extra.listed_from, 'list-property');
  assert.equal(insert.params[29], 'user-1');
});
