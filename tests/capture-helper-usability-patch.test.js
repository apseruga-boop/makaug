const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');

test('capture helper usability patch is served and cache-busted by the server', () => {
  const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

  assert.match(serverSource, /capture-helper-usability-20260607/);
  assert.match(serverSource, /app\.get\('\/assets\/makaug-app\.js'/);
  assert.match(serverSource, /applyCaptureHelperUsabilityIndexPatch/);
  assert.match(serverSource, /window\\\.__makaugAppVersion/);
  assert.match(serverSource, /admin-social-capture-bookmarklet-url/);
  assert.match(serverSource, /Copied means the long bookmark code is in your computer clipboard/);
  assert.match(serverSource, /Simplest no-bookmark option/);
  assert.match(serverSource, /Drag to bookmarks: makaug Capture Posts/);
});
