function cleanLandTitleText(value, max = 1200) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function landTitleAvailabilityValue(value) {
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'number') return value === 1 ? 'yes' : value === 0 ? 'no' : null;
  const raw = cleanLandTitleText(value, 120).toLowerCase();
  if (!raw) return null;
  if (/^(yes|y|true|1|available|title available|land title available|has title|with title|ready|title ready|titled|private mailo|mailo title|freehold title|leasehold title)$/.test(raw)) return 'yes';
  if (/^(no|n|false|0|not available|no title|without title|title not available|not titled|untitled)$/.test(raw)) return 'no';
  if (/^(unknown|not sure|pending|to confirm|confirm|not stated|n\/a|na|not applicable)$/.test(raw)) return 'unknown';
  if (/\b(no|not|without)\b.{0,24}\b(land\s*)?title\b|\btitle\b.{0,24}\b(not available|pending|missing)\b/.test(raw)) return raw.includes('pending') ? 'unknown' : 'no';
  if (/\b(land\s*)?title\b.{0,30}\b(available|ready|included|present|in hand|on table)\b|\b(with|has|have)\b.{0,20}\b(land\s*)?title\b/.test(raw)) return 'yes';
  if (/\b(private mailo|mailo title|freehold title|leasehold title|title deed)\b/.test(raw)) return 'yes';
  return null;
}

function inferLandTitleAvailabilityFromText(...parts) {
  const text = parts.map((part) => cleanLandTitleText(part)).filter(Boolean).join(' ').toLowerCase();
  if (!text) return null;
  const noPattern = /\b(no|not|without)\b.{0,35}\b(?:land\s*)?title\b|\b(?:land\s*)?title\b.{0,35}\b(not available|missing|not yet|pending|processing|in process)\b/;
  if (noPattern.test(text)) return text.includes('pending') || text.includes('process') ? 'unknown' : 'no';
  const yesPattern = /\b(?:land\s*)?title\b.{0,40}\b(available|ready|included|present|in hand|on table|intact)\b|\b(with|has|have)\b.{0,25}\b(?:land\s*)?title\b|\b(private mailo|mailo title|freehold title|leasehold title|title deed)\b/;
  if (yesPattern.test(text)) return 'yes';
  if (/\b(?:land\s*)?title\b/.test(text)) return 'unknown';
  return null;
}

function normalizeLandTitleAvailability(input, ...textHints) {
  return landTitleAvailabilityValue(input) || inferLandTitleAvailabilityFromText(...textHints);
}

function landTitleAvailabilityLabel(value) {
  const normalized = landTitleAvailabilityValue(value);
  if (normalized === 'yes') return 'Land title available';
  if (normalized === 'no') return 'No land title stated';
  if (normalized === 'unknown') return 'Land title status pending';
  return '';
}

module.exports = {
  cleanLandTitleText,
  inferLandTitleAvailabilityFromText,
  landTitleAvailabilityLabel,
  landTitleAvailabilityValue,
  normalizeLandTitleAvailability
};
