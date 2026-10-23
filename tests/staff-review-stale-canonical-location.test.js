'use strict';

/**
 * 23 Oct 2026: Brian's Muyenga plot went live under Kisoro. The review screen
 * kept a place picked earlier (Cyanika, Kisoro) and saved its district over the
 * Muyenga, Kampala that staff had since typed.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../assets/makaug-app.js'), 'utf8');
const start = source.indexOf('function adminReviewActiveCanonicalLocation()');
const end = source.indexOf('function adminReviewSetAreaFromNeighborhood()', start);
assert(start > 0 && end > start, 'helper must exist');

function helper(picked, fields) {
  const run = new Function('adminReviewCanonicalLocationResolution', 'adminReviewCurrentLocationFields',
    `${source.slice(start, end)}\nreturn adminReviewActiveCanonicalLocation();`);
  return run(picked, () => fields);
}

const cyanika = { canonical_location_id: 'kisoro:cyanika', name: 'Cyanika', district: 'Kisoro', match: 'exact_alias', confidence: 1 };

test('a stale pick that disagrees with the form is ignored', () => {
  assert.strictEqual(helper(cyanika, { district: 'Kampala', area: 'Muyenga', neighborhood: 'Muyenga' }), null);
  assert.strictEqual(helper(cyanika, { district: 'Kisoro', area: 'Muyenga', neighborhood: '' }), null);
});

test('a pick that still matches the form is kept', () => {
  assert.strictEqual(helper(cyanika, { district: 'Kisoro', area: 'Cyanika', neighborhood: 'cyanika' }), cyanika);
  assert.strictEqual(helper(null, { district: 'Kampala' }), null);
});

test('saving and confirming use the checked pick, never the raw one', () => {
  const patch = source.slice(source.indexOf('function collectAdminReviewListingPatch()'), source.indexOf('function collectAdminReviewListingPatch()') + 900);
  assert(patch.includes('adminReviewActiveCanonicalLocation()'));
  const confirm = source.slice(source.indexOf('function adminReviewHumanLocationConfirmation()'), source.indexOf('function adminReviewHumanLocationConfirmation()') + 400);
  assert(confirm.includes('adminReviewActiveCanonicalLocation()'));
});
