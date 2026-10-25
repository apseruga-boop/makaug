'use strict';

// Daily exchange rates for the currency switch, search and AI answers
// (25 Oct 2026). Before this the site used fixed rates: USD 3,800, GBP 4,900
// and EUR 4,100 UGX (utils/displayFx.js), last set on 1 Oct 2026.
//
// Sources are free and need no key:
//   1. fawazahmed0 currency-api (daily mid-market rates). It has two mirrors,
//      jsDelivr and Cloudflare Pages. Both are read and the newer date wins,
//      because jsDelivr can serve yesterday's file for up to 12 hours.
//   2. open.er-api.com, only when the primary gives no usable rate. On
//      25 Oct 2026 it was about 7% below XE for UGX, so it is the fallback.
// One request returns UGX, GBP and EUR per USD. GBP and EUR are cross rates
// from that file (UGX per USD / GBP per USD).
//
// What the site uses, in order:
//   1. The last accepted rate (memory, loaded from the fx_rates table at boot).
//   2. The fixed rates: USD_TO_UGX_RATE / GBP_TO_UGX_RATE / EUR_TO_UGX_RATE,
//      else 3,800 / 4,900 / 4,100.
// A new rate is rejected when it is missing, outside 1,000-20,000 UGX, or more
// than 10% away from the last accepted rate. The last accepted rate is kept.
// Stored listing prices are never changed here.

const { configuredUsdToUgxRate, DEFAULT_USD_TO_UGX_RATE } = require('../utils/propertyPriceCurrency');

const SUPPORTED_CURRENCIES = Object.freeze(['USD', 'GBP', 'EUR']);
const DEFAULT_GBP_TO_UGX_RATE = 4900;
const DEFAULT_EUR_TO_UGX_RATE = 4100;
const DEFAULT_FX_AS_OF = '2026-10-01';
const MAX_DAY_ON_DAY_MOVE = 0.10;
const MIN_UGX_PER_UNIT = 1000;
const MAX_UGX_PER_UNIT = 20000;
const STALE_AFTER_MS = 20 * 60 * 60 * 1000;
const CHECK_EVERY_MS = 3 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;

const PRIMARY_URLS = Object.freeze([
  'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json',
  'https://latest.currency-api.pages.dev/v1/currencies/usd.json'
]);
const FALLBACK_URL = 'https://open.er-api.com/v6/latest/USD';

const SOURCE_LABELS = Object.freeze({
  fawazahmed0: 'fawazahmed0 currency-api',
  'open.er-api.com': 'open.er-api.com',
  fixed: 'fixed fallback'
});

const state = {
  rates: {}, // { USD: { rate, date, source, fetched_at } }
  lastAttemptAt: 0,
  lastResult: null
};
let refreshing = null;
let checkTimer = null;

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function isoDate(value) {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function fixedFallbackRates(env = process.env) {
  return {
    USD: configuredUsdToUgxRate() || DEFAULT_USD_TO_UGX_RATE,
    GBP: positiveNumber(env.GBP_TO_UGX_RATE, DEFAULT_GBP_TO_UGX_RATE),
    EUR: positiveNumber(env.EUR_TO_UGX_RATE, DEFAULT_EUR_TO_UGX_RATE)
  };
}

function fixedFallbackAsOf(env = process.env) {
  const configured = String(env.FX_RATES_AS_OF || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(configured) ? configured : DEFAULT_FX_AS_OF;
}

// --- parsing the two sources -------------------------------------------

function crossRates(ugxPerUsd, gbpPerUsd, eurPerUsd) {
  const rates = {};
  if (Number(ugxPerUsd) > 0) rates.USD = Number(ugxPerUsd);
  if (Number(ugxPerUsd) > 0 && Number(gbpPerUsd) > 0) rates.GBP = Number(ugxPerUsd) / Number(gbpPerUsd);
  if (Number(ugxPerUsd) > 0 && Number(eurPerUsd) > 0) rates.EUR = Number(ugxPerUsd) / Number(eurPerUsd);
  return rates;
}

function parseFawazPayload(json) {
  const usd = json && typeof json.usd === 'object' ? json.usd : null;
  const date = isoDate(json?.date);
  if (!usd || !date) return null;
  return { source: 'fawazahmed0', date, rates: crossRates(usd.ugx, usd.gbp, usd.eur) };
}

function parseErApiPayload(json) {
  if (!json || json.result !== 'success' || json.base_code !== 'USD' || typeof json.rates !== 'object') return null;
  const date = json.time_last_update_unix ? isoDate(Number(json.time_last_update_unix) * 1000) : isoDate(json.time_last_update_utc);
  if (!date) return null;
  return { source: 'open.er-api.com', date, rates: crossRates(json.rates.UGX, json.rates.GBP, json.rates.EUR) };
}

async function fetchJson(url, fetchImpl) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS) : null;
  timer?.unref?.();
  try {
    const response = await fetchImpl(url, {
      headers: { accept: 'application/json', 'user-agent': 'makaug.com exchange rates (+https://makaug.com)' },
      signal: controller?.signal
    });
    if (!response || !response.ok) throw new Error(`HTTP ${response?.status || 'error'} from ${url}`);
    return await response.json();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Both mirrors of the primary; the newest date wins.
async function fetchPrimary(fetchImpl) {
  const results = await Promise.allSettled(PRIMARY_URLS.map((url) => fetchJson(url, fetchImpl).then(parseFawazPayload)));
  const parsed = results.map((r) => (r.status === 'fulfilled' ? r.value : null)).filter((r) => r && r.rates.USD);
  if (!parsed.length) {
    const reasons = results.map((r) => (r.status === 'rejected' ? r.reason?.message : 'no UGX rate')).join('; ');
    throw new Error(`primary unavailable: ${reasons}`);
  }
  return parsed.sort((a, b) => b.date.localeCompare(a.date))[0];
}

async function fetchFallback(fetchImpl) {
  const parsed = parseErApiPayload(await fetchJson(FALLBACK_URL, fetchImpl));
  if (!parsed || !parsed.rates.USD) throw new Error('fallback returned no UGX rate');
  return parsed;
}

// --- validation ------------------------------------------------------------

// Returns '' when the rate is acceptable, else the reason it was rejected.
function rateRejectionReason(candidate, lastGood) {
  const rate = Number(candidate);
  if (!Number.isFinite(rate) || rate <= 0) return 'missing';
  if (rate < MIN_UGX_PER_UNIT || rate > MAX_UGX_PER_UNIT) return 'out_of_range';
  const previous = Number(lastGood);
  if (Number.isFinite(previous) && previous > 0) {
    const move = Math.abs(rate / previous - 1);
    if (move > MAX_DAY_ON_DAY_MOVE) return `moved_${Math.round(move * 1000) / 10}pct`;
  }
  return '';
}

// --- DB --------------------------------------------------------------------

async function loadFromDb(db) {
  if (!db?.query) return false;
  try {
    const result = await db.query(
      `SELECT DISTINCT ON (currency) currency, ugx_per_unit, rate_date::text AS rate_date, source, fetched_at
       FROM fx_rates
       ORDER BY currency, rate_date DESC, fetched_at DESC`
    );
    for (const row of result.rows || []) {
      const currency = String(row.currency || '').toUpperCase();
      const rate = Number(row.ugx_per_unit);
      if (!SUPPORTED_CURRENCIES.includes(currency) || !(rate > 0)) continue;
      const fetchedAt = new Date(row.fetched_at).getTime() || 0;
      const current = state.rates[currency];
      if (current && current.fetched_at >= fetchedAt) continue;
      state.rates[currency] = { rate, date: isoDate(row.rate_date), source: String(row.source || ''), fetched_at: fetchedAt };
    }
    return true;
  } catch (error) {
    if (error?.code === '42P01') return false; // table not migrated yet
    throw error;
  }
}

async function saveRate(db, currency, entry) {
  if (!db?.query) return;
  await db.query(
    `INSERT INTO fx_rates (rate_date, currency, ugx_per_unit, source, fetched_at)
     VALUES ($1::date, $2::text, $3::numeric, $4::text, $5::timestamptz)
     ON CONFLICT (rate_date, currency) DO UPDATE
       SET ugx_per_unit = EXCLUDED.ugx_per_unit, source = EXCLUDED.source, fetched_at = EXCLUDED.fetched_at`,
    [entry.date, currency, entry.rate.toFixed(4), entry.source, new Date(entry.fetched_at).toISOString()]
  );
}

// --- refresh -----------------------------------------------------------------

async function refreshRatesNow(db, { fetchImpl = globalThis.fetch, now = Date.now(), logger = null } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch is not available');
  state.lastAttemptAt = now;
  const accepted = {};
  const rejected = {};
  const errors = [];
  let fallback = null;
  let fallbackTried = false;
  const getFallback = async () => {
    if (!fallbackTried) {
      fallbackTried = true;
      try { fallback = await fetchFallback(fetchImpl); } catch (error) { errors.push(error.message); }
    }
    return fallback;
  };

  let primary = null;
  try { primary = await fetchPrimary(fetchImpl); } catch (error) { errors.push(error.message); }

  for (const currency of SUPPORTED_CURRENCIES) {
    const lastGood = state.rates[currency]?.rate;
    const lastGoodDate = state.rates[currency]?.date || '';
    const reasons = [];
    for (const snapshot of [primary, 'fallback']) {
      const source = snapshot === 'fallback' ? await getFallback() : snapshot;
      if (!source) continue;
      const candidate = source.rates[currency];
      const reason = rateRejectionReason(candidate, lastGood);
      if (reason) { reasons.push(`${source.source}: ${reason}`); continue; }
      // A lagging mirror must not replace a newer accepted rate.
      if (lastGoodDate && source.date < lastGoodDate) { reasons.push(`${source.source}: older_than_last_good`); continue; }
      const entry = { rate: Number(candidate), date: source.date, source: source.source, fetched_at: now };
      try {
        await saveRate(db, currency, entry);
      } catch (error) {
        if (error?.code !== '42P01') errors.push(`save ${currency}: ${error.message}`);
      }
      state.rates[currency] = entry;
      accepted[currency] = entry;
      break;
    }
    if (!accepted[currency]) rejected[currency] = reasons.length ? reasons : ['no source'];
  }

  const result = { accepted, rejected, errors, at: new Date(now).toISOString() };
  state.lastResult = result;
  if (logger) {
    const log = Object.keys(rejected).length ? logger.warn : logger.info;
    log?.call(logger, 'FX rates refresh', {
      accepted: Object.fromEntries(Object.entries(accepted).map(([k, v]) => [k, `${v.rate.toFixed(2)} (${v.source} ${v.date})`])),
      rejected,
      errors
    });
  }
  return result;
}

function refreshRates(db, options = {}) {
  if (!refreshing) refreshing = refreshRatesNow(db, options).finally(() => { refreshing = null; });
  return refreshing;
}

function isStale(now = Date.now()) {
  return SUPPORTED_CURRENCIES.some((currency) => {
    const entry = state.rates[currency];
    return !entry || now - entry.fetched_at > STALE_AFTER_MS;
  });
}

async function refreshIfStale(db, options = {}) {
  const now = options.now || Date.now();
  // Another instance may have fetched since this one booted.
  try { await loadFromDb(db); } catch (_) { /* keep memory */ }
  if (!isStale(now)) return { skipped: true, reason: 'fresh' };
  return refreshRates(db, { ...options, now });
}

// --- reading -------------------------------------------------------------------

function currentRate(currency, env = process.env) {
  const code = String(currency || '').toUpperCase();
  if (code === 'UGX') return 1;
  const live = state.rates[code];
  if (live && live.rate > 0) return live.rate;
  return fixedFallbackRates(env)[code] || null;
}

function usdToUgxRate(env = process.env) {
  return currentRate('USD', env);
}

// What GET /api/fx and /config.js publish.
function displayRates(env = process.env) {
  const fixed = fixedFallbackRates(env);
  const rates = {};
  const sources = {};
  const dates = [];
  for (const currency of SUPPORTED_CURRENCIES) {
    const live = state.rates[currency];
    if (live && live.rate > 0) {
      rates[currency] = Math.round(live.rate * 100) / 100;
      sources[currency] = SOURCE_LABELS[live.source] || live.source;
      dates.push(live.date);
    } else {
      rates[currency] = fixed[currency];
      sources[currency] = SOURCE_LABELS.fixed;
      dates.push(fixedFallbackAsOf(env));
    }
  }
  const live = SUPPORTED_CURRENCIES.every((currency) => state.rates[currency]?.rate > 0);
  return {
    base: 'UGX',
    as_of: dates.filter(Boolean).sort()[0] || fixedFallbackAsOf(env),
    rates,
    live,
    sources,
    note: 'Approximate mid-market rates, updated daily. Prices are set in Uganda shillings.'
  };
}

// SQL for a listing's price in UGX today. A listing entered in US dollars is
// its dollar price at today's rate; every other listing is its stored price.
// The rate is a checked number written as a literal so no parameter index moves.
// Only the Uganda site prices in shillings; the South Africa deployment keeps
// its stored prices untouched.
function isUgxDeployment(env = process.env) {
  return String(env.COUNTRY_CODE || 'UG').trim().toUpperCase() !== 'ZA';
}

function effectivePriceUgxSql(alias = 'p', usdRate = usdToUgxRate()) {
  const rate = Number(usdRate);
  const safeAlias = /^[a-z_][a-z0-9_]*$/i.test(alias) ? alias : 'p';
  if (!isUgxDeployment() || !Number.isFinite(rate) || rate <= 0) return `${safeAlias}.price`;
  return `(CASE WHEN ${safeAlias}.price_original_currency = 'USD' AND ${safeAlias}.price_original > 0 THEN ROUND(${safeAlias}.price_original * ${rate.toFixed(4)}) ELSE ${safeAlias}.price END)`;
}

// JS twin of effectivePriceUgxSql for rows already loaded.
function effectivePriceUgx(row = {}, usdRate = usdToUgxRate()) {
  const extra = row?.extra_fields && typeof row.extra_fields === 'object' ? row.extra_fields : {};
  const currency = String(row?.price_original_currency || extra.price_original_currency || '').toUpperCase();
  const original = Number(row?.price_original ?? extra.price_original);
  const rate = Number(usdRate);
  if (isUgxDeployment() && currency === 'USD' && Number.isFinite(original) && original > 0 && Number.isFinite(rate) && rate > 0) {
    return Math.round(original * rate);
  }
  const price = Number(row?.price);
  return Number.isFinite(price) ? price : null;
}

// --- scheduler ---------------------------------------------------------------

function startFxRateScheduler(db, { logger = null, bootDelayMs = 0, fetchImpl } = {}) {
  if (checkTimer || !process.env.DATABASE_URL || process.env.FX_RATES_LIVE === 'false') return false;
  const { observeJob } = require('../utils/memoryLog');
  const tick = () => observeJob('fx_rates', () => refreshIfStale(db, { logger, fetchImpl }))
    .catch((error) => logger?.warn?.('FX rates refresh failed', { error: error.message }));
  loadFromDb(db).catch((error) => logger?.warn?.('FX rates load failed', { error: error.message }));
  setTimeout(tick, bootDelayMs).unref?.();
  checkTimer = setInterval(tick, CHECK_EVERY_MS);
  checkTimer.unref?.();
  return true;
}

function fxStatus() {
  return {
    rates: JSON.parse(JSON.stringify(state.rates)),
    last_attempt_at: state.lastAttemptAt ? new Date(state.lastAttemptAt).toISOString() : null,
    last_result: state.lastResult,
    stale: isStale()
  };
}

function resetFxStateForTests() {
  state.rates = {};
  state.lastAttemptAt = 0;
  state.lastResult = null;
  refreshing = null;
  if (checkTimer) clearInterval(checkTimer);
  checkTimer = null;
}

module.exports = {
  DEFAULT_EUR_TO_UGX_RATE,
  DEFAULT_FX_AS_OF,
  DEFAULT_GBP_TO_UGX_RATE,
  FALLBACK_URL,
  MAX_DAY_ON_DAY_MOVE,
  PRIMARY_URLS,
  SUPPORTED_CURRENCIES,
  currentRate,
  displayRates,
  effectivePriceUgx,
  effectivePriceUgxSql,
  fixedFallbackRates,
  fxStatus,
  isStale,
  loadFromDb,
  parseErApiPayload,
  parseFawazPayload,
  rateRejectionReason,
  refreshIfStale,
  refreshRates,
  resetFxStateForTests,
  startFxRateScheduler,
  usdToUgxRate
};
