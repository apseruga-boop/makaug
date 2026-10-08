const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');

// The "capture helper usability" script patch was appended by a second
// app.get('/assets/makaug-app.js') handler registered after the real one, so it
// never ran (PR F, 8 Oct 2026, removed that dead handler and the patch). What
// stays live is the release marker and the quick-paste panel in the app itself.
test('capture helper: release marker kept, dead patch handler removed', () => {
  const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'assets', 'makaug-app.js'), 'utf8');

  assert.match(serverSource, /capture-helper-usability-20260607/);
  assert.equal((serverSource.match(/app\.get\('\/assets\/makaug-app\.js'/g) || []).length, 1);
  assert.match(serverSource, /applyCaptureHelperUsabilityIndexPatch/);
  assert.match(serverSource, /injectRuntimeBundleVersion/);
  assert.doesNotMatch(serverSource, /captureHelperUsabilityScriptPatch/);
  assert.match(app, /function adminOpenSocialQuickPastePanel\(/);
});
