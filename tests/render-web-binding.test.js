'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('Render web runtime binds the public server to 0.0.0.0 on PORT', () => {
  const server = fs.readFileSync(path.resolve(__dirname, '..', 'server.js'), 'utf8');
  assert.match(server, /const listenHost = process\.env\.RENDER_INTERNAL_APP === 'true' \? '127\.0\.0\.1' : '0\.0\.0\.0'/);
  assert.match(server, /httpServer\.listen\(port, listenHost, \(\) =>/);
});
