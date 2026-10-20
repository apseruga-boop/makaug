'use strict';

// Free-text short-stay search. A phrase such as "2 bedroom Kololo under 150k"
// is beds + a max nightly price + a place, not one LIKE '%whole phrase%' match.

const STOPWORDS = new Set([
  'a', 'an', 'and', 'apartment', 'apartments', 'at', 'bed', 'bedroom', 'bedrooms',
  'beds', 'below', 'br', 'budget', 'by', 'find', 'for', 'from', 'furnished',
  'guest', 'hotel', 'hotels', 'house', 'houses', 'in', 'less', 'looking', 'max',
  'maximum', 'me', 'my', 'near', 'need', 'night', 'nightly', 'nights', 'of', 'on',
  'or', 'please', 'price', 'search', 'short', 'show', 'shs', 'shillings', 'stay',
  'stays', 'term', 'than', 'the', 'to', 'ugx', 'under', 'up', 'ush', 'want',
  'with', 'uganda'
]);

function scaleAmount(numText, unit) {
  const amount = Number(String(numText || '').replace(/,/g, ''));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const suffix = String(unit || '').toLowerCase();
  if (suffix === 'k') return Math.round(amount * 1000);
  if (suffix === 'm' || suffix === 'million') return Math.round(amount * 1_000_000);
  if (suffix === 'bn' || suffix === 'billion') return Math.round(amount * 1_000_000_000);
  return Math.round(amount);
}

function parseShortTermSearchText(text) {
  let raw = String(text || '').replace(/\s+/g, ' ').trim();
  let bedrooms = null;
  const bedMatch = raw.match(/\b(\d{1,2})\s*[-–]?\s*(?:bed(?:room)?s?|b\/?r|br)\b/i);
  if (bedMatch) {
    const count = Number(bedMatch[1]);
    if (count > 0 && count <= 20) bedrooms = count;
    raw = raw.replace(bedMatch[0], ' ');
  }

  let maxPrice = null;
  const priceMatch = raw.match(/\b(?:under|below|max(?:imum)?|less\s+than|up\s+to|<=)\s*(?:ugx|ush|shs|shillings)?\s*(\d[\d,]*(?:\.\d+)?)\s*(k|m|million|bn|billion)?\b/i);
  if (priceMatch) {
    maxPrice = scaleAmount(priceMatch[1], priceMatch[2]);
    raw = raw.replace(priceMatch[0], ' ');
  }

  const place = raw
    .split(/[^A-Za-z0-9'-]+/)
    .map((word) => word.trim())
    .filter((word) => word && !STOPWORDS.has(word.toLowerCase()) && !/^\d+$/.test(word))
    .join(' ')
    .slice(0, 80);

  return {
    bedrooms,
    max_price: maxPrice,
    place,
    q: place
  };
}

function suggestPartnerHotels(partners, parsed = {}, limit = 4) {
  const rows = Array.isArray(partners) ? partners : [];
  const needle = String(parsed.place || '').trim().toLowerCase();
  const matched = needle
    ? rows.filter((row) => [row?.title, row?.area, row?.district, row?.city]
      .some((part) => String(part || '').toLowerCase().includes(needle)))
    : rows;
  const picked = (matched.length ? matched : rows).slice(0, Math.max(0, limit));
  return {
    matched_place: Boolean(needle && matched.length),
    hotels: picked.map((row) => ({
      title: String(row?.title || '').trim(),
      area: String(row?.area || row?.district || row?.city || '').trim(),
      guide_only: true
    })).filter((row) => row.title)
  };
}

function shortTermAssistantText({ total = 0, parsed = {}, suggestion = null } = {}) {
  const count = Number(total) || 0;
  if (count > 0) {
    return `I found ${count} short stay${count === 1 ? '' : 's'} matching that search.`;
  }
  const names = (suggestion?.hotels || []).map((hotel) => hotel.title).filter(Boolean);
  if (!names.length) {
    return 'No published short stays match that yet. Browse short stays or list a place.';
  }
  const where = suggestion.matched_place && parsed.place
    ? `near ${parsed.place}`
    : 'from the partner hotel guide';
  return `No published short stays match that yet. These partner hotels are a guide only ${where}: ${names.join(', ')}. makaug is not showing a phone number or a live price.`;
}

module.exports = {
  parseShortTermSearchText,
  suggestPartnerHotels,
  shortTermAssistantText
};
