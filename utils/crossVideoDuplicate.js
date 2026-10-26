'use strict';

// Cross-video duplicates (26 Oct 2026, Arthur).
//
// Listing MK-20261024-67E51F and MK-20261024-400346 are the same 12-decimal
// Kira-Nsasa plot, posted by the BitEstate Africa YouTube channel in two
// different videos (one caption said 100M, the next said "price dropped to
// 70M"). The harvester only recognised the same video URL, so both went in.
//
// A likely cross-video duplicate needs ALL of:
//   - the same lister: same phone (last 9 digits), or the same source channel
//     (registry key or channel URL), or the same (non-generic) lister name;
//   - the same area (spelling-insensitive: "Kira-Nsasa" = "kira nsasa") and,
//     when both have one, the same district;
//   - the same listing type, and nothing that says they differ: bedrooms,
//     unit counts, plot sizes, house/apartment/room/land kind, or a different
//     "Location;" line in a template caption;
//   - a price within 40% (70M vs 100M), unless one caption quotes the other
//     price ("from 100m to 70m");
//   - a score of 2 or more from: same plot size (0.5 for the standard
//     12-13 decimal / 50x100 plot, 1 otherwise), same price (1) or similar
//     price (0.5), a caption that quotes the other price (1.5), similar caption
//     text (1, or 1.5 when near-identical).
// Same channel or same phone alone is never enough (C10: one agent posts many
// different plots). Calibrated on production 26 Oct 2026: 333 approved pairs;
// the scan before the conflict rules flagged 2,693, mostly rentals.

const PRICE_RATIO_MIN = 0.6;
const TEXT_SIMILARITY_MIN = 0.5;
const MIN_SCORE = 2;
const SQFT_PER_DECIMAL = 435.6;

const GENERIC_NAMES = new Set([
  '', 'agent', 'owner', 'private', 'private seller', 'seller', 'landlord', 'makaug', 'makaug team',
  'property agent', 'real estate', 'unknown', 'n/a', 'na', 'none', 'admin', 'staff'
]);

const STOPWORDS = new Set(('a an and are at for from in is it of on or the to with this that by as be '
  + 'call whatsapp inspection details more contact sale sell selling plot plots land house for rent '
  + 'ugx ush shs m million price uganda kampala wakiso realestateuganda real estate property '
  + 'buyland available now new our your we you de').split(/\s+/));

function clean(value) {
  return String(value ?? '').trim();
}

function phoneKey(value) {
  const d = clean(value).replace(/\D/g, '');
  return d.length >= 9 ? d.slice(-9) : '';
}

function areaKey(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function nameKey(value) {
  const key = clean(value).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  return key.length >= 4 && !GENERIC_NAMES.has(key) ? key : '';
}

function extraOf(row = {}) {
  return row.extra_fields && typeof row.extra_fields === 'object' ? row.extra_fields : {};
}

// A source channel key: the stored registry key, else the channel id or handle
// from a channel/profile URL.
function channelKey(row = {}) {
  const extra = extraOf(row);
  const registry = clean(row.source_registry_key || extra.source_registry_key).toLowerCase();
  if (registry) return `registry:${registry}`;
  const url = clean(row.source_channel_url || row.channel_url || extra.youtube_channel_url || extra.source_channel_url || extra.tiktok_profile_url);
  const match = url.match(/youtube\.com\/(?:channel\/([\w-]+)|(@[\w.-]+)|c\/([\w.-]+))/i)
    || url.match(/tiktok\.com\/(@[\w.-]+)/i);
  if (!match) return '';
  return `registry:${(match[1] || match[2] || match[3] || '').toLowerCase()}`;
}

// The lister/source name key, lowercased as stored ('' for generic names).
function nameKeyOf(row = {}) {
  const extra = extraOf(row);
  const raw = clean(row.lister_name || row.source_name || extra.source_name || extra.source_agent_name);
  return nameKey(raw) ? raw.toLowerCase() : '';
}

function listerKeys(row = {}) {
  const extra = extraOf(row);
  const keys = new Set();
  const phone = phoneKey(row.lister_phone || extra.contact_phone);
  if (phone) keys.add(`phone:${phone}`);
  const channel = channelKey(row);
  if (channel) keys.add(channel);
  const name = nameKey(row.lister_name || row.source_name || extra.source_name || extra.source_agent_name);
  if (name) keys.add(`name:${name}`);
  return keys;
}

function sameLister(a = {}, b = {}) {
  const left = listerKeys(a);
  for (const key of listerKeys(b)) {
    if (left.has(key)) return key.split(':')[0];
  }
  return '';
}

function textOf(row = {}) {
  const extra = extraOf(row);
  return [row.title, row.source_title || extra.source_title, row.caption || extra.source_caption || extra.source_description || row.description]
    .map(clean).filter(Boolean).join(' \n ');
}

// Plot sizes in decimals, from the stored land size and the text.
function plotSizes(row = {}) {
  const sizes = [];
  const value = Number(row.land_size_value);
  const unit = clean(row.land_size_unit).toLowerCase();
  if (value > 0) {
    if (/acre/.test(unit)) sizes.push(value * 100);
    else if (/dec/.test(unit)) sizes.push(value);
    else if (/ft|feet/.test(unit)) sizes.push(value / SQFT_PER_DECIMAL);
    else if (/sq|m2|metre|meter/.test(unit)) sizes.push((value * 10.7639) / SQFT_PER_DECIMAL);
  }
  const text = textOf(row).toLowerCase();
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*(?:-|\s)?\s*(decimals?|decimal|dec\b|acres?|ac\b|hectares?|ha\b)/g)) {
    const n = Number(m[1]);
    if (!(n > 0)) continue;
    if (/^ac/.test(m[2])) sizes.push(n * 100);
    else if (/^h/.test(m[2])) sizes.push(n * 247.105);
    else sizes.push(n);
  }
  for (const m of text.matchAll(/\b(\d{2,3})\s*(?:x|×|by)\s*(\d{2,3})\b/g)) {
    const area = Number(m[1]) * Number(m[2]);
    if (area >= 400) sizes.push(area / SQFT_PER_DECIMAL);
  }
  return [...new Set(sizes.map((n) => Math.round(n * 100) / 100))];
}

function sizesMatch(a = [], b = []) {
  return a.some((x) => b.some((y) => Math.abs(x - y) / Math.max(x, y) <= 0.05));
}

function priceRatio(a, b) {
  const left = Number(a);
  const right = Number(b);
  if (!(left > 0) || !(right > 0)) return null;
  return Math.min(left, right) / Math.max(left, right);
}

// Price amounts quoted in text, in UGX ("70m", "100M", "1.2bn", "70,000,000").
function quotedPrices(row = {}) {
  const text = textOf(row).toLowerCase();
  const prices = new Set();
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*(m|million|mn|bn|b|billion)\b/g)) {
    const n = Number(m[1]);
    if (n > 0) prices.add(Math.round(n * (/^b/.test(m[2]) ? 1e9 : 1e6)));
  }
  for (const m of text.matchAll(/\b(\d{1,3}(?:,\d{3}){2,})\b/g)) {
    prices.add(Number(m[1].replace(/,/g, '')));
  }
  return prices;
}

function tokens(row = {}) {
  return new Set(textOf(row).toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t.length > 2 && !STOPWORDS.has(t) && !/^\d+$/.test(t)));
}

function textSimilarity(a = {}, b = {}) {
  const left = tokens(a);
  const right = tokens(b);
  if (left.size < 4 || right.size < 4) return 0;
  let shared = 0;
  for (const t of left) if (right.has(t)) shared += 1;
  return shared / (left.size + right.size - shared);
}

const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

// Bedrooms from the field, else from the text ("3-bedroom", "two bedrooms", "4bdr").
function bedroomCount(row = {}) {
  const stored = Number(row.bedrooms);
  if (stored > 0) return Math.round(stored);
  const text = textOf(row).toLowerCase();
  const m = text.match(/\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s*-?\s*(?:bed(?:room)?s?|bdr?m?s?|br)\b/);
  if (!m) return 0;
  return NUMBER_WORDS[m[1]] || Number(m[1]) || 0;
}

function bedroomsConflict(a = {}, b = {}) {
  const left = bedroomCount(a);
  const right = bedroomCount(b);
  return left > 0 && right > 0 && left !== right;
}

const PROPERTY_KINDS = [
  ['room', /\b(single room|double room|bed ?sitter|studio|self[- ]contained (?:single|double)? ?room|hostel|room for rent)\b/],
  ['apartment', /\b(apartments?|flat|condo(?:minium)?)\b/],
  ['house', /\b(house|bungalow|mansion|villa|duplex|town ?house|maisonette|home)\b/],
  ['commercial', /\b(shops?|offices?|warehouse|godown|stores?|rental units|apartment bloc?k?|bloc|arcade|hotel|commercial building)\b/],
  ['land', /\b(plots?|land|acres?|decimals?|hectares?)\b/]
];

function propertyKinds(row = {}) {
  const text = [row.title, row.source_title || extraOf(row).source_title].map(clean).join(' ').toLowerCase();
  return new Set(PROPERTY_KINDS.filter(([, pattern]) => pattern.test(text)).map(([kind]) => kind));
}

function kindsConflict(a = {}, b = {}) {
  const left = propertyKinds(a);
  const right = propertyKinds(b);
  if (!left.size || !right.size) return false;
  for (const kind of left) if (right.has(kind)) return false;
  return true;
}

// Unit counts ("8 units", "12 rental units") must agree when both say one.
function unitCount(row = {}) {
  const m = textOf(row).toLowerCase().match(/\b(\d{1,3})\s*(?:rental\s*)?units?\b/);
  return m ? Number(m[1]) : 0;
}

// Template captions ("Location; Kira-Mulawa ... Plot Size; ...") name the
// exact spot; two different spots are two different plots.
function statedLocation(row = {}) {
  const m = textOf(row).toLowerCase().match(/\blocation\s*[;:\-]\s*([^\n;:]+?)(?=\s*(?:plot size|size|price|tenure|[;\n]|$))/);
  return m ? m[1].replace(/[^a-z0-9]+/g, '') : '';
}

function detailsConflict(a = {}, b = {}) {
  const leftUnits = unitCount(a);
  const rightUnits = unitCount(b);
  if (leftUnits && rightUnits && leftUnits !== rightUnits) return true;
  const leftLocation = statedLocation(a);
  const rightLocation = statedLocation(b);
  return Boolean(leftLocation && rightLocation && leftLocation !== rightLocation);
}

// 12-13 decimals (50x100 ft) is the standard Ugandan plot, weak evidence alone.
function standardPlot(sizes = []) {
  return sizes.every((n) => n >= 11 && n <= 13.5);
}

function sameArea(a = {}, b = {}) {
  const left = areaKey(a.area);
  if (!left || left !== areaKey(b.area)) return false;
  const leftDistrict = areaKey(a.district);
  const rightDistrict = areaKey(b.district);
  return !leftDistrict || !rightDistrict || leftDistrict === rightDistrict;
}

/**
 * Why `listing` looks like the same property as `candidate` from a different
 * post, or null. Returns { code, label, lister, evidence: [...] }.
 */
function crossVideoDuplicateReason(listing = {}, candidate = {}) {
  if (!listing || !candidate) return null;
  if (listing.id != null && String(listing.id) === String(candidate.id ?? '')) return null;
  const lister = sameLister(listing, candidate);
  if (!lister) return null;
  if (!sameArea(listing, candidate)) return null;
  if (clean(listing.listing_type).toLowerCase() !== clean(candidate.listing_type).toLowerCase()) return null;
  if (bedroomsConflict(listing, candidate) || kindsConflict(listing, candidate) || detailsConflict(listing, candidate)) return null;
  const leftSizes = plotSizes(listing);
  const rightSizes = plotSizes(candidate);
  const bothSized = leftSizes.length > 0 && rightSizes.length > 0;
  const sizeMatch = bothSized && sizesMatch(leftSizes, rightSizes);
  if (bothSized && !sizeMatch) return null;
  const ratio = priceRatio(listing.price, candidate.price);
  const leftPrice = Math.round(Number(listing.price) || 0);
  const rightPrice = Math.round(Number(candidate.price) || 0);
  // A price change: one caption quotes the other listing's (different) price.
  const priceChangeQuoted = leftPrice > 0 && rightPrice > 0 && leftPrice !== rightPrice
    && (quotedPrices(listing).has(rightPrice) || quotedPrices(candidate).has(leftPrice));
  if (ratio != null && ratio < PRICE_RATIO_MIN && !priceChangeQuoted) return null;
  const similarity = textSimilarity(listing, candidate);
  const evidence = [];
  let score = 0;
  if (sizeMatch) {
    const standard = standardPlot(leftSizes) && standardPlot(rightSizes);
    score += standard ? 0.5 : 1;
    evidence.push('same plot size');
  }
  if (ratio != null && ratio >= 0.95) { score += 1; evidence.push('same price'); }
  else if (ratio != null && ratio >= PRICE_RATIO_MIN) { score += 0.5; evidence.push('similar price'); }
  if (priceChangeQuoted) { score += 1.5; evidence.push('caption quotes the other price'); }
  if (similarity >= 0.7) { score += 1.5; evidence.push('near-identical caption'); }
  else if (similarity >= TEXT_SIMILARITY_MIN) { score += 1; evidence.push('similar caption'); }
  if (score < MIN_SCORE) return null;
  const listerLabel = { phone: 'same phone', registry: 'same source channel', name: 'same lister' }[lister] || 'same lister';
  return {
    code: 'same_lister_area_similar_plot',
    label: `same property from another post: ${listerLabel}, same area, ${evidence.join(', ')}`,
    lister,
    evidence,
    score
  };
}

function duplicateRef(row = {}) {
  return clean(row.inquiry_reference || row.ref) || clean(row.id).slice(0, 8);
}

function possibleDuplicateWarning(row = {}) {
  return `Possible duplicate of ${duplicateRef(row)}`;
}

module.exports = {
  MIN_SCORE,
  PRICE_RATIO_MIN,
  bedroomCount,
  propertyKinds,
  areaKey,
  channelKey,
  crossVideoDuplicateReason,
  duplicateRef,
  listerKeys,
  nameKeyOf,
  plotSizes,
  possibleDuplicateWarning,
  quotedPrices,
  textSimilarity
};
