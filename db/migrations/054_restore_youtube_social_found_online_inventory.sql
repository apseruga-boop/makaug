WITH restored_properties AS (
  UPDATE properties p
  SET
    status = 'approved',
    moderation_stage = 'approved_youtube_social_source',
    reviewed_at = COALESCE(p.reviewed_at, NOW()),
    approved_at = COALESCE(p.approved_at, NOW()),
    moderation_notes = CONCAT_WS(
      E'\n',
      NULLIF(p.moderation_notes, ''),
      'Restored 25 May 2026: curated YouTube social-source found-online rows are accepted launch inventory when the exact YouTube video URL, source evidence, location/area, and price are present. Website-only sources remain blocked.'
    ),
    moderation_reason = 'Restored by YouTube social-source acceptance policy.',
    extra_fields = (
      COALESCE(p.extra_fields, '{}'::jsonb)
        - 'removed_from_public_inventory'
        - 'removed_from_public_inventory_at'
        - 'removal_batch'
        - 'removal_policy'
        - 'preapproval_required_for_reimport'
        - 'implicit_approval_blocked'
    ) || jsonb_build_object(
      'found_online', true,
      'social_search_candidate', true,
      'preapproved_source_post', true,
      'consent_confirmed', true,
      'image_rights_confirmed', true,
      'permission_status', 'founder_reported_agent_authorised_upload',
      'image_rights_status', 'preapproved_social_source_media_or_evidence',
      'youtube_social_source_accepted', true,
      'youtube_social_source_restored_at', NOW()
    ),
    updated_at = NOW()
  WHERE p.status = 'deleted'
    AND COALESCE(p.moderation_stage, '') = 'removed_missing_explicit_preapproval'
    AND COALESCE(p.extra_fields->>'source_batch', '') = 'social_search_authorised_20260520'
    AND LOWER(COALESCE(p.extra_fields->>'source_platform', '')) = 'youtube'
    AND COALESCE(p.extra_fields->>'source_url', p.extra_fields->>'source_post_url', '') ~* '(youtube\.com|youtu\.be)'
  RETURNING p.id, p.agent_id
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
    'youtube_social_restore_20260525',
    'youtube_social_found_online_restored',
    'deleted',
    'approved',
    jsonb_build_object(
      'youtube_social_source_accepted', true,
      'website_sources_blocked', true,
      'exact_youtube_source_required', true
    ),
    'Restored because King confirmed curated YouTube social-source properties are acceptable launch inventory.',
    'Only exact YouTube social-source rows from the curated found-online batch are restored. Website-only and non-social rows remain blocked.',
    jsonb_build_object(
      'restore_batch', 'youtube_social_found_online_restore_20260525'
    )
  FROM restored_properties
  RETURNING property_id
),
restored_agent_inventory AS (
  SELECT
    agent_id,
    COUNT(*)::int AS restored_listing_count
  FROM restored_properties
  WHERE agent_id IS NOT NULL
  GROUP BY agent_id
)
UPDATE agents a
SET
  status = 'approved',
  registration_status = 'registered',
  approved_at = COALESCE(a.approved_at, NOW()),
  verification_reason = CONCAT_WS(
    E'\n',
    NULLIF(a.verification_reason, ''),
    'Restored 25 May 2026: public source profile has multiple approved YouTube social-source listings on makaug.'
  ),
  updated_at = NOW()
FROM restored_agent_inventory rai,
     (SELECT COUNT(*)::int AS events_written FROM event_rows) er
WHERE a.id = rai.agent_id
  AND rai.restored_listing_count >= 2
  AND (
    COALESCE(a.licence_number, '') ~* '^(SOCIAL|FOUND-ONLINE)-'
    OR COALESCE(a.verification_reason, '') ILIKE '%source%'
    OR COALESCE(a.verification_reason, '') ILIKE '%sweep%'
  );
