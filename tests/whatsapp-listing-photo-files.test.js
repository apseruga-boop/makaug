'use strict';

/**
 * 12 Nov 2026. The runtime writes every WhatsApp photo bigger than 2 KB to a
 * temporary file before the listing flow sees it (spillInboundMetadata), and
 * the property listing's photo step only knew how to read a data URL. A real
 * phone photo was answered "I could not verify that image safely. It has not
 * been counted." and the lister could never get past the photos. The short-stay
 * route uses the same photo step, so it is fixed once for both.
 */
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

process.env.NODE_ENV = 'test';
const realDb = require('../config/database');
realDb.query = async () => ({ rows: [] });

test('a real-sized WhatsApp photo that arrives as a file is checked, stored and counted; the same photo again is not', async () => {
  const puts = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      puts.push({ url: req.url, body: Buffer.concat(chunks), sha: req.headers['x-amz-content-sha256'] });
      res.writeHead(200, { ETag: '"test"' });
      res.end();
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const keys = ['MEDIA_STORAGE_PROVIDER', 'S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_FORCE_PATH_STYLE', 'S3_PUBLIC_BASE_URL'];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    MEDIA_STORAGE_PROVIDER: 's3',
    S3_ENDPOINT: `http://127.0.0.1:${server.address().port}`,
    S3_BUCKET: 'test-bucket',
    S3_ACCESS_KEY_ID: 'test',
    S3_SECRET_ACCESS_KEY: 'test',
    S3_FORCE_PATH_STYLE: 'true'
  });
  delete process.env.S3_PUBLIC_BASE_URL;
  const file = path.join(os.tmpdir(), `makaug-photo-test-${crypto.randomUUID()}.bin`);
  try {
    const sharp = require('sharp');
    const raw = Buffer.alloc(320 * 240 * 3);
    for (let i = 0; i < raw.length; i += 1) raw[i] = (i * 7919) % 251;
    const bytes = await sharp(raw, { raw: { width: 320, height: 240, channels: 3 } }).jpeg({ quality: 80 }).toBuffer();
    assert.ok(bytes.length > 2048, 'big enough to be spilled to a file');
    await fs.promises.writeFile(file, bytes);

    const { validateAndStoreListingPhotos } = require('../routes/whatsapp').__test;
    const runtime = { photoCandidates: [{ media_file: file, mime_type: 'image/jpeg' }] };
    const first = await validateAndStoreListingPhotos({
      phone: '256772123456',
      lang: 'en',
      draft: { listing_type: 'rent', photos: [] },
      runtime,
      mediaUrl: 'whatsapp-web://inline-image-1'
    });
    assert.strictEqual(first.outcomes[0].status, 'accepted');
    assert.strictEqual(first.photos.length, 1);
    assert.match(first.photos[0], /^s3:\/\/test-bucket\/whatsapp-listings\/photos\/\d+-[0-9a-f-]+-listing-photo-1\.jpg$/);
    // The bytes stored are the photo's, signed with their own hash.
    assert.strictEqual(puts.length, 1);
    assert.ok(puts[0].body.equals(bytes));
    assert.strictEqual(puts[0].sha, crypto.createHash('sha256').update(bytes).digest('hex'));
    // No vision model in tests: the photo is kept for staff to check, not refused.
    assert.strictEqual(first.photoValidation[0].needs_staff_check, true);

    const again = await validateAndStoreListingPhotos({
      phone: '256772123456',
      lang: 'en',
      draft: { listing_type: 'rent', photos: first.photos, photo_hashes: first.photoHashes },
      runtime,
      mediaUrl: 'whatsapp-web://inline-image-2'
    });
    assert.strictEqual(again.outcomes[0].status, 'duplicate');
    assert.strictEqual(again.photos.length, 1);
    assert.strictEqual(puts.length, 1);
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    await fs.promises.unlink(file).catch(() => {});
    server.close();
  }
});

test('no part of the lister\'s phone number goes into a public photo name', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'whatsapp.js'), 'utf8');
  const step = source.slice(source.indexOf('async function validateAndStoreListingPhotos'), source.indexOf('function shortStayListingKit'));
  assert.doesNotMatch(step, /slice\(-8\)/);
  assert.match(step, /listing-photo-\$\{photos\.length \+ 1\}/);
});
