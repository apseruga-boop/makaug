'use strict';

const crypto = require('crypto');
const country = require('../config/countries/southAfrica');
const { canonicalLocationOptions } = require('../utils/southAfricaLocationRegistry');

const SOUTH_AFRICA_SCALE_BATCH_ID = 'seshaikhaya-scale-v3-compliant-pivot-20260812';
const TARGET_CITY_COUNT = 60;
const TARGET_SUBURB_COUNT = 500;

const AGENCY_BRANDS = Object.freeze([
  'Pam Golding', 'Seeff', 'RE/MAX SA', 'Engel & Völkers', 'Rawson',
  'Chas Everitt', 'Just Property', 'Harcourts', 'Century 21', 'Leapfrog',
  'Tyson', 'Dogon', 'Greeff', 'Jawitz', "Lew Geffen Sotheby's", 'Only Realty',
  'Firzt', 'Aida'
]);

const SEARCH_LANGUAGE_MATRIX = Object.freeze({
  en: Object.freeze({
    types: Object.freeze({ house: 'house', apartment: 'apartment', land: 'land', commercial: 'commercial property', student: 'student accommodation' }),
    intents: Object.freeze({ sale: 'for sale', rent: 'to rent' }),
  }),
  af: Object.freeze({
    types: Object.freeze({ house: 'huis', apartment: 'woonstel', land: 'grond', commercial: 'kommersiële eiendom', student: 'studenteverblyf' }),
    intents: Object.freeze({ sale: 'te koop', rent: 'te huur' }),
  }),
  zu: Object.freeze({
    types: Object.freeze({ house: 'indlu', apartment: 'ifulethi', land: 'umhlaba', commercial: 'impahla yebhizinisi', student: 'indawo yokuhlala yabafundi' }),
    intents: Object.freeze({ sale: 'iyathengiswa', rent: 'iyaqashiswa' }),
  }),
  xh: Object.freeze({
    types: Object.freeze({ house: 'indlu', apartment: 'iflethi', land: 'umhlaba', commercial: 'ipropati yorhwebo', student: 'indawo yokuhlala yabafundi' }),
    intents: Object.freeze({ sale: 'iyathengiswa', rent: 'iyaqeshwa' }),
  }),
});

const PRIVATE_SELLER_PHRASES = Object.freeze({
  en: Object.freeze([
    'selling my house', 'no agents', 'no estate agents', 'private sale',
    'owner selling', 'direct from owner', 'no commission', 'cash buyers only',
    'urgent sale', 'relocating, must sell', 'deceased estate', 'divorce sale',
    'repossessed', 'bank repossessed',
  ]),
  af: Object.freeze([
    'privaat verkoop', 'geen agente', 'huis te koop deur eienaar',
    'dringend te koop', 'geen kommissie',
  ]),
  zu: Object.freeze(['indlu iyathengiswa']),
  xh: Object.freeze(['ndithengisa indlu yam']),
});

const PRIVATE_SELLER_HASHTAGS = Object.freeze([
  '#nocommission', '#privatesale', '#sellingmyhouse', '#fsbo', '#huisTeKoop',
]);

const FACEBOOK_GROUP_PATTERNS = Object.freeze([
  'Property for sale in {location}',
  'Houses for sale {location}',
  'Huise te koop {location}',
  '{location} property eiendom',
  '{location} rentals huur',
  'Smallholdings plase te koop {location}',
  'Plot and plan {location}',
  '{location} township community property',
]);

function locationIdentity(row = {}) {
  return `${row.province || ''}|${row.city || row.name || ''}`.toLowerCase();
}

function roundRobin(groups, total) {
  const queues = groups.map((rows) => [...rows]);
  const selected = [];
  while (selected.length < total && queues.some((rows) => rows.length)) {
    for (const rows of queues) {
      if (!rows.length || selected.length >= total) continue;
      selected.push(rows.shift());
    }
  }
  return selected;
}

function selectScaleLocations({ cityCount = TARGET_CITY_COUNT, suburbCount = TARGET_SUBURB_COUNT } = {}) {
  const locations = canonicalLocationOptions();
  const provinces = locations.filter((row) => row.level === 'province');
  const cities = locations.filter((row) => row.level === 'city');
  const suburbs = locations.filter((row) => row.level === 'suburb');
  const suburbCounts = suburbs.reduce((counts, row) => {
    const key = locationIdentity(row);
    counts.set(key, (counts.get(key) || 0) + 1);
    return counts;
  }, new Map());
  const cityGroups = provinces.map((province) => cities
    .filter((row) => row.province === province.province)
    .sort((a, b) => (suburbCounts.get(locationIdentity(b)) || 0) - (suburbCounts.get(locationIdentity(a)) || 0)
      || a.name.localeCompare(b.name)));
  const selectedCities = roundRobin(cityGroups, cityCount);
  const cityRanks = new Map(selectedCities.map((row, index) => [locationIdentity(row), index]));
  const suburbGroups = provinces.map((province) => suburbs
    .filter((row) => row.province === province.province)
    .sort((a, b) => {
      const aRank = cityRanks.has(locationIdentity(a)) ? cityRanks.get(locationIdentity(a)) : Number.MAX_SAFE_INTEGER;
      const bRank = cityRanks.has(locationIdentity(b)) ? cityRanks.get(locationIdentity(b)) : Number.MAX_SAFE_INTEGER;
      return aRank - bRank || a.city.localeCompare(b.city) || a.name.localeCompare(b.name);
    }));
  const selectedSuburbs = roundRobin(suburbGroups, suburbCount);
  return { provinces, cities: selectedCities, suburbs: selectedSuburbs };
}

function buildSouthAfricaSearchCorpus(options = {}) {
  const selected = selectScaleLocations(options);
  const locations = [...selected.provinces, ...selected.cities, ...selected.suburbs];
  const corpus = [];
  for (const [locationIndex, location] of locations.entries()) {
    const locationLabel = location.level === 'province'
      ? location.province
      : `${location.name}, ${location.province}`;
    for (const [language, dictionary] of Object.entries(SEARCH_LANGUAGE_MATRIX)) {
      for (const [typeIndex, [propertyType, typePhrase]] of Object.entries(dictionary.types).entries()) {
        for (const [intentIndex, [intent, intentPhrase]] of Object.entries(dictionary.intents).entries()) {
          const sellerPhrases = PRIVATE_SELLER_PHRASES[language];
          const sellerPhrase = sellerPhrases[(locationIndex + typeIndex + intentIndex) % sellerPhrases.length];
          corpus.push({
            query: `${typePhrase} ${intentPhrase} ${locationLabel}`,
            track: 'agent', language, property_type: propertyType, intent,
            canonical_location_id: location.key, location_level: location.level,
            location: location.name, city: location.city || '', province: location.province,
          });
          corpus.push({
            query: `${sellerPhrase} ${typePhrase} ${intentPhrase} ${locationLabel}`,
            track: 'fsbo', language, property_type: propertyType, intent,
            canonical_location_id: location.key, location_level: location.level,
            location: location.name, city: location.city || '', province: location.province,
          });
        }
      }
    }
    for (const hashtag of PRIVATE_SELLER_HASHTAGS) {
      corpus.push({
        query: `${hashtag} ${locationLabel}`,
        track: 'fsbo', language: 'multilingual', property_type: 'any', intent: 'sale_or_rent',
        canonical_location_id: location.key, location_level: location.level,
        location: location.name, city: location.city || '', province: location.province,
      });
    }
  }
  return { selected, corpus };
}

function compactKey(value = '') {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 28);
}

function platformSearchUrl(platform, query) {
  const encoded = encodeURIComponent(query);
  const urls = {
    youtube: `https://www.youtube.com/results?search_query=${encoded}`,
    x: `https://x.com/search?q=${encoded}&src=typed_query&f=live`,
  };
  return urls[platform] || '';
}

function registryRow({ platform, query, track, sourceType, province = '', languages = [], listingTypes = [], metadata = {} }) {
  return {
    source_key: `za-${platform}-${sourceType}-${compactKey(`${track}|${query}|${metadata.canonical_location_id || province}`)}`,
    source_name: query,
    platform,
    source_type: sourceType,
    source_url: platformSearchUrl(platform, query),
    handle: null,
    contact_phone: null,
    contact_phone_alt: null,
    contact_email: null,
    website_url: null,
    districts: province ? [province] : [],
    listing_types: listingTypes,
    languages,
    hashtags: [],
    status: 'candidate',
    trust_level: 'review_needed',
    consent_status: 'public_source_review_needed',
    scrape_policy: 'manual_review_only',
    can_contact_directly: false,
    first_seen_at: new Date('2026-08-12T00:00:00.000Z'),
    last_seen_at: null,
    last_checked_at: null,
    notes: 'Discovery registry only. Verify the public account/group and platform terms before subscription. Review-only; never auto-publish.',
    metadata: {
      country_code: 'ZA',
      launch_batch: SOUTH_AFRICA_SCALE_BATCH_ID,
      source_track: track,
      search_query: query,
      lookback_days: country.lookbackDays,
      auto_publish: false,
      rights_policy: 'retain source URL; do not rehost third-party media without permission',
      ...metadata,
    },
  };
}

function *iterateSouthAfricaRegistryRows({ includeCorpus = false, platforms = country.automatedSourceChannels } = {}) {
  const { selected, corpus } = buildSouthAfricaSearchCorpus();
  if (includeCorpus) {
    for (const item of corpus) {
      for (const platform of platforms) {
        yield registryRow({
          platform,
          query: item.query,
          track: item.track,
          sourceType: 'gazetteer_search_query',
          province: item.province,
          languages: [item.language],
          listingTypes: [item.property_type],
          metadata: item,
        });
      }
    }
  }
  const branchLocations = selected.cities;
  for (const agency of AGENCY_BRANDS) {
    for (const location of branchLocations) {
      const query = `${agency} ${location.name} branch agents property`;
      for (const platform of platforms) {
        yield registryRow({
          platform, query, track: 'agent', sourceType: 'agency_branch_discovery', province: location.province,
          languages: ['en'], listingTypes: ['sale', 'rent', 'land', 'commercial', 'student'],
          metadata: { agency_brand: agency, canonical_location_id: location.key, location_level: location.level },
        });
      }
    }
  }
}

function buildSouthAfricaFacebookMarketingPlan() {
  const { selected } = buildSouthAfricaSearchCorpus();
  const locations = [...selected.provinces, ...selected.cities, ...selected.suburbs];
  return locations.flatMap((location) => FACEBOOK_GROUP_PATTERNS.map((pattern) => ({
    channel: 'facebook_groups',
    action: 'manual_group_marketing_after_arthur_approval',
    harvest: false,
    query: pattern.replace('{location}', location.name),
    province: location.province,
    canonical_location_id: location.key,
    location_level: location.level,
    message_theme: 'List your home free on seshaikhaya — no agent, no commission',
  })));
}

function summarizeSouthAfricaScaleCorpus() {
  const { selected, corpus } = buildSouthAfricaSearchCorpus();
  const registryFoundationCount = Array.from(iterateSouthAfricaRegistryRows({ includeCorpus: false })).length;
  const facebookMarketingPlanCount = buildSouthAfricaFacebookMarketingPlan().length;
  return {
    batch_id: SOUTH_AFRICA_SCALE_BATCH_ID,
    lookback_days: country.lookbackDays,
    platforms: [...country.automatedSourceChannels],
    automated_platforms: [...country.automatedSourceChannels],
    curated_platforms: [...country.curatedSourceChannels],
    marketing_only_platforms: [...country.marketingSourceChannels],
    excluded_automated_platforms: [...country.excludedAutomatedChannels],
    provinces: selected.provinces.length,
    cities: selected.cities.length,
    suburbs: selected.suburbs.length,
    corpus_queries: corpus.length,
    platform_query_jobs: corpus.length * country.automatedSourceChannels.length,
    registry_foundation_rows: registryFoundationCount,
    facebook_group_marketing_queries: facebookMarketingPlanCount,
    facebook_marketplace_harvest_jobs: 0,
    tiktok_broad_search_jobs: 0,
    agency_brands: AGENCY_BRANDS.length,
    tracks: ['agent', 'fsbo'],
    languages: Object.keys(SEARCH_LANGUAGE_MATRIX),
    auto_publish: false,
  };
}

module.exports = {
  AGENCY_BRANDS,
  FACEBOOK_GROUP_PATTERNS,
  PRIVATE_SELLER_HASHTAGS,
  PRIVATE_SELLER_PHRASES,
  SEARCH_LANGUAGE_MATRIX,
  SOUTH_AFRICA_SCALE_BATCH_ID,
  TARGET_CITY_COUNT,
  TARGET_SUBURB_COUNT,
  buildSouthAfricaSearchCorpus,
  buildSouthAfricaFacebookMarketingPlan,
  iterateSouthAfricaRegistryRows,
  selectScaleLocations,
  summarizeSouthAfricaScaleCorpus,
};
