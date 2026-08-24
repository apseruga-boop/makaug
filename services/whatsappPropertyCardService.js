'use strict';

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
  return cleanText(value)
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

function meaningfulWhatsappPeriod(row = {}) {
  const type = normalizedListingType(row);
  if (type === 'sale') return '';
  if (type === 'rent') return 'month';
  if (type === 'student') return 'semester';

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
  if (extra.price_on_application === true || !Number.isFinite(amount) || amount <= 0) {
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
    const url = publicMediaUrl(candidate);
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

function totalWhatsappSearchMatches(rows = []) {
  const safeRows = Array.isArray(rows) ? rows : [];
  return Math.max(
    safeRows.length,
    ...safeRows
      .map((row) => Number(row?.total_count || 0))
      .filter((value) => Number.isFinite(value) && value > 0)
  );
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
    return buildWhatsappPropertyCard(safeRows[0], {
      homeUrl,
      allPropertiesUrl: browseUrl
    }).caption;
  }

  const visibleRows = safeRows.slice(0, WHATSAPP_PROPERTY_SEARCH_PREVIEW_LIMIT);
  const totalMatches = totalWhatsappSearchMatches(safeRows);
  const cleanLocation = cleanText(location);
  const lines = [
    `🔎 *${totalMatches} matching ${whatsappSearchTypeLabel(searchType)} found${cleanLocation ? ` in ${cleanLocation}` : ''}*`,
    `Showing the newest ${visibleRows.length}:`,
    ''
  ];

  visibleRows.forEach((row, index) => {
    lines.push(`${index + 1}. 🏡 *${cleanWhatsappPropertyTitle(row)}*`);
    lines.push(`📍 ${[cleanText(row.area), cleanText(row.district)].filter(Boolean).join(', ') || ACTIVE_TENANT.countryName}`);
    lines.push(`💰 ${formatWhatsappPropertyPrice(row)}`);
    lines.push(`🔗 ${propertyUrlForWhatsapp(row, homeUrl)}`);
    lines.push('');
  });

  lines.push(`🔎 View all ${totalMatches} matches: ${browseUrl}`);
  return lines.join('\n').trim();
}

module.exports = {
  buildWhatsappPropertyCard,
  buildWhatsappPropertySearchReply,
  cleanWhatsappPropertyTitle,
  formatWhatsappPropertyPrice,
  meaningfulWhatsappPeriod,
  propertyIdFromWhatsappReply,
  propertyIdsFromWhatsappReply,
  publicMediaUrl,
  totalWhatsappSearchMatches,
  WHATSAPP_PROPERTY_SEARCH_PREVIEW_LIMIT,
  whatsappListingTypeLabel,
  whatsappPropertyImageUrl
};
