-- Undo every TikTok cover the cover job saved (migration 253).
-- Removes the picture rows it added, makes the rows it demoted primary again,
-- takes the tiktok_cover_* notes off the listings and marks them rolled_back so
-- the job does not save them again. Listing status and text were never changed,
-- so nothing else needs restoring. Files on the media host are left in place.
-- To stop the job first: set TIKTOK_COVER_AUTO=false on the web service.
-- For ONE listing, add "AND property_id = '<uuid>'" to each statement.
BEGIN;
DELETE FROM property_images
 WHERE id IN (SELECT image_id FROM tiktok_cover_log WHERE rolled_back_at IS NULL);
UPDATE property_images SET is_primary = true
 WHERE id IN (SELECT unnest(demoted_image_ids) FROM tiktok_cover_log WHERE rolled_back_at IS NULL);
UPDATE properties
   SET extra_fields = (COALESCE(extra_fields, '{}'::jsonb)
         - 'tiktok_cover_url' - 'tiktok_cover_source' - 'tiktok_cover_saved_at'
         - 'tiktok_cover_error' - 'tiktok_cover_attempts' - 'tiktok_cover_attempted_at')
       || jsonb_build_object('tiktok_cover_status', 'rolled_back')
 WHERE id IN (SELECT property_id FROM tiktok_cover_log WHERE rolled_back_at IS NULL);
UPDATE tiktok_cover_log SET rolled_back_at = NOW() WHERE rolled_back_at IS NULL;
COMMIT;
