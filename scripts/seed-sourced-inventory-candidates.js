#!/usr/bin/env node
'use strict';

require('dotenv').config();

const { buildListingReference } = require('../services/listingReferenceService');

const SOURCE = 'sourced_inventory_candidate_v1';
const DEFAULT_COUNT = 200;
const MAX_COUNT = 1000;
const SUPPORT_PHONE = process.env.SUPPORT_PHONE || process.env.SUPER_ADMIN_PHONE || '+256760112587';
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'info@makaug.com';

const args = new Set(process.argv.slice(2));
const countArg = process.argv.find((arg) => arg.startsWith('--count='));
const requestedCount = countArg ? Number.parseInt(countArg.split('=')[1], 10) : DEFAULT_COUNT;
const COUNT = Number.isFinite(requestedCount) && requestedCount > 0
  ? Math.min(requestedCount, MAX_COUNT)
  : DEFAULT_COUNT;
const DRY_RUN = args.has('--dry-run');
const REPLACE = args.has('--replace');
const CLEANUP = args.has('--cleanup');
const CONFIRM = args.has('--confirm');
const RUN_ID = process.env.SOURCED_INVENTORY_RUN_ID || `SIC-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;

const AREAS = [
  ['Central', 'Kampala', 'Kololo', 0.335, 32.588], ['Central', 'Kampala', 'Nakasero', 0.320, 32.580],
  ['Central', 'Kampala', 'Ntinda', 0.354, 32.616], ['Central', 'Kampala', 'Bugolobi', 0.318, 32.624],
  ['Central', 'Kampala', 'Muyenga', 0.291, 32.612], ['Central', 'Kampala', 'Kyanja', 0.398, 32.596],
  ['Central', 'Kampala', 'Makindye', 0.287, 32.586], ['Central', 'Wakiso', 'Kira', 0.397, 32.639],
  ['Central', 'Wakiso', 'Najjera', 0.387, 32.630], ['Central', 'Wakiso', 'Namugongo', 0.386, 32.660],
  ['Central', 'Wakiso', 'Entebbe', 0.061, 32.464], ['Central', 'Wakiso', 'Gayaza', 0.454, 32.611],
  ['Central', 'Mukono', 'Seeta', 0.366, 32.704], ['Central', 'Mukono', 'Mukono Central', 0.354, 32.755],
  ['Central', 'Masaka', 'Nyendo', -0.333, 31.734], ['Central', 'Luwero', 'Luwero Town', 0.849, 32.473],
  ['Eastern', 'Jinja', 'Jinja Central', 0.424, 33.204], ['Eastern', 'Jinja', 'Bugembe', 0.482, 33.240],
  ['Eastern', 'Mbale', 'Mbale Town', 1.080, 34.175], ['Eastern', 'Tororo', 'Tororo Town', 0.694, 34.181],
  ['Eastern', 'Iganga', 'Iganga Town', 0.609, 33.468], ['Eastern', 'Soroti', 'Soroti Town', 1.714, 33.611],
  ['Northern', 'Gulu', 'Gulu City', 2.774, 32.299], ['Northern', 'Lira', 'Lira City', 2.249, 32.899],
  ['Northern', 'Arua', 'Arua City', 3.020, 30.911], ['Northern', 'Kitgum', 'Kitgum Town', 3.288, 32.878],
  ['Western', 'Mbarara', 'Mbarara City', -0.607, 30.654], ['Western', 'Hoima', 'Hoima City', 1.431, 31.352],
  ['Western', 'Kabale', 'Kabale Town', -1.249, 29.989], ['Western', 'Kasese', 'Kasese Town', 0.184, 30.083],
  ['Western', 'Bushenyi', 'Ishaka', -0.540, 30.140], ['Western', 'Fort Portal', 'Fort Portal City', 0.671, 30.275]
].map(([region, district, area, lat, lng]) => ({ region, district, area, lat, lng }));

const STUDENT_CAMPUSES = [
  ['Makerere University', 'Kikoni', 'Kampala'],
  ['Kyambogo University', 'Kyambogo', 'Kampala'],
  ['MUBS', 'Nakawa', 'Kampala'],
  ['Uganda Christian University', 'Mukono Central', 'Mukono'],
  ['Mbarara University', 'Mbarara City', 'Mbarara'],
  ['Gulu University', 'Gulu City', 'Gulu']
];

const PLAN = [
  { type: 'sale', target: 55 },
  { type: 'rent', target: 55 },
  { type: 'student', target: 35 },
  { type: 'land', target: 35 },
  { type: 'commercial', target: 20 }
];

const TYPE_COPY = {
  sale: {
    title: ['Family home', 'Standalone house', 'Town house', 'Garden home', 'Modern bungalow'],
    propertyType: ['House', 'Bungalow', 'Townhouse', 'Villa'],
    highlights: ['secure neighbourhood', 'good road access', 'parking', 'near shops and schools']
  },
  rent: {
    title: ['Apartment', 'Maisonette', 'Two-bedroom unit', 'Courtyard home', 'Serviced flat'],
    propertyType: ['Apartment', 'House', 'Maisonette', 'Studio'],
    highlights: ['easy access to transport', 'water and power available', 'secure compound', 'near daily services']
  },
  student: {
    title: ['Student rooms', 'Student hostel', 'Shared student house', 'Campus rooms', 'Student apartment'],
    propertyType: ['Hostel', 'Student Room', 'Shared House', 'Bedsitter'],
    highlights: ['student-friendly area', 'close to campus routes', 'study-ready rooms', 'near food and transport']
  },
  land: {
    title: ['Residential plot', 'Estate plot', 'Commercial plot', 'Roadside plot', 'Land parcel'],
    propertyType: ['Residential Plot', 'Commercial Plot', 'Estate Plot', 'Agricultural Land'],
    highlights: ['road access', 'growing neighbourhood', 'clear boundaries to verify', 'near local services']
  },
  commercial: {
    title: ['Office space', 'Retail unit', 'Showroom space', 'Warehouse unit', 'Restaurant space'],
    propertyType: ['Office', 'Shop', 'Showroom', 'Warehouse', 'Restaurant Space'],
    highlights: ['visible frontage', 'business access', 'utilities nearby', 'flexible usage']
  }
};

function pick(items, index) {
  return items[index % items.length];
}

function moneyFor(type, index) {
  if (type === 'rent') return 600000 + ((index % 18) * 125000);
  if (type === 'student') return 250000 + ((index % 10) * 75000);
  if (type === 'commercial') return 1300000 + ((index % 16) * 300000);
  if (type === 'land') return 20000000 + ((index % 25) * 5000000);
  return 85000000 + ((index % 32) * 15000000);
}

function periodFor(type) {
  if (type === 'sale' || type === 'land') return 'once';
  if (type === 'student') return 'mo';
  return 'mo';
}

function titleFor(type, area, index) {
  const copy = TYPE_COPY[type] || TYPE_COPY.sale;
  return `Sourced candidate - ${area} ${pick(copy.title, index)}`;
}

function descriptionFor({ type, title, area, district, highlights, university }) {
  const base = `${title.replace(/^Sourced candidate -\s*/i, '')} around ${area}, ${district}. This is a MakaUg sourced inventory candidate prepared from market signals and internal sourcing notes.`;
  if (type === 'student') {
    return `${base} Draft positioning: ${highlights.join(', ')}. Campus context: ${university}. Verify availability, exact room rules, photos, and owner or agent permission before publishing.`;
  }
  if (type === 'land') {
    return `${base} Draft positioning: ${highlights.join(', ')}. Verify title details, exact acreage, boundary evidence, photos, and owner or agent permission before publishing.`;
  }
  if (type === 'commercial') {
    return `${base} Draft positioning: ${highlights.join(', ')}. Verify business use, measurements, photos, terms, and owner or agent permission before publishing.`;
  }
  return `${base} Draft positioning: ${highlights.join(', ')}. Verify availability, measurements, viewing contact, photos, and owner or agent permission before publishing.`;
}

function svgImage({ type, area, index, slot }) {
  const palette = {
    sale: ['#2f7d42', '#f4c542', '#f7fbf5'],
    rent: ['#3157b8', '#7fb7ff', '#f5f8ff'],
    student: ['#5b2b82', '#f4c542', '#faf5ff'],
    land: ['#1f6f45', '#9fcf8f', '#f6fbef'],
    commercial: ['#273142', '#f0b83f', '#f7f8fa']
  }[type] || ['#2f7d42', '#f4c542', '#f7fbf5'];
  const label = `${area} ${slot}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="820" viewBox="0 0 1280 820">
  <rect width="1280" height="820" fill="${palette[2]}"/>
  <rect x="0" y="0" width="1280" height="132" fill="${palette[0]}"/>
  <circle cx="${220 + ((index * 37) % 780)}" cy="${250 + ((index * 23) % 360)}" r="150" fill="${palette[1]}" opacity="0.22"/>
  <rect x="120" y="250" width="1040" height="360" rx="26" fill="#ffffff" stroke="${palette[0]}" stroke-width="8" opacity="0.92"/>
  <text x="150" y="82" font-family="Arial, sans-serif" font-size="44" font-weight="700" fill="#ffffff">makaug.com sourced candidate</text>
  <text x="150" y="365" font-family="Arial, sans-serif" font-size="62" font-weight="800" fill="#111827">${escapeSvg(label)}</text>
  <text x="150" y="455" font-family="Arial, sans-serif" font-size="34" fill="#374151">Placeholder photo - replace after owner/agent permission</text>
  <text x="150" y="535" font-family="Arial, sans-serif" font-size="30" fill="${palette[0]}">Candidate ${String(index).padStart(3, '0')} | ${type}</text>
</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

function escapeSvg(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function imageRows(type, area, index) {
  const slots = type === 'land'
    ? [['front', 'Main land view'], ['road', 'Access road'], ['boundary', 'Boundary view']]
    : [['front', 'Front view'], ['interior', 'Interior view'], ['room', 'Room view'], ['kitchen', 'Kitchen/utility'], ['bathroom', 'Bathroom/service']];
  return slots.map(([slotKey, roomLabel], idx) => ({
    url: svgImage({ type, area, index, slot: roomLabel }),
    slot_key: slotKey,
    room_label: roomLabel,
    is_primary: idx === 0,
    sort_order: idx
  }));
}

function buildExtraFields({ type, area, district, region, index, university }) {
  return {
    sourced_inventory_candidate: true,
    consent_required: true,
    permission_status: 'not_requested',
    do_not_approve_until: 'owner_or_agent_permission_confirmed',
    image_rights_status: 'generated_placeholder_images_only',
    contact_source_status: 'not_collected',
    candidate_run_id: RUN_ID,
    candidate_number: index,
    source_policy: 'No third-party wording or images copied. Candidate must be verified before approval.',
    source_labels: ['manual sourcing queue', 'public market signal placeholder'],
    source_urls: [],
    review_required_steps: [
      'Confirm owner or appointed agent permission',
      'Confirm phone or WhatsApp contact',
      'Replace placeholder images with authorised photos',
      'Verify exact price, location, availability, and ownership',
      'Run external duplicate scan before approval'
    ],
    public_display_blocker: 'Consent and ownership verification required before public approval.',
    public_display_name: 'MakaUg Sourcing Desk',
    preferred_contact_method: 'internal_review',
    city: district,
    region,
    resolved_location_label: `${area}, ${district}`,
    map_pin_confirmed: true,
    nin_match_confirmed: false,
    nearest_university: university || null,
    student_campus: university || null,
    sourced_candidate_notice: 'Pending admin sourcing review only. Not approved for public display.'
  };
}

function buildListing(sequence, type) {
  const typePlan = TYPE_COPY[type] || TYPE_COPY.sale;
  const areaMeta = pick(AREAS, sequence + type.length);
  const campus = type === 'student' ? pick(STUDENT_CAMPUSES, sequence) : null;
  const area = campus ? campus[1] : areaMeta.area;
  const district = campus ? campus[2] : areaMeta.district;
  const region = areaMeta.region;
  const latitude = Number((areaMeta.lat + ((sequence % 5) * 0.002)).toFixed(6));
  const longitude = Number((areaMeta.lng + ((sequence % 7) * 0.002)).toFixed(6));
  const title = titleFor(type, area, sequence);
  const highlights = [
    pick(typePlan.highlights, sequence),
    pick(typePlan.highlights, sequence + 1),
    pick(typePlan.highlights, sequence + 2)
  ];
  const bedrooms = type === 'land' || type === 'commercial' ? null : (type === 'student' ? 1 : 1 + (sequence % 5));
  const bathrooms = type === 'land' ? null : (type === 'student' ? 1 : 1 + (sequence % 3));
  const university = campus ? campus[0] : null;
  const listingReference = buildListingReference();
  const images = imageRows(type, area, sequence);
  const extraFields = buildExtraFields({ type, area, district, region, index: sequence, university });
  const moderationNotes = [
    'SOURCED INVENTORY CANDIDATE.',
    'Do not approve until owner or agent permission is confirmed, contact details are verified, placeholder images are replaced with authorised photos, and the external duplicate scan is reviewed.',
    `Run: ${RUN_ID}.`
  ].join(' ');

  return {
    listing_type: type,
    title,
    description: descriptionFor({ type, title, area, district, highlights, university }),
    district,
    area,
    address: `${area}, ${district}`,
    price: moneyFor(type, sequence),
    price_period: periodFor(type),
    bedrooms,
    bathrooms,
    property_type: pick(typePlan.propertyType, sequence),
    title_type: type === 'land' ? pick(['Private Mailo', 'Freehold', 'Leasehold', 'Customary'], sequence) : null,
    year_built: type === 'sale' || type === 'rent' ? 2010 + (sequence % 14) : null,
    furnishing: type === 'land' || type === 'commercial' ? null : pick(['Unfurnished', 'Semi furnished', 'Furnished'], sequence),
    contract_months: type === 'rent' || type === 'student' || type === 'commercial' ? pick([3, 6, 12], sequence) : null,
    deposit_amount: type === 'rent' || type === 'student' || type === 'commercial' ? moneyFor(type, sequence) : null,
    land_size_value: type === 'land' ? Number((0.25 + ((sequence % 16) * 0.25)).toFixed(2)) : null,
    land_size_unit: type === 'land' ? 'acre' : null,
    floor_area_sqm: type === 'commercial' ? 60 + ((sequence % 12) * 25) : (type === 'land' ? null : 70 + ((sequence % 15) * 18)),
    usable_size_sqm: type === 'commercial' ? 55 + ((sequence % 12) * 20) : null,
    parking_bays: type === 'land' ? null : sequence % 4,
    nearest_university: university,
    distance_to_uni_km: university ? Number((0.4 + ((sequence % 10) * 0.25)).toFixed(1)) : null,
    room_type: type === 'student' ? pick(['Single room', 'Shared room', 'Bedsitter'], sequence) : null,
    room_arrangement: type === 'student' ? pick(['Private', 'Shared', 'Self-contained'], sequence) : null,
    commercial_intent: type === 'commercial' ? pick(['Office', 'Retail', 'Warehouse', 'Hospitality'], sequence) : null,
    latitude,
    longitude,
    students_welcome: type === 'student' || type === 'rent',
    verification_terms_accepted: false,
    inquiry_reference: listingReference,
    id_number: null,
    id_document_name: null,
    id_document_url: null,
    new_until: new Date(Date.now() + (21 * 24 * 60 * 60 * 1000)),
    amenities: JSON.stringify([
      pick(['Parking', 'Security', 'Water', 'Power', 'Road access'], sequence),
      pick(['Nearby transport', 'Schools nearby', 'Shopping nearby', 'Quiet area'], sequence + 1)
    ]),
    extra_fields: JSON.stringify(extraFields),
    lister_name: 'MakaUg Sourcing Desk',
    lister_phone: SUPPORT_PHONE,
    lister_email: SUPPORT_EMAIL,
    lister_type: 'owner',
    agent_id: null,
    source: SOURCE,
    listed_via: 'sourced_inventory',
    status: 'pending',
    moderation_stage: 'submitted',
    moderation_notes: moderationNotes,
    moderation_reason: 'Consent, contact, images, and ownership verification required before approval.',
    reviewed_at: null,
    images
  };
}

function plannedListings() {
  const listings = [];
  let sequence = 1;
  for (const plan of PLAN) {
    const typeCount = Math.floor((plan.target / DEFAULT_COUNT) * COUNT);
    for (let i = 0; i < typeCount; i += 1) {
      listings.push(buildListing(sequence, plan.type));
      sequence += 1;
    }
  }
  while (listings.length < COUNT) {
    const plan = pick(PLAN, listings.length);
    listings.push(buildListing(sequence, plan.type));
    sequence += 1;
  }
  return listings.slice(0, COUNT);
}

async function cleanup(client) {
  const deleted = await client.query('DELETE FROM properties WHERE source = $1 RETURNING id', [SOURCE]);
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
    ) RETURNING id`,
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
      listing.moderation_notes, listing.moderation_reason
    ]
  );

  const propertyId = inserted.rows[0].id;
  for (const image of listing.images) {
    await client.query(
      `INSERT INTO property_images (property_id, url, is_primary, sort_order, slot_key, room_label)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [propertyId, image.url, image.is_primary, image.sort_order, image.slot_key, image.room_label]
    );
  }

  await client.query(
    `INSERT INTO property_moderation_events (
      property_id, actor_id, action, status_from, status_to, checklist, reason, notes, delivery
    ) VALUES ($1, $2, $3, NULL, 'pending', $4::jsonb, $5, $6, $7::jsonb)`,
    [
      propertyId,
      'sourcing_seed',
      'sourced_inventory_candidate_created',
      JSON.stringify({
        sourced_inventory_candidate: true,
        consent_required: true,
        approval_blocked_until_verified: true,
        source: SOURCE
      }),
      listing.moderation_reason,
      listing.moderation_notes,
      JSON.stringify({
        seeded: true,
        run_id: RUN_ID,
        visible_in_king_dashboard: true,
        public_ready: false
      })
    ]
  );

  return propertyId;
}

function summarize(listings) {
  const byType = listings.reduce((acc, item) => {
    acc[item.listing_type] = (acc[item.listing_type] || 0) + 1;
    return acc;
  }, {});
  return {
    count: listings.length,
    by_type: byType,
    districts: new Set(listings.map((item) => item.district)).size,
    areas: new Set(listings.map((item) => item.area)).size,
    image_rows: listings.reduce((sum, item) => sum + item.images.length, 0),
    samples: listings.slice(0, 5).map((item) => ({
      title: item.title,
      type: item.listing_type,
      district: item.district,
      area: item.area,
      status: item.status,
      consent_required: true
    }))
  };
}

async function main() {
  const listings = plannedListings();
  if (DRY_RUN) {
    console.log(JSON.stringify({
      ok: true,
      action: 'dry-run',
      source: SOURCE,
      run_id: RUN_ID,
      target_status: 'pending',
      approval_guardrail: 'verification_terms_accepted=false, no ID document, consent_required=true',
      ...summarize(listings)
    }, null, 2));
    return;
  }

  if (!CONFIRM && !CLEANUP) {
    console.error('Refusing to write without --confirm. Use --dry-run first, then --confirm to create pending sourced candidates.');
    process.exit(2);
  }

  const db = require('../config/database');
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    let cleanupResult = null;
    if (CLEANUP || REPLACE) cleanupResult = await cleanup(client);
    if (CLEANUP && !REPLACE) {
      await client.query('COMMIT');
      console.log(JSON.stringify({ ok: true, action: 'cleanup', source: SOURCE, deleted: cleanupResult }, null, 2));
      return;
    }

    const created = [];
    for (const listing of listings) {
      created.push(await insertListing(client, listing));
    }
    await client.query('COMMIT');

    const summary = await db.query(
      `SELECT listing_type, COUNT(*)::int AS count
       FROM properties
       WHERE source = $1
       GROUP BY listing_type
       ORDER BY listing_type`,
      [SOURCE]
    );
    const guardrails = await db.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
         COUNT(*) FILTER (WHERE extra_fields->>'consent_required' = 'true')::int AS consent_required,
         COUNT(*) FILTER (WHERE verification_terms_accepted IS FALSE)::int AS approval_blocked
       FROM properties
       WHERE source = $1`,
      [SOURCE]
    );
    console.log(JSON.stringify({
      ok: true,
      action: REPLACE ? 'replace' : 'seed',
      source: SOURCE,
      run_id: RUN_ID,
      cleanup: cleanupResult,
      created_properties: created.length,
      by_type: summary.rows,
      guardrails: guardrails.rows[0],
      cleanup_command: 'node scripts/seed-sourced-inventory-candidates.js --cleanup --confirm'
    }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await db.pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
