'use strict';

// Static files are served only from an allowlist. Until 8 Oct 2026 the repo
// root was served, so /server.js, /routes/staff.js, /package.json, /render.yaml,
// /AGENTS.md, /db/migrations/*.sql etc. returned 200 with the real file.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

let child;
let base;

test.before(async () => {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), NODE_ENV: process.env.NODE_ENV || 'test', MEMORY_LOG: 'off' },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-4000); });
  for (let i = 0; i < 90; i += 1) {
    try {
      const response = await fetch(`${base}/healthz`);
      if (response.ok) return;
    } catch (_) {}
    if (child.exitCode !== null) throw new Error(`server exited: ${stderr}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server did not start: ${stderr}`);
});

test.after(() => {
  if (child && child.exitCode === null) child.kill('SIGTERM');
});

const BLOCKED = [
  '/server.js',
  '/routes/staff.js',
  '/routes/properties.js',
  '/utils/propertyPriceCurrency.js',
  '/services/publicSeoService.js',
  '/middleware/auth.js',
  '/models/index.js',
  '/package.json',
  '/package-lock.json',
  '/tsconfig.json',
  '/render.yaml',
  '/render.seshaikhaya.yaml',
  '/AGENTS.md',
  '/README.md',
  '/db/migrations/001_init.sql',
  '/coverage-results.csv',
  '/fixed_patch.txt',
  '/tailwind.config.cjs',
  '/vitest.config.mjs',
  '/Dockerfile.whatsapp-agent',
  '/tests/static-allowlist.test.js',
  '/scripts/backfill-moderation-columns.js',
  '/config/database.js',
  '/packages/shared-country-core/index.js',
  '/docs/anything.md',
  '/reports/anything.json',
  '/data/anything.json',
  '/index.html.bak',
  '/assets/../server.js'
];

const ALLOWED = [
  ['/assets/makaug-app.js', /javascript/],
  ['/assets/tailwind.css', /css/],
  ['/config/aboutCommercialProducts.js', /javascript/],
  ['/favicon.ico', null],
  ['/site.webmanifest', null],
  ['/seshaikhaya.webmanifest', null],
  ['/google033e19e2016a21c2.html', /html/],
  ['/healthz', null],
  ['/config.js', /javascript/],
  ['/robots.txt', /text\/plain/],
  ['/sitemap.xml', /xml/],
  ['/', /html/],
  ['/for-sale', /html/]
];

test('repository files are 404 with noindex', async () => {
  for (const p of BLOCKED) {
    const response = await fetch(base + p, { redirect: 'manual' });
    const body = await response.text();
    assert.equal(response.status, 404, `${p} should be 404`);
    assert.match(response.headers.get('x-robots-tag') || '', /noindex/, `${p} noindex`);
    assert.doesNotMatch(body, /require\(|"dependencies"|CREATE TABLE/, `${p} must not leak source`);
  }
});

test('allowlisted files and public routes still work', async () => {
  for (const [p, type] of ALLOWED) {
    const response = await fetch(base + p, { redirect: 'manual' });
    assert.equal(response.status, 200, `${p} should be 200`);
    if (type) assert.match(response.headers.get('content-type') || '', type, `${p} content type`);
  }
});

test('the legal PDF route still serves', async () => {
  const response = await fetch(`${base}/legal/makaug-private-lister-terms.pdf`, { redirect: 'manual' });
  assert.notEqual(response.status, 404);
});
