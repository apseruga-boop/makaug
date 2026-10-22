'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const express = require('express');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const coverPath = path.join(root, 'assets', 'og-cover.jpg');

function loadStaticCache() {
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const start = server.indexOf('const VERSIONED_STATIC_CACHE_CONTROL');
  const end = server.indexOf('function appendVaryHeader');
  assert.ok(start >= 0 && end > start, 'static cache helpers must stay in server.js');
  return new Function(`${server.slice(start, end)}\nreturn { staticCacheControlForUrl, UNVERSIONED_STATIC_CACHE_CONTROL };`)();
}

test('the share image is a 1200 by 630 JPEG under 300 KB', async () => {
  const image = fs.readFileSync(coverPath);
  assert.ok(image.length < 300 * 1024);
  assert.equal(image.subarray(0, 3).toString('hex'), 'ffd8ff');
  const meta = await sharp(image).metadata();
  assert.equal(meta.format, 'jpeg');
  assert.equal(meta.width, 1200);
  assert.equal(meta.height, 630);
});

test('the cover is served as image/jpeg with the unversioned asset cache', async () => {
  const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  assert.match(serverSource, /app\.use\('\/assets', express\.static/);
  assert.match(serverSource, /staticCacheControlForUrl\(req\.originalUrl \|\| req\.url\)/);

  const { staticCacheControlForUrl, UNVERSIONED_STATIC_CACHE_CONTROL } = loadStaticCache();
  const app = express();
  app.use('/assets', express.static(path.join(root, 'assets'), {
    index: false,
    dotfiles: 'ignore',
    cacheControl: false,
    setHeaders(res) {
      const req = res.req || {};
      res.setHeader('Cache-Control', staticCacheControlForUrl(req.originalUrl || req.url));
    }
  }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/assets/og-cover.jpg`);
    const body = Buffer.from(await response.arrayBuffer());
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/jpeg');
    assert.equal(response.headers.get('cache-control'), 'public, max-age=3600');
    assert.equal(UNVERSIONED_STATIC_CACHE_CONTROL, 'public, max-age=3600');
    assert.equal(body.subarray(0, 3).toString('hex'), 'ffd8ff');
    assert.equal(body.length, fs.statSync(coverPath).size);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
