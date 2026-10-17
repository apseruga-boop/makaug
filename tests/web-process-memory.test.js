'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

const {
  enqueueWhatsappMediaWork,
  deferForSenderBurst,
  resetWhatsappMediaQueueForTests,
  whatsappMediaQueueStats
} = require('../services/whatsappMediaQueue');
const {
  spillDataUrlItem,
  writeResponseBodyToFile,
  removeSpillFile
} = require('../utils/inboundMediaBytes');
const { memoryFields } = require('../utils/memoryLog');
const { BOOT_DELAY_MS } = require('../utils/schedulerStagger');

const root = path.join(__dirname, '..');

test('whatsapp media work never runs more than two at once', async () => {
  resetWhatsappMediaQueueForTests();
  process.env.WHATSAPP_MEDIA_CONCURRENCY = '2';
  let current = 0;
  let peak = 0;
  const jobs = Array.from({ length: 6 }, () => enqueueWhatsappMediaWork(async () => {
    current += 1;
    peak = Math.max(peak, current);
    await new Promise((resolve) => setTimeout(resolve, 30));
    current -= 1;
  }));
  await Promise.all(jobs);
  assert.ok(peak <= 2, `peak concurrency was ${peak}`);
  assert.equal(whatsappMediaQueueStats().active, 0);
  delete process.env.WHATSAPP_MEDIA_CONCURRENCY;
  resetWhatsappMediaQueueForTests();
});

test('a sender burst is deferred and still runs', async () => {
  resetWhatsappMediaQueueForTests();
  process.env.WHATSAPP_SENDER_BURST = '2';
  process.env.WHATSAPP_SENDER_DEFER_MS = '5';
  const first = await deferForSenderBurst('256700000001');
  const second = await deferForSenderBurst('256700000001');
  const third = await deferForSenderBurst('+256 700 000 001');
  assert.equal(first.deferred, false);
  assert.equal(second.deferred, false);
  assert.equal(third.deferred, true);
  assert.ok(third.defer_ms > 0);
  delete process.env.WHATSAPP_SENDER_BURST;
  delete process.env.WHATSAPP_SENDER_DEFER_MS;
  resetWhatsappMediaQueueForTests();
});

test('a long data URL is spilled to a file and removed from the preview', async () => {
  const payload = Buffer.from('property-photo-bytes').toString('base64');
  const item = { data_url: `data:image/jpeg;base64,${payload}${'A'.repeat(2048)}`, mime_type: 'image/jpeg' };
  await spillDataUrlItem(item);
  assert.equal(item.data_url, undefined);
  assert.equal(item.dataUrl, undefined);
  assert.ok(item.media_file);
  const saved = await fs.promises.readFile(item.media_file);
  assert.ok(saved.length > 0);
  assert.equal(await removeSpillFile(item.media_file), true);
  assert.equal(await removeSpillFile('/tmp/not-makaug-spill.jpg'), false);
});

test('a streamed body over the cap is rejected', async () => {
  const chunks = [Buffer.alloc(100, 1), Buffer.alloc(100, 2)];
  const body = Readable.toWeb(Readable.from(chunks));
  await assert.rejects(
    () => writeResponseBodyToFile({ body }, { maxBytes: 150 }),
    (error) => error && error.code === 'BOUNDED_BODY_TOO_LARGE'
  );
});

test('memory fields name rss and heap, and scheduler boot delays do not collide', () => {
  const fields = memoryFields({ rss: 10 * 1048576, heapUsed: 4 * 1048576, heapTotal: 8 * 1048576, external: 1048576 });
  assert.equal(fields.rss_mb, 10);
  assert.equal(fields.heap_used_mb, 4);
  const delays = Object.values(BOOT_DELAY_MS);
  assert.equal(new Set(delays).size, delays.length);
  for (let index = 1; index < delays.length; index += 1) {
    assert.ok(delays[index] - delays[index - 1] >= 20_000);
  }
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  assert.match(server, /phase=minute rss_mb=/);
  const featured = fs.readFileSync(path.join(root, 'services/featuredRotationService.js'), 'utf8');
  assert.doesNotMatch(featured, /p\.extra_fields,/);
  assert.match(featured, /jsonb_build_object\(/);
  const billing = fs.readFileSync(path.join(root, 'services/billingOpsService.js'), 'utf8');
  assert.match(billing, /LIMIT 300/);
  assert.match(billing, /billingRunning/);
  const drip = fs.readFileSync(path.join(root, 'services/xSourceDripService.js'), 'utf8');
  assert.doesNotMatch(drip, /schedulerTimer\.unref/);
});
