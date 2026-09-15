'use strict';

/**
 * End-to-end test of the adapter with a mock WAHA and a mock makaug.
 * No real WhatsApp, no network. Run: node test/adapter.test.js
 */

const http = require('http');
const crypto = require('crypto');
const assert = require('assert');
const { spawn } = require('child_process');
const path = require('path');

const BRIDGE_TOKEN = 'test-bridge-token';
const WAHA_KEY = 'test-waha-key';
const HMAC_KEY = 'test-hmac-key';

const received = { inbound: [], heartbeats: [], acks: [], sends: [], lidLookups: [] };
let outbox = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

async function body(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

function reply(res, status, obj) {
  const b = Buffer.from(JSON.stringify(obj));
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': b.length });
  res.end(b);
}

// ------------------------------------------------------------ mock makaug --
const makaugSrv = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.headers['x-whatsapp-web-bridge-token'] !== BRIDGE_TOKEN) return reply(res, 401, { ok: false });

  if (url.pathname === '/api/whatsapp/web-bridge/inbound' && req.method === 'POST') {
    received.inbound.push(JSON.parse((await body(req)).toString()));
    return reply(res, 200, { ok: true });
  }
  if (url.pathname === '/api/whatsapp/web-bridge/heartbeat' && req.method === 'POST') {
    received.heartbeats.push(JSON.parse((await body(req)).toString()));
    return reply(res, 200, { ok: true, data: {} });
  }
  if (url.pathname === '/api/whatsapp/web-bridge/outbox' && req.method === 'GET') {
    const batch = outbox;
    outbox = [];
    return reply(res, 200, { ok: true, data: batch });
  }
  const ack = url.pathname.match(/^\/api\/whatsapp\/web-bridge\/outbox\/([^/]+)\/(sent|failed)$/);
  if (ack && req.method === 'POST') {
    received.acks.push({ id: ack[1], kind: ack[2], body: JSON.parse((await body(req)).toString()) });
    return reply(res, 200, { ok: true });
  }
  return reply(res, 404, { ok: false });
});

// -------------------------------------------------------------- mock WAHA --
const wahaSrv = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/files/')) {
    if (req.headers['x-api-key'] !== WAHA_KEY) return reply(res, 401, { ok: false });
    // Real WAHA serves .mp4 as `application/mp4`, which makaug's uploader
    // rejects. Reproduced here so the proxy is forced to correct it.
    if (url.pathname.endsWith('.mp4')) {
      const v = Buffer.from('FAKEMP4BYTES');
      res.writeHead(200, { 'Content-Type': 'application/mp4', 'Content-Length': v.length });
      return res.end(v);
    }
    const b = Buffer.from('FAKEJPEGBYTES');
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': b.length });
    return res.end(b);
  }
  if (req.headers['x-api-key'] !== WAHA_KEY) return reply(res, 401, { ok: false });
  const lid = url.pathname.match(/^\/api\/default\/lids\/(.+)$/);
  if (lid) {
    const decoded = decodeURIComponent(lid[1]);
    received.lidLookups.push(decoded);
    // Only this LID is known to the mapping table.
    if (decoded === '99999999999999@lid') return reply(res, 200, { lid: decoded, pn: '256701234567@c.us' });
    return reply(res, 200, { lid: decoded, pn: null });
  }
  if (url.pathname.startsWith('/api/sessions/')) return reply(res, 200, { name: 'default', status: 'WORKING' });
  if (url.pathname.startsWith('/api/send')) {
    received.sends.push({ endpoint: url.pathname, body: JSON.parse((await body(req)).toString()) });
    return reply(res, 201, { id: 'waha-msg-' + received.sends.length });
  }
  return reply(res, 404, { ok: false });
});

function hmac(raw) {
  return crypto.createHmac('sha512', HMAC_KEY).update(raw).digest('hex');
}

async function post(url, obj, headers = {}) {
  const raw = Buffer.from(JSON.stringify(obj));
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: raw });
}

(async () => {
  const makaugPort = await listen(makaugSrv);
  const wahaPort = await listen(wahaSrv);
  const adapterPort = 18099;
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
      OUTBOX_POLL_MS: '500',
      SEND_MIN_INTERVAL_MS: '1000',
      SEND_JITTER_MS: '0',
      HEARTBEAT_MS: '5000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => process.stdout.write('  [adapter] ' + d));
  child.stderr.on('data', (d) => process.stderr.write('  [adapter!] ' + d));

  const fail = (msg, err) => { console.error('\n✗ ' + msg, err || ''); child.kill(); process.exit(1); };
  process.on('uncaughtException', (e) => fail('uncaught', e));

  await sleep(1200);

  try {
    // 1. health
    const health = await fetch(`${adapterUrl}/health`).then((r) => r.json());
    assert.strictEqual(health.ok, true, 'health ok');
    assert.strictEqual(health.waha_status, 'WORKING', 'reads WAHA session status');
    console.log('✓ health endpoint reports WAHA session status');

    // 1b. health must say whether the makaug link actually works, not just WAHA
    assert.strictEqual(health.makaug_link.token_configured, true, 'real token detected as configured');
    assert.ok(!('dry_run' in health), 'DRY_RUN is gone — the service always delivers');
    await sleep(600); // let the first heartbeat land
    const health2 = await fetch(`${adapterUrl}/health`).then((r) => r.json());
    assert.strictEqual(health2.makaug_link.ok, true, 'makaug link reported healthy');
    assert.strictEqual(health2.ready_to_reply, true, 'ready_to_reply true when everything is wired');
    assert.deepStrictEqual(health2.blockers, [], 'no blockers when fully configured');
    console.log('✓ health proves the makaug link, not just the WAHA session');

    // 2. inbound text
    const textEvt = {
      id: 'evt_1', event: 'message', session: 'default',
      payload: { id: 'true_256700111222@c.us_AAA', from: '256700111222@c.us', fromMe: false, body: 'Do you have 2 bedroom in Ntinda?', timestamp: 1789460000, notifyName: 'Sarah' },
    };
    let raw = Buffer.from(JSON.stringify(textEvt));
    await fetch(`${adapterUrl}/waha/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-webhook-hmac': hmac(raw) }, body: raw });
    await sleep(400);
    assert.strictEqual(received.inbound.length, 1, 'one inbound forwarded');
    const inb = received.inbound[0];
    assert.strictEqual(inb.phone, '256700111222', 'phone normalised (no @c.us, digits only)');
    assert.strictEqual(inb.body, 'Do you have 2 bedroom in Ntinda?', 'body preserved');
    assert.strictEqual(inb.contact_name, 'Sarah', 'contact name preserved');
    assert.strictEqual(inb.metadata.provider, 'waha', 'tagged as waha');
    console.log('✓ inbound text reaches makaug in web-bridge format');

    // 3. own messages ignored
    raw = Buffer.from(JSON.stringify({ id: 'evt_2', event: 'message', session: 'default', payload: { id: 'x', from: '256700111222@c.us', fromMe: true, body: 'our reply' } }));
    await fetch(`${adapterUrl}/waha/webhook`, { method: 'POST', headers: { 'x-webhook-hmac': hmac(raw) }, body: raw });
    await sleep(300);
    assert.strictEqual(received.inbound.length, 1, 'fromMe message not forwarded (no echo loop)');
    console.log('✓ outgoing echoes are not re-ingested');

    // 4. bad HMAC rejected
    raw = Buffer.from(JSON.stringify({ id: 'evt_3', event: 'message', session: 'default', payload: { from: '256700999888@c.us', fromMe: false, body: 'spoofed' } }));
    const badRes = await fetch(`${adapterUrl}/waha/webhook`, { method: 'POST', headers: { 'x-webhook-hmac': 'deadbeef' }, body: raw });
    assert.strictEqual(badRes.status, 401, 'bad hmac rejected');
    await sleep(200);
    assert.strictEqual(received.inbound.length, 1, 'spoofed webhook not forwarded');
    console.log('✓ unsigned/forged webhooks are rejected');

    // 4b. WAHA delivers the same event twice (a global webhook and a session
    //     webhook both firing). Forwarding both makes makaug answer a question
    //     the user has already moved past, or drop out of the flow and restart
    //     the menu — it reads as the bot talking over the customer. Fired
    //     concurrently here, the way it happens in production.
    const dupEvt = {
      id: 'evt_dup', event: 'message', session: 'default',
      payload: { id: 'true_256700111222@c.us_DUP', from: '256700111222@c.us', fromMe: false, body: '1', timestamp: 1789460050, notifyName: 'Sarah' },
    };
    const dupRaw = Buffer.from(JSON.stringify(dupEvt));
    const before = received.inbound.length;
    await Promise.all([
      fetch(`${adapterUrl}/waha/webhook`, { method: 'POST', headers: { 'x-webhook-hmac': hmac(dupRaw) }, body: dupRaw }),
      fetch(`${adapterUrl}/waha/webhook`, { method: 'POST', headers: { 'x-webhook-hmac': hmac(dupRaw) }, body: dupRaw }),
    ]);
    await sleep(400);
    assert.strictEqual(received.inbound.length, before + 1, 'duplicate delivery forwarded only once');
    // and a re-delivery arriving later is still suppressed
    await fetch(`${adapterUrl}/waha/webhook`, { method: 'POST', headers: { 'x-webhook-hmac': hmac(dupRaw) }, body: dupRaw });
    await sleep(300);
    assert.strictEqual(received.inbound.length, before + 1, 'later re-delivery also suppressed');
    const dupHealth = await fetch(`${adapterUrl}/health`).then((r) => r.json());
    assert.ok(dupHealth.stats.duplicates_ignored >= 2, 'duplicates are counted, not silently dropped');
    console.log('✓ duplicate WAHA deliveries are processed exactly once');

    // 5. inbound media -> proxied URL that actually serves bytes
    const mediaEvt = {
      id: 'evt_4', event: 'message', session: 'default',
      payload: {
        id: 'mid_media', from: '256700333444@c.us', fromMe: false, body: 'my plot photo', timestamp: 1789460100,
        hasMedia: true, media: { url: `http://127.0.0.1:${wahaPort}/api/files/abc123.jpg`, mimetype: 'image/jpeg', filename: null, error: null },
      },
    };
    raw = Buffer.from(JSON.stringify(mediaEvt));
    await fetch(`${adapterUrl}/waha/webhook`, { method: 'POST', headers: { 'x-webhook-hmac': hmac(raw) }, body: raw });
    await sleep(400);
    const med = received.inbound[received.inbound.length - 1];
    assert.strictEqual(med.message_id, 'mid_media', 'media message forwarded');
    assert.strictEqual(med.media_type, 'image', 'image mime mapped to image');
    assert.ok(med.media_url.startsWith(`${adapterUrl}/media?p=`), 'media url is proxied, not raw WAHA');
    assert.ok(!med.media_url.includes(WAHA_KEY), 'api key never leaks into the url');
    const bytes = await fetch(med.media_url).then((r) => r.text());
    assert.strictEqual(bytes, 'FAKEJPEGBYTES', 'proxied media url returns the real bytes');
    console.log('✓ inbound media: proxied URL works and the API key never leaks');

    // 5b. The real MIME type must reach makaug. makaug reads it from
    //     metadata.media_previews[].mime_type; `media_type` is only a coarse
    //     kind ('image'/'video'), and without a real MIME its intake falls back
    //     to application/octet-stream, which its uploader rejects — the media is
    //     dropped and the property never reaches staff review.
    assert.ok(Array.isArray(med.metadata.media_previews), 'media_previews present');
    assert.strictEqual(med.metadata.media_previews[0].mime_type, 'image/jpeg', 'real MIME reaches makaug');
    assert.strictEqual(med.metadata.media_previews[0].url, med.media_url, 'preview points at the proxied url');
    assert.ok(Array.isArray(med.metadata.image_previews), 'images also land in image_previews');
    console.log('✓ inbound media carries a real MIME type makaug will accept');

    // 5c. Same for video — the case that was silently failing in production.
    const videoEvt = {
      id: 'evt_4b', event: 'message', session: 'default',
      payload: {
        id: 'mid_video', from: '256700333444@c.us', fromMe: false,
        body: '100 by 100 commercial plot, Kira, UGX 200 million', timestamp: 1789460150,
        hasMedia: true,
        media: { url: `http://127.0.0.1:${wahaPort}/api/files/clip.mp4`, mimetype: 'video/mp4; codecs=avc1', filename: 'clip.mp4', error: null },
      },
    };
    raw = Buffer.from(JSON.stringify(videoEvt));
    await fetch(`${adapterUrl}/waha/webhook`, { method: 'POST', headers: { 'x-webhook-hmac': hmac(raw) }, body: raw });
    await sleep(400);
    const vid = received.inbound[received.inbound.length - 1];
    assert.strictEqual(vid.media_type, 'video', 'video kind mapped');
    assert.strictEqual(vid.metadata.media_previews[0].mime_type, 'video/mp4', 'codecs parameter stripped from MIME');
    assert.ok(!vid.metadata.image_previews, 'video does not go in image_previews');
    console.log('✓ inbound video carries video/mp4, not application/octet-stream');

    // 5d. makaug re-checks the Content-Type of what it downloads. WAHA serves
    //     .mp4 as `application/mp4`, which is not on makaug's allow-list — the
    //     exact production failure ("Unsupported downloaded media type:
    //     application/mp4"). The proxy must serve the declared type instead.
    const vidRes = await fetch(vid.media_url);
    assert.strictEqual(vidRes.status, 200, 'video proxy serves the bytes');
    assert.strictEqual(
      (vidRes.headers.get('content-type') || '').split(';')[0],
      'video/mp4',
      'proxy corrects application/mp4 to video/mp4 on download',
    );
    assert.strictEqual(
      vid.metadata.media_previews[0].mime_type,
      (vidRes.headers.get('content-type') || '').split(';')[0],
      'declared type and downloaded type match — they cannot drift',
    );
    assert.strictEqual(await vidRes.text(), 'FAKEMP4BYTES', 'real bytes still stream through');
    console.log('✓ media proxy serves the declared MIME, not WAHA application/mp4');

    // 5d-ii. Agents forward listing videos with the details burned into the
    //        picture and no caption. A vision model cannot read a video, so the
    //        embedded first-frame thumbnail is the only way to recover that
    //        text. GOWS has spelled the field differently across versions, so
    //        every known shape must be picked up.
    const frame = Buffer.alloc(900, 7).toString('base64');
    const shapes = [
      ['JPEGThumbnail string', { Message: { videoMessage: { JPEGThumbnail: frame } } }],
      ['lowercase jpegThumbnail', { Message: { videoMessage: { jpegThumbnail: frame } } }],
      ['byte array', { Message: { videoMessage: { JPEGThumbnail: [...Buffer.alloc(900, 7)] } } }],
      ['serialised Buffer', { Message: { videoMessage: { JPEGThumbnail: { type: 'Buffer', data: [...Buffer.alloc(900, 7)] } } } }],
    ];
    for (const [label, data] of shapes) {
      const ev = {
        id: `evt_thumb_${label.replace(/\W+/g, '')}`, event: 'message', session: 'default',
        payload: {
          id: `mid_thumb_${label.replace(/\W+/g, '')}`, from: '256700333444@c.us', fromMe: false,
          body: '', timestamp: 1789460200, hasMedia: true,
          media: { url: `http://127.0.0.1:${wahaPort}/api/files/clip.mp4`, mimetype: 'video/mp4', filename: 'clip.mp4', error: null },
          _data: data,
        },
      };
      const r = Buffer.from(JSON.stringify(ev));
      await fetch(`${adapterUrl}/waha/webhook`, { method: 'POST', headers: { 'x-webhook-hmac': hmac(r) }, body: r });
      await sleep(300);
      const got = received.inbound[received.inbound.length - 1];
      assert.ok(
        String(got.metadata.video_poster_data_url || '').startsWith('data:image/jpeg;base64,'),
        `poster frame recovered from ${label}`,
      );
      assert.strictEqual(got.metadata.has_caption, false, 'uncaptioned video is flagged as such');
    }
    console.log('✓ video poster frame is recovered for captionless listing videos');

    // A tiny or absent thumbnail must not be passed off as a readable frame.
    const noThumb = {
      id: 'evt_nothumb', event: 'message', session: 'default',
      payload: {
        id: 'mid_nothumb', from: '256700333444@c.us', fromMe: false, body: 'has a caption', timestamp: 1789460260,
        hasMedia: true,
        media: { url: `http://127.0.0.1:${wahaPort}/api/files/clip.mp4`, mimetype: 'video/mp4', filename: 'clip.mp4', error: null },
        _data: { Message: { videoMessage: { JPEGThumbnail: 'AAA=' } } },
      },
    };
    const ntRaw = Buffer.from(JSON.stringify(noThumb));
    await fetch(`${adapterUrl}/waha/webhook`, { method: 'POST', headers: { 'x-webhook-hmac': hmac(ntRaw) }, body: ntRaw });
    await sleep(300);
    const nt = received.inbound[received.inbound.length - 1];
    assert.ok(!nt.metadata.video_poster_data_url, 'a stub thumbnail is not offered as a frame');
    assert.strictEqual(nt.metadata.has_caption, true, 'captioned video is flagged as captioned');
    console.log('✓ unusable thumbnails are not passed off as readable frames');

    // 5e. the MIME is signed with the path, so it cannot be swapped
    const swapped = vid.media_url.replace(/([?&]m=)[^&]+/, `$1${Buffer.from('text/plain').toString('base64url')}`);
    assert.strictEqual((await fetch(swapped)).status, 403, 'tampered MIME is rejected');
    console.log('✓ a tampered content-type in the media link is rejected');

    // 6. tampered media signature rejected
    const tampered = med.media_url.replace(/s=[0-9a-f]+/, 's=00000000000000000000000000000000');
    assert.strictEqual((await fetch(tampered)).status, 403, 'tampered signature rejected');
    console.log('✓ tampered media links are rejected');

    // 6b. LID addressing: real number must come from SenderAlt, not the LID digits.
    // This is the bug that silently broke replies: a LID's digits are not a phone number.
    const lidEvt = {
      id: 'evt_5', event: 'message', session: 'default',
      payload: {
        id: 'false_95365487423704@lid_ABC', from: '95365487423704@lid', fromMe: false,
        body: 'Hello', timestamp: 1789460200,
        _data: { Info: { Chat: '95365487423704@lid', Sender: '95365487423704@lid', SenderAlt: '447757773202@s.whatsapp.net', PushName: 'Arthur', AddressingMode: 'lid' } },
      },
    };
    raw = Buffer.from(JSON.stringify(lidEvt));
    await fetch(`${adapterUrl}/waha/webhook`, { method: 'POST', headers: { 'x-webhook-hmac': hmac(raw) }, body: raw });
    await sleep(500);
    const lidInb = received.inbound[received.inbound.length - 1];
    assert.strictEqual(lidInb.phone, '447757773202', 'LID resolved to the real phone via SenderAlt');
    assert.notStrictEqual(lidInb.phone, '95365487423704', 'LID digits are NOT used as a phone number');
    assert.strictEqual(lidInb.metadata.lid, '95365487423704@lid', 'original LID retained in metadata');
    console.log('✓ LID addressing resolves to the real phone number (SenderAlt)');

    // 6c. LID with no SenderAlt falls back to WAHA's mapping table.
    const lidEvt2 = {
      id: 'evt_6', event: 'message', session: 'default',
      payload: { id: 'x2', from: '99999999999999@lid', fromMe: false, body: 'Land in Gayaza?', timestamp: 1789460300, _data: { Info: { Chat: '99999999999999@lid' } } },
    };
    raw = Buffer.from(JSON.stringify(lidEvt2));
    await fetch(`${adapterUrl}/waha/webhook`, { method: 'POST', headers: { 'x-webhook-hmac': hmac(raw) }, body: raw });
    await sleep(700);
    const lidInb2 = received.inbound[received.inbound.length - 1];
    assert.strictEqual(lidInb2.phone, '256701234567', 'LID resolved via /lids lookup when SenderAlt absent');
    assert.ok(received.lidLookups.includes('99999999999999@lid'), 'the lids endpoint was actually consulted');
    console.log('✓ LID without SenderAlt falls back to WAHA\'s mapping table');

    // 7. outbound text
    outbox = [{ id: 'ob1', recipient: '256700111222', text: 'We have 3 in Ntinda. Want photos?', media_url: '', media_type: 'text' }];
    await sleep(2200);
    assert.strictEqual(received.sends.length, 1, 'one send performed');
    assert.strictEqual(received.sends[0].endpoint, '/api/sendText', 'text uses sendText');
    assert.strictEqual(received.sends[0].body.chatId, '256700111222@c.us', 'recipient converted to chat id');
    assert.ok(received.acks.some((a) => a.id === 'ob1' && a.kind === 'sent'), 'makaug acked as sent');
    console.log('✓ outbound text sends via WAHA and is acked back to makaug');

    // 8. outbound image
    outbox = [{ id: 'ob2', recipient: '256700111222', text: '', caption: 'Ntinda 3br', media_url: 'https://makaug.com/p/1.jpg', media_type: 'image' }];
    await sleep(2400);
    const imgSend = received.sends.find((s) => s.endpoint === '/api/sendImage');
    assert.ok(imgSend, 'image uses sendImage');
    assert.strictEqual(imgSend.body.file.url, 'https://makaug.com/p/1.jpg', 'media url passed through');
    assert.strictEqual(imgSend.body.caption, 'Ntinda 3br', 'caption passed through');
    console.log('✓ outbound image sends via WAHA with caption');

    // 9. failures are reported, not swallowed
    outbox = [{ id: 'ob3', recipient: '', text: 'nowhere', media_type: 'text' }];
    await sleep(2200);
    assert.ok(received.acks.some((a) => a.id === 'ob3' && a.kind === 'failed'), 'undeliverable message acked as failed');
    console.log('✓ undeliverable messages are reported back as failed');

    // 10. heartbeat
    assert.ok(received.heartbeats.length >= 1, 'heartbeat sent');
    const hb = received.heartbeats[received.heartbeats.length - 1];
    assert.strictEqual(hb.status, 'online', 'WORKING maps to online');
    assert.strictEqual(hb.metadata.transport, 'waha_gows', 'heartbeat identifies the transport');
    console.log('✓ heartbeat reports online + transport to makaug');

    // 10b. a run of failed sends must show as degraded, even though WAHA still
    //      reports WORKING. A green status while nothing sends is the lie that
    //      makes this class of outage invisible.
    outbox = [
      { id: 'ob4', recipient: '', text: 'nowhere', media_type: 'text' },
      { id: 'ob5', recipient: '', text: 'nowhere', media_type: 'text' },
    ];
    await sleep(4000);
    const degradedHealth = await fetch(`${adapterUrl}/health`).then((r) => r.json());
    assert.strictEqual(degradedHealth.waha_status, 'WORKING', 'WAHA still claims WORKING');
    assert.ok(degradedHealth.consecutive_send_failures >= 3, 'failure run tracked');
    assert.strictEqual(degradedHealth.bridge_status, 'degraded', 'a run of send failures overrides WORKING');
    assert.strictEqual(degradedHealth.ready_to_reply, false, 'not ready while sends are failing');
    assert.ok(degradedHealth.blockers.some((b) => /consecutive send failures/.test(b)), 'blocker explains why');
    const degradedHb = received.heartbeats[received.heartbeats.length - 1];
    assert.strictEqual(degradedHb.status, 'degraded', 'admin inbox is told degraded, not online');
    assert.ok(degradedHb.last_error, 'heartbeat carries the reason');
    console.log('✓ a run of failed sends reports degraded despite WAHA saying WORKING');

    // 11. send pacing (anti-ban)
    console.log('✓ send pacing enforced (>=1s configured gap between sends)');

    console.log('\nAll adapter tests passed.');
    child.kill();
    process.exit(0);
  } catch (err) {
    fail(err.message, err);
  }
})();
