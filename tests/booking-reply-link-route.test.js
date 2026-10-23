'use strict';

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
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

function request(port, requestPath, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: requestPath, method, headers: { Host: 'makaug.com' } }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        body: Buffer.concat(chunks).toString('utf8')
      }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('GET and HEAD /v/:token reach the booking handler instead of the public 404', async () => {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'test',
      MEMORY_LOG: 'off',
      STARTUP_DATA_REPAIRS: 'off',
      EVENT_LOOP_LAG_LOG: 'off',
      DATABASE_URL: '',
      AGENT_BOOKING_TOKEN_SECRET: 'booking-route-test-secret'
    },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-4000); });
  try {
    let ready = false;
    for (let i = 0; i < 80; i += 1) {
      try {
        const health = await request(port, '/help');
        if (health.status === 200) { ready = true; break; }
      } catch (_error) { /* process still binding */ }
      if (child.exitCode !== null) throw new Error(`server.js exited: ${stderr}`);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!ready) throw new Error(`server.js did not start: ${stderr}`);

    for (const method of ['GET', 'HEAD']) {
      const response = await request(port, '/v/not-a-real-booking-token', method);
      assert.equal(response.status, 410, `${method} must be the booking handler, not the public 404`);
      if (method === 'GET') {
        assert.match(response.body, /This link has expired/);
        assert.doesNotMatch(response.body, /Page not found/);
      }
    }
    const missing = await request(port, '/this-page-does-not-exist');
    assert.equal(missing.status, 404);
    assert.match(missing.body, /Page not found/);
  } finally {
    if (child.exitCode === null) child.kill('SIGTERM');
  }
});
