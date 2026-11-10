-- Found-online short stays are not to be messaged.
--
-- Additive on st_listing only. The table is about 80 rows, so this is a
-- metadata change plus one small update. It does not read properties, does
-- not send anything, and does not rewrite a row that is already flagged.
-- Migration 208 stored the mark in extra_fields and set source to imported.

SET LOCAL lock_timeout = '4s';
SET LOCAL statement_timeout = '8s';

ALTER TABLE st_listing
  ADD COLUMN IF NOT EXISTS do_not_message BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE st_listing
SET do_not_message = TRUE
WHERE do_not_message IS NOT TRUE
  AND (
    LOWER(COALESCE(extra_fields->>'do_not_message', '')) IN ('true', 't', '1', 'yes')
    OR COALESCE(extra_fields->>'found_online_label', '') <> ''
    OR source = 'imported'
  );

COMMENT ON COLUMN st_listing.do_not_message IS
  'Found online. The short-stay desks must not offer a message or WhatsApp action for this host.';
