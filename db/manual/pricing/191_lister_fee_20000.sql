-- expect-rows: 0|1
-- The private listing fee row back to the rate card amount (config/pricing.js
-- private_listing). 0 rows if Arthur already re-saved it in Admin.
UPDATE billing_settings
   SET value = jsonb_set(value, '{monthly_ugx}', to_jsonb(20000)),
       updated_by = 'rate-card-20261008', updated_at = NOW()
 WHERE key = 'lister_fee'
   AND (value->>'monthly_ugx') IS DISTINCT FROM '20000'
RETURNING key AS changed_id;
