'use strict';

/**
 * WhatsApp calls to the number reach makaug (27 Nov 2026). Part one follows
 * single calls through the tracker with a fake clock; part two runs the real
 * service against a mock WAHA, which speaks the websocket WAHA serves at /ws,
 * and a mock makaug. No real WhatsApp, no network. Every number is made up.
 *
 * Run: node test/calls.test.js
 */

const http = require('http');
const crypto = require('crypto');
const assert = require('assert');
const path = require('path');
const { spawn } = require('child_process');
const { WebSocketServer } = require('ws');
const calls = require('../calls');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ----------------------------------------------------------- part one ---

function fakeClock(start = 1_800_000_000_000) {
  let t = start;
  let seq = 0;
  const pending = new Map();
  return {
    now: () => t,
    timers: {
      set(fn, ms) { seq += 1; pending.set(seq, { at: t + ms, fn }); return seq; },
      clear(id) { pending.delete(id); },
    },
    advance(ms) {
      t += ms;
      for (const [id, job] of [...pending.entries()].sort((a, b) => a[1].at - b[1].at)) {
        if (job.at <= t && pending.has(id)) { pending.delete(id); job.fn(); }
      }
    },
  };
}

function tracker() {
  const clock = fakeClock();
  const told = [];
  const tr = calls.createCallTracker({ settle: (c) => told.push(c), now: clock.now, timers: clock.timers });
  return { clock, told, tr };
}

const ring = (id, extra = {}) => ({ id, from: '256700000201@c.us', timestamp: 1_800_000_000, isVideo: false, isGroup: false, _data: {}, ...extra });

{
  // Rang, nobody answered, it ended: one missed call, told once.
  const { clock, told, tr } = tracker();
  tr.onEvent('call.received', ring('c1'));
  assert.strictEqual(told.length, 0, 'nothing is told while it rings');
  clock.advance(25_000);
  tr.onEvent('call.rejected', ring('c1'));
  assert.strictEqual(told.length, 1);
  assert.strictEqual(told[0].status, 'missed');
  assert.strictEqual(told[0].endedBy, 'ended');
  assert.strictEqual(told[0].from, '256700000201@c.us');
  assert.strictEqual(told[0].startedAt, 1_800_000_000_000, 'the time it started ringing, from WAHA');
  tr.onEvent('call.rejected', ring('c1'));
  clock.advance(5 * 60_000);
  assert.strictEqual(told.length, 1, 'a repeat end, or the backstop, never tells it twice');
  console.log('✓ a call nobody answers is told once, as missed, when it ends');
}

{
  // Answered on the phone, then hung up after a talk: answered.
  const { clock, told, tr } = tracker();
  tr.onEvent('call.received', ring('c2'));
  clock.advance(8_000);
  tr.onEvent('call.accepted', ring('c2'));
  clock.advance(240_000);
  tr.onEvent('call.rejected', ring('c2'));
  assert.deepStrictEqual(told.map((c) => [c.status, c.endedBy]), [['answered', 'answered_on_phone']]);
  assert.strictEqual(tr.stats.answered, 1);
  assert.strictEqual(tr.stats.missed, 0);
  console.log('✓ a call answered on the phone is told as answered, and its hang-up is not a missed call');
}

{
  // Never said to end: missed after two minutes, so a lost event hides nobody.
  const { clock, told, tr } = tracker();
  tr.onEvent('call.received', ring('c3', { isVideo: true }));
  clock.advance(calls.RING_LIMIT_MS - 1);
  assert.strictEqual(told.length, 0);
  clock.advance(1);
  assert.deepStrictEqual(told.map((c) => [c.status, c.endedBy, c.isVideo]), [['missed', 'no_end_event', true]]);
  console.log('✓ a call never said to have ended is counted missed after two minutes');
}

{
  // Heard twice (webhook and websocket), a group call, a call whose start was not seen.
  const { told, tr } = tracker();
  tr.onEvent('call.received', ring('c4'));
  assert.deepStrictEqual(tr.onEvent('call.received', ring('c4')), { handled: true, repeat: true });
  assert.strictEqual(tr.stats.received, 1, 'the same call heard twice is one call');
  assert.strictEqual(tr.onEvent('call.received', ring('g1', { isGroup: true })).reason, 'group_call');
  assert.strictEqual(tr.onEvent('call.received', ring('g2', { from: '120363000000000000@g.us' })).reason, 'group_call');
  assert.strictEqual(tr.onEvent('call.received', { from: '256700000201@c.us' }).reason, 'no_call_id');
  assert.strictEqual(tr.onEvent('message', ring('m1')).reason, 'not_a_call_event');
  tr.onEvent('call.rejected', ring('c5', { from: '256700000202@c.us' }));
  assert.deepStrictEqual(told.map((c) => [c.id, c.status]), [['c5', 'missed']], 'an end without a start is still told');
  console.log('✓ a call heard twice is one call; group calls and non-call events are left alone');
}

{
  // The caller's number inside a LID call's event: only a phone address, never our own.
  assert.strictEqual(calls.callerJidIn({ CallCreatorAlt: '256700000203@s.whatsapp.net' }), '256700000203@s.whatsapp.net');
  assert.strictEqual(calls.callerJidIn({ BasicCallMeta: { CallCreator: '256700000204:7@s.whatsapp.net' } }), '256700000204:7@s.whatsapp.net');
  assert.strictEqual(calls.callerJidIn({ CallCreator: '95365487423704@lid' }), '', 'a LID is not a number');
  assert.strictEqual(calls.callerJidIn({ From: '256700000999@s.whatsapp.net' }, '256700000999'), '', 'our own number is not the caller');
  assert.strictEqual(calls.callerJidIn(null), '');
  console.log('✓ a hidden caller\'s number is read from the event only when it is a phone address');
}

// ----------------------------------------------------------- part two ---

const BRIDGE_TOKEN = 'test-bridge-token';
const WAHA_KEY = 'test-waha-key-0f3c9d';
const HMAC_KEY = 'test-hmac-key';

const toldCalls = [];
let failNextCall = 0;
let rejectFirstSocket = true;
let socketClients = [];

function reply(res, status, obj) {
  const b = Buffer.from(JSON.stringify(obj));
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': b.length });
  res.end(b);
}

async function body(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

const makaugSrv = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.headers['x-whatsapp-web-bridge-token'] !== BRIDGE_TOKEN) return reply(res, 401, { ok: false });
  if (url.pathname === '/api/whatsapp/web-bridge/call' && req.method === 'POST') {
    const payload = JSON.parse((await body(req)).toString());
    if (failNextCall > 0) { failNextCall -= 1; return reply(res, 503, { ok: false, error: 'simulated outage' }); }
    toldCalls.push(payload);
    return reply(res, 200, { ok: true, data: {} });
  }
  if (url.pathname === '/api/whatsapp/web-bridge/heartbeat') return reply(res, 200, { ok: true, data: {} });
  if (url.pathname === '/api/whatsapp/web-bridge/outbox') return reply(res, 200, { ok: true, data: [] });
  return reply(res, 404, { ok: false });
});

const wahaSrv = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.headers['x-api-key'] !== WAHA_KEY) return reply(res, 401, { ok: false });
  if (url.pathname === '/api/sessions/default') return reply(res, 200, { name: 'default', status: 'WORKING', me: { id: '256700000900@c.us', pushName: 'makaug' } });
  const lid = url.pathname.match(/^\/api\/default\/lids\/(.+)$/);
  if (lid) {
    const decoded = decodeURIComponent(lid[1]);
    if (decoded === '99999999999999@lid') return reply(res, 200, { lid: decoded, pn: '256701234567@c.us' });
    return reply(res, 200, { lid: decoded, pn: null });
  }
  if (url.pathname === '/api/contacts') {
    if (url.searchParams.get('contactId') === '256700000301@c.us') return reply(res, 200, { id: '256700000301@c.us', pushname: 'Testa Caller' });
    return reply(res, 404, { message: 'not found' });
  }
  return reply(res, 404, { ok: false });
});

// WAHA's /ws: the key comes as a query parameter; a wrong one is answered with a close.
const wss = new WebSocketServer({ noServer: true });
const socketUrls = [];
wahaSrv.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname !== '/ws') { socket.destroy(); return; }
  socketUrls.push(url);
  wss.handleUpgrade(req, socket, head, (ws) => {
    if (url.searchParams.get('x-api-key') !== WAHA_KEY || rejectFirstSocket) {
      rejectFirstSocket = false;
      ws.close(4401, 'Unauthorized');
      return;
    }
    socketClients.push(ws);
    ws.on('close', () => { socketClients = socketClients.filter((c) => c !== ws); });
  });
});

function emit(event, payload) {
  const raw = JSON.stringify({ id: `evt_${crypto.randomUUID()}`, event, session: 'default', payload });
  for (const ws of socketClients) ws.send(raw);
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

async function waitFor(check, ms = 6000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (check()) return true;
    await sleep(100);
  }
  return false;
}

(async () => {
  const makaugPort = await listen(makaugSrv);
  const wahaPort = await listen(wahaSrv);
  const adapterPort = 18097;
  const adapterUrl = `http://127.0.0.1:${adapterPort}`;
  let output = '';

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
      OUTBOX_POLL_MS: '1000',
      HEARTBEAT_MS: '5000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => { output += d; process.stdout.write('  [calls] ' + d); });
  child.stderr.on('data', (d) => { output += d; process.stderr.write('  [calls!] ' + d); });
  const fail = (msg, err) => { console.error('\n✗ ' + msg, err || ''); child.kill(); process.exit(1); };
  process.on('uncaughtException', (e) => fail('uncaught', e));

  try {
    // The first connection is refused, as a wrong key is; the service tries again and stays quiet about the key.
    assert.ok(await waitFor(() => socketClients.length === 1, 9000), 'listening after the first refusal');
    const url = socketUrls[0];
    assert.strictEqual(url.searchParams.get('session'), 'default');
    assert.deepStrictEqual(url.searchParams.getAll('events'), ['call.received', 'call.accepted', 'call.rejected'], 'only call events are asked for');
    const health = await fetch(`${adapterUrl}/health`).then((r) => r.json());
    assert.strictEqual(health.calls.listening, 'listening');
    assert.strictEqual(health.calls.reconnects, 1, 'one refusal, one retry');
    assert.match(health.calls.last_close, /^4401 Unauthorized/);
    assert.ok(!JSON.stringify(health).includes(WAHA_KEY), 'the key is never on /health');
    console.log('✓ the service listens to WAHA\'s websocket for calls, and tries again when refused');

    // A missed call from a number WhatsApp shared, with a WhatsApp name.
    emit('call.received', { id: 'CALL-A', from: '256700000301@c.us', timestamp: Math.floor(Date.now() / 1000), isVideo: false, isGroup: false, _data: {} });
    await sleep(300);
    assert.strictEqual(toldCalls.length, 0, 'not while it rings');
    emit('call.rejected', { id: 'CALL-A', from: '256700000301@c.us', timestamp: Math.floor(Date.now() / 1000), isVideo: false, isGroup: false, _data: {} });
    assert.ok(await waitFor(() => toldCalls.length === 1), 'told once it ended');
    const a = toldCalls[0];
    assert.strictEqual(a.phone, '256700000301');
    assert.strictEqual(a.contact_name, 'Testa Caller');
    assert.strictEqual(a.call_id, 'CALL-A');
    assert.strictEqual(a.status, 'missed');
    assert.strictEqual(a.call_type, 'voice');
    assert.deepStrictEqual(
      [a.metadata.source, a.metadata.detection_kind, a.metadata.call_detector_release, a.metadata.waha_event, a.metadata.ended_by],
      ['waha_gows_call', 'waha_call_event', 'whatsapp-call-card-trust-gate-20260831', 'call.rejected', 'ended'],
      'carries what makaug\'s gate for call events asks for'
    );
    console.log('✓ a missed call reaches makaug once it ends, with the caller\'s number and name');

    // The same call arriving by the webhook too is not told again.
    const raw = Buffer.from(JSON.stringify({ id: 'evt_dup', event: 'call.received', session: 'default', payload: { id: 'CALL-A', from: '256700000301@c.us', isGroup: false } }));
    const hookRes = await fetch(`${adapterUrl}/waha/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-webhook-hmac': crypto.createHmac('sha512', HMAC_KEY).update(raw).digest('hex') }, body: raw });
    assert.strictEqual(hookRes.status, 200);
    await sleep(500);
    assert.strictEqual(toldCalls.length, 1, 'a call heard twice is told once');
    console.log('✓ a call heard on the webhook as well is told once');

    // Answered on the phone: told as answered.
    emit('call.received', { id: 'CALL-B', from: '256700000302@c.us', isVideo: true, isGroup: false });
    emit('call.accepted', { id: 'CALL-B', from: '256700000302@c.us', isVideo: true, isGroup: false });
    assert.ok(await waitFor(() => toldCalls.length === 2));
    assert.deepStrictEqual([toldCalls[1].status, toldCalls[1].call_type, toldCalls[1].metadata.waha_event], ['answered', 'video', 'call.accepted']);
    console.log('✓ a call answered on the phone is told as answered');

    // From a LID: WAHA's mapping table gives the number; an unknown LID is never turned into one.
    emit('call.received', { id: 'CALL-C', from: '99999999999999@lid', isGroup: false });
    emit('call.rejected', { id: 'CALL-C', from: '99999999999999@lid', isGroup: false });
    assert.ok(await waitFor(() => toldCalls.length === 3));
    assert.strictEqual(toldCalls[2].phone, '256701234567', 'mapped LID -> the real number');
    emit('call.received', { id: 'CALL-D', from: '11111111111111@lid', isGroup: false, _data: { CallCreatorAlt: '256700000303@s.whatsapp.net' } });
    emit('call.rejected', { id: 'CALL-D', from: '11111111111111@lid', isGroup: false });
    assert.ok(await waitFor(() => toldCalls.length === 4));
    assert.strictEqual(toldCalls[3].phone, '256700000303', 'the number inside the event');
    emit('call.received', { id: 'CALL-E', from: '22222222222222@lid', isGroup: false });
    emit('call.rejected', { id: 'CALL-E', from: '22222222222222@lid', isGroup: false });
    assert.ok(await waitFor(() => toldCalls.length === 5));
    assert.strictEqual(toldCalls[4].phone, '', 'no number is invented from a LID');
    assert.strictEqual(toldCalls[4].metadata.number_hidden, true);
    assert.strictEqual(toldCalls[4].metadata.chat_id, '22222222222222@lid');
    console.log('✓ a call from a hidden address gets the real number, or is told as hidden, never as a made-up one');

    // A group call is nobody asking for us.
    emit('call.received', { id: 'CALL-G', from: '120363000000000000@g.us', isGroup: true });
    emit('call.rejected', { id: 'CALL-G', from: '120363000000000000@g.us', isGroup: true });
    await sleep(600);
    assert.strictEqual(toldCalls.length, 5, 'group calls are not told');
    console.log('✓ group calls are left alone');

    // makaug busy for a moment: tried again, told once.
    failNextCall = 1;
    emit('call.received', { id: 'CALL-F', from: '256700000304@c.us', isGroup: false });
    emit('call.rejected', { id: 'CALL-F', from: '256700000304@c.us', isGroup: false });
    assert.ok(await waitFor(() => toldCalls.length === 6, 9000), 'told after one failure');
    assert.strictEqual(toldCalls[5].call_id, 'CALL-F');
    console.log('✓ a call is told again when makaug is busy for a moment');

    const after = await fetch(`${adapterUrl}/health`).then((r) => r.json());
    assert.strictEqual(after.calls.told_makaug, 6);
    assert.strictEqual(after.calls.missed, 5);
    assert.strictEqual(after.calls.answered, 1);
    assert.strictEqual(after.calls.numbers_hidden, 1);
    assert.strictEqual(after.calls.group_calls_ignored, 1);
    assert.deepStrictEqual(after.blockers.filter((b) => /calls/.test(b)), [], 'no blocker while calls are heard');
    assert.ok(!output.includes(WAHA_KEY), 'the WAHA key never reaches the log');
    assert.ok(!/256700000301|256701234567|256700000303|256700000304/.test(output.split('\n').filter((l) => /call /.test(l)).join('\n')), 'call log lines show only the last three digits');
    console.log('✓ /health counts the calls; the key and the callers\' numbers stay out of the log');

    console.log('\nAll call tests passed.');
    child.kill();
    wss.close();
    process.exit(0);
  } catch (err) {
    fail(err.message, err);
  }
})();
