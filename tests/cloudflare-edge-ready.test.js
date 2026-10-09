'use strict';

// PR F: speed, caching and Cloudflare readiness (8 Oct 2026).

process.env.COUNTRY_CODE = 'UG';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const { clientIpFrom, isCloudflareIp, rateLimitClientKey, clientIpMiddleware } = require('../utils/clientIp');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
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
    env: { ...process.env, PORT: String(port), NODE_ENV: process.env.NODE_ENV || 'test', MEMORY_LOG: 'off', CORS_ORIGINS: 'https://makaug.com', ALLOWED_HOSTS: 'makaug-staging.onrender.com' },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-4000); });
  for (let i = 0; i < 180; i += 1) {
    try { if ((await fetch(`${base}/api/health`)).ok) return; } catch (_) {}
    if (child.exitCode !== null) throw new Error(`server exited: ${stderr}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server did not start: ${stderr}`);
});

test.after(() => {
  if (child && child.exitCode === null) child.kill('SIGTERM');
});

const get = (p, headers = {}) => fetch(base + p, { redirect: 'manual', headers });

// ---- 1. cache headers ------------------------------------------------------------
test('a versioned asset is immutable for a year; an unversioned one gets an hour', async () => {
  const versioned = await get('/assets/off-plan.css?v=abc123');
  assert.equal(versioned.status, 200);
  assert.equal(versioned.headers.get('cache-control'), 'public, max-age=31536000, immutable');

  const unversioned = await get('/assets/house-ads-v3/sale.webp');
  assert.equal(unversioned.status, 200);
  assert.equal(unversioned.headers.get('cache-control'), 'public, max-age=3600');

  const appVersioned = await get('/assets/makaug-app.js?v=build1');
  assert.equal(appVersioned.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  const appBare = await get('/assets/makaug-app.js');
  assert.equal(appBare.headers.get('cache-control'), 'public, max-age=3600');

  const rootFile = await get('/favicon.ico');
  assert.equal(rootFile.headers.get('cache-control'), 'public, max-age=3600');
});

test('HTML revalidates and is never stored by the CDN', async () => {
  const res = await get('/for-sale');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('cache-control') || '', /no-cache|no-store/);
  assert.equal(res.headers.get('cdn-cache-control'), 'no-store');
});

test('API: no-store by default, public only for anonymous inventory, private for any auth', async () => {
  const plain = await get('/api/version');
  assert.equal(plain.headers.get('cache-control'), 'no-store');

  const anonymous = await get('/api/off-plan');
  assert.match(anonymous.headers.get('cache-control') || '', /^public, max-age=60/);

  for (const headers of [{ Authorization: 'Bearer abc' }, { Cookie: 'x=1; makaug_auth_token=abc' }]) {
    const authed = await get('/api/off-plan', headers);
    assert.equal(authed.headers.get('cache-control'), 'private, no-store', JSON.stringify(headers));
    assert.equal(authed.headers.get('cdn-cache-control'), null);
  }
  const inventory = await get('/api/properties?public_only=1&status=approved&limit=1', { Authorization: 'Bearer abc' });
  assert.match(inventory.headers.get('cache-control') || '', /no-store/);
  assert.equal(inventory.headers.get('cdn-cache-control'), null);
});

test('local scripts and stylesheets in the page carry their content hash', async () => {
  const html = await (await get('/')).text();
  for (const file of ['assets/makaug-site-i18n.js', 'assets/about-advertise-i18n.js', 'assets/off-plan.js', 'assets/tailwind.css', 'config/aboutCommercialProducts.js']) {
    const hash = crypto.createHash('sha1').update(fs.readFileSync(path.join(ROOT, file))).digest('hex').slice(0, 12);
    assert.ok(html.includes(`"/${file}?v=${hash}"`), `${file} should be versioned by content`);
  }
  assert.ok(html.includes('"/assets/makaug-app.js?v="'), 'the app bundle keeps its build version');
});

test('the dead duplicate makaug-app.js handler and its patch are gone', () => {
  const server = read('server.js');
  assert.equal((server.match(/app\.get\('\/assets\/makaug-app\.js'/g) || []).length, 1);
  assert.doesNotMatch(server, /captureHelperUsabilityScriptPatch/);
  assert.doesNotMatch(server, /max-age=604800/);
});

// ---- 2. host redirect --------------------------------------------------------------
test('other hosts 301 to makaug.com for GET/HEAD; webhooks, /healthz and /api/health are not redirected', async () => {
  const onrender = await get('/for-sale?x=1', { 'X-Forwarded-Host': 'makaug.onrender.com' });
  assert.equal(onrender.status, 301);
  assert.equal(onrender.headers.get('location'), 'https://makaug.com/for-sale?x=1');

  for (const host of ['makaug.com', 'www.makaug.com', 'makaug-staging.onrender.com', 'localhost:3000']) {
    const ok = await get('/help', { 'X-Forwarded-Host': host });
    assert.equal(ok.status, 200, host);
  }
  assert.equal((await get('/healthz', { 'X-Forwarded-Host': 'makaug.onrender.com' })).status, 200);
  assert.equal((await get('/api/health', { 'X-Forwarded-Host': 'makaug.onrender.com' })).status, 200);
  // The WAHA bridge polls with GET and Meta verifies with GET: never redirected.
  assert.notEqual((await get('/api/whatsapp/web-bridge/status', { 'X-Forwarded-Host': 'makaug.onrender.com' })).status, 301);
  assert.notEqual((await get('/api/whatsapp/webhook?hub.mode=subscribe', { 'X-Forwarded-Host': 'makaug.onrender.com' })).status, 301);
  const post = await fetch(`${base}/api/pay/webhooks/revolut`, { method: 'POST', redirect: 'manual', headers: { 'X-Forwarded-Host': 'makaug.onrender.com', 'Content-Type': 'application/json' }, body: '{}' });
  assert.notEqual(post.status, 301);
});

test('render-start forwards the visitor host so the app can see it', () => {
  const source = read('scripts/render-start.js');
  assert.match(source, /forwarded\['x-forwarded-host'\] = headers\.host/);
});

// ---- 3. client IP -------------------------------------------------------------------
test('CF-Connecting-IP is trusted only from a Cloudflare hop', () => {
  assert.equal(isCloudflareIp('104.16.1.1'), true);
  assert.equal(isCloudflareIp('2606:4700::1'), true);
  assert.equal(isCloudflareIp('::ffff:172.64.0.9'), true);
  assert.equal(isCloudflareIp('8.8.8.8'), false);

  // Spoofed: a direct visitor to makaug.onrender.com sends the header.
  assert.equal(clientIpFrom({ hopIp: '203.0.113.7', cfConnectingIp: '1.1.1.1' }), '203.0.113.7');
  // Genuine Cloudflare hop.
  assert.equal(clientIpFrom({ hopIp: '172.70.1.2', cfConnectingIp: '41.210.1.9' }), '41.210.1.9');
  assert.equal(clientIpFrom({ hopIp: '2a06:98c0::5', cfConnectingIp: '2c0f:fe38::1' }), '2c0f:fe38::1');
  // Garbage header from Cloudflare falls back to the hop.
  assert.equal(clientIpFrom({ hopIp: '172.70.1.2', cfConnectingIp: 'not-an-ip' }), '172.70.1.2');

  const req = { ip: '172.70.1.2', headers: { 'cf-connecting-ip': '41.210.1.9' }, get(name) { return this.headers[name.toLowerCase()]; } };
  clientIpMiddleware(req, {}, () => {});
  assert.equal(req.clientIp, '41.210.1.9');
  assert.equal(rateLimitClientKey(req), '41.210.1.9');
  // One rate-limit bucket per IPv6 /64.
  assert.equal(rateLimitClientKey({ clientIp: '2c0f:fe38:2:3:aaaa::1' }), rateLimitClientKey({ clientIp: '2c0f:fe38:2:3:bbbb::9' }));
});

test('rate limiters and IP readers use the real visitor IP', () => {
  assert.match(read('server.js'), /keyGenerator: rateLimitClientKey/);
  assert.match(read('middleware/leadGuard.js'), /keyGenerator: rateLimitClientKey/);
  assert.match(read('routes/ai-core.js'), /req\.clientIp/);
  assert.match(read('services/adminSecurityService.js'), /req\.clientIp/);
  assert.match(read('routes/analytics.js'), /req\.clientIp/);
  assert.match(read('routes/harvest.js'), /req\.clientIp/);
});

// ---- 4. CORS -----------------------------------------------------------------------
test('a rejected CORS origin is a 403, not a 500', async () => {
  const res = await get('/api/version', { Origin: 'https://evil.example' });
  assert.equal(res.status, 403);
  const allowed = await get('/api/version', { Origin: 'https://makaug.com' });
  assert.equal(allowed.status, 200);
});

// ---- 6. Core Web Vitals -----------------------------------------------------------
test('head: no render-blocking language pack, no app preload, hero preload only on /', async () => {
  const html = read('index.html');
  const head = html.slice(0, html.indexOf('</head>'));
  assert.doesNotMatch(head, /<script src="\/assets\/about-advertise-i18n\.js/);
  assert.doesNotMatch(head, /preload\.as = "script"/);
  assert.doesNotMatch(head, /preconnect" href="https:\/\/images\.unsplash\.com/);
  assert.match(head, /Plus\+Jakarta\+Sans:wght@400;500;600;700;800&/);

  const home = await (await get('/')).text();
  assert.match(home, /data-home-hero-preload/);
  for (const p of ['/for-sale', '/help']) {
    assert.doesNotMatch(await (await get(p)).text(), /data-home-hero-preload/, p);
  }
});

test('tailwind.css is a content-driven build under 150 KB', () => {
  const size = fs.statSync(path.join(ROOT, 'assets', 'tailwind.css')).size;
  assert.ok(size < 150 * 1024, `tailwind.css is ${size} bytes`);
  const config = read('tailwind.config.cjs');
  assert.doesNotMatch(config, /colourUtilityPrefixes/);
  for (const glob of ['./assets/*.js', './services/**/*.js', './routes/**/*.js', './packages/shared-country-core/**/*.{html,js}']) {
    assert.ok(config.includes(`'${glob}'`), glob);
  }
});

test('JS: committed bundles are fresh, minified, and the admin code is split out', async () => {
  const { sourceHash, builtSourceHash, PUBLIC_OUT, ADMIN_OUT, ASYNC_ENTRY_POINTS } = require('../scripts/build-js');
  const hash = sourceHash();
  assert.equal(builtSourceHash(PUBLIC_OUT), hash, 'assets/build is stale: run npm run build:js and commit the output');
  assert.equal(builtSourceHash(ADMIN_OUT), hash, 'assets/build is stale: run npm run build:js and commit the output');
  const sourceSize = fs.statSync(path.join(ROOT, 'assets', 'makaug-app.js')).size;
  const publicSize = fs.statSync(PUBLIC_OUT).size;
  assert.ok(publicSize < sourceSize * 0.7, `public bundle ${publicSize} vs source ${sourceSize}`);

  const publicJs = fs.readFileSync(PUBLIC_OUT, 'utf8');
  const adminJs = fs.readFileSync(ADMIN_OUT, 'utf8');
  for (const name of ASYNC_ENTRY_POINTS) {
    assert.match(adminJs, new RegExp(`function ${name}\\(`), name);
    assert.doesNotMatch(publicJs, new RegExp(`function ${name}\\(`), name);
  }
  assert.match(publicJs, /function showPage\(/);

  const app = await get('/assets/makaug-app.js?v=1');
  assert.equal(app.headers.get('x-makaug-app-bundle'), 'built');
  const admin = await get('/assets/makaug-admin.js?v=1');
  assert.equal(admin.status, 200);
  assert.equal(admin.headers.get('x-makaug-app-bundle'), 'built');
});

test('only the protected shell loads the admin bundle', () => {
  const html = read('index.html');
  assert.match(html, /if \(document\.getElementById\("page-staff-dashboard"\) \|\| document\.getElementById\("page-admin-dashboard"\)\) \{\s*var adminScript/);
  assert.match(html, /adminScript\.async = false;/);
  const { sanitizePublicHtml } = require('../services/publicHtmlSanitizer');
  const publicHtml = sanitizePublicHtml(html, { pathname: '/' });
  assert.doesNotMatch(publicHtml, /id="page-staff-dashboard"|id="page-admin-dashboard"/);
});

test('SSR images are sized and decode async; the detail map waits until it is visible', () => {
  const render = read('services/publicSeoRenderService.js');
  assert.match(render, /object-cover" width="640" height="384" decoding="async" loading="\$\{options\.eager \? 'eager' : 'lazy'\}"/);
  assert.match(render, /width="1200" height="675" decoding="async" fetchpriority="high"/);
  const app = read('assets/makaug-app.js');
  const init = app.slice(app.indexOf('async function initDetailMap('), app.indexOf('async function initDetailMap(') + 900);
  assert.ok(init.indexOf('waitForDetailMapVisible(el)') > 0 && init.indexOf('waitForDetailMapVisible(el)') < init.indexOf('ensureGoogleMapsApi()'));
  assert.match(app, /new IntersectionObserver\(\(entries\) => \{\s*if \(entries\.some\(\(entry\) => entry\.isIntersecting\)\) finish\(true\);/);
});
