-- 214_lister_settings_no_free_week.sql
-- No free week for private listings since 10 Nov 2026 (Arthur).
--
-- The billing code already works out free days from the date a listing went
-- live (config/publishedPricing.js ownerFreeDaysForListing), so this only
-- brings the stored settings into line:
--
-- 1. billing_settings.lister_fee.free_days -> 0, so nothing that reads the
--    stored setting can say "7 days free" again.
-- 2. The day-3 "seen by N people" message loses its "Your free week ends on
--    {free_until}." sentence. It now also goes to a new listing that has not
--    been paid for, as the reminder, so it must not mention a free week. Only
--    that sentence is taken out; any other wording the team edited stays.
--
-- Does not touch agents, listings or WhatsApp tables. Sends nothing.
-- Rollback: put the sentence back in Sales & Revenue > Settings.

SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '60s';

UPDATE billing_settings
   SET value = jsonb_set(value, '{free_days}', '0'::jsonb, true),
       updated_by = 'migration_214_no_free_week',
       updated_at = NOW()
 WHERE key = 'lister_fee'
   AND (value->>'free_days') IS DISTINCT FROM '0';

UPDATE billing_settings
   SET value = jsonb_set(
         value,
         '{text}',
         to_jsonb(replace(value->>'text', 'Your free week ends on {free_until}. ', '')),
         false
       ),
       updated_by = 'migration_214_no_free_week',
       updated_at = NOW()
 WHERE key = 'lister_views_message'
   AND (value->>'text') LIKE '%Your free week ends on {free_until}. %';
