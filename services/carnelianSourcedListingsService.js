const path = require('path');

const { buildListingReference } = require('./listingReferenceService');
const {
  createOwnerEditToken,
  getOwnerPreviewUrl,
  hashOwnerEditToken,
  ownerEditTokenExpiry,
} = require('./listingModerationService');
const { SOURCE } = require('../scripts/seed-sourced-inventory-candidates');

const CARNELIAN_BATCH_ID = 'carnelian_youtube_authorised_20260519';
const CARNELIAN_SOURCE = SOURCE;
const CARNELIAN_CHANNEL_URL = 'https://www.youtube.com/@CarnelianPropertiesuganda';
const CARNELIAN_CONTACT = {
  name: 'Carnelian Properties Uganda',
  company: 'Carnelian Properties Uganda',
  phone: '+256700294005',
  phoneAlt: '+256785599477',
  email: 'carnelianproperties4@gmail.com',
  youtube: CARNELIAN_CHANNEL_URL,
  tiktok: null,
};

const ASSET_DIR = path.join(__dirname, '..', 'assets', 'sourced', 'carnelian');
const LOGO = path.join(ASSET_DIR, 'carnelian-logo.jpg');

const VIDEO_STORYBOARD_SOURCES = {
  'ocK_JJEB9yA': {
    main: 'https://i.ytimg.com/vi/ocK_JJEB9yA/maxresdefault.jpg',
    stills: [
      'https://i.ytimg.com/sb/ocK_JJEB9yA/storyboard3_L3/M2.jpg',
      'https://i.ytimg.com/sb/ocK_JJEB9yA/storyboard3_L3/M5.jpg',
      'https://i.ytimg.com/sb/ocK_JJEB9yA/storyboard3_L3/M8.jpg',
      'https://i.ytimg.com/sb/ocK_JJEB9yA/storyboard3_L3/M11.jpg',
    ],
  },
  NkF46IX5DrA: {
    main: 'https://i.ytimg.com/vi/NkF46IX5DrA/maxresdefault.jpg',
    stills: [
      'https://i.ytimg.com/sb/NkF46IX5DrA/storyboard3_L3/M2.jpg',
      'https://i.ytimg.com/sb/NkF46IX5DrA/storyboard3_L3/M5.jpg',
      'https://i.ytimg.com/sb/NkF46IX5DrA/storyboard3_L3/M8.jpg',
      'https://i.ytimg.com/sb/NkF46IX5DrA/storyboard3_L3/M11.jpg',
    ],
  },
};

const CARNELIAN_PROPERTIES = [
  {
    key: 'kira-modern-4bed',
    youtubeId: 'ocK_JJEB9yA',
    youtubeUrl: 'https://www.youtube.com/watch?v=ocK_JJEB9yA',
    sourceTitle: 'Full House Tour: Modern Home in Kira, Kampala Uganda',
    sourcePublishedLabel: '7 days ago on 19 May 2026 source check',
    title: '4-Bed Modern House in Kira on 14 Decimals',
    description: 'A modern 4-bedroom house for sale in Kira, Greater Kampala, set on approximately 14 decimals according to Carnelian Properties Uganda’s video tour. The walkthrough presents a clean family home with a bright exterior, tiled compound, modern interior finishes, fitted kitchen cabinetry, and multiple rooms shown in the tour. The asking price shared by Carnelian is USh 750,000,000 and is marked negotiable.',
    district: 'Wakiso',
    area: 'Kira',
    address: 'Kira, Wakiso, Greater Kampala',
    price: 750000000,
    bedrooms: 4,
    bathrooms: null,
    propertyType: 'Standalone House',
    landSizeValue: 14,
    landSizeUnit: 'decimals',
    latitude: 0.3978,
    longitude: 32.6414,
    mapPinLabel: 'Kira Municipal Council / Kira town centre, Wakiso',
    mapPinAccuracyNote: 'Closest responsible public pin from the video title/description and Kira town centre map evidence; confirm the exact house gate with Carnelian before public approval.',
    mapPinSource: 'manual_kira_municipal_area_pin_from_public_map_evidence',
    mapPinConfidence: 'area_level_close',
    amenities: ['Video tour available', 'Tiled compound', 'Fitted kitchen', 'Modern finishes', 'Gated access'],
    areaHighlights: 'Kira is a fast-growing Greater Kampala residential area with family homes, road connections, schools, shops, and quick access toward Najjera, Namugongo, Ntinda, and central Kampala routes.',
    nearbyFacilities: [
      { name: 'Kira Municipal Council offices', type: 'Public services', distanceKm: 0.2 },
      { name: 'NIRA Kira offices', type: 'Public services', distanceKm: 0.2 },
      { name: 'Kira town centre shops', type: 'Town centre', distanceKm: 0.3 },
      { name: 'Kira roundabout access', type: 'Transport link', distanceKm: 0.3 },
      { name: 'Namugongo Road access', type: 'Road access', distanceKm: 0.4 },
    ],
    photos: [
      ['kira-modern-4bed-01-main.jpg', 'Exterior/front view', true],
      ['kira-modern-4bed-02-still.jpg', 'Living area still', false],
      ['kira-modern-4bed-03-still.jpg', 'Kitchen/dining still', false],
      ['kira-modern-4bed-04-still.jpg', 'Bedroom still', false],
      ['kira-modern-4bed-05-still.jpg', 'Bathroom/interior still', false],
    ],
  },
  {
    key: 'kira-shimon-5bed',
    youtubeId: 'NkF46IX5DrA',
    youtubeUrl: 'https://www.youtube.com/watch?v=NkF46IX5DrA',
    sourceTitle: 'BRAND NEW HOUSE FOR SALE IN KIRA UGANDA | Full House Tour!',
    sourcePublishedLabel: '2 weeks ago on 19 May 2026 source check',
    title: '5-Bed Brand New House in Kira-Shimon on 12 Decimals',
    description: 'A brand new 5-bedroom house for sale in the Kira-Shimon Road area of Greater Kampala, set on approximately 12 decimals according to Carnelian Properties Uganda’s video tour. The home is presented as a fresh modern residence with a large exterior frontage, contemporary glazing, balcony space, fitted interior finishes, and multiple rooms captured in the walkthrough. The asking price shared by Carnelian is USh 650,000,000.',
    district: 'Wakiso',
    area: 'Kira-Shimon',
    address: 'Kira-Shimon Road, Kira, Wakiso',
    price: 650000000,
    bedrooms: 5,
    bathrooms: null,
    propertyType: 'Standalone House',
    landSizeValue: 12,
    landSizeUnit: 'decimals',
    latitude: 0.420556,
    longitude: 32.634722,
    mapPinLabel: 'Kira-Shimon / Kitikifumba corridor, Wakiso',
    mapPinAccuracyNote: 'Closest responsible corridor pin from the Kira-Shimon Road description; confirm the exact house gate with Carnelian before public approval.',
    mapPinSource: 'manual_kira_shimon_corridor_pin_from_public_map_evidence',
    mapPinConfidence: 'corridor_level',
    amenities: ['Video tour available', 'Brand new home', 'Balcony space', 'Modern glazing', 'Gated access'],
    areaHighlights: 'Kira-Shimon sits in the wider Kira residential corridor, useful for buyers who want a Kampala-accessible home with suburban space and links toward Kira, Najjera, Ntinda, and Namugongo.',
    nearbyFacilities: [
      { name: 'Kira-Shimon Road access', type: 'Road access', distanceKm: 0.4 },
      { name: 'Kitikifumba residential corridor', type: 'Neighbourhood', distanceKm: 0.6 },
      { name: 'Kira town centre access', type: 'Town centre', distanceKm: 2.5 },
      { name: 'Namugongo route access', type: 'Transport link', distanceKm: 2.8 },
      { name: 'Najjera route access', type: 'Transport link', distanceKm: 3.5 },
    ],
    photos: [
      ['kira-shimon-5bed-01-main.jpg', 'Exterior/front view', true],
      ['kira-shimon-5bed-02-still.jpg', 'Living area still', false],
      ['kira-shimon-5bed-03-still.jpg', 'Kitchen/dining still', false],
      ['kira-shimon-5bed-04-still.jpg', 'Bedroom still', false],
      ['kira-shimon-5bed-05-still.jpg', 'Bathroom/interior still', false],
    ],
  },
];

function publicBaseUrl() {
  return (process.env.PUBLIC_BASE_URL || 'https://makaug.com').replace(/\/+$/, '');
}

function assetPublicUrl(filePathOrName) {
  const fileName = path.basename(filePathOrName);
  return `${publicBaseUrl()}/assets/sourced/carnelian/${fileName}`;
}

function money(value) {
  return `USh ${Number(value || 0).toLocaleString('en-UG')}`;
}

function brokerBio() {
  return 'Carnelian Properties Uganda helps buyers, sellers, investors, and home seekers explore Uganda property through house tours, market insight, and practical real estate guidance. Their makaug profile is prepared from founder-confirmed onboarding details and their public Carnelian Properties Uganda channel.';
}

function whatsappShareMessage(item, propertyUrl, ownerPreviewUrl = '') {
  return [
    `Hi, this is ${CARNELIAN_CONTACT.name}.`,
    `${item.title} is prepared on makaug.com for King review.`,
    `Location: ${item.address}`,
    `Price: ${money(item.price)}.`,
    `Video tour: ${item.youtubeUrl}`,
    ownerPreviewUrl ? `Private preview: ${ownerPreviewUrl}` : '',
    `Public link after approval: ${propertyUrl}`,
    `Call/WhatsApp: ${CARNELIAN_CONTACT.phone} or ${CARNELIAN_CONTACT.phoneAlt}`,
  ].filter(Boolean).join('\n');
}

function imageRowsFor(item) {
  return item.photos.map(([file, label, isPrimary], index) => ({
    url: assetPublicUrl(file),
    slot_key: label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''),
    room_label: label,
    is_primary: Boolean(isPrimary),
    sort_order: index,
  }));
}

function extraFieldsFor(item, agentId = null, propertyUrl = '', ownerPreviewUrl = '') {
  const source = VIDEO_STORYBOARD_SOURCES[item.youtubeId] || {};
  return {
    sourced_inventory_candidate: true,
    source_batch: CARNELIAN_BATCH_ID,
    source_listing_key: item.key,
    source: CARNELIAN_SOURCE,
    agent_permission_reported: true,
    permission_status: 'founder_reported_agent_authorised_upload',
    consent_required: false,
    consent_confirmed: true,
    image_rights_confirmed: true,
    image_rights_status: 'authorised_youtube_stills_from_agent_channel',
    owner_or_agent_name: CARNELIAN_CONTACT.name,
    public_display_name: CARNELIAN_CONTACT.name,
    lister_registration_status: 'registered',
    broker_agent_id: agentId,
    broker_submission: true,
    contact_source_status: 'founder_confirmed_and_youtube_public_channel',
    contact_phone_alt: CARNELIAN_CONTACT.phoneAlt,
    youtube_channel_url: CARNELIAN_CONTACT.youtube,
    tiktok_url: CARNELIAN_CONTACT.tiktok,
    video_url: item.youtubeUrl,
    youtube_url: item.youtubeUrl,
    youtube_video_id: item.youtubeId,
    youtube_source_title: item.sourceTitle,
    youtube_source_published_label: item.sourcePublishedLabel,
    resolved_location_label: item.address,
    map_pin_label: item.mapPinLabel,
    map_pin_accuracy_note: item.mapPinAccuracyNote,
    map_pin_confidence: item.mapPinConfidence,
    map_pin_status: 'close_area_pin_from_youtube_description_needs_exact_gate_confirmation',
    map_pin_confirmed: false,
    latitude_source: item.mapPinSource,
    longitude_source: item.mapPinSource,
    area_highlights: item.areaHighlights,
    nearby_facilities: item.nearbyFacilities || [],
    source_labels: ['founder confirmed agent permission', 'Carnelian Properties Uganda YouTube channel', 'public video tour'],
    source_urls: [CARNELIAN_CONTACT.youtube, item.youtubeUrl],
    photo_source_urls: [source.main, ...(source.stills || [])].filter(Boolean),
    authorised_photo_urls: imageRowsFor(item).map((image) => image.url),
    property_url_status: 'public_after_approval',
    property_url: propertyUrl || '',
    owner_preview_url: ownerPreviewUrl || '',
    whatsapp_share_card: propertyUrl ? whatsappShareMessage(item, propertyUrl, ownerPreviewUrl) : '',
    review_required_steps: [
      'Confirm current availability and viewing contact with Carnelian',
      'Confirm exact road/pin before public approval',
      'Confirm bathroom count and any additional room details if Carnelian supplies them',
      'Replace or improve any video stills if Carnelian sends direct HD photos',
      'Approve using sourced candidate override only after consent and image rights are accepted',
    ],
  };
}

function buildCarnelianListing(item, agentId = null) {
  return {
    listing_type: 'sale',
    title: item.title,
    description: item.description,
    district: item.district,
    area: item.area,
    address: item.address,
    price: item.price,
    price_period: 'once',
    bedrooms: item.bedrooms,
    bathrooms: item.bathrooms,
    property_type: item.propertyType,
    title_type: null,
    year_built: 2026,
    furnishing: 'Unfurnished',
    contract_months: null,
    deposit_amount: null,
    land_size_value: item.landSizeValue,
    land_size_unit: item.landSizeUnit,
    floor_area_sqm: null,
    usable_size_sqm: null,
    parking_bays: 2,
    nearest_university: null,
    distance_to_uni_km: null,
    room_type: null,
    room_arrangement: null,
    commercial_intent: null,
    latitude: item.latitude,
    longitude: item.longitude,
    students_welcome: false,
    verification_terms_accepted: false,
    inquiry_reference: buildListingReference(),
    id_number: null,
    id_document_name: null,
    id_document_url: null,
    new_until: new Date(Date.now() + (30 * 24 * 60 * 60 * 1000)),
    amenities: JSON.stringify(item.amenities),
    extra_fields: JSON.stringify(extraFieldsFor(item, agentId)),
    lister_name: CARNELIAN_CONTACT.name,
    lister_phone: CARNELIAN_CONTACT.phone,
    lister_email: CARNELIAN_CONTACT.email,
    lister_type: 'agent',
    agent_id: agentId,
    source: CARNELIAN_SOURCE,
    listed_via: 'sourced_inventory',
    status: 'pending',
    moderation_stage: 'submitted',
    reviewed_at: null,
    moderation_notes: `CARNELIAN AUTHORISED LISTING. Founder reported Carnelian Properties Uganda consented to launch onboarding. Source video: ${item.youtubeUrl}. Confirm current availability, exact pin, bathroom count, and final owner/agent details before public approval. Batch: ${CARNELIAN_BATCH_ID}.`,
    moderation_reason: 'Pending King review of Carnelian source video, exact pin, availability, and sourced candidate approval override.',
    images: imageRowsFor(item),
    source_item: item,
  };
}

function plannedCarnelianListings(agentId = null) {
  return CARNELIAN_PROPERTIES.map((item) => buildCarnelianListing(item, agentId));
}

async function upsertCarnelianAgent(client) {
  const existing = await client.query(
    `SELECT id
     FROM agents
     WHERE licence_number = $1
        OR phone = $2
        OR whatsapp = $2
        OR LOWER(COALESCE(email, '')) = LOWER($3)
     ORDER BY updated_at DESC
     LIMIT 1`,
    ['CARNELIAN-YOUTUBE-20260519', CARNELIAN_CONTACT.phone, CARNELIAN_CONTACT.email]
  );
  const values = [
    CARNELIAN_CONTACT.name,
    CARNELIAN_CONTACT.company,
    'CARNELIAN-YOUTUBE-20260519',
    CARNELIAN_CONTACT.phone,
    CARNELIAN_CONTACT.phone,
    CARNELIAN_CONTACT.email,
    ['Kampala', 'Wakiso'],
    ['Homes for sale', 'Luxury homes', 'Video tours', 'Investment property'],
    assetPublicUrl(LOGO),
    brokerBio(),
    'Founder-confirmed Carnelian Properties Uganda onboarding from public YouTube channel and direct launch permission reported by founder.',
  ];

  if (existing.rows[0]?.id) {
    const updated = await client.query(
      `UPDATE agents
       SET full_name = $1,
           company_name = $2,
           licence_number = $3,
           registration_status = 'registered',
           listing_limit = 2147483647,
           phone = $4,
           whatsapp = $5,
           email = $6,
           districts_covered = $7::text[],
           specializations = $8::text[],
           profile_photo_url = $9,
           bio = $10,
           verification_reason = $11,
           privacy_consent_accepted = TRUE,
           privacy_consent_at = COALESCE(privacy_consent_at, NOW()),
           data_retention_notice_accepted = TRUE,
           data_retention_notice_at = COALESCE(data_retention_notice_at, NOW()),
           status = 'approved',
           approved_at = COALESCE(approved_at, NOW()),
           updated_at = NOW()
       WHERE id = $12
       RETURNING id::text AS id`,
      [...values, existing.rows[0].id]
    );
    return updated.rows[0].id;
  }

  const inserted = await client.query(
    `INSERT INTO agents (
      full_name, company_name, licence_number, registration_status, listing_limit,
      phone, whatsapp, email, districts_covered, specializations, profile_photo_url,
      bio, verification_reason, privacy_consent_accepted, privacy_consent_at,
      data_retention_notice_accepted, data_retention_notice_at, status, approved_at
    ) VALUES (
      $1,$2,$3,'registered',2147483647,$4,$5,$6,$7::text[],$8::text[],$9,
      $10,$11,TRUE,NOW(),TRUE,NOW(),'approved',NOW()
    )
    RETURNING id::text AS id`,
    values
  );
  return inserted.rows[0].id;
}

async function cleanupCarnelianBatch(client) {
  const deleted = await client.query(
    `DELETE FROM properties
     WHERE source = $1
       AND extra_fields->>'source_batch' = $2
     RETURNING id`,
    [CARNELIAN_SOURCE, CARNELIAN_BATCH_ID]
  );
  return { properties: deleted.rowCount };
}

async function insertListing(client, listing, agentId) {
  const ownerPreviewToken = createOwnerEditToken();
  const ownerPreviewTokenHash = hashOwnerEditToken(ownerPreviewToken);
  const ownerPreviewExpiresAt = ownerEditTokenExpiry();
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
      reviewed_at, moderation_notes, moderation_reason,
      owner_edit_token_hash, owner_edit_token_expires_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
      $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
      $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,
      $31,$32,$33,$34,$35,$36::jsonb,$37::jsonb,$38,$39,$40,
      $41,$42,$43,$44,$45,$46,$47,$48,$49,$50,$51
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
      listing.lister_email, listing.lister_type, agentId, listing.source,
      listing.listed_via, listing.status, listing.moderation_stage, listing.reviewed_at,
      listing.moderation_notes, listing.moderation_reason,
      ownerPreviewTokenHash, ownerPreviewExpiresAt,
    ]
  );
  const propertyId = inserted.rows[0].id;
  const propertyUrl = `${publicBaseUrl()}/property/${propertyId}`;
  const ownerPreviewUrl = getOwnerPreviewUrl({ id: propertyId }, ownerPreviewToken);

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
    [propertyId, JSON.stringify(extraFieldsFor(listing.source_item, agentId, propertyUrl, ownerPreviewUrl))]
  );

  await client.query(
    `INSERT INTO property_moderation_events (
      property_id, actor_id, action, status_from, status_to, checklist, reason, notes, delivery
    ) VALUES ($1, $2, $3, NULL, 'pending', $4::jsonb, $5, $6, $7::jsonb)`,
    [
      propertyId,
      'carnelian_authorised_seed',
      'carnelian_authorised_youtube_listing_created',
      JSON.stringify({
        sourced_inventory_candidate: true,
        consent_confirmed: true,
        image_rights_confirmed: true,
        source_batch: CARNELIAN_BATCH_ID,
        youtube_url: listing.source_item.youtubeUrl,
      }),
      listing.moderation_reason,
      listing.moderation_notes,
      JSON.stringify({
        batch_id: CARNELIAN_BATCH_ID,
        property_url: propertyUrl,
        owner_preview_url: ownerPreviewUrl,
        owner_preview_expires_at: ownerPreviewExpiresAt,
        agent_id: agentId,
        whatsapp_share_card: whatsappShareMessage(listing.source_item, propertyUrl, ownerPreviewUrl),
      }),
    ]
  );

  return {
    id: propertyId,
    title: listing.title,
    inquiry_reference: listing.inquiry_reference,
    property_url: propertyUrl,
    owner_preview_url: ownerPreviewUrl,
    owner_preview_expires_at: ownerPreviewExpiresAt,
    youtube_url: listing.source_item.youtubeUrl,
    whatsapp_share_card: whatsappShareMessage(listing.source_item, propertyUrl, ownerPreviewUrl),
  };
}

async function seedCarnelianAuthorisedListings({ db, replace = true } = {}) {
  if (!db?.pool) throw new Error('db.pool is required');
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const agentId = await upsertCarnelianAgent(client);
    const cleanup = replace ? await cleanupCarnelianBatch(client) : null;
    const created = [];
    for (const item of CARNELIAN_PROPERTIES) {
      const listing = buildCarnelianListing(item, agentId);
      created.push(await insertListing(client, listing, agentId));
    }
    await client.query('COMMIT');
    return {
      ok: true,
      source: CARNELIAN_SOURCE,
      batch_id: CARNELIAN_BATCH_ID,
      replace,
      cleanup,
      agent: {
        id: agentId,
        ...CARNELIAN_CONTACT,
        profile_photo_url: assetPublicUrl(LOGO),
      },
      created_properties: created.length,
      by_type: [{ listing_type: 'sale', count: created.length }],
      listings: created,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function summarizeCarnelianListings() {
  const listings = plannedCarnelianListings('00000000-0000-4000-8000-000000000000');
  return {
    count: listings.length,
    by_type: { sale: listings.length },
    batch_id: CARNELIAN_BATCH_ID,
    contact: CARNELIAN_CONTACT,
    samples: listings.map((item) => ({
      title: item.title,
      area: item.area,
      district: item.district,
      price: item.price,
      video_url: item.source_item.youtubeUrl,
      images: item.images.length,
    })),
  };
}

module.exports = {
  CARNELIAN_BATCH_ID,
  CARNELIAN_SOURCE,
  CARNELIAN_CONTACT,
  CARNELIAN_CHANNEL_URL,
  CARNELIAN_PROPERTIES,
  plannedCarnelianListings,
  seedCarnelianAuthorisedListings,
  summarizeCarnelianListings,
  whatsappShareMessage,
};
