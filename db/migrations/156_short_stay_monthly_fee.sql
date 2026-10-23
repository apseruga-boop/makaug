-- Arthur's rule, confirmed 23 Oct 2026.
-- Ordinary short-stay listings are UGX 20,000 for one month, with no free days.
-- Rows already paid or waived keep the term they were sold under. The next
-- charge uses the current tariff in application code.
-- Open pay links at the old UGX 50,000 short-stay amount are cancelled. The
-- card amount is stored on each link, so the next link is created at UGX 20,000.

SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '90s';

ALTER TABLE st_listing ALTER COLUMN listing_fee_ugx SET DEFAULT 20000;
ALTER TABLE st_listing ALTER COLUMN listing_term_months SET DEFAULT 1;

UPDATE st_listing
   SET listing_fee_ugx = 20000,
       listing_term_months = 1,
       updated_at = NOW()
 WHERE listing_fee_status IN ('unpaid', 'pending')
   AND listing_fee_ugx = 50000
   AND listing_term_months = 3;

UPDATE st_listing_payment AS p
   SET amount_ugx = 20000,
       covers_to = CURRENT_DATE + INTERVAL '1 month',
       notes = 'Short stay listing fee, UGX 20,000 for one month. No free days. No commission on any stay.'
  FROM st_listing AS l
 WHERE p.listing_id = l.id
   AND l.listing_fee_status IN ('unpaid', 'pending')
   AND p.status IN ('initiated', 'pending')
   AND p.amount_ugx = 50000;

UPDATE pay_links
   SET status = 'cancelled',
       updated_at = NOW()
 WHERE purpose = 'short_term_fee'
   AND status = 'open'
   AND amount_ugx = 50000;
