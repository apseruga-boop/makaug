CREATE TABLE IF NOT EXISTS blocked_social_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL DEFAULT 'all',
  match_type TEXT NOT NULL,
  match_value TEXT NOT NULL,
  source_key TEXT NOT NULL,
  reason TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (platform, match_type, match_value)
);

CREATE INDEX IF NOT EXISTS idx_blocked_social_sources_lookup
  ON blocked_social_sources (platform, match_type, match_value);

CREATE TABLE IF NOT EXISTS social_source_purge_audits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purge_key TEXT NOT NULL UNIQUE,
  source_key TEXT NOT NULL,
  reason TEXT NOT NULL,
  deleted_property_count INTEGER NOT NULL DEFAULT 0,
  deleted_agent_count INTEGER NOT NULL DEFAULT 0,
  status_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  deleted_property_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  verified_remaining_property_count INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO blocked_social_sources (platform, match_type, match_value, source_key, reason, metadata)
VALUES
  ('youtube', 'platform_account_id', 'ucfvusmhrd9iinxi3jgl6qga', 'dream-home-real-estate', 'owner_requested_permanent_social_source_block_20260909', '{"channel_url":"https://www.youtube.com/channel/UCFvuSMhrD9IiNXI3jgL6QgA"}'::jsonb),
  ('all', 'handle', 'williolevis', 'dream-home-real-estate', 'owner_requested_permanent_social_source_block_20260909', '{}'::jsonb),
  ('all', 'source_key', 'dream-home-real-estate', 'dream-home-real-estate', 'owner_requested_permanent_social_source_block_20260909', '{}'::jsonb),
  ('all', 'name', 'dreamhomerealestateakav8', 'dream-home-real-estate', 'owner_requested_permanent_social_source_block_20260909', '{}'::jsonb),
  ('all', 'name', 'dreamhomerealestate', 'dream-home-real-estate', 'owner_requested_permanent_social_source_block_20260909', '{}'::jsonb),
  ('all', 'name', 'agabalewiswilliam', 'dream-home-real-estate', 'owner_requested_permanent_social_source_block_20260909', '{}'::jsonb),
  ('all', 'phone', '256732639346', 'dream-home-real-estate', 'owner_requested_permanent_social_source_block_20260909', '{}'::jsonb),
  ('all', 'phone', '256750719382', 'dream-home-real-estate', 'owner_requested_permanent_social_source_block_20260909', '{}'::jsonb),
  ('all', 'phone', '256750819382', 'dream-home-real-estate', 'owner_requested_permanent_social_source_block_20260909', '{}'::jsonb),
  ('all', 'phone', '256777647991', 'dream-home-real-estate', 'owner_requested_permanent_social_source_block_20260909', '{}'::jsonb)
ON CONFLICT (platform, match_type, match_value) DO UPDATE
SET source_key = EXCLUDED.source_key,
    reason = EXCLUDED.reason,
    metadata = blocked_social_sources.metadata || EXCLUDED.metadata,
    updated_at = NOW();

UPDATE property_source_registry
SET status = 'blocked',
    scrape_policy = 'never_import',
    notes = CONCAT_WS(E'\n', NULLIF(notes, ''), 'Permanently blocked by owner request on 2026-09-09.'),
    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
      'blocked_reason', 'owner_requested_permanent_social_source_block_20260909',
      'blocked_at', NOW()
    ),
    updated_at = NOW()
WHERE source_key = 'dream-home-real-estate'
   OR LOWER(COALESCE(source_url, '')) LIKE '%ucfvusmhrd9iinxi3jgl6qga%'
   OR LOWER(COALESCE(handle, '')) IN ('@williolevis', 'williolevis')
   OR REGEXP_REPLACE(COALESCE(contact_phone, ''), '[^0-9]', '', 'g') IN ('256732639346','256750719382','256750819382','256777647991')
   OR REGEXP_REPLACE(COALESCE(contact_phone_alt, ''), '[^0-9]', '', 'g') IN ('256732639346','256750719382','256750819382','256777647991');

UPDATE property_harvest_channels
SET subscription_status = 'blocked',
    lease_expires_at = NULL,
    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
      'blocked_reason', 'owner_requested_permanent_social_source_block_20260909',
      'blocked_at', NOW()
    ),
    updated_at = NOW()
WHERE LOWER(COALESCE(source_key, '')) = 'ucfvusmhrd9iinxi3jgl6qga'
   OR LOWER(COALESCE(external_channel_id, '')) = 'ucfvusmhrd9iinxi3jgl6qga'
   OR LOWER(COALESCE(profile_url, '')) LIKE '%ucfvusmhrd9iinxi3jgl6qga%'
   OR LOWER(COALESCE(profile_url, '')) LIKE '%@williolevis%'
   OR REGEXP_REPLACE(LOWER(COALESCE(display_name, '')), '[^a-z0-9]', '', 'g') IN ('dreamhomerealestate','dreamhomerealestateakav8','agabalewiswilliam');

DELETE FROM property_harvest_cursors
WHERE LOWER(COALESCE(source_key, '')) IN ('dream-home-real-estate','ucfvusmhrd9iinxi3jgl6qga','williolevis')
   OR LOWER(COALESCE(metadata::text, '')) LIKE '%ucfvusmhrd9iinxi3jgl6qga%';

UPDATE source_coverage_items
SET status = 'blocked',
    lease_expires_at = NULL,
    next_attempt_at = NULL,
    failure_reason = 'permanently_blocked_social_source',
    last_error = NULL,
    checked_at = NOW(),
    result = COALESCE(result, '{}'::jsonb) || jsonb_build_object(
      'blocked_source_key', 'dream-home-real-estate',
      'blocked_reason', 'owner_requested_permanent_social_source_block_20260909'
    ),
    updated_at = NOW()
WHERE LOWER(COALESCE(source_key, '')) IN ('dream-home-real-estate','ucfvusmhrd9iinxi3jgl6qga','williolevis')
   OR LOWER(COALESCE(source_url, '')) LIKE '%ucfvusmhrd9iinxi3jgl6qga%'
   OR LOWER(COALESCE(source_url, '')) LIKE '%@williolevis%'
   OR REGEXP_REPLACE(LOWER(COALESCE(source_name, '')), '[^a-z0-9]', '', 'g') IN ('dreamhomerealestate','dreamhomerealestateakav8','agabalewiswilliam')
   OR LOWER(COALESCE(metadata::text, '')) LIKE '%ucfvusmhrd9iinxi3jgl6qga%';

UPDATE property_harvest_submissions
SET status = 'rejected',
    import_result = COALESCE(import_result, '{}'::jsonb) || jsonb_build_object(
      'blocked_source_key', 'dream-home-real-estate',
      'reason', 'permanently_blocked_social_source'
    ),
    updated_at = NOW()
WHERE LOWER(COALESCE(source_url, '')) LIKE '%ucfvusmhrd9iinxi3jgl6qga%'
   OR LOWER(COALESCE(source_url, '')) LIKE '%@williolevis%'
   OR LOWER(COALESCE(import_result::text, '')) LIKE '%ucfvusmhrd9iinxi3jgl6qga%';

CREATE TEMP TABLE dream_home_v8_purge_properties AS
SELECT p.id, p.status
FROM properties p
WHERE (
    LOWER(COALESCE(p.source, '')) IN ('found_online_property_source_v1','sourced_inventory_candidate')
    OR LOWER(COALESCE(p.listed_via, '')) = 'found_online'
    OR LOWER(COALESCE(p.extra_fields->>'found_online_candidate', '')) IN ('true','1','yes')
    OR LOWER(COALESCE(p.extra_fields->>'found_online', '')) IN ('true','1','yes')
    OR LOWER(COALESCE(p.extra_fields->>'social_search_candidate', '')) IN ('true','1','yes')
  )
  AND (
    LOWER(COALESCE(p.extra_fields->>'source_registry_key', '')) IN ('dream-home-real-estate','ucfvusmhrd9iinxi3jgl6qga','williolevis')
    OR LOWER(COALESCE(p.extra_fields::text, '')) LIKE '%ucfvusmhrd9iinxi3jgl6qga%'
    OR LOWER(COALESCE(p.extra_fields::text, '')) LIKE '%@williolevis%'
    OR REGEXP_REPLACE(LOWER(COALESCE(p.extra_fields->>'source_name', '')), '[^a-z0-9]', '', 'g') IN ('dreamhomerealestate','dreamhomerealestateakav8','agabalewiswilliam')
    OR REGEXP_REPLACE(LOWER(COALESCE(p.extra_fields->>'source_agent_name', '')), '[^a-z0-9]', '', 'g') IN ('dreamhomerealestate','dreamhomerealestateakav8','agabalewiswilliam')
    OR REGEXP_REPLACE(LOWER(COALESCE(p.extra_fields->>'public_display_name', '')), '[^a-z0-9]', '', 'g') IN ('dreamhomerealestate','dreamhomerealestateakav8','agabalewiswilliam')
    OR REGEXP_REPLACE(COALESCE(p.lister_phone, ''), '[^0-9]', '', 'g') IN ('256732639346','256750719382','256750819382','256777647991')
    OR REGEXP_REPLACE(COALESCE(p.extra_fields->>'source_phone', ''), '[^0-9]', '', 'g') IN ('256732639346','256750719382','256750819382','256777647991')
    OR REGEXP_REPLACE(COALESCE(p.extra_fields->>'source_contact_phone', ''), '[^0-9]', '', 'g') IN ('256732639346','256750719382','256750819382','256777647991')
  );

INSERT INTO social_source_purge_audits (
  purge_key, source_key, reason, deleted_property_count, deleted_agent_count,
  status_counts, deleted_property_ids, verified_remaining_property_count
)
SELECT
  'dream-home-v8-20260909',
  'dream-home-real-estate',
  'owner_requested_permanent_social_source_block_20260909',
  COUNT(*)::int,
  0,
  COALESCE((SELECT jsonb_object_agg(status, status_count) FROM (
    SELECT status, COUNT(*)::int AS status_count
    FROM dream_home_v8_purge_properties
    GROUP BY status
  ) status_rows), '{}'::jsonb),
  COALESCE(jsonb_agg(id ORDER BY id), '[]'::jsonb),
  NULL
FROM dream_home_v8_purge_properties
ON CONFLICT (purge_key) DO NOTHING;

DELETE FROM properties p
USING dream_home_v8_purge_properties purge
WHERE p.id = purge.id;

WITH deleted_agents AS (
  DELETE FROM agents
  WHERE licence_number = 'SOCIAL-DREAM-HOME-REAL-ESTATE-20260520'
     OR REGEXP_REPLACE(COALESCE(phone, ''), '[^0-9]', '', 'g') IN ('256732639346','256750719382','256750819382','256777647991')
  RETURNING id
)
UPDATE social_source_purge_audits
SET deleted_agent_count = (SELECT COUNT(*)::int FROM deleted_agents)
WHERE purge_key = 'dream-home-v8-20260909';

DROP TABLE dream_home_v8_purge_properties;

UPDATE social_source_purge_audits
SET verified_remaining_property_count = (
  SELECT COUNT(*)::int
  FROM properties p
  WHERE (
      LOWER(COALESCE(p.source, '')) IN ('found_online_property_source_v1','sourced_inventory_candidate')
      OR LOWER(COALESCE(p.listed_via, '')) = 'found_online'
    )
    AND (
      LOWER(COALESCE(p.extra_fields->>'source_registry_key', '')) IN ('dream-home-real-estate','ucfvusmhrd9iinxi3jgl6qga','williolevis')
      OR LOWER(COALESCE(p.extra_fields::text, '')) LIKE '%ucfvusmhrd9iinxi3jgl6qga%'
      OR LOWER(COALESCE(p.extra_fields::text, '')) LIKE '%@williolevis%'
      OR REGEXP_REPLACE(COALESCE(p.lister_phone, ''), '[^0-9]', '', 'g') IN ('256732639346','256750719382','256750819382','256777647991')
    )
)
WHERE purge_key = 'dream-home-v8-20260909';
