-- Add the user-supplied AMRA project to the UAE review queue. The two source
-- PDFs do not contain current unit prices, availability, an exact map pin or
-- construction progress, so this record must remain private pending review.
INSERT INTO off_plan_developments (
  country_code, slug, name, developer_name, source_display_name, status,
  verification_status, description, area, district, address, latitude,
  longitude, project_type, completion_date, launch_price_ugx,
  original_currency, reservation_fee_ugx, payment_plan_months, unit_types,
  payment_plan, images, floor_plans, amenities, nearby_places,
  brochure_settings, extra_fields, published_at
) VALUES (
  'AE',
  'amra-umm-al-quwain',
  'AMRA',
  'Citi Developers',
  'Citi Developers - supplied AMRA factsheet and payment plan',
  'pending_review',
  'partially_verified',
  'AMRA is a fully furnished and serviced waterfront apartment development presented for the Umm Al Quwain Blue Carbon Zone. The supplied developer materials describe wellness-led residences, sea-facing amenities, a private-yacht marina and a 70/30 payment plan with three years after handover. Current unit prices, availability, approvals, service charges and the exact project pin must be confirmed before publication or payment.',
  'Umm Al Quwain Blue Carbon Zone',
  'Umm Al Quwain',
  'Umm Al Quwain, United Arab Emirates',
  NULL,
  NULL,
  'Fully furnished serviced apartments',
  '2029-12-31',
  NULL,
  'AED',
  NULL,
  36,
  '[
    {"key":"studio","label":"Studio apartment","bedrooms":0,"property_type":"Apartment","size_sqm":46.45,"size_sqft":500,"price_original":null,"price_original_currency":"AED","price_ugx":null,"price_status":"Current price to be confirmed with makaug.com"},
    {"key":"one-bedroom","label":"1 Bedroom apartment","bedrooms":1,"property_type":"Apartment","size_sqm":78.60,"size_sqft":846,"price_original":null,"price_original_currency":"AED","price_ugx":null,"price_status":"Current price to be confirmed with makaug.com"},
    {"key":"two-bedroom","label":"2 Bedroom apartment","bedrooms":2,"property_type":"Apartment","size_sqm":128.86,"size_sqft":1387,"price_original":null,"price_original_currency":"AED","price_ugx":null,"price_status":"Current price to be confirmed with makaug.com"},
    {"key":"three-bedroom","label":"3 Bedroom apartment","bedrooms":3,"property_type":"Apartment","size_sqm":177.91,"size_sqft":1915,"price_original":null,"price_original_currency":"AED","price_ugx":null,"price_status":"Current price to be confirmed with makaug.com"},
    {"key":"four-bedroom","label":"4 Bedroom apartment","bedrooms":4,"property_type":"Apartment","size_sqm":272.86,"size_sqft":2937,"price_original":null,"price_original_currency":"AED","price_ugx":null,"price_status":"Current price to be confirmed with makaug.com"}
  ]'::jsonb,
  '[
    {"key":"down-payment","label":"Down payment","kind":"percentage","percent":10,"currency":"AED","due":"At reservation","source_confirmed":true,"staff_verified":false},
    {"key":"spa-booking","label":"SPA booking date","kind":"percentage","percent":10,"currency":"AED","due":"On the SPA booking date","source_confirmed":true,"staff_verified":false},
    {"key":"installments-1-47","label":"Installments 1-47","kind":"percentage","percent":47,"installments":47,"currency":"AED","due":"Installments 1 through 47; exact dates to confirm","source_confirmed":true,"staff_verified":false},
    {"key":"installment-48","label":"Installment 48","kind":"percentage","percent":3,"currency":"AED","due":"Installment 48; exact date to confirm","source_confirmed":true,"staff_verified":false},
    {"key":"post-handover","label":"Three years post handover","kind":"percentage","percent":30,"months":36,"currency":"AED","due":"Across three years after handover","source_confirmed":true,"staff_verified":false},
    {"key":"admin-oqood","label":"Admin / Oqood fee","kind":"fixed","amount_original":5000,"currency":"AED","due":"Administrative charge; timing to confirm","source_confirmed":true,"staff_verified":false}
  ]'::jsonb,
  '[
    {"url":"/assets/off-plan/amra-umm-al-quwain/resort-overview.jpg","caption":"Artist impression of the AMRA waterfront resort from the supplied factsheet; final layout and finishes may differ","kind":"artist_impression"},
    {"url":"/assets/off-plan/amra-umm-al-quwain/tower-and-marina.jpg","caption":"Artist impression of an AMRA tower, rooftop facilities and marina from the supplied factsheet; final facilities may differ","kind":"artist_impression"},
    {"url":"/assets/off-plan/amra-umm-al-quwain/residence-lounge.jpg","caption":"Artist impression of an AMRA residence lounge from the supplied factsheet; final finishes may differ","kind":"artist_impression"},
    {"url":"/assets/off-plan/amra-umm-al-quwain/bedroom.jpg","caption":"Artist impression of an AMRA bedroom from the supplied factsheet; final finishes may differ","kind":"artist_impression"},
    {"url":"/assets/off-plan/amra-umm-al-quwain/sea-view-balcony.jpg","caption":"Artist impression of an AMRA sea-view balcony from the supplied factsheet; final view and finishes may differ","kind":"artist_impression"},
    {"url":"/assets/off-plan/amra-umm-al-quwain/rooftop-beach-club.jpg","caption":"Artist impression of an AMRA rooftop beach club from the supplied factsheet; final facilities may differ","kind":"artist_impression"},
    {"url":"/assets/off-plan/amra-umm-al-quwain/panoramic-gym.jpg","caption":"Artist impression of the AMRA panoramic gym from the supplied factsheet; final facilities may differ","kind":"artist_impression"},
    {"url":"/assets/off-plan/amra-umm-al-quwain/spa-lounge.jpg","caption":"Artist impression of an AMRA spa lounge from the supplied factsheet; final facilities may differ","kind":"artist_impression"}
  ]'::jsonb,
  '[]'::jsonb,
  '["Wellness centre","Hydrotherapy spa","Infinity pools","Panoramic gym","Yoga and Pilates studios","Boxing and martial arts zone","Squash court","Jogging track","Beach clubs","Private-yacht marina","Kids play area and daycare","Business centre and co-working space","Private cinema","Bowling and games room","Mini golf","Paddle and pickleball courts","Futsal and badminton courts","Restaurants and cafes","Organic market","App-managed rental service"]'::jsonb,
  '[
    {"category":"Nature","name":"Al Khor Mangroves","note":"The supplied factsheet describes direct access; confirm the exact access route and environmental restrictions."},
    {"category":"Leisure","name":"Al Marjan Island","note":"The supplied factsheet states approximately 20 minutes; confirm the current route and journey time."},
    {"category":"Transport","name":"Dubai International Airport","note":"The supplied factsheet states approximately 40 minutes; confirm the current route and journey time."}
  ]'::jsonb,
  '{"brand":"makaug.com","footer_url":"https://makaug.com/off-plan/overseas/united-arab-emirates/amra-umm-al-quwain","contact_mode":"makaug_managed","cover_image":"/assets/off-plan/amra-umm-al-quwain/resort-overview.jpg"}'::jsonb,
  '{
    "public_preview_approved":false,
    "contact_mode":"makaug_managed",
    "source_documents_verified":true,
    "source":"site_owner_supplied_amra_developer_pdfs_2026_09_10",
    "source_documents":[
      {"filename":"AMRA English Factsheet.pdf","sha256":"18eadff45b332fce2cb6eb086e921b0cc9369a0f95df369975764ff5d1566c75","bytes":60286745,"purpose":"developer factsheet"},
      {"filename":"AMRA Payment Plan.pdf","sha256":"7f23d84b2711751237e71de0ca532ee74186648f2b57f9676b6a98e89691fd3f","bytes":35864160,"purpose":"developer payment plan"}
    ],
    "map_precision":"exact_pin_pending",
    "country_name":"United Arab Emirates",
    "country_slug":"united-arab-emirates",
    "region":"Middle East",
    "public_path":"/off-plan/overseas/united-arab-emirates/amra-umm-al-quwain",
    "completion_source_label":"Q4 2029",
    "area_overview":"The supplied developer factsheet presents AMRA in the Umm Al Quwain Blue Carbon Zone with waterfront residences, mangrove access, resort facilities and road access toward Dubai and Al Marjan Island. The exact project entrance and travel times require independent confirmation.",
    "payment_terms_note":"The supplied payment plan states 10 percent down, 10 percent on the SPA booking date, 47 percent across installments 1-47, 3 percent at installment 48, and 30 percent over three years after handover. It also lists an AED 5,000 Admin / Oqood fee. Confirm exact dates, account details, refund terms and all other fees in the signed sale documents.",
    "overseas_finance_policy":"Ask your bank whether it can finance a UAE off-plan purchase, what security it requires and how it handles AED transfers and construction-stage payments.",
    "makaug_service_steps":["Initial requirements and affordability call","Source and project-document review","Independent UAE legal and regulatory checks","Developer and sale-document coordination","Bank and foreign-currency payment coordination","Milestone follow-up through handover"],
    "developer_website":"https://citideveloper.com/eoi/amra",
    "confirmed_source_fields":["project name","Citi Developers name","Umm Al Quwain Blue Carbon Zone location label","fully furnished and serviced apartments","Q4 2029 delivery statement","70/30 payment plan","three-year post-handover period","10 percent down payment","10 percent on SPA booking date","47 percent across installments 1-47","3 percent at installment 48","30 percent after handover","AED 5,000 Admin / Oqood fee","studio through four-bedroom unit mix","unit average areas","developer amenity list"],
    "facts_to_confirm":["current unit prices and availability","exact project map pin and entrance","project phase and definitive tower count","construction progress","total units and units sold","regulatory registration and approvals","service charges","exact installment dates and cadence","developer payment account and refund terms"]
  }'::jsonb,
  NULL
)
ON CONFLICT (country_code, slug) DO UPDATE SET
  name = EXCLUDED.name,
  developer_name = EXCLUDED.developer_name,
  source_display_name = EXCLUDED.source_display_name,
  status = CASE WHEN off_plan_developments.status = 'published' THEN off_plan_developments.status ELSE EXCLUDED.status END,
  verification_status = CASE WHEN off_plan_developments.verification_status = 'verified' THEN off_plan_developments.verification_status ELSE EXCLUDED.verification_status END,
  description = EXCLUDED.description,
  area = EXCLUDED.area,
  district = EXCLUDED.district,
  address = EXCLUDED.address,
  completion_date = EXCLUDED.completion_date,
  project_type = EXCLUDED.project_type,
  original_currency = EXCLUDED.original_currency,
  payment_plan_months = EXCLUDED.payment_plan_months,
  unit_types = EXCLUDED.unit_types,
  payment_plan = EXCLUDED.payment_plan,
  images = EXCLUDED.images,
  floor_plans = EXCLUDED.floor_plans,
  amenities = EXCLUDED.amenities,
  nearby_places = EXCLUDED.nearby_places,
  brochure_settings = EXCLUDED.brochure_settings,
  extra_fields = EXCLUDED.extra_fields,
  updated_at = NOW();

-- Spectre's public floor-plan gallery only accepts display-ready images. Remove
-- two uploaded PDFs and the unrelated dashboard screenshot from the live data.
UPDATE off_plan_developments
SET floor_plans = '[
  {"url":"/assets/off-plan/spectre-westlands/floor-plan-1br-50.jpg","caption":"1 bedroom 50 m² floor plan from the supplied Spectre floor-plan document","kind":"floor_plan","unit_key":"one-bedroom-50"},
  {"url":"/assets/off-plan/spectre-westlands/floor-plan-1br-65.jpg","caption":"1 bedroom 65 m² floor plan from the supplied Spectre floor-plan document","kind":"floor_plan","unit_key":"one-bedroom-65"},
  {"url":"/assets/off-plan/spectre-westlands/floor-plan-2br-100.jpg","caption":"2 bedroom 100 m² floor plan from the supplied Spectre floor-plan document","kind":"floor_plan","unit_key":"two-bedroom-100"}
]'::jsonb,
updated_at = NOW()
WHERE country_code = 'KE' AND slug = 'spectre-westlands';
