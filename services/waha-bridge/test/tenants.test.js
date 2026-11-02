'use strict';
// Unit + end-to-end test: a 'neondaku' session event reaches only the
// Neondaku target; a MakaUG ('default') event reaches only makaug.
const assert = require('assert');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const t = require('../tenants');

// --- unit
assert.strictEqual(t.neondakuTenantFromEnv({}), null, 'no env -> no tenant');
assert.strictEqual(t.neondakuTenantFromEnv({ NEONDAKU_WAHA_SESSION: 'neondaku' }), null, 'partial env -> no tenant');
const env = { NEONDAKU_WAHA_SESSION: 'neondaku', NEONDAKU_BASE_URL: 'https://neondaku.com/', NEONDAKU_WEB_BRIDGE_TOKEN: 'x' };
const ten = t.neondakuTenantFromEnv(env);
assert.strictEqual(ten.baseUrl, 'https://neondaku.com');
assert.strictEqual(t.neondakuTenantFromEnv({ ...env, BRIDGE_IS_CHILD: '1' }), null, 'child never spawns');
assert.throws(() => t.neondakuTenantFromEnv({ ...env, WAHA_SESSION: 'neondaku' }));
assert.strictEqual(t.routeFor({ session: 'neondaku' }, ten), 'child');
assert.strictEqual(t.routeFor({ session: 'default' }, ten), 'primary');
assert.strictEqual(t.routeFor({}, ten), 'primary');
assert.strictEqual(t.routeFor({ session: 'neondaku' }, null), 'primary', 'no tenant -> makaug path');
const ce = t.childEnv(ten, { ...env, WHATSAPP_WEB_BRIDGE_TOKEN: 'mk', WAHA_SESSION: 'default' });
assert.strictEqual(ce.WAHA_SESSION, 'neondaku');
assert.strictEqual(ce.MAKAUG_BASE_URL, 'https://neondaku.com');
assert.strictEqual(ce.WHATSAPP_WEB_BRIDGE_TOKEN, 'x');
assert.strictEqual(ce.ADAPTER_MEDIA_SECRET, 'mk');
assert.ok(!Object.keys(ce).some((k) => k.startsWith('NEONDAKU_')));
console.log('tenants unit: ok');

// --- end to end
function sink(name, hits) {
  return http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      if (req.url.includes('/inbound')) hits.push({ name, auth: req.headers['x-whatsapp-web-bridge-token'] || '', body: b });
      res.setHeader('content-type', 'application/json');
      if (req.url.includes('/outbox')) return res.end(JSON.stringify({ ok: true, messages: [] }));
      if (req.url.includes('/api/sessions')) return res.end(JSON.stringify({ status: 'WORKING', me: { id: '1@c.us' } }));
      res.end(JSON.stringify({ ok: true }));
    });
  });
}
const listen = (s) => new Promise((r) => s.listen(0, '127.0.0.1', () => r(s.address().port)));
const post = (port, body, key) => new Promise((resolve, reject) => {
  const raw = JSON.stringify(body);
  const hmac = crypto.createHmac('sha512', key).update(raw).digest('hex');
  const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/waha/webhook', headers: { 'content-type': 'application/json', 'x-webhook-hmac': hmac } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
  req.on('error', reject); req.end(raw);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const msg = (session, id, text) => ({ event: 'message', session, payload: { id, from: '243864000000@c.us', fromMe: false, body: text, timestamp: Math.floor(Date.now() / 1000) } });

(async () => {
  const hits = [];
  const mk = sink('makaug', hits); const nd = sink('neondaku', hits); const wa = sink('waha', []);
  const [mkP, ndP, waP] = await Promise.all([listen(mk), listen(nd), listen(wa)]);
  const port = 20000 + Math.floor(Math.random() * 5000);
  const key = 'test-hmac';
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { PATH: process.env.PATH, PORT: String(port), WAHA_URL: `http://127.0.0.1:${waP}`, WAHA_API_KEY: 'k', WAHA_HOOK_HMAC_KEY: key,
      MAKAUG_BASE_URL: `http://127.0.0.1:${mkP}`, WHATSAPP_WEB_BRIDGE_TOKEN: 'mk-token', ADAPTER_PUBLIC_URL: 'http://x',
      NEONDAKU_WAHA_SESSION: 'neondaku', NEONDAKU_BASE_URL: `http://127.0.0.1:${ndP}`, NEONDAKU_WEB_BRIDGE_TOKEN: 'nd-token', NEONDAKU_CHILD_PORT: String(port + 1) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = ''; child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { out += d; });
  try {
    await sleep(2500);
    assert.strictEqual(await post(port, msg('default', 'mk1', 'Hello'), key), 200);
    assert.strictEqual(await post(port, msg('neondaku', 'nd1', 'Bonjour'), key), 200);
    await sleep(2500);
    const mkHits = hits.filter((h) => h.name === 'makaug');
    const ndHits = hits.filter((h) => h.name === 'neondaku');
    assert.strictEqual(mkHits.length, 1, `makaug hits ${mkHits.length}\n${out}`);
    assert.strictEqual(ndHits.length, 1, `neondaku hits ${ndHits.length}\n${out}`);
    assert.ok(mkHits[0].body.includes('Hello') && !mkHits[0].body.includes('Bonjour'), 'makaug got only its message');
    assert.ok(ndHits[0].body.includes('Bonjour') && ndHits[0].auth.includes('nd-token'), 'neondaku got its message with its token');
    console.log('tenants e2e: ok');
  } finally {
    child.kill('SIGTERM'); mk.close(); nd.close(); wa.close();
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
