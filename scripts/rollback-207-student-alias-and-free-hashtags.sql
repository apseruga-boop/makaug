-- Rollback for 207_student_listing_type_and_free_hashtag_sources.sql
-- Run by hand. This file is not in db/migrations, so deploy does not apply it.
-- Restores listing_type 'students' rows from the backup, and restores or
-- removes the free hashtag source rows.

BEGIN;

UPDATE properties p
SET listing_type = b.listing_type,
    extra_fields = b.extra_fields,
    updated_at = b.updated_at
FROM listing_type_student_alias_207_backup b
WHERE p.id = b.property_id;

DELETE FROM property_source_registry r
USING free_hashtag_sources_207_backup b
WHERE r.source_key = b.source_key
  AND b.existed = FALSE;

UPDATE property_source_registry r
SET source_name = b.row_data->>'source_name',
    platform = b.row_data->>'platform',
    source_type = b.row_data->>'source_type',
    source_url = b.row_data->>'source_url',
    handle = b.row_data->>'handle',
    contact_phone = b.row_data->>'contact_phone',
    contact_phone_alt = b.row_data->>'contact_phone_alt',
    contact_email = b.row_data->>'contact_email',
    website_url = b.row_data->>'website_url',
    districts = ARRAY(SELECT jsonb_array_elements_text(COALESCE(b.row_data->'districts', '[]'::jsonb))),
    listing_types = ARRAY(SELECT jsonb_array_elements_text(COALESCE(b.row_data->'listing_types', '[]'::jsonb))),
    languages = ARRAY(SELECT jsonb_array_elements_text(COALESCE(b.row_data->'languages', '[]'::jsonb))),
    hashtags = ARRAY(SELECT jsonb_array_elements_text(COALESCE(b.row_data->'hashtags', '[]'::jsonb))),
    status = COALESCE(b.row_data->>'status', r.status),
    trust_level = COALESCE(b.row_data->>'trust_level', r.trust_level),
    consent_status = COALESCE(b.row_data->>'consent_status', r.consent_status),
    scrape_policy = COALESCE(b.row_data->>'scrape_policy', r.scrape_policy),
    can_contact_directly = COALESCE((b.row_data->>'can_contact_directly')::boolean, FALSE),
    notes = COALESCE(b.row_data->>'notes', r.notes),
    metadata = COALESCE(b.row_data->'metadata', '{}'::jsonb),
    updated_at = NOW()
FROM free_hashtag_sources_207_backup b
WHERE r.source_key = b.source_key
  AND b.existed = TRUE
  AND b.row_data IS NOT NULL;

COMMIT;
