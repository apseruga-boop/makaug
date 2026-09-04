-- First MakaUG-managed overseas off-plan project. Facts are limited to the two
-- agent PDFs supplied on 2026-09-04; missing developer, completion, stock and
-- construction facts remain explicitly unconfirmed.
INSERT INTO off_plan_developments (
  country_code, slug, name, developer_name, source_display_name, status,
  verification_status, description, area, district, address, latitude,
  longitude, project_type, launch_price_ugx, original_currency,
  reservation_fee_ugx, payment_plan_months, unit_types, payment_plan, images,
  floor_plans, amenities, nearby_places, brochure_settings, extra_fields,
  published_at
) VALUES (
  'KE',
  'spectre-westlands',
  'Spectre Westlands',
  NULL,
  'Karim - supplied agent documents',
  'published',
  'partially_verified',
  'Spectre is an off-plan residential development presented for Westlands Road, Nairobi, with one- and two-bedroom layouts, resident amenities and a 36-month developer payment plan. Developer identity, completion date, construction progress, live stock and final sale terms must be confirmed before funds are committed.',
  'Westlands',
  'Nairobi',
  'Westlands Road, Nairobi, Kenya',
  -1.2676000,
  36.8108000,
  'Apartment development',
  259600000,
  'KES',
  2950000,
  36,
  '[
    {"key":"one-bedroom-50","label":"1 Bedroom apartment - 50 m²","bedrooms":1,"bathrooms":1,"kitchens":1,"utility_rooms":1,"property_type":"Apartment","size_sqm":50,"price_original":8800000,"price_original_currency":"KES","price_ugx":259600000,"price_fx_rate_ugx":29.5},
    {"key":"one-bedroom-65","label":"1 Bedroom apartment - 65 m²","bedrooms":1,"bathrooms":1,"kitchens":1,"utility_rooms":1,"property_type":"Apartment","size_sqm":65,"price_original":null,"price_original_currency":"KES","price_ugx":null,"price_status":"Confirm current price with MakaUG"},
    {"key":"two-bedroom-100","label":"2 Bedroom apartment - 100 m²","bedrooms":2,"bathrooms":2,"kitchens":1,"utility_rooms":1,"property_type":"Apartment","size_sqm":100,"price_original":16700000,"price_original_currency":"KES","price_ugx":492650000,"price_fx_rate_ugx":29.5}
  ]'::jsonb,
  '[
    {"key":"reservation","label":"Reserve the selected apartment","kind":"fixed","amount_original":100000,"amount_ugx":2950000,"currency":"KES","due":"At reservation","source_confirmed":true,"staff_verified":false},
    {"key":"signing","label":"Payment on signing / booking","kind":"percentage","percent":20,"currency":"KES","due":"On signing or booking","source_confirmed":true,"staff_verified":false},
    {"key":"balance","label":"Remaining balance","kind":"equal_monthly","months":36,"currency":"KES","due":"Across 36 months","source_confirmed":true,"staff_verified":false}
  ]'::jsonb,
  '[
    {"url":"/assets/off-plan/spectre-westlands/nairobi-skyline.jpg","caption":"Nairobi skyline image from the supplied Spectre agent brochure","kind":"location_image"},
    {"url":"/assets/off-plan/spectre-westlands/arrival.jpg","caption":"Artist impression of the Spectre arrival from the supplied agent brochure; final finishes may differ","kind":"artist_impression"},
    {"url":"/assets/off-plan/spectre-westlands/residence.jpg","caption":"Artist impression of a Spectre residence from the supplied agent brochure; final finishes may differ","kind":"artist_impression"},
    {"url":"/assets/off-plan/spectre-westlands/business-centre.jpg","caption":"Artist impression of the business centre from the supplied agent brochure; final facilities may differ","kind":"artist_impression"},
    {"url":"/assets/off-plan/spectre-westlands/sky-terrace.jpg","caption":"Artist impression of the sky terrace from the supplied agent brochure; final facilities may differ","kind":"artist_impression"},
    {"url":"/assets/off-plan/spectre-westlands/infinity-pool.jpg","caption":"Artist impression of the infinity pool from the supplied agent brochure; final facilities may differ","kind":"artist_impression"},
    {"url":"/assets/off-plan/spectre-westlands/fitness-spa.jpg","caption":"Artist impression of the fitness and spa facilities from the supplied agent brochure; final facilities may differ","kind":"artist_impression"}
  ]'::jsonb,
  '[
    {"url":"/assets/off-plan/spectre-westlands/floor-plan-1br-50.jpg","caption":"1 bedroom 50 m² floor plan from the supplied Spectre floor-plan document","kind":"floor_plan","unit_key":"one-bedroom-50"},
    {"url":"/assets/off-plan/spectre-westlands/floor-plan-1br-65.jpg","caption":"1 bedroom 65 m² floor plan from the supplied Spectre floor-plan document","kind":"floor_plan","unit_key":"one-bedroom-65"},
    {"url":"/assets/off-plan/spectre-westlands/floor-plan-2br-100.jpg","caption":"2 bedroom 100 m² floor plan from the supplied Spectre floor-plan document","kind":"floor_plan","unit_key":"two-bedroom-100"}
  ]'::jsonb,
  '["Private terraces","Sky garden","Kids play area","Business centre","Yoga studio","Car parking","Restaurant","Spa and sauna","Fitness centre","Infinity pool","Concierge","Cinema"]'::jsonb,
  '[
    {"category":"Dining","name":"Nairobi Street Kitchen","note":"Named in the supplied Spectre location guide; confirm current operation and travel time."},
    {"category":"Dining","name":"Fogo Gaucho Westlands","note":"Named in the supplied Spectre location guide; confirm current operation and travel time."},
    {"category":"Shopping","name":"Sarit Centre","note":"Named in the supplied Spectre location guide; confirm the route and travel time."},
    {"category":"Shopping","name":"Westgate Shopping Mall","note":"Named in the supplied Spectre location guide; confirm the route and travel time."},
    {"category":"School","name":"Aga Khan Academy","note":"Named in the supplied Spectre location guide; confirm the relevant campus, admissions and travel time."},
    {"category":"School","name":"Nairobi International School","note":"Named in the supplied Spectre location guide; confirm the relevant campus, admissions and travel time."},
    {"category":"Healthcare","name":"Aga Khan University Hospital","note":"Named in the supplied Spectre location guide; confirm services, route and travel time."},
    {"category":"Healthcare","name":"MP Shah Hospital","note":"Named in the supplied Spectre location guide; confirm services, route and travel time."},
    {"category":"Transport","name":"Jomo Kenyatta International Airport","note":"The supplied brochure describes access to JKIA; confirm the route and travel time."},
    {"category":"Transport","name":"Wilson Airport","note":"The supplied brochure describes access to Wilson Airport; confirm the route and travel time."}
  ]'::jsonb,
  '{"brand":"makaug.com","footer_url":"https://makaug.com/off-plan/overseas/kenya/spectre-westlands","contact_mode":"makaug_managed"}'::jsonb,
  '{
    "public_preview_approved":true,
    "public_preview_approved_source":"site_owner_request_2026_09_04",
    "contact_mode":"makaug_managed",
    "source_documents_verified":true,
    "source":"karim_supplied_spectre_agent_pdfs_2026_09_04",
    "map_precision":"area_centroid",
    "country_name":"Kenya",
    "country_slug":"kenya",
    "region":"Africa",
    "public_path":"/off-plan/overseas/kenya/spectre-westlands",
    "reservation_fee_original":100000,
    "reservation_fee_original_currency":"KES",
    "price_fx_rate_ugx":29.5,
    "price_fx_basis":"Illustrative KES to UGX reference for the calculator; refresh before relying on it",
    "price_fx_as_of":"2026-09-04",
    "area_overview":"Westlands is a major mixed-use district in Nairobi with shopping, dining, schools, healthcare and transport connections. The supplied Spectre brochure names nearby destinations, but the exact site entrance, route distances and current operating details must be checked independently.",
    "payment_terms_note":"The supplied agent brochure states a KES 100,000 reservation fee, 20 percent on signing or booking, and the balance over 36 months. All amounts, due dates, bank details, taxes, fees and refund terms must be confirmed in the developer offer letter and sale agreement.",
    "overseas_finance_policy":"This may not qualify as a standard Ugandan residential mortgage. Ask your bank whether it can finance a Kenyan off-plan purchase, what security it requires, how foreign-currency payments are handled and when funds can be released.",
    "makaug_service_steps":["Initial requirements and affordability call","Source and project-document review","Independent Kenyan lawyer and title checks","Developer and offer-letter coordination","Bank and foreign-currency payment coordination","Milestone follow-up through handover"],
    "official_buyer_guidance":[
      {"label":"Kenya Ministry of Lands - official search certificate","url":"https://lands.go.ke/issuance-search-certificate","note":"Use the official land-registry process and an independent Kenyan lawyer to verify the registered owner, title and encumbrances."},
      {"label":"Kenya Land Registration Act","url":"https://new.kenyalaw.org/akn/ke/act/2012/3/eng@2022-12-31","note":"Review the current legal framework with an independent Kenyan lawyer before signing or transferring funds."}
    ],
    "roi_projections":[
      {"unit_key":"one-bedroom-50","furnished_percent":23.68,"unfurnished_percent":14.21},
      {"unit_key":"one-bedroom-65","furnished_percent":22.26,"unfurnished_percent":14.85},
      {"unit_key":"two-bedroom-100","furnished_percent":20.68,"unfurnished_percent":12.41}
    ],
    "roi_disclaimer":"Projected figures from the supplied agent brochure only. They are not guaranteed returns and require independent verification of rent, occupancy, costs, tax and exchange-rate assumptions.",
    "confirmed_source_fields":["project name","Westlands Road location label","one and two bedroom layouts","50, 65 and 100 square metre plans","KES 8.8 million starting price for 50 square metre one bedroom","KES 16.7 million starting price for 100 square metre two bedroom","KES 100,000 reservation fee","20 percent on signing or booking","36 month balance period","brochure amenity list"],
    "facts_to_confirm":["developer legal identity","expected completion date","exact site pin","construction progress","total units","units sold","units available","current stock and prices","final payment dates","taxes and transaction fees"],
    "translations":{
      "lg":{"description":"Spectre pulojekiti y’amaka ga off-plan ku Westlands Road mu Nairobi, erimu apartimenti z’ekisenge kimu n’ebisenge bibiri n’enteekateeka y’okusasula eya myezi 36. Omuzimbi, olunaku lw’okuggwa, enkulaakulana, amaka agaliwo n’endagaano ezisembayo birina okukakasibwa nga tonnasasula.","area_overview":"Westlands kitundu kikulu mu Nairobi ekirimu amaduuka, eby’okulya, amasomero, ebyobulamu n’entambula. Ebifo ebyogerwako mu brochure birina okukakasibwa n’amabanga okuva ku mulyango gwennyini."},
      "sw":{"description":"Spectre ni mradi wa makazi wa off-plan uliowasilishwa kwa Westlands Road, Nairobi, wenye nyumba za chumba kimo na viwili na mpango wa malipo wa miezi 36. Msanidi, tarehe ya kukamilika, maendeleo, hisa iliyopo na masharti ya mwisho lazima yathibitishwe kabla ya kulipa.","area_overview":"Westlands ni eneo kuu la matumizi mchanganyiko Nairobi lenye ununuzi, migahawa, shule, afya na usafiri. Maeneo yaliyotajwa kwenye brosha na umbali kutoka lango halisi lazima yathibitishwe."},
      "ac":{"description":"Spectre obedo purujekti me odi me off-plan i Westlands Road, Nairobi, ma tye ki odi me ot nino acel ki aryo ki yub cul me dwe 36. Lagwedo, nino me tyeko, kit gedo, odi ma tye ki cik me cato myero kimok mapwod pe iculo.","area_overview":"Westlands obedo kabedo madit i Nairobi ma tye ki cuk, cam, gang kwan, ot yat ki yo. Kabedo ma brochure owaco ki borgi ki dog gang kikome myero kimok."},
      "ny":{"description":"Spectre ni pulojekiti y’amaka ga off-plan aha Westlands Road, Nairobi, erimu apartimenti y’ekishenge kimwe n’ebishenge bibiri hamwe n’enteekateeka y’okusasura y’amezi 36. Omwombeki, ebiro by’okuhendera, entunguuka, amaka agariho n’ebiragiro by’aha muheru biine kuhamibwa otakashiishe.","area_overview":"Westlands n’ekicweka kikuru omuri Nairobi ekirimu amaduuka, eby’okurya, amashomero, eby’obujanjabi n’entambura. Emyanya eri omu brochure n’oburaingwa kuruga aha muryango gw’enyini biine kuhamibwa."},
      "rn":{"description":"Spectre ni pulojekiti y’amaka ga off-plan aha Westlands Road, Nairobi, erimu apartimenti y’ekishenge kimwe n’ebishenge bibiri hamwe n’enteekateeka y’okusasura y’amezi 36. Omwombeki, ebiro by’okuhendera, entunguuka, amaka agariho n’ebiragiro biine kuhamibwa otakashiishe.","area_overview":"Westlands n’ekicweka kikuru omuri Nairobi ekirimu amaduuka, amashomero, eby’obujanjabi n’entambura. Emyanya eri omu brochure n’oburaingwa biine kuhamibwa."},
      "sm":{"description":"Spectre pulojekiti y’amaka ga off-plan ku Westlands Road mu Nairobi, erimu apartimenti edh’ekisenge kimu n’ebisenge bibiri n’enteekateeka y’okusasula eya myezi 36. Omuzimbi, olunaku lw’okumaliriza, okuzimba, amaka agaliwo n’endagaano birina okukakasibwa nga tonasasula.","area_overview":"Westlands kitundu kikulu mu Nairobi ekirimu amaduuka, eby’okulya, amasomero, ebyobulamu n’entambula. Ebifo ebiri mu brochure n’amabanga birina okukakasibwa."},
      "am":{"description":"Spectre በናይሮቢ ዌስትላንድስ ሮድ ላይ የቀረበ ከፕላን የሚሸጥ የመኖሪያ ፕሮጀክት ሲሆን አንድና ሁለት መኝታ ቤቶች እና የ36 ወር የክፍያ ዕቅድ አለው። ከመክፈልዎ በፊት አልሚው፣ የማጠናቀቂያ ቀን፣ ሂደት፣ ክምችትና ውል መረጋገጥ አለባቸው።","area_overview":"ዌስትላንድስ በናይሮቢ የገበያ፣ ምግብ፣ ትምህርት፣ ጤናና ትራንስፖርት አገልግሎቶች ያሉበት ዋና አካባቢ ነው። በብሮሹሩ የተጠቀሱ ቦታዎችና ርቀቶች መረጋገጥ አለባቸው።"},
      "ar":{"description":"سبكتر مشروع سكني على المخطط في طريق ويستلاندز بنيروبي، ويضم شققاً من غرفة وغرفتين وخطة سداد على 36 شهراً. يجب تأكيد هوية المطور وموعد الإنجاز والتقدم والوحدات المتاحة وشروط البيع النهائية قبل دفع أي أموال.","area_overview":"ويستلاندز منطقة رئيسية متعددة الاستخدامات في نيروبي وتضم التسوق والمطاعم والمدارس والرعاية الصحية والنقل. يجب التحقق من الأماكن المذكورة في الكتيب والمسافات من المدخل الفعلي للمشروع."}
    }
  }'::jsonb,
  NOW()
)
ON CONFLICT (country_code, slug) DO UPDATE SET
  source_display_name = EXCLUDED.source_display_name,
  description = EXCLUDED.description,
  area = EXCLUDED.area,
  district = EXCLUDED.district,
  address = EXCLUDED.address,
  latitude = EXCLUDED.latitude,
  longitude = EXCLUDED.longitude,
  launch_price_ugx = EXCLUDED.launch_price_ugx,
  original_currency = EXCLUDED.original_currency,
  reservation_fee_ugx = EXCLUDED.reservation_fee_ugx,
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
