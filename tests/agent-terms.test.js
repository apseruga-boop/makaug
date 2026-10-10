'use strict';

// 10 Oct 2026: new agents are sent the agent terms in the welcome pack and
// reply AGREE; the acceptance is recorded and the trial tracker shows who has
// not signed yet.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const terms = require('../services/agentTermsService');
const docs = require('../services/listingDocsService');
const billing = require('../services/billingOpsService');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('AGREE is recognised, other words are not', () => {
  for (const ok of ['AGREE', 'agree', ' I agree ', 'Agree!', 'agreed 👍']) assert.ok(terms.isAgreeReply(ok), ok);
  for (const no of ['I do not agree', 'agree to what?', 'hello', '']) assert.ok(!terms.isAgreeReply(no), no);
});

test('an acceptance is recorded once and a second AGREE reports the first', async () => {
  const rows = [];
  const db = { query: async (sql, params) => {
    if (/INSERT INTO audit_logs/.test(sql)) { rows.push(params); return { rows: [] }; }
    return { rows: rows.length ? [{ created_at: new Date('2026-10-10T09:00:00Z') }] : [] };
  } };
  const agent = { id: 'a1', full_name: 'Jane Nakato' };
  const first = await terms.recordAcceptance(db, { agent, phone: '256772123456' });
  assert.strictEqual(first.recorded, true);
  assert.strictEqual(JSON.parse(rows[0][2]).version, docs.AGENT_TERMS_VERSION);
  const second = await terms.recordAcceptance(db, { agent, phone: '256772123456' });
  assert.strictEqual(second.recorded, false);
  assert.strictEqual(rows.length, 1);
  assert.match(terms.thanksMessage({ name: 'Jane' }), /accepted/);
  assert.match(terms.thanksMessage({ name: 'Jane', repeat: true }), /already accepted/);
});

test('the terms PDF and cover are built and served', async () => {
  const pdf = await docs.getDocument('agent_terms_pdf', {});
  assert.strictEqual(pdf.type, 'application/pdf');
  assert.ok(pdf.body.length > 2000);
  assert.strictEqual(pdf.body.slice(0, 4).toString(), '%PDF');
  const cover = await docs.getDocument('agent_terms_cover', {});
  assert.strictEqual(cover.type, 'image/png');
  assert.match(read('routes/legalDocs.js'), /makaug-agent-terms\.pdf/);
  assert.match(docs.docUrls('agent_terms').pdf, /makaug-agent-terms\.pdf/);
});

test('the caption names no fee or free period; the PDF is where it is stated', () => {
  const caption = docs.agentTermsCaption({ name: 'Jane' });
  assert.ok(!/free|UGX|14 days/i.test(caption));
  assert.match(caption, /Reply \*AGREE\*/);
});

test('the welcome pack sends the terms and an agent can AGREE', () => {
  assert.match(read('routes/admin.js'), /message_kind: 'agent_terms_pdf'/);
  const wa = read('routes/whatsapp.js');
  assert.match(wa, /AGENT_TERMS_AGREE\.isAgreeReply\(askedText\)/);
  assert.match(wa, /recordAcceptance\(db, \{ agent: askingAgent, phone \}\)/);
});

test('the tracker flags agents who have not signed', () => {
  const base = { name: 'Jane', phone: '0772', state: 'on_trial', days_left: 9, ends: '2026-10-23' };
  assert.match(billing.formatTrialLine(base), /terms not signed yet/);
  assert.ok(!/terms not signed/.test(billing.formatTrialLine({ ...base, terms_accepted_at: new Date() })));
});

test('staff can preview the welcome pack as a trial agent sees it, without touching a real agent', () => {
  const admin = read('routes/admin.js');
  assert.match(admin, /preview_trial/);
  assert.match(admin, /if \(preview && previewTrial\) pack = agentReportVideos\.trialVariant\(pack\)/);
  const video = require('../services/agentReportVideoService');
  const v = video.trialVariant({ agent: { id: 'a2', full_name: 'Old Agent' } });
  assert.strictEqual(v.agent.fee_offer_mode, 'free_period');
  assert.ok(video.welcomeDuration(v) > video.welcomeDuration({ agent: { id: 'a2' } }));
});
