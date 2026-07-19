'use strict';

require('dotenv').config();

const crypto = require('crypto');
const db = require('../config/database');
const {
  isCompetitorPortal,
  normalizePhone,
  slugify
} = require('../services/marketplaceService');

const PLACES_ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';
const DEFAULT_REFERER = 'https://makaug.com/';

const SEED_CATEGORIES = Object.freeze([
  { key: 'surveyors', label: 'Land surveyors', query: 'land surveyor' },
  { key: 'brokers', label: 'Property brokers and real estate agents', query: 'real estate agent property broker' },
  { key: 'property_lawyers', label: 'Property lawyers and conveyancing advocates', query: 'property lawyer conveyancing advocate' },
  { key: 'electricians', label: 'Electricians', query: 'electrician electrical contractor' },
  { key: 'builders', label: 'Builders and construction contractors', query: 'building contractor construction company' },
  { key: 'movers', label: 'Movers and relocation services', query: 'moving company relocation service' }
]);

const SEED_AREAS = Object.freeze({
  Kampala: ['Kampala', 'Nakawa', 'Ntinda', 'Kololo', 'Nakasero', 'Makindye', 'Rubaga', 'Kawempe', 'Bugolobi'],
  Wakiso: ['Wakiso', 'Kira', 'Namugongo', 'Nansana', 'Entebbe', 'Kajjansi', 'Bwebajja', 'Gayaza', 'Buloba'],
  Mukono: ['Mukono', 'Seeta', 'Namanve', 'Kyetume', 'Goma Mukono', 'Mbalala']
});

const DISTRICT_EVIDENCE = Object.freeze({
  Kampala: ['kampala', 'nakawa', 'ntinda', 'kololo', 'nakasero', 'makindye', 'rubaga', 'lubaga', 'kawempe', 'bugolobi'],
  Wakiso: ['wakiso', 'kira', 'namugongo', 'nansana', 'entebbe', 'kajjansi', 'bwebajja', 'gayaza', 'buloba'],
  Mukono: ['mukono', 'seeta', 'namanve', 'kyetume', 'goma', 'mbalala']
});

function parseArgs(argv = process.argv.slice(2)) {
  const readNumber = (name, fallback) => {
    const raw = argv.find((arg) => arg.startsWith(`--${name}=`))?.split('=')[1];
    return Math.max(1, Number(raw) || fallback);
  };
  return {
    dryRun: argv.includes('--dry-run'),
    requestCap: Math.min(160, readNumber('max-requests', 120)),
    target: Math.min(2000, readNumber('target', 1000)),
    delayMs: Math.min(5000, readNumber('delay-ms', 150))
  };
}

function normalizeText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function placeName(place = {}) {
  return normalizeText(place.displayName?.text || place.displayName);
}

function placeAddress(place = {}) {
  return normalizeText(place.formattedAddress);
}

function resolveDistrict(place = {}, expectedDistrict = '') {
  const componentText = (place.addressComponents || [])
    .map((item) => normalizeText(item.longText || item.shortText))
    .join(' ');
  const haystack = `${componentText} ${placeAddress(place)}`.toLowerCase();
  if (DISTRICT_EVIDENCE[expectedDistrict]?.some((token) => haystack.includes(token))) {
    return expectedDistrict;
  }
  for (const district of Object.keys(DISTRICT_EVIDENCE)) {
    if (DISTRICT_EVIDENCE[district].some((token) => haystack.includes(token))) return district;
  }
  return '';
}

function resolveArea(place = {}, district = '', queryArea = '') {
  const address = placeAddress(place).toLowerCase();
  const known = SEED_AREAS[district] || [];
  const matched = known.find((area) => address.includes(area.toLowerCase()));
  return matched || (address.includes(String(queryArea).toLowerCase()) ? queryArea : '');
}

function buildQueries() {
  const broad = [];
  const local = [];
  for (const category of SEED_CATEGORIES) {
    for (const district of Object.keys(SEED_AREAS)) {
      broad.push({ category, district, area: district, text: `${category.query} ${district} Uganda` });
    }
  }
  const maxAreas = Math.max(...Object.values(SEED_AREAS).map((areas) => areas.length));
  for (let areaIndex = 0; areaIndex < maxAreas; areaIndex += 1) {
    for (const category of SEED_CATEGORIES) {
      for (const [district, areas] of Object.entries(SEED_AREAS)) {
        const area = areas[areaIndex];
        if (!area || area === district) continue;
        local.push({ category, district, area, text: `${category.query} ${area} ${district} Uganda` });
      }
    }
  }
  return [...broad, ...local];
}

async function searchPlaces(apiKey, query, { referer = DEFAULT_REFERER } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(PLACES_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Referer: referer,
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': [
          'places.id',
          'places.displayName',
          'places.formattedAddress',
          'places.addressComponents',
          'places.nationalPhoneNumber',
          'places.internationalPhoneNumber',
          'places.websiteUri',
          'places.googleMapsUri',
          'places.location',
          'places.types'
        ].join(',')
      },
      body: JSON.stringify(buildPlacesRequest(query)),
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error?.message || `Google Places returned HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return Array.isArray(payload.places) ? payload.places : [];
  } finally {
    clearTimeout(timer);
  }
}

function buildPlacesRequest(query) {
  return { textQuery: normalizeText(query), pageSize: 20, regionCode: 'UG' };
}

function buildCandidate(place, query) {
  const name = placeName(place);
  const district = resolveDistrict(place, query.district);
  const area = district ? resolveArea(place, district, query.area) : '';
  const phone = normalizePhone(place.internationalPhoneNumber || place.nationalPhoneNumber);
  const sourceUrl = normalizeText(place.googleMapsUri);
  const website = normalizeText(place.websiteUri);
  const candidate = {
    name,
    category: query.category.key,
    district,
    area,
    phone,
    whatsapp: phone,
    website,
    source_url: sourceUrl,
    description: `${query.category.label} serving ${[area, district].filter(Boolean).join(', ')}. Found online via Google Maps; confirm services and availability directly with the business.`,
    place_id: normalizeText(place.id),
    latitude: Number(place.location?.latitude) || null,
    longitude: Number(place.location?.longitude) || null,
    formatted_address: placeAddress(place),
    types: Array.isArray(place.types) ? place.types : [],
    source_query: query.text
  };
  if (!name || !district || !phone || !sourceUrl || !candidate.place_id) return null;
  if (isCompetitorPortal(candidate)) return null;
  return candidate;
}

async function upsertCandidate(candidate, { dryRun = false } = {}) {
  const duplicate = await db.query(
    `SELECT id
       FROM marketplace_businesses
      WHERE source_url = $1
         OR source_place_id = $2
         OR source_metadata->>'google_place_id' = $2
         OR (phone = $3 AND phone <> '')
         OR (LOWER(name) = LOWER($4) AND district = $5)
      ORDER BY created_at ASC
      LIMIT 1`,
    [candidate.source_url, candidate.place_id, candidate.phone, candidate.name, candidate.district]
  );
  if (duplicate.rows[0]) {
    if (!dryRun) {
      await db.query(
        `UPDATE marketplace_businesses
            SET source_urls = ARRAY(SELECT DISTINCT unnest(source_urls || ARRAY[$2]::text[])),
                source_place_id = COALESCE(source_place_id, $5),
                phone = COALESCE(NULLIF(phone, ''), $3),
                whatsapp = COALESCE(NULLIF(whatsapp, ''), $3),
                website = COALESCE(NULLIF(website, ''), $4),
                last_refreshed = NOW(),
                updated_at = NOW()
          WHERE id = $1`,
        [duplicate.rows[0].id, candidate.source_url, candidate.phone, candidate.website || null, candidate.place_id]
      );
    }
    return { action: 'existing', id: duplicate.rows[0].id };
  }
  if (dryRun) return { action: 'would_insert', id: null };

  const suffix = crypto.createHash('sha1').update(candidate.place_id).digest('hex').slice(0, 8);
  const slug = `${slugify(`${candidate.name}-${candidate.district}`)}-${suffix}`;
  const metadata = {
    google_place_id: candidate.place_id,
    formatted_address: candidate.formatted_address,
    google_types: candidate.types,
    source_query: candidate.source_query,
    seeded_at: new Date().toISOString(),
    seed: 'marketplace-p1-google-places'
  };
  const inserted = await db.query(
    `INSERT INTO marketplace_businesses (
       name, slug, category, description, services_text, district, area,
       latitude, longitude, serves_regions, phone, whatsapp, website,
       tier, status, source_type, source, source_url, source_urls, source_place_id, source_metadata
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,ARRAY[$6]::text[],$10,$10,$11,
       'found_online','live','found_online','google_maps',$12,ARRAY[$12]::text[],$13,$14::jsonb
     )
     RETURNING id`,
    [
      candidate.name,
      slug,
      candidate.category,
      candidate.description,
      candidate.description,
      candidate.district,
      candidate.area || null,
      candidate.latitude,
      candidate.longitude,
      candidate.phone,
      candidate.website || null,
      candidate.source_url,
      candidate.place_id,
      JSON.stringify(metadata)
    ]
  );
  await db.query(
    `INSERT INTO marketplace_events (business_id, event_type, metadata)
     VALUES ($1, 'business_seeded', $2::jsonb)`,
    [inserted.rows[0].id, JSON.stringify({ source: 'google_maps', category: candidate.category, district: candidate.district })]
  );
  return { action: 'inserted', id: inserted.rows[0].id };
}

function emptyCounts() {
  return Object.fromEntries(SEED_CATEGORIES.map((category) => [
    category.key,
    { inserted: 0, existing: 0, would_insert: 0 }
  ]));
}

async function run() {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_MAPS_API_KEY or PUBLIC_GOOGLE_MAPS_API_KEY is required.');
  const options = parseArgs();
  const queries = buildQueries();
  const counts = emptyCounts();
  const summary = {
    marker: 'marketplace-p1-seed-20260719',
    dry_run: options.dryRun,
    request_cap: options.requestCap,
    target: options.target,
    requests: 0,
    fetched: 0,
    accepted: 0,
    inserted: 0,
    existing: 0,
    would_insert: 0,
    rejected_missing_required: 0,
    errors: 0,
    by_category: counts
  };
  const seenPlaceIds = new Set();

  for (const query of queries) {
    if (summary.requests >= options.requestCap) break;
    if (summary.inserted + summary.would_insert >= options.target) break;
    summary.requests += 1;
    try {
      const places = await searchPlaces(apiKey, query.text, {
        referer: process.env.GOOGLE_PLACES_REFERER || DEFAULT_REFERER
      });
      summary.fetched += places.length;
      for (const place of places) {
        if (seenPlaceIds.has(place.id)) continue;
        seenPlaceIds.add(place.id);
        const candidate = buildCandidate(place, query);
        if (!candidate) {
          summary.rejected_missing_required += 1;
          continue;
        }
        summary.accepted += 1;
        const result = await upsertCandidate(candidate, options);
        summary[result.action] += 1;
        counts[candidate.category][result.action] += 1;
      }
    } catch (error) {
      summary.errors += 1;
      console.error(JSON.stringify({ query: query.text, error: error.message, status: error.status || null }));
      if ([401, 403].includes(error.status)) throw error;
    }
    if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
  }

  const live = await db.query(
    `SELECT category, COUNT(*)::int AS count
       FROM marketplace_businesses
      WHERE status = 'live' AND tier = 'found_online'
        AND category = ANY($1::text[])
      GROUP BY category
      ORDER BY category`,
    [SEED_CATEGORIES.map((category) => category.key)]
  );
  summary.live_by_category = Object.fromEntries(live.rows.map((row) => [row.category, Number(row.count)]));
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

if (require.main === module) {
  run()
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exitCode = 1;
    })
    .finally(() => db.pool.end());
}

module.exports = {
  DISTRICT_EVIDENCE,
  SEED_AREAS,
  SEED_CATEGORIES,
  buildCandidate,
  buildPlacesRequest,
  buildQueries,
  parseArgs,
  placeAddress,
  placeName,
  resolveArea,
  resolveDistrict
};
