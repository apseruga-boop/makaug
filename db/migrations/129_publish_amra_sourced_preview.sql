-- The site owner explicitly approved AMRA for public display on 2026-09-10.
-- The supplied developer PDFs do not state current unit prices or an exact map
-- pin, so publish a source-labelled preview with both items clearly pending.
UPDATE off_plan_developments
SET status = 'published',
    verification_status = 'partially_verified',
    published_at = COALESCE(published_at, NOW()),
    extra_fields = extra_fields || jsonb_build_object(
      'public_preview_approved', true,
      'public_preview_approved_source', 'site_owner_request_2026_09_10',
      'public_preview_approved_at', NOW(),
      'price_on_request_approved', true,
      'map_point_pending_approved', true
    ),
    updated_at = NOW()
WHERE country_code = 'AE' AND slug = 'amra-umm-al-quwain';
