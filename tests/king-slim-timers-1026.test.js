const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('server no longer arms the paused X source drip timer, but keeps YouTube', () => {
  const server = read('server.js');
  assert.doesNotMatch(server, /startXSourceDripScheduler/);
  assert.match(server, /startYouTubeSourceDripScheduler\(db\)/);
  // The X drip's manual controls and data stay.
  assert.match(read('routes/admin.js'), /x-source-drip\/run-once/);
});

test('featured rotation checks hourly by default, not every minute', () => {
  const service = read('services/featuredRotationService.js');
  assert.match(service, /FEATURED_ROTATION_POLL_MS \|\| 60 \* 60_000/);
});
