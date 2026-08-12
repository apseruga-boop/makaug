'use strict';

// One Uganda property vocabulary for intake, integrity checks, backlog recovery
// and moderator suggestions. Category (sale/rent/land/...) is intentionally
// separate from physical property type (house/room/plot/...).
const PROPERTY_TYPE_RULES = Object.freeze([
  { property_type: 'hostel', physical_type: 'student', pattern: /\b(?:student\s+(?:accommodation|hostel|room)|hostel\s+(?:room|bed|space)|campus\s+(?:room|hostel)|per\s+semester)\b/i },
  { property_type: 'land', physical_type: 'land', pattern: /\b(?:land|plots?|acres?|decimals?|farmland|bare[-\s]*land|vacant\s+land|ettaka|kibanja|bibanja|square\s+(?:miles?|kilomet(?:er|re)s?)(?:\s+of\s+land)?)\b/i },
  { property_type: 'warehouse', physical_type: 'commercial', pattern: /\b(?:warehouse|industrial\s+(?:space|property|building)|factory)\b/i },
  { property_type: 'office', physical_type: 'commercial', pattern: /\b(?:office(?:\s+space)?|showroom|business\s+premises)\b/i },
  { property_type: 'retail shop', physical_type: 'commercial', pattern: /\b(?:shop|retail|arcade|commercial\s+(?:building|property|premises|space))\b/i },
  { property_type: 'apartment', physical_type: 'residential', pattern: /\b(?:apartment(?:\s+block)?|appartment|flat|condo)\b/i },
  { property_type: 'mansion', physical_type: 'residential', pattern: /\b(?:mansion)\b/i },
  { property_type: 'duplex', physical_type: 'residential', pattern: /\b(?:duplex|townhouse)\b/i },
  { property_type: 'villa', physical_type: 'residential', pattern: /\b(?:villa)\b/i },
  { property_type: 'bungalow', physical_type: 'residential', pattern: /\b(?:bungalow)\b/i },
  { property_type: 'room', physical_type: 'residential', pattern: /\b(?:double\s+rooms?|single\s+rooms?|muzigos?|self[-\s]*contained(?:\s+(?:room|unit))?|bedsitter|studio\s+room|rental\s+rooms?|rooms?\s+(?:to\s+let|for\s+rent))\b/i },
  { property_type: 'house', physical_type: 'residential', pattern: /\b(?:house|home|residence|residential\s+property|rentals?|rental\s+units?|\d+\s*[- ]?bed(?:room)?s?)\b/i },
]);

const HOSPITALITY_PATTERN = /\b(?:air\s*&?\s*b(?:n|and)?\s*b|airbnb|short[-\s]*stay|short[-\s]*term\s+stay|per\s+night|nightly|bed\s*(?:and|&)\s*breakfast|booking\.com|holiday\s+home|vacation\s+rental|guest\s*house|hotel\s+room|lodge\s+room|resort\s+stay)\b/i;
const LAND_PATTERN = /\b(?:land|plots?|acres?|decimals?|square\s+(?:miles?|kilomet(?:er|re)s?)(?:\s+of\s+land)?|bare[-\s]+land|ettaka|kibanja|bibanja)\b/i;
const COMMERCIAL_PATTERN = /\b(?:office|shop|retail|warehouse|industrial|factory|arcade|showroom|business\s+premises|commercial\s+(?:building|property|premises|space|land|plot))\b/i;
const STUDENT_PATTERN = /\b(?:student\s+(?:accommodation|hostel|room)|hostel\s+(?:room|bed|space)|campus|university|college|per\s+semester)\b/i;
const RESIDENTIAL_PATTERN = /\b(?:bed(?:room)?s?|bath(?:room)?s?|house|home|apartment(?:\s+block)?|appartment|flat|villa|bungalow|mansion|duplex|condo|townhouse|residence|residential|rentals?|double\s+rooms?|single\s+rooms?|muzigos?|self[-\s]*contained|bedsitter|studio|rental\s+(?:rooms?|units?))\b/i;
const SPECIFIC_PROPERTY_PATTERN = /\b(?:bed(?:room)?s?|studio|bedsitter|house|home|app?artment|flat|villa|bungalow|mansion|duplex|condo|townhouse|plots?|land|acres?|decimals?|hostel|rooms?|muzigos?|self[-\s]*contained|shop|office|warehouse|factory|arcade|showroom|building)\b/i;

function compact(value = '') {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function detectPropertyTypeEvidence(value = '') {
  const text = compact(value);
  if (!text) return { physical_type: null, property_type: null, matches: [], evidence_excerpt: '' };
  const matches = PROPERTY_TYPE_RULES
    .map((rule) => {
      const match = text.match(rule.pattern);
      return match ? { physical_type: rule.physical_type, property_type: rule.property_type, evidence: match[0] } : null;
    })
    .filter(Boolean);
  if (!matches.length) return { physical_type: null, property_type: null, matches: [], evidence_excerpt: text.slice(0, 240) };
  // Student and land are asset-level evidence. Bedrooms/rooms are residential
  // and must beat generic commercial words such as "block" or "income".
  const chosen = matches.find((item) => item.physical_type === 'student')
    || matches.find((item) => item.physical_type === 'land')
    || matches.find((item) => item.physical_type === 'residential')
    || matches[0];
  return { ...chosen, matches, evidence_excerpt: text.slice(0, 240) };
}

module.exports = {
  COMMERCIAL_PATTERN,
  HOSPITALITY_PATTERN,
  LAND_PATTERN,
  PROPERTY_TYPE_RULES,
  RESIDENTIAL_PATTERN,
  SPECIFIC_PROPERTY_PATTERN,
  STUDENT_PATTERN,
  detectPropertyTypeEvidence,
};
