'use strict';

// Landmarks (hospitals, schools, universities, malls, markets, airports) for
// "near Mulago", "10 miles from Makerere", "5 km from Entebbe airport",
// "house near a school in Kira". Coordinates are from OpenStreetMap
// (© OpenStreetMap contributors, ODbL) — see data/uganda-landmarks.json.

const path = require('path');
const fs = require('fs');

const KAMPALA = { lat: 0.3136, lng: 32.5811 };
const KIND_PRIORITY = { airport: 7, hospital: 6, university: 6, mall: 5, college: 4, market: 3, school: 2 };
const MAX_RADIUS_MILES = 50;
const DEFAULT_NEAR_MILES = 2;

// Everyday names for the big places, mapped to the name as it appears in the data.
const ALIASES = [
  [/^(?:mulago|mulago hospital|mulago national referral hospital|mulago referral hospital)$/, 'Mulago National Referal Hospital', 'hospital', 'Mulago Hospital'],
  [/^(?:makerere|makerere university|mak|makerere uni|mak university)$/, 'Makerere University', 'university'],
  [/^(?:kyambogo|kyambogo university|kyu)$/, 'Kyambogo University', 'university'],
  [/^(?:mubs|makerere university business school|nakawa mubs)$/, 'Makerere University Business School (MUBS)', 'university', 'MUBS (Nakawa)'],
  [/^(?:entebbe airport|entebbe international airport|ebb|the airport|airport)$/, 'Entebbe International Airport', 'airport'],
  [/^(?:nsambya|nsambya hospital|st francis hospital nsambya|st\.? francis nsambya)$/, 'Saint Francis Hospital & Nursing school Nsambya', 'hospital', 'Nsambya Hospital'],
  [/^(?:mengo|mengo hospital)$/, 'Mengo Hospital', 'hospital'],
  [/^(?:rubaga|rubaga hospital|lubaga hospital)$/, 'Rubaga Hospital', 'hospital'],
  [/^(?:kiruddu|kiruddu hospital|kiruddu referral hospital)$/, 'Kiruddu General Referral Hospital', 'hospital', 'Kiruddu Hospital'],
  [/^(?:kawempe hospital|kawempe referral hospital|kawempe national referral hospital)$/, 'Kawempe National Referal Hospital', 'hospital', 'Kawempe Hospital'],
  [/^(?:kampala international school|kisu|kis)$/, 'Kampala International School', 'school'],
  [/^(?:acacia|acacia mall|the acacia mall)$/, 'The Acacia Mall', 'mall', 'Acacia Mall'],
  [/^(?:garden city|garden city mall)$/, 'Garden City', 'mall']
];

let data = null;
function load() {
  if (data) return data;
  const file = path.join(__dirname, '..', 'data', 'uganda-landmarks.json');
  let places = [];
  try {
    places = JSON.parse(fs.readFileSync(file, 'utf8')).places || [];
  } catch (_error) {
    places = [];
  }
  data = places.map(([kind, name, lat, lng]) => ({ kind, name, lat, lng, key: normalize(name) }));
  return data;
}

function normalize(value = '') {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\breferal\b/g, 'referral')
    .replace(/\b(st|saint)\b/g, 'st')
    .replace(/\s+/g, ' ')
    .trim();
}

function kmBetween(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

const KIND_WORDS = [
  ['hospital', /\b(hospital|hospitals|clinic|clinics|health cent(?:er|re)|medical cent(?:er|re)|hospitali|eddwaliro|ddwaliro)\b/],
  ['school', /\b(school|schools|primary|secondary|nursery|kindergarten|shule|essomero|ssomero)\b/],
  ['university', /\b(university|universities|campus|uni)\b/],
  ['college', /\b(college|colleges|institute)\b/],
  ['mall', /\b(mall|malls|shopping cent(?:er|re)|supermarket|arcade)\b/],
  ['market', /\b(market|markets|soko|akatale)\b/],
  ['airport', /\b(airport|airstrip|aerodrome)\b/]
];

function kindFromText(text = '') {
  const clean = normalize(text);
  for (const [kind, re] of KIND_WORDS) if (re.test(clean)) return kind;
  return null;
}

const GENERIC_TARGET = /^(?:the |a |an |any |some )?(?:nearest |closest |nearby |good |best |local )?(hospitals?|clinics?|schools?|primary schools?|secondary schools?|universit(?:y|ies)|colleges?|malls?|shopping cent(?:er|re)s?|supermarkets?|markets?|airports?)$/;

/**
 * Find the place a person named: "Mulago", "Makerere University", "Nsambya hospital".
 * Returns { name, kind, lat, lng } or null. A generic word ("a school") returns null.
 */
function resolveLandmark(text = '') {
  const target = normalize(text).replace(/^(the|a|an)\s+/, '');
  if (!target || target.length < 3 || GENERIC_TARGET.test(target)) return null;
  const places = load();
  if (!places.length) return null;

  for (const [re, name, kind, display] of ALIASES) {
    if (re.test(target)) {
      const hit = places.find((p) => p.name === name && p.kind === kind) || places.find((p) => p.name === name);
      if (hit) return { name: display || hit.name.replace(/Referal/g, 'Referral'), kind: hit.kind, lat: hit.lat, lng: hit.lng };
    }
  }

  const tokens = target.split(' ').filter((w) => w.length > 1 && !['the', 'of', 'and', 'near', 'in'].includes(w));
  if (!tokens.length) return null;
  const wantKind = kindFromText(target);
  const candidates = places.filter((p) => tokens.every((w) => p.key.split(' ').includes(w) || p.key.includes(` ${w}`) || p.key.startsWith(w)));
  if (!candidates.length) return null;
  const score = (p) => {
    let s = KIND_PRIORITY[p.kind] || 0;
    if (wantKind && p.kind === wantKind) s += 5;
    if (p.key === target) s += 8;
    if (p.key.startsWith(target)) s += 3;
    s -= Math.min(4, kmBetween(p, KAMPALA) / 40); // ties go to the Kampala area, where most listings are
    s -= p.key.split(' ').length * 0.15;
    return s;
  };
  candidates.sort((a, b) => score(b) - score(a));
  const best = candidates[0];
  return { name: best.name.replace(/Referal/g, 'Referral'), kind: best.kind, lat: best.lat, lng: best.lng };
}

/** The nearest places of a kind to a point, closest first. */
function nearestOfKind(point, kind, { limit = 3, withinKm = 15 } = {}) {
  if (!point || !Number.isFinite(Number(point.lat)) || !Number.isFinite(Number(point.lng)) || !kind) return [];
  const kinds = kind === 'university' ? ['university', 'college'] : [kind];
  const latPad = withinKm / 111;
  const lngPad = withinKm / (111 * Math.max(0.2, Math.cos((point.lat * Math.PI) / 180)));
  return load()
    .filter((p) => kinds.includes(p.kind) && Math.abs(p.lat - point.lat) <= latPad && Math.abs(p.lng - point.lng) <= lngPad)
    .map((p) => ({ name: p.name.replace(/Referal/g, 'Referral'), kind: p.kind, lat: p.lat, lng: p.lng, km: kmBetween(point, p) }))
    .filter((p) => p.km <= withinKm)
    .sort((a, b) => a.km - b.km)
    .slice(0, limit);
}

const STOP_AFTER_TARGET = /\s+(?:for rent|for sale|to rent|to buy|to let|for students?|under|below|less than|max|budget|with|which|that|where|per month|a month|monthly|rentals?|apartments?|houses?|homes?|flats?|rooms?|plots?|land|property|properties|bedrooms?|\d+\s*(?:bed|br|bedroom)|please|asap|ugx|usd|shs)\b.*$/;

function cleanTarget(raw = '') {
  return String(raw || '')
    .replace(/[?.!,;:]+.*$/, '')
    .replace(STOP_AFTER_TARGET, '')
    .replace(/\s+(?:in|at|around)\s+[a-z][a-z' -]*$/i, (m) => m) // keep "in Kira" for the caller
    .trim();
}

/**
 * Read a distance search out of a message.
 *  "10 miles from Mulago"               → { radiusMiles: 10, target: "Mulago" }
 *  "within 5 km of Makerere"            → { radiusMiles: 3.1, target: "Makerere" }
 *  "2 bedroom near Acacia Mall"         → { radiusMiles: 2, target: "Acacia Mall", radiusExplicit: false }
 *  "house near a school in Kira"        → { kind: "school", area: "Kira", radiusMiles: 2 }
 *  "Nyumba karibu na hospitali ya Mulago" → { target: "hospitali ya Mulago" } (resolves to Mulago)
 * Returns null when the message is not a distance search ("near me" is handled elsewhere).
 */
function parseProximityQuery(text = '') {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  const lower = raw.toLowerCase();
  if (!lower || /\b(near|around|close to)\s+me\b|\bmy location\b|\bnearby me\b/.test(lower)) return null;

  const unitRe = '(km|kms|kilomet(?:er|re)s?|k\\.m\\.?|mi|mile|miles)';
  let radiusMiles = null;
  let radiusExplicit = false;
  let targetRaw = '';
  let m = lower.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${unitRe}\\s*(?:radius\\s*)?(?:from|of|to|away from|around|near|within|off)\\s+(.+)$`));
  if (!m) m = lower.match(new RegExp(`within\\s+(\\d+(?:\\.\\d+)?)\\s*${unitRe}\\s+(?:of|from|to|around)?\\s*(.+)$`));
  if (m) {
    const n = Number(m[1]);
    radiusMiles = /^(km|kms|kilomet|k\.m)/.test(m[2]) ? n / 1.609344 : n;
    radiusExplicit = true;
    targetRaw = m[3];
  } else {
    m = lower.match(/\b(?:near(?:by)?|close to|close by|next to|around|walking distance (?:to|from)|not far from|near to|karibu na|karibu ya|okumpi ne|okumpi n'|okumpi na|kumpi ne)\s+(.+)$/);
    if (!m) return null;
    targetRaw = m[1];
  }

  let target = cleanTarget(targetRaw);
  let area = null;
  const inArea = target.match(/^(.*?)\s+(?:in|at|e|mu|omu)\s+([a-z][a-z' -]{2,})$/i);
  if (inArea && (GENERIC_TARGET.test(normalize(inArea[1]).replace(/^(the|a|an)\s+/, '')) || kindFromText(inArea[1]))) {
    target = inArea[1].trim();
    area = inArea[2].trim();
  }
  // "hospitali ya Mulago" / "eddwaliro e Mulago" — the place is after the word.
  const named = target.match(/^(?:hospitali|hospital|eddwaliro|ddwaliro|shule|essomero|university|chuo)\s+(?:ya|la|cha|e|of)\s+(.+)$/i);
  if (named) target = `${named[1]} ${/shule|essomero/i.test(target) ? 'school' : (/university|chuo/i.test(target) ? 'university' : 'hospital')}`;

  const normalizedTarget = normalize(target).replace(/^(the|a|an)\s+/, '');
  const generic = GENERIC_TARGET.test(normalizedTarget);
  const kind = kindFromText(target);
  if (!normalizedTarget) return null;
  if (!radiusMiles) radiusMiles = DEFAULT_NEAR_MILES;
  radiusMiles = Math.max(0.25, Math.min(MAX_RADIUS_MILES, radiusMiles));
  return {
    radiusMiles: Math.round(radiusMiles * 100) / 100,
    radiusExplicit,
    target: generic ? null : target.replace(/^(the|a|an)\s+/i, ''),
    kind: generic ? kind : (kind || null),
    area,
    generic
  };
}

function formatDistance(km) {
  const n = Number(km);
  if (!Number.isFinite(n)) return '';
  const miles = n / 1.609344;
  if (n < 1) return `${Math.round(n * 1000 / 50) * 50 || 50} m`;
  return `${n.toFixed(1)} km (${miles.toFixed(1)} mi)`;
}

/**
 * Where to measure from. Famous landmark names win ("Mulago" = the hospital);
 * otherwise a known area or town ("Kampala", "Kira") uses its centre; otherwise
 * the closest-matching landmark.
 */
function resolveProximityCenter(target = '') {
  const clean = normalize(target).replace(/^(the|a|an)\s+/, '');
  if (!clean) return null;
  if (ALIASES.some(([re]) => re.test(clean))) {
    const lm = resolveLandmark(clean);
    if (lm) return { ...lm, source: 'landmark' };
  }
  if (!kindFromText(clean)) {
    try {
      const registry = require('../utils/ugandaLocationRegistry');
      const hit = registry.resolveCanonicalUgandaLocation(target);
      const match = hit?.status === 'matched' ? hit.match : null;
      if (match && Number.isFinite(Number(match.lat)) && Number.isFinite(Number(match.lng))) {
        return { name: match.name, kind: 'area', lat: Number(match.lat), lng: Number(match.lng), district: match.district || null, source: 'area' };
      }
    } catch (_error) { /* registry unavailable */ }
  }
  const lm = resolveLandmark(clean);
  return lm ? { ...lm, source: 'landmark' } : null;
}

/** Centre of an area name ("Kira") from the location registry. */
function areaCenter(name = '') {
  try {
    const registry = require('../utils/ugandaLocationRegistry');
    const hit = registry.resolveCanonicalUgandaLocation(name);
    const match = hit?.status === 'matched' ? hit.match : null;
    if (match && Number.isFinite(Number(match.lat)) && Number.isFinite(Number(match.lng))) {
      return { name: match.name, kind: 'area', lat: Number(match.lat), lng: Number(match.lng), district: match.district || null };
    }
  } catch (_error) { /* registry unavailable */ }
  return null;
}

const KIND_LABEL = { hospital: 'hospital', school: 'school', university: 'university', college: 'college', mall: 'shopping centre', market: 'market', airport: 'airport' };

module.exports = {
  DEFAULT_NEAR_MILES,
  KIND_LABEL,
  formatDistance,
  kindFromText,
  kmBetween,
  nearestOfKind,
  parseProximityQuery,
  resolveLandmark,
  resolveProximityCenter,
  areaCenter,
  _normalize: normalize
};
