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

test('MK-ref search filters the pending list instead of opening a Search results section', () => {
  const paintStart = app.indexOf('function staffPaintReviewQueue');
  const paint = app.slice(paintStart, app.indexOf('function staffSetReviewQueue', paintStart));
  assert.doesNotMatch(paint, /Search results/);
  assert.match(app, /function staffSearchReviewQueue/);
  assert.match(paint, /staffReviewQueueCardHtml/);
  const approve = app.slice(app.indexOf('async function staffApprovePreviewListing'), app.indexOf('async function staffRejectPreviewListing'));
  const reject = app.slice(app.indexOf('async function staffRejectPreviewListing'), app.indexOf('async function staffModerateListing'));
  assert.match(approve, /staffOptimisticallyApplyDecision\(propertyIdForRequest, "approved"\)/);
  assert.match(reject, /staffOptimisticallyApplyDecision\(propertyId, "rejected"\)/);
  assert.match(app, /Found online · Showing/);
  assert.match(app, /function staffFillReviewQueue/);
  assert.match(app, /function staffFillFoundOnlineQueue/);
});
