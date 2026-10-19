-- Optional override for how a profile image is shown on agent cards.
-- NULL means unset. The public list then treats a logo-like image as a logo
-- and everything else as a portrait. WhatsApp stores 'logo' only when the
-- tidy step already kept the picture whole, so a later square light logo can
-- still be recognised. An explicit 'portrait' or 'logo' always wins.
-- Generated bios are never stored in agents.bio.

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS profile_photo_kind TEXT;

ALTER TABLE agents
  DROP CONSTRAINT IF EXISTS agents_profile_photo_kind_check;

ALTER TABLE agents
  ADD CONSTRAINT agents_profile_photo_kind_check
  CHECK (profile_photo_kind IS NULL OR profile_photo_kind IN ('portrait', 'logo'));
