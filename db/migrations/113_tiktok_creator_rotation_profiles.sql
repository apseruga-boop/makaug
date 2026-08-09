-- Keep TikTok discovery feeds available for manual discovery, but never return
-- hashtag/search pages from the assisted creator-profile rotation.
UPDATE property_harvest_channels
SET subscription_status = 'discovery_feed',
    metadata = metadata || jsonb_build_object(
      'rotation_kind', 'discovery_feed',
      'excluded_from_creator_rotation', true,
      'reclassified_by', 'king-tiktok-harvester-e2e-20260809'
    ),
    updated_at = NOW()
WHERE platform = 'tiktok'
  AND subscription_status = 'assisted_rotation'
  AND COALESCE(profile_url, '') !~* '^https://(www\.)?tiktok\.com/@[A-Za-z0-9._-]+/?([?#].*)?$';

CREATE INDEX IF NOT EXISTS idx_property_harvest_channels_creator_rotation
  ON property_harvest_channels (platform, last_checked_at NULLS FIRST, updated_at)
  WHERE subscription_status = 'assisted_rotation'
    AND COALESCE(metadata->>'rotation_kind', '') = 'creator_profile';

ANALYZE property_harvest_channels;
