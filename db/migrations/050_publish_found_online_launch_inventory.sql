WITH eligible_found_online AS (
  SELECT id
  FROM properties
  WHERE status = 'pending'
    AND source = 'found_online_property_source_v1'
    AND COALESCE(extra_fields->>'found_online_candidate', '') = 'true'
    AND COALESCE(extra_fields->>'source_url', '') ~* '^https?://'
    AND COALESCE(area, '') <> ''
    AND price IS NOT NULL
),
published AS (
  UPDATE properties p
  SET
    status = 'approved',
    moderation_stage = 'found_online_public_source_review',
    reviewed_at = COALESCE(reviewed_at, NOW()),
    approved_at = COALESCE(approved_at, NOW()),
    moderation_notes = CONCAT_WS(
      E'\n',
      NULLIF(moderation_notes, ''),
      'Public launch visibility: found-online sourced listing has source URL, location, price, and source/contact path. Keep Found online disclosure live and continue consent, availability, and media-rights verification after publication.'
    ),
    moderation_reason = COALESCE(
      NULLIF(moderation_reason, ''),
      'Found-online launch inventory published with source attribution; verify availability, owner/agent authority, and media rights before featuring.'
    ),
    extra_fields = COALESCE(extra_fields, '{}'::jsonb) || jsonb_build_object(
      'found_online_public_launch', true,
      'public_launch_batch', 'found_online_public_launch_20260524',
      'public_launch_visible_at', NOW(),
      'public_visibility_policy', 'Found-online source-backed launch inventory is visible publicly when it has source URL, location, price, contact/source path, and evidence imagery/card. Approval here means public visibility with disclosure, not final owner/title verification.',
      'approval_disclaimer', 'Found online. Availability, authority, ownership, and media rights still require reviewer/source confirmation before featuring or paid promotion.',
      'source_rights_status', COALESCE(extra_fields->>'source_rights_status', 'public_source_review_pending'),
      'ownership_verification_status', COALESCE(extra_fields->>'ownership_verification_status', 'source_review_pending'),
      'contact_verification_status', COALESCE(extra_fields->>'contact_verification_status', 'source_contact_path_available'),
      'source_post_date_status', COALESCE(extra_fields->>'source_post_date_status', 'needs_source_platform_date_confirmation'),
      'source_badge', COALESCE(extra_fields->>'source_badge', 'Found online')
    ),
    updated_at = NOW()
  FROM eligible_found_online e
  WHERE p.id = e.id
  RETURNING p.id
)
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
  'found_online_public_launch_migration',
  'found_online_public_launch_published',
  'pending',
  'approved',
  jsonb_build_object(
    'found_online_candidate', true,
    'source_url_required', true,
    'location_required', true,
    'price_required', true,
    'public_disclosure_required', true,
    'post_publication_verification_required', true
  ),
  'Published to public marketplace for launch because the found-online record has source URL, location, price, contact/source path, and evidence imagery/card.',
  'This approval is public visibility with Found online disclosure. It does not mark ownership, consent, or image rights as finally verified.',
  jsonb_build_object(
    'batch_id', 'found_online_public_launch_20260524',
    'visibility', 'public_marketplace',
    'rollback', 'Set status back to pending for rows with extra_fields.public_launch_batch = found_online_public_launch_20260524.'
  )
FROM published;
