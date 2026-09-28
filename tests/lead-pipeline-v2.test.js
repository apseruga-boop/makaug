'use strict';

// Lead pipeline v2 — the rules that do not need a database.
// The full journey (HTTP → DB → WhatsApp queue) is scripts/test-lead-pipeline-e2e.js.

const test = require('node:test');
const assert = require('node:assert');

const {
  buildLeadDedupeKey,
  normalizeLeadStatus,
  phoneKey,
  isTestLeadInput,
  OPEN_LEAD_STATUSES
} = require('../services/leadService');
const { buildListerMessage, buildSeekerMessage } = require('../services/leadHandoffService');
const { leadHoneypot } = require('../middleware/leadGuard');

test('one phone number, however it is typed', () => {
  assert.strictEqual(phoneKey('0772 123 456'), '772123456');
  assert.strictEqual(phoneKey('+256772123456'), '772123456');
  assert.strictEqual(phoneKey('256-772-123-456'), '772123456');
  assert.strictEqual(phoneKey('12345'), null);
});

test('the same person asking about the same listing is one lead', () => {
  const base = { leadType: 'enquiry', listingId: 'L1', phone: '0772123456' };
  assert.strictEqual(buildLeadDedupeKey(base), buildLeadDedupeKey({ ...base, phone: '+256 772 123456' }));
  // A WhatsApp click and a viewing request from the same person: same interest.
  assert.strictEqual(buildLeadDedupeKey(base), buildLeadDedupeKey({ ...base, leadType: 'viewing' }));
  assert.notStrictEqual(buildLeadDedupeKey(base), buildLeadDedupeKey({ ...base, listingId: 'L2' }));
  assert.notStrictEqual(buildLeadDedupeKey(base), buildLeadDedupeKey({ ...base, phone: '0772999999' }));
  // Anonymous clicks dedupe on the browser's visitor id.
  assert.ok(buildLeadDedupeKey({ leadType: 'enquiry', listingId: 'L1', visitorId: 'v1' }));
  // Support and career leads are never merged.
  assert.strictEqual(buildLeadDedupeKey({ leadType: 'support', phone: '0772123456' }), null);
});

test('lead statuses are one canonical set', () => {
  assert.strictEqual(normalizeLeadStatus('New'), 'open');
  assert.strictEqual(normalizeLeadStatus('closed_won'), 'won');
  assert.strictEqual(normalizeLeadStatus('handed over'), 'handed_over');
  assert.strictEqual(normalizeLeadStatus('banana', null), null);
  assert.deepStrictEqual([...OPEN_LEAD_STATUSES], ['open', 'handed_over', 'contacted', 'qualified']);
});

test('admin self-checks and QA are test leads', () => {
  assert.ok(isTestLeadInput({}, 'admin_viewing_test'));
  assert.ok(isTestLeadInput({ metadata: { launch_proof: true } }, 'web'));
  assert.ok(!isTestLeadInput({}, 'listing_detail_whatsapp'));
  assert.ok(!isTestLeadInput({}, 'contest_page')); // "test" inside a word is not a test
});

test('the lister gets who, how to reach them, and which listing', () => {
  const text = buildListerMessage({
    kind: 'viewing',
    listing: { id: 'abc', title: '3 bed in Kira', inquiry_reference: 'MK-20260928-ABCD' },
    seeker: { name: 'Grace', phone: '0772123456', email: 'g@example.com' },
    message: 'Saturday?',
    extra: { preferred_date: '2026-10-03', preferred_time: '10:00' }
  });
  assert.match(text, /Viewing request/);
  assert.match(text, /Grace/);
  assert.match(text, /0772123456/);
  assert.match(text, /MK-20260928-ABCD/);
  assert.match(text, /2026-10-03 10:00/);
  assert.match(text, /does not take part in the conversation/);
});

test('the seeker gets the lister\'s contact and the safety line', () => {
  const text = buildSeekerMessage({
    kind: 'enquiry',
    listing: { id: 'abc', title: '3 bed in Kira' },
    lister: { name: 'Francis', phone: '0701000001' },
    seeker: { name: 'Grace Namata' }
  });
  assert.match(text, /^Hi Grace,/);
  assert.match(text, /sent to Francis/);
  assert.match(text, /wa\.me\/256701000001/);
  assert.match(text, /Never pay before/);
});

test('honeypot swallows bots and caps long fields', () => {
  let status = null;
  let nextCalled = false;
  const res = { status(code) { status = code; return this; }, json() { return this; } };
  leadHoneypot({ body: { website: 'http://spam' } }, res, () => { nextCalled = true; });
  assert.strictEqual(status, 201);
  assert.strictEqual(nextCalled, false);

  const req = { body: { message: 'x'.repeat(5000), contact_name: 'y'.repeat(500) } };
  leadHoneypot(req, res, () => { nextCalled = true; });
  assert.ok(nextCalled);
  assert.strictEqual(req.body.message.length, 2000);
  assert.strictEqual(req.body.contact_name.length, 120);
});
