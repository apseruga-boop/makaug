'use strict';

// Agent management restored to King (26 Oct 2026): the Field Agent Control Centre
// that #575 removed is back, plus an Agents tab where staff can see, edit, soft-remove,
// restore and add agents and act on their listings. All writes are admin-only and audited.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const html = read('index.html');
const app = read('assets', 'makaug-app.js');
const adminRoutes = read('routes', 'admin.js');
const manager = require('../routes/adminAgentManager');

test('Agents and Field Agent Control Centre tabs are on the King page', () => {
  assert.match(html, /data-admin-tab-button="agents"/);
  assert.match(html, /data-admin-tab-button="field-agents"/);
  assert.match(html, /id="admin-agents-control"/);
  assert.match(html, /id="admin-agent-manager"/);
  assert.match(html, /id="admin-field-agent-control"/);
  assert.match(html, /id="admin-field-agents-table"/);
});

test('agent manager UI exposes the controls staff were missing', () => {
  for (const label of ['ID number (NIN)', 'Save changes', 'Save payment', 'Remove agent', 'Restore agent',
    'Take down', 'Mark sold', 'Mark let', 'Put back', 'Move to', 'Add agent', 'Missing ID only', 'Change history', 'Manage agent']) {
    assert.ok(app.includes(label), `UI should include "${label}"`);
  }
  assert.ok(app.includes('data-people-manage-agent'), 'People panel links agents to the manager');
  assert.ok(!/"field-agents":\s*"review"/.test(app.match(/const moved = \{[^}]+\}/)[0]), 'field-agents tab is no longer remapped');
});

test('agent manager routes sit behind the admin key guard', () => {
  const guard = adminRoutes.indexOf('router.use(requireAdminApiKey)');
  const mount = adminRoutes.indexOf('registerAgentManagerRoutes(router');
  assert.ok(guard > -1 && mount > guard, 'routes are registered after requireAdminApiKey');
  const router = express.Router();
  manager.registerAgentManagerRoutes(router, { db: { query: async () => ({ rows: [] }) }, writeAudit: async () => {}, adminActorId: () => null, cleanText: (v) => String(v || '').trim(), isValidEmail: () => true, normalizePhone: (v) => v, actorLabel: () => 'x', onListingsChanged: () => {} });
  const routes = router.stack.filter((l) => l.route).map((l) => `${Object.keys(l.route.methods)[0].toUpperCase()} ${l.route.path}`);
  for (const r of ['GET /agent-manager/agents', 'GET /agent-manager/agents/:id', 'PATCH /agent-manager/agents/:id',
    'POST /agent-manager/agents', 'POST /agent-manager/listings/:propertyId/state', 'POST /agent-manager/listings/:propertyId/move']) {
    assert.ok(routes.includes(r), `${r} registered`);
  }
  assert.ok(!routes.some((r) => r.startsWith('DELETE')), 'no hard-delete routes');
});

test('helpers: NIN is masked in audit, payment state is read correctly', () => {
  assert.equal(manager.maskNin(''), '');
  assert.equal(manager.maskNin('CM90012345ABCD'), '••••ABCD');
  assert.equal(manager.paymentState({ fee_exempt: true }).key, 'free');
  assert.equal(manager.paymentState({ paid_until: '2099-01-01' }).key, 'paid');
  assert.notEqual(manager.paymentState({}).key, 'paid');
  assert.ok(Object.keys(manager.LISTING_ACTIONS).includes('put_back'), 'listing actions are reversible');
});
