'use strict';

/**
 * The non-canonical-host redirect must not be skippable with a forged header.
 *
 * 9 Oct 2026, live: `curl -I -H 'X-Forwarded-Host: makaug.com'
 * https://makaug.onrender.com/help` answered 200 instead of 301. server.js read
 * X-Forwarded-Host first, and scripts/render-start.js (the proxy in front of
 * it on Render) only set that header when the client had not sent one.
 *
 * Here the real chain runs: render-start.js forks server.js, and raw requests
 * set Host (and a forged X-Forwarded-Host) the way a visitor's would arrive.
 * server.js on its own (no proxy) is checked too.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
    srv.on('error', reject);
  });
}

function request(port, p, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: p, method: 'GET', headers }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location || null }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function start(script, port, extraEnv = {}) {
  const child = spawn(process.execPath, [script], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), NODE_ENV: 'test', MEMORY_LOG: 'off', STARTUP_DATA_REPAIRS: 'off', DATABASE_URL: '', ...extraEnv },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-4000); });
  for (let i = 0; i < 240; i += 1) {
    try {
      // /api/health needs a database; /help only needs the app to be up.
      const res = await request(port, '/help', { Host: 'makaug.com' });
      if (res.status === 200) return child;
    } catch (_) {}
    if (child.exitCode !== null) throw new Error(`${script} exited: ${stderr}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill('SIGKILL');
  throw new Error(`${script} did not start: ${stderr}`);
}

const children = [];
let proxyPort;
let directPort;

test.before(async () => {
  proxyPort = await freePort();
  // render-start listens on PORT and runs server.js on PORT+1.
  children.push(await start('scripts/render-start.js', proxyPort));
  directPort = await freePort();
  if (directPort === proxyPort + 1) directPort = await freePort();
  children.push(await start('server.js', directPort));
});

test.after(() => {
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
});

for (const [label, portOf] of [['behind render-start (production)', () => proxyPort], ['server.js on its own', () => directPort]]) {
  test(`${label}: a forged X-Forwarded-Host still gets the 301`, async () => {
    const res = await request(portOf(), '/help', { Host: 'makaug.onrender.com', 'X-Forwarded-Host': 'makaug.com' });
    assert.equal(res.status, 301);
    assert.equal(res.location, 'https://makaug.com/help');
  });

  test(`${label}: a genuine Host: makaug.com is not redirected`, async () => {
    const res = await request(portOf(), '/help', { Host: 'makaug.com' });
    assert.notEqual(res.status, 301);
    const www = await request(portOf(), '/help', { Host: 'www.makaug.com' });
    assert.notEqual(www.status, 301);
  });

  test(`${label}: makaug.onrender.com redirects and keeps the query`, async () => {
    const res = await request(portOf(), '/for-sale?x=1', { Host: 'makaug.onrender.com' });
    assert.equal(res.status, 301);
    assert.equal(res.location, 'https://makaug.com/for-sale?x=1');
  });

  test(`${label}: exempt paths are never redirected`, async () => {
    for (const p of ['/api/health', '/api/whatsapp/webhook?hub.mode=subscribe', '/api/whatsapp/web-bridge/status']) {
      const res = await request(portOf(), p, { Host: 'makaug.onrender.com' });
      assert.notEqual(res.status, 301, p);
    }
  });
}
