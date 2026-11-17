'use strict';

// The Companion's CSV upload (King > Staff Performance > Today's numbers).
// Fixtures use only the TEST range +256 700 000 1xx. Never a real number.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parseCompanionCsv, splitCsv } = require('../utils/companionCsv');
const perf = require('../services/staffPerformance');
const calling = require('../services/callingScreen');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const CSV = '\uFEFFname,phone,what_they_posted,source\r\n'
  + 'TEST Kato Brian,0700000101,"3 bedroom house in Kira, UGX 1,200,000 a month",call_list\r\n'
  + '"TEST Nakato ""Grace""",256700000102,"Plot for sale\nMukono, 50x100",symo_group\r\n'
  + 'TEST Amina,+256 700 000 103,Apartment in Ntinda,found_online\r\n'
  + 'TEST Twice,0700 000 101,Same number again,call_list\r\n'
  + 'TEST Bad,0789,No real number,call_list\r\n'
  + ',,,\r\n'
  + 'TEST Agent,0700000104,Already an agent,call_list\r\n';

test('parses the Companion CSV: BOM, quotes, commas and new lines in fields, all phone forms', () => {
  const { lines, error } = parseCompanionCsv(CSV);
  assert.equal(error, '');
  assert.equal(lines.length, 6, 'blank row dropped, header not counted');
  assert.deepEqual(lines[0], { name: 'TEST Kato Brian', phone: '0700000101', what_they_posted: '3 bedroom house in Kira, UGX 1,200,000 a month', source: 'call_list' });
  assert.equal(lines[1].name, 'TEST Nakato "Grace"');
  assert.equal(lines[1].what_they_posted, 'Plot for sale Mukono, 50x100', 'new line inside quotes kept as a space');
  assert.equal(lines[2].phone, '+256 700 000 103');
  assert.equal(lines[2].source, 'found_online');
});

test('headers in any order or case, ; separators, and a clear error with no phone column', () => {
  const a = parseCompanionCsv('Source;Phone;Name\ncall_list;0700000105;TEST X\n');
  assert.equal(a.lines[0].phone, '0700000105'); assert.equal(a.lines[0].name, 'TEST X'); assert.equal(a.lines[0].what_they_posted, '');
  assert.match(parseCompanionCsv('name,email\nTEST,x@y.z\n').error, /phone/);
  assert.match(parseCompanionCsv('').error, /empty/);
  assert.equal(splitCsv('a,b\n"x,1","y"\n').length, 2);
});

test('same dedupe and refusal reasons as the paste; keeps what they posted, source and file order', () => {
  const { lines } = parseCompanionCsv(CSV);
  const out = perf.dedupeList(lines, {
    sent: new Map([['700000103', 'film sent 2026-11-10 by Sharon']]),
    agents: new Set(['700000104']),
    listed: new Map(), doNotContact: new Set(), foundOnline: new Set(['700000102'])
  });
  const by = (n) => out.find((o) => o.name === n);
  assert.equal(by('TEST Kato Brian').accepted, true);
  assert.equal(by('TEST Kato Brian').phone_key, '700000101');
  assert.equal(by('TEST Kato Brian').what_they_posted, '3 bedroom house in Kira, UGX 1,200,000 a month');
  assert.equal(by('TEST Kato Brian').list_source, 'call_list');
  assert.equal(by('TEST Nakato "Grace"').lead_source, 'found_online');
  assert.equal(by('TEST Amina').refused_reason, 'duplicate_sent');
  assert.equal(by('TEST Twice').refused_reason, 'duplicate_list');
  assert.equal(by('TEST Bad').refused_reason, 'invalid');
  assert.equal(by('TEST Agent').refused_reason, 'existing_agent');
  assert.deepEqual(out.map((o) => o.list_order), [1, 2, 3, 4, 5, 6]);
});

test('ranking: every Companion list number has one score (found online no longer reorders), list day ASC then upload order', () => {
  assert.equal(calling.moneyScore({ source_kind: 'list', found_online: true }), calling.moneyScore({ source_kind: 'list', found_online: false }));
  const src = read('services/callingScreen.js');
  assert.match(src, /ORDER BY list_day ASC, added_at ASC, list_order ASC NULLS LAST/);
  assert.match(src, /What they posted: /);
});

test('the King form has Upload CSV, the route passes the file text only, migration 239 has a rollback', () => {
  const app = read('assets/makaug-app.js');
  assert.match(app, /data-perf-csv/); assert.match(app, /staffPerfUploadCsv/);
  assert.match(read('routes/staffPerformance.js'), /csv: String\(req\.body\?\.csv/);
  const mig = read('db/migrations/239_outreach_list_csv_fields.sql');
  assert.match(mig, /Rollback/); assert.match(mig, /what_they_posted/); assert.match(mig, /list_source/);
  assert.doesNotMatch(read('utils/companionCsv.js') + read('tests/companion-csv-upload.test.js'), /(?<!700000)\b07[5-9]\d{7}\b/);
});
