'use strict';
const test = require('node:test');
const assert = require('node:assert');
const docs = require('../services/listingDocsService');

test('private lister terms PDF, agent guide PDF and cover cards are generated', async () => {
  const settings = { lister_fee: { free_days: 7, monthly_ugx: 20000 }, agent_fee: { monthly_ugx: 50000 } };
  const terms = await docs.getDocument('lister_terms_pdf', settings);
  const guide = await docs.getDocument('agent_guide_pdf', settings);
  const cover = await docs.getDocument('lister_terms_cover', settings);
  assert.equal(terms.type, 'application/pdf');
  assert.equal(terms.body.slice(0, 4).toString(), '%PDF');
  assert.equal(guide.body.slice(0, 4).toString(), '%PDF');
  assert.equal(cover.type, 'image/png');
  assert.equal(cover.body.slice(1, 4).toString(), 'PNG');
});

test('terms WhatsApp message states the free week, the fee, ID privacy and asks for AGREE', () => {
  const text = docs.listerTermsMessage({ lister_fee: { free_days: 7, monthly_ugx: 20000 } }, { name: 'Mary' });
  assert.match(text, /7 days are free/);
  assert.match(text, /UGX 20,000 per property, per month/);
  assert.match(text, /never shown/);
  assert.match(text, /AGREE/);
  assert.match(text, /\/legal\/makaug-private-lister-terms\.pdf/);
});

test('agent guide caption links the PDF', () => {
  assert.match(docs.agentGuideCaption({ name: 'Amos' }), /\/legal\/makaug-agent-guide\.pdf/);
});
