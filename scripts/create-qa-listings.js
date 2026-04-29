#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs');
const path = require('path');

const BASE_URL = String(process.env.QA_BASE_URL || process.env.BASE_URL || 'https://makaug.com').replace(/\/+$/, '');
const ADMIN_API_KEY = String(process.env.ADMIN_API_KEY || '').trim();
const OTP_CODE = String(
  process.env.QA_OTP_CODE
    || process.env.ADMIN_OTP_OVERRIDE_CODE
    || process.env.LISTING_OTP_OVERRIDE_CODE
    || ''
).trim();
const SHOULD_APPROVE = /^(1|true|yes)$/i.test(String(process.env.QA_APPROVE || ''));
const REQUEST_OTP_FIRST = /^(1|true|yes)$/i.test(String(process.env.QA_REQUEST_OTP || ''));
const QA_EMAIL = String(process.env.QA_LISTER_EMAIL || '').trim();
const QA_PHONE = String(process.env.QA_LISTER_PHONE || '').trim();
const RUN_ID = String(process.env.QA_RUN_ID || new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 12));
const LISTING_COUNT = Math.max(1, Math.min(parseInt(process.env.QA_LISTING_COUNT || '25', 10) || 25, 500));
const OUTPUT_FILE = process.env.QA_OUTPUT_FILE
  || path.join(process.cwd(), 'qa-output', `makaug-qa-listings-${RUN_ID}.json`);

function usage() {
  return [
    'Create labelled production QA listings through the public listing submission API.',
    '',
    'Required for the secure override path:',
    '  ADMIN_API_KEY=<admin key>',
    '',
    'Optional:',
    '  QA_BASE_URL=https://makaug.com',
    '  QA_LISTING_COUNT=200          # default 25, max 500',
    '  QA_LISTER_EMAIL=your-test-inbox@example.com',
    '  QA_LISTER_PHONE=+256770123456',
    '  QA_APPROVE=1                # approve after automated review passes',
    '  QA_REQUEST_OTP=1            # also call request-submit-otp before override token',
    '',
    'Fallback if ADMIN_API_KEY is not available:',
    '  QA_OTP_CODE=<enabled public OTP override code>'
  ].join('\n');
}

async function api(pathname, options = {}) {
  const url = `${BASE_URL}${pathname}`;
  const headers = {
    Accept: 'application/json',
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers || {})
  };
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch (_error) {
    body = { ok: false, error: text || response.statusText };
  }
  if (!response.ok || body?.ok === false) {
    const error = new Error(body?.error || `Request failed: ${response.status}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body || {};
}

function colorFromSeed(seed, palette) {
  let total = 0;
  String(seed).split('').forEach((char) => {
    total += char.charCodeAt(0);
  });
  return palette[total % palette.length];
}

function dataImage(label, seed, fill = '#0f766e', kind = 'house', slot = 'front') {
  const safe = String(label || '').replace(/[<>&"]/g, ' ');
  const sky = colorFromSeed(seed, ['#dbeafe', '#e0f2fe', '#dcfce7', '#fef3c7', '#fae8ff']);
  const accent = colorFromSeed(`${seed}-${slot}`, ['#166534', '#0f766e', '#1d4ed8', '#92400e', '#7c2d12']);
  const roof = colorFromSeed(`${seed}-${kind}`, ['#7f1d1d', '#92400e', '#374151', '#14532d', '#1e3a8a']);
  const ground = kind === 'land' ? '#bbf7d0' : '#86efac';
  const slotLabel = String(slot || '').replace(/[_-]+/g, ' ').toUpperCase();
  const scenes = {
    house: [
      `<rect x="450" y="390" width="390" height="260" rx="10" fill="#f8fafc" stroke="#334155" stroke-width="8"/>`,
      `<polygon points="405,400 645,250 885,400" fill="${roof}" stroke="#334155" stroke-width="8"/>`,
      `<rect x="590" y="500" width="95" height="150" rx="8" fill="${accent}"/>`,
      `<rect x="490" y="450" width="80" height="70" rx="8" fill="#bae6fd" stroke="#334155" stroke-width="6"/>`,
      `<rect x="720" y="450" width="80" height="70" rx="8" fill="#bae6fd" stroke="#334155" stroke-width="6"/>`
    ],
    apartment: [
      `<rect x="440" y="230" width="400" height="430" rx="18" fill="#f8fafc" stroke="#334155" stroke-width="8"/>`,
      ...Array.from({ length: 4 }).flatMap((_, row) => Array.from({ length: 3 }).map((__, col) => `<rect x="${485 + col * 110}" y="${280 + row * 80}" width="64" height="46" rx="7" fill="#bae6fd" stroke="#475569" stroke-width="5"/>`)),
      `<rect x="590" y="565" width="100" height="95" rx="8" fill="${accent}"/>`
    ],
    student: [
      `<rect x="380" y="260" width="520" height="390" rx="18" fill="#fefce8" stroke="#334155" stroke-width="8"/>`,
      `<rect x="415" y="310" width="450" height="55" rx="12" fill="${accent}"/>`,
      `<text x="470" y="350" font-family="Arial, sans-serif" font-size="30" font-weight="700" fill="#fff">HOSTEL BLOCK</text>`,
      ...Array.from({ length: 3 }).flatMap((_, row) => Array.from({ length: 4 }).map((__, col) => `<rect x="${430 + col * 105}" y="${400 + row * 70}" width="58" height="40" rx="6" fill="#bfdbfe" stroke="#475569" stroke-width="5"/>`)),
      `<rect x="610" y="570" width="80" height="80" rx="8" fill="#78350f"/>`
    ],
    commercial: [
      `<rect x="350" y="250" width="580" height="400" rx="12" fill="#e5e7eb" stroke="#334155" stroke-width="8"/>`,
      `<rect x="395" y="300" width="490" height="65" rx="8" fill="${accent}"/>`,
      `<text x="455" y="345" font-family="Arial, sans-serif" font-size="32" font-weight="700" fill="#fff">COMMERCIAL SPACE</text>`,
      ...Array.from({ length: 2 }).flatMap((_, row) => Array.from({ length: 4 }).map((__, col) => `<rect x="${410 + col * 118}" y="${405 + row * 86}" width="76" height="50" rx="6" fill="#dbeafe" stroke="#475569" stroke-width="5"/>`)),
      `<rect x="595" y="560" width="90" height="90" rx="8" fill="#111827"/>`
    ],
    land: [
      `<path d="M120 650 L1150 590 L1080 760 L180 780 Z" fill="${ground}" stroke="#15803d" stroke-width="8"/>`,
      `<path d="M220 705 L1060 640" stroke="#65a30d" stroke-width="8" stroke-dasharray="18 16"/>`,
      `<path d="M360 675 L1010 625" stroke="#65a30d" stroke-width="8" stroke-dasharray="18 16"/>`,
      `<rect x="550" y="350" width="180" height="120" rx="12" fill="#fef3c7" stroke="#92400e" stroke-width="8"/>`,
      `<text x="585" y="420" font-family="Arial, sans-serif" font-size="34" font-weight="700" fill="#92400e">PLOT</text>`
    ]
  };
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="900" viewBox="0 0 1280 900">`,
    `<rect width="1280" height="900" fill="${sky}"/>`,
    `<circle cx="1040" cy="145" r="62" fill="#fde68a"/>`,
    `<rect x="0" y="650" width="1280" height="250" fill="${ground}"/>`,
    `<path d="M0 640 C240 585 390 700 650 615 C860 545 980 640 1280 575 L1280 900 L0 900 Z" fill="${fill}" opacity="0.28"/>`,
    ...(scenes[kind] || scenes.house),
    `<rect x="70" y="70" width="1140" height="760" rx="28" fill="rgba(255,255,255,0.08)" stroke="rgba(15,118,110,0.55)" stroke-width="8"/>`,
    `<rect x="90" y="94" width="500" height="70" rx="18" fill="rgba(255,255,255,0.86)"/>`,
    `<text x="116" y="142" font-family="Arial, sans-serif" font-size="34" font-weight="700" fill="#166534">SOFT LAUNCH TEST - DELETE</text>`,
    `<rect x="90" y="180" width="340" height="54" rx="16" fill="${accent}"/>`,
    `<text x="116" y="218" font-family="Arial, sans-serif" font-size="30" font-weight="700" fill="#fff">${slotLabel}</text>`,
    `<text x="110" y="795" font-family="Arial, sans-serif" font-size="30" font-weight="700" fill="#064e3b">${safe}</text>`,
    `<text x="110" y="842" font-family="Arial, sans-serif" font-size="24" fill="#065f46">Generated image for MakaUg chatbot and portal QA - Seed ${seed}</text>`,
    `</svg>`
  ].join('');
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

function makePhone(index) {
  if (QA_PHONE) return QA_PHONE;
  return `+2567709${String(index).padStart(5, '0')}`;
}

function makeEmail(index) {
  if (QA_EMAIL) return QA_EMAIL;
  return `qa-test-delete-${RUN_ID}-${String(index).padStart(2, '0')}@example.com`;
}

function makeNin(index) {
  return `CMQA260422${String(index).padStart(4, '0')}`;
}

const typeConfigs = [
  { type: 'sale', weight: 42, price: 385000000, property_type: 'House', price_period: 'once', slots: ['front', 'living', 'kitchen', 'bedroom', 'bath'] },
  { type: 'rent', weight: 48, price: 1800000, property_type: 'Apartment', price_period: 'mo', slots: ['front', 'living', 'kitchen', 'bedroom', 'bath'] },
  { type: 'student', weight: 42, price: 650000, property_type: 'Hostel', room_type: 'Single Room', price_period: 'sem', nearest_university: 'Makerere University', distance_to_uni_km: 0.8, slots: ['front', 'room', 'bath', 'shared', 'access'] },
  { type: 'commercial', weight: 34, price: 4200000, property_type: 'Office', price_period: 'mo', commercial_intent: 'rent', slots: ['front', 'interior', 'access', 'utilities', 'washroom'] },
  { type: 'land', weight: 34, price: 92000000, property_type: 'Residential Plot', price_period: 'once', land_size_value: 25, land_size_unit: 'decimals', slots: ['front', 'road', 'boundary', 'title', 'surroundings'] }
];

const locationPresets = [
  ['Kampala', 'Kololo', 0.335, 32.592],
  ['Kampala', 'Kikoni', 0.335, 32.566],
  ['Kampala', 'Wandegeya', 0.330, 32.574],
  ['Kampala', 'Muyenga', 0.290, 32.625],
  ['Kampala', 'Ntinda', 0.354, 32.616],
  ['Kampala', 'Bugolobi', 0.318, 32.620],
  ['Wakiso', 'Kira', 0.397, 32.638],
  ['Wakiso', 'Namugongo', 0.386, 32.652],
  ['Wakiso', 'Entebbe', 0.061, 32.469],
  ['Wakiso', 'Nansana', 0.363, 32.529],
  ['Mukono', 'Seeta', 0.363, 32.710],
  ['Mukono', 'Mukono Town', 0.354, 32.755],
  ['Jinja', 'Jinja Central', 0.424, 33.204],
  ['Mbale', 'Mbale Town', 1.080, 34.175],
  ['Mbarara', 'Mbarara City', -0.607, 30.654],
  ['Gulu', 'Gulu City', 2.774, 32.299],
  ['Arua', 'Arua City', 3.020, 30.911],
  ['Masaka', 'Nyendo', -0.333, 31.734],
  ['Lira', 'Lira City', 2.249, 32.899],
  ['Hoima', 'Hoima City', 1.431, 31.352],
  ['Soroti', 'Soroti City', 1.715, 33.611],
  ['Kabale', 'Kabale Town', -1.249, 29.990],
  ['Tororo', 'Tororo Town', 0.692, 34.181],
  ['Kasese', 'Kasese Town', 0.187, 30.088]
];

const titleWords = {
  sale: ['Family Home', 'Bungalow', 'Townhouse', 'Maisonette', 'Residential House'],
  rent: ['Apartment', 'Flat', 'Serviced Unit', 'Rental Home', 'Garden Apartment'],
  student: ['Student Hostel', 'Campus Room', 'Student Studio', 'Hostel Block', 'Student Residence'],
  commercial: ['Office Suite', 'Retail Space', 'Commercial Unit', 'Shop Front', 'Workspace'],
  land: ['Residential Plot', 'Commercial Plot', 'Mixed-Use Land', 'Acre Plot', 'Estate Plot']
};

function listingKind(type, propertyType) {
  if (type === 'student') return 'student';
  if (type === 'commercial') return 'commercial';
  if (type === 'land') return 'land';
  if (/apartment|flat|unit/i.test(propertyType || '')) return 'apartment';
  return 'house';
}

function chooseLocation(globalIndex, listingType) {
  const preferred = listingType === 'student'
    ? locationPresets.filter(([district]) => ['Kampala', 'Wakiso', 'Mbarara', 'Gulu', 'Mukono'].includes(district))
    : listingType === 'land'
      ? locationPresets.filter(([district]) => !['Kampala'].includes(district))
      : locationPresets;
  const base = preferred[(globalIndex - 1) % preferred.length];
  return {
    district: base[0],
    area: base[1],
    latitude: base[2] + ((globalIndex % 7) * 0.002),
    longitude: base[3] + ((globalIndex % 5) * 0.002)
  };
}

function plannedConfigs(total) {
  const weighted = [];
  typeConfigs.forEach((config) => {
    for (let i = 0; i < config.weight; i += 1) weighted.push(config);
  });
  return Array.from({ length: total }, (_, idx) => weighted[idx % weighted.length]);
}

function buildPayload(config, indexWithinType, globalIndex) {
  const loc = chooseLocation(globalIndex, config.type);
  const titleStem = titleWords[config.type][(globalIndex - 1) % titleWords[config.type].length];
  const title = `SOFT LAUNCH TEST - DELETE ${loc.area} ${titleStem} ${String(indexWithinType).padStart(3, '0')}`;
  const phone = makePhone(globalIndex);
  const email = makeEmail(globalIndex);
  const nin = makeNin(globalIndex);
  const lat = loc.latitude;
  const lng = loc.longitude;
  const idDocumentName = `qa-test-delete-id-${globalIndex}.png`;
  const idDocumentUrl = dataImage(`National ID ${nin}`, `${RUN_ID}-${globalIndex}-id`, '#1d4ed8', 'house', 'identity');
  const kind = listingKind(config.type, config.property_type);
  const images = config.slots.map((slot, photoIndex) => ({
    url: dataImage(`${title} - ${slot}`, `${RUN_ID}-${globalIndex}-${photoIndex + 1}`, ['#0f766e', '#2563eb', '#7c3aed', '#c2410c', '#047857'][photoIndex % 5], kind, slot),
    name: `qa-test-delete-${globalIndex}-${slot}.jpg`,
    type: 'image/jpeg',
    slot,
    is_main: photoIndex === 0
  }));

  const photoAssignments = {};
  images.forEach((image, idx) => {
    photoAssignments[idx] = image.slot;
  });

  return {
    listing_type: config.type,
    title,
    description: `SOFT LAUNCH TEST - DELETE listing ${globalIndex}. This generated ${config.type} listing in ${loc.area}, ${loc.district} is for MakaUg portal and WhatsApp chatbot testing only. It should stay pending for admin review and be removed after QA.`,
    district: loc.district,
    area: `${loc.area} Test Zone ${indexWithinType}`,
    address: `${loc.area} Soft Launch Test Road ${indexWithinType}`,
    price: config.price + (indexWithinType * (config.type === 'land' ? 2500000 : 50000)),
    price_period: config.price_period,
    property_type: config.property_type,
    room_type: config.room_type || null,
    commercial_intent: config.commercial_intent || null,
    land_size_value: config.land_size_value || null,
    land_size_unit: config.land_size_unit || null,
    bedrooms: config.type === 'land' || config.type === 'commercial' ? null : 2,
    bathrooms: config.type === 'land' ? null : 1,
    nearest_university: config.nearest_university || null,
    distance_to_uni_km: config.distance_to_uni_km || null,
    amenities: ['Soft Launch Test', 'Delete After Test', 'Generated Images', 'WhatsApp QA'],
    listed_via: 'website',
    source: 'qa-production-script',
    status: 'pending',
    lister_name: `QA TEST DELETE Owner ${globalIndex}`,
    lister_display_name: `QA Owner ${globalIndex}`,
    lister_phone: phone,
    lister_email: email,
    lister_type: 'owner',
    students_welcome: config.type === 'student',
    latitude: lat,
    longitude: lng,
    verification_terms_accepted: true,
    inquiry_reference: `SLT-${RUN_ID}-${String(globalIndex).padStart(3, '0')}`,
    otp_channel: 'email',
    id_number: nin,
    id_document_name: idDocumentName,
    id_document_url: idDocumentUrl,
    new_until: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
    main_photo_index: 0,
    images,
    extra_fields: {
      qa_test_delete: true,
      soft_launch_test: true,
      qa_run_id: RUN_ID,
      map_pin_confirmed: true,
      coordinates: { lat, lng },
      city: loc.district,
      neighborhood: loc.area,
      region: loc.district,
      resolved_location_label: `${loc.area}, ${loc.district}`,
      area_highlights: `Generated soft-launch test listing near ${loc.area}, ${loc.district}.`,
      nearby_facilities: ['Market', 'Main road', 'School', 'Public transport'].slice(0, (globalIndex % 4) + 1),
      public_display_name: `QA Owner ${globalIndex}`,
      photo_manifest: images.map((image, idx) => ({
        name: image.name,
        type: image.type,
        slot: image.slot,
        is_main: idx === 0
      })),
      photo_assignments: photoAssignments,
      verify: {
        nin,
        id_document_name: idDocumentName,
        id_document_url: idDocumentUrl,
        consent_contact: true,
        contact_preference: 'both',
        nin_match_confirmed: true,
        public_display_name: `QA Owner ${globalIndex}`,
        otp_channel: 'email'
      }
    }
  };
}

async function getListingToken(payload) {
  if (ADMIN_API_KEY) {
    const response = await api('/api/admin/listing-submit-otp-override', {
      method: 'POST',
      headers: { 'x-api-key': ADMIN_API_KEY },
      body: {
        channel: 'email',
        email: payload.lister_email,
        phone: payload.lister_phone
      }
    });
    return response.data.listing_otp_token;
  }

  if (!OTP_CODE) {
    throw new Error(`No override available.\n\n${usage()}`);
  }

  if (REQUEST_OTP_FIRST) {
    await api('/api/properties/request-submit-otp', {
      method: 'POST',
      body: {
        channel: 'email',
        email: payload.lister_email
      }
    });
  }

  const response = await api('/api/properties/verify-submit-otp', {
    method: 'POST',
    body: {
      channel: 'email',
      email: payload.lister_email,
      code: OTP_CODE
    }
  });
  return response.data.listing_otp_token;
}

async function loadReview(propertyId) {
  if (!ADMIN_API_KEY) return null;
  const response = await api(`/api/admin/properties/${encodeURIComponent(propertyId)}/review`, {
    headers: { 'x-api-key': ADMIN_API_KEY }
  });
  return response.data;
}

async function approveListing(propertyId, review) {
  if (!ADMIN_API_KEY || !SHOULD_APPROVE) return null;
  const response = await api(`/api/properties/${encodeURIComponent(propertyId)}/status`, {
    method: 'PATCH',
    headers: { 'x-api-key': ADMIN_API_KEY },
    body: {
      status: 'approved',
      reason: 'QA automated approval test',
      review_notes: `QA TEST - DELETE approval run ${RUN_ID}`,
      checklist: review?.review?.automated?.checklist || review?.review?.checklist || {}
    }
  });
  return response.data;
}

async function main() {
  if (!ADMIN_API_KEY && !OTP_CODE) {
    throw new Error(`Missing admin key or OTP override.\n\n${usage()}`);
  }

  const payloads = [];
  const typeCounts = {};
  plannedConfigs(LISTING_COUNT).forEach((config, index) => {
    typeCounts[config.type] = (typeCounts[config.type] || 0) + 1;
    payloads.push(buildPayload(config, typeCounts[config.type], index + 1));
  });

  const results = [];
  console.log(`Creating ${payloads.length} QA listings against ${BASE_URL}`);
  console.log(`Run ID: ${RUN_ID}`);
  console.log(SHOULD_APPROVE ? 'Approval mode: ON' : 'Approval mode: OFF, listings will stay pending');

  for (const [idx, payload] of payloads.entries()) {
    const label = `${idx + 1}/${payloads.length} ${payload.listing_type} ${payload.inquiry_reference}`;
    try {
      const listingToken = await getListingToken(payload);
      const createResponse = await api('/api/properties', {
        method: 'POST',
        body: {
          ...payload,
          listing_otp_token: listingToken
        }
      });
      const propertyId = createResponse.data.id;
      const review = await loadReview(propertyId);
      const approval = await approveListing(propertyId, review);
      const automated = review?.review?.automated || null;
      const result = {
        ok: true,
        property_id: propertyId,
        reference: createResponse.data.inquiry_reference || payload.inquiry_reference,
        listing_type: payload.listing_type,
        title: payload.title,
        status: approval?.status || createResponse.data.status,
        owner_email_sent: createResponse.data.owner_email_sent,
        owner_whatsapp_sent: createResponse.data.owner_whatsapp_sent,
        owner_whatsapp_url: createResponse.data.owner_whatsapp_url,
        automated_status: automated?.status || null,
        can_approve: automated?.can_approve ?? null,
        blocking_failures: automated?.blocking_failures?.map((item) => item.label) || [],
        warnings: automated?.warnings?.map((item) => item.label) || []
      };
      results.push(result);
      console.log(`[OK] ${label} -> ${propertyId} (${result.status}, automated=${result.automated_status || 'not checked'})`);
    } catch (error) {
      if (error.status === 401 && ADMIN_API_KEY) {
        throw new Error(
          `Live ADMIN_API_KEY was rejected by ${BASE_URL}. No listings were created. `
          + 'Update the local .env ADMIN_API_KEY to match Render, then rerun this script.'
        );
      }
      const result = {
        ok: false,
        reference: payload.inquiry_reference,
        listing_type: payload.listing_type,
        title: payload.title,
        error: error.message,
        details: error.body?.details || error.body || null
      };
      results.push(result);
      console.error(`[FAIL] ${label}: ${error.message}`);
      if (error.body?.details) console.error(`       ${JSON.stringify(error.body.details)}`);
    }
  }

  const summary = {
    run_id: RUN_ID,
    base_url: BASE_URL,
    approve_requested: SHOULD_APPROVE,
    created: results.filter((item) => item.ok).length,
    failed: results.filter((item) => !item.ok).length,
    approved: results.filter((item) => item.status === 'approved').length,
    pending: results.filter((item) => item.status === 'pending').length,
    results
  };

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`\nSummary written to ${OUTPUT_FILE}`);
  console.log(JSON.stringify({
    created: summary.created,
    failed: summary.failed,
    approved: summary.approved,
    pending: summary.pending
  }, null, 2));

  if (summary.failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
