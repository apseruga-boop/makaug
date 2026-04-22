const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_RESULT_LIMIT = 8;
const DEFAULT_CACHE_MINUTES = 60;

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeText(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/&amp;/g, '&')
    .replace(/[^a-z0-9+]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();
}

function toPositiveInt(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getTimeoutMs() {
  return Math.max(toPositiveInt(process.env.EXTERNAL_DUPLICATE_SCAN_TIMEOUT_MS, DEFAULT_TIMEOUT_MS), 8000);
}

function getResultLimit() {
  return Math.min(toPositiveInt(process.env.EXTERNAL_DUPLICATE_SCAN_RESULT_LIMIT, DEFAULT_RESULT_LIMIT), 20);
}

function getCacheMinutes() {
  return toPositiveInt(process.env.EXTERNAL_DUPLICATE_SCAN_CACHE_MINUTES, DEFAULT_CACHE_MINUTES);
}

function shouldDisableScan() {
  return String(process.env.EXTERNAL_DUPLICATE_SCAN_DISABLED || '').toLowerCase() === 'true';
}

function getHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch (_error) {
    return '';
  }
}

function isOwnSite(url) {
  const host = getHost(url);
  return !host || host === 'makaug.com' || host.endsWith('.makaug.com') || host === 'localhost';
}

function buildSearchQuery(listing = {}) {
  const title = cleanText(listing.title);
  const parts = [];
  if (title) parts.push(`"${title}"`);
  if (listing.area) parts.push(cleanText(listing.area));
  if (listing.district) parts.push(cleanText(listing.district));
  if (listing.listing_type) parts.push(cleanText(listing.listing_type));
  if (Number(listing.price || 0) > 0) parts.push(String(listing.price));
  parts.push('Uganda property');
  parts.push('-site:makaug.com');
  parts.push('-site:www.makaug.com');
  return parts.filter(Boolean).join(' ');
}

function buildManualSearchUrl(query) {
  const url = new URL('https://duckduckgo.com/');
  url.searchParams.set('q', query);
  return url.href;
}

function describeSearchError(error) {
  if (error?.name === 'AbortError') return 'search timed out';
  const message = cleanText(error?.message || error);
  if (/aborted/i.test(message)) return 'search timed out';
  return message || 'search failed';
}

function isTransientScanFailure(scan = {}) {
  const provider = String(scan.provider || '').toLowerCase();
  const message = String(scan.message || '').toLowerCase();
  return provider === 'search_error'
    || provider === 'search_timeout'
    || message.includes('operation was aborted')
    || message.includes('search timed out')
    || message.includes('fetch failed');
}

function tokenSet(value) {
  const stopWords = new Set(['the', 'and', 'for', 'with', 'from', 'property', 'listing', 'uganda', 'ug']);
  return normalizeText(value)
    .split(' ')
    .filter((token) => token.length >= 3 && !stopWords.has(token));
}

function containsNeedle(haystack, value) {
  const needle = normalizeText(value);
  return !!needle && normalizeText(haystack).includes(needle);
}

function priceNeedle(price) {
  const digits = String(price || '').replace(/\D/g, '');
  return digits.length >= 4 ? digits : '';
}

function scoreSearchResult(result = {}, listing = {}) {
  const haystack = `${result.title || ''} ${result.snippet || ''} ${result.url || ''}`;
  const titleTokens = tokenSet(listing.title);
  const haystackText = normalizeText(haystack);
  const matchedTitleTokens = titleTokens.filter((token) => haystackText.includes(token)).length;
  const titleScore = titleTokens.length ? Math.round((matchedTitleTokens / titleTokens.length) * 55) : 0;
  const areaMatch = containsNeedle(haystack, listing.area);
  const districtMatch = containsNeedle(haystack, listing.district);
  const typeMatch = containsNeedle(haystack, listing.listing_type);
  const price = priceNeedle(listing.price);
  const priceMatch = !!price && haystackText.replace(/\D/g, '').includes(price);
  let score = titleScore;
  if (areaMatch) score += 15;
  if (districtMatch) score += 10;
  if (typeMatch) score += 5;
  if (priceMatch) score += 15;
  if (titleTokens.length && matchedTitleTokens === titleTokens.length && (areaMatch || districtMatch || priceMatch)) {
    score = Math.max(score, 86);
  }
  return Math.min(score, 100);
}

function normalizeResults(results = [], listing = {}) {
  return results
    .map((item) => ({
      title: cleanText(item.title),
      url: cleanText(item.url),
      snippet: cleanText(item.snippet),
      host: getHost(item.url),
      score: scoreSearchResult(item, listing)
    }))
    .filter((item) => item.url && !isOwnSite(item.url))
    .sort((a, b) => b.score - a.score)
    .slice(0, getResultLimit());
}

async function fetchJson(url, options = {}) {
  const timeoutMs = getTimeoutMs();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'user-agent': 'MakaUgDuplicateScanner/1.0',
        ...(options.headers || {})
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchText(url, options = {}) {
  const timeoutMs = getTimeoutMs();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'user-agent': 'MakaUgDuplicateScanner/1.0',
        ...(options.headers || {})
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function searchWithBing(query) {
  const key = cleanText(process.env.BING_SEARCH_API_KEY);
  if (!key) return null;
  const url = new URL('https://api.bing.microsoft.com/v7.0/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(getResultLimit()));
  url.searchParams.set('responseFilter', 'Webpages');
  const json = await fetchJson(url, {
    headers: { 'Ocp-Apim-Subscription-Key': key }
  });
  return {
    provider: 'bing',
    results: (json.webPages?.value || []).map((item) => ({
      title: item.name,
      url: item.url,
      snippet: item.snippet
    }))
  };
}

async function searchWithGoogleCse(query) {
  const key = cleanText(process.env.GOOGLE_CSE_API_KEY || process.env.GOOGLE_SEARCH_API_KEY);
  const cx = cleanText(process.env.GOOGLE_CSE_CX || process.env.GOOGLE_SEARCH_CX);
  if (!key || !cx) return null;
  const url = new URL('https://www.googleapis.com/customsearch/v1');
  url.searchParams.set('key', key);
  url.searchParams.set('cx', cx);
  url.searchParams.set('q', query);
  url.searchParams.set('num', String(Math.min(getResultLimit(), 10)));
  const json = await fetchJson(url);
  return {
    provider: 'google_cse',
    results: (json.items || []).map((item) => ({
      title: item.title,
      url: item.link,
      snippet: item.snippet
    }))
  };
}

async function searchWithSerpApi(query) {
  const key = cleanText(process.env.SERPAPI_API_KEY);
  if (!key) return null;
  const url = new URL('https://serpapi.com/search.json');
  url.searchParams.set('engine', 'google');
  url.searchParams.set('api_key', key);
  url.searchParams.set('q', query);
  url.searchParams.set('num', String(getResultLimit()));
  const json = await fetchJson(url);
  return {
    provider: 'serpapi_google',
    results: (json.organic_results || []).map((item) => ({
      title: item.title,
      url: item.link,
      snippet: item.snippet
    }))
  };
}

function resolveDuckDuckGoUrl(rawUrl) {
  const value = decodeHtml(rawUrl);
  try {
    const parsed = new URL(value, 'https://duckduckgo.com');
    const uddg = parsed.searchParams.get('uddg');
    return uddg ? decodeURIComponent(uddg) : parsed.href;
  } catch (_error) {
    return value;
  }
}

function parseDuckDuckGoHtml(html) {
  const results = [];
  const blockRegex = /<div[^>]+class="[^"]*result[^"]*"[\s\S]*?(?=<div[^>]+class="[^"]*result[^"]*"|<\/body>)/gi;
  const blocks = String(html || '').match(blockRegex) || [];
  blocks.forEach((block) => {
    const anchor = block.match(/<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!anchor) return;
    const snippet = block.match(/<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i)
      || block.match(/<div[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    results.push({
      title: decodeHtml(anchor[2]),
      url: resolveDuckDuckGoUrl(anchor[1]),
      snippet: decodeHtml(snippet?.[1] || '')
    });
  });
  return results;
}

async function searchWithDuckDuckGo(query) {
  const url = new URL('https://duckduckgo.com/html/');
  url.searchParams.set('q', query);
  const html = await fetchText(url);
  return {
    provider: 'duckduckgo_html',
    results: parseDuckDuckGoHtml(html)
  };
}

function parseDuckDuckGoLiteHtml(html) {
  const results = [];
  const rowRegex = /<tr[\s\S]*?<\/tr>/gi;
  const rows = String(html || '').match(rowRegex) || [];
  rows.forEach((row) => {
    const anchor = row.match(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!anchor) return;
    const url = resolveDuckDuckGoUrl(anchor[1]);
    if (!/^https?:\/\//i.test(url)) return;
    results.push({
      title: decodeHtml(anchor[2]),
      url,
      snippet: decodeHtml(row.replace(anchor[0], ''))
    });
  });
  return results;
}

async function searchWithDuckDuckGoLite(query) {
  const url = new URL('https://lite.duckduckgo.com/lite/');
  url.searchParams.set('q', query);
  const html = await fetchText(url);
  return {
    provider: 'duckduckgo_lite',
    results: parseDuckDuckGoLiteHtml(html)
  };
}

async function runSearch(query) {
  const preferredProvider = cleanText(process.env.EXTERNAL_DUPLICATE_SCAN_PROVIDER).toLowerCase();
  const providers = {
    bing: searchWithBing,
    google_cse: searchWithGoogleCse,
    serpapi: searchWithSerpApi,
    duckduckgo: searchWithDuckDuckGo,
    duckduckgo_html: searchWithDuckDuckGo,
    duckduckgo_lite: searchWithDuckDuckGoLite
  };
  const errors = [];

  async function tryProvider(name, provider) {
    try {
      const result = await provider(query);
      if (result) return result;
    } catch (error) {
      errors.push(`${name}: ${describeSearchError(error)}`);
    }
    return null;
  }

  if (providers[preferredProvider]) {
    const result = await tryProvider(preferredProvider, providers[preferredProvider]);
    if (result) return result;
  }

  const fallbackProviders = [
    ['bing', searchWithBing],
    ['google_cse', searchWithGoogleCse],
    ['serpapi', searchWithSerpApi],
    ['duckduckgo_lite', searchWithDuckDuckGoLite],
    ['duckduckgo_html', searchWithDuckDuckGo]
  ].filter(([name]) => name !== preferredProvider);

  for (const [name, provider] of fallbackProviders) {
    const result = await tryProvider(name, provider);
    if (result) return result;
  }

  throw new Error(errors.join('; ') || 'all search providers failed');
}

function getScanStatus(matches = []) {
  const strongMatches = matches.filter((item) => item.score >= 85);
  const possibleMatches = matches.filter((item) => item.score >= 55);
  if (strongMatches.length) return 'fail';
  if (possibleMatches.length) return 'warning';
  return 'pass';
}

function buildScanMessage(status, provider, matches = []) {
  if (status === 'fail') return `External duplicate scan found ${matches.filter((item) => item.score >= 85).length} strong possible duplicate listing${matches.filter((item) => item.score >= 85).length === 1 ? '' : 's'}.`;
  if (status === 'warning') return `External duplicate scan completed via ${provider}; possible lower-confidence matches need review.`;
  return `External duplicate scan completed via ${provider}; no strong external duplicates found.`;
}

async function scanExternalDuplicates({ listing = {}, images = [] } = {}) {
  const checkedAt = new Date().toISOString();
  if (shouldDisableScan()) {
    return {
      status: 'warning',
      provider: 'disabled',
      blocking: false,
      checked_at: checkedAt,
      query: '',
      search_url: '',
      result_count: 0,
      high_confidence_count: 0,
      possible_match_count: 0,
      matches: [],
      message: 'External duplicate scan is disabled by environment configuration.'
    };
  }

  const query = buildSearchQuery(listing);
  if (!query.trim()) {
    return {
      status: 'warning',
      provider: 'missing_listing_data',
      blocking: false,
      checked_at: checkedAt,
      query,
      search_url: buildManualSearchUrl(query),
      result_count: 0,
      high_confidence_count: 0,
      possible_match_count: 0,
      matches: [],
      message: 'External duplicate scan could not run because the listing has too little searchable text.'
    };
  }

  try {
    const search = await runSearch(query);
    const matches = normalizeResults(search.results, listing);
    const status = getScanStatus(matches);
    const highConfidenceCount = matches.filter((item) => item.score >= 85).length;
    const possibleMatchCount = matches.filter((item) => item.score >= 55).length;
    return {
      status,
      provider: search.provider,
      blocking: status === 'fail',
      checked_at: checkedAt,
      query,
      search_url: buildManualSearchUrl(query),
      result_count: matches.length,
      high_confidence_count: highConfidenceCount,
      possible_match_count: possibleMatchCount,
      matches: matches.slice(0, getResultLimit()),
      image_count_checked: images.length,
      message: buildScanMessage(status, search.provider, matches)
    };
  } catch (error) {
    const reason = describeSearchError(error);
    return {
      status: 'warning',
      provider: reason === 'search timed out' ? 'search_timeout' : 'search_error',
      blocking: false,
      checked_at: checkedAt,
      query,
      search_url: buildManualSearchUrl(query),
      result_count: 0,
      high_confidence_count: 0,
      possible_match_count: 0,
      matches: [],
      message: `External search providers did not return in time. Internal duplicate checks completed and a manual search link is available.`
    };
  }
}

function getCachedExternalDuplicateScan(listing = {}) {
  const extra = listing.extra_fields && typeof listing.extra_fields === 'object' ? listing.extra_fields : {};
  const scan = extra.review_external_duplicate_scan;
  if (!scan || typeof scan !== 'object') return null;
  if (isTransientScanFailure(scan)) return null;
  const checkedAt = scan.checked_at ? new Date(scan.checked_at) : null;
  if (!checkedAt || Number.isNaN(checkedAt.getTime())) return null;
  const ageMs = Date.now() - checkedAt.getTime();
  if (ageMs > getCacheMinutes() * 60 * 1000) return null;
  return {
    ...scan,
    cached: true
  };
}

async function scanAndCacheExternalDuplicates({ db, listing = {}, images = [], force = false } = {}) {
  const cached = force ? null : getCachedExternalDuplicateScan(listing);
  if (cached) return cached;

  const scan = await scanExternalDuplicates({ listing, images });
  if (db && listing.id && !isTransientScanFailure(scan)) {
    try {
      await db.query(
        `UPDATE properties
         SET extra_fields = COALESCE(extra_fields, '{}'::jsonb) || jsonb_build_object('review_external_duplicate_scan', $2::jsonb)
         WHERE id = $1`,
        [listing.id, JSON.stringify(scan)]
      );
    } catch (error) {
      scan.cache_error = error.message || 'cache_update_failed';
    }
  }
  return scan;
}

module.exports = {
  buildSearchQuery,
  getCachedExternalDuplicateScan,
  scanAndCacheExternalDuplicates,
  scanExternalDuplicates,
  scoreSearchResult
};
