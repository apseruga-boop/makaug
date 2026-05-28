CREATE EXTENSION IF NOT EXISTS pgcrypto;

WITH source_created_agents AS (
  SELECT a.id
  FROM agents a
  WHERE a.user_id IS NULL
    AND (
      COALESCE(a.licence_number, '') ~* '^(SOCIAL|FOUND-ONLINE|TIKTOK|FACEBOOK|X)-'
      OR COALESCE(a.verification_reason, '') ILIKE '%public social source onboarding%'
      OR COALESCE(a.verification_reason, '') ILIKE '%source profile%'
      OR COALESCE(a.verification_reason, '') ILIKE '%public social source%'
      OR COALESCE(a.verification_reason, '') ILIKE '%source sweep%'
    )
),
detached_source_listings AS (
  UPDATE properties p
  SET
    agent_id = NULL,
    extra_fields = COALESCE(p.extra_fields, '{}'::jsonb) || jsonb_build_object(
      'auto_source_agent_profile_removed', true,
      'auto_source_agent_profile_removed_at', NOW(),
      'auto_source_agent_profile_policy', 'source_discovery_profiles_require_agent_claim_or_registration'
    ),
    updated_at = NOW()
  FROM source_created_agents a
  WHERE p.agent_id = a.id
    AND (
      COALESCE(p.extra_fields->>'found_online', '') ~* '^(true|1|yes)$'
      OR COALESCE(p.extra_fields->>'social_search_candidate', '') ~* '^(true|1|yes)$'
      OR COALESCE(p.extra_fields->>'third_party_discovery_result', '') ~* '^(true|1|yes)$'
      OR COALESCE(p.source, '') = 'found_online_property_source_v1'
      OR COALESCE(p.listed_via, '') = 'found_online'
    )
  RETURNING p.id, a.id AS old_agent_id
),
agent_events AS (
  INSERT INTO admin_audit_logs (
    admin_user_id,
    action,
    target_type,
    target_id,
    metadata,
    created_at
  )
  SELECT
    NULL,
    'auto_source_agent_profile_hidden',
    'agent',
    a.id::text,
    jsonb_build_object(
      'reason', 'Found-online/source-discovery broker profiles must be claimed or registered by the broker before becoming public Makaug profiles.',
      'detached_listing_count', (
        SELECT COUNT(*)::int
        FROM detached_source_listings d
        WHERE d.old_agent_id = a.id
      ),
      'rollback', 'Restore agent status and property agent_id only after the broker/agent claims or registers their Makaug profile.'
    ),
    NOW()
  FROM source_created_agents a
  RETURNING target_id
)
UPDATE agents a
SET
  status = 'suspended',
  featured_homepage = FALSE,
  verification_reason = CONCAT_WS(
    E'\n',
    NULLIF(a.verification_reason, ''),
    'Hidden 28 May 2026: source-discovery profiles are not public Makaug broker profiles. The original poster must claim/register through the broker process before Makaug shows a public agent profile.'
  ),
  updated_at = NOW()
FROM source_created_agents s
WHERE a.id = s.id;
