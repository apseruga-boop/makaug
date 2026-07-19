'use strict';

const crypto = require('crypto');

const logger = require('../config/logger');
const {
  DISTRICTS,
  MARKETPLACE_CATEGORIES,
  getMarketplaceStats,
  invalidateMarketplaceStats,
  isCompetitorPortal,
  normalizeCategory,
  normalizePhone,
  slugify
} = require('./marketplaceService');

const MARKETPLACE_P2_MARKER = 'marketplace-p2-20260719';
const DRIP_KEY = 'marketplace_national_v1';
const GOOGLE_SEARCH_ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';
const DEFAULT_BASE_URL = 'https://makaug.com';
const DEFAULT_INTERVAL_MINUTES = 30;
const DEFAULT_BATCH_SIZE = 5;
const DEFAULT_MONTHLY_CAP = 300;
const SCHEDULER_POLL_MS = Math.max(30000, Number(process.env.MARKETPLACE_DRIP_SCHEDULER_POLL_MS || 60000));
const PRIORITY_DISTRICTS = Object.freeze([
  'Kampala', 'Wakiso', 'Mukono', 'Jinja', 'Mbarara', 'Gulu', 'Mbale', 'Kabarole', 'Arua', 'Lira',
  'Masaka', 'Kabale', 'Hoima', 'Soroti', 'Tororo', 'Busia', 'Iganga', 'Kayunga', 'Mpigi', 'Mityana',
  'Luwero', 'Nakasongola', 'Ntungamo', 'Bushenyi', 'Kasese', 'Rukungiri', 'Nebbi', 'Moroto', 'Kotido', 'Kitgum'
]);

let schedulerTimer = null;
let schedulerRunning = false;
let schedulerArmedAt = null;
let schedulerLastTickAt = null;
let schedulerLastResult = null;

const SOURCE_DEFINITIONS = Object.freeze([
  {
    key: 'google_maps',
    label: 'Google Maps',
    url: 'https://www.google.com/maps',
    adapter: 'google_places_text_search',
    adapter_status: 'active',
    enabled: true,
    priority: 10
  },
  {
    key: 'yellow_pages',
    label: 'Yellow Uganda',
    url: 'https://www.yellow.ug/',
    adapter: 'source_catalog_only',
    adapter_status: 'configured',
    enabled: false,
    priority: 40
  },
  {
    key: 'ug_business_dir',
    label: 'Uganda Business Directory',
    url: 'https://find.ug/',
    adapter: 'source_catalog_only',
    adapter_status: 'configured',
    enabled: false,
    priority: 50
  },
  {
    key: 'mtn_directory',
    label: 'MTN Business',
    url: 'https://www.mtn.co.ug/business/',
    adapter: 'no_public_directory_api',
    adapter_status: 'unavailable',
    enabled: false,
    priority: 60
  },
  {
    key: 'linkedin',
    label: 'LinkedIn company pages',
    url: 'https://www.linkedin.com/',
    adapter: 'requires_approved_api_or_exact_url',
    adapter_status: 'requires_configuration',
    enabled: false,
    priority: 70
  },
  {
    key: 'facebook',
    label: 'Facebook business pages',
    url: 'https://www.facebook.com/',
    adapter: 'requires_graph_api_or_exact_url',
    adapter_status: 'requires_configuration',
    enabled: false,
    priority: 80
  },
  {
    key: 'website',
    label: 'Company websites',
    url: 'https://www.google.com/search',
    adapter: 'enrichment_from_discovered_website',
    adapter_status: 'enrichment_only',
    enabled: false,
    priority: 90
  },
  {
    key: 'ursb',
    label: 'URSB registry',
    url: 'https://ursb.go.ug/search-ursb-registries/',
    adapter: 'hidden_contact_enrichment_only',
    adapter_status: 'enrichment_only',
    enabled: false,
    priority: 100
  }
]);

function clean(value = '') {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function googleApiKey() {
  return clean(process.env.GOOGLE_MAPS_API_KEY || process.env.PUBLIC_GOOGLE_MAPS_API_KEY);
}

function sourceEnabled(definition) {
  if (definition.key === 'google_maps') return Boolean(googleApiKey());
  const envKey = `MARKETPLACE_${definition.key.toUpperCase()}_ENABLED`;
  return definition.adapter_status === 'active' && process.env[envKey] === 'true';
}

function sourceConfigured(definition) {
  if (definition.key === 'google_maps') return Boolean(googleApiKey());
  if (definition.key === 'linkedin') {
    return Boolean(clean(process.env.LINKEDIN_ACCESS_TOKEN || process.env.LINKEDIN_CLIENT_ID));
  }
  if (definition.key === 'facebook') {
    return Boolean(clean(process.env.META_GRAPH_ACCESS_TOKEN || process.env.FACEBOOK_PAGE_IDS));
  }
  return definition.adapter_status !== 'unavailable'
    && definition.adapter_status !== 'requires_configuration';
}

function sourceDefinitions() {
  return SOURCE_DEFINITIONS.map((definition) => ({
    ...definition,
    enabled: sourceEnabled(definition),
    configured: sourceConfigured(definition)
  }));
}

function queryFor(category, district) {
  const term = category.terms?.[0] || category.label;
  return `${term} ${district} Uganda`;
}

function orderedDistricts() {
  const priority = PRIORITY_DISTRICTS.filter((district) => DISTRICTS.includes(district));
  const prioritySet = new Set(priority);
  return [...priority, ...DISTRICTS.filter((district) => !prioritySet.has(district))];
}

function registryRows() {
  const rows = [];
  let cursorOrder = 0;
  const definitions = sourceDefinitions();
  for (const district of orderedDistricts()) {
    for (const category of MARKETPLACE_CATEGORIES) {
      for (const source of definitions) {
        const queryText = queryFor(category, district);
        rows.push({
          source_key: `${source.key}:${category.key}:${district.toLowerCase()}`,
          source: source.key,
          category: category.key,
          district,
          query_text: queryText,
          source_url: source.url,
          enabled: source.enabled,
          adapter_status: source.adapter_status,
          priority: source.priority,
          cursor_order: cursorOrder,
          metadata: {
            label: source.label,
            adapter: source.adapter,
            query_url: source.key === 'google_maps'
              ? `https://www.google.com/maps/search/${encodeURIComponent(queryText)}`
              : source.url
          }
        });
      }
      cursorOrder += 1;
    }
  }
  return rows;
}

async function seedMarketplaceSourceRegistry(db) {
  const rows = registryRows();
  const chunkSize = 250;
  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize);
    const values = [];
    const params = [];
    chunk.forEach((row, rowIndex) => {
      const offset = rowIndex * 11;
      values.push(`($${offset + 1},$${offset + 2},$${offset + 3},$${offset + 4},$${offset + 5},$${offset + 6},$${offset + 7},$${offset + 8},$${offset + 9},$${offset + 10},$${offset + 11}::jsonb)`);
      params.push(
        row.source_key,
        row.source,
        row.category,
        row.district,
        row.query_text,
        row.source_url,
        row.enabled,
        row.adapter_status,
        row.priority,
        row.cursor_order,
        JSON.stringify(row.metadata)
      );
    });
    await db.query(
      `INSERT INTO marketplace_source_registry (
         source_key, source, category, district, query_text, source_url,
         enabled, adapter_status, priority, cursor_order, metadata
       ) VALUES ${values.join(',')}
       ON CONFLICT (source_key) DO UPDATE SET
         query_text = EXCLUDED.query_text,
         source_url = EXCLUDED.source_url,
         enabled = EXCLUDED.enabled,
         adapter_status = EXCLUDED.adapter_status,
         priority = EXCLUDED.priority,
         cursor_order = EXCLUDED.cursor_order,
         metadata = marketplace_source_registry.metadata || EXCLUDED.metadata,
         updated_at = NOW()`,
      params
    );
  }
  const coverage = await getRegistryCoverage(db);
  return { marker: MARKETPLACE_P2_MARKER, seeded: rows.length, ...coverage };
}

async function getRegistryCoverage(db) {
  const result = await db.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE enabled)::int AS enabled,
            COUNT(DISTINCT category)::int AS categories,
            COUNT(DISTINCT district)::int AS districts,
            jsonb_object_agg(source, source_count) AS by_source
       FROM (
         SELECT source, category, district, enabled, COUNT(*) OVER (PARTITION BY source)::int AS source_count
         FROM marketplace_source_registry
       ) registry`
  );
  const row = result.rows[0] || {};
  return {
    registry_total: Number(row.total || 0),
    enabled_queries: Number(row.enabled || 0),
    category_coverage: Number(row.categories || 0),
    district_coverage: Number(row.districts || 0),
    by_source: row.by_source || {}
  };
}

async function ensureState(db) {
  const enabledResult = await db.query('SELECT COUNT(*)::int AS count FROM marketplace_source_registry WHERE enabled = TRUE');
  const sourceCount = Number(enabledResult.rows[0]?.count || 0);
  await db.query(
    `INSERT INTO marketplace_drip_state (
       drip_key, enabled, cursor_offset, source_count, base_interval_minutes,
       batch_size, target_businesses, monthly_request_cap, monthly_request_count,
       request_month, status
     ) VALUES ($1,FALSE,0,$2,$3,$4,5000,$5,0,$6,'paused')
     ON CONFLICT (drip_key) DO UPDATE SET
       source_count = EXCLUDED.source_count,
       updated_at = NOW()`,
    [DRIP_KEY, sourceCount, DEFAULT_INTERVAL_MINUTES, DEFAULT_BATCH_SIZE, DEFAULT_MONTHLY_CAP, currentMonth()]
  );
  const result = await db.query('SELECT * FROM marketplace_drip_state WHERE drip_key = $1', [DRIP_KEY]);
  return resetMonthlyCounterIfNeeded(db, result.rows[0]);
}

async function resetMonthlyCounterIfNeeded(db, state) {
  if (!state || state.request_month === currentMonth()) return state;
  const result = await db.query(
    `UPDATE marketplace_drip_state
        SET request_month = $2, monthly_request_count = 0, updated_at = NOW()
      WHERE drip_key = $1
      RETURNING *`,
    [DRIP_KEY, currentMonth()]
  );
  return result.rows[0];
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

async function updateMarketplaceDripConfig(db, input = {}) {
  const state = await ensureState(db);
  const interval = clampInteger(input.interval_minutes ?? input.base_interval_minutes, state.base_interval_minutes, 1, 1440);
  const batchSize = clampInteger(input.batch_size, state.batch_size, 1, 25);
  const cursor = clampInteger(input.cursor_offset, state.cursor_offset, 0, Math.max(0, Number(state.source_count || 0) - 1));
  const target = clampInteger(input.target_businesses, state.target_businesses, 100, 100000);
  const cap = clampInteger(input.monthly_request_cap, state.monthly_request_cap, 1, 100000);
  const result = await db.query(
    `UPDATE marketplace_drip_state
        SET base_interval_minutes = $2,
            batch_size = $3,
            cursor_offset = $4,
            target_businesses = $5,
            monthly_request_cap = $6,
            next_run_at = CASE WHEN enabled THEN NOW() + make_interval(mins => $2::int) ELSE next_run_at END,
            updated_at = NOW()
      WHERE drip_key = $1
      RETURNING *`,
    [DRIP_KEY, interval, batchSize, cursor, target, cap]
  );
  return result.rows[0];
}

async function startMarketplaceDrip(db, input = {}) {
  await updateMarketplaceDripConfig(db, input);
  const result = await db.query(
    `UPDATE marketplace_drip_state
        SET enabled = TRUE, status = 'scheduled', pause_reason = NULL,
            next_run_at = NOW(), updated_at = NOW()
      WHERE drip_key = $1
      RETURNING *`,
    [DRIP_KEY]
  );
  return result.rows[0];
}

async function pauseMarketplaceDrip(db, reason = 'paused_by_admin') {
  const result = await db.query(
    `UPDATE marketplace_drip_state
        SET enabled = FALSE, status = 'paused', pause_reason = $2,
            next_run_at = NULL, updated_at = NOW()
      WHERE drip_key = $1
      RETURNING *`,
    [DRIP_KEY, clean(reason) || 'paused_by_admin']
  );
  return result.rows[0];
}

function placeName(place = {}) {
  return clean(place.displayName?.text || place.displayName);
}

function placeAddress(place = {}) {
  return clean(place.formattedAddress);
}

function placeIsUgandan(place = {}) {
  const country = (place.addressComponents || []).find((component) => (component.types || []).includes('country'));
  const countryText = clean(country?.shortText || country?.longText).toUpperCase();
  const latitude = Number(place.location?.latitude);
  const longitude = Number(place.location?.longitude);
  const inBounds = Number.isFinite(latitude) && Number.isFinite(longitude)
    && latitude >= -1.5 && latitude <= 4.3 && longitude >= 29.5 && longitude <= 35.1;
  return countryText === 'UG' || countryText === 'UGANDA' || inBounds;
}

function placeMatchesDistrict(place = {}, district = '') {
  const expected = clean(district).toLowerCase();
  if (!expected || !placeIsUgandan(place)) return false;
  const text = [
    placeAddress(place),
    ...(place.addressComponents || []).flatMap((component) => [component.longText, component.shortText])
  ].map(clean).join(' ').toLowerCase();
  return text.includes(expected);
}

function googleCandidate(place = {}, sourceRow = {}) {
  const name = placeName(place);
  const phone = normalizePhone(place.internationalPhoneNumber || place.nationalPhoneNumber);
  const sourceUrl = clean(place.googleMapsUri);
  const website = clean(place.websiteUri);
  const competitor = isCompetitorPortal({ name, website, source_url: sourceUrl });
  if (!name) return { accepted: false, reason: 'missing_name' };
  if (!sourceUrl || !clean(place.id)) return { accepted: false, reason: 'missing_source' };
  if (!placeMatchesDistrict(place, sourceRow.district)) return { accepted: false, reason: 'location_unresolved' };
  if (competitor) return { accepted: false, reason: 'competitor', competitor };
  if (!phone) return { accepted: false, reason: 'missing_contact' };
  return {
    accepted: true,
    name,
    category: sourceRow.category,
    district: sourceRow.district,
    area: '',
    phone,
    whatsapp: phone,
    website,
    source: 'google_maps',
    source_url: sourceUrl || sourceRow.metadata?.query_url || sourceRow.source_url,
    source_place_id: clean(place.id),
    latitude: Number(place.location?.latitude) || null,
    longitude: Number(place.location?.longitude) || null,
    formatted_address: placeAddress(place),
    description: `${MARKETPLACE_CATEGORIES.find((item) => item.key === sourceRow.category)?.label || 'Property service'} serving ${sourceRow.district}. Found online via Google Maps; confirm services and availability directly with the business.`,
    source_query: sourceRow.query_text
  };
}

async function searchGooglePlaces(sourceRow, { fetchImpl = fetch } = {}) {
  const key = googleApiKey();
  if (!key) {
    const error = new Error('Google Places API key is not configured.');
    error.code = 'provider_not_configured';
    throw error;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetchImpl(GOOGLE_SEARCH_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Referer: clean(process.env.GOOGLE_PLACES_REFERER) || DEFAULT_BASE_URL,
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': [
          'places.id', 'places.displayName', 'places.formattedAddress', 'places.addressComponents',
          'places.nationalPhoneNumber', 'places.internationalPhoneNumber', 'places.websiteUri',
          'places.googleMapsUri', 'places.location', 'places.types'
        ].join(',')
      },
      body: JSON.stringify({ textQuery: sourceRow.query_text, pageSize: 20, regionCode: 'UG' }),
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

async function upsertMarketplaceCandidate(db, candidate, sourceRow) {
  const duplicate = await db.query(
    `SELECT id
       FROM marketplace_businesses
      WHERE (source_url = $1 AND $1 <> '')
         OR (source_place_id = $2 AND $2 <> '')
         OR (phone = $3 AND $3 <> '')
         OR (LOWER(name) = LOWER($4) AND district = $5)
      ORDER BY created_at ASC
      LIMIT 1`,
    [candidate.source_url || '', candidate.source_place_id || '', candidate.phone || '', candidate.name, candidate.district]
  );
  if (duplicate.rows[0]) {
    await db.query(
      `UPDATE marketplace_businesses
          SET source_urls = ARRAY(SELECT DISTINCT unnest(source_urls || ARRAY[$2]::text[])),
              phone = COALESCE(NULLIF(phone, ''), $3),
              whatsapp = COALESCE(NULLIF(whatsapp, ''), $3),
              website = COALESCE(NULLIF(website, ''), $4),
              source_place_id = COALESCE(source_place_id, NULLIF($5, '')),
              last_refreshed = NOW(), updated_at = NOW()
        WHERE id = $1`,
      [duplicate.rows[0].id, candidate.source_url, candidate.phone, candidate.website || null, candidate.source_place_id || '']
    );
    return { action: 'existing', id: duplicate.rows[0].id };
  }
  const suffix = crypto.createHash('sha1').update(candidate.source_place_id || candidate.source_url).digest('hex').slice(0, 8);
  const slug = `${slugify(`${candidate.name}-${candidate.district}`)}-${suffix}`;
  const sourceMetadata = {
    google_place_id: candidate.source_place_id,
    formatted_address: candidate.formatted_address,
    source_query: candidate.source_query,
    source_registry_key: sourceRow.source_key,
    source_registry_id: sourceRow.id,
    seeded_at: new Date().toISOString(),
    seed: MARKETPLACE_P2_MARKER
  };
  const result = await db.query(
    `INSERT INTO marketplace_businesses (
       name, slug, category, description, services_text, district, area,
       latitude, longitude, serves_regions, phone, whatsapp, website,
       tier, status, source_type, source, source_url, source_urls,
       source_place_id, source_metadata
     ) VALUES (
       $1,$2,$3,$4,$4,$5,$6,$7,$8,ARRAY[$5]::text[],$9,$9,$10,
       'found_online','live','found_online',$11,$12,ARRAY[$12]::text[],$13,$14::jsonb
     ) RETURNING id`,
    [
      candidate.name, slug, candidate.category, candidate.description, candidate.district,
      candidate.area || null, candidate.latitude, candidate.longitude, candidate.phone,
      candidate.website || null, candidate.source, candidate.source_url,
      candidate.source_place_id || null, JSON.stringify(sourceMetadata)
    ]
  );
  await db.query(
    `INSERT INTO marketplace_events (business_id, event_type, metadata)
     VALUES ($1,'business_seeded',$2::jsonb)`,
    [result.rows[0].id, JSON.stringify({ source: candidate.source, category: candidate.category, district: candidate.district, marker: MARKETPLACE_P2_MARKER })]
  );
  return { action: 'inserted', id: result.rows[0].id };
}

async function importMarketplaceSourceCandidates(db, rows = [], { actorId = 'marketplace_source_import' } = {}) {
  const summary = { received: Array.isArray(rows) ? rows.length : 0, inserted: 0, existing: 0, hidden_enrichment: 0, rejected: 0, reasons: {} };
  for (const input of (Array.isArray(rows) ? rows : []).slice(0, 500)) {
    const source = clean(input.source).toLowerCase();
    const sourceDefinition = SOURCE_DEFINITIONS.find((item) => item.key === source);
    const name = clean(input.name);
    const category = normalizeCategory(input.category);
    const district = clean(input.district);
    const phone = normalizePhone(input.phone || input.whatsapp);
    const whatsapp = normalizePhone(input.whatsapp || input.phone);
    const website = clean(input.website);
    const sourceUrl = clean(input.source_url);
    const socialLinks = input.social_links && typeof input.social_links === 'object' ? input.social_links : {};
    const hasSocial = Object.values(socialLinks).some((value) => /^https?:\/\//i.test(clean(value)));
    const hasContact = Boolean(phone || whatsapp || hasSocial);
    let reason = '';
    if (!sourceDefinition) reason = 'unsupported_source';
    else if (!name || !category || !DISTRICTS.includes(district)) reason = 'invalid_required_fields';
    else if (!/^https?:\/\//i.test(sourceUrl)) reason = 'missing_exact_source_url';
    else if (isCompetitorPortal({ name, website, source_url: sourceUrl, social_links: socialLinks })) reason = 'competitor';
    else if (!hasContact && source !== 'ursb') reason = 'missing_contact';
    if (reason) {
      summary.rejected += 1;
      increment(summary.reasons, reason);
      continue;
    }
    const duplicate = await db.query(
      `SELECT id FROM marketplace_businesses
        WHERE source_url = $1
           OR (($2 <> '') AND phone = $2)
           OR (LOWER(name) = LOWER($3) AND district = $4)
        ORDER BY created_at ASC LIMIT 1`,
      [sourceUrl, phone, name, district]
    );
    if (duplicate.rows[0]) {
      await db.query(
        `UPDATE marketplace_businesses
            SET source_urls = ARRAY(SELECT DISTINCT unnest(source_urls || ARRAY[$2]::text[])),
                last_refreshed = NOW(), updated_at = NOW()
          WHERE id = $1`,
        [duplicate.rows[0].id, sourceUrl]
      );
      summary.existing += 1;
      continue;
    }
    const hidden = !hasContact;
    const suffix = crypto.createHash('sha1').update(sourceUrl).digest('hex').slice(0, 8);
    const inserted = await db.query(
      `INSERT INTO marketplace_businesses (
         name, slug, category, description, services_text, district, area,
         serves_regions, phone, whatsapp, website, social_links,
         tier, status, source_type, source, source_url, source_urls, source_metadata
       ) VALUES ($1,$2,$3,$4,$4,$5,$6,ARRAY[$5]::text[],$7,$8,$9,$10::jsonb,
         'found_online',$11,'found_online',$12,$13,ARRAY[$13]::text[],$14::jsonb)
       RETURNING id`,
      [
        name,
        `${slugify(`${name}-${district}`)}-${suffix}`,
        category,
        clean(input.description) || `${MARKETPLACE_CATEGORIES.find((item) => item.key === category)?.label || 'Property service'} in ${district}. Confirm services and availability directly with the business.`,
        district,
        clean(input.area) || null,
        phone || '',
        whatsapp || phone || '',
        /^https?:\/\//i.test(website) ? website : null,
        JSON.stringify(socialLinks),
        hidden ? 'hidden' : 'live',
        source,
        sourceUrl,
        JSON.stringify({ marker: MARKETPLACE_P2_MARKER, enrichment_pending: hidden, imported_by: actorId, imported_at: new Date().toISOString() })
      ]
    );
    await db.query(
      `INSERT INTO marketplace_events (business_id, event_type, metadata)
       VALUES ($1,$2,$3::jsonb)`,
      [inserted.rows[0].id, hidden ? 'business_enrichment_pending' : 'business_seeded', JSON.stringify({ source, marker: MARKETPLACE_P2_MARKER, actor_id: actorId })]
    );
    if (hidden) summary.hidden_enrichment += 1;
    else summary.inserted += 1;
  }
  if (summary.inserted) invalidateMarketplaceStats();
  return { marker: MARKETPLACE_P2_MARKER, ...summary };
}

function emptyRunSummary(state) {
  return {
    marker: MARKETPLACE_P2_MARKER,
    source_offset: Number(state.cursor_offset || 0),
    next_source_offset: Number(state.cursor_offset || 0),
    batch_size: Number(state.batch_size || 0),
    requests: 0,
    fetched: 0,
    accepted: 0,
    inserted: 0,
    existing: 0,
    hidden_enrichment: 0,
    rejected_missing_contact: 0,
    rejected_location: 0,
    rejected_competitor: 0,
    rejected_source: 0,
    errors: 0,
    source_counts: {},
    category_counts: {},
    district_counts: {}
  };
}

function increment(map, key, amount = 1) {
  map[key] = Number(map[key] || 0) + amount;
}

async function selectSourceBatch(db, state) {
  const sourceCount = Number(state.source_count || 0);
  if (!sourceCount) return [];
  const offset = Math.min(Number(state.cursor_offset || 0), Math.max(0, sourceCount - 1));
  const result = await db.query(
    `WITH ordered AS (
       SELECT *, ROW_NUMBER() OVER (ORDER BY priority ASC, cursor_order ASC, source_key ASC) - 1 AS row_offset
       FROM marketplace_source_registry
       WHERE enabled = TRUE
     )
     SELECT * FROM ordered
      WHERE row_offset >= $1
      ORDER BY row_offset ASC
      LIMIT $2`,
    [offset, Number(state.batch_size || DEFAULT_BATCH_SIZE)]
  );
  if (result.rows.length || offset === 0) return result.rows;
  const wrapped = await db.query(
    `SELECT * FROM marketplace_source_registry
      WHERE enabled = TRUE
      ORDER BY priority ASC, cursor_order ASC, source_key ASC
      LIMIT $1`,
    [Number(state.batch_size || DEFAULT_BATCH_SIZE)]
  );
  return wrapped.rows;
}

async function writeRunLog(db, summary, status, elapsedMs) {
  await db.query(
    `INSERT INTO marketplace_drip_run_logs (
       drip_key, source_offset, next_source_offset, batch_size, requests, fetched,
       accepted, inserted, existing, hidden_enrichment, rejected_missing_contact,
       rejected_location, rejected_competitor, rejected_source, errors, status, elapsed_ms,
       source_counts, category_counts, district_counts, result_summary
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19::jsonb,$20::jsonb,$21::jsonb)`,
    [
      DRIP_KEY, summary.source_offset, summary.next_source_offset, summary.batch_size,
      summary.requests, summary.fetched, summary.accepted, summary.inserted,
      summary.existing, summary.hidden_enrichment, summary.rejected_missing_contact,
      summary.rejected_location, summary.rejected_competitor, summary.rejected_source, summary.errors,
      status, elapsedMs, JSON.stringify(summary.source_counts),
      JSON.stringify(summary.category_counts), JSON.stringify(summary.district_counts),
      JSON.stringify(summary)
    ]
  );
}

async function runMarketplaceDripOnce(db, { force = false, actorId = 'marketplace_drip' } = {}) {
  const started = Date.now();
  let state = await ensureState(db);
  if (!force && !state.enabled) return { ok: true, skipped: true, reason: 'paused' };
  if (!force && state.next_run_at && new Date(state.next_run_at).getTime() > Date.now()) {
    return { ok: true, skipped: true, reason: 'not_due' };
  }
  if (Number(state.monthly_request_count || 0) >= Number(state.monthly_request_cap || 0)) {
    await pauseMarketplaceDrip(db, 'monthly_request_cap_reached');
    return { ok: true, skipped: true, reason: 'monthly_request_cap_reached' };
  }
  await db.query(`UPDATE marketplace_drip_state SET status = 'running', last_run_at = NOW(), updated_at = NOW() WHERE drip_key = $1`, [DRIP_KEY]);
  const summary = emptyRunSummary(state);
  const batch = await selectSourceBatch(db, state);
  let blockedReason = '';
  for (const sourceRow of batch) {
    if (summary.requests + Number(state.monthly_request_count || 0) >= Number(state.monthly_request_cap || 0)) {
      blockedReason = 'monthly_request_cap_reached';
      break;
    }
    summary.requests += 1;
    increment(summary.source_counts, sourceRow.source);
    try {
      if (sourceRow.source !== 'google_maps') {
        summary.errors += 1;
        await db.query(
          `UPDATE marketplace_source_registry SET last_run_at = NOW(), last_status = 'adapter_unavailable', last_error = $2 WHERE id = $1`,
          [sourceRow.id, `No active adapter for ${sourceRow.source}`]
        );
        continue;
      }
      const places = await searchGooglePlaces(sourceRow);
      summary.fetched += places.length;
      for (const place of places) {
        const candidate = googleCandidate(place, sourceRow);
        if (!candidate.accepted) {
          if (candidate.reason === 'missing_contact') summary.rejected_missing_contact += 1;
          else if (candidate.reason === 'location_unresolved') summary.rejected_location += 1;
          else if (candidate.reason === 'competitor') summary.rejected_competitor += 1;
          else if (candidate.reason === 'missing_source') summary.rejected_source += 1;
          continue;
        }
        summary.accepted += 1;
        const result = await upsertMarketplaceCandidate(db, candidate, sourceRow);
        summary[result.action] += 1;
        increment(summary.category_counts, candidate.category);
        increment(summary.district_counts, candidate.district);
      }
      await db.query(
        `UPDATE marketplace_source_registry
            SET last_run_at = NOW(), last_success_at = NOW(), last_status = 'completed', last_error = NULL
          WHERE id = $1`,
        [sourceRow.id]
      );
    } catch (error) {
      summary.errors += 1;
      const status = Number(error.status || 0);
      await db.query(
        `UPDATE marketplace_source_registry SET last_run_at = NOW(), last_status = 'error', last_error = $2 WHERE id = $1`,
        [sourceRow.id, clean(error.message).slice(0, 500)]
      );
      if ([401, 402, 403].includes(status) || error.code === 'provider_not_configured') {
        blockedReason = status === 402 ? 'provider_billing_required' : 'provider_auth_or_config_error';
        break;
      }
      if (status === 429) {
        blockedReason = 'provider_rate_limited';
        break;
      }
    }
    await delay(Math.max(100, Number(process.env.MARKETPLACE_DRIP_REQUEST_DELAY_MS || 250)));
  }
  const sourceCount = Number(state.source_count || 0);
  summary.next_source_offset = sourceCount ? (summary.source_offset + summary.requests) % sourceCount : 0;
  summary.actor_id = actorId;
  summary.elapsed_ms = Date.now() - started;
  const status = blockedReason ? 'blocked' : (summary.requests < Number(state.batch_size || 0) ? 'partial' : 'completed');
  summary.status = status;
  summary.pause_reason = blockedReason || null;
  await writeRunLog(db, summary, status, summary.elapsed_ms);
  const shouldPause = Boolean(blockedReason && blockedReason !== 'provider_rate_limited');
  const nextInterval = blockedReason === 'provider_rate_limited'
    ? Math.min(1440, Number(state.base_interval_minutes || DEFAULT_INTERVAL_MINUTES) * 2)
    : Number(state.base_interval_minutes || DEFAULT_INTERVAL_MINUTES);
  await db.query(
    `UPDATE marketplace_drip_state
        SET enabled = CASE WHEN $7 THEN FALSE ELSE enabled END,
            cursor_offset = $2,
            monthly_request_count = monthly_request_count + $3,
            status = $4,
            pause_reason = $5,
            next_run_at = CASE WHEN $7 THEN NULL ELSE NOW() + ($6 || ' minutes')::interval END,
            last_result = $8::jsonb,
            updated_at = NOW()
      WHERE drip_key = $1`,
    [DRIP_KEY, summary.next_source_offset, summary.requests, status, blockedReason || null, nextInterval, shouldPause, JSON.stringify(summary)]
  );
  if (summary.inserted) invalidateMarketplaceStats();
  return { ok: true, skipped: false, result: summary };
}

async function getMarketplaceDripStatus(db) {
  const state = await ensureState(db);
  const [runs, inventory, coverage, publicCoverage] = await Promise.all([
    db.query(`SELECT * FROM marketplace_drip_run_logs WHERE drip_key = $1 ORDER BY created_at DESC LIMIT 20`, [DRIP_KEY]),
    getMarketplaceStats(db, { force: true }),
    getRegistryCoverage(db),
    db.query(
      `SELECT COUNT(DISTINCT category)::int AS categories,
              COUNT(DISTINCT district)::int AS districts,
              COUNT(*) FILTER (WHERE source_type = 'found_online')::int AS found_online,
              COUNT(*) FILTER (WHERE source_type = 'found_online' AND (phone IS NULL OR phone = '') AND (whatsapp IS NULL OR whatsapp = '') AND COALESCE(social_links, '{}'::jsonb) = '{}'::jsonb)::int AS contactless_public
         FROM marketplace_businesses
        WHERE status = 'live'`
    )
  ]);
  const publicRow = publicCoverage.rows[0] || {};
  return {
    marker: MARKETPLACE_P2_MARKER,
    state: {
      ...state,
      monthly_request_remaining: Math.max(0, Number(state.monthly_request_cap || 0) - Number(state.monthly_request_count || 0)),
      percent_crawled: Number(state.source_count || 0)
        ? Number(((Number(state.cursor_offset || 0) / Number(state.source_count)) * 100).toFixed(2))
        : 0
    },
    scheduler: schedulerStatus(),
    sources: sourceDefinitions(),
    registry: coverage,
    inventory: {
      total: inventory.total,
      target: Number(state.target_businesses || 5000),
      by_category: inventory.by_category,
      distinct_categories: Number(publicRow.categories || 0),
      distinct_districts: Number(publicRow.districts || 0),
      found_online: Number(publicRow.found_online || 0),
      contactless_public: Number(publicRow.contactless_public || 0)
    },
    recent_runs: runs.rows
  };
}

function schedulerDisabledByEnv() {
  return process.env.MARKETPLACE_DRIP_SCHEDULER_ENABLED !== 'true';
}

function schedulerStatus() {
  return {
    armed: Boolean(schedulerTimer),
    disabled_by_env: schedulerDisabledByEnv(),
    running: schedulerRunning,
    armed_at: schedulerArmedAt,
    last_tick_at: schedulerLastTickAt,
    last_result: schedulerLastResult
  };
}

async function tickMarketplaceDripScheduler(db) {
  if (schedulerRunning) return { skipped: true, reason: 'already_running' };
  schedulerRunning = true;
  schedulerLastTickAt = new Date().toISOString();
  try {
    schedulerLastResult = await runMarketplaceDripOnce(db, { force: false, actorId: 'marketplace_drip_scheduler' });
    return schedulerLastResult;
  } catch (error) {
    schedulerLastResult = { ok: false, error: error.message };
    logger.warn('Marketplace national drip scheduler tick failed', { error: error.message });
    return schedulerLastResult;
  } finally {
    schedulerRunning = false;
  }
}

function startMarketplaceDripScheduler(db) {
  if (schedulerTimer || schedulerDisabledByEnv()) return;
  schedulerArmedAt = new Date().toISOString();
  schedulerTimer = setInterval(() => tickMarketplaceDripScheduler(db), SCHEDULER_POLL_MS);
  schedulerTimer.unref?.();
  setTimeout(() => tickMarketplaceDripScheduler(db), 5000).unref?.();
  logger.info('Marketplace national drip scheduler armed', { poll_ms: SCHEDULER_POLL_MS });
}

module.exports = {
  DRIP_KEY,
  MARKETPLACE_P2_MARKER,
  PRIORITY_DISTRICTS,
  SOURCE_DEFINITIONS,
  googleCandidate,
  getMarketplaceDripStatus,
  getRegistryCoverage,
  importMarketplaceSourceCandidates,
  pauseMarketplaceDrip,
  registryRows,
  runMarketplaceDripOnce,
  searchGooglePlaces,
  seedMarketplaceSourceRegistry,
  sourceDefinitions,
  startMarketplaceDrip,
  startMarketplaceDripScheduler,
  tickMarketplaceDripScheduler,
  updateMarketplaceDripConfig,
  upsertMarketplaceCandidate
};
