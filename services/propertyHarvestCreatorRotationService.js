'use strict';

const {
  PROPERTY_SOURCE_REGISTRY_BATCH_ID,
  getPropertySourceRegistry,
} = require('./propertySourceRegistryService');

const KING_HARVEST_ROUTE_CONTRACT_MARKER = 'king-harvester-route-contract-20260809';
const SUPPORTED_CREATOR_PLATFORMS = new Set(['tiktok', 'facebook', 'instagram']);

function cleanText(value = '', maxLength = 500) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function normalizeCreatorPlatform(value = 'tiktok') {
  const platform = cleanText(value || 'tiktok', 40).toLowerCase();
  return SUPPORTED_CREATOR_PLATFORMS.has(platform) ? platform : 'tiktok';
}

function registryCreators(platform = 'tiktok', limit = 250) {
  const normalizedPlatform = normalizeCreatorPlatform(platform);
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
      metadata: { registry_batch: PROPERTY_SOURCE_REGISTRY_BATCH_ID },
    });
    if (creators.length >= limit) break;
  }
  return creators;
}

async function seedHarvestCreators(db, { platform = 'tiktok', limit = 250 } = {}) {
  const normalizedPlatform = normalizeCreatorPlatform(platform);
  const creators = registryCreators(normalizedPlatform, Math.min(250, Math.max(1, Number(limit) || 250)));
  if (!creators.length) return { platform: normalizedPlatform, seeded_count: 0 };
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
           metadata = property_harvest_channels.metadata || EXCLUDED.metadata,
           updated_at = NOW()`,
    [normalizedPlatform, JSON.stringify(creators)]
  );
  return { platform: normalizedPlatform, seeded_count: creators.length };
}

async function listHarvestCreators(db, { platform = 'tiktok', limit = 100 } = {}) {
  const normalizedPlatform = normalizeCreatorPlatform(platform);
  const safeLimit = Math.min(250, Math.max(1, Number(limit) || 100));
  const seed = await seedHarvestCreators(db, { platform: normalizedPlatform });
  const result = await db.query(
    `SELECT * FROM property_harvest_channels
     WHERE platform = $1 AND profile_url IS NOT NULL
     ORDER BY last_checked_at NULLS FIRST, updated_at ASC
     LIMIT $2`,
    [normalizedPlatform, safeLimit]
  );
  return {
    marker: KING_HARVEST_ROUTE_CONTRACT_MARKER,
    platform: normalizedPlatform,
    creators: result.rows,
    seeded_count: seed.seeded_count,
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
     WHERE platform = $1 AND source_key = $2
     RETURNING *`,
    [normalizedPlatform, normalizedSourceKey]
  );
  return result.rows[0] || null;
}

module.exports = {
  KING_HARVEST_ROUTE_CONTRACT_MARKER,
  listHarvestCreators,
  loadNextHarvestCreator,
  markHarvestCreatorChecked,
  normalizeCreatorPlatform,
  registryCreators,
  seedHarvestCreators,
};
