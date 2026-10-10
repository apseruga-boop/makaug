'use strict';

/**
 * C21 (10 Oct 2026, Arthur and Finance): the fees come from Admin
 * (billing_settings): agents UGX 50,000 a month with agent_trial_days free from
 * approval (default 14, 0 = pay first), owners UGX 20,000 per listing, per
 * month after 7 free days, VAT-inclusive, fixed in UGX. GET /api/pricing, the
 * pages, the WhatsApp copy and the translations read them; AGENT_MONTHLY_FEE_UGX
 * is no longer read. Fee-exempt agents can have an end date (fee_exempt_until);
 * staff can start a trial from today; a pay link WhatsApp can't send becomes a
 * staff "send pay link" task.
 *
 * DB-backed tests need TEST_DATABASE_URL (local or staging, never production).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DB_URL = process.env.TEST_DATABASE_URL || '';
if (DB_URL) process.env.DATABASE_URL = DB_URL;
process.env.ADMIN_API_KEY = process.env.ADMIN_API_KEY || 'pricing-from-admin-test-key';
process.env.AGENT_MONTHLY_FEE_UGX = '99999';
process.env.AGENT_TRIAL_DAYS = '3';
const skip = DB_URL ? false : 'TEST_DATABASE_URL is not set';

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const revenue = require('../services/revenueService');
const billing = require('../services/billingOpsService');
const pricing = require('../services/pricingCopy');
const exemption = require('../services/agentFeeExemption');

const ADMIN_VALUES = {
  agent_fee: { monthly_ugx: 50000, agent_trial_days: 14, remind_days_before: 3, final_after_days_overdue: 7 },
  lister_fee: { monthly_ugx: 20000, free_days: 7, start_date: '2026-10-05', views_message_day: 3 }
};

test('currentFees returns the Admin values; a missing key falls back to the default; the env is not read', async () => {
  const fakeDb = (settings) => ({ async query() { return { rows: Object.entries(settings).map(([key, value]) => ({ key, value })) }; } });
  const fees = await billing.currentFees(fakeDb({ agent_fee: { monthly_ugx: 60000, agent_trial_days: 0 }, lister_fee: { monthly_ugx: 25000 } }));
  assert.deepEqual([fees.agent.monthly_ugx, fees.agent.trial_days, fees.lister.monthly_ugx, fees.lister.free_days, fees.lister.per], [60000, 0, 25000, 7, 'listing']);
  assert.equal(revenue.feeConfig().feeUgx, 60000, 'the synchronous callers see the Admin value');
  assert.equal(revenue.agentTrialDays(), 0);
  assert.match(pricing.feeLabels().agent_plan, /^Agent plan: UGX 60,000 a month \(VAT incl\.\)\. Your account is approved once the first month is paid\.$/);
  const empty = billing.feesFromSettings({});
  assert.deepEqual([empty.agent.monthly_ugx, empty.agent.trial_days, empty.lister.monthly_ugx, empty.lister.free_days], [50000, 14, 20000, 7]);
  revenue.setAdminFees(billing.feesFromSettings(ADMIN_VALUES));
  assert.equal(revenue.feeConfig().feeUgx, 50000, 'AGENT_MONTHLY_FEE_UGX=99999 is ignored');
  assert.equal(revenue.agentTrialDays(), 14, 'AGENT_TRIAL_DAYS=3 is ignored');
  const labels = pricing.feeLabels();
  assert.equal(labels.agent_plan, 'Agent plan: UGX 50,000 a month (VAT incl.). New agents get the first 14 days free from approval; we send a payment link before it ends. Nothing is charged automatically.');
  assert.equal(labels.lister_plan, 'Your first 7 days are free, then UGX 20,000 per listing, per month (VAT incl.).');
  assert.equal(labels.admin_agent_line, 'Agent fees are UGX 50,000 a month (new agents: 14 days free).');
  assert.ok(!JSON.stringify(labels).includes('99,999'));
  await assert.rejects(billing.setSetting({ async query() { return { rows: [] }; } }, 'agent_fee', { agent_trial_days: 120 }), /0 to 90/);
});

test('GET /api/pricing and the page tokens carry the Admin fees', () => {
  revenue.setAdminFees(billing.feesFromSettings(ADMIN_VALUES));
  const body = pricing.publicPricing();
  assert.deepEqual([body.currency, body.vat_inclusive, body.agent.monthly_ugx, body.agent.trial_days, body.lister.monthly_ugx, body.lister.per, body.lister.free_days], ['UGX', true, 50000, 14, 20000, 'listing', 7]);
  const server = read('server.js');
  assert.match(server, /app\.get\('\/api\/pricing', async/);
  assert.match(server, /res\.set\('Cache-Control', 'public, max-age=300'\);\n\s*return res\.json\(\{ ok: true, data: require\('\.\/services\/pricingCopy'\)\.publicPricing/);
  assert.match(server, /window\.MAKAUG_PRICING = /);
  assert.match(server, /html = require\('\.\/services\/pricingCopy'\)\.applyFeeTokens\(html\);/);
  const html = pricing.applyFeeTokens(read('index.html') + read('packages/shared-country-core/components/footer.html'));
  assert.ok(!/\{\{(?:PRICE|TRIAL|FREE|FEE):/.test(html), 'every fee token is filled');
  assert.match(html, /Start with 7 days free, then UGX 20,000 per listing, per month \(VAT incl\.\)\./);
  assert.match(html, /List your first 7 days free, then keep it live from UGX 20,000 per listing, per month\./);
  assert.match(html, /Agent fees are UGX 50,000 a month \(new agents: 14 days free\)\./);
  assert.ok(!/free forever/i.test(html));
  // A change in Admin reaches the same page with no deploy.
  revenue.setAdminFees(billing.feesFromSettings({ ...ADMIN_VALUES, agent_fee: { ...ADMIN_VALUES.agent_fee, monthly_ugx: 60000 } }));
  assert.match(pricing.applyFeeTokens(read('index.html')), /Agent fees are UGX 60,000 a month/);
  revenue.setAdminFees(billing.feesFromSettings(ADMIN_VALUES));
});

test('the SPA and the translations read the Admin fees; no leftover placeholders', () => {
  const app = read('assets/makaug-app.js');
  const start = app.indexOf('const PRICING_FALLBACK =');
  const end = app.indexOf('\n}\n', app.indexOf('function feeCopy(', start)) + 3;
  const sandbox = { window: { MAKAUG_PRICING: pricing.publicPricing(billing.feesFromSettings({ ...ADMIN_VALUES, agent_fee: { monthly_ugx: 60000, agent_trial_days: 0 } })) } };
  vm.runInNewContext(`${app.slice(start, end)}\nthis.api = { feeCopy, feeUgxText, feeAmount };`, sandbox);
  assert.equal(sandbox.api.feeUgxText('agent'), 'UGX 60,000');
  assert.equal(sandbox.api.feeCopy('agent_plan'), 'Agent plan: UGX 60,000 a month (VAT incl.). Your account is approved once the first month is paid.');
  assert.match(app, /<p><strong>\$\{feeCopy\("agent_plan"\)\}<\/strong>/);
  assert.match(app, /\["list-choice-free-copy", `After that, \$\{feeCopy\("lister_price"\)\}\./);
  assert.match(app, /Free days for new agents \(0 = pay first\)/);
  assert.match(app, /agent_trial_days: num\(data\.get\("agent_trial_days"\), 14\)/);
  // The 8 site packs: the agent price is a template, filled from MAKAUG_PRICING.
  const i18n = read('assets/makaug-site-i18n.js');
  assert.match(i18n, /function fillFees\(text, values\)/);
  for (const lang of ['ac', 'am', 'ar', 'lg', 'ny', 'rn', 'sm', 'sw']) {
    const pack = JSON.parse(read(`assets/i18n/site-${lang}.json`));
    const key = '{agent_ush} / month · all your listings';
    assert.ok(pack.phrases[key] && pack.phrases[key].includes('{agent_ush}'), lang);
    assert.ok(!Object.keys(pack.phrases).includes('USh 50,000 / month · all your listings'), lang);
    const leftovers = JSON.stringify(pack).match(/\{(?:agent|lister)_(?!ush\b|ugx\b|trial_days\b|free_days\b)[a-z_]+\}/g);
    assert.equal(leftovers, null, `${lang}: unknown placeholder`);
  }
  // The WhatsApp menu takes the free days from Admin.
  assert.match(read('routes/whatsapp.js'), /List my property \(first \{lister_free_days\} days free\)/);
});

test('the owner fee says "per listing" on every surface', () => {
  revenue.setAdminFees(billing.feesFromSettings(ADMIN_VALUES));
  const docs = require('../services/listingDocsService');
  const terms = docs.buildListerTermsText ? docs.buildListerTermsText(ADMIN_VALUES) : read('services/listingDocsService.js');
  assert.match(terms, /per listing, per month/);
  assert.match(read('services/billingOpsService.js'), /per listing, per month \(VAT incl\.\) — pay to/);
  assert.match(read('services/listingModerationService.js'), /per listing, per month \(VAT incl\.\) to stay live/);
  assert.match(read('routes/whatsapp.js'), /per listing, per month \(VAT incl\.\) to stay live — we'll message you/);
  assert.match(read('services/publicSeoService.js'), /\{\{PRICE:lister\}\} per listing, per month/);
  assert.match(read('server.js'), /listings from \{\{PRICE:lister\}\} per listing, per month/);
});

// Agent and owner fee amounts must not be hard-coded on the copy surfaces:
// only FEE_DEFAULTS (server) and PRICING_FALLBACK (SPA) hold them.
test('no hard-coded agent or owner fee outside the defaults', () => {
  const surfaces = [
    'index.html', 'assets/makaug-app.js', 'packages/shared-country-core/components/footer.html', 'server.js',
    'services/publicSeoService.js', 'config/aboutCommercialProducts.js', 'services/whatsappEmployeeIntakeService.js',
    'services/agentWelcomeService.js', 'routes/whatsapp.js', 'services/agentProspectService.js', 'services/billingOpsService.js',
    'services/payLinkService.js', 'services/revenueService.js', 'services/listingDocsService.js', 'services/listingModerationService.js',
    'services/teamBillingCommandService.js', 'routes/admin.js', 'services/aboutCommercialRateCardPdfService.js',
    ...['ac', 'am', 'ar', 'lg', 'ny', 'rn', 'sm', 'sw'].map((lang) => `assets/i18n/site-${lang}.json`)
  ];
  // Lines that mention 20,000 / 50,000 for something other than these two fees.
  const otherProducts = /featuredListing|professionalListing|advertising|placement|Sidebar MPU|Bottom-of-results|short[- ]?stay|short_term|st_listing|for 3 Months|three months|listing_fee_ugx|MIN_MONTHLY_RENT|PRICE_PLAUSIBILITY|price bounds|step="50000"|maxlength="20000"|max="20000"|guidePrice|20000\)|, 20000\)|limit|Timeout|setTimeout|VISITORS_TARGET|50,000,000|7 days"|\/ 7 days|\/ property"|Migadde Hakim/i;
  const defaults = /FEE_DEFAULTS = Object\.freeze|agent_monthly_ugx: 50000|lister_monthly_ugx: 20000|const PRICING_FALLBACK = /;
  const offenders = [];
  for (const file of surfaces) {
    read(file).split('\n').forEach((line, index) => {
      if (!/(?:UGX|USh|Shs?)\s?[25]0,000(?!,)|\b[25]0000\b/.test(line)) return;
      if (defaults.test(line) || otherProducts.test(line)) return;
      offenders.push(`${file}:${index + 1}: ${line.trim().slice(0, 140)}`);
    });
  }
  assert.deepEqual(offenders, []);
});

test('fee_exempt_until: exempt while it is in the future, then billable', () => {
  const agent = { fee_exempt: true, fee_exempt_until: '2027-02-01', paid_until: null };
  assert.equal(exemption.isExempt(agent, '2026-10-10'), true);
  assert.equal(revenue.agentFeeRequired(agent, new Date('2026-10-10T09:00:00Z')), false);
  assert.equal(exemption.isExempt(agent, '2027-02-01'), false);
  assert.equal(revenue.agentFeeRequired(agent, new Date('2027-02-01T09:00:00Z')), true);
  assert.equal(revenue.agentFeeRequired({ fee_exempt: true }, new Date('2027-06-01T09:00:00Z')), false, 'no end date: exempt as before');
  const migration = read('db/migrations/190_agent_fee_exempt_until_trial_ends_at.sql');
  assert.match(migration, /ALTER TABLE agents ADD COLUMN IF NOT EXISTS fee_exempt_until DATE;/);
  assert.match(migration, /ALTER TABLE agents ADD COLUMN IF NOT EXISTS trial_ends_at DATE;/);
  assert.doesNotMatch(migration, /UPDATE|INSERT|DELETE/i, 'schema only');
});

let db;
let app;
let request;
const agentIds = [];
let savedSettings = null;
const TAG = `C21${crypto.randomBytes(3).toString('hex')}`;

test.after(async () => {
  if (!db) return;
  if (savedSettings) {
    for (const [key, value] of Object.entries(savedSettings)) {
      await db.query('UPDATE billing_settings SET value = $2::jsonb WHERE key = $1', [key, JSON.stringify(value)]).catch(() => {});
    }
  }
  if (agentIds.length) {
    await db.query('DELETE FROM pay_links WHERE agent_id = ANY($1::uuid[])', [agentIds]).catch(() => {});
    await db.query('DELETE FROM agents WHERE id = ANY($1::uuid[])', [agentIds]).catch(() => {});
  }
  await db.pool.end().catch(() => {});
});

async function newAgent(fields = {}) {
  const phone = `2567${String(Date.now()).slice(-7)}${agentIds.length}`;
  const row = (await db.query(
    `INSERT INTO agents (full_name, phone, whatsapp, licence_number, registration_status, status, verification_reason)
     VALUES ($1, $2, $2, $3, 'not_registered', 'pending', 'C21 test') RETURNING id`,
    [`${TAG} Agent ${agentIds.length + 1}`, phone, `${TAG}-${agentIds.length}`]
  )).rows[0];
  agentIds.push(row.id);
  const sets = Object.keys(fields);
  if (sets.length) {
    await db.query(`UPDATE agents SET ${sets.map((key, i) => `${key} = $${i + 2}`).join(', ')} WHERE id = $1`, [row.id, ...sets.map((key) => fields[key])]);
  }
  return row.id;
}

test('against a database: trial on approval (14), 402 when 0, start-trial from today, exempt-until, pre_due on day 11 with a staff task', { skip }, async () => {
  const express = require('express');
  request = require('supertest');
  db = require('../config/database');
  const current = (await db.query(`SELECT key, value FROM billing_settings WHERE key IN ('agent_fee', 'lister_fee', 'pay_to')`)).rows;
  savedSettings = Object.fromEntries(current.map((row) => [row.key, row.value]));
  await billing.setSetting(db, 'agent_fee', ADMIN_VALUES.agent_fee, 'c21-test');
  await billing.setSetting(db, 'lister_fee', ADMIN_VALUES.lister_fee, 'c21-test');
  if (!savedSettings.pay_to?.number) await billing.setSetting(db, 'pay_to', { method: 'MTN Mobile Money', number: '0780000000', name: 'C21 TEST' }, 'c21-test');
  app = express();
  app.use(express.json());
  app.use('/api/admin', require('../routes/admin'));
  const admin = (r) => r.set('x-api-key', process.env.ADMIN_API_KEY);
  const today = revenue.kampalaDate();

  // 14 days: approval without payment is a 200 on the trial, and no pay link.
  const fresh = await newAgent();
  const approved = await admin(request(app).patch(`/api/admin/agents/${fresh}/status`)).send({ status: 'approved', send_welcome: false });
  assert.equal(approved.status, 200, JSON.stringify(approved.body).slice(0, 300));
  const row = (await db.query(`SELECT fee_offer_mode, paid_until::text AS paid_until, trial_ends_at::text AS trial_ends_at, fee_offer_reason FROM agents WHERE id = $1`, [fresh])).rows[0];
  assert.equal(row.fee_offer_mode, 'trial');
  assert.equal(row.paid_until, revenue.addDays(today, 13));
  assert.equal(row.trial_ends_at, revenue.addDays(today, 13));
  assert.equal(row.fee_offer_reason, 'New agent: 14 days free');
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM pay_links WHERE agent_id = $1', [fresh])).rows[0].n, 0, 'no pay link on approval');

  // Day 11: the reminder job sends pre_due with a UGX 50,000 link; with no WhatsApp it becomes a staff task.
  await db.query(`UPDATE agents SET paid_until = $2::date, fee_offer_until = $2::date, trial_ends_at = $2::date WHERE id = $1`, [fresh, revenue.addDays(today, 3)]);
  const handoff = require('../services/leadHandoffService');
  const realDeliver = handoff.deliverWhatsapp;
  handoff.deliverWhatsapp = async () => ({ status: 'failed', reason: 'bridge_offline' });
  try { await billing.runAgentFeeReminders(db); } finally { handoff.deliverWhatsapp = realDeliver; }
  const link = (await db.query('SELECT amount_ugx FROM pay_links WHERE agent_id = $1 ORDER BY created_at DESC LIMIT 1', [fresh])).rows[0];
  assert.equal(Number(link?.amount_ugx), 50000);
  const log = (await db.query('SELECT billing_reminder_log FROM agents WHERE id = $1', [fresh])).rows[0].billing_reminder_log;
  const entry = log[`pre_due:${revenue.addDays(today, 3)}`];
  assert.ok(entry, 'pre_due recorded');
  assert.equal(entry.needs_manual_send, true, 'WhatsApp failed, so it waits for staff');
  {
    const tasks = await billing.listManualPayLinkTasks(db);
    const task = tasks.find((t) => t.agent_id === fresh);
    assert.ok(task && task.wa_me.startsWith('https://wa.me/'), 'staff "send pay link" task with wa.me');
    assert.match(decodeURIComponent(task.wa_me), /UGX 50,000 a month \(VAT incl\.\)/);
    await billing.markManualPayLinkSent(db, { agentId: fresh, periodKey: task.period_key, actor: 'c21-test' });
    assert.ok(!(await billing.listManualPayLinkTasks(db)).some((t) => t.agent_id === fresh));
  }

  // 0 days: the old rule, 402.
  await billing.setSetting(db, 'agent_fee', { ...ADMIN_VALUES.agent_fee, agent_trial_days: 0 }, 'c21-test');
  const payFirst = await newAgent();
  const refused = await admin(request(app).patch(`/api/admin/agents/${payFirst}/status`)).send({ status: 'approved', send_welcome: false });
  assert.equal(refused.status, 402);
  assert.match(refused.body.message, /UGX 50,000 a month/);
  await billing.setSetting(db, 'agent_fee', { ...ADMIN_VALUES.agent_fee, monthly_ugx: 60000, agent_trial_days: 0 }, 'c21-test');
  const sixty = await admin(request(app).patch(`/api/admin/agents/${payFirst}/status`)).send({ status: 'approved', send_welcome: false });
  assert.match(sixty.body.message, /UGX 60,000 a month/, 'an Admin change applies with no deploy');
  await billing.setSetting(db, 'agent_fee', ADMIN_VALUES.agent_fee, 'c21-test');

  // A previously approved agent gets no new trial.
  const returning = await newAgent({ approved_at: new Date('2026-09-01T09:00:00Z'), status: 'suspended' });
  const again = await admin(request(app).patch(`/api/admin/agents/${returning}/status`)).send({ status: 'approved', send_welcome: false });
  assert.equal(again.status, 402);

  // "Start 14-day trial from today" for an unpaid pay-later agent.
  const payLater = await newAgent({ status: 'approved', approved_at: new Date(), fee_offer_mode: 'pay_later' });
  const started = await admin(request(app).post(`/api/admin/revenue/agents/${payLater}/start-trial`)).send({});
  assert.equal(started.status, 200, JSON.stringify(started.body));
  assert.equal(started.body.data.trial_ends_at, revenue.addDays(today, 13));
  assert.equal(started.body.data.first_payment_due, revenue.addDays(today, 14));

  // Fee-exempt until a date: pay links and reminders skip them until then.
  const exempt = await newAgent({ status: 'approved', approved_at: new Date(), fee_exempt: true });
  const setUntil = await admin(request(app).patch(`/api/admin/revenue/agents/${exempt}/fee-exempt-until`)).send({ fee_exempt_until: '2027-02-01' });
  assert.equal(setUntil.status, 200, JSON.stringify(setUntil.body));
  assert.equal((await db.query('SELECT fee_exempt_until::text AS d FROM agents WHERE id = $1', [exempt])).rows[0].d, '2027-02-01');
  await assert.rejects(require('../services/payLinkService').createPayLink(db, { purpose: 'agent_subscription', agent_id: exempt }, 'c21-test'), /fee-exempt until 1 Feb 2027/);
  const past = await admin(request(app).patch(`/api/admin/revenue/agents/${exempt}/fee-exempt-until`)).send({ fee_exempt_until: '2020-01-01' });
  assert.equal(past.status, 400);
});
