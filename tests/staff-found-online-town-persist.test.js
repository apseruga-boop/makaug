'use strict';

// Found-online Town revert (MK-20261018-7B1FA9).
// The editor sends Town as `city` (#admin-review-city-edit). The save writes
// extra_fields.city. The editor reads extra.city, then extra.town, then
// staff_review_public_listing_facts.city. A district-only Wakiso row must not
// come back as Town, Area, or Neighbourhood, and a clear must stay clear.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');

const { updateStaffEditableListing, loadStaffPropertyPreview, normalizeStaffListingPatch } = require('../routes/staff')._test;
const { canonicalWhatsappLocationPatch, resolveWhatsappLocation } = require('../services/whatsappLocationResolverService');
const whatsapp = require('../routes/whatsapp');

const app = fs.readFileSync(path.join(__dirname, '../assets/makaug-app.js'), 'utf8');
const whatsappSource = fs.readFileSync(path.join(__dirname, '../routes/whatsapp.js'), 'utf8');

const PROPERTY_ID = '66e18a17-528c-4e17-8cec-71127ff9e5c1';

function blankFoundOnline() {
  return {
    id: PROPERTY_ID,
    inquiry_reference: 'MK-20261018-7B1FA9',
    status: 'pending',
    title: 'House found on YouTube',
    description: 'A house shown in a video.',
    listing_type: 'sale',
    area: '',
    district: '',
    address: null,
    price: 120000000,
    price_on_application: false,
    price_period: 'once',
    price_original_currency: 'UGX',
    moderation_notes: '',
    moderation_reason: '',
    moderation_stage: 'submitted',
    source: 'youtube',
    listed_via: 'found_online',
    extra_fields: {
      source_platform: 'YouTube',
      source_url: 'https://www.youtube.com/watch?v=found-online-kira',
      source_title: 'House tour',
      source_caption: 'Nice house for sale. Call 0700000000.',
      location_resolution_status: 'unresolved',
      canonical_location_id: null,
      city: null,
      neighborhood: null,
      region: null,
      resolved_location_label: null
    }
  };
}

function applyStaffUpdate(row, sql, params) {
  const text = String(sql);
  for (const column of ['title', 'description', 'listing_type', 'area', 'district', 'address', 'price', 'price_period']) {
    const match = text.match(new RegExp(`\\b${column}\\s*=\\s*\\$(\\d+)`));
    if (match) row[column] = params[Number(match[1]) - 1];
  }
  const extraMatch = text.match(/\|\|\s*\$(\d+)::jsonb/);
  if (extraMatch) {
    const patch = JSON.parse(params[Number(extraMatch[1]) - 1]);
    row.extra_fields = { ...(row.extra_fields || {}) };
    Object.entries(patch).forEach(([key, value]) => {
      row.extra_fields[key] = value;
    });
  }
  return row;
}

async function saveThenGet(row, listingPatch) {
  const db = require('../config/database');
  const originalQuery = db.query;
  const originalGetClient = db.getClient;
  db.query = async (sql, params) => {
    const text = String(sql);
    if (text.includes('SELECT * FROM properties')) return { rows: [row] };
    if (text.includes('UPDATE properties')) {
      applyStaffUpdate(row, text, params);
      return { rows: [row] };
    }
    return { rows: [] };
  };
  db.getClient = async () => ({
    query: async (sql) => {
      const text = String(sql);
      if (/FROM properties/i.test(text) && /SELECT/i.test(text)) {
        return { rows: [{ ...row, extra_fields: { ...(row.extra_fields || {}) } }] };
      }
      return { rows: [] };
    },
    release() {}
  });
  try {
    await updateStaffEditableListing({ userAuth: { id: null } }, row.id, listingPatch, {});
    const preview = await loadStaffPropertyPreview(row.id);
    const again = await loadStaffPropertyPreview(row.id);
    return { preview, again };
  } finally {
    db.query = originalQuery;
    db.getClient = originalGetClient;
  }
}

function assertTownIsKira(preview, { district = 'Wakiso' } = {}) {
  const extra = preview.extra_fields || {};
  assert.equal(extra.city, 'Kira');
  assert.equal(preview.location_review.city, 'Kira');
  assert.equal(extra.staff_review_public_listing_facts.city, 'Kira');
  assert.equal(preview.district, district);
  assert.equal(preview.area, '');
  assert.equal(extra.neighborhood, null);
  assert.notEqual(extra.neighborhood, 'Wakiso');
  assert.notEqual(preview.area, 'Wakiso');
  assert.equal(extra.resolved_location_label, 'Kira, Wakiso');
  assert.equal(extra.canonical_location_id, null);
  assert.equal(extra.location_resolution_status, 'unresolved');
  assert.ok(extra.staff_location_reviewed_at);
}

test('a found-online town-only save survives a GET with no canonical id', async () => {
  const { preview, again } = await saveThenGet(blankFoundOnline(), {
    city: 'Kira',
    area: '',
    neighborhood: '',
    district: '',
    region: '',
    address: ''
  });
  assertTownIsKira(preview);
  assertTownIsKira(again);
  assert.equal(preview.extra_fields.region, 'Central');
  assert.equal(preview.address, null);
});

test('district plus town persists Kira and does not store the district as the place', async () => {
  const { preview, again } = await saveThenGet(blankFoundOnline(), {
    city: 'Kira',
    area: '',
    neighborhood: '',
    district: 'Wakiso',
    region: '',
    address: ''
  });
  assertTownIsKira(preview);
  assertTownIsKira(again);
  assert.equal(preview.extra_fields.region, 'Central');
  assert.equal(preview.address, null);
});

test('a town alias is accepted when city is absent', () => {
  const saved = normalizeStaffListingPatch(blankFoundOnline(), {
    town: 'Kira',
    area: '',
    neighborhood: '',
    district: 'Wakiso'
  });
  assert.deepEqual(saved.errors, []);
  assert.equal(saved.hierarchy.city, 'Kira');
  assert.equal(saved.patch.area, '');
  assert.equal(saved.hierarchy.neighborhood, '');
});

test('clearing region, district, area, town and the address note stays clear on GET', async () => {
  const row = blankFoundOnline();
  await saveThenGet(row, {
    city: 'Kira',
    area: '',
    neighborhood: '',
    district: 'Wakiso',
    region: 'Central',
    address: ''
  });
  assert.equal(row.extra_fields.city, 'Kira');
  assert.equal(row.extra_fields.resolved_location_label, 'Kira, Wakiso');

  const { preview: cleared, again } = await saveThenGet(row, {
    city: '',
    town: '',
    area: '',
    neighborhood: '',
    district: '',
    region: '',
    address: ''
  });
  const extra = cleared.extra_fields;
  assert.equal(cleared.district, '');
  assert.equal(cleared.area, '');
  assert.equal(cleared.address, null);
  assert.equal(extra.city, null);
  assert.equal(extra.neighborhood, null);
  assert.equal(extra.region, null);
  assert.equal(extra.resolved_location_label, null);
  assert.equal(extra.canonical_location_id, null);
  assert.equal(extra.location_resolution_status, 'unresolved');
  assert.equal(cleared.location_review.city, '');
  assert.equal(again.district, '');
  assert.equal(again.area, '');
  assert.equal(again.extra_fields.city, null);
  assert.equal(again.extra_fields.resolved_location_label, null);
  assert.equal(again.location_review.city, '');
});

test('the editor does not turn a staff district into a source chip or a town', () => {
  const detectedStart = app.indexOf('function adminReviewDetectedLocation');
  const detected = app.slice(detectedStart, app.indexOf('function adminReviewPropertyTypeFromText', detectedStart));
  assert.match(detected, /adminReviewOriginalSourceText\(review\)/);
  assert.doesNotMatch(detected, /review\.district/);
  assert.doesNotMatch(detected, /review\.area/);

  const autoStart = app.indexOf('async function adminReviewAutoPopulateLocationFromSource');
  const auto = app.slice(autoStart, app.indexOf('function adminLocationReclassificationReviewHtml', autoStart));
  assert.match(auto, /extra\.staff_location_reviewed_at\) return/);
  assert.doesNotMatch(auto, /addressEl\.value = query/);
  assert.doesNotMatch(auto, /review\.district \|\| facts\.district/);

  const applyStart = app.indexOf('function applyAdminReviewCanonicalLocation');
  const apply = app.slice(applyStart, app.indexOf('function clearLpCanonicalLocationCascade', applyStart));
  assert.match(apply, /level === "district" \|\| level === "region"/);
  assert.match(apply, /return false/);

  const panelStart = app.indexOf('function adminReviewListingEditPanel');
  const panel = app.slice(panelStart, app.indexOf('function adminSetReviewEditValue', panelStart));
  assert.match(panel, /extra\.city \|\| extra\.town \|\| review\.city \|\| staffFacts\.city/);
  assert.match(panel, /const initialDistrict = proposedDistrict \|\| review\.district \|\| ""/);
  assert.match(panel, /const initialSearchLabel = searchLabelAgrees \? storedSearchLabel : ""/);
  assert.doesNotMatch(panel, /facts\.district/);
  assert.doesNotMatch(panel, /facts\.area/);

  const refreshStart = app.indexOf('function adminReviewRefreshHierarchyControls');
  const refresh = app.slice(refreshStart, app.indexOf('function adminReviewOnRegionChange', refreshStart));
  assert.match(refresh, /adminReviewPlaceEqualsDistrict\(fields\.neighborhood/);
  assert.match(refresh, /adminReviewPlaceEqualsDistrict\(fields\.area/);
});

test('WhatsApp employee intake stores a specific town and not a district-only name', () => {
  const wakiso = resolveWhatsappLocation('Wakiso');
  assert.equal(wakiso.match.level, 'district');
  const wakisoPatch = canonicalWhatsappLocationPatch(wakiso);
  assert.equal(wakisoPatch.city, undefined);
  assert.equal(wakisoPatch.area, undefined);

  const kira = canonicalWhatsappLocationPatch(resolveWhatsappLocation('Kira'));
  assert.equal(kira.city, 'Kira');
  assert.equal(kira.district, 'Wakiso');
  assert.notEqual(kira.area, 'Wakiso');

  const kitende = canonicalWhatsappLocationPatch(resolveWhatsappLocation('Kitende'));
  assert.equal(kitende.area, 'Kitende');
  assert.equal(kitende.city, 'Kajjansi');
  assert.notEqual(kitende.area, 'Wakiso');

  const employeeKira = whatsapp.__test.employeePropertyFacts(
    '4 bedroom house for sale in Kira 650M. Ready title',
    {}
  );
  assert.equal(employeeKira.locationPatch.city, 'Kira');
  assert.equal(employeeKira.locationPatch.district, 'Wakiso');
  assert.notEqual(employeeKira.locationPatch.area, 'Wakiso');

  const employeeDistrict = whatsapp.__test.employeePropertyFacts(
    'Land for sale in Wakiso district 45M',
    {}
  );
  assert.notEqual(employeeDistrict.locationPatch.city, 'Wakiso');
  assert.notEqual(employeeDistrict.locationPatch.area, 'Wakiso');

  assert.match(whatsappSource, /city: facts\.locationPatch\.city \|\| null/);
  assert.match(whatsappSource, /city: locationPatch\.city \|\| null/);
  assert.match(whatsappSource, /whatsappResolvedLocationLabel\(facts\.locationPatch\)/);
});
