-- expect-rows: >=3
-- Retired products stay inactive and say so; "Everyone remains Free by
-- default" leaves every description; listing_boost_basic takes the Boosted
-- amount from the rate card (config/pricing.js boosted).
UPDATE products
   SET active = CASE WHEN key IN ('agent_pro_monthly', 'featured_lender_monthly') THEN false ELSE active END,
       metadata = CASE WHEN key IN ('agent_pro_monthly', 'featured_lender_monthly')
                       THEN COALESCE(metadata, '{}'::jsonb) || '{"status":"retired","rate_card":"rate-card-20261008"}'::jsonb
                       ELSE metadata END,
       price = CASE WHEN key = 'listing_boost_basic' THEN
                 25000
               ELSE price END,
       description = NULLIF(TRIM(REGEXP_REPLACE(COALESCE(description, ''), '\s*Everyone remains Free by default\.?', '', 'gi')), ''),
       updated_at = NOW()
 WHERE key IN ('agent_pro_monthly', 'featured_lender_monthly', 'listing_boost_basic')
    OR description ILIKE '%Everyone remains Free by default%'
RETURNING key AS changed_id;
