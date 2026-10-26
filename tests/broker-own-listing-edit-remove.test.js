'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const api = fs.readFileSync(path.join(__dirname, '../routes/agents.js'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '../assets/makaug-app.js'), 'utf8');

test('a broker can edit and remove only listings on their own profile', () => {
  assert(api.includes("router.patch('/me/listings/:id'"));
  assert(api.includes("router.post('/me/listings/:id/remove'"));
  const owner = api.slice(api.indexOf('async function loadOwnedBrokerListing'), api.indexOf("router.get('/me/listings/:id'"));
  assert(/agent_id = \$2::uuid OR/.test(owner), 'ownership is checked against the signed-in broker');
  assert(/role !== 'agent_broker'/.test(owner));
});

test('the dashboard Edit and Remove buttons call the API instead of only showing a toast', () => {
  assert(/apiRequest\(`\/api\/agents\/me\/listings\/\$\{encodeURIComponent\(id\)\}`, \{\s*method: "PATCH"/.test(app));
  assert(/\/remove`, \{\s*method: "POST"/.test(app));
  assert(!app.includes('Removal request noted for'));
});
