CREATE EXTENSION IF NOT EXISTS pgcrypto;

WITH removal_candidates AS (
  SELECT
    p.id,
    p.status AS old_status,
    p.moderation_stage AS old_moderation_stage,
    COALESCE(p.extra_fields->>'source_platform', '') AS source_platform,
    COALESCE(p.extra_fields->>'source_url', p.extra_fields->>'source_post_url', '') AS source_url,
    CASE
      WHEN LOWER(COALESCE(p.extra_fields->>'source_platform', '')) NOT IN ('youtube','tiktok','instagram','facebook','x','twitter')
        OR COALESCE(p.extra_fields->>'source_url', p.extra_fields->>'source_post_url', '') !~* '(youtube\.com|youtu\.be|tiktok\.com|instagram\.com|facebook\.com|fb\.watch|x\.com|twitter\.com)'
      THEN 'website_or_non_social_source_blocked'
      WHEN NOT (
        LOWER(COALESCE(p.extra_fields->>'permission_status', '')) IN (
          'founder_reported_agent_authorised_upload',
          'founder_reported_agent_authorised_listing',
          'founder_confirmed_preapproved',
          'agent_authorised_upload',
          'agent_authorised_listing',
          'agent_preapproved',
          'owner_agent_preapproved'
        )
        AND COALESCE(p.extra_fields->>'consent_confirmed', '') ~* '^(true|1|yes)$'
        AND COALESCE(p.extra_fields->>'image_rights_confirmed', '') ~* '^(true|1|yes)$'
      )
      THEN 'missing_preapproval_or_image_rights'
      ELSE 'blocked_by_social_only_preapproval_policy'
    END AS removal_reason
  FROM properties p
  WHERE COALESCE(p.status, '') <> 'deleted'
    AND (
      COALESCE(p.source, '') = 'found_online_property_source_v1'
      OR COALESCE(p.listed_via, '') = 'found_online'
      OR COALESCE(p.extra_fields->>'found_online_candidate', '') IN ('true','1','yes')
      OR COALESCE(p.extra_fields->>'found_online', '') IN ('true','1','yes')
    )
    AND (
      LOWER(COALESCE(p.extra_fields->>'source_platform', '')) NOT IN ('youtube','tiktok','instagram','facebook','x','twitter')
      OR COALESCE(p.extra_fields->>'source_url', p.extra_fields->>'source_post_url', '') !~* '(youtube\.com|youtu\.be|tiktok\.com|instagram\.com|facebook\.com|fb\.watch|x\.com|twitter\.com)'
      OR NOT (
        LOWER(COALESCE(p.extra_fields->>'permission_status', '')) IN (
          'founder_reported_agent_authorised_upload',
          'founder_reported_agent_authorised_listing',
          'founder_confirmed_preapproved',
          'agent_authorised_upload',
          'agent_authorised_listing',
          'agent_preapproved',
          'owner_agent_preapproved'
        )
        AND COALESCE(p.extra_fields->>'consent_confirmed', '') ~* '^(true|1|yes)$'
        AND COALESCE(p.extra_fields->>'image_rights_confirmed', '') ~* '^(true|1|yes)$'
      )
    )
),
event_rows AS (
  INSERT INTO property_moderation_events (
    property_id,
    actor_id,
    action,
    status_from,
    status_to,
    checklist,
    reason,
    notes,
    delivery
  )
  SELECT
    id,
    'social_only_preapproved_cleanup_20260525',
    'found_online_unapproved_or_website_source_removed',
    old_status,
    'deleted',
    jsonb_build_object(
      'social_only_sources', true,
      'website_sources_disabled', true,
      'preapproval_required', true,
      'consent_required', true,
      'image_rights_required', true,
      'source_platform', source_platform,
      'source_url', source_url
    ),
    'Removed from makaug launch inventory because the record was website/non-social sourced or lacked pre-approval and image-rights confirmation.',
    'Launch legal guardrail: only pre-approved social posts from YouTube, TikTok, Instagram, Facebook, or X/Twitter can become found-online property rows. Website-only sources are ignored.',
    jsonb_build_object(
      'cleanup_batch', 'social_only_preapproved_inventory_20260525',
      'removal_reason', removal_reason,
      'rollback', 'Manually restore status only after owner/agent permission and image rights are documented.'
    )
  FROM removal_candidates
  RETURNING property_id
)
UPDATE properties p
SET
  status = 'deleted',
  moderation_stage = 'removed_social_only_preapproval_policy',
  moderation_notes = CONCAT_WS(
    E'\n',
    NULLIF(p.moderation_notes, ''),
    'Removed 25 May 2026: found-online launch policy now accepts only pre-approved social posts from YouTube, TikTok, Instagram, Facebook, or X/Twitter. Website-only and unapproved media/source records are not public inventory.'
  ),
  moderation_reason = 'Removed by social-only/pre-approved launch inventory cleanup.',
  extra_fields = COALESCE(p.extra_fields, '{}'::jsonb) || jsonb_build_object(
    'removed_from_public_inventory', true,
    'removed_from_public_inventory_at', NOW(),
    'removal_batch', 'social_only_preapproved_inventory_20260525',
    'removal_policy', 'social_only_preapproved_sources',
    'website_sources_disabled', true,
    'preapproval_required_for_reimport', true
  ),
  updated_at = NOW()
FROM removal_candidates rc
WHERE p.id = rc.id;

UPDATE property_source_registry
SET
  status = 'blocked',
  scrape_policy = 'disabled_website_sources_not_for_property_import',
  notes = CONCAT_WS(
    E'\n',
    NULLIF(notes, ''),
    'Disabled 25 May 2026: website/portal source rows are no longer used for found-online property imports. Use social channels only.'
  ),
  metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
    'disabled_for_property_import_at', NOW(),
    'disabled_reason', 'website_sources_not_allowed_for_launch_inventory',
    'allowed_platforms', jsonb_build_array('youtube','tiktok','instagram','facebook','x')
  ),
  updated_at = NOW()
WHERE LOWER(COALESCE(platform, '')) = 'website'
   OR COALESCE(source_url, '') !~* '(youtube\.com|youtu\.be|tiktok\.com|instagram\.com|facebook\.com|fb\.watch|x\.com|twitter\.com)';

WITH agent_inventory AS (
  SELECT
    a.id,
    COUNT(p.id) FILTER (WHERE p.status = 'approved')::int AS live_listing_count
  FROM agents a
  LEFT JOIN properties p ON p.agent_id = a.id
  GROUP BY a.id
)
UPDATE agents a
SET
  status = 'suspended',
  verification_reason = CONCAT_WS(
    E'\n',
    NULLIF(a.verification_reason, ''),
    'Hidden 25 May 2026: public broker/source profiles now require at least two approved makaug listings. One-off or zero-listing source profiles stay internal until more inventory is live.'
  ),
  updated_at = NOW()
FROM agent_inventory ai
WHERE a.id = ai.id
  AND ai.live_listing_count < 2
  AND (
    COALESCE(a.licence_number, '') ~* '^(SOCIAL|FOUND-ONLINE)-'
    OR COALESCE(a.verification_reason, '') ILIKE '%source%'
    OR COALESCE(a.verification_reason, '') ILIKE '%sweep%'
  );
