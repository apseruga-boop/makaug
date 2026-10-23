-- These three public records describe the same 12-apartment complex offered
-- at USD 1.9 million. USD 24,000 is its monthly income, not its asking price.
-- Keep the recorded conversion rate and date; do not introduce a new FX quote.
-- Match only the audited old facts, so a subsequent staff correction wins.

UPDATE properties
   SET listing_type = 'sale',
       transaction_type = 'sale',
       property_type = 'Apartment complex',
       bedrooms = NULL,
       price_period = 'once',
       price = 1900000 * price_fx_rate_ugx,
       price_original = 1900000,
       extra_fields = COALESCE(extra_fields, '{}'::jsonb) || jsonb_build_object(
         'price_currency', 'UGX',
         'price_original_currency', 'USD',
         'price_original', 1900000,
         'seo_fact_correction_156', jsonb_build_object(
           'source', 'Listing description: 12 apartments; monthly income USD 24,000; on sale USD 1.9 million.',
           'previous', jsonb_build_object(
             'listing_type', listing_type,
             'transaction_type', transaction_type,
             'property_type', property_type,
             'bedrooms', bedrooms,
             'price_period', price_period,
             'price', price,
             'price_original', price_original,
             'extra_price_currency', extra_fields->'price_currency',
             'extra_price_original_currency', extra_fields->'price_original_currency',
             'extra_price_original', extra_fields->'price_original'
           )
         )
       ),
       updated_at = NOW()
 WHERE current_setting('app.country_code', true) = 'UG'
   AND id IN (
     '250495cb-ddef-4499-a6d8-b977c2287193'::uuid,
     'c7c9e859-2c2a-429a-b565-3a27c4cc3d55'::uuid,
     '15ca0488-2702-4a93-8dd8-c30225d65c8d'::uuid
   )
   AND listing_type IN ('rent', 'sale')
   AND transaction_type IS NULL
   AND property_type IS NULL
   AND bedrooms = 3
   AND price_period IN ('mo', 'once')
   AND price = 91200000
   AND price_original = 24000
   AND price_currency = 'UGX'
   AND price_original_currency = 'USD'
   AND price_fx_rate_ugx = 3800
   AND CONCAT_WS(' ', description, extra_fields->>'source_caption')
       ~* '12[[:space:]]+fully[[:space:]]+furnished[[:space:]]+apartments'
   AND CONCAT_WS(' ', description, extra_fields->>'source_caption')
       ~* 'monthly[[:space:]]+income[[:space:]]+USD[[:space:]]*24,?000'
   AND CONCAT_WS(' ', description, extra_fields->>'source_caption')
       ~* 'on[[:space:]]+sale[[:space:]]+USD[[:space:]]*1[.]9[[:space:]]*million';
