'use strict';

/**
 * Which property a photo belongs to.
 *
 * On 23 Sep 2026 an agent forwarded four properties in one Agent 007 batch —
 * a steel factory, a block of shops, a lodge and some houses — as captions
 * followed by their photos. All 44 photos landed on the first property,
 * because a photo with no caption of its own was attached to the property that
 * had just been created rather than to the caption waiting for photos.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { employeeMediaMessageCaption } = require('../routes/whatsapp').__test;

const LODGE = '*QUEEN ELIZABETH SAFARI LODGE – FOR SALE* Kasese, 20 acres, UGX 4.5 billion';

test('a photo with its own caption keeps that caption', () => {
  assert.strictEqual(
    employeeMediaMessageCaption({ cleanBody: LODGE, pendingCaption: 'something else' }),
    LODGE
  );
});

test('a captionless photo belongs to the caption still waiting for photos', () => {
  assert.strictEqual(employeeMediaMessageCaption({ cleanBody: '', pendingCaption: LODGE }), LODGE);
});

test('an [image] placeholder counts as captionless', () => {
  assert.strictEqual(
    employeeMediaMessageCaption({ cleanBody: '[image]', placeholderBody: true, pendingCaption: LODGE }),
    LODGE
  );
});

test('with nothing waiting, a captionless photo has no caption and stays with the open property', () => {
  assert.strictEqual(employeeMediaMessageCaption({ cleanBody: '', pendingCaption: '' }), '');
});

test('the routing decision never consults the last created property', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'whatsapp.js'), 'utf8');
  const fn = source.slice(
    source.indexOf('function employeeMediaMessageCaption'),
    source.indexOf('function employeeCaptionLabel')
  );
  assert.ok(fn.length > 0, 'the helper must exist');
  assert.ok(
    !fn.includes('current_property_id'),
    'a photo must never be routed by the property that happens to be open'
  );
});
