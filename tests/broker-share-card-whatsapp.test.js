const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '..', 'assets', 'makaug-app.js'), 'utf8');

// The copied broker card and dashboard share text label the number as a
// WhatsApp number: makaug agents are reached on WhatsApp, not by a phone call.
test('broker share text labels the number as WhatsApp, not Call', () => {
  const card = app.slice(app.indexOf('const shareText = `Broker Card:'), app.indexOf('const shareText = `Broker Card:') + 400);
  assert.match(card, /\$\{broker\.phone \? `WhatsApp \$\{broker\.phone\}\\n` : ""\}/);
  const dash = app.slice(app.indexOf('function buildBrokerDashboardShareText'), app.indexOf('function buildBrokerDashboardShareText') + 2000);
  assert.match(dash, /phone \? `WhatsApp \$\{phone\}` : ""/);
  assert.doesNotMatch(app, /Call: \$\{/);
});
