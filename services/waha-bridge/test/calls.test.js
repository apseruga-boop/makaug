'use strict';

/**
 * Calls to the makaug number reach makaug. Run: node test/calls.test.js
 *
 * Until 4 Nov 2026 WAHA's call.* events fell through as "unknown" and no
 * call since the move to WAHA was recorded anywhere. A call not accepted on
 * the phone inside the grace period is reported as missed; an accepted one
 * is not; a rejected one is reported at once.
 */

const http = require('http');
const crypto = require('crypto');
const assert = require('assert');
const { spawn } = require('child_process');
const path = require('path');

const BRIDGE_TOKEN = 'test-bridge-token';
const WAHA_KEY = 'test-waha-key';
const HMAC_KEY = 'test-hmac-key';
const GRACE_MS = 400;

const received = { calls: [], inbound: [], sessionPuts: [] };
let sessionEvents = ['message', 'session.status'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function listen(server) { return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port))); }
async function body(req) { const chunks = []; for await (const c of req) chunks.push(c); return Buffer.concat(chunks); }
function reply(res, status, obj) {
  const b = Buffer.from(JSON.stringify(obj));
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': b.length });
  res.end(b);
}

const makaugSrv = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.headers['x-whatsapp-web-bridge-token'] !== BRIDGE_TOKEN) return reply(res, 401, { ok: false });
  if (url.pathname === '/api/whatsapp/web-bridge/call' && req.method === 'POST') {
    received.calls.push(JSON.parse((await body(req)).toString()));
    return reply(res, 200, { ok: true, data: { lead_id: 'lead-1' } });
  }
  if (url.pathname === '/api/whatsapp/web-bridge/inbound' && req.method === 'POST') {
    received.inbound.push(JSON.parse((await body(req)).toString()));
    return reply(res, 200, { ok: true });
  }
  if (url.pathname === '/api/whatsapp/web-bridge/heartbeat') return reply(res, 200, { ok: true, data: {} });
  if (url.pathname === '/api/whatsapp/web-bridge/outbox') return reply(res, 200, { ok: true, data: [] });
  return reply(res, 404, { ok: false });
});

const wahaSrv = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.headers['x-api-key'] !== WAHA_KEY) return reply(res, 401, { ok: false });
  const lid = url.pathname.match(/^\/api\/default\/lids\/(.+)$/);
  if (lid) {
    const decoded = decodeURIComponent(lid[1]);
    if (decoded === '97522181738556@lid') return reply(res, 200, { lid: decoded, pn: '31684960002@c.us' });
    return reply(res, 200, { lid: decoded, pn: null });
  }
  if (url.pathname === '/api/sessions/default' && req.method === 'PUT') {
    const parsed = JSON.parse((await body(req)).toString());
    received.sessionPuts.push(parsed);
    sessionEvents = parsed.config.webhooks[0].events;
    return reply(res, 200, { name: 'default', status: 'STARTING' });
  }
  if (url.pathname.startsWith('/api/sessions/')) {
    return reply(res, 200, { name: 'default', status: 'WORKING', config: { webhooks: [{ url: 'http://bridge/waha/webhook', events: sessionEvents }] } });
  }
  return reply(res, 404, { ok: false });
});

function hmac(raw) { return crypto.createHmac('sha512', HMAC_KEY).update(raw).digest('hex'); }
async function hook(adapterUrl, evt) {
  const raw = Buffer.from(JSON.stringify(evt));
  return fetch(`${adapterUrl}/waha/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-webhook-hmac': hmac(raw) }, body: raw });
}

(async () => {
  const makaugPort = await listen(makaugSrv);
  const wahaPort = await listen(wahaSrv);
  const adapterPort = 18098;
  const adapterUrl = `http://127.0.0.1:${adapterPort}`;
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: {
      ...process.env,
      PORT: String(adapterPort),
      WAHA_URL: `http://127.0.0.1:${wahaPort}`,
      WAHA_API_KEY: WAHA_KEY,
      WAHA_SESSION: 'default',
      WAHA_HOOK_HMAC_KEY: HMAC_KEY,
      MAKAUG_BASE_URL: `http://127.0.0.1:${makaugPort}`,
      WHATSAPP_WEB_BRIDGE_TOKEN: BRIDGE_TOKEN,
      ADAPTER_PUBLIC_URL: adapterUrl,
      ADAPTER_MEDIA_SECRET: 'media-secret',
      OUTBOX_POLL_MS: '60000',
      HEARTBEAT_MS: '60000',
      CALL_MISSED_GRACE_MS: String(GRACE_MS),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => process.stdout.write('  [adapter] ' + d));
  child.stderr.on('data', (d) => process.stderr.write('  [adapter!] ' + d));
  const fail = (msg, err) => { console.error('\n✗ ' + msg, err || ''); child.kill(); process.exit(1); };
  process.on('uncaughtException', (e) => fail('uncaught', e));
  await sleep(1200);

  try {
    // 1. health says whether WAHA will send call events at all
    let health = await fetch(`${adapterUrl}/health`).then((r) => r.json());
    assert.strictEqual(health.calls.events_subscribed, false, 'a session subscribed only to messages is reported as not subscribed');
    assert.ok(health.blockers.some((b) => /call events/.test(b)), 'and it is a named blocker');
    assert.strictEqual(health.calls.grace_ms, GRACE_MS);
    console.log('✓ health shows the call-event subscription gap');

    // 2. a call nobody answers is reported as missed after the grace period
    await hook(adapterUrl, { id: 'evt_c1', event: 'call.received', session: 'default', payload: { id: 'CALL1', from: '256700111222@c.us', timestamp: 1793800000, isVideo: false, isGroup: false } });
    await sleep(GRACE_MS / 2);
    assert.strictEqual(received.calls.length, 0, 'nothing reported while it is still ringing');
    await sleep(GRACE_MS);
    assert.strictEqual(received.calls.length, 1, 'reported once the grace period passes');
    const missed = received.calls[0];
    assert.strictEqual(missed.phone, '256700111222');
    assert.strictEqual(missed.status, 'missed');
    assert.strictEqual(missed.call_type, 'voice');
    assert.strictEqual(missed.call_id, 'waha:CALL1');
    assert.strictEqual(missed.metadata.detection_kind, 'waha_call_event');
    assert.strictEqual(missed.metadata.source, 'waha_gows_call');
    assert.strictEqual(missed.metadata.call_detector_release, 'whatsapp-call-card-trust-gate-20260831');
    assert.strictEqual(missed.metadata.waha_event, 'call.received');
    assert.strictEqual(missed.created_at, new Date(1793800000 * 1000).toISOString());
    console.log('✓ an unanswered call is reported as missed, in the shape makaug trusts');

    // 3. a call answered on the phone is not a missed call
    await hook(adapterUrl, { id: 'evt_c2', event: 'call.received', session: 'default', payload: { id: 'CALL2', from: '256700111222@c.us', timestamp: 1793800100, isVideo: true } });
    await sleep(GRACE_MS / 4);
    await hook(adapterUrl, { id: 'evt_c3', event: 'call.accepted', session: 'default', payload: { id: 'CALL2', from: '256700111222@c.us', timestamp: 1793800105, isVideo: true } });
    await sleep(GRACE_MS * 1.5);
    assert.strictEqual(received.calls.length, 1, 'an accepted call is not reported');
    console.log('✓ a call picked up on the phone is left alone');

    // 4. a rejected call is reported at once, and the duplicate ring is ignored
    await hook(adapterUrl, { id: 'evt_c4', event: 'call.received', session: 'default', payload: { id: 'CALL3', from: '97522181738556@lid', timestamp: 1793800200 } });
    await hook(adapterUrl, { id: 'evt_c4b', event: 'call.received', session: 'default', payload: { id: 'CALL3', from: '97522181738556@lid', timestamp: 1793800200 } });
    await hook(adapterUrl, { id: 'evt_c5', event: 'call.rejected', session: 'default', payload: { id: 'CALL3', from: '97522181738556@lid', timestamp: 1793800203 } });
    await sleep(300);
    assert.strictEqual(received.calls.length, 2, 'the rejected call is reported straight away');
    const declined = received.calls[1];
    assert.strictEqual(declined.status, 'declined');
    assert.strictEqual(declined.phone, '31684960002', 'a LID caller is resolved to a phone number');
    assert.strictEqual(declined.metadata.lid, '97522181738556@lid');
    await sleep(GRACE_MS * 1.5);
    assert.strictEqual(received.calls.length, 2, 'and the ring timer was cancelled, so nothing is reported twice');
    console.log('✓ a rejected call is reported at once, once, with the LID resolved');

    // 5. group calls and unresolved callers are not reported
    await hook(adapterUrl, { id: 'evt_c6', event: 'call.received', session: 'default', payload: { id: 'CALL4', from: '120363423279489703@g.us', isGroup: true } });
    await hook(adapterUrl, { id: 'evt_c7', event: 'call.rejected', session: 'default', payload: { id: 'CALL5', from: '55555555555555@lid' } });
    await sleep(GRACE_MS * 1.5);
    assert.strictEqual(received.calls.length, 2, 'group calls and unresolved LIDs stay out');
    assert.strictEqual(received.inbound.length, 0, 'no call ever became an inbound message');
    console.log('✓ group calls and unresolvable callers are not reported');

    // 6. subscribing adds the three call events, with the bridge token, never on its own
    const noToken = await fetch(`${adapterUrl}/calls/subscribe`, { method: 'POST' });
    assert.strictEqual(noToken.status, 401);
    assert.strictEqual(received.sessionPuts.length, 0, 'nothing changed on WAHA without the token');
    const sub = await fetch(`${adapterUrl}/calls/subscribe`, { method: 'POST', headers: { 'x-whatsapp-web-bridge-token': BRIDGE_TOKEN } }).then((r) => r.json());
    assert.strictEqual(sub.ok, true);
    assert.deepStrictEqual(sub.events, ['message', 'session.status', 'call.received', 'call.accepted', 'call.rejected']);
    assert.strictEqual(received.sessionPuts.length, 1, 'one PUT to the session config');
    health = await fetch(`${adapterUrl}/health`).then((r) => r.json());
    assert.strictEqual(health.calls.events_subscribed, true);
    assert.ok(!health.blockers.some((b) => /call events/.test(b)));
    assert.strictEqual(health.calls.reported, 2);
    assert.strictEqual(health.calls.answered, 1);
    console.log('✓ /calls/subscribe adds the events behind the bridge token, and health clears');

    console.log('\nall call tests passed');
    child.kill();
    makaugSrv.close(); wahaSrv.close();
    process.exit(0);
  } catch (err) {
    fail('call test failed', err);
  }
})();
