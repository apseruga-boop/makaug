WITH kazi AS (
  SELECT id
  FROM agents
  WHERE id = 'c0bc49f9-aaaa-4093-b5c5-37ac73da7106'::uuid
    AND status = 'approved'
  LIMIT 1
)
UPDATE off_plan_developments AS development
SET
  source_agent_id = kazi.id,
  source_display_name = 'Kazi Honest',
  status = 'published',
  verification_status = 'partially_verified',
  description = 'Townhouse project in Entebbe with 2, 3 and 4 bedroom homes. Kazi Honest supplied four project images, investor-offer pricing, a 15-month payment period and a USD 1,500 reservation figure. The developer, delivery date, exact site pin, construction percentage and unit availability are still being confirmed.',
  area = 'Entebbe',
  district = 'Wakiso',
  latitude = 0.0512000,
  longitude = 32.4637000,
  project_type = 'Townhouse development',
  launch_price_ugx = 410400000,
  reservation_fee_ugx = 5700000,
  original_currency = 'USD',
  discount_percentage = 40,
  payment_plan_months = 15,
  unit_types = '[
    {"key":"2-bedroom-townhouse","label":"2 Bedroom townhouse","bedrooms":2,"property_type":"Townhouse","price_original":108000,"price_original_currency":"USD","price_ugx":410400000,"price_fx_rate_ugx":3800,"bathrooms":null,"size_sqm":null},
    {"key":"3-bedroom-townhouse","label":"3 Bedroom townhouse","bedrooms":3,"property_type":"Townhouse","price_original":144000,"price_original_currency":"USD","price_ugx":547200000,"price_fx_rate_ugx":3800,"bathrooms":null,"size_sqm":null},
    {"key":"4-bedroom-townhouse","label":"4 Bedroom townhouse","bedrooms":4,"property_type":"Townhouse","price_original":177000,"price_original_currency":"USD","price_ugx":672600000,"price_fx_rate_ugx":3800,"bathrooms":null,"size_sqm":null}
  ]'::jsonb,
  payment_plan = '[
    {"key":"reservation","label":"Reserve a unit","kind":"fixed","amount_original":1500,"amount_ugx":5700000,"currency":"USD","due":"At reservation","source_confirmed":true,"staff_verified":false},
    {"key":"balance","label":"Offer price balance","kind":"equal_monthly","months":15,"due":"Across 15 months","source_confirmed":true,"staff_verified":false}
  ]'::jsonb,
  images = '[
    {"url":"/assets/off-plan/entebbe-victoria-palms/construction-interior-1.jpg","caption":"Current interior construction photo supplied by Kazi Honest","kind":"construction_photo"},
    {"url":"/assets/off-plan/entebbe-victoria-palms/construction-interior-2.jpg","caption":"Current townhouse interior construction photo supplied by Kazi Honest","kind":"construction_photo"},
    {"url":"/assets/off-plan/entebbe-victoria-palms/bedroom-render.jpg","caption":"Artist impression supplied by Kazi Honest - final finishes may differ","kind":"artist_impression"},
    {"url":"/assets/off-plan/entebbe-victoria-palms/residents-lounge-render.jpg","caption":"Artist impression supplied by Kazi Honest - final facilities may differ","kind":"artist_impression"}
  ]'::jsonb,
  extra_fields = COALESCE(development.extra_fields, '{}'::jsonb) || '{
    "public_preview_approved":true,
    "public_preview_approved_source":"site_owner_request_2026_09_04",
    "source":"kazi_honest_direct_submission",
    "source_profile_link_pending":false,
    "map_precision":"area_centroid",
    "canonical_location_id":"wakiso:entebbe",
    "price_fx_rate_ugx":3800,
    "price_fx_basis":"makaug indicative USD guide rate",
    "confirmed_source_fields":["project name","area","unit types","USD prices","40 percent investor offer","15 month payment period","USD 1500 reservation figure","four supplied images"],
    "facts_to_confirm":["developer identity","completion date","exact site pin","construction percentage","total units","units sold","units available"]
  }'::jsonb,
  published_at = COALESCE(development.published_at, NOW()),
  updated_at = NOW()
FROM kazi
WHERE development.country_code = 'UG'
  AND development.slug = 'entebbe-victoria-palms';

