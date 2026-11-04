'use strict';

// Weekly mortgage-rate check (approved by Arthur, 4 Nov 2026 07:06 UK).
// Fetches each lender's public rate page and the Bank of Uganda site, pulls
// out the percentages, and compares them with the last snapshot. When the
// numbers change it records a *proposed* change in mortgage_rate_proposals
// for staff to approve in the admin. It never edits a published rate.

const crypto = require('crypto');

const USER_AGENT = 'Mozilla/5.0 (compatible; makaug-rate-check/1.0; +https://makaug.com)';
const FETCH_TIMEOUT_MS = 20000;
const MAX_BODY_CHARS = 2_000_000;

// Bank of Uganda Monetary Policy Committee decision dates (London dates).
// The scheduler runs at 05:30 London, before the Kampala announcement, so it
// also runs the day after each date to catch the decision.
const BOU_MPC_DATES = Object.freeze(['2026-11-12']);

// Extra pages watched next to each provider's sourceUrl.
const EXTRA_WATCH_PAGES = Object.freeze([
  // bou.or.ug renders in the browser; these are the JSON feeds its pages read.
  { provider_key: 'bou', rate_field: 'centralBankRate', url: 'https://bou.or.ug/api/monetary-policy/latestFiles' },
  { provider_key: 'bou', rate_field: 'centralBankRate', url: 'https://bou.or.ug/api/press-release/findLatestCategoryData?category=Press%20Releases' },
  { provider_key: 'stanbic', rate_field: 'residentialRate', url: 'https://www.stanbicbank.co.ug/uganda/personal/products-and-services/borrow-for-your-needs/see-all-mortgages-and-home-loans/house-purchase-loan' },
  { provider_key: 'dfcu', rate_field: 'residentialRate', url: 'https://www.dfcugroup.com/personal-banking/home-loans/' },
  { provider_key: 'absa', rate_field: 'primeRate', url: 'https://www.absa.co.ug/personal/home-loans/' },
]);

function htmlToText(html) {
  return String(html || '')
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#37;|&percnt;/gi, '%')
    .replace(/\s+/g, ' ')
    .trim();
}

const RATE_WORDS = /(mortgage|home loan|housing|house purchase|interest rate|lending rate|prime|reference rate|central bank rate|\bcbr\b|pricing|per annum|p\.a\.|loan)/i;

// Percentages between 5% and 40% that sit within 200 characters of a rate
// word. Deposit/LTV percentages (e.g. 80%, 85%) fall outside the range.
function extractRateNumbers(text) {
  const found = new Set();
  const re = /(\d{1,2}(?:\.\d{1,2})?)\s?(?:%|percent\b|per cent\b)/gi;
  let match;
  while ((match = re.exec(text))) {
    const value = Number(match[1]);
    if (!(value >= 5 && value <= 40)) continue;
    const near = text.slice(Math.max(0, match.index - 200), match.index + 80);
    if (!RATE_WORDS.test(near)) continue;
    found.add(Number(value.toFixed(2)));
  }
  return [...found].sort((a, b) => a - b);
}

function sameNumbers(a = [], b = []) {
  if (a.length !== b.length) return false;
  return a.every((value, index) => Number(value) === Number(b[index]));
}

function watchListFromProviders(providers = []) {
  const list = [];
  const seen = new Set();
  const add = (item) => {
    const key = `${item.provider_key}|${item.url}`;
    if (!item.url || seen.has(key)) return;
    seen.add(key);
    list.push(item);
  };
  for (const provider of providers) {
    add({
      provider_key: provider.key,
      rate_field: provider.residentialRate == null && provider.primeRate != null ? 'primeRate' : 'residentialRate',
      url: provider.sourceUrl,
      current_rate: provider.residentialRate ?? provider.primeRate ?? null,
    });
  }
  for (const extra of EXTRA_WATCH_PAGES) {
    const provider = providers.find((p) => p.key === extra.provider_key);
    add({ ...extra, current_rate: extra.provider_key === 'bou' ? null : (provider?.residentialRate ?? provider?.primeRate ?? null) });
  }
  return list;
}

async function fetchPageText(url, fetchImpl = globalThis.fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml,application/json' },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, status: response.status };
    const raw = (await response.text()).slice(0, MAX_BODY_CHARS);
    return { ok: true, status: response.status, text: htmlToText(raw) };
  } catch (error) {
    return { ok: false, status: 0, error: error?.name === 'AbortError' ? 'timeout' : (error?.message || 'fetch_failed') };
  } finally {
    clearTimeout(timer);
  }
}

function mortgageRateWatchDue(dateKey) {
  const [y, m, d] = String(dateKey).split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  if (weekday === 1) return { due: true, reason: 'weekly' };
  for (const mpc of BOU_MPC_DATES) {
    if (mpc === dateKey) return { due: true, reason: 'bou_mpc' };
    const [my, mm, md] = mpc.split('-').map(Number);
    const after = new Date(Date.UTC(my, mm - 1, md + 1)).toISOString().slice(0, 10);
    if (after === dateKey) return { due: true, reason: 'bou_mpc_next_day' };
  }
  return { due: false, reason: 'not_scheduled' };
}

async function runMortgageRateWatch(db, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const providers = options.providers || require('../routes/mortgage').FALLBACK_MORTGAGE_PROVIDERS;
  const watch = watchListFromProviders(providers);
  const report = { checked: 0, failed: 0, baselines: 0, unchanged: 0, proposals: 0, items: [] };
  for (const item of watch) {
    if (typeof options.shouldStop === 'function' && options.shouldStop()) break;
    const page = await fetchPageText(item.url, fetchImpl);
    if (!page.ok) {
      report.failed += 1;
      report.items.push({ provider_key: item.provider_key, url: item.url, result: 'fetch_failed', status: page.status });
      continue;
    }
    report.checked += 1;
    const numbers = extractRateNumbers(page.text);
    const hash = crypto.createHash('sha256').update(JSON.stringify(numbers)).digest('hex');
    const prior = await db.query(
      `SELECT numbers FROM mortgage_rate_source_snapshots WHERE source_url = $1`,
      [item.url]
    );
    const before = prior.rows[0]?.numbers || null;
    await db.query(
      `INSERT INTO mortgage_rate_source_snapshots (source_url, provider_key, numbers, numbers_hash, fetched_at)
       VALUES ($1, $2, $3::jsonb, $4, NOW())
       ON CONFLICT (source_url) DO UPDATE
         SET numbers = EXCLUDED.numbers, numbers_hash = EXCLUDED.numbers_hash,
             provider_key = EXCLUDED.provider_key, fetched_at = NOW()`,
      [item.url, item.provider_key, JSON.stringify(numbers), hash]
    );
    if (!before) {
      report.baselines += 1;
      report.items.push({ provider_key: item.provider_key, url: item.url, result: 'baseline', numbers });
      continue;
    }
    if (sameNumbers(before, numbers)) {
      report.unchanged += 1;
      report.items.push({ provider_key: item.provider_key, url: item.url, result: 'unchanged' });
      continue;
    }
    const added = numbers.filter((n) => !before.map(Number).includes(n));
    const proposed = added.length === 1 ? added[0] : null;
    await db.query(
      `INSERT INTO mortgage_rate_proposals
         (provider_key, rate_field, current_rate, proposed_rate, source_url, numbers_before, numbers_after, reason)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)`,
      [
        item.provider_key,
        item.rate_field,
        item.current_rate,
        proposed,
        item.url,
        JSON.stringify(before),
        JSON.stringify(numbers),
        options.reason || 'weekly',
      ]
    );
    report.proposals += 1;
    report.items.push({ provider_key: item.provider_key, url: item.url, result: 'proposal', before, after: numbers });
  }
  return report;
}

module.exports = {
  BOU_MPC_DATES,
  EXTRA_WATCH_PAGES,
  extractRateNumbers,
  htmlToText,
  mortgageRateWatchDue,
  runMortgageRateWatch,
  sameNumbers,
  watchListFromProviders,
};
