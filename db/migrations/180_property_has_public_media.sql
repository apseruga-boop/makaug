-- Public listing counts were timing out because every row re-checked
-- property_images with case-insensitive regexes and parsed extra_fields for a
-- playable video (publicHasPhotoOrVideoSql). has_public_media stores that
-- result. A listing is true only when that expression IS TRUE. When the
-- expression is unknown (no hosted photo and no video fields) it is stored
-- as false, which hides the same rows a WHERE clause already hid.
--
-- The function body is the legacy expression with the alias p, media host
-- media.makaug.com. utils/realListingPhoto.js legacyPublicHasPhotoOrVideoSql
-- must stay textually identical; tests/has-public-media-flag.test.js checks.
-- Videos live in extra_fields (video_url, youtube_url, tiktok_url, video_urls,
-- video_tours), so the properties trigger watches extra_fields. Image changes
-- are caught on property_images. Imports and later migrations stay correct
-- without an application write at each path.
--
-- 179 is reserved by another open change. This file is 180.
--
-- The backfill locks property_images first, then properties, matching the
-- order an image write already uses, and it does not touch updated_at.
-- CREATE INDEX is in this transaction (not CONCURRENTLY) so the lock covers
-- the backfill and the index build together. A photo saved during the
-- backfill waits, then the trigger sees it.

SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '180s';

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS has_public_media boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION property_has_public_media(p properties)
RETURNS boolean
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = public
AS $fn$
  SELECT (EXISTS (
    SELECT 1 FROM property_images rhp
     WHERE rhp.property_id = p.id
       AND rhp.url ~* '^https?://media\.makaug\.com/.+'
       AND rhp.url !~* 'photo-1560518883-ce09059eeffa|image[ _-]*pending|tiktokcdn|byteimg'
       AND COALESCE(rhp.room_label, '') !~* 'image[ _-]*pending'
       AND COALESCE(rhp.slot_key, '') <> 'source_evidence_card'
  ) OR (
    COALESCE(p.extra_fields->>'source_unavailable', '') !~* '^(true|t|1|yes)$'
    AND COALESCE(p.extra_fields->>'source_url_status', '') !~* 'unavailable|removed|deleted|private'
    AND COALESCE(p.extra_fields->>'source_status', '') !~* 'unavailable|removed|deleted|private'
    AND (
      (p.extra_fields->>'video_url' ~* '^https?://' AND (p.extra_fields->>'video_url' !~* 'tiktokcdn|byteimg' OR p.extra_fields->>'video_url' ~* '\.mp4(\?|$)'))
      OR (p.extra_fields->>'youtube_url' ~* '^https?://' AND (p.extra_fields->>'youtube_url' !~* 'tiktokcdn|byteimg' OR p.extra_fields->>'youtube_url' ~* '\.mp4(\?|$)'))
      OR (p.extra_fields->>'tiktok_url' ~* '^https?://' AND (p.extra_fields->>'tiktok_url' !~* 'tiktokcdn|byteimg' OR p.extra_fields->>'tiktok_url' ~* '\.mp4(\?|$)'))
      OR EXISTS (
        SELECT 1
          FROM jsonb_array_elements_text(
            CASE WHEN jsonb_typeof(p.extra_fields->'video_urls') = 'array' THEN p.extra_fields->'video_urls' ELSE '[]'::jsonb END
          ) AS video_url(url)
         WHERE (video_url.url ~* '^https?://' AND (video_url.url !~* 'tiktokcdn|byteimg' OR video_url.url ~* '\.mp4(\?|$)'))
      )
      OR EXISTS (
        SELECT 1
          FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(p.extra_fields->'video_tours') = 'array' THEN p.extra_fields->'video_tours' ELSE '[]'::jsonb END
          ) AS video_tour(elem)
         WHERE (COALESCE(video_tour.elem->>'url', video_tour.elem->>'video_url', CASE WHEN jsonb_typeof(video_tour.elem) = 'string' THEN video_tour.elem #>> '{}' ELSE '' END) ~* '^https?://' AND (COALESCE(video_tour.elem->>'url', video_tour.elem->>'video_url', CASE WHEN jsonb_typeof(video_tour.elem) = 'string' THEN video_tour.elem #>> '{}' ELSE '' END) !~* 'tiktokcdn|byteimg' OR COALESCE(video_tour.elem->>'url', video_tour.elem->>'video_url', CASE WHEN jsonb_typeof(video_tour.elem) = 'string' THEN video_tour.elem #>> '{}' ELSE '' END) ~* '\.mp4(\?|$)'))
           AND (COALESCE(video_tour.elem->>'url', video_tour.elem->>'video_url', CASE WHEN jsonb_typeof(video_tour.elem) = 'string' THEN video_tour.elem #>> '{}' ELSE '' END) ~* '\.mp4(\?|$)' OR COALESCE(video_tour.elem->>'url', video_tour.elem->>'video_url', CASE WHEN jsonb_typeof(video_tour.elem) = 'string' THEN video_tour.elem #>> '{}' ELSE '' END) ~* 'youtu|tiktok')
      )
    )
  )) IS TRUE;
$fn$;

CREATE OR REPLACE FUNCTION properties_set_has_public_media()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  NEW.has_public_media := property_has_public_media(NEW);
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS properties_set_has_public_media ON properties;

CREATE TRIGGER properties_set_has_public_media
  BEFORE INSERT OR UPDATE OF extra_fields
  ON properties
  FOR EACH ROW
  EXECUTE FUNCTION properties_set_has_public_media();

CREATE OR REPLACE FUNCTION refresh_has_public_media_for_ids(ids uuid[])
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  UPDATE properties AS p
     SET has_public_media = property_has_public_media(p)
   WHERE p.id = ANY(ids)
     AND p.has_public_media IS DISTINCT FROM property_has_public_media(p);
END;
$fn$;

CREATE OR REPLACE FUNCTION property_images_refresh_public_media_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  PERFORM refresh_has_public_media_for_ids(ARRAY(SELECT DISTINCT property_id FROM new_images));
  RETURN NULL;
END;
$fn$;

CREATE OR REPLACE FUNCTION property_images_refresh_public_media_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  PERFORM refresh_has_public_media_for_ids(ARRAY(SELECT DISTINCT property_id FROM old_images));
  RETURN NULL;
END;
$fn$;

CREATE OR REPLACE FUNCTION property_images_refresh_public_media_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  PERFORM refresh_has_public_media_for_ids(ARRAY(
    SELECT DISTINCT property_id FROM new_images
    UNION
    SELECT DISTINCT property_id FROM old_images
  ));
  RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS property_images_public_media_insert ON property_images;
DROP TRIGGER IF EXISTS property_images_public_media_delete ON property_images;
DROP TRIGGER IF EXISTS property_images_public_media_update ON property_images;

CREATE TRIGGER property_images_public_media_insert
  AFTER INSERT ON property_images
  REFERENCING NEW TABLE AS new_images
  FOR EACH STATEMENT
  EXECUTE FUNCTION property_images_refresh_public_media_insert();

CREATE TRIGGER property_images_public_media_delete
  AFTER DELETE ON property_images
  REFERENCING OLD TABLE AS old_images
  FOR EACH STATEMENT
  EXECUTE FUNCTION property_images_refresh_public_media_delete();

CREATE TRIGGER property_images_public_media_update
  AFTER UPDATE ON property_images
  REFERENCING OLD TABLE AS old_images NEW TABLE AS new_images
  FOR EACH STATEMENT
  EXECUTE FUNCTION property_images_refresh_public_media_update();

DO $backfill$
BEGIN
  IF to_regclass('public.properties') IS NOT NULL
     AND EXISTS (
       SELECT 1
         FROM pg_trigger
        WHERE tgname = 'trg_properties_updated_at'
          AND tgrelid = 'public.properties'::regclass
          AND NOT tgisinternal
     ) THEN
    ALTER TABLE properties DISABLE TRIGGER trg_properties_updated_at;
  END IF;

  -- Image writes lock the image row, then the property. Lock in that order.
  LOCK TABLE property_images IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE properties IN SHARE ROW EXCLUSIVE MODE;

  UPDATE properties AS p
     SET has_public_media = computed.flag
    FROM (
      SELECT id, property_has_public_media(properties) AS flag
        FROM properties
    ) AS computed
   WHERE p.id = computed.id
     AND p.has_public_media IS DISTINCT FROM computed.flag;

  IF EXISTS (
       SELECT 1
         FROM pg_trigger
        WHERE tgname = 'trg_properties_updated_at'
          AND tgrelid = 'public.properties'::regclass
          AND NOT tgisinternal
          AND tgenabled = 'D'
     ) THEN
    ALTER TABLE properties ENABLE TRIGGER trg_properties_updated_at;
  END IF;
END
$backfill$;

CREATE INDEX IF NOT EXISTS idx_properties_has_public_media_live
  ON properties (listing_type)
  WHERE has_public_media
    AND LOWER(COALESCE(status, '')) IN ('approved', 'live', 'published');

ANALYZE properties;
