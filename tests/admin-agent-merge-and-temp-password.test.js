'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const src = fs.readFileSync(path.join(__dirname, '../routes/admin.js'), 'utf8');

test('admin can merge a duplicate agent into the one with the login', () => {
  assert(src.includes("router.post('/agents/:id/merge-into'"));
  const block = src.slice(src.indexOf("router.post('/agents/:id/merge-into'"), src.indexOf("router.post('/agents/:id/temporary-password'"));
  assert(/UPDATE properties[\s\S]*agent_id = \$2/.test(block), 'listings move to the target');
  assert(/removed_at = NOW\(\)/.test(block), 'the duplicate is retired');
  assert(!/queueAgentWelcomePack|sendWhatsapp|deliverWhatsapp/.test(block), 'merging sends nothing');
});

test('admin can set a temporary password that must be changed', () => {
  const block = src.slice(src.indexOf("router.post('/agents/:id/temporary-password'"), src.indexOf("router.post('/agents/:id/restore'"));
  assert(/bcrypt\.hash\(password, 12\)/.test(block));
  assert(/'force_password_change', true/.test(block));
  assert(!/queueAgentWelcomePack|sendWhatsapp|deliverWhatsapp|sendBroker/.test(block), 'setting a password sends nothing');
});

test('a WhatsApp-registered agent with no login gets a phone-only broker account', () => {
  const block = src.slice(src.indexOf("router.post('/agents/:id/temporary-password'"), src.indexOf("router.post('/agents/:id/restore'"));
  assert(/INSERT INTO users \(first_name, last_name, phone, email, role, password_hash/.test(block));
  assert(/'agent_broker'/.test(block));
  assert(/UPDATE agents SET user_id = \$2/.test(block));
});
