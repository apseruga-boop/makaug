'use strict';

const { isPriceImplausible } = require('../utils/pricePlausibility');

const { tenantFor } = require('../packages/shared-country-core');

const ACTIVE_COUNTRY_CODE = String(process.env.COUNTRY_CODE || 'UG').trim().toUpperCase();
const ACTIVE_TENANT = tenantFor(ACTIVE_COUNTRY_CODE);
const DEFAULT_HOME_URL = ACTIVE_TENANT.domain;
const WHATSAPP_PROPERTY_SEARCH_PREVIEW_LIMIT = 3;

function cleanText(value = '') {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanWhatsappTitleText(value = '') {
  // A title pasted with **stars** or _underscores_ round it: WhatsApp would
  // print some of them and embolden the rest ("**1 acre of land**", Oct 2026).
  return require('./publicListingCopy').stripMarkdownEmphasis(cleanText(value))
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '')
    .replace(/\+?\d[\d\s()./-]{6,}\d/g, '')
    .replace(/#[\p{L}\p{N}_.-]+/gu, '')
    .replace(/[\p{Regional_Indicator}\p{Extended_Pictographic}]/gu, '')
    .replace(/[|•]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,.;:!?-]+|[\s,.;:!?-]+$/g, '')
    .trim();
}

function normalizedListingType(row = {}) {
  const raw = cleanText(row.listing_type || row.category || row.type).toLowerCase();
  if (['sale', 'for_sale', 'buy'].includes(raw)) return 'sale';
  if (['rent', 'rental', 'to_rent'].includes(raw)) return 'rent';
  if (['student', 'students', 'hostel'].includes(raw)) return 'student';
  if (raw === 'commercial') return 'commercial';
  if (raw === 'land') return 'land';
  return 'sale';
}

function whatsappListingTypeLabel(row = {}) {
  const labels = {
    sale: 'For Sale',
    rent: 'For Rent',
    student: 'Student',
    commercial: 'Commercial',
    land: 'Land'
  };
  return labels[normalizedListingType(row)] || labels.sale;
}

function generatedWhatsappTitle(row = {}) {
  const area = cleanText(row.area || row.district || ACTIVE_TENANT.countryName);
  const type = normalizedListingType(row);
  if (type === 'rent') return `Property for rent in ${area}`;
  if (type === 'student') return `Student accommodation in ${area}`;
  if (type === 'commercial') return `Commercial property in ${area}`;
  if (type === 'land') return `Land for sale in ${area}`;
  return `Property for sale in ${area}`;
}

function cleanWhatsappPropertyTitle(row = {}) {
  const raw = cleanText(row.title);
  const cleaned = cleanWhatsappTitleText(raw);
  const sourceLike = raw.length > 100
    || /#|https?:\/\/|\b(?:call|whats ?app|contact|more information|more info|fyp|tiktok|posted online|sourced online)\b/i.test(raw)
    || /\+?\d[\d\s()./-]{6,}\d/.test(raw)
    || cleaned.length > 90;
  if (!sourceLike && cleaned.length >= 4) return cleaned;
  return generatedWhatsappTitle(row);
}

function compactNumber(value, divisor, suffix) {
  const scaled = value / divisor;
  const digits = Number.isInteger(scaled) ? 0 : (scaled >= 10 ? 1 : 2);
  return `${scaled.toFixed(digits).replace(/\.0+$|(?<=\.\d)0+$/g, '')}${suffix}`;
}

const STUDENT_PRICE_PERIODS = Object.freeze({
  mo: 'month', month: 'month', monthly: 'month',
  sem: 'semester', semester: 'semester',
  yr: 'year', year: 'year', yearly: 'year',
  wk: 'week', week: 'week', weekly: 'week'
});

function meaningfulWhatsappPeriod(row = {}) {
  const type = normalizedListingType(row);
  if (type === 'sale') return '';
  if (type === 'rent') return 'month';
  if (type === 'student') {
    // By the semester, unless the listing says otherwise. A room at 450K a
    // month was being shown to students as "450K/semester": a different room
    // at a quarter of the price.
    const stored = cleanText(row.price_period || row.period || '').toLowerCase();
    return STUDENT_PRICE_PERIODS[stored] || 'semester';
  }

  const transaction = cleanText(row.transaction_type || row.transaction || '').toLowerCase();
  const rawPeriod = cleanText(row.price_period || row.period || '').toLowerCase();
  if (/sale|sell|buy|once/.test(transaction)) return '';
  const rental = /rent|lease|let/.test(transaction)
    || /^(?:mo|month|monthly|yr|year|yearly|week|weekly|day|daily|night|nightly|acre_yr|acre-year)$/.test(rawPeriod);
  if (!rental) return '';

  const periodMap = {
    mo: 'month', monthly: 'month', month: 'month',
    yr: 'year', yearly: 'year', year: 'year',
    weekly: 'week', week: 'week',
    daily: 'day', day: 'day',
    nightly: 'night', night: 'night',
    acre_yr: 'acre/year', 'acre-year': 'acre/year'
  };
  return periodMap[rawPeriod] || 'month';
}

function formatWhatsappPropertyPrice(row = {}) {
  const extra = row.extra_fields && typeof row.extra_fields === 'object' ? row.extra_fields : {};
  const amount = Number(row.price);
  // C17: an implausible price is never sent as a number.
  if (row.price_on_application === true || extra.price_on_application === true || extra.price_review === 'implausible'
    || !Number.isFinite(amount) || amount <= 0 || isPriceImplausible(row)) {
    return 'Price on application (POA)';
  }
  let amountText = '';
  if (amount >= 1_000_000_000) amountText = compactNumber(amount, 1_000_000_000, 'B');
  else if (amount >= 1_000_000) amountText = compactNumber(amount, 1_000_000, 'M');
  else if (amount >= 1_000) amountText = compactNumber(amount, 1_000, 'K');
  else amountText = Math.round(amount).toLocaleString(ACTIVE_TENANT.dateLocale || 'en-UG');
  const period = meaningfulWhatsappPeriod(row);
  return `${ACTIVE_TENANT.currencyLabel} ${amountText}${period ? `/${period}` : ''}`;
}

function publicMediaUrl(value = '') {
  const candidate = cleanText(value);
  if (!candidate || candidate.length > 2000) return '';
  try {
    const parsed = new URL(candidate);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return '';
    return parsed.toString();
  } catch (_error) {
    return '';
  }
}

function firstImageFromCollection(value) {
  if (!Array.isArray(value)) return '';
  for (const item of value) {
    const url = publicMediaUrl(typeof item === 'string' ? item : item?.url || item?.src || item?.image_url);
    if (url) return url;
  }
  return '';
}

/**
 * Only a picture we serve ourselves goes on a WhatsApp card.
 *
 * WhatsApp cannot be handed a link; the transport has to download the file
 * first. A thumbnail hotlinked from the site a listing was found on — a signed
 * TikTok CDN URL, say — answers that download with 403. The send then fails,
 * and because the photo and the words travel as one message, the words are
 * lost with it: on 25 Sep 2026 someone asking for a house in Lweza got nothing
 * back at all, twice.
 *
 * A card with no photo is worth immeasurably more than a card that cannot be
 * sent, so anything we do not host is not offered as the image.
 */
function ownMediaHost(host = '') {
  const candidate = String(host || '').toLowerCase();
  if (!candidate) return false;
  const hosts = new Set();
  const add = (value) => {
    try {
      const parsed = new URL(String(value || '').trim());
      if (parsed.host) hosts.add(parsed.host.toLowerCase());
    } catch (_error) { /* not a URL we can learn a host from */ }
  };
  add(ACTIVE_TENANT.domain);
  add(process.env.PUBLIC_BASE_URL);
  add(process.env.S3_PUBLIC_BASE_URL);
  for (const known of hosts) {
    if (candidate === known) return true;
    // media.makaug.com is ours; p19-common-sign.tiktokcdn-us.com is not.
    const root = known.replace(/^www\./, '');
    if (candidate === root || candidate.endsWith(`.${root}`)) return true;
  }
  return false;
}

function servablePropertyImageUrl(value = '') {
  const url = publicMediaUrl(value);
  if (!url) return '';
  try {
    return ownMediaHost(new URL(url).host) ? url : '';
  } catch (_error) {
    return '';
  }
}

function whatsappPropertyImageUrl(row = {}) {
  const extra = row.extra_fields && typeof row.extra_fields === 'object' ? row.extra_fields : {};
  const rawSource = extra.raw_source_post && typeof extra.raw_source_post === 'object' ? extra.raw_source_post : {};
  const candidates = [
    row.primary_image_url,
    row.primaryImageUrl,
    firstImageFromCollection(row.images),
    firstImageFromCollection(row.image_urls),
    extra.tiktok_thumbnail_cache_url,
    extra.thumbnail_cache_url,
    extra.source_thumbnail_cache_url,
    extra.cached_thumbnail_url,
    extra.oembed_thumbnail_url,
    extra.tiktok_thumbnail_url,
    extra.video_thumbnail_url,
    extra.source_thumbnail_url,
    extra.thumbnail_url,
    rawSource.oembed_thumbnail_url,
    rawSource.tiktok_thumbnail_url,
    rawSource.video_thumbnail_url,
    rawSource.source_thumbnail_url,
    rawSource.thumbnail_url
  ];
  for (const candidate of candidates) {
    const url = servablePropertyImageUrl(candidate);
    if (url) return url;
  }
  return '';
}

function safeHomeUrl(value = DEFAULT_HOME_URL) {
  return publicMediaUrl(value) || DEFAULT_HOME_URL;
}

function propertyUrlForWhatsapp(row = {}, homeUrl = DEFAULT_HOME_URL) {
  const direct = publicMediaUrl(row.property_url || row.url);
  if (direct) return direct;
  const base = safeHomeUrl(homeUrl).replace(/\/+$/, '');
  return `${base}/property/${encodeURIComponent(cleanText(row.id))}`;
}

function buildWhatsappPropertyCard(row = {}, {
  homeUrl = DEFAULT_HOME_URL,
  allPropertiesUrl = ''
} = {}) {
  const base = safeHomeUrl(homeUrl).replace(/\/+$/, '');
  const browseUrl = publicMediaUrl(allPropertiesUrl) || base;
  const location = [cleanText(row.area), cleanText(row.district)].filter(Boolean).join(', ') || ACTIVE_TENANT.countryName;
  const propertyUrl = propertyUrlForWhatsapp(row, base);
  const caption = [
    `🏡 ${cleanWhatsappPropertyTitle(row)}`,
    `📍 ${location}`,
    `🏷️ ${whatsappListingTypeLabel(row)}`,
    `💰 ${formatWhatsappPropertyPrice(row)}`,
    `🔗 View photos, map & enquire: ${propertyUrl}`,
    `🔎 View all properties: ${browseUrl}`
  ].join('\n');
  return {
    caption,
    imageUrl: whatsappPropertyImageUrl(row),
    propertyUrl,
    allPropertiesUrl: browseUrl
  };
}

function propertyIdsFromWhatsappReply(value = '', homeUrl = DEFAULT_HOME_URL) {
  const base = safeHomeUrl(homeUrl).replace(/\/+$/, '');
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = String(value || '').matchAll(new RegExp(`${escaped}/property/([A-Za-z0-9-]{6,})`, 'ig'));
  return [...new Set(Array.from(matches, (match) => match[1]).filter(Boolean))];
}

function propertyIdFromWhatsappReply(value = '', homeUrl = DEFAULT_HOME_URL) {
  return propertyIdsFromWhatsappReply(value, homeUrl)[0] || '';
}

function whatsappSearchTypeLabel(searchType = '') {
  const clean = cleanText(searchType).toLowerCase();
  const labels = {
    sale: 'properties for sale',
    rent: 'rental properties',
    student: 'student accommodation listings',
    commercial: 'commercial property listings',
    land: 'land listings',
    any: 'properties'
  };
  return labels[clean] || labels.any;
}

function whatsappHomeTypeLine(row = {}, title = '') {
  const type = cleanText(row.property_type).toLowerCase().replace(/_/g, ' ');
  const beds = Number(row.bedrooms);
  const titleLower = cleanText(title).toLowerCase();
  const typeInTitle = type && titleLower.includes(type);
  const bedsInTitle = /\b\d+\s*-?\s*(?:bed|bdrm|bedroom)/i.test(titleLower) || /\b(?:single|double) room\b|\bstudio\b|\bbedsitter\b/i.test(titleLower);
  const parts = [];
  if (Number.isFinite(beds) && beds > 0 && !bedsInTitle) parts.push(`${beds} bedroom${beds === 1 ? '' : 's'}`);
  if (type && !typeInTitle && !/^(?:property|properties|other)$/.test(type)) parts.push(type);
  return parts.join(' · ');
}

function totalWhatsappSearchMatches(rows = []) {
  const safeRows = Array.isArray(rows) ? rows : [];
  return Math.max(
    safeRows.length,
    ...safeRows
      .map((row) => Number(row?.total_count || 0))
      .filter((value) => Number.isFinite(value) && value > 0)
  );
}

/**
 * A property's short link: makaug.com/p/74234ea2, the first part of its id.
 * The long one (makaug.com/property/74234ea2-2cfe-4ecb-…) filled half a line
 * of every result and told nobody anything (16 Nov 2026: "naff and a bit
 * boring"). /p/<code> on the site sends it to the property page.
 */
function shortPropertyCode(id = '') {
  const match = cleanText(id).toLowerCase().match(/^([0-9a-f]{8})-?[0-9a-f]{4}/);
  return match ? match[1] : '';
}

function homeHost(homeUrl = DEFAULT_HOME_URL) {
  return safeHomeUrl(homeUrl).replace(/\/+$/, '').replace(/^https?:\/\//i, '');
}

function shortPropertyUrl(row = {}, homeUrl = DEFAULT_HOME_URL) {
  const code = shortPropertyCode(row.id);
  return code ? `${homeHost(homeUrl)}/p/${code}` : propertyUrlForWhatsapp(row, homeUrl);
}

/** The short codes in a reply, in the order they appear. */
function shortCodesFromWhatsappReply(value = '', homeUrl = DEFAULT_HOME_URL) {
  const escaped = homeHost(homeUrl).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = String(value || '').matchAll(new RegExp(`(?:https?://)?${escaped}/p/([0-9a-f]{8})\\b`, 'ig'));
  return [...new Set(Array.from(matches, (match) => match[1].toLowerCase()))];
}

/**
 * The picture that goes with a property on WhatsApp: the card makaug.com
 * already draws for every listing (its photo, the price, where, and whether it
 * is verified). A listing with no photo gets the card for its kind.
 */
function shareCardImageUrl(row = {}, homeUrl = DEFAULT_HOME_URL) {
  const id = cleanText(row.id);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return '';
  const updated = Date.parse(row.updated_at || '');
  const version = Number.isFinite(updated) ? Math.floor(updated / 1000).toString(36) : '3';
  return `${safeHomeUrl(homeUrl).replace(/\/+$/, '')}/og/property/${encodeURIComponent(id)}.jpg?v=${version}`;
}

/** "USh 900K/month" → "USh 900K a month". */
function whatsappPriceWords(row = {}) {
  return formatWhatsappPropertyPrice(row)
    .replace(/\/(?:mo|month)\b/i, ' a month')
    .replace(/\/night\b/i, ' a night')
    .replace(/\/(?:sem|semester)\b/i, ' a semester')
    .replace(/\/(?:yr|year)\b/i, ' a year')
    .replace(/\/(?:wk|week)\b/i, ' a week');
}

/** "2-bed house for rent in Kira" → "2-bed house, Kira". Anything else as it is. */
function shortListingLabel(row = {}) {
  const title = cleanWhatsappPropertyTitle(row);
  const match = title.match(/^(.{3,60}?)\s+(?:(?:for|to)\s+(?:rent|sale|let|lease)\s+)?(?:in|at)\s+([^,]{2,40})$/i);
  const label = match ? `${match[1]}, ${match[2]}` : title;
  return label.length > 56 ? `${label.slice(0, 55).trim()}…` : label;
}

/**
 * A result's label: what it is and where. "Property for rent in Bunga" says
 * nothing about what it is, so the listing's own type and bedrooms say it
 * (a renter asking for a single room cannot tell a room from a villa).
 */
function resultLabel(row = {}) {
  const title = cleanWhatsappPropertyTitle(row);
  const label = shortListingLabel(row);
  const homeLine = whatsappHomeTypeLine(row, title);
  if (!homeLine) return label;
  const what = homeLine
    .replace(/^(\d+) bedrooms? · (.+)$/, '$1-bed $2')
    .replace(/^(\d+) bedrooms?$/, '$1 bedrooms');
  const generic = label.match(/^(?:Property|Properties|Home|Listing)(, .+)?$/i);
  if (generic) return `${what.charAt(0).toUpperCase()}${what.slice(1)}${generic[1] || ''}`;
  return `${label} · ${what}`;
}

function searchNoun(searchType = '') {
  const nouns = {
    sale: 'properties for sale',
    rent: 'homes to rent',
    student: 'student rooms',
    commercial: 'commercial spaces',
    land: 'plots and land',
    any: 'properties'
  };
  return nouns[cleanText(searchType).toLowerCase()] || nouns.any;
}

/** "Reply *1*, *2* or *3* to see one", for the numbers shown. */
function pickPrompt(first, last) {
  const numbers = [];
  for (let n = first; n <= last; n += 1) numbers.push(`*${n}*`);
  if (numbers.length === 1) return `Reply ${numbers[0]} to see it`;
  return `Reply ${numbers.slice(0, -1).join(', ')} or ${numbers[numbers.length - 1]} to see one`;
}

/**
 * Results as a list that fits under the property's picture: the number, what
 * it is, the price, the short link. The first is numbered `startAt`, so MORE
 * carries on from where the list stopped.
 */
function buildWhatsappResultsList(rows = [], {
  homeUrl = DEFAULT_HOME_URL,
  header = '',
  startAt = 1,
  hasMore = false,
  browseUrl = '',
  total = 0
} = {}) {
  const safeRows = (Array.isArray(rows) ? rows : []).filter(Boolean);
  const lines = [];
  if (header) lines.push(header, '');
  safeRows.forEach((row, index) => {
    lines.push(`*${startAt + index}* · ${resultLabel(row)}`);
    lines.push(`      *${whatsappPriceWords(row)}*`);
    if (cleanText(row.distance_label)) lines.push(`      📏 ${cleanText(row.distance_label)}`);
    lines.push(`      ${shortPropertyUrl(row, homeUrl)}`);
  });
  if (safeRows.length) {
    lines.push('');
    lines.push(`${pickPrompt(startAt, startAt + safeRows.length - 1)}${hasMore ? ', *MORE* for more' : ''}.`);
  }
  const all = cleanText(browseUrl).replace(/^https?:\/\//i, '');
  if (all && total > startAt + safeRows.length - 1) lines.push(`See all ${total}: ${all}`);
  return lines.join('\n').trim();
}

/**
 * What CONTACT will give for this property, said truthfully. 25 Nov 2026: two
 * rooms found on TikTok, with no number on either post, each said "Reply
 * CONTACT for the owner's number"; CONTACT gave the poster's page and "There
 * is no phone number on the post". A listing found online gets who posted it
 * (and their number when the post had one); one listed with us, its owner's.
 */
function contactPromise(row = {}) {
  let facts = {};
  try {
    facts = require('./whatsappListingEnquiryService').listingSourceFacts(row) || {};
  } catch (_error) {
    facts = {};
  }
  if (!facts.foundOnline) return "for the owner's number";
  return facts.phone ? 'for their number' : 'to see who posted it';
}

/**
 * One property, when somebody has picked it from a list (or it was the only
 * match): what it is, the price, where, the short link, and the word that gets
 * them the person holding it. `others` are the other numbers they can pick.
 */
function buildWhatsappPropertyPickCard(row = {}, { homeUrl = DEFAULT_HOME_URL, others = [] } = {}) {
  const location = [cleanText(row.area), cleanText(row.district)].filter(Boolean).join(', ') || ACTIVE_TENANT.countryName;
  const title = cleanWhatsappPropertyTitle(row);
  const homeLine = whatsappHomeTypeLine(row, title);
  const lines = [
    `🏡 *${title}*`,
    `💰 ${whatsappPriceWords(row)}`,
    `📍 ${location}`
  ];
  if (homeLine) lines.push(`🛏️ ${homeLine.charAt(0).toUpperCase()}${homeLine.slice(1)}`);
  if (cleanText(row.distance_label)) lines.push(`📏 ${cleanText(row.distance_label)}`);
  if (cleanText(row.nearest_place_label)) lines.push(`📍 ${cleanText(row.nearest_place_label)}`);
  lines.push(`🔗 ${shortPropertyUrl(row, homeUrl)} · photos and map`);
  lines.push('');
  const rest = (Array.isArray(others) ? others : []).filter((n) => Number.isInteger(n) && n > 0);
  let otherWords = '';
  if (rest.length === 1) otherWords = `, or *${rest[0]}* to see the other`;
  if (rest.length > 1) otherWords = `, or ${rest.slice(0, -1).map((n) => `*${n}*`).join(', ')} or *${rest[rest.length - 1]}* to see the others`;
  lines.push(`Reply *CONTACT* ${contactPromise(row)}${otherWords}.`);
  return lines.join('\n');
}

function buildWhatsappPropertySearchReply(rows = [], {
  homeUrl = DEFAULT_HOME_URL,
  location = '',
  searchType = 'any',
  searchResultsUrl = ''
} = {}) {
  const safeRows = Array.isArray(rows) ? rows.filter(Boolean) : [];
  const browseUrl = publicMediaUrl(searchResultsUrl) || safeHomeUrl(homeUrl).replace(/\/+$/, '');
  if (!safeRows.length) {
    return `No approved properties are available right now.\n🔎 View all properties: ${browseUrl}`;
  }
  if (safeRows.length === 1) {
    return buildWhatsappPropertyPickCard(safeRows[0], { homeUrl });
  }

  const visibleRows = safeRows.slice(0, WHATSAPP_PROPERTY_SEARCH_PREVIEW_LIMIT);
  const totalMatches = totalWhatsappSearchMatches(safeRows);
  // "2 homes to rent in Any area" (25 Nov 2026): no place said is no place named.
  const cleanLocation = /^(?:any|any ?where|any area)$/i.test(cleanText(location)) ? '' : cleanText(location);
  const proximityHeader = cleanText(safeRows[0]?.proximity_header);
  // "3 homes to rent in Kira", or "3 homes to rent within 2 km of Ntinda".
  const header = proximityHeader
    ? `🔎 *${totalMatches} ${searchNoun(searchType)} ${proximityHeader}*`
    : `🔎 *${totalMatches} ${searchNoun(searchType)}${cleanLocation ? ` in ${cleanLocation}` : ''}*`;
  return buildWhatsappResultsList(visibleRows, {
    homeUrl,
    header,
    startAt: 1,
    hasMore: safeRows.length > visibleRows.length,
    browseUrl,
    total: totalMatches
  });
}

module.exports = {
  buildWhatsappPropertyCard,
  buildWhatsappPropertySearchReply,
  buildWhatsappResultsList,
  buildWhatsappPropertyPickCard,
  shortPropertyCode,
  shortPropertyUrl,
  shortCodesFromWhatsappReply,
  shareCardImageUrl,
  whatsappPriceWords,
  shortListingLabel,
  resultLabel,
  searchNoun,
  cleanWhatsappPropertyTitle,
  formatWhatsappPropertyPrice,
  meaningfulWhatsappPeriod,
  propertyIdFromWhatsappReply,
  propertyIdsFromWhatsappReply,
  publicMediaUrl,
  servablePropertyImageUrl,
  totalWhatsappSearchMatches,
  whatsappHomeTypeLine,
  WHATSAPP_PROPERTY_SEARCH_PREVIEW_LIMIT,
  whatsappListingTypeLabel,
  whatsappPropertyImageUrl
};
