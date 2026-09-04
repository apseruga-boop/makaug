-- Add approximate public-place reference points so the UI and brochure can show
-- straight-line distances from the displayed project area point. These are not
-- route distances and do not imply that the development entrance is verified.
UPDATE off_plan_developments
SET nearby_places = '[
      {"category":"Transport","name":"Entebbe International Airport","note":"Uganda''s principal international airport in the Entebbe area; confirm the route and travel time from the exact development entrance.","source_url":"https://caa.go.ug/entebbe-international-airport/","staff_verified":true,"latitude":0.044721,"longitude":32.443055,"coordinate_precision":"landmark_reference"},
      {"category":"Healthcare","name":"Entebbe Regional Referral Hospital","note":"Public regional referral hospital serving Entebbe; confirm current services and travel time from the exact site.","source_url":"https://entebbe.go.ug/ova_dep/public-health/","staff_verified":true,"latitude":0.063874,"longitude":32.471655,"coordinate_precision":"landmark_reference"},
      {"category":"University","name":"Nkumba University","note":"University in the wider Entebbe area. Confirm the relevant campus, route and travel time from the project.","source_url":"https://nkumbauniversity.ac.ug/academics/","staff_verified":true,"latitude":0.095,"longitude":32.5075,"coordinate_precision":"area_reference"},
      {"category":"University","name":"University of Kisubi","note":"University on the wider Kampala-Entebbe corridor. Confirm the route and travel time from the exact project site.","source_url":"https://unik.ac.ug/","staff_verified":true,"latitude":0.120272,"longitude":32.53279,"coordinate_precision":"area_reference"},
      {"category":"Shopping","name":"Victoria Mall Entebbe","note":"Shopping and leisure destination in Entebbe. Check current tenants, opening hours and the route from the development.","source_url":"https://victoriamall.wixsite.com/entebbe/about","staff_verified":true,"latitude":0.066486,"longitude":32.47634,"coordinate_precision":"landmark_reference"},
      {"category":"Recreation","name":"Entebbe Botanical Gardens","note":"Public botanical gardens in Entebbe; confirm current access arrangements, opening times and the route from the project.","source_url":"https://opm.go.ug/entebbe-botanical-gardens-transferred-to-ministry-of-tourism/","staff_verified":true,"latitude":0.06302,"longitude":32.47897,"coordinate_precision":"landmark_reference"},
      {"category":"Recreation","name":"Uganda Wildlife Conservation Education Centre","note":"Family-oriented wildlife conservation and education attraction in Entebbe. Confirm visitor information and travel time directly.","source_url":"https://www.tourism.go.ug/_files/ugd/2fa323_53ef7484bbcf46c18ebfcaf34b3fbcd0.pdf","staff_verified":true,"latitude":0.05325,"longitude":32.47638,"coordinate_precision":"landmark_reference"}
    ]'::jsonb,
    extra_fields = COALESCE(extra_fields, '{}'::jsonb) || jsonb_build_object(
      'nearby_distance_basis', 'Approximate straight-line distance from the displayed Entebbe area point. This is not a driving distance and the exact development entrance remains unverified.',
      'nearby_coordinates_last_reviewed_at', '2026-09-04'
    ),
    updated_at = NOW()
WHERE country_code = 'UG'
  AND slug = 'entebbe-victoria-palms';
