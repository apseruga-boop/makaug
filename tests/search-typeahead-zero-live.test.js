'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

// "Mulago · Neighborhood · 0 live" in the suggestion list read as "nothing
// here" (Ronald, 1 Nov 2026), while the search itself shows 462 listings
// within 3 km. Say what the search will do instead of counting to zero.
test('a place with no listings of its own says nearby listings will be shown', () => {
  const app = fs.readFileSync(path.join(__dirname, '../assets/makaug-app.js'), 'utf8');
  const render = app.slice(app.indexOf('function renderTypeahead('), app.indexOf('function handleTypeaheadKeydown('));
  assert.match(render, /Number\(m\.listing_count\) > 0 \? ` · \$\{Number\(m\.listing_count\)\} live`/);
  assert.match(render, /none here yet, nearby shown/);
});
