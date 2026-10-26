'use strict';

// Shared intake checks for the 11 Oct data-quality batch:
// per-plot "each" prices, apartment blocks filed as land, and repeat
// listings (same video, phone+area+price, or caption) including a lower
// price on a listing that is already in review or live.

const PLOT_DIMENSION = /\b\d{1,4}\s*(?:x|by|\*|×)\s*\d{1,4}(?:\s*(?:ft|fts|feet|m))?\b/gi;

// "apartment block" / "block of apartments" is a building. A lone "apartment"
// is one dwelling, so the optional group must not swallow that word.
const APARTMENT_BLOCK_PATTERN = /\b(?:apartments?\s+blocks?|blocks?\s+of\s+(?:apartments?|flats?|rentals?)|rental\s+units?\s+apartments?)\b/i;

function isApartmentBlockText(value = '') {
  const text = String(value || '');
  if (!text.trim()) return false;
  if (APARTMENT_BLOCK_PATTERN.test(text)) return true;
  // "2 bedroom block for sale on a 50x100 plot" is a building, not the plot.
  // "block of land" with no dwelling word stays land.
  if (/\b(?:office|shopping|commercial)\s+blocks?\b/i.test(text)) return false;
  return /\bblocks?\b/i.test(text)
    && /\b(?:apartments?|flats?|rental\s+units?|bed(?:room)?s?)\b/i.test(text);
}

function stripPlotDimensions(value = '') {
  return String(value || '').replace(PLOT_DIMENSION, ' ');
}

const EACH_AMOUNT = String.raw`(\d+(?:\.\d+)?)\s*(bn|billion|billions|m|mn|million|millions|k|thousand|thousands)?`;
const EACH_MULTIPLIERS = { b: 1e9, bn: 1e9, billion: 1e9, billions: 1e9, m: 1e6, mn: 1e6, million: 1e6, millions: 1e6, k: 1e3, thousand: 1e3, thousands: 1e3 };

function amountFromEachMatch(numberText, suffix) {
  const amount = Number(numberText) * (EACH_MULTIPLIERS[String(suffix || '').toLowerCase()] || 1);
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount) : 0;
}

/**
 * The figure next to "each" / "per plot" when the caption is selling plots
 * one at a time. Acre and hectare rates are left alone: those are one farm.
 */
function quotedEachPlotAmount(text = '') {
  const raw = String(text || '');
  if (!/\b(?:plots?|units?)\b/i.test(raw)) return null;
  if (/\b(?:per\s+acre|each\s+acre|acres?\s+each|per\s+hectare|each\s+hectare)\b/i.test(raw)
    && !/\b(?:plots?|units?)\s+each\b|\beach\s+(?:plot|unit)\b/i.test(raw)) {
    return null;
  }
  if (!/\b(?:each|apiece|per\s+plot|per\s+unit)\b/i.test(raw)) return null;
  const before = raw.match(new RegExp(`${EACH_AMOUNT}\\s*(?:each|apiece)\\b`, 'i'));
  const after = raw.match(new RegExp(`\\b(?:each|apiece|per\\s+plot|per\\s+unit)\\s*(?:at|of|@|ugx|ush|shs)?\\s*${EACH_AMOUNT}\\b`, 'i'));
  const match = before || after;
  if (!match) return null;
  const amount = amountFromEachMatch(match[1], match[2]);
  return amount || null;
}

function preferEachPlotPrice(text = '', amount = 0) {
  return preferQuotedUnitPrice(text, amount);
}

/**
 * A caption that prices land by the acre or the plot. The stored price is
 * that rate, and the period is what the listing prints after it (`/acre`,
 * `/plot`). Acreage in the same caption is the size, not a multiplier.
 */
function unitPriceQuote(text = '') {
  const raw = String(text || '');
  const perAcre = /\b(?:per|each|an|a|\/)\s*acres?\b|\bacres?\s+(?:each|apiece)\b|\/acre\b/i.test(raw);
  const perPlot = /\b(?:per|each)\s+plots?\b|\bplots?\s+(?:each|apiece)\b|\/plot\b|\bper\s+unit\b/i.test(raw);
  const bareEach = /\b(?:each|apiece|a\s?piece)\b/i.test(raw);
  const acreCount = /\b\d[\d,.]*\s*acres?\b/i.test(raw);
  const plotEach = perPlot || (bareEach && /\bplots?\b/i.test(raw) && !perAcre);
  const acreEach = perAcre || (bareEach && acreCount && !plotEach);
  const pricePeriod = acreEach ? 'acre' : (plotEach ? 'plot' : '');
  if (!pricePeriod) return null;
  const unitWord = pricePeriod === 'acre' ? 'acres?' : 'plots?';
  const before = raw.match(new RegExp(`${EACH_AMOUNT}\\s*(?:per|each|an|a|/)\\s*${unitWord}\\b`, 'i'))
    || raw.match(new RegExp(`${EACH_AMOUNT}\\s*${unitWord}\\s*(?:each|apiece)\\b`, 'i'));
  const after = raw.match(new RegExp(`\\b(?:per|each|an|a|/)\\s*${unitWord}\\s*(?:at|of|@|ugx|ush|shs)?\\s*${EACH_AMOUNT}\\b`, 'i'))
    || (bareEach ? raw.match(new RegExp(`\\beach(?:\\s+at|\\s+of|\\s+@)?\\s*(?:ugx|ush|shs)?\\s*${EACH_AMOUNT}\\b`, 'i')) : null);
  const match = before || after;
  const amount = match ? amountFromEachMatch(match[1], match[2]) : 0;
  return { amount: amount || null, unit: pricePeriod, pricePeriod };
}

function pricePeriodForUnitQuote(text = '') {
  return unitPriceQuote(text)?.pricePeriod || '';
}

function preferQuotedUnitPrice(text = '', amount = 0) {
  const numeric = Number(amount);
  const quote = unitPriceQuote(text);
  const each = quote?.amount || quotedEachPlotAmount(text);
  if (!each || !Number.isFinite(numeric) || numeric <= 0) return Number.isFinite(numeric) ? numeric : null;
  if (Math.abs(numeric - each) / each <= 0.02) return numeric;
  const ratio = numeric / each;
  const rounded = Math.round(ratio);
  if (rounded >= 2 && Math.abs(ratio - rounded) < 0.02) return each;
  return numeric;
}

function localPhone(value = '') {
  return String(value || '').replace(/\D/g, '').replace(/^(?:256|0)/, '');
}

function videoIdFromText(value = '') {
  const text = String(value || '');
  const youtube = text.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/|youtube\.com\/embed\/)([A-Za-z0-9_-]{6,})/i);
  if (youtube) return youtube[1];
  const tiktok = text.match(/tiktok\.com\/(?:@[^/\s]+\/)?video\/(\d{6,})/i);
  if (tiktok) return tiktok[1];
  return '';
}

function priceStrippedCaption(caption = '') {
  return String(caption || '')
    .toLowerCase()
    .replace(/\b(?:ugx|ush|usd|shs|shillings|million|millions|billion|billions|bn|mn)\b/g, ' ')
    .replace(/\b\d[\d,.]*(?:\s*(?:bn|billion|billions|m|mn|million|millions|k|thousand|thousands))?\b/gi, ' ')
    .replace(/[^a-z]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const CAPTION_IDENTITY_STOPWORDS = new Set([
  'forwarded', 'for', 'sale', 'on', 'the', 'and', 'in', 'at', 'with', 'of', 'to', 'is', 'a', 'an',
  'selling', 'sell', 'now', 'price', 'negotiable', 'call', 'contact', 'whatsapp', 'located', 'location'
]);

function captionIdentityTokens(caption = '') {
  return new Set(priceStrippedCaption(caption)
    .split(' ')
    .filter((word) => word.length >= 3 && !CAPTION_IDENTITY_STOPWORDS.has(word)));
}

/**
 * Two captions that plainly describe different things. 26 Oct 2026: "Namugongo
 * Sonde 6 double rental units monthly income 3.9 million on sale UGX 400 million"
 * was refused as a repeat of the same agent's August "Namugongo 2 houses in same
 * compound each 2 bedrooms" because both were Namugongo at 400 million. An agent
 * with a lot of stock in one area will often have two listings at one price.
 */
function captionsDescribeDifferentListings(left = '', right = '') {
  const a = captionIdentityTokens(left);
  const b = captionIdentityTokens(right);
  if (a.size < 3 || b.size < 3) return false;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  const union = a.size + b.size - shared;
  return union > 0 && shared / union < 0.34;
}

function modestPriceDrop(nextPrice, currentPrice) {
  const next = Number(nextPrice);
  const current = Number(currentPrice);
  if (!(next > 0) || !(current > 0) || next >= current) return false;
  // 170m → 140m is a drop. 35m against a 3.5bn mis-parse is not.
  return next >= current * 0.5;
}

function rowHasRepeatSignals(row = {}) {
  return row.price != null
    || row.caption_hash
    || row.video_url
    || row.youtube_video_id
    || row.tiktok_video_id
    || row.source_video_id
    || row.source_caption
    || row.phone_digits;
}

/**
 * Decide whether an incoming caption is a repeat of a row already stored.
 * A row with only id/status (older query fixtures) stays a duplicate.
 * A lower price on the same video, caption, or phone+area is a price update,
 * not a second pending listing.
 */
function decideIntakeRepeat(incoming = {}, rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return null;
  const incomingCaption = priceStrippedCaption(incoming.caption || '');
  const incomingPhone = localPhone(incoming.phoneDigits || incoming.phone || '');
  const incomingArea = String(incoming.area || '').trim().toLowerCase();
  const incomingVideo = String(incoming.videoId || videoIdFromText(`${incoming.caption || ''} ${incoming.videoUrl || ''}`) || '').trim();
  const incomingHash = String(incoming.captionHash || '').trim();
  const incomingPrice = Number(incoming.price) || 0;
  let fallback = null;

  for (const row of list) {
    if (!row || !row.id) continue;
    if (!rowHasRepeatSignals(row)) return { ...row, match_type: 'duplicate' };

    const rowVideo = String(
      row.youtube_video_id
      || row.tiktok_video_id
      || row.source_video_id
      || videoIdFromText(`${row.video_url || ''} ${row.source_url || ''} ${row.source_caption || ''}`)
      || ''
    ).trim();
    const sameVideo = Boolean(incomingVideo && rowVideo && incomingVideo === rowVideo);
    const sameHash = Boolean(incomingHash && row.caption_hash && incomingHash === row.caption_hash);
    const rowPhone = localPhone(row.phone_digits || '');
    const samePhone = Boolean(
      incomingPhone && rowPhone
      && (incomingPhone === rowPhone || rowPhone.endsWith(incomingPhone) || incomingPhone.endsWith(rowPhone))
    );
    const rowArea = String(row.area || '').trim().toLowerCase();
    const sameArea = Boolean(incomingArea && rowArea && incomingArea === rowArea);
    const rowPrice = Number(row.price) || 0;
    const samePrice = incomingPrice > 0 && rowPrice > 0 && incomingPrice === rowPrice;
    const rowCaption = priceStrippedCaption(row.source_caption || '');
    const sameCaptionIdentity = incomingCaption.length >= 24
      && rowCaption.length >= 24
      && incomingCaption === rowCaption;
    const differentDescription = Boolean(incoming.caption && row.source_caption)
      && captionsDescribeDifferentListings(incoming.caption, row.source_caption);
    const sameListing = sameVideo
      || sameHash
      || (samePhone && sameArea && samePrice && !differentDescription)
      || (samePhone && sameArea && sameCaptionIdentity);
    if (!sameListing) continue;
    const priceUpdate = modestPriceDrop(incomingPrice, rowPrice)
      && (sameVideo || sameCaptionIdentity || (samePhone && sameArea));
    const decision = { ...row, match_type: priceUpdate ? 'price_update' : 'duplicate' };
    if (decision.match_type === 'price_update') return decision;
    fallback = fallback || decision;
  }
  return fallback;
}

module.exports = {
  captionsDescribeDifferentListings,
  decideIntakeRepeat,
  isApartmentBlockText,
  localPhone,
  modestPriceDrop,
  preferEachPlotPrice,
  preferQuotedUnitPrice,
  pricePeriodForUnitQuote,
  priceStrippedCaption,
  quotedEachPlotAmount,
  stripPlotDimensions,
  unitPriceQuote,
  videoIdFromText,
};
