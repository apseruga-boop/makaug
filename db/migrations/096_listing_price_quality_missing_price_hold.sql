UPDATE properties p
SET
  status = 'pending',
  moderation_stage = 'source_review',
  moderation_reason = 'A verified numeric price is required before public approval.',
  extra_fields = COALESCE(p.extra_fields, '{}'::jsonb) || jsonb_build_object(
    'featured', false,
    'featured_removed_at', NOW()::text,
    'featured_removed_by', 'listing-price-quality-gate-20260725',
    'price_quality_held_at', NOW()::text,
    'price_quality_marker', 'listing-price-quality-gate-20260725',
    'price_quality_previous_status', p.status,
    'price_quality_hold_reason', 'missing_or_placeholder_price'
  ),
  updated_at = NOW()
WHERE LOWER(COALESCE(p.status, '')) IN ('approved', 'live', 'published')
  AND (p.price IS NULL OR p.price <= 1);

ANALYZE properties;
