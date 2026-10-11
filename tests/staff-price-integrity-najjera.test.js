'use strict';

// Moderator retest: a saved numeric price was still blocked as Price on
// application because price_status / price_label (and the source label) stayed
// POA. Saving Najjera under Kira rewrote the neighbourhood to Kira. Preview
// save then threw ReferenceError on `notes` after the UPDATE had committed,
// which the client showed as Internal Server Error.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');

const { listingDataIntegrityReport } = require('../utils/listingDataIntegrity');
const { staffPriceExtraPatch } = require('../utils/staffPriceChoice');
const { normalizeStaffListingPatch, updateStaffEditableListing } = require('../routes/staff')._test;

const app = fs.readFileSync(path.join(__dirname, '../assets/makaug-app.js'), 'utf8');
const staff = fs.readFileSync(path.join(__dirname, '../routes/staff.js'), 'utf8');

const SAVED_NUMERIC = {
  title: 'House in Najjera',
  description: 'Three bedroom house for rent in Najjera, Kira.',
  listing_type: 'rent',
  price: 1500000,
  price_period: 'month',
  price_currency: 'UGX',
  price_original_currency: 'UGX',
  price_on_application: false,
  area: 'Najjera',
  district: 'Wakiso',
  lister_phone: '+256700000000',
  extra_fields: {
    price_on_application: false,
    price_upon_application: false,
    price_quality: { ok: true, reasons: [] },
    price_status: 'price_upon_application',
    price_label: 'Price upon application',
    source_price_label: 'Price upon application',
    source_price_rejection_reason: 'source had no figure'
  }
};

test('a staff-confirmed numeric price is not a POA conflict', () => {
  const report = listingDataIntegrityReport(SAVED_NUMERIC);
  assert.equal(report.issue_codes.includes('price_and_poa_conflict'), false, report.issue_codes.join(','));
  assert.equal(report.price_on_application, false);

  const stillPoa = listingDataIntegrityReport({
    ...SAVED_NUMERIC,
    price_on_application: true,
    extra_fields: { ...SAVED_NUMERIC.extra_fields, price_on_application: true, price_upon_application: true }
  });
  assert.equal(stillPoa.issue_codes.includes('price_and_poa_conflict'), true);

  const unlabeled = listingDataIntegrityReport({
    ...SAVED_NUMERIC,
    price_on_application: null,
    extra_fields: {
      price_label: 'Price upon application',
      source_price_label: 'Price upon application',
      price_status: 'price_upon_application'
    }
  });
  assert.equal(unlabeled.issue_codes.includes('price_and_poa_conflict'), true);
});

test('a staff numeric-price save resets live labels and keeps source history', () => {
  const existing = {
    price: 1500000,
    price_on_application: false
  };
  const existingExtra = { ...SAVED_NUMERIC.extra_fields };
  const amount = staffPriceExtraPatch({ mode: 'amount', existing, existingExtra });
  assert.equal(amount.price_on_application, false);
  assert.equal(amount.price_upon_application, false);
  assert.equal(amount.price_status, 'published_price_or_guide_price');
  assert.equal(amount.price_label, null);
  assert.equal(Object.prototype.hasOwnProperty.call(amount, 'source_price_label'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(amount, 'source_price_rejection_reason'), false);

  const nextSave = staffPriceExtraPatch({ mode: 'unchanged', existing, existingExtra });
  assert.equal(nextSave.price_status, 'published_price_or_guide_price');
  assert.equal(nextSave.price_label, null);
  assert.equal(Object.prototype.hasOwnProperty.call(nextSave, 'source_price_label'), false);

  const clean = staffPriceExtraPatch({
    mode: 'unchanged',
    existing,
    existingExtra: { price_on_application: false, price_upon_application: false, price_status: 'published_price_or_guide_price', price_label: null }
  });
  assert.equal(clean, null);

  const poa = staffPriceExtraPatch({ mode: 'poa', existing, existingExtra });
  assert.equal(poa.price_on_application, true);
  assert.equal(Object.prototype.hasOwnProperty.call(poa, 'price_status'), false);
});

test('saving Najjera while the area box still says Kira keeps Najjera', () => {
  const saved = normalizeStaffListingPatch({
    area: 'Kira',
    district: 'Wakiso',
    listing_type: 'rent',
    extra_fields: { city: 'Kira', neighborhood: 'Kira', region: 'Central' }
  }, {
    area: 'Kira',
    district: 'Wakiso',
    city: 'Kira',
    neighborhood: 'Najjera'
  });
  assert.deepEqual(saved.errors, [], saved.errors.join('; '));
  assert.equal(saved.patch.area, 'Najjera');
  assert.equal(saved.hierarchy.neighborhood, 'Najjera');
  assert.equal(saved.hierarchy.city, 'Kira');
});

test('the review form sends the neighbourhood dropdown, not a stale town match', () => {
  const changeStart = app.indexOf('async function adminReviewOnNeighborhoodChange');
  const changeBody = app.slice(changeStart, changeStart + 280);
  assert.match(changeBody, /adminReviewCanonicalLocationResolution = null/);
  assert.match(app, /const areaIsTown = !current \|\| areaEl\.dataset\.auto === "1" \|\| \(town && current === town\)/);
  const collectStart = app.indexOf('function collectAdminReviewListingPatch');
  const collect = app.slice(collectStart, app.indexOf('function adminReviewHumanLocationConfirmation', collectStart));
  assert.match(collect, /get\("admin-review-neighborhood-edit"\)/);
  assert.doesNotMatch(collect, /canonical\?\.name \|\| get\("admin-review-neighborhood-edit"\)/);
  assert.match(staff, /noteBody \|\| null/);
  assert.match(staff, /logStaffActivityInBackground\(req, 'staff_listing_preview_saved'/);
  assert.match(staff, /Preview save is busy/);
});

test('preview save returns after the update commits', async () => {
  const db = require('../config/database');
  const original = db.query;
  const calls = [];
  const row = {
    id: '11111111-1111-1111-1111-111111111111',
    status: 'pending',
    title: 'Old title',
    area: 'Kira',
    district: 'Wakiso',
    listing_type: 'rent',
    price: 1500000,
    price_on_application: false,
    price_period: 'month',
    price_original_currency: 'UGX',
    moderation_notes: '',
    moderation_reason: '',
    extra_fields: {
      city: 'Kira',
      neighborhood: 'Kira',
      region: 'Central',
      price_on_application: false,
      price_upon_application: false,
      price_status: 'price_upon_application',
      price_label: 'Price upon application',
      source_price_label: 'Price upon application',
      source_price_rejection_reason: 'kept'
    }
  };
  db.query = async (sql, params) => {
    const text = String(sql);
    calls.push({ text, params });
    if (text.includes('staff_activity_logs') || text.includes('INSERT INTO audit_logs')) {
      const error = new Error('canceling statement due to statement timeout');
      error.code = '57014';
      throw error;
    }
    if (text.includes('SELECT * FROM properties')) return { rows: [row] };
    if (text.includes('UPDATE properties')) return { rows: [{ ...row, title: 'House in Najjera' }] };
    return { rows: [] };
  };
  try {
    const saved = await updateStaffEditableListing(
      { userAuth: { id: null } },
      row.id,
      {
        title: 'House in Najjera',
        area: 'Kira',
        district: 'Wakiso',
        city: 'Kira',
        neighborhood: 'Najjera',
        price: '1500000',
        price_on_application: false,
        price_period: 'month',
        price_original_currency: 'UGX'
      },
      { notes: 'Checked Najjera' }
    );
    assert.equal(saved.property.title, 'House in Najjera');
    const update = calls.find((call) => call.text.includes('UPDATE properties'));
    const extraJson = update.params.find((value) => typeof value === 'string' && value.includes('price_status'));
    const extra = JSON.parse(extraJson);
    assert.equal(extra.price_status, 'published_price_or_guide_price');
    assert.equal(extra.price_label, null);
    assert.equal(extra.neighborhood, 'Najjera');
    assert.equal(Object.prototype.hasOwnProperty.call(extra, 'source_price_label'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(extra, 'source_price_rejection_reason'), false);
    const event = calls.find((call) => call.text.includes('INSERT INTO property_moderation_events'));
    assert.ok(event, 'moderation event insert runs');
    assert.equal(event.params[4], 'Checked Najjera');
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    db.query = original;
  }
});

test('a database lock or statement timeout on preview save is retryable', async () => {
  const db = require('../config/database');
  const original = db.query;
  db.query = async (sql) => {
    const text = String(sql);
    if (text.includes('SELECT * FROM properties')) {
      return { rows: [{
        id: '11111111-1111-1111-1111-111111111111',
        status: 'pending',
        title: 'Old',
        area: 'Najjera',
        district: 'Wakiso',
        listing_type: 'rent',
        price: 1500000,
        price_on_application: false,
        price_period: 'month',
        extra_fields: { city: 'Kira', neighborhood: 'Najjera', price_on_application: false, price_upon_application: false }
      }] };
    }
    const error = new Error('canceling statement due to statement timeout');
    error.code = '57014';
    throw error;
  };
  try {
    await assert.rejects(
      () => updateStaffEditableListing(
        { userAuth: { id: null } },
        '11111111-1111-1111-1111-111111111111',
        { title: 'House', area: 'Najjera', district: 'Wakiso', city: 'Kira', neighborhood: 'Najjera' },
        {}
      ),
      (error) => error.status === 503 && /busy/.test(error.message)
    );
  } finally {
    db.query = original;
  }
});
