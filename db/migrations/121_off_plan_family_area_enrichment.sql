-- Expand the Entebbe family-area guide with source-attributed public references.
-- No distance or exact-site claim is stored while the project pin remains an area centroid.
UPDATE off_plan_developments
SET nearby_places = '[
      {"category":"Transport","name":"Entebbe International Airport","note":"Uganda''s principal international airport in the Entebbe area; confirm the route and travel time from the exact development entrance.","source_url":"https://caa.go.ug/entebbe-international-airport/","staff_verified":true},
      {"category":"Healthcare","name":"Entebbe Regional Referral Hospital","note":"Public regional referral hospital serving Entebbe; confirm current services and travel time from the exact site.","source_url":"https://entebbe.go.ug/ova_dep/public-health/","staff_verified":true},
      {"category":"University","name":"Nkumba University","note":"University in the wider Entebbe area. Confirm the relevant campus, route and travel time from the project.","source_url":"https://nkumbauniversity.ac.ug/academics/","staff_verified":true},
      {"category":"University","name":"University of Kisubi","note":"University on the wider Kampala-Entebbe corridor. Confirm the route and travel time from the exact project site.","source_url":"https://unik.ac.ug/","staff_verified":true},
      {"category":"Shopping","name":"Victoria Mall Entebbe","note":"Shopping and leisure destination in Entebbe. Check current tenants, opening hours and the route from the development.","source_url":"https://victoriamall.wixsite.com/entebbe/about","staff_verified":true},
      {"category":"Recreation","name":"Entebbe Botanical Gardens","note":"Public botanical gardens in Entebbe; confirm current access arrangements, opening times and the route from the project.","source_url":"https://opm.go.ug/entebbe-botanical-gardens-transferred-to-ministry-of-tourism/","staff_verified":true},
      {"category":"Recreation","name":"Uganda Wildlife Conservation Education Centre","note":"Family-oriented wildlife conservation and education attraction in Entebbe. Confirm visitor information and travel time directly.","source_url":"https://www.tourism.go.ug/_files/ugd/2fa323_53ef7484bbcf46c18ebfcaf34b3fbcd0.pdf","staff_verified":true}
    ]'::jsonb,
    extra_fields = COALESCE(extra_fields, '{}'::jsonb) || jsonb_build_object(
      'area_overview', 'Entebbe sits on a Lake Victoria peninsula and is Uganda''s international aviation gateway. For households with children, the wider area offers a mix of early-years and school options, public healthcare, universities, shopping and family recreation. Live Google Maps results below help families explore current schools, hospitals, clinics, universities, markets, supermarkets, parks and attractions around the area point. The development''s exact entrance, admission availability, service quality and travel times must be checked independently once the exact project pin is verified.',
      'area_last_reviewed_at', '2026-09-04',
      'area_sources', jsonb_build_array(
        jsonb_build_object('label', 'Uganda Civil Aviation Authority - Entebbe International Airport', 'url', 'https://caa.go.ug/entebbe-international-airport/'),
        jsonb_build_object('label', 'Entebbe Municipal Council - Public Health', 'url', 'https://entebbe.go.ug/ova_dep/public-health/'),
        jsonb_build_object('label', 'Nkumba University', 'url', 'https://nkumbauniversity.ac.ug/academics/'),
        jsonb_build_object('label', 'University of Kisubi', 'url', 'https://unik.ac.ug/'),
        jsonb_build_object('label', 'Victoria Mall Entebbe', 'url', 'https://victoriamall.wixsite.com/entebbe/about'),
        jsonb_build_object('label', 'Office of the Prime Minister - Entebbe Botanical Gardens', 'url', 'https://opm.go.ug/entebbe-botanical-gardens-transferred-to-ministry-of-tourism/'),
        jsonb_build_object('label', 'Ministry of Tourism - Uganda Wildlife Conservation Education Centre', 'url', 'https://www.tourism.go.ug/_files/ugd/2fa323_53ef7484bbcf46c18ebfcaf34b3fbcd0.pdf')
      ),
      'nearby_places_note', 'Live Google Maps results are grouped into schools and childcare, healthcare, universities, markets and shopping, recreation and transport. Confirm all routes and distances from the exact development entrance.',
      'off_plan_mortgage_policy', 'Mortgage eligibility for a home under construction is lender-specific. Confirm the construction stage, valuation timing, land title and security requirements, drawdown method, insurance, fees and minimum deposit directly with the lender before relying on a published residential rate.'
    ),
    updated_at = NOW()
WHERE country_code = 'UG'
  AND slug = 'entebbe-victoria-palms';
