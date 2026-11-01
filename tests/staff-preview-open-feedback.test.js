const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const src = fs.readFileSync(require.resolve('../assets/makaug-app.js'), 'utf8');

test('opening a staff preview shows an immediate "Opening" pill and removes it after', () => {
  const fn = src.slice(src.indexOf('async function openStaffListingPreview'), src.indexOf('async function saveStaffListingPreview'));
  assert.match(fn, /showStaffPreviewOpening\(requested\)/);
  assert.match(fn, /finally \{[\s\S]*hideStaffPreviewOpening\(\)/);
  assert.match(src, /id = "staff-listing-preview-opening"/);
});

test('a busy database is retried once with a plain message', () => {
  const fn = src.slice(src.indexOf('async function openStaffListingPreview'), src.indexOf('async function saveStaffListingPreview'));
  assert.match(fn, /staffPreviewBusyError\(firstError\)/);
  assert.match(fn, /The database is busy/);
});

test('the approval blocker banner does not jump the editor', () => {
  const fn = src.slice(src.indexOf('function showApprovalBlockerBanner'), src.indexOf('function showApprovalBlockerBanner') + 6000);
  assert.match(fn, /block: "nearest"/);
  assert.doesNotMatch(fn, /block: "center"/);
});
