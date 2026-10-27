-- Arthur approved keeping A64E8E rejected as a duplicate, moving both
-- records to Land and copying its two video stills and one-acre size to
-- 3307F2. Reconfirmed for implementation on 27 October 2026.
-- Only these two Uganda records are eligible. No price, title, location,
-- approval or unrelated media changes. Before rows and replaced images are
-- retained. Manual rollback: scripts/rollback-193-mutundwe-land.sql.
SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS listing_correction_193_backup (
  property_id uuid PRIMARY KEY,
  before_row jsonb NOT NULL,
  before_images jsonb NOT NULL,
  after_images jsonb,
  inserted_image_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  applied_at timestamptz NOT NULL DEFAULT NOW(),
  rolled_back_at timestamptz
);

DO $correction$
DECLARE
  keeper_id uuid := '26883a3f-e5ba-4dd1-8aed-6ff02e05dd0d';
  duplicate_id uuid := 'a90d30c5-78eb-4896-ab34-b84b7e2d0da1';
  keeper properties%ROWTYPE;
  duplicate properties%ROWTYPE;
  image record;
  target_image_id uuid;
  inserted_id uuid;
  source_urls text[] := ARRAY[
    'https://media.makaug.com/whatsapp-employee-intake/video-key-frame/a90d30c5-78eb-4896-ab34-b84b7e2d0da1/1793078133960-32e174d6-8a31-4228-9ce6-ef297b6545d4.jpg',
    'https://media.makaug.com/whatsapp-employee-intake/video-key-frame/a90d30c5-78eb-4896-ab34-b84b7e2d0da1/1793078134831-aebfa086-93b6-468f-a728-3655fafa806f.jpg'
  ];
  old_urls text[] := ARRAY[
    'https://media.makaug.com/whatsapp-employee-intake/video-key-frame/26883a3f-e5ba-4dd1-8aed-6ff02e05dd0d/1792479220194-47768686-d78b-47da-a8ad-9d8440475e7a.jpg',
    'https://media.makaug.com/whatsapp-employee-intake/video-key-frame/26883a3f-e5ba-4dd1-8aed-6ff02e05dd0d/1792479220993-c834d5e0-a248-47ee-9b9e-1060d1c65c10.jpg'
  ];
  duplicate_note text := 'Duplicate of MK-20261016-3307F2. Keep the original one-acre Mutundwe listing live.';
BEGIN
  IF current_setting('app.country_code', true) IS DISTINCT FROM 'UG' THEN
    RAISE NOTICE 'listing_correction_193 skipped country_not_ug';
    RETURN;
  END IF;
  PERFORM id FROM properties WHERE id IN (keeper_id, duplicate_id) ORDER BY id FOR UPDATE;
  SELECT * INTO keeper FROM properties WHERE id = keeper_id;
  SELECT * INTO duplicate FROM properties WHERE id = duplicate_id;
  IF EXISTS (SELECT 1 FROM listing_correction_193_backup) THEN
    RAISE NOTICE 'listing_correction_193 skipped already_recorded';
    RETURN;
  END IF;
  IF keeper.id IS NULL OR duplicate.id IS NULL
    OR keeper.inquiry_reference IS DISTINCT FROM 'MK-20261016-3307F2'
    OR duplicate.inquiry_reference IS DISTINCT FROM 'MK-20261026-A64E8E'
    OR keeper.status IS DISTINCT FROM 'approved' OR duplicate.status IS DISTINCT FROM 'rejected'
    OR keeper.agent_id IS DISTINCT FROM '5674f6cb-37a0-4e1e-904f-06e03ec401ab'::uuid
    OR duplicate.agent_id IS DISTINCT FROM keeper.agent_id
    OR keeper.price IS DISTINCT FROM 1400000000 OR duplicate.price IS DISTINCT FROM 1400000000
    OR COALESCE(keeper.price_currency, 'UGX') <> 'UGX' OR COALESCE(duplicate.price_currency, 'UGX') <> 'UGX'
    OR keeper.title IS DISTINCT FROM 'Land for sale in Mutundwe'
    OR duplicate.title IS DISTINCT FROM 'Land for sale in Mutundwe'
    OR lower(keeper.area) IS DISTINCT FROM 'mutundwe' OR lower(duplicate.area) IS DISTINCT FROM 'mutundwe'
    OR keeper.district IS DISTINCT FROM 'Kampala' OR duplicate.district IS DISTINCT FROM 'Kampala'
    OR keeper.listing_type NOT IN ('sale', 'land') OR duplicate.listing_type NOT IN ('sale', 'land')
    OR COALESCE(keeper.transaction_type, 'sale') <> 'sale' OR COALESCE(duplicate.transaction_type, 'sale') <> 'sale'
    OR COALESCE(keeper.price_unit, 'total') <> 'total'
    OR (keeper.land_size_value IS NOT NULL AND keeper.land_size_value <> 1)
    OR COALESCE(keeper.land_size_unit, 'acres') <> 'acres'
    OR duplicate.land_size_value IS DISTINCT FROM 1 OR duplicate.land_size_unit IS DISTINCT FROM 'acres' THEN
    RAISE NOTICE 'listing_correction_193 skipped listing_guard';
    RETURN;
  END IF;
  -- Lock image rows before testing their current state. A newer staff image
  -- must never be overwritten by this historical correction.
  PERFORM id FROM property_images WHERE property_id IN (keeper_id, duplicate_id) ORDER BY id FOR UPDATE;
  IF (SELECT COUNT(*) FROM property_images WHERE property_id = duplicate_id
        AND ((slot_key = 'video_key_frame_1' AND url = source_urls[1])
          OR (slot_key = 'video_key_frame_2' AND url = source_urls[2]))) <> 2
    OR (SELECT COUNT(DISTINCT slot_key) FROM property_images WHERE property_id = duplicate_id
        AND slot_key IN ('video_key_frame_1', 'video_key_frame_2') AND url = ANY(source_urls)) <> 2
    OR EXISTS (SELECT 1 FROM property_images WHERE property_id = keeper_id
        AND slot_key IN ('video_key_frame_1', 'video_key_frame_2') AND NOT (url = ANY(old_urls) OR url = ANY(source_urls)))
    OR EXISTS (SELECT 1 FROM property_images WHERE property_id = keeper_id
        AND slot_key IN ('video_key_frame_1', 'video_key_frame_2') GROUP BY slot_key HAVING COUNT(*) > 1) THEN
    RAISE NOTICE 'listing_correction_193 skipped image_guard';
    RETURN;
  END IF;
  INSERT INTO listing_correction_193_backup (property_id, before_row, before_images)
    SELECT p.id, to_jsonb(p), COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id)
      FROM property_images i WHERE i.property_id = p.id), '[]'::jsonb)
    FROM properties p WHERE p.id IN (keeper_id, duplicate_id);

  FOR image IN SELECT * FROM property_images WHERE property_id = duplicate_id
      AND slot_key IN ('video_key_frame_1', 'video_key_frame_2') AND url = ANY(source_urls)
      ORDER BY sort_order, id LOOP
    SELECT id INTO target_image_id FROM property_images
      WHERE property_id = keeper_id AND slot_key = image.slot_key;
    IF target_image_id IS NOT NULL THEN
      UPDATE property_images SET url = image.url, room_label = image.room_label
        WHERE id = target_image_id;
    ELSE
      INSERT INTO property_images (property_id, url, is_primary, sort_order, slot_key, room_label)
      VALUES (keeper_id, image.url,
        image.slot_key = 'video_key_frame_1' AND NOT EXISTS (SELECT 1 FROM property_images WHERE property_id = keeper_id AND is_primary),
        image.sort_order, image.slot_key, image.room_label) RETURNING id INTO inserted_id;
      UPDATE listing_correction_193_backup SET inserted_image_ids = inserted_image_ids || to_jsonb(inserted_id::text)
        WHERE property_id = keeper_id;
    END IF;
  END LOOP;
  UPDATE listing_correction_193_backup b SET after_images = COALESCE((
    SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM property_images i WHERE i.property_id=b.property_id
  ), '[]'::jsonb);
  UPDATE properties SET listing_type = 'land', transaction_type = 'sale', price_unit = 'total',
    land_size_value = duplicate.land_size_value, land_size_unit = duplicate.land_size_unit,
    extra_fields = COALESCE(extra_fields, '{}'::jsonb) || jsonb_build_object(
      'listing_correction_193', jsonb_build_object('applied_at', NOW(), 'source_reference', duplicate.inquiry_reference),
      'image_count', (SELECT COUNT(*) FROM property_images WHERE property_id = keeper_id AND COALESCE(slot_key,'') NOT IN ('source_evidence_original','quarantined_source_evidence')),
      'public_image_count', (SELECT COUNT(*) FROM property_images WHERE property_id = keeper_id AND COALESCE(slot_key,'') NOT IN ('source_evidence_original','quarantined_source_evidence')),
      'primary_image_url', (SELECT url FROM property_images WHERE property_id = keeper_id AND COALESCE(slot_key,'') NOT IN ('source_evidence_original','quarantined_source_evidence') ORDER BY is_primary DESC, sort_order, created_at, id LIMIT 1)
    ), updated_at = NOW() WHERE id = keeper_id;
  UPDATE properties SET listing_type = 'land', transaction_type = 'sale',
    moderation_reason = duplicate_note,
    extra_fields = COALESCE(extra_fields, '{}'::jsonb) || jsonb_build_object(
      'listing_correction_193', jsonb_build_object('applied_at', NOW()),
      'moderation_reason', duplicate_note, 'duplicate_of_property_id', keeper_id::text,
      'duplicate_of_reference', keeper.inquiry_reference
    ), updated_at = NOW() WHERE id = duplicate_id;
  INSERT INTO property_moderation_events (property_id, actor_id, action, status_from, status_to, reason, notes, delivery)
    VALUES (duplicate_id, 'migration_193_arthur_approved', 'duplicate_land_correction', 'rejected', 'rejected', 'duplicate_listing', duplicate_note, '{"migration":"193"}'::jsonb);
  RAISE NOTICE 'listing_correction_193 applied keeper=% duplicate=%', keeper_id, duplicate_id;
END;
$correction$;
