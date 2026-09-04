-- Off Plan area/contact enrichment remains source-attributed and editable.
-- The project pin is still an area centroid; no unverified distance claim is stored.
UPDATE agents
SET profile_photo_url = COALESCE(NULLIF(profile_photo_url, ''), '/assets/agents/kazi-honest-professional-v2.jpg?v=20260901b'),
    updated_at = NOW()
WHERE id = 'c0bc49f9-aaaa-4093-b5c5-37ac73da7106';

UPDATE off_plan_developments
SET nearby_places = CASE
      WHEN jsonb_array_length(COALESCE(nearby_places, '[]'::jsonb)) = 0 THEN
        '[
          {"category":"Transport","name":"Entebbe International Airport","note":"Entebbe area landmark; confirm travel time from the exact development site.","source_url":"https://caa.go.ug/entebbe-international-airport/","staff_verified":true},
          {"category":"Healthcare","name":"Entebbe Regional Referral Hospital","note":"Public regional referral hospital serving the Entebbe area; confirm travel time from the exact development site.","source_url":"https://nho.health.go.ug/regions/Entebbe%20Regional%20Referral%20Hospital","staff_verified":true}
        ]'::jsonb
      ELSE nearby_places
    END,
    extra_fields = COALESCE(extra_fields, '{}'::jsonb) || jsonb_build_object(
      'area_overview', 'Entebbe sits on a Lake Victoria peninsula and is Uganda''s international aviation gateway, about 40 kilometres south-west of Kampala. The wider area includes Entebbe Regional Referral Hospital. School names, exact travel times and the relationship to the development must be confirmed after the exact project pin is verified.',
      'area_last_reviewed_at', '2026-09-04',
      'area_sources', jsonb_build_array(
        jsonb_build_object('label', 'Uganda Civil Aviation Authority - Entebbe International Airport', 'url', 'https://caa.go.ug/entebbe-international-airport/'),
        jsonb_build_object('label', 'Uganda Ministry of Health - Entebbe Regional Referral Hospital', 'url', 'https://nho.health.go.ug/regions/Entebbe%20Regional%20Referral%20Hospital')
      ),
      'nearby_places_note', 'Live Google Maps results show schools and hospitals around the area point. Confirm all distances after the exact site pin is verified.',
      'mortgage_provider_keys', jsonb_build_array('stanbic', 'dfcu', 'kcb'),
      'reservation_fee_original', 1500,
      'reservation_fee_original_currency', 'USD',
      'payment_terms_note', 'USD 1,500 reservation figure and a 15-month payment period were supplied by Kazi Honest. The instalment split, payment destination, fees and signed sale terms remain subject to developer confirmation.'
    ),
    updated_at = NOW()
WHERE country_code = 'UG'
  AND slug = 'entebbe-victoria-palms';
