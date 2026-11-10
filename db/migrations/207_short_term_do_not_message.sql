-- Found-online short stays are not to be messaged.
--
-- Additive on st_listing only. Existing rows that already carry the flag in
-- extra_fields are copied onto the column. Nothing else is rewritten.

ALTER TABLE st_listing
  ADD COLUMN IF NOT EXISTS do_not_message BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE st_listing
SET do_not_message = TRUE
WHERE do_not_message IS NOT TRUE
  AND LOWER(COALESCE(extra_fields->>'do_not_message', '')) IN ('true', 't', '1', 'yes');

COMMENT ON COLUMN st_listing.do_not_message IS
  'Found online. The short-stay desks must not offer a message or WhatsApp action for this host.';
