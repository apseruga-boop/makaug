'use strict';

// A plot or land sale stays land when the only student words are an estate
// name ("Bugema Hostel Estate") or a use clause ("suitable for hostels").
// A hostel room, student accommodation, or a per-semester offer is still student.

function textWithoutIncidentalUseClauses(value = '') {
  return String(value || '')
    .replace(/\b(?:suitable|ideal|good|perfect|great)\s+for\s*[:\-]?\s*[^.;|\n]{0,80}/gi, ' ')
    .replace(/\b(?:hostel|student)\s+estate\b/gi, ' estate ');
}

const PLOT_OR_LAND_SALE = /\b(?:plots?|acres?|decimals?)\s+for\s+sale\b|\bland\s+(?:for|on)\s+sale\b|\bfor\s+sale\b[^.\n]{0,20}\bplots?\b|\b\d+\s*[x×]\s*\d+\s*fts?\b/i;
const REAL_STUDENT_OFFER = /\b(?:student\s+(?:accommodation|hostel|room)|hostel\s+(?:room|bed|space)|per\s+semester)\b/i;
const DWELLING_FOR_SALE = /\b(?:\d+\s*[- ]?bed(?:room)?s?|duplex|bungalow|apartment|flat|house|home)\b/i;

function plotSaleBeatsStudentWords(value = '') {
  const raw = String(value || '');
  if (!raw.trim()) return false;
  const stripped = textWithoutIncidentalUseClauses(raw);
  if (!PLOT_OR_LAND_SALE.test(stripped)) return false;
  const dwellingSale = DWELLING_FOR_SALE.test(stripped)
    && /\bfor\s+sale\b/i.test(stripped)
    && !/\bplots?\s+for\s+sale\b/i.test(stripped)
    && !/\b\d+\s*[x×]\s*\d+\s*fts?\b/i.test(stripped);
  if (dwellingSale) return false;
  if (REAL_STUDENT_OFFER.test(stripped) && !PLOT_OR_LAND_SALE.test(raw)) return false;
  return true;
}

module.exports = {
  textWithoutIncidentalUseClauses,
  plotSaleBeatsStudentWords,
};
