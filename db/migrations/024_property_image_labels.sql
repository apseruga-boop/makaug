ALTER TABLE property_images
  ADD COLUMN IF NOT EXISTS slot_key TEXT;

ALTER TABLE property_images
  ADD COLUMN IF NOT EXISTS room_label TEXT;
