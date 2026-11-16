'use strict';

// How a short stay reads in public: its title, its description, how many
// guests it sleeps and what it costs. Pure functions, no database.
//
// Found-online stays arrive with the poster's caption as the title ("📍KISAASI
// – KYANJA RD 💰80,000 ugx per day #airbnb #fyp"). The stored row keeps that
// caption untouched; these helpers decide what a guest sees.

const GENERIC_PLACES = new Set([
  'uganda', 'kampala', 'wakiso', 'mukono', 'entebbe town', 'central', 'central region',
  'unknown', 'n/a', 'na', 'none', 'tbc', 'tba', '-'
]);

// Template sentences the found-online importer used to write. They describe
// our own process, not the place, and must never reach a guest.
const INTERNAL_SENTENCES = [
  /[^.!?]*original post date is being confirmed[^.!?]*[.!?]?/gi,
  /[^.!?]*found-online window[^.!?]*[.!?]?/gi,
  /[^.!?]*viewers should use the gallery, source evidence[^.!?]*[.!?]?/gi,
  /[^.!?]*public property source, with the available contact route[^.!?]*[.!?]?/gi,
  /[^.!?]*the source post is titled\s*"[^"]*"\.?/gi,
  /[^.!?]*pending short-stay moderation[^.!?]*[.!?]?/gi,
  /[^.!?]*do not message this source[^.!?]*[.!?]?/gi
];

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{20E3}]/gu;

function squash(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function titleCaseWord(word) {
  return word ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : word;
}

function tidyPlace(value) {
  const text = squash(value).replace(EMOJI, '').replace(/[#@]/g, '').trim();
  if (!text) return '';
  return text.split(' ').map((w) => (/^[A-Z]{2,}$/.test(w) || /^[a-z]/.test(w) ? titleCaseWord(w) : w)).join(' ');
}

function stripHashtagsAndEmoji(value) {
  return squash(
    String(value || '')
      .replace(EMOJI, ' ')
      .replace(/(^|\s)#[\p{L}\p{M}\p{N}_]+/gu, ' ')
      .replace(/(^|\s)@[\p{L}\p{N}_.]+/gu, ' ')
      .replace(/[#@]/g, ' ')
      .replace(/[✔✓☎📞📍💰🏡🏠]/gu, ' ')
      .replace(/\s+[|/–-]\s*$/g, '')
  );
}

function captionLike(raw) {
  const text = String(raw || '');
  if (!squash(text)) return true;
  if (/[#@]/.test(text)) return true;
  if (EMOJI.test(text)) { EMOJI.lastIndex = 0; return true; }
  EMOJI.lastIndex = 0;
  if (squash(text).length > 70) return true;
  const letters = text.replace(/[^A-Za-z]/g, '');
  if (letters.length > 12 && letters === letters.toUpperCase()) return true;
  if (/\b(dm|inbox|call|whatsapp|contact)\b/i.test(text)) return true;
  if (/\b(pov|fyp|for rent|available)\b/i.test(text) && squash(text).length > 45) return true;
  return false;
}

function stayKind(row = {}) {
  const hay = `${row.title || ''} ${row.property_type || ''} ${String(row.description || '').slice(0, 400)}`.toLowerCase();
  if (/\bvilla\b/.test(hay)) return 'villa';
  if (/\bstudio\b/.test(hay)) return 'studio';
  if (/\bcottage\b/.test(hay)) return 'cottage';
  if (/guest\s*house/.test(hay)) return 'guest house';
  if (/\b(whole|entire|standalone|stand-alone)\s+house\b|\bbungalow\b|\bhome\b/.test(hay)) return 'house';
  if (row.place_type === 'private_room') return 'room';
  if (/\b(apartment|apt|flat|condo|serviced)\b/.test(hay)) return 'apartment';
  if (/\bhouse\b/.test(hay)) return 'house';
  if (/\bairbnb\b/.test(hay)) return 'apartment';
  return 'stay';
}

function displayArea(row = {}) {
  const area = tidyPlace(row.area);
  if (area) return area;
  return tidyPlace(row.district);
}

/**
 * The title a guest reads. A clean title the host wrote is kept (trimmed);
 * a caption becomes "2-bed apartment in Kololo".
 */
function isFoundOnlineRow(row = {}) {
  const extra = row.extra_fields && typeof row.extra_fields === 'object' ? row.extra_fields : {};
  return String(row.source || '').toLowerCase() === 'imported' || Boolean(extra.found_online_label);
}

function cleanStayTitle(row = {}) {
  const raw = squash(row.title);
  const area = displayArea(row);
  // A host's own title is kept. A found-online caption is never a title.
  if (!isFoundOnlineRow(row) && !captionLike(raw)) return raw.slice(0, 70);
  if (!isFoundOnlineRow(row)) {
    const tidy = stripHashtagsAndEmoji(raw);
    if (tidy && tidy.length <= 70 && !captionLike(tidy)) return tidy;
  }
  const kind = stayKind(row);
  const bedrooms = Number(row.bedrooms) || 0;
  let lead;
  if (kind === 'studio') lead = 'Studio';
  else if (kind === 'room') lead = 'Private room';
  else if (bedrooms >= 1) lead = `${bedrooms}-bed ${kind === 'stay' ? 'place' : kind}`;
  else lead = titleCaseWord(kind === 'stay' ? 'short stay' : kind);
  return area ? `${lead} in ${area}` : lead;
}

function cleanStayDescription(value) {
  let text = String(value || '');
  for (const pattern of INTERNAL_SENTENCES) text = text.replace(pattern, ' ');
  // Hashtags, @handles and emoji are caption noise, not description.
  text = text.split('\n').map((line) => (
    line
      .replace(EMOJI, ' ')
      .replace(/(^|\s)#[\p{L}\p{M}\p{N}_]+/gu, ' ')
      .replace(/(^|\s)@[\p{L}\p{N}_.]+/gu, ' ')
      .replace(/[✔✓☎📞📍💰🏡🏠]/gu, ' ')
      .replace(/\s+is a property around [^.]+\./gi, '.')
  )).join('\n');
  EMOJI.lastIndex = 0;
  text = text.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*\n\s*/g, '\n\n').replace(/^\s+|\s+$/g, '').replace(/\s+([.,!?])/g, '$1').replace(/\.{2,}/g, '.');
  // The importer repeats the caption; keep each sentence once.
  const seen = new Set();
  const kept = [];
  for (const part of text.split(/(?<=[.!?])\s+/)) {
    const key = part.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    kept.push(part);
  }
  return kept.join(' ').replace(/^[\s.,/|–-]+/, '').trim();
}

/**
 * Guests a place sleeps. The importer stored 2 for every found-online stay,
 * whatever its size, so a stored 2 (or nothing) on a place with more than one
 * bedroom is read as two per bedroom. 0 means unknown: hide it.
 */
function effectiveGuests(row = {}) {
  const stored = Number(row.max_guests) || 0;
  const bedrooms = Number(row.bedrooms) || 0;
  if (stored > 2) return stored;
  if (bedrooms > 1) return Math.max(stored, bedrooms * 2);
  return stored;
}

// SQL twin of effectiveGuests, for the guest filter.
function effectiveGuestsSql(alias = 'l') {
  return `(CASE WHEN COALESCE(${alias}.max_guests, 0) > 2 THEN ${alias}.max_guests
    WHEN COALESCE(${alias}.bedrooms, 0) > 1 THEN GREATEST(COALESCE(${alias}.max_guests, 0), ${alias}.bedrooms * 2)
    ELSE COALESCE(${alias}.max_guests, 0) END)`;
}

/**
 * A nightly USD price stated plainly in the title or description:
 * "USD 120 per night", "$100 a night", "120 dollars a night", "100USD per night".
 * Returns null when there is no clear nightly USD figure.
 */
function parseUsdNightly(...texts) {
  const hay = texts.map((t) => String(t || '')).join(' \n ');
  const night = '(?:\\s*(?:per|a|\\/|each)\\s*(?:night|nite|day)|\\s*nightly)';
  const patterns = [
    new RegExp(`(?:usd|us\\$|\\$)\\s?(\\d{2,4})(?:\\.\\d{1,2})?${night}`, 'i'),
    new RegExp(`(\\d{2,4})\\s?(?:usd|us\\$|dollars?|\\$)${night}`, 'i'),
    new RegExp(`(?:usd|\\$)\\s?(\\d{2,4})\\s*(?:\\/|per)\\s*(?:night|day)`, 'i')
  ];
  for (const pattern of patterns) {
    const match = hay.match(pattern);
    if (match) {
      const amount = Number(match[1]);
      if (amount >= 10 && amount <= 2000) return amount;
    }
  }
  return null;
}

function isSpecificPlace(area, district) {
  const a = squash(area).toLowerCase();
  if (!a || a.length < 3) return false;
  if (GENERIC_PLACES.has(a)) return false;
  if (a === squash(district).toLowerCase()) return false;
  return true;
}

/**
 * The public rule for a found-online stay: it needs a price (UGX, or a clear
 * nightly USD figure) and a specific location (an area that is not just the
 * district or "Kampala").
 */
function foundOnlineStayPublicRule(row = {}) {
  const missing = [];
  const extra = row.extra_fields && typeof row.extra_fields === 'object' ? row.extra_fields : {};
  const ugx = Number(row.base_nightly_ugx || 0) > 0 && extra.price_on_application !== true && extra.price_on_application !== 'true';
  const usd = parseUsdNightly(row.title, row.description);
  if (!ugx && !usd) missing.push('price');
  if (!isSpecificPlace(row.area, row.district)) missing.push('location');
  return { ok: missing.length === 0, missing };
}

module.exports = {
  isFoundOnlineRow,
  captionLike,
  cleanStayTitle,
  cleanStayDescription,
  effectiveGuests,
  effectiveGuestsSql,
  parseUsdNightly,
  isSpecificPlace,
  foundOnlineStayPublicRule,
  stripHashtagsAndEmoji
};
