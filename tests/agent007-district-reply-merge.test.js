'use strict';

/**
 * 17 Oct 2026: Brian was asked which district Nakasaja is in and answered
 * "Wakiso district". Merged into the waiting caption the place resolved to
 * Gayaza, which no longer matched the waiting caption, so the reply was refused
 * as "a different property" and three properties stayed stuck behind it.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

process.env.NODE_ENV = 'test';
const router = require('../routes/whatsapp');
const { employeePropertyFacts, employeePropertyMissing, employeeCaptionLikelySameProperty } = router.__test;

const waiting = 'Plots for sale in Nakasaja Gayaza Road \n\nPlot size: 12 Decimals ( 50 X 100ft) = 45m ugx 25 Decimals ( 100 X 100ft) = 90m ugx with a good neighborhood Ready private mailo land title';

test('the waiting caption needs a district, and the district reply completes it', () => {
  assert.deepStrictEqual(employeePropertyMissing(employeePropertyFacts(waiting, {})), ['which district Nakasaja is in']);
  const merged = `${waiting}\nWakiso district`;
  assert.deepStrictEqual(employeePropertyMissing(employeePropertyFacts(merged, {})), []);
});

test('the merged caption can look like a different property, which is why a merge must not be judged that way', () => {
  const merged = `${waiting}\nWakiso district`;
  assert.strictEqual(employeeCaptionLikelySameProperty(waiting, merged, {}), false);
});

test('a reply merged into the waiting caption skips the "different property" refusal', () => {
  const src = fs.readFileSync(path.join(__dirname, '../routes/whatsapp.js'), 'utf8');
  assert(src.includes('mergedWithPendingCaption = true'));
  assert(src.includes('!mergedWithPendingCaption && pendingCaption && !employeeCaptionLikelySameProperty'));
});
