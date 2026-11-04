'use strict';

// Mortgage rates update and weekly rate check (Arthur, 4 Nov 2026 07:06 UK).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

process.env.COUNTRY_CODE = process.env.COUNTRY_CODE || 'UG';
const mortgage = require('../routes/mortgage');
const watch = require('../services/mortgageRateWatchService');
const scheduler = require('../services/dailySourceMonitorScheduler');

const providers = () => mortgage.mergeAuditedMortgageProviders(mortgage.FALLBACK_MORTGAGE_PROVIDERS);
const byKey = (list, key) => list.find((p) => p.key === key);

test('dfcu is 16.9%, 85% loan-to-value and 20 years', () => {
  const dfcu = byKey(mortgage.finishMortgageProviders(providers(), [], new Date('2026-11-04T09:00:00Z')), 'dfcu');
  assert.equal(dfcu.residentialRate, 16.9);
  assert.equal(dfcu.minDepositPct.residential, 15);
  assert.equal(dfcu.maxYears.residential, 20);
  assert.match(dfcu.sourceUrl, /^https:\/\/www\.dfcugroup\.com\//);
});

test('Stanbic is 17.5% until 30 Nov and 19% from 1 Dec 2026 (London date)', () => {
  const nov30 = byKey(mortgage.finishMortgageProviders(providers(), [], new Date('2026-11-30T23:30:00Z')), 'stanbic');
  assert.equal(nov30.residentialRate, 17.5);
  assert.match(nov30.sourceNote, /17\.5% until 30 Nov 2026/);
  const dec1 = byKey(mortgage.finishMortgageProviders(providers(), [], new Date('2026-12-01T00:30:00Z')), 'stanbic');
  assert.equal(dec1.residentialRate, 19);
  assert.equal(dec1.rateEffectiveFrom, '2026-12-01');
  assert.match(dec1.sourceNote, /From 1 Dec 2026/);
});

test('Absa shows prime 21.75% and stays quote-only', () => {
  const absa = byKey(mortgage.finishMortgageProviders(providers(), [], new Date('2026-11-04T09:00:00Z')), 'absa');
  assert.equal(absa.residentialRate, null);
  assert.equal(absa.primeRate, 21.75);
  assert.match(absa.sourceNote, /21\.75%/);
});

test('every Uganda rate has a source URL and was checked on 2026-11-04', () => {
  for (const p of mortgage.FALLBACK_MORTGAGE_PROVIDERS) {
    assert.match(p.sourceUrl, /^https:\/\//, p.key);
    assert.equal(p.sourceVerifiedAt, '2026-11-04', p.key);
  }
});

test('rates checked more than 30 days ago are flagged stale', () => {
  const fresh = mortgage.withMortgageRateFreshness({ sourceVerifiedAt: '2026-11-04' }, new Date('2026-12-04T12:00:00Z'));
  assert.equal(fresh.stale, false);
  assert.equal(fresh.checkedDaysAgo, 30);
  const old = mortgage.withMortgageRateFreshness({ sourceVerifiedAt: '2026-11-04' }, new Date('2026-12-05T12:00:00Z'));
  assert.equal(old.stale, true);
  assert.equal(mortgage.withMortgageRateFreshness({}, new Date()).stale, true);
});

test('only staff-approved changes override a coded rate', () => {
  const list = mortgage.finishMortgageProviders(providers(), [
    { id: 7, provider_key: 'kcb', rate_field: 'residentialRate', approved_rate: '18.25', source_url: 'https://ug.kcbgroup.com/products/mortgage', reviewed_at: '2026-11-10T08:00:00Z', staff_note: 'KCB now 18.25%.' }
  ], new Date('2026-11-10T09:00:00Z'));
  const kcb = byKey(list, 'kcb');
  assert.equal(kcb.residentialRate, 18.25);
  assert.equal(kcb.sourceVerifiedAt, '2026-11-10');
  assert.equal(kcb.approvedChangeId, 7);
  assert.equal(byKey(list, 'hfb').residentialRate, 16);
});

test('rate extraction keeps loan rates and ignores deposit percentages', () => {
  const text = watch.htmlToText('<p>Home loan pricing as low as 17.5% p.a.</p><p>Finance up to 85% of value</p><p>The Central Bank Rate (CBR) at 12 percent.</p>');
  assert.deepEqual(watch.extractRateNumbers(text), [12, 17.5]);
});

test('weekly check runs Mondays and on/after BoU MPC dates', () => {
  assert.equal(watch.mortgageRateWatchDue('2026-11-09').due, true); // Monday
  assert.equal(watch.mortgageRateWatchDue('2026-11-12').reason, 'bou_mpc');
  assert.equal(watch.mortgageRateWatchDue('2026-11-13').reason, 'bou_mpc_next_day');
  assert.equal(watch.mortgageRateWatchDue('2026-11-04').due, false); // Wednesday
});

function fakeDb() {
  const snapshots = new Map();
  const proposals = [];
  return {
    proposals,
    async query(sql, params = []) {
      if (/FROM mortgage_rate_source_snapshots WHERE source_url/.test(sql)) {
        const row = snapshots.get(params[0]);
        return { rows: row ? [row] : [] };
      }
      if (/INSERT INTO mortgage_rate_source_snapshots/.test(sql)) {
        snapshots.set(params[0], { numbers: JSON.parse(params[2]) });
        return { rows: [] };
      }
      if (/INSERT INTO mortgage_rate_proposals/.test(sql)) {
        proposals.push({ provider_key: params[0], proposed_rate: params[3], after: JSON.parse(params[6]) });
        return { rows: [] };
      }
      throw new Error(`unexpected sql ${sql}`);
    }
  };
}

test('the check records a proposal when numbers change and never publishes', async () => {
  const db = fakeDb();
  const list = [{ key: 'kcb', residentialRate: 17.5, sourceUrl: 'https://bank.example/rates' }];
  let page = '<p>Mortgage pricing from 17.5%.</p>';
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => page });
  const extraFree = { providers: list, fetchImpl };
  // EXTRA_WATCH_PAGES are fetched too; the fake serves the same page for all.
  const first = await watch.runMortgageRateWatch(db, extraFree);
  assert.equal(first.proposals, 0);
  assert.ok(first.baselines >= 1);
  page = '<p>Mortgage pricing from 18.5%.</p>';
  const second = await watch.runMortgageRateWatch(db, extraFree);
  assert.ok(second.proposals >= 1);
  const kcb = db.proposals.find((p) => p.provider_key === 'kcb');
  assert.equal(kcb.proposed_rate, 18.5);
  // Published rates are untouched: the coded KCB rate is still 17.5%.
  assert.equal(byKey(mortgage.FALLBACK_MORTGAGE_PROVIDERS, 'kcb').residentialRate, 17.5);
});

test('scheduler runs the mortgage check once per due London date', async () => {
  const actions = [];
  const db = {
    async query(sql, params) {
      if (/SELECT id FROM audit_logs/.test(sql)) return { rows: actions.includes(params[1]) ? [{ id: 1 }] : [] };
      if (/INSERT INTO audit_logs/.test(sql)) { actions.push(JSON.parse(params[2]).london_date); return { rows: [] }; }
      return { rows: [] };
    }
  };
  let runs = 0;
  const watchService = { mortgageRateWatchDue: watch.mortgageRateWatchDue, runMortgageRateWatch: async () => { runs += 1; return { checked: 1, failed: 0, proposals: 0 }; } };
  const logger = { info() {}, warn() {}, error() {} };
  const monday = new Date('2026-11-09T05:31:00Z');
  const a = await scheduler.runScheduledMortgageRateWatch(db, { now: monday, watchService, logger, env: {} });
  const b = await scheduler.runScheduledMortgageRateWatch(db, { now: monday, watchService, logger, env: {} });
  const wed = await scheduler.runScheduledMortgageRateWatch(db, { now: new Date('2026-11-04T05:31:00Z'), watchService, logger, env: {} });
  assert.equal(a.skipped, false);
  assert.equal(b.reason, 'already_ran_today');
  assert.equal(wed.skipped, true);
  assert.equal(runs, 1);
});

test('migration 203 and its rollback exist; the page trusts the API', () => {
  const root = path.join(__dirname, '..');
  const sql = fs.readFileSync(path.join(root, 'db/migrations/203_mortgage_rate_proposals.sql'), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS mortgage_rate_proposals/);
  assert.match(sql, /data_change_203_backup/);
  assert.ok(fs.existsSync(path.join(root, 'scripts/rollback-203-mortgage-rate-proposals.sql')));
  const app = fs.readFileSync(path.join(root, 'assets/makaug-app.js'), 'utf8');
  assert.match(app, /if \(provider\.fromApi\) return provider;/);
  assert.match(app, /staleRateNote/);
});
