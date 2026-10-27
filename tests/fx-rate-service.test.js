'use strict';

// Daily exchange rates (25 Oct 2026). The network is mocked: fetch is a stub
// keyed by URL and the database is an in-memory fake.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const fx = require('../services/fxRateService');

const [JSDELIVR, PAGES] = fx.PRIMARY_URLS;
const ER_API = fx.FALLBACK_URL;
const NOW = Date.parse('2026-10-25T09:00:00Z');

function fawaz(date, { ugx = 4425.56, gbp = 0.7478, eur = 0.8927 } = {}) {
  return { date, usd: { ugx, gbp, eur, kes: 129.2 } };
}

function erApi({ ugx = 4113.32, gbp = 0.7489, eur = 0.8925, unix = 1761350400 } = {}) {
  return { result: 'success', base_code: 'USD', time_last_update_unix: unix, rates: { UGX: ugx, GBP: gbp, EUR: eur } };
}

function stubFetch(routes) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const route = routes[url];
    if (route instanceof Error) throw route;
    if (route === undefined) return { ok: false, status: 503, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => route };
  };
  return { fetchImpl, calls };
}

function fakeDb(rows = []) {
  const table = new Map(rows.map((r) => [`${r.rate_date}|${r.currency}`, { ...r }]));
  return {
    table,
    async query(sql, params = []) {
      if (/^\s*SELECT DISTINCT ON/.test(sql)) {
        const latest = new Map();
        for (const row of table.values()) {
          const prev = latest.get(row.currency);
          if (!prev || row.rate_date > prev.rate_date) latest.set(row.currency, row);
        }
        return { rows: [...latest.values()] };
      }
      if (/^\s*INSERT INTO fx_rates/.test(sql)) {
        const [rate_date, currency, ugx_per_unit, source, fetched_at] = params;
        table.set(`${rate_date}|${currency}`, { rate_date, currency, ugx_per_unit, source, fetched_at });
        return { rows: [] };
      }
      throw new Error(`unexpected SQL: ${sql}`);
    }
  };
}

test.beforeEach(() => fx.resetFxStateForTests());
test.after(() => fx.resetFxStateForTests());

test('parses the fawazahmed0 file into UGX per USD, GBP and EUR (cross rates)', () => {
  const parsed = fx.parseFawazPayload(fawaz('2026-10-25'));
  assert.equal(parsed.date, '2026-10-25');
  assert.equal(parsed.rates.USD, 4425.56);
  assert.ok(Math.abs(parsed.rates.GBP - 4425.56 / 0.7478) < 1e-6);
  assert.ok(Math.abs(parsed.rates.EUR - 4425.56 / 0.8927) < 1e-6);
  assert.equal(fx.parseFawazPayload({ date: '2026-10-25' }), null);
  assert.equal(fx.parseFawazPayload(null), null);
});

test('parses open.er-api.com only when it is a successful USD-based answer', () => {
  const parsed = fx.parseErApiPayload(erApi());
  assert.equal(parsed.source, 'open.er-api.com');
  assert.equal(parsed.rates.USD, 4113.32);
  assert.match(parsed.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(fx.parseErApiPayload({ ...erApi(), result: 'error' }), null);
  assert.equal(fx.parseErApiPayload({ ...erApi(), base_code: 'EUR' }), null);
});

test('the newest primary mirror wins and every currency is saved', async () => {
  const db = fakeDb();
  const { fetchImpl, calls } = stubFetch({
    [JSDELIVR]: fawaz('2026-10-24', { ugx: 4435.61 }),
    [PAGES]: fawaz('2026-10-25', { ugx: 4425.56 })
  });
  const result = await fx.refreshRates(db, { fetchImpl, now: NOW });
  assert.deepEqual(Object.keys(result.accepted).sort(), ['EUR', 'GBP', 'USD']);
  assert.equal(fx.usdToUgxRate(), 4425.56);
  assert.equal(result.accepted.USD.date, '2026-10-25');
  assert.ok(!calls.includes(ER_API), 'the fallback is not called when the primary works');
  assert.equal(db.table.size, 3);
  assert.equal(db.table.get('2026-10-25|USD').ugx_per_unit, '4425.5600');
});

test('falls back to open.er-api.com when both primary mirrors fail', async () => {
  const { fetchImpl, calls } = stubFetch({ [JSDELIVR]: new Error('timeout'), [ER_API]: erApi() });
  const result = await fx.refreshRates(fakeDb(), { fetchImpl, now: NOW });
  assert.ok(calls.includes(ER_API));
  assert.equal(result.accepted.USD.source, 'open.er-api.com');
  assert.equal(fx.usdToUgxRate(), 4113.32);
});

test('a rate that moved more than 10% since the last good one is rejected and the last good rate kept', async () => {
  const db = fakeDb([
    { rate_date: '2026-10-24', currency: 'USD', ugx_per_unit: '4400.0000', source: 'fawazahmed0', fetched_at: new Date(NOW - 86_400_000) },
    { rate_date: '2026-10-24', currency: 'GBP', ugx_per_unit: '5900.0000', source: 'fawazahmed0', fetched_at: new Date(NOW - 86_400_000) },
    { rate_date: '2026-10-24', currency: 'EUR', ugx_per_unit: '4950.0000', source: 'fawazahmed0', fetched_at: new Date(NOW - 86_400_000) }
  ]);
  await fx.loadFromDb(db);
  assert.equal(fx.usdToUgxRate(), 4400);
  // Primary says 5,000 UGX per USD (+13.6%); the fallback is just as far off.
  const { fetchImpl } = stubFetch({
    [PAGES]: fawaz('2026-10-25', { ugx: 5000, gbp: 5000 / 5900, eur: 5000 / 4950 }),
    [ER_API]: erApi({ ugx: 5010, gbp: 5010 / 5900, eur: 5010 / 4950 })
  });
  const result = await fx.refreshRates(db, { fetchImpl, now: NOW });
  assert.ok(result.rejected.USD.some((r) => /moved_13\.6pct/.test(r)), JSON.stringify(result.rejected));
  assert.equal(fx.usdToUgxRate(), 4400, 'the last good USD rate is kept');
  assert.equal(result.accepted.GBP.rate.toFixed(2), '5900.00', 'GBP stayed within 10% and is accepted');
  assert.equal(db.table.has('2026-10-25|USD'), false, 'the rejected rate is not stored');
});

test('missing and out-of-range rates are rejected', () => {
  assert.equal(fx.rateRejectionReason(undefined, 4400), 'missing');
  assert.equal(fx.rateRejectionReason(0, 4400), 'missing');
  assert.equal(fx.rateRejectionReason(44.25, null), 'out_of_range');
  assert.equal(fx.rateRejectionReason(44_255, null), 'out_of_range');
  assert.equal(fx.rateRejectionReason(4425.56, 4400), '');
  assert.equal(fx.rateRejectionReason(4425.56, 3800), 'moved_16.5pct');
  // The first ever fetch has no last good rate, so only the bounds apply.
  assert.equal(fx.rateRejectionReason(4425.56, null), '');
});

test('a lagging mirror does not replace a newer accepted rate', async () => {
  const db = fakeDb();
  await fx.refreshRates(db, { fetchImpl: stubFetch({ [PAGES]: fawaz('2026-10-25') }).fetchImpl, now: NOW });
  const result = await fx.refreshRates(db, {
    fetchImpl: stubFetch({ [JSDELIVR]: fawaz('2026-10-24', { ugx: 4435.61 }) }).fetchImpl,
    now: NOW + 3_600_000
  });
  assert.equal(fx.usdToUgxRate(), 4425.56);
  assert.ok(result.rejected.USD.some((r) => /older_than_last_good/.test(r)));
});

test('with no live rate the fixed rates are used (env first, then 3,800 / 4,900 / 4,100)', () => {
  assert.deepEqual(fx.fixedFallbackRates({}).GBP, 4900);
  assert.deepEqual(fx.fixedFallbackRates({}).EUR, 4100);
  assert.equal(fx.currentRate('GBP', { GBP_TO_UGX_RATE: '5000' }), 5000);
  assert.equal(fx.currentRate('UGX'), 1);
  const shown = fx.displayRates({ FX_RATES_AS_OF: '2026-10-09' });
  assert.equal(shown.live, false);
  assert.equal(shown.as_of, '2026-10-09');
  assert.equal(shown.rates.GBP, 4900);
});

test('when every source fails nothing changes and the fixed rates stay in use', async () => {
  const { fetchImpl } = stubFetch({});
  const result = await fx.refreshRates(fakeDb(), { fetchImpl, now: NOW });
  assert.deepEqual(result.accepted, {});
  assert.ok(result.errors.length >= 2);
  assert.equal(fx.currentRate('EUR', {}), 4100);
});

test('the published rates carry the oldest date in use and are rounded', async () => {
  await fx.refreshRates(fakeDb(), { fetchImpl: stubFetch({ [PAGES]: fawaz('2026-10-25') }).fetchImpl, now: NOW });
  const shown = fx.displayRates({});
  assert.equal(shown.base, 'UGX');
  assert.equal(shown.as_of, '2026-10-25');
  assert.equal(shown.live, true);
  assert.equal(shown.rates.USD, 4425.56);
  assert.equal(shown.rates.GBP, Math.round((4425.56 / 0.7478) * 100) / 100);
  const { publicDisplayFx } = require('../utils/displayFx');
  assert.deepEqual(publicDisplayFx().rates, shown.rates, '/api/fx and /config.js publish the live rates');
});

test('refreshIfStale skips when the stored rates are fresh', async () => {
  const db = fakeDb();
  await fx.refreshRates(db, { fetchImpl: stubFetch({ [PAGES]: fawaz('2026-10-25') }).fetchImpl, now: NOW });
  const { fetchImpl, calls } = stubFetch({ [PAGES]: fawaz('2026-10-25') });
  const skipped = await fx.refreshIfStale(db, { fetchImpl, now: NOW + 2 * 3_600_000 });
  assert.equal(skipped.skipped, true);
  assert.equal(calls.length, 0);
});

test('a missing fx_rates table (before migration 182) is not fatal', async () => {
  const db = { async query() { const e = new Error('relation "fx_rates" does not exist'); e.code = '42P01'; throw e; } };
  assert.equal(await fx.loadFromDb(db), false);
  const result = await fx.refreshRates(db, { fetchImpl: stubFetch({ [PAGES]: fawaz('2026-10-25') }).fetchImpl, now: NOW });
  assert.equal(result.errors.length, 0);
  assert.equal(fx.usdToUgxRate(), 4425.56);
});

test('search uses today\'s rate for dollar-priced listings without touching stored prices', () => {
  const sql = fx.effectivePriceUgxSql('p', 4425.56);
  assert.equal(sql, "(CASE WHEN p.price_original_currency = 'USD' AND p.price_original > 0 THEN ROUND(p.price_original * 4425.5600) ELSE p.price END)");
  assert.equal(fx.effectivePriceUgxSql('p; DROP TABLE x', 4425.56).startsWith('(CASE WHEN p.'), true, 'the alias is sanitised');
  assert.equal(fx.effectivePriceUgxSql('p', 0), 'p.price');
  assert.equal(fx.effectivePriceUgx({ price: 410_400_000, price_original: 108_000, price_original_currency: 'USD' }, 4425.56), 477_960_480);
  assert.equal(fx.effectivePriceUgx({ price: 650_000_000 }, 4425.56), 650_000_000);
  assert.equal(fx.effectivePriceUgx({ price: 1, extra_fields: { price_original: 10, price_original_currency: 'usd' } }, 4000), 40_000);
});

test('routes, SSR and AI read the service, not a fixed 3,800', () => {
  const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const routes = read('routes/properties.js');
  assert.match(routes, /effectivePriceSql\} >= \?/);
  assert.match(routes, /price_asc: `\$\{priceSortRankSql\} ASC, \$\{priceSortValueSql\} ASC NULLS LAST/);
  const seo = read('services/publicSeoRenderService.js');
  assert.match(seo, /p\.price, p\.price_original, p\.price_original_currency,/);
  assert.match(seo, /data-price-original-currency="USD"/);
  const ai = read('services/aiService.js');
  assert.doesNotMatch(ai, /USD_TO_UGX_RATE \|\| 3800/);
  assert.match(read('server.js'), /startFxRateScheduler\(db, \{\n\s*logger,\n\s*bootDelayMs: staggeredBootDelay\('fx_rates'\)/);
  assert.match(read('db/migrations/182_fx_rates.sql'), /CREATE TABLE IF NOT EXISTS fx_rates/);
  assert.match(read('scripts/rollback-182-fx-rates.sql'), /DROP TABLE IF EXISTS fx_rates/);
});

test('the browser shows a dollar-priced listing in shillings at the published rate', () => {
  const APP = fs.readFileSync(path.join(__dirname, '..', 'assets', 'makaug-app.js'), 'utf8');
  const grab = (name) => {
    const start = APP.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    let depth = 0;
    for (let i = APP.indexOf(') {', start) + 2; i < APP.length; i += 1) {
      if (APP[i] === '{') depth += 1;
      else if (APP[i] === '}' && --depth === 0) return APP.slice(start, i + 1);
    }
    throw new Error(name);
  };
  const grabConst = (name) => {
    const start = APP.indexOf(`const ${name} =`);
    return APP.slice(start, APP.indexOf(';\n', start) + 1);
  };
  const sandbox = {
    window: { MAKAUG_FX: { base: 'UGX', as_of: '2026-10-25', rates: { USD: 4425.56, GBP: 5918.02, EUR: 4957.68 } } },
    localStorage: { getItem: () => 'UGX', setItem() {} },
    translateListingLabel: (t) => t,
    normalizeType: (v) => String(v || '').toLowerCase(),
    adminEscape: (v) => String(v ?? '')
  };
  const code = [
    grabConst('FX_FALLBACK'), grabConst('CURRENCY_SYMBOLS'), grabConst('SUPPORTED_DISPLAY_CURRENCIES'),
    grab('publicFx'), grab('fxRateToUgx'), grab('listingUgxToday'), grab('convertedPriceText'),
    APP.slice(APP.indexOf('const CURRENCIES = {'), APP.indexOf('};', APP.indexOf('const CURRENCIES = {')) + 2),
    grab('readStoredDisplayCurrency'), 'var activeCur = readStoredDisplayCurrency();',
    grab('formatCompact'), grab('localizePricePeriod'), grab('fmtP'),
    grab('normalizeListingPricePeriodValue'), grabConst('PRICE_PLAUSIBILITY_BOUNDS_FALLBACK'), grab('listingPriceIsPlausible'),
    grab('listingPriceNeedsCheck'), grab('listingPriceUnitCaption'), grab('priceTextAlreadyPerAcre'),
    grab('fmtListingPrice'), grab('publicSortablePrice'),
    'function listingComputedTotal() { return null; }',
    'this.api = { fmtListingPrice, listingUgxToday, publicSortablePrice };'
  ].join('\n');
  vm.runInNewContext(code, sandbox);
  const usdListing = { listing_type: 'sale', price: 410_400_000, price_period: 'once', price_original: 108_000, price_original_currency: 'USD' };
  assert.equal(sandbox.api.listingUgxToday(usdListing), 477_960_480);
  assert.equal(sandbox.api.fmtListingPrice(usdListing), 'USh 478M', '108,000 x 4,425.56, not the stored 3,800 rate');
  assert.equal(sandbox.api.publicSortablePrice(usdListing), 477_960_480, 'client sort and filters use the same figure');
  assert.equal(sandbox.api.listingUgxToday({ price: 650_000_000 }), 650_000_000);
});
