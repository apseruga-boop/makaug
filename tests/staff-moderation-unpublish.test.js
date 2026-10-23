'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('saving the moderation editor does not rebuild it or wait for the dashboard', () => {
  const app = read('assets/makaug-app.js');
  const start = app.indexOf('async function saveStaffListingPreview');
  const end = app.indexOf('function openStaffOwnerStatusWhatsApp', start);
  const save = app.slice(start, end);
  assert.ok(start > 0 && end > start);
  assert.doesNotMatch(save, /renderStaffListingPreviewModal/);
  assert.doesNotMatch(save, /await renderStaffDashboard/);
  assert.match(save, /queueStaffDashboardRefreshAfterModeration\(\{ keepPreviewOpen: true \}\)/);
  assert.match(app, /if \(keepPreviewOpen && currentPage === "staff-review"\) return/);
});

test('a live listing can be unpublished with a reason and published again', () => {
  const app = read('assets/makaug-app.js');
  const staff = read('routes/staff.js');
  assert.match(app, /data-staff-unpublish="1"/);
  assert.match(app, /data-staff-republish="1"/);
  assert.match(app, /function staffUnpublishPreviewListing/);
  assert.match(app, /function staffRepublishPreviewListing/);
  assert.match(app, /staffListingIsLive\(preview\.status\)/);
  assert.match(app, /function staffListingCanRepublish/);
  assert.match(staff, /router\.post\('\/properties\/:id\/unpublish'/);
  assert.match(staff, /router\.post\('\/properties\/:id\/republish'/);
  assert.match(staff, /A reason is required to unpublish a live listing/);
  assert.match(staff, /STAFF_UNPUBLISH_LIVE_STATUSES/);
  assert.match(staff, /staff_listing_unpublished/);
  assert.match(staff, /staff_listing_republished/);
  assert.match(staff, /unpublished_from_status/);
  assert.match(staff, /Only a listing unpublished from the editor can be published again/);
  const unpublish = staff.slice(staff.indexOf("router.post('/properties/:id/unpublish'"), staff.indexOf("router.post('/properties/:id/republish'"));
  const republish = staff.slice(staff.indexOf("router.post('/properties/:id/republish'"), staff.indexOf("router.post('/properties/:id/return-to-review'"));
  assert.match(unpublish, /status = 'hidden'/);
  assert.doesNotMatch(unpublish, /status = 'pending'/);
  assert.match(unpublish, /unpublished_previous_moderation_reason/);
  assert.match(unpublish, /clearPublicListingCaches\('staff_listing_unpublished'\)/);
  assert.match(republish, /clearPublicListingCaches\('staff_listing_republished'\)/);
  assert.match(republish, /unpublished_previous_moderation_reason/);
  assert.match(republish, /status = \$2/);
  assert.doesNotMatch(republish, /loadStaffPropertyPreview/);
  assert.doesNotMatch(unpublish, /loadStaffPropertyPreview/);
});

test('unpublish asks for a reason inline and confirms before the page disappears', () => {
  const app = read('assets/makaug-app.js');
  const start = app.indexOf('async function staffUnpublishPreviewListing');
  const end = app.indexOf('async function staffRepublishPreviewListing', start);
  const unpublish = app.slice(start, end);
  const republish = app.slice(end, app.indexOf('async function staffClaimLead', end));
  assert.match(app, /data-staff-unpublish-error/);
  assert.match(unpublish, /Type why this live listing is being unpublished\./);
  assert.match(unpublish, /Unpublish this listing\? It will disappear from the site\./);
  assert.match(unpublish, /staffPatchPreviewPublication/);
  assert.doesNotMatch(unpublish, /renderStaffListingPreviewModal/);
  assert.doesNotMatch(unpublish, /queueStaffDashboardRefreshAfterModeration/);
  assert.match(republish, /staffPatchPreviewPublication/);
  assert.doesNotMatch(republish, /renderStaffListingPreviewModal/);
  assert.doesNotMatch(republish, /queueStaffDashboardRefreshAfterModeration/);
  assert.match(app, /data-staff-queue-card="1"/);
  assert.match(app, /function staffPatchQueueRowPublication/);
});

test('approval records the staff member and the editor shows that name', () => {
  const app = read('assets/makaug-app.js');
  const staff = read('routes/staff.js');
  const properties = read('routes/properties.js');
  const sql = read('db/migrations/163_property_approved_by.sql');
  assert.match(app, /function staffApprovedByHtml/);
  assert.match(app, /data-staff-approved-by/);
  assert.match(app, /Approved by/);
  assert.match(staff, /staff_preview_approved_by/);
  assert.match(staff, /approved_by_name: await staffApprovedByName/);
  assert.match(properties, /approved_by = CASE WHEN \$2 = 'approved' THEN COALESCE\(\$7::uuid, approved_by\) ELSE approved_by END/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users\(id\)/);
  assert.match(sql, /listing_status_changed/);
  assert.match(sql, /status_to = 'approved'/);
  assert.match(sql, /DISABLE TRIGGER trg_properties_updated_at/);
  assert.match(sql, /ENABLE TRIGGER trg_properties_updated_at/);
  assert.match(sql, /p\.approved_by IS NULL/);
  assert.match(sql, /u\.id::text = e\.actor_id/);
  assert.match(sql, /approved_by = latest\.actor_id::uuid/);
  const numbers = fs.readdirSync(path.join(__dirname, '../db/migrations'))
    .map((name) => Number(name.split('_')[0]))
    .filter((n) => Number.isFinite(n));
  assert.equal(Math.max(...numbers), 164);
  const repair = read('db/migrations/164_restore_republished_listing_visibility.sql');
  assert.match(repair, /2026-10-23 07:26:00\+00/);
  assert.match(repair, /staff_listing_republished/);
  assert.match(repair, /staff_republish_visibility_repair/);
  assert.match(repair, /listing columns were not changed/);
  assert.match(repair, /RAISE NOTICE 'republish visibility/);
  assert.doesNotMatch(repair, /1691d2bd-ffed-4e16-a9f5-2f9666dba642/);
});

test('an empty unpublish reason stays inline and a cancelled confirm does not call the API', () => {
  const app = read('assets/makaug-app.js');
  const start = app.indexOf('async function staffUnpublishPreviewListing');
  const end = app.indexOf('async function staffRepublishPreviewListing', start);
  const calls = [];
  const errorEl = { textContent: '', classList: { hidden: true, remove(name) { if (name === 'hidden') this.hidden = false; }, add(name) { if (name === 'hidden') this.hidden = true; } } };
  const reasonEl = { value: '', invalid: '', focus() { calls.push('focus'); }, setAttribute(name) { this.invalid = name; }, removeAttribute() { this.invalid = ''; } };
  const modal = {
    querySelector(sel) {
      if (sel === '[data-staff-unpublish-error]') return errorEl;
      if (sel === '#admin-review-reason') return reasonEl;
      return null;
    }
  };
  const sandbox = {
    document: { getElementById(id) { return id === 'staff-listing-preview-modal' ? modal : null; } },
    staffReviewPatch: () => ({ reason: '' }),
    isDefaultStatusNoteText: (value) => !String(value || '').trim(),
    adminActiveReview: { moderation_reason: 'Approved from source' },
    window: { confirm: () => { calls.push('confirm'); return false; } },
    staffApiRequestWithTimeout: async () => { calls.push('api'); return { data: {} }; },
    setStaffPreviewDecisionBusy() { calls.push('busy'); },
    toast() { calls.push('toast'); },
    staffPatchPreviewPublication() { calls.push('patch'); },
    encodeURIComponent
  };
  vm.runInNewContext(`${app.slice(start, end)}\nthis.run = staffUnpublishPreviewListing;`, sandbox);
  return sandbox.run('listing-id').then(() => {
    assert.equal(errorEl.textContent, 'Type why this live listing is being unpublished.');
    assert.equal(errorEl.classList.hidden, false);
    assert.equal(reasonEl.invalid, 'aria-invalid');
    assert.deepEqual(calls, ['focus']);
    sandbox.staffReviewPatch = () => ({ reason: 'Duplicate of a live listing' });
    sandbox.isDefaultStatusNoteText = () => false;
    return sandbox.run('listing-id');
  }).then(() => {
    assert.equal(errorEl.classList.hidden, true);
    assert.deepEqual(calls, ['focus', 'confirm']);
  });
});

test('unpublish, republish, then the public property page can return 200', async () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'staff-unpublish-round-trip';
  const express = require('express');
  const jwt = require('jsonwebtoken');
  const request = require('supertest');
  const db = require('../config/database');
  const seo = require('../services/publicSeoRenderService');
  const propertyId = '1691d2bd-ffed-4e16-a9f5-2f9666dba642';
  const userId = '11111111-1111-4111-8111-111111111111';
  const property = {
    id: propertyId,
    status: 'approved',
    title: 'Land in Kira-Nsasa, Kira, Wakiso',
    moderation_reason: 'Approved from source',
    moderation_stage: 'approved',
    extra_fields: { city: 'Kira' },
    inquiry_reference: 'MK-20261019-9BBB26',
    listing_type: 'land',
    description: 'Land in Kira-Nsasa, Kira, Wakiso',
    area: 'Kira-Nsasa',
    district: 'Wakiso',
    price: 150000000,
    price_period: 'once',
    created_at: '2026-10-19T09:27:29.895Z',
    updated_at: '2026-10-23T07:26:00.000Z'
  };
  const originalQuery = db.query.bind(db);
  let publicReads = 0;
  db.query = async (sql, params = []) => {
    const text = String(sql);
    if (text.includes('FROM users WHERE id')) {
      return { rows: [{ id: userId, first_name: 'Mod', last_name: 'Erator', role: 'moderator', status: 'active', profile_data: {} }] };
    }
    if (text.includes('INSERT INTO staff_activity_logs') || text.includes('INSERT INTO audit_logs') || text.includes('INSERT INTO property_moderation_events')) {
      return { rows: [] };
    }
    if (text.includes('FROM properties WHERE id = $1') && text.includes('moderation_reason')) {
      return { rows: [{ ...property, extra_fields: { ...property.extra_fields } }] };
    }
    if (text.includes("status = 'hidden'")) {
      property.status = 'hidden';
      property.moderation_reason = params[1];
      property.extra_fields = {
        ...property.extra_fields,
        unpublished_from_status: params[3],
        unpublished_reason: params[1],
        unpublished_previous_moderation_reason: params[5],
        unpublished_previous_moderation_stage: params[6]
      };
      return { rows: [{ ...property, extra_fields: { ...property.extra_fields } }] };
    }
    if (text.includes('unpublished_previous_moderation_reason') && text.includes('status = $2')) {
      const previousReason = Object.prototype.hasOwnProperty.call(property.extra_fields, 'unpublished_previous_moderation_reason')
        ? property.extra_fields.unpublished_previous_moderation_reason
        : property.moderation_reason;
      property.status = params[1];
      property.moderation_reason = previousReason || null;
      const extra = { ...property.extra_fields };
      [
        'unpublished_from_status',
        'unpublished_reason',
        'unpublished_at',
        'unpublished_by',
        'unpublished_previous_moderation_reason',
        'unpublished_previous_moderation_stage'
      ].forEach((key) => { delete extra[key]; });
      extra.republished_note = params[3];
      property.extra_fields = extra;
      return { rows: [{ ...property, extra_fields: { ...property.extra_fields } }] };
    }
    if (text.includes('p.id::text = $1')) {
      publicReads += 1;
      const visible = ['approved', 'live', 'published'].includes(String(property.status).toLowerCase());
      if (!visible || params[0] !== propertyId) return { rows: [] };
      return {
        rows: [{
          id: property.id,
          listing_type: property.listing_type,
          title: property.title,
          description: property.description,
          area: property.area,
          district: property.district,
          price: property.price,
          price_period: property.price_period,
          copy_extra: {},
          created_at: property.created_at,
          updated_at: property.updated_at
        }]
      };
    }
    throw new Error(`Unexpected SQL: ${text.slice(0, 240)}`);
  };

  const server = read('server.js');
  assert.match(server, /return res\.status\(404\)\.send\('Property not found'\)/);
  assert.match(server, /Cache-Control', 'private, no-store'/);
  seo.clearSeoListingCache();
  const app = express();
  app.use(express.json());
  app.use('/api/staff', require('../routes/staff'));
  const token = jwt.sign({ sub: userId, role: 'moderator' }, process.env.JWT_SECRET, { expiresIn: '10m' });
  const auth = (req) => req.set('Authorization', `Bearer ${token}`);
  try {
    const empty = await auth(request(app).post(`/api/staff/properties/${propertyId}/unpublish`)).send({ reason: '   ' });
    assert.equal(empty.status, 400);
    assert.match(empty.body.error, /reason is required/i);

    const hidden = await auth(request(app).post(`/api/staff/properties/${propertyId}/unpublish`)).send({ reason: 'Held for a duplicate check' });
    assert.equal(hidden.status, 200, JSON.stringify(hidden.body));
    assert.equal(hidden.body.data.status, 'hidden');
    assert.equal(hidden.body.data.extra_fields.unpublished_from_status, 'approved');
    assert.equal(hidden.body.data.extra_fields.unpublished_previous_moderation_reason, 'Approved from source');

    const missing = await seo.loadPublicSeoListing(db, propertyId);
    assert.equal(missing, null);
    const readsAfterMiss = publicReads;
    const cachedMiss = await seo.loadPublicSeoListing(db, propertyId);
    assert.equal(cachedMiss, null);
    assert.equal(publicReads, readsAfterMiss, 'the public 404 is cached against the property id');

    const live = await auth(request(app).post(`/api/staff/properties/${propertyId}/republish`)).send({});
    assert.equal(live.status, 200, JSON.stringify(live.body));
    assert.equal(live.body.data.status, 'approved');
    assert.equal(live.body.data.moderation_reason, 'Approved from source');
    assert.equal(live.body.data.extra_fields.unpublished_from_status, undefined);
    assert.equal(live.body.data.inquiry_reference, 'MK-20261019-9BBB26');

    const restored = await seo.loadPublicSeoListing(db, propertyId);
    assert.equal(restored && restored.id, propertyId);
    assert.match(restored.title, /Kira-Nsasa/);
    assert.equal(publicReads, readsAfterMiss + 1, 'republish must drop the cached public 404 before the next page read');

    // A visitor who loaded the 404 just as it expired starts a refresh. Clearing
    // the cache on republish must win: that refresh cannot put the 404 back.
    seo.clearSeoListingCache();
    let releaseStale = () => {};
    const gate = new Promise((resolve) => { releaseStale = resolve; });
    seo.__seoListingCache.set(`property:${propertyId}`, { row: null }, Date.now() - seo.SEO_LISTING_CACHE_TTL_MS - 1);
    const stalePromise = seo.loadPublicSeoListing({
      async query() {
        await gate;
        return { rows: [] };
      }
    }, propertyId);
    const stale = await Promise.race([
      stalePromise,
      new Promise((resolve) => setTimeout(() => resolve('blocked'), 40))
    ]);
    assert.equal(stale, null);
    seo.clearSeoListingCache();
    releaseStale();
    await stalePromise.catch(() => null);
    const afterClear = await seo.loadPublicSeoListing(db, propertyId);
    assert.equal(afterClear && afterClear.id, propertyId);
  } finally {
    db.query = originalQuery;
    seo.clearSeoListingCache();
  }
});
