const path = require('path');

const { buildListingReference } = require('./listingReferenceService');
const { SOURCE } = require('../scripts/seed-sourced-inventory-candidates');

const BAKAIMA_BATCH_ID = 'bakaima_authorised_land_20260518';
const BAKAIMA_SOURCE = SOURCE;
const BAKAIMA_CONTACT = {
  name: 'Bakaima Real Estate Agents',
  phone: '+256702060075',
  phoneAlt: '+256782936302',
  email: 'info@bakaima.co.ug',
  website: 'https://www.bakaima.co.ug',
  office: 'Ham Towers Makerere, 1st Floor',
};

const ASSET_DIR = path.join(__dirname, '..', 'assets', 'sourced', 'bakaima');
const PLATINUM_FLYER = path.join(ASSET_DIR, 'platinum-namugongo-papati-flyer.jpg');
const PRICE_SHEET = path.join(ASSET_DIR, 'bakaima-estates-price-sheet.jpg');

const ESTATES = [
  ['Bombo Road', 'Matugga-Kirplo Phase 4', 'Matugga', 'Wakiso', 12000000, 3600000, 8400000, 307900, 0.4638, 32.5268],
  ['Bombo Road', 'Kayule-Mbugo Estate', 'Mbugo', 'Wakiso', 16000000, 4800000, 11200000, 410500, 0.488, 32.562],
  ['Bombo Road', 'Dayton Estate Matugga', 'Matugga', 'Wakiso', 19000000, 5700000, 13300000, 487500, 0.4595, 32.528],
  ['Bombo Road', 'Atlas Estate Matugga Bukika', 'Bukika', 'Wakiso', 19000000, 5700000, 13300000, 487500, 0.474, 32.536],
  ['Bombo Road', 'Modern Estate Matugga', 'Matugga', 'Wakiso', 22500000, 6750000, 15750000, 577300, 0.462, 32.533],
  ['Bombo Road', 'Quinton Estate Matugga', 'Matugga', 'Wakiso', 24000000, 7200000, 16800000, 615800, 0.466, 32.529],
  ['Bombo Road', 'Matugga Sanga Estate Phase 2', 'Sanga', 'Wakiso', 25000000, 7500000, 17500000, 641500, 0.478, 32.513],
  ['Ziroobwe Road', 'Gayaza Busika Estate', 'Busika', 'Wakiso', 13500000, 4050000, 9450000, 346400, 0.544, 32.656],
  ['Ziroobwe Road', 'Kiwenda-Kireka Estate', 'Kiwenda', 'Wakiso', 14000000, 4200000, 9800000, 359200, 0.528, 32.619],
  ['Ziroobwe Road', 'Calvary Estate Kiwenda', 'Kiwenda', 'Wakiso', 16500000, 4950000, 11550000, 423400, 0.524, 32.625],
  ['Ziroobwe Road', 'Creamland Estate Kasozi', 'Kasozi', 'Wakiso', 24000000, 7200000, 16800000, 615800, 0.561, 32.625],
  ['Ziroobwe Road', 'Horizon Estate Kiwenda', 'Kiwenda', 'Wakiso', 27000000, 8100000, 18900000, 692800, 0.526, 32.633],
  ['Ziroobwe Road', 'Blessed Estate Kasozi', 'Kasozi', 'Wakiso', 27000000, 8100000, 18900000, 692800, 0.558, 32.631],
  ['Ziroobwe Road', 'Gayaza Kiwenda Estate', 'Kiwenda', 'Wakiso', 30000000, 9000000, 21000000, 769800, 0.521, 32.616],
  ['Ziroobwe Road', 'Cradleland Estate Busukuma-Nabutiti', 'Nabutiti', 'Wakiso', 32000000, 9600000, 22400000, 821100, 0.583, 32.615],
  ['Gayaza Road', 'Elite Estate Kijudde', 'Kijudde', 'Wakiso', 36000000, 10800000, 25200000, 923700, 0.508, 32.595],
  ['Gayaza Road', 'Beacon Estate Kijudde', 'Kijudde', 'Wakiso', 37000000, 11100000, 25900000, 949400, 0.512, 32.598],
  ['Gayaza Road', 'Wajona Estate Kijudde', 'Kijudde', 'Wakiso', 40000000, 12000000, 28000000, 1026400, 0.516, 32.602],
  ['Masaka Road', 'Mpigi Hill Estate', 'Mpigi', 'Mpigi', 13500000, 4050000, 9450000, 346400, -0.225, 32.322],
  ['Masaka Road', 'Pearl Estate Bulwanyi', 'Bulwanyi', 'Mpigi', 25000000, 7500000, 17500000, 641500, -0.124, 32.366],
  ['Mityana Road', 'Crown Estate Bujjuko', 'Bujjuko', 'Wakiso', 14500000, 4350000, 10150000, 372100, 0.348, 32.448],
  ['Hoima Road', 'Landmark Estate Kakiri', 'Kakiri', 'Wakiso', 15000000, 4500000, 10500000, 384900, 0.418, 32.388],
  ['Mukono-Kayunga Road', 'Pioneer Estate Nama', 'Nama', 'Mukono', 18000000, 5400000, 12600000, 461900, 0.486, 32.805],
  ['Entebbe Road', 'Urban-Hive Estate Nalubudde', 'Nalubudde', 'Wakiso', 42000000, 12600000, 29400000, 1077700, 0.159, 32.529],
  ['Entebbe Road', 'Haven Estate Kitende Kitovu', 'Kitende', 'Wakiso', 55000000, 16500000, 38500000, 1411300, 0.197, 32.535],
  ['Entebbe Road', 'Kawuku Bwerenga Estate', 'Bwerenga', 'Wakiso', 90000000, 27000000, 63000000, 2309300, 0.103, 32.523],
  ['Jinja Road', 'Paramount Estate', 'Namanve', 'Mukono', 29600000, 8880000, 20720000, 759500, 0.358, 32.684],
  ['Jinja Road', 'Everest Estate Mukono Municipality', 'Mukono Central', 'Mukono', 35000000, 10500000, 24500000, 898100, 0.353, 32.755],
  ['Namugongo Road', 'Durban Estate Bukerere', 'Bukerere', 'Wakiso', 32000000, 9600000, 22400000, 821100, 0.386, 32.704],
  ['Namugongo Road', 'Platinum Estate Namugongo-Papati', 'Namugongo-Papati', 'Wakiso', 70000000, 21000000, 49000000, 1796200, 0.389, 32.668],
  ['Kalagi Road', 'Hilton Estate Manyangwa', 'Manyangwa', 'Wakiso', 43000000, 12900000, 30100000, 1103400, 0.498, 32.642],
  ['Kalagi Road', 'Gayaza-Nakwero Estate', 'Nakwero', 'Wakiso', 60000000, 18000000, 42000000, 1539600, 0.486, 32.615],
  ['Kira-Kasangati Road', 'Kira-Prime Estate Behind Green Hill Academy', 'Kira', 'Wakiso', 75000000, 22500000, 52500000, 1924400, 0.408, 32.641],
].map(([road, estate, area, district, price, deposit, bankFinance, monthlyPayment, latitude, longitude], index) => ({
  number: index + 1,
  road,
  estate,
  area,
  district,
  price,
  deposit,
  bankFinance,
  monthlyPayment,
  latitude,
  longitude,
}));

function publicBaseUrl() {
  return (process.env.PUBLIC_BASE_URL || 'https://makaug.com').replace(/\/+$/, '');
}

function assetPublicUrl(filePath) {
  const fileName = path.basename(filePath);
  return `${publicBaseUrl()}/assets/sourced/bakaima/${fileName}`;
}

function money(value) {
  return `USh ${Number(value || 0).toLocaleString('en-UG')}`;
}

function escapeSvg(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function svgCardDataUrl(item) {
  const title = `${item.estate}`;
  const subtitle = `${item.area}, ${item.district} | ${item.road}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="820" viewBox="0 0 1280 820">
  <rect width="1280" height="820" fill="#f7fbef"/>
  <rect x="0" y="0" width="1280" height="145" fill="#2f7d42"/>
  <rect x="80" y="210" width="1120" height="470" rx="34" fill="#ffffff" stroke="#2f7d42" stroke-width="7"/>
  <text x="110" y="90" font-family="Arial, sans-serif" font-size="44" font-weight="800" fill="#ffffff">makaug.com | Bakaima authorised listing</text>
  <text x="125" y="318" font-family="Arial, sans-serif" font-size="58" font-weight="800" fill="#111827">${escapeSvg(title)}</text>
  <text x="125" y="390" font-family="Arial, sans-serif" font-size="34" fill="#374151">${escapeSvg(subtitle)}</text>
  <text x="125" y="485" font-family="Arial, sans-serif" font-size="46" font-weight="800" fill="#2f7d42">${escapeSvg(money(item.price))}</text>
  <text x="125" y="548" font-family="Arial, sans-serif" font-size="30" fill="#374151">50x100ft estate plot | Private Mailo land to verify before approval</text>
  <text x="125" y="610" font-family="Arial, sans-serif" font-size="28" fill="#8a1f45">Bakaima: 0702060075 / 0782936302</text>
</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

function whatsappShareMessage(item, propertyUrl) {
  return [
    `Hi, this is ${BAKAIMA_CONTACT.name}.`,
    `${item.estate} plots are now prepared on makaug.com for review.`,
    `Location: ${item.area}, ${item.district} (${item.road})`,
    `Price: ${money(item.price)} for a 50x100ft plot.`,
    `ABSA financing guide: 30% deposit ${money(item.deposit)}, 70% bank finance ${money(item.bankFinance)}, monthly guide ${money(item.monthlyPayment)} over 3 years.`,
    `View listing: ${propertyUrl}`,
    `Call/WhatsApp: ${BAKAIMA_CONTACT.phone} or ${BAKAIMA_CONTACT.phoneAlt}`,
  ].join('\n');
}

function descriptionFor(item) {
  return `${item.estate} is a Bakaima Real Estate Agents estate plot opportunity around ${item.area}, ${item.district}, off ${item.road}. The supplied flyer positions the plots as 50x100ft estate plots with Bakaima sales support and ABSA land-loan financing guidance. The quoted cash price is ${money(item.price)}. The financing guide shows 30% deposit of ${money(item.deposit)}, 70% bank finance of ${money(item.bankFinance)}, and an estimated monthly payment of ${money(item.monthlyPayment)} over 3 years. Verify exact plot number, access road, title particulars, boundary marks, and availability with Bakaima before public approval.`;
}

function extraFieldsFor(item, propertyUrl = '') {
  const priceSheetUrl = assetPublicUrl(PRICE_SHEET);
  const platinumFlyerUrl = assetPublicUrl(PLATINUM_FLYER);
  const flyerUrls = /platinum estate/i.test(item.estate)
    ? [platinumFlyerUrl, priceSheetUrl]
    : [priceSheetUrl];
  return {
    sourced_inventory_candidate: true,
    source_batch: BAKAIMA_BATCH_ID,
    source: BAKAIMA_SOURCE,
    agent_permission_reported: true,
    permission_status: 'founder_reported_agent_authorised_upload',
    consent_required: false,
    consent_confirmed: true,
    image_rights_confirmed: true,
    image_rights_status: 'authorised_agent_flyer_images_supplied',
    owner_or_agent_name: BAKAIMA_CONTACT.name,
    public_display_name: BAKAIMA_CONTACT.name,
    lister_registration_status: 'agent_authorised_pending_profile_match',
    contact_source_status: 'flyer_and_founder_confirmed',
    contact_phone_alt: BAKAIMA_CONTACT.phoneAlt,
    website: BAKAIMA_CONTACT.website,
    office: BAKAIMA_CONTACT.office,
    road: item.road,
    plot_size: '50x100ft',
    plot_size_sqft: 5000,
    plot_size_acres: 0.115,
    financing_provider: 'ABSA Bank Uganda land loan guide',
    financing_deposit_percent: 30,
    financing_bank_percent: 70,
    financing_term_years: 3,
    financing_deposit_ugx: item.deposit,
    financing_bank_finance_ugx: item.bankFinance,
    financing_monthly_payment_ugx: item.monthlyPayment,
    resolved_location_label: `${item.estate}, ${item.area}, ${item.district}`,
    map_pin_status: 'approximate_from_flyer_road_and_estate_name_needs_final_confirmation',
    map_pin_confirmed: false,
    latitude_source: 'manual_estate_area_pin',
    longitude_source: 'manual_estate_area_pin',
    source_labels: ['agent supplied flyer', 'founder confirmed permission', 'Bakaima Real Estate Agents'],
    source_urls: [BAKAIMA_CONTACT.website, ...flyerUrls],
    photo_source_urls: flyerUrls,
    authorised_flyer_urls: flyerUrls,
    whatsapp_share_card: propertyUrl ? whatsappShareMessage(item, propertyUrl) : '',
    review_required_steps: [
      'Confirm exact plot pin/boundaries with Bakaima before public approval',
      'Confirm the estate row price and financing guide are still current',
      'Confirm title and availability for the specific plot being sold',
      'Approve using sourced candidate override only after consent and image rights are accepted',
    ],
  };
}

function imageRowsFor(item) {
  const rows = [
    {
      url: svgCardDataUrl(item),
      slot_key: 'agent_card',
      room_label: 'Bakaima listing share card',
      is_primary: true,
      sort_order: 0,
    },
  ];
  if (/platinum estate/i.test(item.estate)) {
    rows.push({
      url: assetPublicUrl(PLATINUM_FLYER),
      slot_key: 'estate_flyer',
      room_label: 'Authorised Platinum estate flyer and site plan',
      is_primary: false,
      sort_order: rows.length,
    });
  }
  rows.push({
    url: assetPublicUrl(PRICE_SHEET),
    slot_key: 'price_sheet',
    room_label: 'Authorised Bakaima estate price sheet',
    is_primary: false,
    sort_order: rows.length,
  });
  return rows;
}

function buildBakaimaListing(item) {
  const inquiryReference = buildListingReference();
  return {
    listing_type: 'land',
    title: `${item.estate} - 50x100ft Bakaima Estate Plot`,
    description: descriptionFor(item),
    district: item.district,
    area: item.area,
    address: `${item.estate}, ${item.area}, ${item.district}`,
    price: item.price,
    price_period: 'once',
    bedrooms: null,
    bathrooms: null,
    property_type: 'Estate Plot',
    title_type: 'Private Mailo',
    year_built: null,
    furnishing: null,
    contract_months: null,
    deposit_amount: item.deposit,
    land_size_value: 0.115,
    land_size_unit: 'acre',
    floor_area_sqm: null,
    usable_size_sqm: null,
    parking_bays: null,
    nearest_university: null,
    distance_to_uni_km: null,
    room_type: null,
    room_arrangement: null,
    commercial_intent: null,
    latitude: item.latitude,
    longitude: item.longitude,
    students_welcome: false,
    verification_terms_accepted: false,
    inquiry_reference: inquiryReference,
    id_number: null,
    id_document_name: null,
    id_document_url: null,
    new_until: new Date(Date.now() + (30 * 24 * 60 * 60 * 1000)),
    amenities: JSON.stringify(['Road access', 'Estate layout', 'ABSA financing guide', '50x100ft plot']),
    extra_fields: JSON.stringify(extraFieldsFor(item)),
    lister_name: BAKAIMA_CONTACT.name,
    lister_phone: BAKAIMA_CONTACT.phone,
    lister_email: BAKAIMA_CONTACT.email,
    lister_type: 'agent',
    agent_id: null,
    source: BAKAIMA_SOURCE,
    listed_via: 'sourced_inventory',
    status: 'pending',
    moderation_stage: 'submitted',
    reviewed_at: null,
    moderation_notes: `BAKAIMA AUTHORISED LISTING. Founder confirmed permission to upload Bakaima flyer inventory. Exact plot pin, title details, and availability still need final admin review before public approval. Batch: ${BAKAIMA_BATCH_ID}.`,
    moderation_reason: 'Pending King review of exact plot pin, title, availability, and sourced candidate approval override.',
    images: imageRowsFor(item),
    source_item: item,
  };
}

function plannedBakaimaListings() {
  return ESTATES.map(buildBakaimaListing);
}

async function cleanupBakaimaBatch(client) {
  const deleted = await client.query(
    `DELETE FROM properties
     WHERE source = $1
       AND extra_fields->>'source_batch' = $2
     RETURNING id`,
    [BAKAIMA_SOURCE, BAKAIMA_BATCH_ID]
  );
  return { properties: deleted.rowCount };
}

async function insertListing(client, listing) {
  const inserted = await client.query(
    `INSERT INTO properties (
      listing_type, title, description, district, area, address, price, price_period,
      bedrooms, bathrooms, property_type, title_type, year_built, furnishing,
      contract_months, deposit_amount, land_size_value, land_size_unit,
      floor_area_sqm, usable_size_sqm, parking_bays, nearest_university,
      distance_to_uni_km, room_type, room_arrangement, commercial_intent,
      latitude, longitude, students_welcome, verification_terms_accepted,
      inquiry_reference, id_number, id_document_name, id_document_url, new_until,
      amenities, extra_fields, lister_name, lister_phone, lister_email,
      lister_type, agent_id, source, listed_via, status, moderation_stage,
      reviewed_at, moderation_notes, moderation_reason
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
      $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
      $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,
      $31,$32,$33,$34,$35,$36::jsonb,$37::jsonb,$38,$39,$40,
      $41,$42,$43,$44,$45,$46,$47,$48,$49
    ) RETURNING id::text AS id`,
    [
      listing.listing_type, listing.title, listing.description, listing.district,
      listing.area, listing.address, listing.price, listing.price_period,
      listing.bedrooms, listing.bathrooms, listing.property_type, listing.title_type,
      listing.year_built, listing.furnishing, listing.contract_months,
      listing.deposit_amount, listing.land_size_value, listing.land_size_unit,
      listing.floor_area_sqm, listing.usable_size_sqm, listing.parking_bays,
      listing.nearest_university, listing.distance_to_uni_km, listing.room_type,
      listing.room_arrangement, listing.commercial_intent, listing.latitude,
      listing.longitude, listing.students_welcome, listing.verification_terms_accepted,
      listing.inquiry_reference, listing.id_number, listing.id_document_name,
      listing.id_document_url, listing.new_until, listing.amenities,
      listing.extra_fields, listing.lister_name, listing.lister_phone,
      listing.lister_email, listing.lister_type, listing.agent_id, listing.source,
      listing.listed_via, listing.status, listing.moderation_stage, listing.reviewed_at,
      listing.moderation_notes, listing.moderation_reason,
    ]
  );
  const propertyId = inserted.rows[0].id;
  const propertyUrl = `${publicBaseUrl()}/property/${propertyId}`;

  for (const image of listing.images) {
    await client.query(
      `INSERT INTO property_images (property_id, url, is_primary, sort_order, slot_key, room_label)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [propertyId, image.url, image.is_primary, image.sort_order, image.slot_key, image.room_label]
    );
  }

  await client.query(
    `UPDATE properties
     SET extra_fields = COALESCE(extra_fields, '{}'::jsonb)
       || $2::jsonb
     WHERE id = $1`,
    [propertyId, JSON.stringify(extraFieldsFor(listing.source_item, propertyUrl))]
  );

  await client.query(
    `INSERT INTO property_moderation_events (
      property_id, actor_id, action, status_from, status_to, checklist, reason, notes, delivery
    ) VALUES ($1, $2, $3, NULL, 'pending', $4::jsonb, $5, $6, $7::jsonb)`,
    [
      propertyId,
      'bakaima_authorised_seed',
      'bakaima_authorised_land_listing_created',
      JSON.stringify({
        sourced_inventory_candidate: true,
        consent_confirmed: true,
        image_rights_confirmed: true,
        source_batch: BAKAIMA_BATCH_ID,
      }),
      listing.moderation_reason,
      listing.moderation_notes,
      JSON.stringify({
        batch_id: BAKAIMA_BATCH_ID,
        property_url: propertyUrl,
        whatsapp_share_card: whatsappShareMessage(listing.source_item, propertyUrl),
      }),
    ]
  );

  return {
    id: propertyId,
    title: listing.title,
    inquiry_reference: listing.inquiry_reference,
    property_url: propertyUrl,
    whatsapp_share_card: whatsappShareMessage(listing.source_item, propertyUrl),
  };
}

async function seedBakaimaAuthorisedListings({ db, replace = true } = {}) {
  if (!db?.pool) throw new Error('db.pool is required');
  const listings = plannedBakaimaListings();
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const cleanup = replace ? await cleanupBakaimaBatch(client) : null;
    const created = [];
    for (const listing of listings) {
      created.push(await insertListing(client, listing));
    }
    await client.query('COMMIT');
    return {
      ok: true,
      source: BAKAIMA_SOURCE,
      batch_id: BAKAIMA_BATCH_ID,
      replace,
      cleanup,
      created_properties: created.length,
      by_type: [{ listing_type: 'land', count: created.length }],
      contact: BAKAIMA_CONTACT,
      listings: created,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function summarizeBakaimaListings() {
  const listings = plannedBakaimaListings();
  return {
    count: listings.length,
    by_type: { land: listings.length },
    batch_id: BAKAIMA_BATCH_ID,
    contact: BAKAIMA_CONTACT,
    samples: listings.slice(0, 5).map((item) => ({
      title: item.title,
      area: item.area,
      district: item.district,
      price: item.price,
      images: item.images.length,
    })),
  };
}

module.exports = {
  BAKAIMA_BATCH_ID,
  BAKAIMA_SOURCE,
  BAKAIMA_CONTACT,
  ESTATES,
  plannedBakaimaListings,
  seedBakaimaAuthorisedListings,
  summarizeBakaimaListings,
  whatsappShareMessage,
};
