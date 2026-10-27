'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.ADMIN_API_KEY = 'fixture-cto-manager-admin-key';
process.env.JWT_SECRET = 'fixture-cto-manager-auth-secret-not-production';
const USER_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const AGENT_ID = 'bbbbbbbb-0000-4000-8000-000000000001';
const PROPERTY_ID = 'cccccccc-0000-4000-8000-000000000001';
const REQUEST_ID = 'dddddddd-0000-4000-8000-000000000001';
let authLookups = 0;
let memberRole = 'buyer_renter';
const authenticationDb = {
  async query(sql, values) {
    assert.match(sql, /FROM users WHERE id = \$1/);
    assert.equal(values[0], USER_ID);
    authLookups += 1;
    return { rows: [{ id: USER_ID, role: memberRole, status: 'active', first_name: 'Fixture', last_name: 'Member' }] };
  }
};
require.cache[require.resolve('../config/database')] = { id: 'database', filename: 'database', loaded: true, exports: authenticationDb };
const { requireAdminApiKey } = require('../middleware/auth');
const { registerAgentManagerRoutes } = require('../routes/adminAgentManager');

function buildApp() {
  const queries = [];
  let transactions = 0;
  const db = {
    async query(sql, values) {
      const text = String(sql).replace(/\s+/g, ' ');
      queries.push({ sql: text, values });
      if (/COUNT\(\*\)::int AS total FROM properties p/.test(text)) return { rows: [{ total: 1 }] };
      if (/FROM agents a LEFT JOIN users u/.test(text)) return { rows: [{ id: AGENT_ID, full_name: 'Fixture Agent', status: 'approved', phone: '0780123456', nin: 'CM123', districts_covered: [], specializations: [] }] };
      if (/FROM properties p/.test(text)) return { rows: [{ id: PROPERTY_ID, title: 'Fixture direct listing', status: 'approved', lister_name: 'Fixture Owner', lister_phone: '0780234567', lifetime_paid_ugx: 10000, payment_count: 1 }] };
      if (/FROM revenue_entries/.test(text)) return { rows: /SUM\(amount_ugx\)/.test(text) ? [{ lifetime_paid_ugx: 10000, payment_count: 1, last_payment_on: '2026-10-27', last_payment_ugx: 10000 }] : [{ id: REQUEST_ID, amount_ugx: 10000, method: 'cash', paid_at: '2026-10-27' }] };
      if (/FROM (analytics_events|leads|audit_logs|agent_identity_files)/.test(text) || /FROM agents a/.test(text)) return { rows: [] };
      throw new Error(`Unhandled local query: ${text}`);
    },
    async getClient() {
      transactions += 1;
      throw new Error('This auth test must not write payments');
    }
  };
  const router = express.Router();
  router.use(requireAdminApiKey);
  registerAgentManagerRoutes(router, {
    db, writeAudit: async () => {}, adminActorId: (req) => req.adminAuth?.userId || 'admin_api_key',
    cleanText: (value) => String(value || '').trim(), isValidEmail: () => true,
    normalizePhone: (value) => value, actorLabel: () => 'Fixture Admin', onListingsChanged: () => {}
  });
  const app = express();
  app.use(express.json());
  app.use('/api/admin', router);
  app.use((error, _req, res, _next) => res.status(500).json({ ok: false, error: error.message }));
  return { app, queries, transactionCount: () => transactions };
}
const READ_PATHS = [
  `/api/admin/agent-manager/agents/${AGENT_ID}?payments_page=1&payments_limit=25`,
  '/api/admin/agent-manager/public',
  '/api/admin/agent-manager/public/candidates?search=Fixture',
  `/api/admin/agent-manager/public/${PROPERTY_ID}?payments_page=1&payments_limit=25`
];
const WRITE_PATHS = [
  `/api/admin/agent-manager/agents/${AGENT_ID}/payments`,
  `/api/admin/agent-manager/public/${PROPERTY_ID}/payments`
];
const payment = { amount_ugx: 10000, method: 'cash', paid_at: '2026-10-27', request_id: REQUEST_ID };

for (const caller of ['anonymous', 'wrong API key', 'buyer member', 'agent member', 'moderator member', 'forged admin token']) {
  test(`real admin middleware denies ${caller} before any payment or roster query`, async () => {
    const { app, queries, transactionCount } = buildApp();
    const before = authLookups;
    memberRole = caller === 'agent member' ? 'agent_broker' : caller === 'moderator member' ? 'moderator' : 'buyer_renter';
    const headers = caller === 'wrong API key' ? { 'x-api-key': 'incorrect' }
      : /member/.test(caller) ? { Authorization: `Bearer ${jwt.sign({ sub: USER_ID }, process.env.JWT_SECRET)}` }
        : caller === 'forged admin token' ? { Authorization: `Bearer ${jwt.sign({ sub: USER_ID, role: 'super_admin' }, 'wrong-signing-key')}` } : {};
    for (const route of READ_PATHS) {
      const response = await request(app).get(route).set(headers);
      assert.equal(response.status, 401, `${caller}: GET ${route}`);
      assert.equal(response.body.error, 'Unauthorized');
    }
    for (const route of WRITE_PATHS) {
      const response = await request(app).post(route).set(headers).send(payment);
      assert.equal(response.status, 401, `${caller}: POST ${route}`);
      assert.equal(response.body.error, 'Unauthorized');
    }
    assert.equal(queries.length, 0, 'no agent, public roster, ledger or audit data reached');
    assert.equal(transactionCount(), 0, 'no payment transaction acquired');
    assert.equal(authLookups - before, /member/.test(caller) ? READ_PATHS.length + WRITE_PATHS.length : 0, 'only signed member identity lookups use the authentication DB');
  });
}

test('a valid admin API key passes the real middleware and reads every new dashboard endpoint', async () => {
  const { app, queries, transactionCount } = buildApp();
  const before = authLookups;
  const responses = [];
  for (const route of READ_PATHS) {
    const response = await request(app).get(route).set('x-api-key', process.env.ADMIN_API_KEY);
    assert.equal(response.status, 200, `${route}: ${JSON.stringify(response.body)}`);
    assert.equal(response.body.ok, true);
    responses.push(response.body);
  }
  assert.equal(responses[0].data.agent.id, AGENT_ID);
  assert.equal(responses[0].data.payment_summary.lifetime_paid_ugx, 10000);
  assert.equal(responses[1].data[0].id, PROPERTY_ID);
  assert.equal(responses[2].data[0].id, PROPERTY_ID);
  assert.equal(responses[3].data.listing.id, PROPERTY_ID);
  assert.equal(responses[3].data.payments[0].amount_ugx, 10000);
  assert.ok(queries.length > 0, 'authorized handlers read the local fixture DB');
  assert.equal(authLookups, before, 'API key path does not invent a signed-in member');
  assert.equal(transactionCount(), 0, 'GET endpoints do not acquire a payment transaction');
});
