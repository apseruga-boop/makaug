'use strict';

// Public short-stay payloads must not leak host email, street address, an
// exact map pin, or partner rate internals. A host or agent stay may expose
// a tel link and WhatsApp digits so the guest can open their own chat.
// Imported and do-not-message stays never do. "Verified" is a staff check,
// not the host's own right-to-let tick box.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const service = require('../services/shortTermService');
const render = require('../services/shortTermSeoRenderService');

const STREET = 'Plot 14 Acacia Avenue, Kololo';
const EMAIL = 'host.private@example.com';
const EXACT_LAT = 0.347891;
const EXACT_LNG = 32.582341;

function hostRow(overrides = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    reference: 'ST-000099',
    slug: 'kololo-garden-flat',
    title: 'Garden flat in Kololo',
    description: 'A quiet flat.',
    district: 'Kampala',
    area: 'Kololo',
    address: STREET,
    latitude: EXACT_LAT,
    longitude: EXACT_LNG,
    host_name: 'Amina',
    host_phone: '0700000000',
    host_whatsapp: '256700000000',
    host_email: EMAIL,
    host_user_id: '22222222-2222-4222-8222-222222222222',
    right_to_let_declared: true,
    king_facts_confirmed: true,
    moderation_notes: 'Staff note that must stay private',
    moderation_checklist: { right_to_let_confirmed: true },
    base_nightly_ugx: 120000,
    source: 'direct',
    ...overrides
  };
}

test('public listing hides email, street, exact pin and the host tick-box', () => {
  const listing = service.normalizeShortTermListing(hostRow());
  const blob = JSON.stringify(listing);

  assert.equal(listing.area, 'Kololo');
  assert.equal(listing.district, 'Kampala');
  assert.equal(Object.hasOwn(listing, 'address'), false);
  assert.equal(Object.hasOwn(listing, 'contact'), false);
  assert.equal(listing.verified, false);
  assert.equal(blob.includes(STREET), false);
  assert.equal(blob.includes(EMAIL), false);
  assert.equal(blob.includes('host_email'), false);
  assert.equal(blob.includes('host_phone'), false);
  assert.equal(blob.includes('host_whatsapp'), false);
  assert.equal(blob.includes('host_user_id'), false);
  assert.equal(blob.includes('moderation_checklist'), false);
  assert.equal(blob.includes('moderation_notes'), false);
  assert.equal(blob.includes('Staff note'), false);
  assert.equal(blob.includes(String(EXACT_LAT)), false);
  assert.equal(blob.includes(String(EXACT_LNG)), false);
  assert.equal(listing.latitude, service.coarseCoordinate(EXACT_LAT));
  assert.equal(listing.longitude, service.coarseCoordinate(EXACT_LNG));
  assert.notEqual(listing.latitude, EXACT_LAT);
  assert.ok(Math.abs(listing.latitude - EXACT_LAT) <= 0.0045);
  assert.ok(Math.abs(listing.longitude - EXACT_LNG) <= 0.0045);
});

test('verified comes only from a saved staff identity or contact check', () => {
  assert.equal(service.normalizeShortTermListing(hostRow()).verified, false);
  assert.equal(service.normalizeShortTermListing(hostRow({
    moderation_checklist: { identity_checked: true }
  })).verified, true);
  assert.equal(service.normalizeShortTermListing(hostRow({
    moderation_checklist: { contact_details_verified: true }
  })).verified, true);
  assert.equal(service.normalizeShortTermListing(hostRow({
    right_to_let_declared: true,
    king_facts_confirmed: true,
    moderation_checklist: { right_to_let_confirmed: true, king_facts_confirmed: true }
  })).verified, false);
  assert.equal(service.normalizeShortTermListing(hostRow({
    moderation_checklist: JSON.stringify({ identity_checked: 'pass' })
  })).verified, true);
  assert.equal(service.normalizeShortTermListing(hostRow({
    moderation_checklist: { identity_checked: 'false', contact_details_verified: false }
  })).verified, false);
});

test('a date enquiry returns phone and WhatsApp and still hides email and street', () => {
  const listing = service.normalizeShortTermListing(hostRow(), { includeContact: true });
  const blob = JSON.stringify(listing);

  assert.equal(listing.contact.phone, '+256700000000');
  assert.equal(listing.contact.whatsapp_href, 'https://wa.me/256700000000');
  assert.equal(listing.contact.tel_href, 'tel:+256700000000');
  assert.equal(Object.hasOwn(listing.contact, 'email'), false);
  assert.equal(blob.includes(EMAIL), false);
  assert.equal(blob.includes(STREET), false);
  assert.equal(Object.hasOwn(listing, 'address'), false);
  assert.notEqual(listing.latitude, EXACT_LAT);
});

test('partner search rows drop street, phone, email and rate internals', () => {
  const row = service.sanitizePublicPartnerListing({
    reference: 'la-99',
    source: 'liteapi',
    title: 'Kololo Hotel',
    area: 'Plot 72 Kira Road',
    district: 'Kampala',
    latitude: EXACT_LAT,
    longitude: EXACT_LNG,
    host_phone: '+256700000000',
    host_email: 'hotel@example.com',
    email: 'desk@example.com',
    contact: { phone: '+256700000000', email: 'desk@example.com' },
    address: 'Plot 72 Kira Road',
    price_per_night: 180000,
    price_display: 'UGX 180,000',
    price_total_display: 'UGX 360,000',
    price_nights: 2,
    price_basis: {
      source_currency: 'USD',
      source_total: 95,
      fx_rate: 3700,
      markup_percent: 12
    },
    markup_percent: 12,
    source_currency: 'USD',
    source_total: 95,
    fx_rate: 3700
  });
  const blob = JSON.stringify(row);

  assert.equal(row.area, null);
  assert.equal(row.district, 'Kampala');
  assert.equal(row.price_display, 'UGX 180,000');
  assert.equal(row.price_per_night, 180000);
  assert.equal(row.price_total_display, 'UGX 360,000');
  assert.equal(Object.hasOwn(row, 'price_basis'), false);
  assert.equal(Object.hasOwn(row, 'host_phone'), false);
  assert.equal(Object.hasOwn(row, 'contact'), false);
  assert.equal(Object.hasOwn(row, 'markup_percent'), false);
  assert.equal(Object.hasOwn(row, 'fx_rate'), false);
  assert.equal(blob.includes('Plot 72'), false);
  assert.equal(blob.includes('hotel@example.com'), false);
  assert.equal(blob.includes('desk@example.com'), false);
  assert.equal(blob.includes('USD'), false);
  assert.equal(blob.includes('3700'), false);
  assert.equal(blob.includes('markup'), false);
  assert.notEqual(row.latitude, EXACT_LAT);
  assert.equal(row.latitude, service.coarseCoordinate(EXACT_LAT));
});

test('hotelbeds partner pins are coarsened and carry no street', () => {
  const row = service.sanitizePublicPartnerListing({
    source: 'hotelbeds',
    title: 'A hotel',
    area: 'PO Box 1 Kampala',
    latitude: 0.3132,
    longitude: 32.5811,
    price_basis: { markup_percent: 8, source_total: 40 }
  });
  const blob = JSON.stringify(row);
  assert.equal(row.area, null);
  assert.equal(Object.hasOwn(row, 'price_basis'), false);
  assert.notEqual(row.latitude, 0.3132);
  assert.equal(blob.includes('PO Box'), false);
  assert.equal(blob.includes('markup'), false);
});

test('structured data uses the coarsened pin and has no street or email', () => {
  const listing = service.normalizeShortTermListing(hostRow());
  const data = render.vacationRentalStructuredData(listing, 'https://makaug.com');
  const blob = JSON.stringify(data);
  assert.equal(data.address.streetAddress, undefined);
  assert.equal(data.address.addressLocality, 'Kololo');
  assert.equal(data.geo.latitude, listing.latitude);
  assert.equal(data.geo.longitude, listing.longitude);
  assert.equal(blob.includes(STREET), false);
  assert.equal(blob.includes(EMAIL), false);
  assert.notEqual(data.geo.latitude, EXACT_LAT);
});

test('imported and do-not-message stays never expose a lister number', () => {
  const imported = service.normalizeShortTermListing(hostRow({
    source: 'imported',
    extra_fields: {
      source_url: 'https://www.tiktok.com/@example/video/1',
      alt_host_phone: '0700000000'
    }
  }), { directContact: true });
  const importedBlob = JSON.stringify(imported);
  assert.equal(imported.direct_contact, null);
  assert.equal(imported.found_online, true);
  assert.equal(imported.source_url, 'https://www.tiktok.com/@example/video/1');
  assert.equal(importedBlob.includes('700000000'), false);
  assert.equal(importedBlob.includes('wa.me'), false);
  assert.equal(importedBlob.includes('tel:'), false);

  const blocked = service.normalizeShortTermListing(hostRow({
    source: 'direct',
    extra_fields: { do_not_message: true }
  }), { directContact: true });
  assert.equal(blocked.direct_contact, null);
  assert.equal(JSON.stringify(blocked).includes('700000000'), false);

  const agent = service.normalizeShortTermListing(hostRow({
    source: 'direct',
    host_type: 'agent'
  }), { directContact: true });
  assert.equal(agent.found_online, false);
  assert.equal(agent.direct_contact.whatsapp_digits, '256700000000');
  assert.equal(agent.direct_contact.tel_href, 'tel:+256700000000');
  assert.equal(Object.hasOwn(agent.direct_contact, 'phone'), false);
  assert.equal(Object.hasOwn(agent.direct_contact, 'phone_display'), false);
});

test('the WhatsApp draft names the stay, the page, and the dates the guest picked', () => {
  const dated = service.buildStayWhatsAppMessage({
    title: 'Garden flat',
    reference: 'ST-000003',
    url: 'https://makaug.com/short-term/garden-flat',
    checkIn: '2026-12-12',
    checkOut: '2026-12-15',
    guests: 2
  });
  assert.equal(dated, 'Hi, I saw your stay "Garden flat" (ST-000003) on makaug.com: https://makaug.com/short-term/garden-flat. Is it available from 12 Dec to 15 Dec 2026 (3 nights) for 2 guests?');
  const open = service.buildStayWhatsAppMessage({
    title: 'Garden flat',
    reference: 'ST-000003',
    url: 'https://makaug.com/short-term/garden-flat'
  });
  assert.equal(open, 'Hi, I saw your stay "Garden flat" (ST-000003) on makaug.com: https://makaug.com/short-term/garden-flat. Is it available?');
});

test('search and map stay contact-free; a stay page may link the lister, an enquiry still can', () => {
  const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'short-term.js'), 'utf8');
  const searchAt = route.indexOf("router.get('/search'");
  const mapAt = route.indexOf("router.get('/map'");
  const summaryAt = route.indexOf("router.get('/summary'");
  const listingAt = route.indexOf("router.get('/listings/:slug'");
  const enquiryAt = route.indexOf("router.post('/listings/:id/enquiries'");
  const reviewsAt = route.indexOf("router.get('/listings/:id/reviews'");

  const search = route.slice(searchAt, mapAt);
  const map = route.slice(mapAt, summaryAt);
  const listing = route.slice(listingAt, enquiryAt);
  const enquiry = route.slice(enquiryAt, reviewsAt);

  assert.equal(search.includes('includeContact'), false);
  assert.equal(search.includes('liteapiContacts'), false);
  assert.equal(search.includes('price_basis'), false);
  assert.equal(search.includes('sanitizePublicPartnerListing'), true);
  assert.equal(map.includes('includeContact'), false);
  assert.equal(map.includes('directContact'), false);
  assert.equal(search.includes('directContact'), false);
  assert.equal(listing.includes('includeContact'), false);
  assert.equal(listing.includes('directContact: true'), true);
  assert.equal(listing.includes('!listing.direct_contact'), true);
  assert.equal(enquiry.includes('includeContact: true'), true);
  assert.equal(enquiry.includes('contact: listing.contact'), true);
  assert.equal(route.includes('liteapiContacts'), false);
});
