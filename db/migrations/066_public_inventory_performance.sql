CREATE INDEX IF NOT EXISTS idx_properties_public_live_created
  ON properties (created_at DESC)
  WHERE LOWER(COALESCE(status, '')) IN ('approved', 'live', 'published');

CREATE INDEX IF NOT EXISTS idx_properties_public_live_type_created
  ON properties (listing_type, created_at DESC)
  WHERE LOWER(COALESCE(status, '')) IN ('approved', 'live', 'published');

CREATE INDEX IF NOT EXISTS idx_properties_public_live_featured_created
  ON properties ((extra_fields->>'featured_at') DESC, updated_at DESC, created_at DESC)
  WHERE LOWER(COALESCE(status, '')) IN ('approved', 'live', 'published')
    AND COALESCE(extra_fields->>'featured', 'false') IN ('true', '1', 'yes');

CREATE INDEX IF NOT EXISTS idx_property_images_public_primary_lookup
  ON property_images (property_id, is_primary DESC, sort_order ASC, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_property_images_duplicate_url_lookup
  ON property_images ((md5(url)), property_id)
  WHERE COALESCE(url, '') <> '';

CREATE INDEX IF NOT EXISTS idx_properties_lister_phone_created
  ON properties (lister_phone, created_at DESC)
  WHERE lister_phone IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_properties_lister_email_created
  ON properties (LOWER(COALESCE(lister_email, '')), created_at DESC)
  WHERE COALESCE(lister_email, '') <> '';

CREATE INDEX IF NOT EXISTS idx_properties_duplicate_review_lookup
  ON properties (listing_type, district, LOWER(COALESCE(area, '')), price, created_at DESC);
