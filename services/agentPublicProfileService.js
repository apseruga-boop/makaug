'use strict';

// Public "About" text and areas covered for an agent profile, written from the
// agent's live (approved) listings. Nothing here is stored: it is rebuilt on
// every profile request, so it follows the listings as they change. Facts
// only come from the listings (counts, places, asking prices, bedrooms, video
// tours) - no years of experience, awards or claims the data cannot back.
// An agent's own bio is never replaced; the listing write-up follows it.

const {
  resolveCanonicalUgandaLocation,
  canonicalLocationSearchScope,
  normalizeDistrict
} = require('../utils/ugandaLocationRegistry');

const PLACEHOLDER_BIO_PATTERNS = [
  /^\s*$/,
  /^professional makaug agent profile\.?$/i,
  /^professional real estate broker helping clients buy, rent, and invest with confidence\.?$/i,
  /^makaug (broker|agent) covering [\w\s,'-]+ propert(y|ies)\.?$/i
];

const INTERNAL_BIO_SENTENCES = [
  /\s*This profile was created from the agent[’']s direct submission[;,.]?\s*(identity verification and account claim are pending\.?)?\s*/gi,
  /\s*Identity verification and account claim are pending\.?\s*/gi
];

const NEARBY_RADIUS_KM = 4;
const MAX_LISTED_AREAS = 8;
const MAX_NEARBY_AREAS = 6;

function cleanText(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function isPlaceholderBio(bio) {
  const text = cleanText(bio);
  return PLACEHOLDER_BIO_PATTERNS.some((pattern) => pattern.test(text));
}

// The "direct submission / claim pending" note is makaug's own boilerplate, so
// it is removed from whatever is shown publicly. makaugCreated is accepted so
// older callers keep working; it no longer decides whether the note is stripped.
function ownBio(bio, { makaugCreated = false } = {}) {
  void makaugCreated;
  if (isPlaceholderBio(bio)) return '';
  let text = String(bio || '');
  INTERNAL_BIO_SENTENCES.forEach((pattern) => { text = text.replace(pattern, ' '); });
  text = cleanText(text);
  if (!text || isPlaceholderBio(text)) return '';
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

// Small stable hash so each agent always gets the same wording, and agents
// next to each other in the directory don't read identically.
function stableIndex(seed, size) {
  let hash = 2166136261;
  const text = String(seed || '');
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % Math.max(1, size);
}

function pick(seed, salt, options) {
  return options[stableIndex(`${seed}:${salt}`, options.length)];
}

function joinList(items = []) {
  const list = items.filter(Boolean);
  if (list.length <= 1) return list[0] || '';
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

function compactUgx(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) return '';
  const trim = (n) => (n >= 100 ? String(Math.round(n)) : String(Number(n.toFixed(1))));
  if (value >= 1e9) return `USh ${trim(value / 1e9)}bn`;
  if (value >= 1e6) return `USh ${trim(value / 1e6)}M`;
  if (value >= 1e3) return `USh ${trim(value / 1e3)}k`;
  return `USh ${Math.round(value)}`;
}

// With six or more prices, the cheapest and dearest 10% are left out so one
// mistyped listing can't set the range ("most asking prices run from ...").
function priceRange(values = []) {
  const prices = values.filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (!prices.length) return { text: '', trimmed: false };
  const trimmed = prices.length >= 6;
  const cut = trimmed ? Math.floor(prices.length * 0.1) : 0;
  const kept = prices.slice(cut, prices.length - cut);
  const low = compactUgx(kept[0]);
  const high = compactUgx(kept[kept.length - 1]);
  return { text: low === high ? low : `${low} to ${high}`, single: low === high, trimmed };
}

const MAX_MONTHLY_RENT_UGX = 25000000;
const MIN_MONTHLY_RENT_UGX = 50000;
const MAX_HOME_BEDROOMS = 10;

function isMonthlyPeriod(period) {
  return /^(mo|month|monthly|per month|pm)$/i.test(cleanText(period));
}

function listingPrice(row = {}) {
  const price = Number(row.price);
  return Number.isFinite(price) && price > 0 ? price : null;
}

function hasVideoTour(row = {}) {
  const extra = row.extra_fields && typeof row.extra_fields === 'object' ? row.extra_fields : {};
  const values = [
    ...(Array.isArray(extra.video_urls) ? extra.video_urls : []),
    ...(Array.isArray(extra.video_tours) ? extra.video_tours.map((item) => item?.url || item) : []),
    row.video_url, row.youtube_url, row.tiktok_url,
    extra.video_url, extra.youtube_url, extra.tiktok_url
  ];
  return values.some((value) => /^https?:\/\//i.test(String(value || '').trim()));
}

// sale = homes and buildings for sale; land; rent; commercial.
function listingKind(row = {}) {
  const type = cleanText(row.listing_type).toLowerCase();
  const propertyType = cleanText(row.property_type).toLowerCase();
  if (type === 'rent' || type === 'students' || type === 'student' || (isMonthlyPeriod(row.price_period) && type !== 'land')) return 'rent';
  if (type === 'land' || (propertyType.includes('land') && type !== 'commercial')) return 'land';
  if (type === 'commercial' || propertyType.startsWith('commercial') || propertyType === 'hospitality' || propertyType === 'warehouse') return 'commercial';
  return 'sale';
}

function homeWord(row = {}) {
  const propertyType = cleanText(row.property_type).toLowerCase();
  if (propertyType.includes('apartment') || propertyType.includes('flat') || propertyType.includes('condo')) return 'apartment';
  if (propertyType.includes('house') || propertyType.includes('bungalow') || propertyType.includes('villa') || propertyType.includes('mansion') || propertyType.includes('duplex')) return 'house';
  return '';
}

function placeFor(row = {}) {
  const district = normalizeDistrict(row.district) || cleanText(row.district);
  const area = cleanText(row.area);
  if (!area) return { name: '', district, key: '' };
  const resolved = resolveCanonicalUgandaLocation(area, district);
  const match = resolved?.status === 'matched' ? resolved.match : null;
  if (match && match.level !== 'district') {
    return { name: match.name, district: match.district || district, key: match.key };
  }
  // An "area" that is just the district name says nothing more specific.
  if (district && area.toLowerCase() === district.toLowerCase()) return { name: '', district, key: '' };
  if (match?.level === 'district') return { name: '', district: match.district || district, key: '' };
  return { name: area.replace(/\b\w/g, (c) => c.toUpperCase()), district, key: '' };
}

function summarizeListings(listings = []) {
  const kinds = { sale: 0, land: 0, rent: 0, commercial: 0 };
  const prices = { sale: [], land: [], rent: [], commercial: [] };
  const bedrooms = [];
  const homeWords = { apartment: 0, house: 0 };
  const areaCounts = new Map();
  const districtCounts = new Map();
  let videos = 0;
  let commercialLand = 0;
  let homesForSale = 0;
  listings.forEach((row) => {
    const kind = listingKind(row);
    kinds[kind] += 1;
    const price = listingPrice(row);
    const plausible = kind !== 'rent' || (price >= MIN_MONTHLY_RENT_UGX && price <= MAX_MONTHLY_RENT_UGX);
    if (price && plausible) prices[kind].push(price);
    if (kind === 'land' && cleanText(row.property_type).toLowerCase().includes('commercial')) commercialLand += 1;
    const beds = Number(row.bedrooms);
    if ((kind === 'sale' || kind === 'rent') && Number.isFinite(beds) && beds > 0 && beds <= MAX_HOME_BEDROOMS) bedrooms.push(beds);
    const word = kind === 'sale' ? homeWord(row) : '';
    if (word) homeWords[word] += 1;
    if (kind === 'sale' && (word || (Number.isFinite(beds) && beds > 0 && beds <= MAX_HOME_BEDROOMS))) homesForSale += 1;
    if (hasVideoTour(row)) videos += 1;
    const place = placeFor(row);
    if (place.district) districtCounts.set(place.district, (districtCounts.get(place.district) || 0) + 1);
    if (place.name) {
      const id = `${place.name.toLowerCase()}|${place.district.toLowerCase()}`;
      const entry = areaCounts.get(id) || { name: place.name, district: place.district, key: place.key, listings: 0 };
      entry.listings += 1;
      areaCounts.set(id, entry);
    }
  });
  const areas = Array.from(areaCounts.values()).sort((a, b) => b.listings - a.listings || a.name.localeCompare(b.name));
  const districts = Array.from(districtCounts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name);
  // A district counts as "theirs" in the wording when it holds at least two
  // listings or a tenth of them; one-off listings elsewhere still show in areas.
  const mainDistricts = Array.from(districtCounts.entries())
    .filter(([, n]) => n >= 2 || n >= listings.length * 0.1)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name]) => name);
  return { total: listings.length, kinds, prices, bedrooms, homeWords, homesForSale, areas, districts, mainDistricts, videos, commercialLand };
}

function nearbyAreasFor(areas = [], exclude = new Set()) {
  const keys = areas.map((area) => area.key).filter(Boolean).slice(0, 5);
  if (!keys.length) return [];
  const scope = canonicalLocationSearchScope(keys, NEARBY_RADIUS_KM);
  const seen = new Set(exclude);
  const out = [];
  (scope?.nearby || []).forEach((entry) => {
    if (out.length >= MAX_NEARBY_AREAS) return;
    if (!['area', 'neighborhood', 'town', 'city'].includes(entry.level)) return;
    const id = String(entry.name || '').toLowerCase();
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push({ name: entry.name, district: entry.district });
  });
  return out;
}

// "houses" or "apartments" when most of the listings for sale say so,
// "homes" when they at least have bedrooms, otherwise "properties".
function saleWords(homeWords = {}, homesForSale = 0, saleCount = 0) {
  const house = homeWords.house || 0;
  const apartment = homeWords.apartment || 0;
  if (saleCount && house >= saleCount / 2 && house >= apartment) return ['house', 'houses'];
  if (saleCount && apartment >= saleCount / 2) return ['apartment', 'apartments'];
  if (saleCount && homesForSale >= saleCount / 2) return ['home', 'homes'];
  return ['property', 'properties'];
}

function mixPhrases(kinds = {}, homeWords = {}, homesForSale = 0) {
  const phrases = [];
  const order = Object.entries(kinds).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  order.forEach(([kind, n]) => {
    if (kind === 'sale') {
      const word = saleWords(homeWords, homesForSale, n);
      phrases.push(`${plural(n, word[0], word[1])} for sale`);
    }
    if (kind === 'land') phrases.push(plural(n, 'plot of land', 'plots of land'));
    if (kind === 'rent') phrases.push(plural(n, 'rental', 'rentals'));
    if (kind === 'commercial') phrases.push(plural(n, 'commercial property', 'commercial properties'));
  });
  return phrases;
}

function focusPhrase(summary) {
  const { total, kinds } = summary;
  if (!total) return '';
  const share = (n) => n / total;
  if (share(kinds.land) >= 0.6) return 'land';
  if (share(kinds.rent) >= 0.6) return 'rent';
  if (share(kinds.sale) >= 0.6) return 'sale';
  if (share(kinds.commercial) >= 0.6) return 'commercial';
  return 'mixed';
}

function openingSentence(seed, name, summary, topAreaText) {
  const focus = focusPhrase(summary);
  const saleNoun = saleWords(summary.homeWords, summary.homesForSale, summary.kinds.sale)[1];
  const where = topAreaText ? ` around ${topAreaText}` : '';
  const kindsPresent = mixPhrases(summary.kinds, summary.homeWords, summary.homesForSale).length;
  const spanNouns = Object.entries(summary.kinds).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])
    .map(([kind]) => ({ rent: 'homes to rent', land: 'land', sale: `${saleNoun} for sale`, commercial: 'commercial property' })[kind]);
  const mixed = {
    3: 'buyers, renters and land seekers',
    4: 'buyers, renters, land seekers and businesses'
  }[kindsPresent] || 'buyers and renters';
  const options = {
    land: [
      `${name} is a land agent on makaug, finding plots for buyers${where}.`,
      `Land is the heart of ${name}'s work on makaug, with plots on offer${where}.`,
      `${name} helps buyers find the right plot of land${where}.`
    ],
    rent: [
      `${name} helps tenants find their next home to rent${where}.`,
      `Rentals are ${name}'s main line on makaug, with homes to let${where}.`,
      `${name} is a lettings agent on makaug, matching tenants with homes${where}.`
    ],
    sale: [
      `${name} helps buyers find ${saleNoun} for sale${where}.`,
      `${name} sells ${saleNoun} on makaug${where ? `, mostly${where}` : ''}.`,
      `${saleNoun.charAt(0).toUpperCase()}${saleNoun.slice(1)} for sale are ${name}'s main line on makaug${where ? `, with listings${where}` : ''}.`
    ],
    commercial: [
      `${name} handles commercial property on makaug${where}.`,
      `${name} works with businesses and investors looking for commercial property${where}.`
    ],
    mixed: [
      `${name} works with ${mixed}${where}.`,
      `${name} is a property agent on makaug serving ${mixed}${where}.`,
      `${name}'s listings on makaug span ${joinList(spanNouns)}${where}.`
    ]
  };
  return pick(seed, 'open', options[focus] || options.mixed);
}

function portfolioSentences(seed, summary) {
  const sentences = [];
  const mix = mixPhrases(summary.kinds, summary.homeWords, summary.homesForSale);
  if (summary.total === 1) {
    const only = mix[0].replace(/^1 /, '');
    const article = /^[aeiou]/i.test(only) ? 'an' : 'a';
    const place = summary.areas[0]?.name || summary.districts[0] || '';
    sentences.push(`Right now they have one live listing on makaug, ${article} ${only}${place ? ` in ${place}` : ''}.`);
  } else if (summary.total) {
    sentences.push(pick(seed, 'mix', [
      `Right now they have ${plural(summary.total, 'live listing', 'live listings')} on makaug: ${joinList(mix)}.`,
      `Their ${plural(summary.total, 'live listing', 'live listings')} on makaug ${summary.total === 1 ? 'is' : 'are'} ${joinList(mix)}.`,
      `On makaug today you'll find ${joinList(mix)} from them.`
    ]));
  }
  const buy = priceRange([...summary.prices.sale, ...summary.prices.land, ...summary.prices.commercial]);
  const rent = priceRange(summary.prices.rent);
  const most = buy.trimmed || rent.trimmed ? 'Most asking prices' : 'Asking prices';
  const buyText = buy.single ? `${buy.text} to buy` : `from ${buy.text} to buy`;
  const rentText = rent.single ? `${rent.text} a month to rent` : `from ${rent.text} a month to rent`;
  if (buy.text && rent.text && buy.single) {
    sentences.push(`The asking price to buy is ${buy.text}, and ${rent.single ? `the rent is ${rent.text} a month` : `rents run from ${rent.text} a month`}.`);
  } else if (buy.text && rent.text) {
    sentences.push(`${most} run ${buyText}, and ${rentText}.`);
  } else if (buy.text) {
    sentences.push(buy.single ? `The asking price is ${buy.text}.` : `${most} run from ${buy.text}.`);
  } else if (rent.text) {
    sentences.push(rent.single ? `The rent is ${rent.text} a month.` : `${rent.trimmed ? 'Most rents' : 'Rents'} run from ${rent.text} a month.`);
  }
  if (summary.commercialLand) {
    sentences.push(`${summary.commercialLand === 1 ? 'One plot is' : `${summary.commercialLand} of the plots are`} suited to commercial use.`);
  }
  if (summary.bedrooms.length >= 2) {
    const low = Math.min(...summary.bedrooms);
    const high = Math.max(...summary.bedrooms);
    sentences.push(low === high
      ? `The homes on offer are ${low}-bedroom.`
      : `Homes on offer range from ${low === 1 ? '1-bedroom units' : `${low} bedrooms`} to ${high} bedrooms.`);
  }
  if (summary.videos) {
    sentences.push(summary.videos === 1
      ? 'One listing comes with a video tour you can watch before visiting.'
      : `${summary.videos} listings come with video tours, so you can look around before you visit.`);
  }
  return sentences;
}

function coverageSentence(seed, summary, nearby, districts) {
  const nearbyNames = nearby.map((area) => area.name);
  const districtText = joinList(districts.slice(0, 4));
  if (nearbyNames.length && districtText) {
    return pick(seed, 'cover', [
      `They also cover nearby ${joinList(nearbyNames.slice(0, 4))}, and the wider ${districtText} area.`,
      `Beyond their listings, they work nearby areas such as ${joinList(nearbyNames.slice(0, 4))} across ${districtText}.`
    ]);
  }
  if (districtText) return `They cover ${districtText}${districts.length > 1 ? ' and the areas in between' : ' and the surrounding areas'}.`;
  return '';
}

function closingSentence(seed, hasListings) {
  return hasListings
    ? pick(seed, 'close', [
      'Call or WhatsApp using the buttons above to book a viewing or ask about a listing.',
      'Use the call or WhatsApp buttons above to arrange a viewing or ask what else they have.',
      'Get in touch with the buttons above to ask about a listing or describe what you are looking for.'
    ])
    : 'Use the call or WhatsApp buttons above to tell them what you are looking for.';
}

function districtList(...groups) {
  const out = [];
  const seen = new Set();
  groups.flat().forEach((value) => {
    const name = normalizeDistrict(value);
    const id = String(name || '').toLowerCase();
    if (!name || seen.has(id)) return;
    seen.add(id);
    out.push(name);
  });
  return out;
}

const GENERIC_COMPANY_NAMES = new Set([
  'independent agent',
  'agency/company',
  'agency',
  'company',
  'makaug',
  'agent',
  'broker'
]);

// A workplace name is only worth saying when it is not the agent's own name
// and not the generic type stored in company_name ("Independent agent").
function distinctCompanyName(agent = {}) {
  const name = cleanText(agent.full_name || agent.name).toLowerCase();
  const company = cleanText(agent.company_name || agent.company);
  if (!company || company.toLowerCase() === name || GENERIC_COMPANY_NAMES.has(company.toLowerCase())) return '';
  return company;
}

function agentRoleLabel(agent = {}) {
  const company = cleanText(agent.company_name || agent.company).toLowerCase();
  if (company === 'independent agent') return 'Independent agent';
  if (company === 'agency/company' || company === 'agency') return 'Agency';
  return '';
}

function specialismPhrase(summary = {}) {
  const phrases = [];
  Object.entries(summary.kinds || {})
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .forEach(([kind]) => {
      if (kind === 'sale') {
        const word = saleWords(summary.homeWords, summary.homesForSale, summary.kinds.sale);
        phrases.push(`${word[1]} for sale`);
      }
      if (kind === 'land') phrases.push('plots');
      if (kind === 'rent') phrases.push('rentals');
      if (kind === 'commercial') phrases.push('commercial property');
    });
  return joinList(phrases.slice(0, 3));
}

function emptyPortfolioBio(name, role, company, where) {
  const place = where ? ` covering ${where}` : '';
  const who = company
    ? `${name} of ${company} is on makaug${place}`
    : role === 'Agency'
      ? `${name} is an agency on makaug${place}`
      : role === 'Independent agent'
        ? `${name} is an independent agent on makaug${place}`
        : `${name} is a property agent on makaug${place}`;
  return `${who}. Their properties will appear here once listed.`;
}

function fitCardSentences(sentences = []) {
  const clean = sentences.map((sentence) => cleanText(sentence)).filter(Boolean).slice(0, 3);
  if (!clean.length) return 'Property agent on makaug.';
  const chosen = [clean[0]];
  for (let i = 1; i < clean.length; i += 1) {
    const next = `${chosen.join(' ')} ${clean[i]}`;
    if (next.length > 280) break;
    chosen.push(clean[i]);
  }
  let text = chosen.join(' ');
  if (text.length > 280) text = `${text.slice(0, 277).replace(/\s+\S*$/, '').replace(/[,:;]$/, '')}.`;
  return text;
}

// 2–3 sentences for the card and the profile About. A real bio always wins.
// Generated text is built only from live listings and the agent's own areas.
// It is never written back to agents.bio.
function agentCardBio(agent = {}, listings = []) {
  const own = ownBio(agent.bio, {
    makaugCreated: agent.direct_agent_authorised === true || String(agent.verification_reason || '').includes('[DIRECT_AGENT_AUTHORISED]')
  });
  if (own) return { text: own, source: 'agent' };

  const name = cleanText(agent.full_name || agent.name || agent.company_name) || 'This agent';
  const company = distinctCompanyName(agent);
  const role = agentRoleLabel(agent);
  const summary = summarizeListings(Array.isArray(listings) ? listings : []);
  const covered = districtList(Array.isArray(agent.districts_covered) ? agent.districts_covered : []);
  const where = joinList(summary.areas.slice(0, 3).map((area) => area.name))
    || joinList((summary.mainDistricts.length ? summary.mainDistricts : summary.districts).slice(0, 3))
    || joinList(covered.slice(0, 3));

  if (!summary.total) {
    return { text: emptyPortfolioBio(name, role, company, where), source: 'generated' };
  }

  const mix = mixPhrases(summary.kinds, summary.homeWords, summary.homesForSale);
  const focus = summary.total === 1
    ? (() => {
      const only = String(mix[0] || 'property').replace(/^1 /, '');
      return `${/^[aeiou]/i.test(only) ? 'an' : 'a'} ${only}`;
    })()
    : (specialismPhrase(summary) || 'property');
  const place = where ? `${summary.total === 1 ? ' in' : ' around'} ${where}` : '';
  const leadWho = company ? `${name} of ${company} specialises` : 'Specialises';
  const sentences = [`${leadWho} in ${focus}${place}, with ${plural(summary.total, 'live listing', 'live listings')} on makaug.`];
  const buy = priceRange([...summary.prices.sale, ...summary.prices.land, ...summary.prices.commercial]);
  const rent = priceRange(summary.prices.rent);
  if (buy.text && rent.text) {
    sentences.push(buy.single && rent.single
      ? `The asking price is ${buy.text}, and the rent is ${rent.text} a month.`
      : `Asking prices run from ${buy.text} to buy, and from ${rent.text} a month to rent.`);
  } else if (buy.text) {
    sentences.push(buy.single ? `The asking price is ${buy.text}.` : `Asking prices run from ${buy.text}.`);
  } else if (rent.text) {
    sentences.push(rent.single ? `The rent is ${rent.text} a month.` : `Rents run from ${rent.text} a month.`);
  }
  const districtLine = joinList(summary.districts.slice(0, 3));
  if (!where && districtLine) sentences.push(`They cover ${districtLine}.`);
  return { text: fitCardSentences(sentences), source: 'generated' };
}

const cardBioCache = new Map();
const CARD_BIO_TTL_MS = 5 * 60 * 1000;

function cardBioCacheKey(agent = {}, listings = []) {
  let hash = 2166136261;
  const text = [
    agent.id,
    cleanText(agent.bio),
    cleanText(agent.company_name || agent.company),
    cleanText(agent.full_name || agent.name),
    ...(Array.isArray(agent.districts_covered) ? agent.districts_covered : []),
    ...listings.map((row) => [row.listing_type, row.property_type, row.district, row.area, row.price, row.price_period].join('|'))
  ].join('\n');
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${hash >>> 0}`;
}

function agentCardBioCached(agent = {}, listings = []) {
  const key = cardBioCacheKey(agent, listings);
  const hit = cardBioCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = agentCardBio(agent, listings);
  cardBioCache.set(key, { value, expires: Date.now() + CARD_BIO_TTL_MS });
  if (cardBioCache.size > 400) cardBioCache.delete(cardBioCache.keys().next().value);
  return value;
}

function buildAgentPublicSummary(agent = {}, listings = []) {
  const summary = summarizeListings(Array.isArray(listings) ? listings : []);
  const areas = summary.areas.slice(0, MAX_LISTED_AREAS);
  const areaNames = new Set(areas.map((area) => area.name.toLowerCase()));
  const nearby = nearbyAreasFor(areas, areaNames);
  const covered = Array.isArray(agent.districts_covered) ? agent.districts_covered : [];
  const districts = districtList(summary.districts, nearby.map((area) => area.district), covered);
  const card = agentCardBio(agent, listings);

  return {
    about: [card.text],
    about_text: card.text,
    own_bio: card.source === 'agent',
    bio_display: card.text,
    bio_source: card.source,
    listings_counted: summary.total,
    mix: summary.kinds,
    mix_phrases: mixPhrases(summary.kinds, summary.homeWords, summary.homesForSale),
    areas,
    nearby_areas: nearby,
    districts,
    video_tours: summary.videos
  };
}

// One-line version for meta descriptions (at most ~155 characters).
function agentSummaryDescription(publicSummary = {}, name = '') {
  const areas = (publicSummary.areas || []).slice(0, 3).map((area) => area.name);
  const mix = Array.isArray(publicSummary.mix_phrases) ? publicSummary.mix_phrases : mixPhrases(publicSummary.mix || {}, {});
  const who = cleanText(name) || 'This makaug agent';
  let text = mix.length
    ? `${who}: ${joinList(mix.slice(0, 3))}${areas.length ? ` in ${joinList(areas)}` : ''}.`
    : `${who}, property agent on makaug.`;
  if (text.length < 120) text += ' Call or WhatsApp on makaug.com.';
  return text.length > 158 ? `${text.slice(0, 155).replace(/\s+\S*$/, '')}…` : text;
}

module.exports = {
  buildAgentPublicSummary,
  agentSummaryDescription,
  agentCardBio,
  agentCardBioCached,
  isPlaceholderBio,
  ownBio,
  listingKind,
  compactUgx,
  distinctCompanyName
};

// Every approved listing for one agent, with only the columns the summary
// reads (the profile's own listing grid is capped at 100; the write-up is not).
async function loadAgentSummaryListings(db, agentId) {
  const result = await db.query(
    `SELECT p.listing_type, p.property_type, p.district, p.area, p.price, p.price_period, p.bedrooms,
            jsonb_build_object(
              'video_url', p.extra_fields->'video_url',
              'video_urls', p.extra_fields->'video_urls',
              'video_tours', p.extra_fields->'video_tours',
              'youtube_url', p.extra_fields->'youtube_url',
              'tiktok_url', p.extra_fields->'tiktok_url'
            ) AS extra_fields
       FROM properties p
      WHERE p.agent_id = $1 AND p.status = 'approved'`,
    [agentId]
  );
  return result.rows;
}

async function loadAgentPublicSummary(db, agent = {}) {
  if (!agent?.id) return null;
  const listings = await loadAgentSummaryListings(db, agent.id);
  return buildAgentPublicSummary(agent, listings);
}

// Listings for every agent on a directory page, in one query. The card bio
// does not need video columns, so this stays lighter than the profile summary.
async function loadAgentCardListings(db, agentIds = []) {
  const ids = [...new Set(agentIds.map((id) => String(id || '')).filter(Boolean))];
  if (!ids.length) return new Map();
  const result = await db.query(
    `SELECT p.agent_id, p.listing_type, p.property_type, p.district, p.area, p.price, p.price_period, p.bedrooms
       FROM properties p
      WHERE p.status = 'approved' AND p.agent_id = ANY($1::uuid[])`,
    [ids]
  );
  const grouped = new Map();
  result.rows.forEach((row) => {
    const key = String(row.agent_id);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  });
  return grouped;
}

async function loadAgentCardBios(db, agents = []) {
  const grouped = await loadAgentCardListings(db, agents.map((agent) => agent.id));
  const bios = new Map();
  agents.forEach((agent) => {
    const key = String(agent.id || '');
    if (!key) return;
    bios.set(key, agentCardBioCached(agent, grouped.get(key) || []));
  });
  return bios;
}

module.exports.loadAgentSummaryListings = loadAgentSummaryListings;
module.exports.loadAgentPublicSummary = loadAgentPublicSummary;
module.exports.loadAgentCardListings = loadAgentCardListings;
module.exports.loadAgentCardBios = loadAgentCardBios;
