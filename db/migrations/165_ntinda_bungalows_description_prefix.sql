-- The source offers two bungalows for sale at UGX 550 million. Only the
-- generated description prefix still calls them land. Preserve the asking
-- price, original source, tenant-income quote and every byte after the prefix.
SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '90s';
SET LOCAL TIME ZONE 'UTC';

UPDATE properties
   SET description = 'Bungalows for sale in Ntinda, Kampala, ' ||
                     SUBSTRING(description FROM LENGTH('Land for sale in Ntinda, Kampala, ') + 1),
       extra_fields = COALESCE(extra_fields, '{}'::jsonb) || jsonb_build_object(
         'inventory_copy_correction_165', jsonb_build_object(
           'applied_at', NOW(),
           'before_description', description,
           'before_updated_at', updated_at,
           'after_description_md5', md5('Bungalows for sale in Ntinda, Kampala, ' ||
                     SUBSTRING(description FROM LENGTH('Land for sale in Ntinda, Kampala, ') + 1)),
           'before_extra_md5', md5(COALESCE(extra_fields, '{}'::jsonb)::text),
           'reason', 'The original source explicitly offers two existing bungalows, not bare land.'
         )
       ),
       updated_at = NOW()
 WHERE current_setting('app.country_code', true) = 'UG'
   AND id = '8f1a194f-6edf-4892-adfc-e6eac8cf97c5'::uuid
   AND title = 'Bungalows for sale in Ntinda'
   AND listing_type = 'sale' AND transaction_type = 'sale'
   AND property_type = 'Bungalows'
   AND price = 550000000 AND price_original = 550000000
   AND price_currency = 'UGX' AND price_original_currency = 'UGX'
   AND price_fx_rate_ugx IS NULL AND price_fx_as_of IS NULL
   AND price_period = 'once' AND price_on_application = FALSE
   AND status = 'approved' AND area = 'Ntinda' AND district = 'Kampala'
   AND description LIKE 'Land for sale in Ntinda, Kampala, %'
   AND md5(description) = 'd2a3ff264aa217c3a6cee2bfbfb78c54'
   AND md5(COALESCE(extra_fields, '{}'::jsonb)::text) = 'efe1cdb149b172e55fa63fb94f74b020'
   AND updated_at = '2026-10-23 07:53:28.410838+00'::timestamptz
   AND NOT (COALESCE(extra_fields, '{}'::jsonb) ? 'inventory_copy_correction_165');
