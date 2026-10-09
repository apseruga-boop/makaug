'use strict';

// Which /property/:id pages may be indexed. A found-online listing built from
// template text with no real photo is "thin": it stays live (200, still on
// category and area pages) but is noindex,follow and left out of sitemap.xml.
// About 3,869 of 4,299 sitemap /property URLs were found-online template pages
// on 8 Oct 2026, and only 286 listings had their own primary photo.
//
// Thin = found-online AND (no real hosted photo OR no meaningful description).
// - Real hosted photo: utils/realListingPhoto.js (same rule as approval).
// - Meaningful description: reviewed by staff or King AND at least 40 words
//   once the disclaimer sentences, hashtags, URLs, phones and emoji are removed.
// Owner and agent listings are never thin under this rule.

const MIN_MEANINGFUL_WORDS = 40;

const DISCLAIMER_SENTENCE_PATTERNS = [
  /[^.!?]*is a third-party property result[^.!?]*[.!?]?/gi,
  /[^.!?]*provides a search and discovery preview[^.!?]*[.!?]?/gi,
  /[^.!?]*has not verified ownership[^.!?]*[.!?]?/gi,
  /[^.!?]*original post date is being confirmed[^.!?]*[.!?]?/gi,
  /[^.!?]*third-party property result found from[^.!?]*[.!?]?/gi,
  /[^.!?]*open the original source before contacting[^.!?]*[.!?]?/gi,
  /Found on [^.]{1,80}\. Check the original post before paying\./gi
];

function asList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim().toLowerCase());
  if (typeof value === 'string' && value.trim().startsWith('[')) {
    try { return asList(JSON.parse(value)); } catch (_) { return []; }
  }
  return typeof value === 'string' ? value.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean) : [];
}

function truthy(value) {
  return value === true || ['true', '1', 'yes'].includes(String(value || '').trim().toLowerCase());
}

function descriptionReviewed(extra = {}) {
  const raw = extra && typeof extra === 'object' ? extra : {};
  return truthy(raw.king_review_facts_confirmed)
    || asList(raw.king_review_corrected_fields).includes('description')
    || asList(raw.staff_corrected_fields).includes('description');
}

function meaningfulWordCount(description = '') {
  let text = String(description || '');
  for (const pattern of DISCLAIMER_SENTENCE_PATTERNS) text = text.replace(pattern, ' ');
  text = text
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, ' ')
    .replace(/\+?\d[\d\s().-]{6,}\d/g, ' ')
    .replace(/#[\p{L}\p{N}_-]+/gu, ' ')
    .replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}️‍]/gu, ' ');
  return (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
}

function hasMeaningfulDescription(description = '', extra = {}) {
  return descriptionReviewed(extra) && meaningfulWordCount(description) >= MIN_MEANINGFUL_WORDS;
}

// row: { foundOnline: bool, hasRealPhoto: bool, description: string, extra: raw extra_fields subset }
function isThinFoundOnlineListing(row = {}) {
  if (!row.foundOnline) return false;
  return !(row.hasRealPhoto === true && hasMeaningfulDescription(row.description, row.extra || {}));
}

module.exports = {
  MIN_MEANINGFUL_WORDS,
  descriptionReviewed,
  meaningfulWordCount,
  hasMeaningfulDescription,
  isThinFoundOnlineListing
};
