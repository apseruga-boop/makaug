#!/usr/bin/env node
require('dotenv').config();

const db = require('../config/database');

const SOURCE = 'whatsapp-test-inventory-v1';
const AGENT_PREFIX = 'WQA-2026-';
const DEFAULT_COUNT = 300;

const argv = new Set(process.argv.slice(2));
const countArg = process.argv.find((arg) => arg.startsWith('--count='));
const REQUESTED_COUNT = countArg ? Number.parseInt(countArg.split('=')[1], 10) : DEFAULT_COUNT;
const COUNT = Number.isFinite(REQUESTED_COUNT) && REQUESTED_COUNT > 0 ? REQUESTED_COUNT : DEFAULT_COUNT;
const CLEANUP = argv.has('--cleanup');
const REPLACE = argv.has('--replace');
const DRY_RUN = argv.has('--dry-run');
const APPROVE = argv.has('--approve');

const IMAGE_SETS = {
  residential: [
    'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=1400&q=82&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=1400&q=82&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?w=1400&q=82&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=1400&q=82&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1600566752355-35792bedcfea?w=1400&q=82&auto=format&fit=crop'
  ],
  apartment: [
    'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=1400&q=82&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?w=1400&q=82&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1560185127-6ed189bf02f4?w=1400&q=82&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=1400&q=82&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1560185007-c5ca9d2c014d?w=1400&q=82&auto=format&fit=crop'
  ],
  student: [
    'https://images.unsplash.com/photo-1555854877-bab0e564b8d5?w=1400&q=82&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1595526114035-0d45ed16cfbf?w=1400&q=82&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1616594039964-ae9021a400a0?w=1400&q=82&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1554995207-c18c203602cb?w=1400&q=82&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1631049307264-da0ec9d70304?w=1400&q=82&auto=format&fit=crop'
  ],
  commercial: [
    'https://images.unsplash.com/photo-1497366754035-f200968a6e72?w=1400&q=82&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1497366811353-6870744d04b2?w=1400&q=82&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1400&q=82&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1604328698692-f76ea9498e76?w=1400&q=82&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=1400&q=82&auto=format&fit=crop'
  ],
  land: [
    'https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=1400&q=82&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?w=1400&q=82&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=1400&q=82&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=1400&q=82&auto=format&fit=crop&sat=-10',
    'https://images.unsplash.com/photo-1473773508845-188df298d2d1?w=1400&q=82&auto=format&fit=crop'
  ]
};

const AREAS = [
  ['Central', 'Kampala', 'Kololo', 0.335, 32.588], ['Central', 'Kampala', 'Nakasero', 0.320, 32.580],
  ['Central', 'Kampala', 'Ntinda', 0.354, 32.616], ['Central', 'Kampala', 'Bugolobi', 0.318, 32.624],
  ['Central', 'Kampala', 'Muyenga', 0.291, 32.612], ['Central', 'Kampala', 'Kyanja', 0.398, 32.596],
  ['Central', 'Kampala', 'Kikoni', 0.336, 32.563], ['Central', 'Kampala', 'Makindye', 0.287, 32.586],
  ['Central', 'Wakiso', 'Kira', 0.397, 32.639], ['Central', 'Wakiso', 'Najjera', 0.387, 32.630],
  ['Central', 'Wakiso', 'Namugongo', 0.386, 32.660], ['Central', 'Wakiso', 'Entebbe', 0.061, 32.464],
  ['Central', 'Wakiso', 'Gayaza', 0.454, 32.611], ['Central', 'Wakiso', 'Nansana', 0.363, 32.529],
  ['Central', 'Mukono', 'Seeta', 0.366, 32.704], ['Central', 'Mukono', 'Mukono Central', 0.354, 32.755],
  ['Central', 'Masaka', 'Nyendo', -0.333, 31.734], ['Central', 'Mpigi', 'Mpigi Town', 0.225, 32.313],
  ['Central', 'Luwero', 'Luwero Town', 0.849, 32.473], ['Central', 'Mityana', 'Mityana Town', 0.401, 32.045],
  ['Central', 'Mubende', 'Mubende Town', 0.558, 31.395], ['Central', 'Kayunga', 'Kayunga Town', 0.702, 32.903],
  ['Central', 'Rakai', 'Rakai Town', -0.706, 31.408], ['Central', 'Kalangala', 'Kalangala Town', -0.321, 32.293],
  ['Eastern', 'Jinja', 'Jinja Central', 0.424, 33.204], ['Eastern', 'Jinja', 'Bugembe', 0.482, 33.240],
  ['Eastern', 'Mbale', 'Mbale Town', 1.080, 34.175], ['Eastern', 'Mbale', 'Namatala', 1.073, 34.198],
  ['Eastern', 'Tororo', 'Tororo Town', 0.694, 34.181], ['Eastern', 'Iganga', 'Iganga Town', 0.609, 33.468],
  ['Eastern', 'Soroti', 'Soroti Town', 1.714, 33.611], ['Eastern', 'Busia', 'Busia Town', 0.465, 34.092],
  ['Eastern', 'Pallisa', 'Pallisa Town', 1.146, 33.709], ['Eastern', 'Kapchorwa', 'Kapchorwa Town', 1.397, 34.451],
  ['Eastern', 'Kumi', 'Kumi Town', 1.491, 33.936], ['Eastern', 'Kamuli', 'Kamuli Town', 0.947, 33.119],
  ['Eastern', 'Butaleja', 'Butaleja Town', 0.916, 33.951], ['Eastern', 'Budaka', 'Budaka Town', 1.016, 33.945],
  ['Northern', 'Gulu', 'Gulu City', 2.774, 32.299], ['Northern', 'Lira', 'Lira City', 2.249, 32.899],
  ['Northern', 'Arua', 'Arua City', 3.020, 30.911], ['Northern', 'Kitgum', 'Kitgum Town', 3.288, 32.878],
  ['Northern', 'Moyo', 'Moyo Town', 3.660, 31.724], ['Northern', 'Nebbi', 'Nebbi Town', 2.479, 31.088],
  ['Northern', 'Adjumani', 'Adjumani Town', 3.377, 31.790], ['Northern', 'Apac', 'Apac Town', 1.985, 32.535],
  ['Northern', 'Pader', 'Pader Town', 2.881, 33.086], ['Northern', 'Yumbe', 'Yumbe Town', 3.465, 31.246],
  ['Western', 'Mbarara', 'Mbarara City', -0.607, 30.654], ['Western', 'Mbarara', 'Kakoba', -0.606, 30.674],
  ['Western', 'Fort Portal', 'Fort Portal City', 0.671, 30.275], ['Western', 'Hoima', 'Hoima City', 1.431, 31.352],
  ['Western', 'Masindi', 'Masindi Town', 1.684, 32.446], ['Western', 'Kabale', 'Kabale Town', -1.249, 29.989],
  ['Western', 'Kasese', 'Kasese Town', 0.184, 30.083], ['Western', 'Bushenyi', 'Ishaka', -0.540, 30.140],
  ['Western', 'Rukungiri', 'Rukungiri Town', -0.789, 29.925], ['Western', 'Kisoro', 'Kisoro Town', -1.285, 29.685],
  ['Western', 'Ibanda', 'Ibanda Town', -0.134, 30.496], ['Western', 'Ntungamo', 'Ntungamo Town', -0.879, 30.265]
].map(([region, district, area, lat, lng]) => ({ region, district, area, lat, lng }));

const UNIVERSITIES = [
  ['Makerere University', 'Kikoni', 'Kampala'], ['Kyambogo University', 'Kyambogo', 'Kampala'],
  ['MUBS', 'Nakawa', 'Kampala'], ['Uganda Christian University', 'Mukono Central', 'Mukono'],
  ['Mbarara University', 'Mbarara City', 'Mbarara'], ['Gulu University', 'Gulu City', 'Gulu'],
  ['Busitema University', 'Busia Town', 'Busia'], ['Bishop Stuart University', 'Kakoba', 'Mbarara'],
  ['Uganda Martyrs University', 'Nkozi', 'Mpigi'], ['Ndejje University', 'Luwero Town', 'Luwero']
];

const AGENTS = [
  ['Amina Nakato', 'Green Roof Realty', ['Kampala', 'Wakiso', 'Mukono'], ['Residential', 'Student', 'Commercial']],
  ['Daniel Kato', 'Victoria Homes Uganda', ['Wakiso', 'Entebbe', 'Mpigi'], ['Residential', 'Land']],
  ['Grace Akello', 'Northern Key Properties', ['Gulu', 'Lira', 'Kitgum'], ['Residential', 'Commercial']],
  ['Brian Mutebi', 'Kampala Lettings Co.', ['Kampala', 'Wakiso'], ['Rentals', 'Student']],
  ['Sarah Nambi', 'MakaUg Eastern Homes', ['Jinja', 'Mbale', 'Tororo'], ['Land', 'Commercial']],
  ['Peter Ochieng', 'Lakeside Realty', ['Jinja', 'Busia', 'Iganga'], ['Residential', 'Land']],
  ['Ruth Asiimwe', 'Western Estates', ['Mbarara', 'Kabale', 'Bushenyi'], ['Residential', 'Student']],
  ['Moses Okello', 'Arua Property Desk', ['Arua', 'Nebbi', 'Moyo'], ['Land', 'Commercial']],
  ['Joan Kisaakye', 'Central Plot Finders', ['Luwero', 'Mityana', 'Mubende'], ['Land']],
  ['Hassan Ssekitoleko', 'Masaka Homes', ['Masaka', 'Rakai', 'Kalangala'], ['Residential', 'Land']],
  ['Esther Namara', 'Rwenzori Realty', ['Fort Portal', 'Kasese', 'Hoima'], ['Residential', 'Commercial']],
  ['Samuel Were', 'Elgon Commercial Spaces', ['Mbale', 'Kapchorwa', 'Kumi'], ['Commercial', 'Land']],
  ['Patricia Auma', 'Student Nest Uganda', ['Kampala', 'Mukono', 'Mbarara'], ['Student', 'Rentals']],
  ['Joseph Mugisha', 'Secure Title Brokers', ['Kampala', 'Wakiso', 'Jinja'], ['Sale', 'Land']],
  ['Mariam Birungi', 'Pearl Rentals', ['Kampala', 'Wakiso', 'Entebbe'], ['Rentals', 'Residential']]
];

const PLAN = [
  { type: 'sale', target: 85 },
  { type: 'rent', target: 75 },
  { type: 'student', target: 55 },
  { type: 'commercial', target: 45 },
  { type: 'land', target: 40 }
];

const TITLE_WORDS = {
  sale: ['Family Home', 'Garden House', 'Modern Bungalow', 'Town House', 'Secure Villa'],
  rent: ['Apartment', 'Maisonette', 'Serviced Flat', 'Courtyard Home', 'Two Bedroom Unit'],
  student: ['Student Hostel', 'Campus Rooms', 'Student Apartments', 'Shared Student House', 'Private Student Rooms'],
  commercial: ['Office Suite', 'Retail Space', 'Warehouse', 'Showroom', 'Restaurant Space'],
  land: ['Residential Plot', 'Commercial Plot', 'Lake View Plot', 'Farm Land', 'Estate Plot']
};

function pick(items, index) {
  return items[index % items.length];
}

function moneyFor(type, index) {
  if (type === 'rent') return 550000 + ((index % 18) * 150000);
  if (type === 'student') return 250000 + ((index % 12) * 70000);
  if (type === 'commercial') return 1200000 + ((index % 20) * 350000);
  if (type === 'land') return 18000000 + ((index % 28) * 6000000);
  return 85000000 + ((index % 36) * 18000000);
}

function periodFor(type) {
  if (type === 'sale' || type === 'land') return 'once';
  if (type === 'student') return 'mo';
  return 'mo';
}

function propertyTypeFor(type, index) {
  if (type === 'sale') return pick(['House', 'Bungalow', 'Villa', 'Townhouse', 'Apartment'], index);
  if (type === 'rent') return pick(['Apartment', 'House', 'Studio', 'Maisonette'], index);
  if (type === 'student') return pick(['Hostel', 'Student Room', 'Shared House', 'Bedsitter'], index);
  if (type === 'commercial') return pick(['Office', 'Shop', 'Warehouse', 'Showroom', 'Restaurant Space'], index);
  return pick(['Residential Plot', 'Commercial Plot', 'Agricultural Land', 'Estate Plot'], index);
}

function makeDescription({ type, district, area, title, bedrooms, bathrooms, university }) {
  const base = `${title} in ${area}, ${district}. TEST LISTING for MakaUg WhatsApp chatbot, search, map, agent and approval-flow QA.`;
  if (type === 'student') {
    return `${base} Close to ${university}, with secure access, study-friendly rooms, water, power and nearby transport.`;
  }
  if (type === 'commercial') {
    return `${base} Suitable for business testing with road access, visible frontage, reliable utilities and flexible viewing.`;
  }
  if (type === 'land') {
    return `${base} Clearly marked test plot with road access, growing neighbourhood demand and location data for map matching.`;
  }
  return `${base} ${bedrooms} bedroom, ${bathrooms} bathroom layout with parking, security, water, power and easy access to local services.`;
}

function imageSetFor(type) {
  if (type === 'land') return IMAGE_SETS.land;
  if (type === 'commercial') return IMAGE_SETS.commercial;
  if (type === 'student') return IMAGE_SETS.student;
  if (type === 'rent') return IMAGE_SETS.apartment;
  return IMAGE_SETS.residential;
}

function imageRows(type, seed) {
  const slots = type === 'land'
    ? [['front', 'Main plot view'], ['road', 'Access road'], ['boundary', 'Boundary view'], ['surroundings', 'Neighbourhood'], ['title', 'Title check placeholder']]
    : [['front', 'Front/outside'], ['sitting_room', 'Sitting room'], ['bedroom', 'Bedroom'], ['kitchen', 'Kitchen'], ['bathroom', 'Bathroom']];
  const urls = imageSetFor(type);
  return slots.map(([slotKey, roomLabel], idx) => ({
    url: `${urls[(seed + idx) % urls.length]}&sig=${SOURCE}-${seed}-${idx}`,
    slot_key: slotKey,
    room_label: roomLabel,
    is_primary: idx === 0,
    sort_order: idx
  }));
}

async function cleanup(client) {
  const deletedProperties = await client.query('DELETE FROM properties WHERE source = $1 RETURNING id', [SOURCE]);
  const deletedAgents = await client.query(
    'DELETE FROM agents WHERE licence_number LIKE $1 RETURNING id',
    [`${AGENT_PREFIX}%`]
  );
  return {
    properties: deletedProperties.rowCount,
    agents: deletedAgents.rowCount
  };
}

async function upsertAgents(client) {
  const ids = [];
  for (let i = 0; i < AGENTS.length; i += 1) {
    const [fullName, company, districts, specializations] = AGENTS[i];
    const n = String(i + 1).padStart(3, '0');
    const phone = `+256780${String(810000 + i).slice(-6)}`;
    const result = await client.query(
      `INSERT INTO agents (
        full_name, company_name, licence_number, registration_status, listing_limit,
        phone, whatsapp, email, districts_covered, specializations, profile_photo_url,
        bio, rating, sales_count, status, featured_homepage, featured_at
      ) VALUES (
        $1,$2,$3,'registered',500,$4,$4,$5,$6,$7,$8,$9,$10,$11,'approved',$12,NOW()
      )
      ON CONFLICT (licence_number) DO UPDATE SET
        full_name = EXCLUDED.full_name,
        company_name = EXCLUDED.company_name,
        registration_status = EXCLUDED.registration_status,
        listing_limit = EXCLUDED.listing_limit,
        whatsapp = EXCLUDED.whatsapp,
        districts_covered = EXCLUDED.districts_covered,
        specializations = EXCLUDED.specializations,
        profile_photo_url = EXCLUDED.profile_photo_url,
        bio = EXCLUDED.bio,
        rating = EXCLUDED.rating,
        sales_count = EXCLUDED.sales_count,
        status = EXCLUDED.status,
        featured_homepage = EXCLUDED.featured_homepage,
        featured_at = EXCLUDED.featured_at,
        updated_at = NOW()
      RETURNING id`,
      [
        fullName,
        company,
        `${AGENT_PREFIX}${n}`,
        phone,
        `whatsapp-qa-agent-${n}@makaug.test`,
        districts,
        specializations,
        `https://images.unsplash.com/photo-${i % 2 ? '1494790108377-be9c29b29330' : '1500648767791-00dcc994a43e'}?w=600&q=80&auto=format&fit=crop&sig=${n}`,
        `Approved MakaUg WhatsApp QA agent covering ${districts.join(', ')}. Seed source: ${SOURCE}.`,
        (4.2 + ((i % 8) / 10)).toFixed(1),
        18 + (i * 7),
        i < 6
      ]
    );
    ids.push(result.rows[0].id);
  }
  return ids;
}

function buildListing(index, type, agents) {
  const area = pick(AREAS, index * 7 + type.length);
  const agentId = pick(agents, index);
  const bedrooms = type === 'land' || type === 'commercial' ? null : 1 + (index % 5);
  const bathrooms = type === 'land' ? null : 1 + (index % 3);
  const university = pick(UNIVERSITIES, index);
  const propertyType = propertyTypeFor(type, index);
  const naturalTitle = type === 'land'
    ? `${(0.25 + (index % 8) * 0.25).toFixed(index % 2 ? 2 : 1)} Acre ${propertyType} - ${area.area}`
    : `${pick(TITLE_WORDS[type], index)} - ${area.area}`;
  const title = `[TEST] ${naturalTitle}`;
  const jitter = ((index % 9) - 4) * 0.006;
  const price = moneyFor(type, index);
  const displayName = pick(AGENTS, index)[0];
  const extra = {
    qa_seed: true,
    qa_seed_source: SOURCE,
    city: area.district,
    region: area.region,
    neighborhood: area.area,
    street_name: `${area.area} Test Road`,
    resolved_location_label: `${area.area}, ${area.district}`,
    public_display_name: `[TEST] ${displayName}`,
    featured: index % 11 === 0,
    featured_at: index % 11 === 0 ? new Date().toISOString() : null,
    area_highlights: `${area.area} gives testers a realistic ${area.region} Uganda search result.`,
    nearby_facilities: ['Transport', 'Shops', 'Schools', 'Health centre'].slice(0, 2 + (index % 3)),
    test_removal_note: `Delete where source = ${SOURCE}`
  };

  if (type === 'student') {
    extra.university = university[0];
    extra.student_focus = true;
  }

  return {
    listing_type: type,
    title,
    description: makeDescription({ type, district: area.district, area: area.area, title, bedrooms, bathrooms, university: university[0] }),
    district: area.district,
    area: area.area,
    address: `${area.area} Test Road ${100 + index}`,
    price,
    price_period: periodFor(type),
    bedrooms,
    bathrooms,
    property_type: propertyType,
    title_type: type === 'land' || type === 'sale' ? pick(['Freehold', 'Leasehold', 'Mailo'], index) : null,
    year_built: type === 'land' ? null : 2008 + (index % 16),
    furnishing: type === 'land' ? null : pick(['Unfurnished', 'Semi-furnished', 'Furnished'], index),
    contract_months: type === 'rent' || type === 'commercial' ? 12 : null,
    deposit_amount: type === 'rent' || type === 'commercial' ? price : null,
    land_size_value: type === 'land' ? 0.25 + (index % 8) * 0.25 : null,
    land_size_unit: type === 'land' ? 'acres' : null,
    floor_area_sqm: type === 'commercial' ? 45 + ((index % 12) * 25) : null,
    usable_size_sqm: type === 'commercial' ? 38 + ((index % 12) * 20) : null,
    parking_bays: type === 'commercial' ? 1 + (index % 8) : index % 4,
    nearest_university: type === 'student' ? university[0] : null,
    distance_to_uni_km: type === 'student' ? Number((0.4 + (index % 8) * 0.3).toFixed(1)) : null,
    room_type: type === 'student' ? pick(['Single Room', 'Double Room', 'Bedsitter', 'Shared Room'], index) : null,
    room_arrangement: type === 'student' ? pick(['Self-contained', 'Shared facilities', 'Two per room'], index) : null,
    commercial_intent: type === 'commercial' ? pick(['rent', 'sale'], index) : null,
    latitude: Number((area.lat + jitter).toFixed(6)),
    longitude: Number((area.lng - jitter).toFixed(6)),
    students_welcome: type === 'student' || (type === 'rent' && index % 9 === 0),
    verification_terms_accepted: true,
    inquiry_reference: `WQA-${String(index).padStart(4, '0')}`,
    id_number: `TESTNIN${String(index).padStart(8, '0')}`,
    id_document_name: `test-id-${String(index).padStart(4, '0')}.png`,
    id_document_url: imageRows(type, index)[0].url,
    new_until: new Date(Date.now() + (20 + (index % 25)) * 24 * 60 * 60 * 1000),
    amenities: JSON.stringify(type === 'land'
      ? ['Road access', 'Surveyed', 'Title check', 'Map pin']
      : ['Parking', 'Security', 'Water', 'Power', type === 'student' ? 'Study area' : 'Good access']),
    extra_fields: JSON.stringify(extra),
    lister_name: `[TEST] ${displayName}`,
    lister_phone: `+256779${String(500000 + index).slice(-6)}`,
    lister_email: `whatsapp-test-listing-${String(index).padStart(4, '0')}@makaug.test`,
    lister_type: 'agent',
    agent_id: agentId,
    source: SOURCE,
    listed_via: 'seed',
    status: APPROVE ? 'approved' : 'pending',
    moderation_stage: APPROVE ? 'approved' : 'submitted',
    reviewed_at: APPROVE ? new Date() : null,
    moderation_notes: 'TEST LISTING: seeded for WhatsApp chatbot QA. Safe to approve for testing or delete before official launch.',
    images: imageRows(type, index)
  };
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
      reviewed_at, moderation_notes
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
      $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
      $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,
      $31,$32,$33,$34,$35,$36::jsonb,$37::jsonb,$38,$39,$40,
      $41,$42,$43,$44,$45,$46,$47,$48
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
      listing.moderation_notes
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
      property_id, actor_id, action, status_from, status_to, checklist, notes, delivery
    ) VALUES ($1, 'qa_seed', 'qa_listing_submitted_for_review', NULL, $2, $3::jsonb, $4, $5::jsonb)`,
    [
      propertyId,
      listing.status,
      JSON.stringify({
        test_inventory: true,
        photo_count: listing.images.length,
        source: SOURCE
      }),
      listing.moderation_notes,
      JSON.stringify({ seeded: true, visible_in_backend_review_queue: !APPROVE })
    ]
  );
  return propertyId;
}

async function main() {
  if (DRY_RUN) {
    const fakeAgents = AGENTS.map((_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`);
    const listings = [];
    let sequence = 1;
    for (const plan of PLAN) {
      const typeCount = Math.floor((plan.target / DEFAULT_COUNT) * COUNT);
      for (let i = 0; i < typeCount; i += 1) {
        listings.push(buildListing(sequence, plan.type, fakeAgents));
        sequence += 1;
      }
    }
    while (listings.length < COUNT) {
      const plan = pick(PLAN, listings.length);
      listings.push(buildListing(sequence, plan.type, fakeAgents));
      sequence += 1;
    }

    const byType = listings.reduce((acc, item) => {
      acc[item.listing_type] = (acc[item.listing_type] || 0) + 1;
      return acc;
    }, {});
    const districts = new Set(listings.map((item) => item.district));
    const areas = new Set(listings.map((item) => item.area));
    console.log(JSON.stringify({
      ok: true,
      action: 'dry-run',
      source: SOURCE,
      properties_to_create: listings.length,
      agents_to_create: AGENTS.length,
      by_type: byType,
      target_status: APPROVE ? 'approved' : 'pending',
      moderation_stage: APPROVE ? 'approved' : 'submitted',
      coverage: {
        districts: districts.size,
        areas: areas.size
      },
      image_rows_to_create: listings.reduce((total, item) => total + item.images.length, 0),
      samples: listings.slice(0, 5).map((item) => ({
        listing_type: item.listing_type,
        title: item.title,
        district: item.district,
        area: item.area,
        price: item.price,
        images: item.images.length
      }))
    }, null, 2));
    return;
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    let cleanupResult = null;
    if (CLEANUP || REPLACE) cleanupResult = await cleanup(client);
    if (CLEANUP && !REPLACE) {
      await client.query('COMMIT');
      console.log(JSON.stringify({ ok: true, action: 'cleanup', deleted: cleanupResult }, null, 2));
      return;
    }

    const agentIds = await upsertAgents(client);
    const created = [];
    let sequence = 1;

    for (const plan of PLAN) {
      const typeCount = Math.floor((plan.target / DEFAULT_COUNT) * COUNT);
      for (let i = 0; i < typeCount; i += 1) {
        created.push(await insertListing(client, buildListing(sequence, plan.type, agentIds)));
        sequence += 1;
      }
    }

    while (created.length < COUNT) {
      const plan = pick(PLAN, created.length);
      created.push(await insertListing(client, buildListing(sequence, plan.type, agentIds)));
      sequence += 1;
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
    const districtSummary = await db.query(
      `SELECT COUNT(DISTINCT district)::int AS districts, COUNT(DISTINCT area)::int AS areas
       FROM properties
       WHERE source = $1`,
      [SOURCE]
    );

    console.log(JSON.stringify({
      ok: true,
      action: REPLACE ? 'replace' : 'seed',
      source: SOURCE,
      cleanup: cleanupResult,
      created_properties: created.length,
      agents_available: agentIds.length,
      target_status: APPROVE ? 'approved' : 'pending',
      moderation_stage: APPROVE ? 'approved' : 'submitted',
      by_type: summary.rows,
      coverage: districtSummary.rows[0],
      cleanup_command: 'node scripts/seed-whatsapp-test-inventory.js --cleanup'
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
