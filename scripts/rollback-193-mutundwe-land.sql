-- Run manually in a transaction with app.country_code='UG'. This is not a
-- deploy migration. Keep the backup and historical moderation event.
-- Restore only records whose properties and image rows have not changed
-- since the correction. Newer staff edits leave that record untouched.
SET LOCAL lock_timeout = '8s';
DO $rollback$
DECLARE
  backup record;
  row_before properties;
  img jsonb;
  has_trigger boolean;
BEGIN
  IF current_setting('app.country_code', true) IS DISTINCT FROM 'UG' THEN RETURN; END IF;
  SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_properties_updated_at'
    AND tgrelid = 'properties'::regclass AND NOT tgisinternal) INTO has_trigger;
  IF has_trigger THEN ALTER TABLE properties DISABLE TRIGGER trg_properties_updated_at; END IF;
  FOR backup IN SELECT b.* FROM listing_correction_193_backup b JOIN properties p ON p.id=b.property_id
    WHERE b.rolled_back_at IS NULL AND p.updated_at=b.applied_at
      AND p.extra_fields ? 'listing_correction_193'
    ORDER BY p.id FOR UPDATE OF p LOOP
    PERFORM id FROM property_images WHERE property_id=backup.property_id ORDER BY id FOR UPDATE;
    -- Media edits also count even if a caller did not update properties.updated_at.
    IF COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM property_images i
        WHERE i.property_id=backup.property_id), '[]'::jsonb) IS DISTINCT FROM backup.after_images THEN
      RAISE NOTICE 'listing_correction_193 rollback skipped edited_media %', backup.property_id;
      CONTINUE;
    END IF;
    SELECT * INTO row_before FROM jsonb_populate_record(NULL::properties, backup.before_row);
    FOR img IN SELECT value FROM jsonb_array_elements(backup.before_images) LOOP
      UPDATE property_images SET url=img->>'url', room_label=img->>'room_label'
        WHERE id=(img->>'id')::uuid AND property_id=backup.property_id;
    END LOOP;
    DELETE FROM property_images WHERE property_id=backup.property_id
      AND id::text IN (SELECT jsonb_array_elements_text(backup.inserted_image_ids));
    UPDATE properties SET listing_type=row_before.listing_type, transaction_type=row_before.transaction_type,
      price_unit=row_before.price_unit,
      land_size_value=row_before.land_size_value, land_size_unit=row_before.land_size_unit,
      moderation_reason=row_before.moderation_reason, extra_fields=row_before.extra_fields, updated_at=row_before.updated_at
      WHERE id=backup.property_id;
    UPDATE listing_correction_193_backup SET rolled_back_at=NOW() WHERE property_id=backup.property_id;
    RAISE NOTICE 'listing_correction_193 rolled_back %', backup.property_id;
  END LOOP;
  IF has_trigger THEN ALTER TABLE properties ENABLE TRIGGER trg_properties_updated_at; END IF;
END;
$rollback$;
