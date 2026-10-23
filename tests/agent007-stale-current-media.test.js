'use strict';

/**
 * 23 Oct 2026: Brian's Namugongo photos and videos (sent hours after his Kiwatule
 * property) were attached to Kiwatule because it was still the current property.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const src = fs.readFileSync(path.join(__dirname, '../routes/whatsapp.js'), 'utf8');

test('captionless media long after the last message no longer joins the old current property', () => {
  assert(src.includes('EMPLOYEE_STALE_CURRENT_PROPERTY_MS = 20 * 60 * 1000'));
  assert(src.includes('nowMs - previousActivityMs > EMPLOYEE_STALE_CURRENT_PROPERTY_MS'));
  const guard = src.indexOf('nowMs - previousActivityMs > EMPLOYEE_STALE_CURRENT_PROPERTY_MS');
  const burst = src.indexOf('const heldFromBurst = !caption');
  assert(guard > 0 && guard < burst, 'the stale check must run before the held-from-burst decision');
});

test('only agents sending their own properties are affected, not staff batches', () => {
  const idx = src.indexOf('data.whatsapp_agent_self_intake === true\n      && previousActivityMs');
  assert(idx > 0);
});
