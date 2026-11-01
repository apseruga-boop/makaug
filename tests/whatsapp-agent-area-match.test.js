'use strict';

/**
 * "Kireka" → "I do not have a verified agent matching that area right now"
 * (1 Nov 2026), while brokers who work Wakiso were live. They list the
 * district, not every suburb, and the keyword search only read the typed
 * word. The place now resolves to its district and town, and a broker with
 * live listings there counts even if their coverage list is empty.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const route = require('../routes/whatsapp').__test;

test('a suburb brings its district and town into the broker search', () => {
  const kireka = route.extractAgentSearchKeywords('Kireka');
  assert.ok(kireka.includes('Wakiso'), JSON.stringify(kireka));
  assert.ok(kireka.includes('Kireka'));
  const ntinda = route.extractAgentSearchKeywords('Ntinda');
  assert.ok(ntinda.includes('Kampala'), JSON.stringify(ntinda));
  assert.ok(route.extractAgentSearchKeywords('Mbarara').includes('Mbarara'));
  assert.deepStrictEqual(route.extractAgentSearchKeywords(''), []);
});

test('a broker with live listings in the place matches even with no coverage list', () => {
  const src = fs.readFileSync(path.join(__dirname, '../routes/whatsapp.js'), 'utf8');
  const q = src.slice(src.indexOf('async function queryPublicAgentsForWhatsapp('), src.indexOf('async function findAllAgentsForWhatsapp('));
  assert.match(q, /FROM properties lp[\s\S]*lp\.status = 'approved'[\s\S]*lp\.district[\s\S]*lp\.area/);
});
