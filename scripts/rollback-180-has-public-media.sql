-- Manual rollback for db/migrations/180_property_has_public_media.sql.
-- This file is not in db/migrations, so scripts/migrate.js does not run it.
--
-- Deploy the previous application first. That build reads photos and videos
-- with the old expression and ignores has_public_media. Dropping the column
-- while the new build is still serving will make public listing queries fail.
--
-- The stored flag is removed. Listing rows, images, and extra_fields are left
-- as they are. updated_at is not rewritten.

SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '120s';

DROP TRIGGER IF EXISTS property_images_public_media_insert ON property_images;
DROP TRIGGER IF EXISTS property_images_public_media_delete ON property_images;
DROP TRIGGER IF EXISTS property_images_public_media_update ON property_images;
DROP TRIGGER IF EXISTS properties_set_has_public_media ON properties;

DROP FUNCTION IF EXISTS property_images_refresh_public_media_insert();
DROP FUNCTION IF EXISTS property_images_refresh_public_media_delete();
DROP FUNCTION IF EXISTS property_images_refresh_public_media_update();
DROP FUNCTION IF EXISTS refresh_has_public_media_for_ids(uuid[]);
DROP FUNCTION IF EXISTS properties_set_has_public_media();
DROP FUNCTION IF EXISTS property_has_public_media(properties);

DROP INDEX IF EXISTS idx_properties_has_public_media_live;

ALTER TABLE properties DROP COLUMN IF EXISTS has_public_media;
