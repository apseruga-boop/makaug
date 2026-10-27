'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '../assets/makaug-app.js'), 'utf8');

test('step 1 of the listing form hides the technical and optional parts by default', () => {
  assert(/data-lp-coords-grid="1"/.test(html) && /class="hidden grid md:grid-cols-2 gap-3 mt-3" data-lp-coords-grid/.test(html), 'lat/lng/alt hidden');
  assert(html.includes('<details id="lp-more-details"'), 'title type, year built and amenities fold away');
  const adv = html.slice(html.indexOf('<details id="lp-location-advanced"'), html.indexOf('</details>', html.indexOf('<details id="lp-location-advanced"')));
  assert(adv.includes('id="lp-location-privacy"'), 'location privacy lives under advanced');
  assert(/id="lp-description-translation-preview"[^>]*class="hidden/.test(html), 'translation preview hidden until there is text');
  assert(!/>Title \*</.test(html), 'title no longer marked required');
});

test('a blank title is written from the details instead of blocking the form', () => {
  assert(app.includes('function buildLpAutoTitle('));
  const v = app.slice(app.indexOf('function validateListStep1()'), app.indexOf('function validateListStep2()'));
  assert(v.includes('buildLpAutoTitle()'));
});

test('a validation error inside a folded section unfolds it', () => {
  const m = app.slice(app.indexOf('function markLpFieldError('), app.indexOf('function validateListStep1()'));
  assert(m.includes('closest("details")') && m.includes('folded.open = true'));
  const r = app.slice(app.indexOf('function renderLpExtraFields('), app.indexOf('function renderLpExtraFields(') + 600);
  assert(r.includes('type === "land" || type === "commercial"'), 'land/commercial open More details, where their required choice sits');
});
