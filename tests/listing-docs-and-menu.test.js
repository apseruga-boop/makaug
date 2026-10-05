'use strict';
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert');
const commercialCatalog = require('../config/aboutCommercialProducts');
const billing = require('../services/billingOpsService');
const docs = require('../services/listingDocsService');

test('private lister terms PDF, agent guide PDF and cover cards are generated', async () => {
  const settings = { lister_fee: { free_days: 7, monthly_ugx: 25000 }, agent_fee: { monthly_ugx: 50000 } };
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
  const text = docs.listerTermsMessage({ lister_fee: { free_days: 7, monthly_ugx: 25000 } }, { name: 'Mary' });
  assert.match(text, /7 days are free/);
  assert.match(text, /UGX 25,000 per property, per month/);
  assert.match(text, /never shown/);
  assert.match(text, /AGREE/);
  assert.match(text, /\/legal\/makaug-private-lister-terms\.pdf/);
});

test('private listing document defaults come from the commercial catalog', () => {
  assert.equal(commercialCatalog.products.privateListing.amount, 25000);
  assert.equal(commercialCatalog.products.privateListing.trialDays, 7);
  assert.match(docs.listerTermsMessage(), /UGX 25,000 per property, per month/);
  assert.equal(docs.LISTER_TERMS_VERSION, '2026-10-v2');
});

test('private listing billing messages use the catalog default', async () => {
  const text = await billing.buildListerMessage(null, 'final_reminder', {
    id: 'listing-1',
    title: 'Test home',
    lister_name: 'Mary'
  }, {
    pay_to: { method: 'MTN Mobile Money', number: '0700000000', name: 'MAKAUG' }
  });
  assert.match(text, /UGX 25,000 monthly fee/);
  const appSource = fs.readFileSync(path.join(__dirname, '../assets/makaug-app.js'), 'utf8');
  assert.match(appSource, /monthly_ugx: num\(data\.get\("lister_monthly"\), 25000\)/);
  assert.doesNotMatch(appSource, /monthly_ugx: num\(data\.get\("lister_monthly"\), 20000\)/);
});

test('price correction migration only updates the untouched legacy default', () => {
  const migration = fs.readFileSync(path.join(__dirname, '../db/migrations/146_private_listing_price_consistency.sql'), 'utf8');
  assert.match(migration, /current_setting\('app\.country_code', TRUE\)/);
  assert.match(migration, /IF active_country_code = 'UG' THEN/);
  assert.match(migration, /jsonb_set\(value, '\{monthly_ugx\}', '25000'::jsonb, true\)/);
  assert.match(migration, /updated_by IS NULL/);
  assert.match(migration, /value = '\{"free_days": 7, "monthly_ugx": 20000, "views_message_day": 3, "start_date": "2026-10-05"\}'::jsonb/);
});

test('agent guide caption links the PDF', () => {
  assert.match(docs.agentGuideCaption({ name: 'Amos' }), /\/legal\/makaug-agent-guide\.pdf/);
});
