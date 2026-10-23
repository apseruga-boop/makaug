'use strict';

// After Approve or Reject the status row commits, then owner email/WhatsApp,
// the audit insert, saved-search matching and IndexNow used to run before the
// HTTP response. The queue also painted "12 of 63" beside "8 of 53" and an
// MK-ref search opened a separate Search results section.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');

const properties = fs.readFileSync(path.join(__dirname, '../routes/properties.js'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '../assets/makaug-app.js'), 'utf8');

test('a listing decision responds when the status update commits', () => {
  assert.match(properties, /function createDecisionTiming/);
  assert.match(properties, /Listing decision timing/);
  assert.match(properties, /Listing decision follow-up timing/);
  assert.match(properties, /const leaveToAHuman = manualNotificationOnly && nextStatus === 'rejected'/);
  assert.match(properties, /runPublicInventoryFollowup\(\s*deliverDeferredDecisionWork/);
  assert.match(properties, /return res\.json\(buildStatusResponse\(fastAlertMatching\)\)/);
  const committed = properties.indexOf("decisionTiming.mark('status_committed')");
  const response = properties.indexOf('return res.json(buildStatusResponse(fastAlertMatching))');
  const between = properties.slice(committed, response);
  assert.match(between, /runPublicInventoryFollowup\(\s*deliverDeferredDecisionWork/);
  assert.doesNotMatch(between, /await deliverDeferredDecisionWork/);
});

test('queue search keeps main behaviour and a decision still updates the card first', () => {
  const paintStart = app.indexOf('function staffPaintReviewQueue');
  const paint = app.slice(paintStart, app.indexOf('function staffSetReviewQueue', paintStart));
  assert.match(paint, /data-staff-search-results>Search results/);
  assert.match(app, /include_total: search \? "0" : "1"/);
  assert.match(app, /staffListingDirectLookup\(state\.term\)/);
  assert.match(app, /function staffSearchReviewQueue/);
  assert.match(paint, /staffReviewQueueCardHtml/);
  const approve = app.slice(app.indexOf('async function staffApprovePreviewListing'), app.indexOf('async function staffRejectPreviewListing'));
  const reject = app.slice(app.indexOf('async function staffRejectPreviewListing'), app.indexOf('async function staffModerateListing'));
  assert.match(approve, /staffOptimisticallyApplyDecision\(propertyIdForRequest, "approved"\)/);
  assert.match(reject, /staffOptimisticallyApplyDecision\(propertyId, "rejected"\)/);
  assert.match(reject, /setStaffPreviewDecisionBusy\(false\)/);
  assert.match(app, /Found online · Showing/);
  assert.match(app, /function staffFillReviewQueue/);
  assert.match(app, /function staffFillFoundOnlineQueue/);
  assert.match(properties, /code: 'video_caption_conflict'/);
  assert.match(properties, /persistVideoCaptionResolution/);
  const committed = properties.indexOf("decisionTiming.mark('status_committed')");
  const deferred = properties.indexOf('const deliverDeferredDecisionWork', committed);
  const beforeDeferred = properties.slice(committed, deferred);
  assert.match(beforeDeferred, /getPrimaryImageUrlForProperty/);
  assert.match(beforeDeferred, /persistVideoCaptionResolution/);
});

// MK-20261010-FBF852 left the queue, then the page stayed on "Saving decision…"
// for more than 50 seconds while follow-up work still ran on the request.
// The gate stands in for that wait. The test fails in 2 seconds if the
// response awaits it again.
test('a slow reject returns the decision while follow-up work is still running', async () => {
  const propertyId = '11111111-1111-4111-8111-111111111111';
  const row = {
    id: propertyId,
    title: 'Plot in Kira',
    listing_type: 'sale',
    inquiry_reference: 'MK-20261010-FBF852',
    lister_name: 'Owner',
    lister_phone: '+256700000000',
    lister_email: 'owner@example.com',
    agent_id: null,
    source: 'website',
    listed_via: 'website',
    status: 'pending',
    price: 1000000,
    price_period: 'once',
    area: 'Kira',
    district: 'Wakiso',
    created_at: new Date().toISOString(),
    reviewed_at: null,
    approved_at: null,
    last_moderation_notification_at: null,
    moderation_stage: 'submitted',
    moderation_checklist: {},
    moderation_notes: null,
    moderation_reason: null,
    extra_fields: {},
    description: 'A plot',
    property_type: 'land'
  };
  const followUp = { started: false, finished: false };
  const queries = [];
  let releaseFollowUp = () => {};
  const followUpGate = new Promise((resolve) => {
    releaseFollowUp = resolve;
  });
  const dbPath = require.resolve('../config/database');
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: {
      query: async (sql) => {
        const text = String(sql);
        queries.push(text.replace(/\s+/g, ' ').trim().slice(0, 90));
        if (/INSERT INTO property_moderation_events/i.test(text)) {
          followUp.started = true;
          await followUpGate;
          followUp.finished = true;
          return { rows: [] };
        }
        if (/UPDATE\s+properties/i.test(text)) {
          return { rows: [{ ...row, status: 'rejected', moderation_reason: 'Duplicate listing, same plot.' }] };
        }
        if (/FROM\s+properties/i.test(text)) {
          return { rows: [{ ...row }] };
        }
        return { rows: [] };
      },
      pool: { end: async () => {} }
    }
  };
  process.env.ADMIN_API_KEY = 'slow-reject-replay-key';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'slow-reject-replay-secret';
  const express = require('express');
  const request = require('supertest');
  const propertiesRouter = require('../routes/properties');
  try {
    require('../routes/staff');
  } catch (error) {
    // The status handler already treats a staff-cache clear failure as non-blocking.
  }
  const app = express();
  app.use(express.json());
  app.use('/api/properties', propertiesRouter);

  try {
    const started = Date.now();
    const raced = await Promise.race([
      request(app)
        .patch(`/api/properties/${propertyId}/status`)
        .set('x-api-key', 'slow-reject-replay-key')
        .send({
          status: 'rejected',
          reason: 'Duplicate listing, same plot.',
          review_notes: 'Rejected from staff preview',
          fast_admin_render: true,
          manual_notification_only: true,
          reject_confirmed: true,
          ui_control: 'staff_preview_reject_button'
        })
        .then((res) => ({ res })),
      new Promise((resolve) => {
        setTimeout(() => resolve({ timeout: true }), 2000);
      })
    ]);
    const elapsed = Date.now() - started;
    assert.equal(raced.timeout, undefined, `reject was still saving after ${elapsed}ms; queries: ${queries.join(' | ')}`);
    const res = raced.res;
    assert.equal(res.status, 200, JSON.stringify({ body: res.body, queries }));
    assert.equal(res.body.ok, true);
    assert.equal(res.body.data.status, 'rejected');
    assert.equal(res.body.data.inquiry_reference, 'MK-20261010-FBF852');
    assert.equal(res.body.data.lister_notified, false);
    assert.equal(res.body.data.notification.whatsapp.sent, false);
    assert.equal(res.body.data.notification.whatsapp.reason, 'manual_first_fast_status_update');
    assert.ok(res.body.data.notification.whatsapp.message);
    assert.ok(elapsed < 2000, `response took ${elapsed}ms`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(followUp.started, true, `follow-up insert did not start; queries: ${queries.join(' | ')}`);
    assert.equal(followUp.finished, false, 'response waited for the slow moderation insert');
  } finally {
    releaseFollowUp();
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
});
