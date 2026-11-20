'use strict';

const { cleanText } = require('../middleware/validation');
const {
  factualListingTitle,
  stripMarkdownEmphasis,
  isPlaceholderOrGenericTitle
} = require('../services/publicListingCopy');

function looksLikePastedWhatsAppCopy(value = '') {
  const text = String(value || '');
  if (!text.trim()) return false;
  if (/\*[^*]{2,}\*/.test(text)) return true;
  if (/#\s*\d+\s*m\b/i.test(text)) return true;
  if (text.length > 90 && /(?:\bugx\b|\d+\s*m\b|acres?|hot\s*deal|money needed)/i.test(text) && /[\n*]/.test(text)) {
    return true;
  }
  if (text.length > 140 && /\b(?:acres?|ugx|viewing|warehouses?|decimals?)\b/i.test(text)) return true;
  return false;
}

function stripPastedMarkup(value = '') {
  return stripMarkdownEmphasis(String(value || ''))
    .replace(/[*_~`]+/g, ' ')
    .replace(/#+\s*/g, '')
    .replace(/[\u{1F300}-\u{1FAFF}\u2600-\u26FF]/gu, ' ')
    .replace(/[📍🔥✅✔️▪️•·]+/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function formatAdvertAmount(amount, magnitude = '', currency = '') {
  const raw = String(amount || '').replace(/,/g, '').trim();
  if (!raw) return '';
  const mag = String(magnitude || '').toLowerCase();
  const cur = String(currency || '').toLowerCase().replace('$', 'usd');
  const usd = cur === 'usd' || cur === '$';
  if (mag === 'm' || mag === 'million') return usd ? `USD ${raw} million` : `UGX ${raw} million`;
  if (mag === 'bn' || mag === 'billion' || mag === 'b') return usd ? `USD ${raw} billion` : `UGX ${raw} billion`;
  if (usd) {
    const n = Number(raw);
    return Number.isFinite(n) ? `USD ${n.toLocaleString('en-US')}` : `USD ${raw}`;
  }
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 1000) return `UGX ${n.toLocaleString('en-US')}`;
  if (cur === 'ugx') return `UGX ${raw}`;
  return raw;
}

function parseOfferBlocks(text = '') {
  const offers = [];
  const starBlocks = [...String(text).matchAll(/\*([^*]{5,160})\*/g)].map((match) => match[1].trim());
  const sources = starBlocks.length ? starBlocks : [text];
  const offerRe = /(.+?)\s+(\d+(?:\.\d+)?)\s*(acres?|decimals?|plots?)\s+(?:at|@|for|[-—])\s*\$?\s*([\d.,]+)\s*(m|million|bn|billion|b)?\s*(ugx|usd|\$)?/i;
  const compactRe = /(.+?)\s+(?:at|@)\s*\$?\s*([\d.,]+)\s*(m|million|bn|billion|b)?\s*(ugx|usd|\$)?/i;
  for (const block of sources) {
    const cleaned = stripPastedMarkup(block);
    const sized = cleaned.match(offerRe);
    if (sized) {
      const unitRaw = sized[3].toLowerCase();
      offers.push({
        place: cleanText(sized[1].replace(/^(?:hot deal|quick sale|only)\s*[-:]?\s*/i, '')),
        size: Number(sized[2]),
        unit: unitRaw.startsWith('acre') ? 'acres' : unitRaw,
        price: formatAdvertAmount(sized[4], sized[5], sized[6])
      });
      continue;
    }
    const compact = cleaned.match(compactRe);
    if (compact && /\b(?:plot|house|warehouse|apartment|acre|bed)/i.test(cleaned)) {
      offers.push({
        place: cleanText(compact[1].replace(/^(?:hot deal|quick sale|only)\s*[-:]?\s*/i, '')),
        size: null,
        unit: '',
        price: formatAdvertAmount(compact[2], compact[3], compact[4]),
        detail: cleaned
      });
    }
  }
  const seen = new Set();
  return offers.filter((offer) => {
    const key = [offer.place, offer.size, offer.unit, offer.price].join('|').toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function featureClauses(plain = '') {
  const features = [];
  if (/\b(?:titled|has title|land title|mailo|freehold|leasehold)\b/i.test(plain)) {
    if (/\bfreehold\b/i.test(plain)) features.push('it is freehold titled land');
    else if (/\bmailo\b/i.test(plain)) features.push('it is Mailo titled land');
    else features.push('the land is titled');
  }
  if (/\bsquat+er[- ]?free\b/i.test(plain)) features.push('it is squatter-free');
  if (/\b(?:directly\s+)?touching the lake|lakefront|lake front\b/i.test(plain)) {
    features.push('it sits directly on the lake');
  }
  if (/\bviewing\s+entebbe\b/i.test(plain)) features.push('it can be viewed from Entebbe');
  if (/\bfor real estate,?\s*recreation\b/i.test(plain)) {
    features.push('it is suitable for real estate or recreation');
  }
  return features;
}

function sentenceCase(value = '') {
  const text = cleanText(value);
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function offerPlace(offer, fallbackArea = '') {
  return cleanText(offer?.place || fallbackArea);
}

function cleanPastedListingCopy(row = {}) {
  const extra = row.extra_fields && typeof row.extra_fields === 'object' ? row.extra_fields : {};
  const raw = [row.title, row.description, extra.source_caption, extra.source_title]
    .filter((part) => typeof part === 'string' && part.trim())
    .join('\n');
  const offers = parseOfferBlocks(raw);
  const plain = stripPastedMarkup(raw);
  const features = featureClauses(plain);
  const area = cleanText(row.area || '');
  const shouldSplit = offers.length > 1;
  const splitNote = shouldSplit
    ? `These are ${offers.length} separate properties and should be split into separate listings.`
    : '';

  let title = '';
  if (offers.length && offers[0].size && offers[0].unit) {
    title = sentenceCase(`${offers[0].size} ${offers[0].unit} for sale in ${area || offerPlace(offers[0])}`);
  } else if (offers.length && /warehouse/i.test(raw)) {
    const count = raw.match(/(\d+)\s+warehouses?/i);
    title = sentenceCase(`${count ? `${count[1]} warehouses` : 'Warehouses'} for sale in ${area || offerPlace(offers[0]) || 'Namanve'}`);
  } else if (!isPlaceholderOrGenericTitle(row.title) && !looksLikePastedWhatsAppCopy(row.title) && cleanText(row.title)) {
    title = cleanText(row.title);
  } else {
    title = factualListingTitle(row);
  }

  const featureText = features.length
    ? ` ${sentenceCase(features.join(', ').replace(/, ([^,]*)$/, ' and $1'))}.`
    : '';

  let description = '';
  if (offers.length === 1 && offers[0].size && offers[0].unit) {
    const place = area || offerPlace(offers[0]);
    const price = offers[0].price ? ` at ${offers[0].price}${row.price_period === 'acre' ? ' per acre' : ''}` : '';
    description = `${sentenceCase(`${offers[0].size} ${offers[0].unit} for sale in ${place}`)}${price}.${featureText}`.replace(/\.\./g, '.');
  } else if (offers.length > 1) {
    const first = offers[0];
    const rest = offers.slice(1);
    const firstPlace = area || offerPlace(first);
    const firstPrice = first.price ? ` at ${first.price}${row.price_period === 'acre' && first.unit === 'acres' ? ' per acre' : ''}` : '';
    const firstSize = first.size && first.unit ? `${first.size} ${first.unit}` : 'A property';
    const follow = rest.map((offer) => {
      const size = offer.size && offer.unit ? `${offer.size} ${offer.unit}` : 'another property';
      const price = offer.price ? ` at ${offer.price}` : '';
      return `${size} in ${offerPlace(offer)}${price}`;
    }).join('; ');
    description = `${sentenceCase(`${firstSize} for sale in ${firstPlace}`)}${firstPrice}.${featureText} The same advert also offers ${follow}. ${splitNote}`.replace(/\s+/g, ' ').trim();
  } else {
    const compact = stripPastedMarkup(plain)
      .replace(/\bmoney needed urgently!?\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    const lead = factualListingTitle(row);
    const shortened = compact.length > 420 ? `${compact.slice(0, 417).replace(/\s+\S*$/, '')}…` : compact;
    description = shortened
      ? (shortened.toLowerCase().startsWith(lead.toLowerCase()) ? sentenceCase(shortened) : `${lead}. ${sentenceCase(shortened)}`)
      : `${lead}.`;
  }

  return {
    title: title.replace(/\s+/g, ' ').trim(),
    description: description.replace(/\s+/g, ' ').trim(),
    offers,
    shouldSplit,
    splitNote
  };
}

function shouldRewriteListingCopy(row = {}) {
  return isPlaceholderOrGenericTitle(row.title)
    || looksLikePastedWhatsAppCopy(row.title)
    || looksLikePastedWhatsAppCopy(row.description);
}

module.exports = {
  looksLikePastedWhatsAppCopy,
  stripPastedMarkup,
  parseOfferBlocks,
  cleanPastedListingCopy,
  shouldRewriteListingCopy
};
