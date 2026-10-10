'use strict';

/**
 * C4 (10 Oct 2026).
 * - 09:24-09:36: one WhatsApp message (a long agent-bot greeting, "Welcome to
 *   Konso Realty! ...") took 544 s with the web CPU at 100%. The hot function
 *   is canonicalLocationSuggestions(): it edit-distanced the whole message
 *   against every alias of all 11,400 places (260 s for a 2,000-character text).
 * - /locations/catalog?district=Entebbe returned all 11,400 places.
 * - Staff on one network shared the per-IP API limit and got 429s.
 * - Nothing logged what was running during the stall.
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'stall-and-rate-limit-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');

const { canonicalLocationSuggestions } = require('../utils/ugandaLocationRegistry');
const { apiRateLimitKey, apiRateLimitMax, WINDOW_MS } = require('../utils/apiRateLimit');
const lag = require('../utils/eventLoopLagMonitor');

const KONSO = `Welcome to Konso Realty! 🏡✨ I'm Konso, a Real Estate assistant here to help you find your dream home, land or commercial space in Uganda 🇺🇬.

Here's what I can do for you:
1️⃣ Houses for sale in Kampala, Wakiso, Mukono, Entebbe, Kira, Najjera, Kyanja, Ntinda, Muyenga, Munyonyo, Bunga, Ggaba, Kansanga, Lubowa, Kajjansi, Kitende, Bwebajja, Akright City, Gayaza, Kasangati, Matugga, Namugongo, Seeta, Bukerere, Nsasa, Kiwatule, Kisaasi, Bukoto, Naguru, Kololo, Nakasero
2️⃣ Apartments to rent from UGX 500,000 to UGX 15,000,000 per month 💰 — 1 bedroom, 2 bedroom, 3 bedroom and 4 bedroom units, fully furnished or unfurnished
3️⃣ Land and plots: 50x100, 100x100, 1 acre, 2 acres, 5 acres with titles (mailo, freehold, leasehold) in Mukono, Wakiso, Mpigi, Luwero, Jinja, Masaka, Mbarara, Gulu, Lira, Arua, Fort Portal, Hoima, Masindi, Kasese, Mbale, Soroti, Tororo, Busia
4️⃣ Commercial spaces: shops, offices, warehouses on Entebbe Road, Jinja Road, Gayaza Road, Hoima Road, Masaka Road, Bombo Road, Northern Bypass, Kampala-Entebbe Expressway

📞 Call or WhatsApp us on +256 700 123 456 / +256 772 987 654 / 0752 111 222
📍 Visit our office at Plot 12, Kampala Road, Kampala, opposite the Post Office, 2nd floor, Room 204
🕘 Open Monday to Saturday, 8:00am – 6:00pm. Sunday by appointment only.

Reply with:
👉 BUY to see houses for sale
👉 RENT to see rentals
👉 LAND to see plots
👉 SELL to list your property with us
👉 AGENT to talk to a human agent

Our featured listings this week: 4 bedroom house in Muyenga at UGX 850M, 3 bedroom apartment in Kololo at $2,500 per month, 2 acres in Mukono at UGX 120M, shop in Nakasero at UGX 3.5M per month, 5 bedroom mansion in Munyonyo at USD 1.2M, 50x100 plot in Kira at 45M, 1 bedroom in Kyanja at 700K, 3 bedroom bungalow in Namugongo at 380 million, 6 acres in Mpigi at 18M per acre.
Follow us on TikTok @konsorealty and Instagram @konso.realty 📲 #realestate #uganda #kampala #houseforsale #land #rentals`;

function maxLoopBlockMs(fn) {
  let maxGap = 0;
  let last = Date.now();
  const timer = setInterval(() => { const now = Date.now(); maxGap = Math.max(maxGap, now - last); last = now; }, 5);
  return Promise.resolve()
    .then(() => new Promise((resolve) => setTimeout(resolve, 20)))
    .then(fn)
    .then((value) => new Promise((resolve) => setTimeout(() => { clearInterval(timer); resolve({ value, maxGap }); }, 20)));
}

test('the Konso greeting no longer pins the CPU in location suggestions', () => {
  assert.ok(KONSO.length > 1900);
  const started = Date.now();
  const suggestions = canonicalLocationSuggestions(KONSO, new Map(), 3);
  const ms = Date.now() - started;
  assert.ok(ms < 1000, `took ${ms} ms (was about 260,000 ms)`);
  assert.ok(Array.isArray(suggestions));
});

test('typed place names still get the same suggestions, including typo fixes', () => {
  const top = (q) => canonicalLocationSuggestions(q, new Map(), 3).map((item) => `${item.location}/${item.district}`);
  assert.equal(top('Ntnda')[0], 'Ntinda/Kampala');
  assert.equal(top('Entebe')[0], 'Entebbe/Wakiso');
  assert.equal(top('Kira mulawa')[0], 'Kira-Mulawa/Wakiso');
  assert.equal(top('Akright')[0], 'Akright City/Wakiso');
  assert.equal(top('Bugoloobi')[0], 'Bugoloobi/Kampala');
});

test('the Konso message replayed through the WhatsApp pipeline: under 1 s, no long block', async () => {
  const db = require('../config/database');
  const original = { query: db.query, getClient: db.getClient };
  db.query = async () => ({ rows: [], rowCount: 0 });
  db.getClient = async () => ({ query: async () => ({ rows: [] }), release() {} });
  try {
    const { processMessage } = require('../routes/whatsapp').__test;
    const resolver = require('../services/whatsappLocationResolverService');
    for (const step of ['greeting', 'main_menu']) {
      const started = Date.now();
      const { maxGap } = await maxLoopBlockMs(() => processMessage('+256700999888', KONSO, null, null, {
        session: { current_step: step, language: 'en', session_data: {}, listing_draft: {} },
        intent: { intent: 'apply_filters', confidence: 0.66, entities: {} },
        language: 'en'
      }));
      assert.ok(Date.now() - started < 1000, `${step}: ${Date.now() - started} ms`);
      assert.ok(maxGap < 400, `${step}: event loop blocked ${maxGap} ms`);
    }
    // A long message that matches no place goes to the suggestion path.
    for (const text of [KONSO, KONSO.replace(/[A-Z][a-z]+/g, 'Qqzx')]) {
      const started = Date.now();
      resolver.resolveWhatsappLocation(text, { allowText: true });
      assert.ok(Date.now() - started < 1000, `location resolver ${Date.now() - started} ms`);
    }
  } finally {
    db.query = original.query;
    db.getClient = original.getClient;
  }
});

test('/locations/catalog answers one district only; an unknown district is a 400', async () => {
  const app = express();
  app.use('/api/properties', require('../routes/properties'));
  const entebbe = await request(app).get('/api/properties/locations/catalog?district=Entebbe');
  assert.equal(entebbe.status, 400);
  assert.deepEqual(entebbe.body.data, []);
  const none = await request(app).get('/api/properties/locations/catalog');
  assert.equal(none.status, 400);
  const kampala = await request(app).get('/api/properties/locations/catalog?district=Kampala');
  assert.equal(kampala.status, 200);
  assert.ok(kampala.body.data.length > 50 && kampala.body.data.length <= 500, String(kampala.body.data.length));
  assert.ok(kampala.body.data.every((item) => item.district === 'Kampala'));
});

test('signed-in staff are counted per user with a higher ceiling; anonymous traffic keeps the per-IP limit', async () => {
  const app = express();
  app.set('trust proxy', false);
  app.use('/api', rateLimit({ windowMs: WINDOW_MS, max: apiRateLimitMax, keyGenerator: apiRateLimitKey, standardHeaders: true, legacyHeaders: false, validate: false }));
  app.get('/api/staff/properties/review-queue', (_req, res) => res.json({ ok: true }));
  const moderator = jwt.sign({ sub: '7b2e0c1a-5d3f-4c8e-9a61-0f2d4b6c8e10', role: 'moderator' }, process.env.JWT_SECRET, { expiresIn: '5m' });
  const finder = jwt.sign({ sub: 'u-finder', role: 'buyer_renter' }, process.env.JWT_SECRET, { expiresIn: '5m' });
  const agent = request.agent(app);
  for (let i = 0; i < 1200; i += 1) {
    const res = await agent.get('/api/staff/properties/review-queue').set('Authorization', `Bearer ${moderator}`);
    assert.equal(res.status, 200, `staff request ${i + 1}`);
  }
  let anonymousStatus = 200;
  for (let i = 0; i < 1001 && anonymousStatus === 200; i += 1) {
    anonymousStatus = (await agent.get('/api/staff/properties/review-queue').set('Authorization', `Bearer ${finder}`)).status;
  }
  assert.equal(anonymousStatus, 429, 'a non-staff user is still limited per IP');
  const forged = jwt.sign({ sub: 'x', role: 'moderator' }, 'wrong-secret');
  assert.equal(apiRateLimitKey({ get: (name) => (name === 'authorization' ? `Bearer ${forged}` : ''), ip: '1.2.3.4' }).startsWith('ip:'), true, 'a forged token is anonymous');
  assert.equal(apiRateLimitMax({ get: (name) => (name === 'authorization' ? `Bearer ${moderator}` : '') }), 5000);
});

test('the event-loop lag logger names what was running', async () => {
  const done = lag.trackWork('POST /api/whatsapp/web-bridge/inbound');
  const line = lag.formatLagLine({ p99: 900, max: 4000, mean: 120 }, lag.inFlightSummary());
  assert.match(line, /^event_loop_lag p99_ms=900 max_ms=4000 mean_ms=120 in_flight=POST \/api\/whatsapp\/web-bridge\/inbound \(\d+s\)$/);
  const lines = [];
  const monitor = lag.startEventLoopLagMonitor({ logger: { warn: (text) => lines.push(text) }, thresholdMs: 200, intervalMs: 300 });
  await new Promise((resolve) => setTimeout(resolve, 50));
  const until = Date.now() + 600;
  while (Date.now() < until) { /* block the loop */ }
  await new Promise((resolve) => setTimeout(resolve, 450));
  monitor.stop();
  done();
  assert.ok(lines.some((text) => /event_loop_lag p99_ms=\d+/.test(text) && text.includes('web-bridge')), lines.join('\n'));
  assert.deepEqual(lag.inFlightSummary(), []);
});

test('server.js uses the per-user limiter, the lag middleware and the monitor', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../server.js'), 'utf8');
  assert.match(src, /max: apiRateLimitMax,\n  keyGenerator: apiRateLimitKey,/);
  assert.match(src, /app\.use\(lagTrackingMiddleware\);/);
  assert.match(src, /startEventLoopLagMonitor\(\{ logger \}\)/);
});

test.after(async () => {
  try { await require('../config/database').pool.end(); } catch (_) {}
});
