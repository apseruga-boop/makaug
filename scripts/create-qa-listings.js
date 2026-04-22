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
const OUTPUT_FILE = process.env.QA_OUTPUT_FILE
  || path.join(process.cwd(), 'qa-output', `makaug-qa-listings-${RUN_ID}.json`);

function usage() {
  return [
    'Create 25 production QA listings through the public listing submission API.',
    '',
    'Required for the secure override path:',
    '  ADMIN_API_KEY=<admin key>',
    '',
    'Optional:',
    '  QA_BASE_URL=https://makaug.com',
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

function dataImage(label, seed, fill = '#0f766e') {
  const safe = String(label || '').replace(/[<>&"]/g, ' ');
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="900" viewBox="0 0 1280 900">`,
    `<rect width="1280" height="900" fill="${fill}"/>`,
    `<rect x="70" y="70" width="1140" height="760" rx="28" fill="rgba(255,255,255,0.18)" stroke="rgba(255,255,255,0.55)" stroke-width="8"/>`,
    `<text x="110" y="230" font-family="Arial, sans-serif" font-size="62" font-weight="700" fill="#fff">QA TEST - DELETE</text>`,
    `<text x="110" y="330" font-family="Arial, sans-serif" font-size="46" fill="#fff">${safe}</text>`,
    `<text x="110" y="430" font-family="Arial, sans-serif" font-size="32" fill="#d1fae5">Seed ${seed}</text>`,
    `<text x="110" y="760" font-family="Arial, sans-serif" font-size="30" fill="#ecfeff">MakaUg production QA listing</text>`,
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
  {
    type: 'sale',
    count: 5,
    district: 'Kampala',
    area: 'Kololo',
    price: 385000000,
    property_type: 'House',
    price_period: 'once',
    slots: ['front', 'living', 'kitchen', 'bedroom', 'bath']
  },
  {
    type: 'rent',
    count: 5,
    district: 'Wakiso',
    area: 'Kira',
    price: 1800000,
    property_type: 'Apartment',
    price_period: 'mo',
    slots: ['front', 'living', 'kitchen', 'bedroom', 'bath']
  },
  {
    type: 'student',
    count: 5,
    district: 'Kampala',
    area: 'Kikoni',
    price: 650000,
    property_type: 'Hostel',
    room_type: 'Single Room',
    price_period: 'sem',
    nearest_university: 'Makerere University',
    distance_to_uni_km: 0.8,
    slots: ['room', 'bath', 'shared', 'front', 'access']
  },
  {
    type: 'commercial',
    count: 5,
    district: 'Jinja',
    area: 'Jinja Central',
    price: 4200000,
    property_type: 'Office',
    price_period: 'mo',
    commercial_intent: 'rent',
    slots: ['front', 'interior', 'access', 'utilities', 'washroom']
  },
  {
    type: 'land',
    count: 5,
    district: 'Mukono',
    area: 'Seeta',
    price: 92000000,
    property_type: 'Residential Plot',
    price_period: 'once',
    land_size_value: 25,
    land_size_unit: 'decimals',
    slots: ['front', 'road', 'boundary', 'title', 'surroundings']
  }
];

function buildPayload(config, indexWithinType, globalIndex) {
  const title = `QA TEST - DELETE ${config.type.toUpperCase()} Listing ${indexWithinType}`;
  const phone = makePhone(globalIndex);
  const email = makeEmail(globalIndex);
  const nin = makeNin(globalIndex);
  const lat = 0.315 + (globalIndex * 0.001);
  const lng = 32.55 + (globalIndex * 0.001);
  const idDocumentName = `qa-test-delete-id-${globalIndex}.png`;
  const idDocumentUrl = dataImage(`National ID ${nin}`, `${RUN_ID}-${globalIndex}-id`, '#1d4ed8');
  const images = config.slots.map((slot, photoIndex) => ({
    url: dataImage(`${title} - ${slot}`, `${RUN_ID}-${globalIndex}-${photoIndex + 1}`, ['#0f766e', '#2563eb', '#7c3aed', '#c2410c', '#047857'][photoIndex % 5]),
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
    description: `QA TEST - DELETE production listing ${globalIndex}. This dummy listing is for automated MakaUg approval workflow testing and should be deleted after QA.`,
    district: config.district,
    area: `${config.area} QA ${indexWithinType}`,
    address: `${config.area} QA Test Road ${indexWithinType}`,
    price: config.price + (indexWithinType * 10000),
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
    amenities: ['QA Test', 'Delete After Test', 'Automated Review'],
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
    inquiry_reference: `QA-${RUN_ID}-${String(globalIndex).padStart(2, '0')}`,
    otp_channel: 'email',
    id_number: nin,
    id_document_name: idDocumentName,
    id_document_url: idDocumentUrl,
    new_until: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
    main_photo_index: 0,
    images,
    extra_fields: {
      qa_test_delete: true,
      qa_run_id: RUN_ID,
      map_pin_confirmed: true,
      coordinates: { lat, lng },
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
  let globalIndex = 1;
  typeConfigs.forEach((config) => {
    for (let i = 1; i <= config.count; i += 1) {
      payloads.push(buildPayload(config, i, globalIndex));
      globalIndex += 1;
    }
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
