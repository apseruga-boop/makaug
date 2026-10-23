'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const service = require('../services/shortTermService');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

const payload = {
  title: 'Quiet cottage',
  description: 'A quiet cottage with a gate, water and a bed for two guests near the lake.',
  district: 'Wakiso',
  area: 'Entebbe',
  host_name: 'Harriet',
  host_phone: '0780863394',
  base_nightly_ugx: 120000,
  right_to_let_declared: true,
  terms_accepted: true
};

function fakeDb(agentRow) {
  const queries = [];
  const client = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (/nextval/.test(sql)) return { rows: [{ n: 7 }] };
      if (/FROM agents/.test(sql)) return { rows: agentRow ? [agentRow] : [] };
      if (/INSERT INTO st_listing \(/.test(sql)) {
        return { rows: [{ id: '11111111-1111-1111-1111-111111111111', reference: 'ST-000007', slug: 'quiet', status: 'pending', moderation_stage: 'submitted', listed_via: 'website' }] };
      }
      return { rows: [] };
    },
    release() {}
  };
  return { queries, db: { getClient: async () => client } };
}

test('an ordinary short stay is UGX 20,000 for one month with no free days', async () => {
  const { queries, db } = fakeDb(null);
  const created = await service.createShortTermListing(db, payload, {});
  assert.strictEqual(created.listing_fee_ugx, 20000);
  assert.strictEqual(created.listing_term_months, 1);
  assert.strictEqual(created.listing_free_days, 0);
  assert.strictEqual(created.listing_fee_status, 'unpaid');
  assert.strictEqual(created.listing_fee_included_in_agent_plan, false);
  const payment = queries.find((query) => /INSERT INTO st_listing_payment/.test(query.sql));
  assert.deepStrictEqual(payment.params.slice(1, 6), [20000, 'mtn_mobile_money', 'initiated', '1', service.SHORT_STAY_FEE_NOTE]);
  assert.match(payment.sql, /\(\$5 \|\| ' months'\)::interval/);
});

test('a self-declared agent who is not an approved agent still pays UGX 20,000', async () => {
  const { db } = fakeDb(null);
  const created = await service.createShortTermListing(db, { ...payload, host_type: 'agent' }, {});
  assert.strictEqual(created.listing_fee_ugx, 20000);
  assert.strictEqual(created.listing_fee_included_in_agent_plan, false);
});

test('an approved agent matched by phone has the short stay included', async () => {
  const { queries, db } = fakeDb({ id: 'agent-1', full_name: 'Amos Kato' });
  const created = await service.createShortTermListing(db, payload, {});
  assert.strictEqual(created.listing_fee_ugx, 0);
  assert.strictEqual(created.listing_fee_status, 'waived');
  assert.strictEqual(created.listing_fee_display, 'Included in the agent plan');
  assert.strictEqual(created.listing_fee_included_in_agent_plan, true);
  const payment = queries.find((query) => /INSERT INTO st_listing_payment/.test(query.sql));
  assert.strictEqual(payment.params[1], 0);
  assert.strictEqual(payment.params[3], 'waived');
  assert.match(payment.params[5], /Amos Kato/);
  assert.match(payment.params[5], /UGX 50,000 a month/);
  const agentQuery = queries.find((query) => /FROM agents/.test(query.sql));
  assert.match(agentQuery.sql, /status = 'approved'/);
  assert.match(agentQuery.sql, /removed_at IS NULL/);
});

test('migration 158 reprices only unpaid short stays and cancels open UGX 50,000 links', () => {
  const sql = read('db', 'migrations', '158_short_stay_monthly_fee.sql');
  assert.match(sql, /ALTER COLUMN listing_fee_ugx SET DEFAULT 20000/);
  assert.match(sql, /ALTER COLUMN listing_term_months SET DEFAULT 1/);
  assert.match(sql, /listing_fee_status IN \('unpaid', 'pending'\)/);
  assert.match(sql, /listing_fee_ugx = 50000/);
  assert.match(sql, /purpose = 'short_term_fee'/);
  assert.match(sql, /status = 'cancelled'/);
  assert.doesNotMatch(sql, /listing_fee_status IN \('paid'/);
  assert.doesNotMatch(sql, /UPDATE st_listing\s+SET[\s\S]*listing_fee_status = 'paid'/);
});

test('live copy no longer sells a short stay as UGX 50,000 for 3 months', () => {
  const files = [
    'services/shortTermService.js',
    'services/payLinkService.js',
    'routes/short-term.js',
    'server.js',
    'assets/short-term.js',
    'services/listingDocsService.js',
    'routes/whatsapp.js'
  ];
  const live = files.map((file) => read(file)).join('\n');
  assert.doesNotMatch(live, /UGX 50,000 for 3 months/i);
  assert.doesNotMatch(live, /50,000 for a 3 month/i);
  assert.doesNotMatch(live, /flat UGX 50,000 for three months/i);
  assert.match(read('server.js'), /UGX 20,000 a Month/);
  assert.match(read('services/listingDocsService.js'), /ordinary listers pay UGX 20,000 a month from approval, with no free days/);
  assert.match(read('services/listingDocsService.js'), /Your first \$\{s\.freeDays\} days are free/);
  assert.match(read('routes/whatsapp.js'), /first 7 days free/);
  assert.match(read('routes/whatsapp.js'), /ordinary listers pay UGX 20,000 a month, with no free days/);
});
