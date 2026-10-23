-- The source offers five double rental units for sale at UGX 160 million.
-- UGX 2.2 million is monthly income. The asking price is already correct;
-- the rent/month classification wrongly hides it under rental price bounds.
-- Preserve source text, amount, currency, location, media and approval facts.

UPDATE properties
   SET listing_type = 'sale',
       transaction_type = 'sale',
       property_type = 'Double rental units',
       price_period = 'once',
       extra_fields = COALESCE(extra_fields, '{}'::jsonb) || jsonb_build_object(
         'seo_fact_correction_159', jsonb_build_object(
           'source', 'Source caption: 5 double rental units; monthly income 2.2 million; on sale UGX 160 million.',
           'previous', jsonb_build_object(
             'listing_type', listing_type,
             'transaction_type', transaction_type,
             'property_type', property_type,
             'price_period', price_period,
             'updated_at', updated_at
           )
         )
       ),
       updated_at = NOW()
 WHERE current_setting('app.country_code', true) = 'UG'
   AND id = '7aafe4c1-4eb5-4e13-8e8d-28b78616710b'::uuid
   AND listing_type = 'rent'
   AND transaction_type IS NULL
   AND property_type IS NULL
   AND bedrooms IS NULL
   AND LOWER(title) = 'property for rent in kira-mulawa'
   AND price_period = 'mo'
   AND price = 160000000
   AND price_original = 160000000
   AND price_currency = 'UGX'
   AND price_original_currency = 'UGX'
   AND price_fx_rate_ugx IS NULL
   AND price_fx_as_of IS NULL
   AND price_on_application = FALSE
   AND NOT (COALESCE(extra_fields, '{}'::jsonb)
       ?| ARRAY['price_review', 'price_on_application', 'price_upon_application', 'seo_fact_correction_159'])
   AND extra_fields->>'source_caption' =
       'Kira Mulawa 5 double rental units monthly income 2.2 million on sale UGX 160 million... BANK PRESSURE 🔥🔥🔥';
