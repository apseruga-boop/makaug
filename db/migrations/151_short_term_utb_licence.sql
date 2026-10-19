-- Optional Uganda Tourism Board licence number on a short-stay listing.
-- Additive. Existing rows stay valid with NULL.

ALTER TABLE st_listing
  ADD COLUMN IF NOT EXISTS utb_licence_number TEXT;
