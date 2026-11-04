const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const mig = fs.readFileSync(path.join(root, 'db/migrations/205_per_night_listings_to_short_stay.sql'), 'utf8');
const rollback = fs.readFileSync(path.join(root, 'scripts/rollback-205-per-night-listings-to-short-stay.sql'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

test('migration 205 keeps a backup and has a rollback', () => {
  assert.match(mig, /per_night_short_stay_205_backup/);
  assert.match(rollback, /per_night_short_stay_205_backup/);
  assert.match(mig, /Arthur/);
  assert.doesNotMatch(mig, /\+?256\d{9}|\b07\d{8}\b/, 'no phone numbers in migration');
});

test('/property/:id redirects moved listings to short stay', () => {
  const idx = server.indexOf("app.get('/property/:id'");
  const body = server.slice(idx, idx + 600);
  assert.match(body, /movedShortStaySlugForProperty/);
  assert.match(body, /redirect\(301, `\/short-term\//);
});
