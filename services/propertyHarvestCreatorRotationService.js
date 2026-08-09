'use strict';

const {
  PROPERTY_SOURCE_REGISTRY_BATCH_ID,
  getPropertySourceRegistry,
} = require('./propertySourceRegistryService');

const KING_HARVEST_ROUTE_CONTRACT_MARKER = 'king-harvester-route-contract-20260809';
const KING_TIKTOK_HARVEST_E2E_MARKER = 'king-tiktok-harvester-e2e-20260809';
const SUPPORTED_CREATOR_PLATFORMS = new Set(['tiktok', 'facebook', 'instagram']);

// These are reviewed public Uganda property profiles, not discovery/tag pages.
// Keep this list deliberately small and evidence-backed: exact post discovery is
// still completed by a signed-in human and every imported post remains in review.
const CURATED_TIKTOK_CREATOR_PROFILES = Object.freeze([
  {
    source_key: 'tiktok-wamala-property-services-profile',
    display_name: 'Wamala Property Services',
    profile_url: 'https://www.tiktok.com/@wamalapropertyservices',
    verification: 'tiktok_oembed_author_url',
  },
  {
    source_key: 'tiktok-carnelian-properties-uganda-profile',
    display_name: 'Carnelian Properties Uganda',
    profile_url: 'https://www.tiktok.com/@carnelian.propert',
    verification: 'vetted_source_profile',
  },
  {
    source_key: 'tiktok-realtor-mahad-profile',
    display_name: 'Realtor Mahad',
    profile_url: 'https://www.tiktok.com/@realtor_mahad',
    verification: 'vetted_source_profile',
  },
  {
    source_key: 'tiktok-isieh-builds-palukere-profile',
    display_name: 'Isieh Builds / Palukere Uganda',
    profile_url: 'https://www.tiktok.com/@isiehbuilds24',
    verification: 'vetted_source_profile',
  },
  {
    source_key: 'tiktok-robs-properties-travels-profile',
    display_name: "Rob's Properties & Travels",
    profile_url: 'https://www.tiktok.com/@robpropertiestravel',
    verification: 'vetted_source_profile',
  },
  {
    source_key: 'tiktok-knight-frank-uganda-profile',
    display_name: 'Knight Frank Uganda',
    profile_url: 'https://www.tiktok.com/@knightfrankuganda',
    verification: 'vetted_source_profile',
  },
]);

function cleanText(value = '', maxLength = 500) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function normalizeCreatorPlatform(value = 'tiktok') {
  const platform = cleanText(value || 'tiktok', 40).toLowerCase();
  return SUPPORTED_CREATOR_PLATFORMS.has(platform) ? platform : 'tiktok';
}

function registryCreators(platform = 'tiktok', limit = 250) {
  const normalizedPlatform = normalizeCreatorPlatform(platform);
  if (normalizedPlatform === 'tiktok') {
    return CURATED_TIKTOK_CREATOR_PROFILES
      .slice(0, Math.min(CURATED_TIKTOK_CREATOR_PROFILES.length, Math.max(1, Number(limit) || 250)))
      .map((creator) => ({
        ...creator,
        metadata: {
          registry_batch: PROPERTY_SOURCE_REGISTRY_BATCH_ID,
          rotation_kind: 'creator_profile',
          review_only: true,
          verification: creator.verification,
        },
      }));
  }
  const creators = [];
  const seenSourceKeys = new Set();
  for (const source of getPropertySourceRegistry()) {
    if (cleanText(source.platform).toLowerCase() !== normalizedPlatform) continue;
    const profileUrl = cleanText(source.url || source.source_url, 2000);
    const sourceKey = cleanText(source.key || source.source_key || source.handle || source.name, 500);
    if (!profileUrl || !sourceKey || seenSourceKeys.has(sourceKey)) continue;
    seenSourceKeys.add(sourceKey);
    creators.push({
      source_key: sourceKey,
      display_name: cleanText(source.name || source.source_name || source.handle || 'Tracked source', 500),
      profile_url: profileUrl,
      metadata: {
        registry_batch: PROPERTY_SOURCE_REGISTRY_BATCH_ID,
        rotation_kind: 'creator_profile',
        review_only: true,
      },
    });
    if (creators.length >= limit) break;
  }
  return creators;
}

async function databaseCreatorProfiles(db, { platform = 'tiktok', limit = 250 } = {}) {
  const normalizedPlatform = normalizeCreatorPlatform(platform);
  if (normalizedPlatform !== 'tiktok') return [];
  const safeLimit = Math.min(250, Math.max(1, Number(limit) || 250));
  const result = await db.query(
    `SELECT source_key,
            source_name AS display_name,
            source_url AS profile_url,
            status,
            trust_level,
            consent_status
     FROM property_source_registry
     WHERE platform = 'tiktok'
       AND source_url ~* '^https://(www\\.)?tiktok\\.com/@[A-Za-z0-9._-]+/?([?#].*)?$'
       AND COALESCE(metadata->>'source_record_kind', '') <> 'discovery_feed'
     ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END,
              last_seen_at DESC NULLS LAST,
              source_key ASC
     LIMIT $1`,
    [safeLimit]
  );
  return result.rows.map((creator) => ({
    source_key: cleanText(creator.source_key, 500),
    display_name: cleanText(creator.display_name || creator.source_key, 500),
    profile_url: cleanText(creator.profile_url, 2000).replace(/[/?#]+$/, ''),
    metadata: {
      registry_batch: PROPERTY_SOURCE_REGISTRY_BATCH_ID,
      rotation_kind: 'creator_profile',
      review_only: true,
      verification: 'production_source_registry',
      registry_status: cleanText(creator.status, 100),
      trust_level: cleanText(creator.trust_level, 100),
      consent_status: cleanText(creator.consent_status, 100),
    },
  })).filter((creator) => creator.source_key && creator.profile_url);
}

async function seedHarvestCreators(db, { platform = 'tiktok', limit = 250 } = {}) {
  const normalizedPlatform = normalizeCreatorPlatform(platform);
  const safeLimit = Math.min(250, Math.max(1, Number(limit) || 250));
  const fallbackCreators = registryCreators(normalizedPlatform, safeLimit);
  const databaseCreators = normalizedPlatform === 'tiktok'
    ? await databaseCreatorProfiles(db, { platform: normalizedPlatform, limit: safeLimit })
    : [];
  const creators = [...databaseCreators, ...fallbackCreators]
    .reduce((map, creator) => {
      if (!map.has(creator.source_key)) map.set(creator.source_key, creator);
      return map;
    }, new Map());
  const creatorRows = [...creators.values()].slice(0, safeLimit);
  if (!creatorRows.length) return { platform: normalizedPlatform, seeded_count: 0 };
  await db.query(
    `INSERT INTO property_harvest_channels (
       platform, source_key, display_name, profile_url, subscription_status, metadata
     )
     SELECT $1, seed.source_key, seed.display_name, seed.profile_url,
            'assisted_rotation', seed.metadata
     FROM jsonb_to_recordset($2::jsonb) AS seed(
       source_key text, display_name text, profile_url text, metadata jsonb
     )
     ON CONFLICT (platform, source_key) DO UPDATE
       SET display_name = EXCLUDED.display_name,
           profile_url = EXCLUDED.profile_url,
           subscription_status = EXCLUDED.subscription_status,
           metadata = property_harvest_channels.metadata || EXCLUDED.metadata,
           updated_at = NOW()`,
    [normalizedPlatform, JSON.stringify(creatorRows)]
  );
  return {
    platform: normalizedPlatform,
    seeded_count: creatorRows.length,
    database_creator_count: databaseCreators.length,
    fallback_creator_count: fallbackCreators.length,
  };
}

async function listHarvestCreators(db, { platform = 'tiktok', limit = 100 } = {}) {
  const normalizedPlatform = normalizeCreatorPlatform(platform);
  const safeLimit = Math.min(250, Math.max(1, Number(limit) || 100));
  const seed = await seedHarvestCreators(db, { platform: normalizedPlatform });
  const result = await db.query(
    `SELECT * FROM property_harvest_channels
     WHERE platform = $1
       AND profile_url IS NOT NULL
       AND subscription_status = 'assisted_rotation'
       AND COALESCE(metadata->>'rotation_kind', '') = 'creator_profile'
     ORDER BY last_checked_at NULLS FIRST, updated_at ASC
     LIMIT $2`,
    [normalizedPlatform, safeLimit]
  );
  return {
    marker: KING_HARVEST_ROUTE_CONTRACT_MARKER,
    e2e_marker: KING_TIKTOK_HARVEST_E2E_MARKER,
    platform: normalizedPlatform,
    creators: result.rows,
    seeded_count: seed.seeded_count,
    database_creator_count: seed.database_creator_count || 0,
    fallback_creator_count: seed.fallback_creator_count || 0,
    review_only: true,
  };
}

async function loadNextHarvestCreator(db, { platform = 'tiktok' } = {}) {
  const result = await listHarvestCreators(db, { platform, limit: 1 });
  return {
    ...result,
    creator: result.creators[0] || null,
    workflow: 'Open the public profile, copy only new exact post URLs, then paste them into the exact social import panel. No automated scraping is performed.',
  };
}

async function markHarvestCreatorChecked(db, { platform = 'tiktok', sourceKey = '' } = {}) {
  const normalizedPlatform = normalizeCreatorPlatform(platform);
  const normalizedSourceKey = cleanText(sourceKey, 500);
  if (!normalizedSourceKey) return null;
  const result = await db.query(
    `UPDATE property_harvest_channels
     SET last_checked_at = NOW(), updated_at = NOW()
     WHERE platform = $1
       AND source_key = $2
       AND subscription_status = 'assisted_rotation'
       AND COALESCE(metadata->>'rotation_kind', '') = 'creator_profile'
     RETURNING *`,
    [normalizedPlatform, normalizedSourceKey]
  );
  return result.rows[0] || null;
}

module.exports = {
  CURATED_TIKTOK_CREATOR_PROFILES,
  databaseCreatorProfiles,
  KING_HARVEST_ROUTE_CONTRACT_MARKER,
  KING_TIKTOK_HARVEST_E2E_MARKER,
  listHarvestCreators,
  loadNextHarvestCreator,
  markHarvestCreatorChecked,
  normalizeCreatorPlatform,
  registryCreators,
  seedHarvestCreators,
};
