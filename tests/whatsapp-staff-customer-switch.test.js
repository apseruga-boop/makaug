'use strict';

/**
 * Three hats, one number. Ronald and Arthur post properties, run billing and
 * test the marketplace from the same WhatsApp, and until 1 Nov 2026 every
 * "Hello" or "Menu" brought the Agent 007 card back with no way to be a
 * customer. CUSTOMER switches the number to the customer script; STAFF (or
 * starting an Agent 007 batch) switches it back.
 */

const test = require('node:test');
const assert = require('node:assert');

const route = require('../routes/whatsapp').__test;
const { staffIntakeGreetingReply, staffMenuReply, staffModeSwitchReply, isStaffCustomerMode, isStaffIntakeNumber } = route;

const RONALD = '+256709402189';
const STRANGER = '+256700111222';
const afterABatch = {
  language: 'en',
  session_data: {
    employee_intake_last_completed_at: '2026-10-31T07:53:56.000Z',
    employee_intake_last_subject_name: 'Charles Otheno',
    employee_intake_last_properties_set_up: 9
  }
};

test('hello from staff shows the staff menu, with the customer switch on it', () => {
  const reply = staffIntakeGreetingReply({ phone: RONALD, session: afterABatch, cleanBody: 'Hello' });
  assert.match(reply, /Staff menu/);
  assert.match(reply, /Agent 007/);
  assert.match(reply, /\*CUSTOMER\*/);
  assert.match(reply, /\*STAFF\*/);
  assert.match(reply, /Charles Otheno/);
  assert.match(reply, /9 properties/);
  assert.strictEqual(staffMenuReply(), staffIntakeGreetingReply({ phone: RONALD, session: afterABatch, cleanBody: 'Menu' }).replace(/\n\nLast batch:.*$/s, ''));
});

test('a stranger saying hello is not staff and gets nothing from the switch', async () => {
  assert.strictEqual(isStaffIntakeNumber({ phone: STRANGER, session: { session_data: {} } }), false);
  assert.strictEqual(await staffModeSwitchReply({ phone: STRANGER, session: { session_data: {} }, cleanBody: 'CUSTOMER' }), null);
  assert.strictEqual(await staffModeSwitchReply({ phone: STRANGER, session: { session_data: {} }, cleanBody: 'STAFF' }), null);
});

test('customer mode is read from the session and ends on STAFF or Agent 007', () => {
  assert.strictEqual(isStaffCustomerMode({ session_data: { staff_customer_mode: true } }), true);
  assert.strictEqual(isStaffCustomerMode({ session_data: { staff_customer_mode: null } }), false);
  assert.strictEqual(isStaffCustomerMode(afterABatch), false);
  assert.strictEqual(isStaffIntakeNumber({ phone: STRANGER, session: { session_data: { staff_customer_mode: true } } }), true, 'a number in customer mode is staff (only staff can get there)');
});

test('the pipeline hands customer-mode messages to the customer script and keeps STAFF/CUSTOMER for itself', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '../routes/whatsapp.js'), 'utf8');
  const fn = src.slice(src.indexOf('async function handleEmployeeWhatsappIntake('), src.indexOf('const allowed = isOwnAgentSelfIntake(session, phone)'));
  const switchAt = fn.indexOf('staffModeSwitchReply({ phone, session, cleanBody })');
  const bypassAt = fn.indexOf('if (isStaffCustomerMode(session)) return { handled: false };');
  const greetingAt = fn.indexOf('staffIntakeGreetingReply({ phone, session, cleanBody })');
  assert.ok(switchAt > 0 && bypassAt > switchAt && greetingAt > bypassAt, 'switch, then bypass, then the staff greeting');
  assert.ok(fn.includes('if (triggered && isStaffCustomerMode(session))'), 'Agent 007 leaves customer mode');
});
