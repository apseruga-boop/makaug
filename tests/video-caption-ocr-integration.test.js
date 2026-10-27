'use strict';

// Opt in with VIDEO_OCR_INTEGRATION=1. Uses a new local PostgreSQL cluster,
// a generated captioned MP4, and the real ffmpeg and OCR engine. It never
// reads the caller's DATABASE_URL. Tesseract.js may download its English model.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const https = require('node:https');
const { execFile, execFileSync } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);

const PG_BIN = [
  process.env.VIDEO_OCR_TEST_PG_BIN,
  '/opt/homebrew/opt/postgresql@16/bin',
  '/usr/lib/postgresql/16/bin',
  '/usr/lib/postgresql/17/bin',
  '/usr/lib/postgresql/18/bin'
].filter(Boolean).find((dir) => fs.existsSync(path.join(dir, 'initdb')) && fs.existsSync(path.join(dir, 'pg_ctl')));
const ROOT = path.join(__dirname, '..');
const ID = '55555555-5555-4555-8555-555555555555';
const BROKEN_ID = '66666666-6666-4666-8666-666666666666';
const QUEUED_ID = '77777777-7777-4777-8777-777777777777';

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

test('real video decoding and OCR save caption facts without changing listing approval or fields', {
  skip: process.env.VIDEO_OCR_INTEGRATION !== '1'
    ? 'Set VIDEO_OCR_INTEGRATION=1 for the local PostgreSQL, ffmpeg and Tesseract check.'
    : PG_BIN ? false : 'Install PostgreSQL or set VIDEO_OCR_TEST_PG_BIN.'
}, async () => {
  const cluster = fs.mkdtempSync(path.join(os.tmpdir(), 'caption-ocr-test-'));
  const data = path.join(cluster, 'data');
  const socket = path.join(cluster, 'sock');
  fs.mkdirSync(socket);
  let db;
  let server;
  let started = false;
  try {
    const port = await freePort();
    execFileSync(path.join(PG_BIN, 'initdb'), ['-D', data, '--username=ocr', '--auth=trust', '--encoding=UTF8', '--no-locale'], { stdio: 'pipe' });
    execFileSync(path.join(PG_BIN, 'pg_ctl'), [
      '-D', data, '-l', path.join(cluster, 'postgres.log'), '-w', '-t', '20',
      '-o', `-h 127.0.0.1 -p ${port} -k '${socket}' -c fsync=off -c synchronous_commit=off`, 'start'
    ], { stdio: 'pipe' });
    started = true;
    const databaseUrl = `postgres://ocr@127.0.0.1:${port}/postgres`;
    const { Client } = require('pg');
    db = new Client({ connectionString: databaseUrl });
    await db.connect();
    await db.query(`CREATE TABLE properties (
      id uuid PRIMARY KEY, title text, description text, area text, district text,
      price numeric, price_original_currency text, bedrooms integer,
      property_type text, listing_type text, land_size_value numeric,
      land_size_unit text, status text DEFAULT 'pending', extra_fields jsonb
    )`);
    await db.query(fs.readFileSync(path.join(ROOT, 'db/migrations/161_property_video_caption_ocr.sql'), 'utf8'));

    const image = path.join(cluster, 'caption.png');
    const video = path.join(cluster, 'caption.mp4');
    await require('sharp')(Buffer.from(`<svg width="800" height="450" xmlns="http://www.w3.org/2000/svg">
      <rect width="800" height="450" fill="white"/>
      <g font-family="Arial, sans-serif" font-size="56" fill="black">
        <text x="35" y="90">LAND FOR SALE</text><text x="35" y="180">KIRA</text>
        <text x="35" y="270">UGX 50 MILLION</text><text x="35" y="360">2 ACRES</text>
      </g></svg>`)).png().toFile(image);
    const bundledFfmpeg = require('ffmpeg-static');
    const ffmpeg = process.env.FFMPEG_PATH || (bundledFfmpeg && fs.existsSync(bundledFfmpeg) ? bundledFfmpeg : 'ffmpeg');
    await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-loop', '1', '-i', image,
      '-t', '5', '-r', '5', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', video]);

    // Trust only this fixture's generated certificate in the child process.
    // The service still performs a real HTTPS fetch with normal verification.
    const key = path.join(cluster, 'key.pem');
    const cert = path.join(cluster, 'cert.pem');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key,
      '-out', cert, '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'pipe' });
    const downloads = [];
    server = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, (req, res) => {
      downloads.push(req.url);
      const bytes = req.url === '/broken.mp4' ? Buffer.from('invalid MP4 fixture') : fs.readFileSync(video);
      res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': bytes.length });
      res.end(bytes);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `https://127.0.0.1:${server.address().port}`;
    for (const [id, filename] of [[ID, 'caption.mp4'], [BROKEN_ID, 'broken.mp4'], [QUEUED_ID, 'queued.mp4']]) {
      await db.query(`INSERT INTO properties (id, title, area, district, price, property_type, listing_type, land_size_value, land_size_unit, extra_fields)
        VALUES ($1, 'Fixture land', 'Kira', 'Wakiso', 50000000, 'Land', 'land', 2, 'acres', $2::jsonb)`, [id, JSON.stringify({
        video_urls: ['https://youtu.be/fixture-page', `${base}/${filename}`],
        source_caption: 'Land for sale Kira UGX 50 million 2 acres'
      })]);
    }

    const child = await run(process.execPath, ['-e', `
      const service = require('./services/videoCaptionOcrService');
      const db = require('./config/database');
      (async () => {
        service.scheduleVideoCaptionOcr('${QUEUED_ID}');
        let running;
        for (let attempt = 0; attempt < 100; attempt += 1) {
          running = await service.loadVideoCaptionRecord({ id: '${QUEUED_ID}' });
          if (running) break;
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        if (running?.status !== 'pending') throw new Error('Queued OCR did not enter its running state');
        const good = await service.runVideoCaptionOcr('${ID}');
        const queued = await service.loadVideoCaptionRecord({ id: '${QUEUED_ID}' });
        const broken = await service.runVideoCaptionOcr('${BROKEN_ID}');
        console.log('OCR_RESULT:' + JSON.stringify({ good, queued, broken }));
      })().catch(error => { console.error(error); process.exitCode = 1; })
        .finally(() => Promise.all([db.pool.end(), db.backgroundPool.end()]));
    `], {
      cwd: ROOT,
      timeout: 120000,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        DB_SSL: 'false',
        COUNTRY_CODE: 'UG',
        FFMPEG_PATH: ffmpeg,
        NODE_EXTRA_CA_CERTS: cert,
        VIDEO_OCR_TIMEOUT_MS: '45000'
      }
    });
    const output = child.stdout.split('\n').find((line) => line.startsWith('OCR_RESULT:'));
    assert.ok(output, `${child.stdout}\n${child.stderr}`);
    const { good, queued, broken } = JSON.parse(output.slice('OCR_RESULT:'.length));
    assert.equal(good.status, 'done', JSON.stringify(good));
    assert.equal(good.error, null);
    assert.ok(good.frame_count > 0, 'ffmpeg extracted and deduplicated real frames');
    assert.match(good.ocr_text, /LAND FOR SALE/i);
    assert.equal(good.parsed_facts.price, 50000000);
    assert.equal(good.parsed_facts.acres, 2);
    assert.equal(good.parsed_facts.type, 'land');
    assert.deepEqual(good.conflicts, []);
    assert.equal(queued.status, 'done', 'staff execution did not kill the running queue job');
    assert.equal(queued.parsed_facts.price, 50000000);
    assert.match(queued.ocr_text, /LAND FOR SALE/i);
    assert.equal(broken.status, 'ocr pending');
    assert.equal(broken.error, 'no_frames');
    assert.deepEqual(downloads, ['/queued.mp4', '/caption.mp4', '/broken.mp4'], 'social page links were never fetched');

    const saved = (await db.query('SELECT status, ocr_text, parsed_facts, frame_count FROM property_video_ocr WHERE property_id = $1', [ID])).rows[0];
    assert.equal(saved.status, good.status);
    assert.equal(saved.ocr_text, good.ocr_text);
    assert.deepEqual(saved.parsed_facts, good.parsed_facts);
    assert.equal(saved.frame_count, good.frame_count);
    const listing = (await db.query('SELECT title, price, status, extra_fields FROM properties WHERE id = $1', [ID])).rows[0];
    assert.equal(listing.title, 'Fixture land');
    assert.equal(Number(listing.price), 50000000);
    assert.equal(listing.status, 'pending');
    assert.equal(listing.extra_fields.video_caption_ocr.status, 'done');
    assert.equal(listing.extra_fields.video_caption_ocr.facts.price, 50000000);
    console.log(`Real OCR read ${good.frame_count} distinct frame(s): ${JSON.stringify(good.ocr_text)}`);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (db) await db.end();
    if (started) execFileSync(path.join(PG_BIN, 'pg_ctl'), ['-D', data, '-w', '-t', '20', '-m', 'immediate', 'stop'], { stdio: 'pipe' });
    fs.rmSync(cluster, { recursive: true, force: true });
  }
});
