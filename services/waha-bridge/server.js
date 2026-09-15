#!/usr/bin/env node
'use strict';

/**
 * makaug WhatsApp bridge adapter: WAHA (GOWS/whatsmeow) <-> makaug web-bridge API.
 *
 * Replaces the Playwright/WhatsApp-Web transport without touching makaug's
 * conversation logic. makaug keeps talking to its existing web-bridge
 * endpoints; this process translates them to and from WAHA's HTTP API.
 *
 *   inbound   WAHA webhook  -> POST {MAKAUG}/api/whatsapp/web-bridge/inbound
 *   outbound  GET {MAKAUG}/api/whatsapp/web-bridge/outbox -> WAHA send* -> ack
 *   liveness  POST {MAKAUG}/api/whatsapp/web-bridge/heartbeat
 *   media     WAHA media needs an API key; we proxy it behind a signed URL so
 *             makaug can fetch it without holding the key.
 */

const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');

// ---------------------------------------------------------------- config ---

const cfg = {
  port: Number(process.env.PORT || 10000),
  wahaUrl: String(process.env.WAHA_URL || '').replace(/\/+$/, ''),
  wahaApiKey: String(process.env.WAHA_API_KEY || ''),
  wahaSession: String(process.env.WAHA_SESSION || 'default'),
  hookHmacKey: String(process.env.WAHA_HOOK_HMAC_KEY || ''),

  makaugUrl: String(process.env.MAKAUG_BASE_URL || 'https://makaug.com').replace(/\/+$/, ''),
  bridgeToken: String(process.env.WHATSAPP_WEB_BRIDGE_TOKEN || ''),
  clientId: String(process.env.BRIDGE_CLIENT_ID || 'makaug-waha-gows'),
  operatorName: String(process.env.BRIDGE_OPERATOR_NAME || 'WAHA GOWS Bridge'),

  publicUrl: String(process.env.ADAPTER_PUBLIC_URL || '').replace(/\/+$/, ''),
  mediaSecret: String(process.env.ADAPTER_MEDIA_SECRET || process.env.WHATSAPP_WEB_BRIDGE_TOKEN || ''),

  outboxPollMs: clampInt(process.env.OUTBOX_POLL_MS, 2000, 500, 60000),
  outboxLimit: clampInt(process.env.OUTBOX_LIMIT, 5, 1, 20),
  allowedSources: String(process.env.OUTBOX_ALLOWED_SOURCES || 'whatsapp_runtime,whatsapp_missed_call'),
  // Anti-ban: never fire sends back to back. Randomised, never below ~1s.
  sendMinIntervalMs: clampInt(process.env.SEND_MIN_INTERVAL_MS, 3000, 1000, 120000),
  sendJitterMs: clampInt(process.env.SEND_JITTER_MS, 1500, 0, 60000),

  heartbeatMs: clampInt(process.env.HEARTBEAT_MS, 30000, 5000, 300000),
};

// DRY_RUN used to make this service accept messages and silently drop them
// while still reporting healthy. That is exactly the failure mode that is
// impossible to debug from the outside, so the flag is gone: if the service is
// up, it delivers. A leftover DRY_RUN env var is ignored. Use `npm test` for a
// no-network dry run.
if (process.env.DRY_RUN) {
  console.warn('NOTE: DRY_RUN is set but no longer supported — it is ignored. Remove it from the environment.');
}

function clampInt(raw, dflt, min, max) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function log(...args) {
  console.log(new Date().toISOString(), '[waha-bridge]', ...args);
}

const missing = ['wahaUrl', 'wahaApiKey', 'bridgeToken'].filter((k) => !cfg[k]);
if (missing.length) {
  console.error(`FATAL: missing required env: ${missing.join(', ')}`);
  process.exit(1);
}

// ------------------------------------------------------------- utilities ---

/** Digits-only phone, no leading +. WhatsApp chat ids are `<digits>@c.us`. */
function toPhone(value) {
  return String(value || '').replace(/@.*$/, '').replace(/\D+/g, '');
}

function toChatId(recipient) {
  const raw = String(recipient || '').trim();
  if (raw.includes('@')) return raw; // already a chat/group id
  const phone = toPhone(raw);
  return phone ? `${phone}@c.us` : '';
}

function sign(value) {
  return crypto.createHmac('sha256', cfg.mediaSecret || 'unset').update(String(value)).digest('hex').slice(0, 32);
}

function timingSafeEqualStr(a, b) {
  const ba = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return ba.length === bb.length && ba.length > 0 && crypto.timingSafeEqual(ba, bb);
}

async function readBody(req, limitBytes = 25 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) throw Object.assign(new Error('payload_too_large'), { statusCode: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function json(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length });
  res.end(body);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------ waha calls ---

async function waha(path, { method = 'GET', body, timeoutMs = 45000 } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`${cfg.wahaUrl}${path}`, {
      method,
      headers: {
        'X-Api-Key': cfg.wahaApiKey,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ac.signal,
    });
    const text = await res.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    if (!res.ok) {
      const err = new Error(`WAHA ${method} ${path} -> ${res.status}: ${String(text).slice(0, 300)}`);
      err.statusCode = res.status;
      throw err;
    }
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * LID -> phone number.
 *
 * WhatsApp increasingly addresses contacts by an opaque LID
 * (`95365487423704@lid`) rather than a phone number. The digits in a LID are
 * NOT a phone number — treating them as one routes replies to a contact that
 * does not exist. Two reliable sources, in order of cost:
 *   1. `_data.Info.SenderAlt` — already in the payload, no round trip.
 *   2. `GET /api/{session}/lids/{lid}` -> { pn } — WAHA's mapping table.
 */
const lidCache = new Map();

async function resolveLidToPhone(lid) {
  const key = String(lid || '');
  if (!key.endsWith('@lid')) return '';
  if (lidCache.has(key)) return lidCache.get(key);
  try {
    const res = await waha(`/api/${encodeURIComponent(cfg.wahaSession)}/lids/${encodeURIComponent(key)}`, { timeoutMs: 10000 });
    const pn = toPhone(res?.pn || '');
    if (pn) lidCache.set(key, pn);
    return pn;
  } catch (err) {
    log('lid lookup failed for', key, err.message);
    return '';
  }
}

/** Real phone (digits) for an inbound message, or a group id unchanged. */
async function senderAddress(p) {
  const from = String(p?.from || '');
  if (from.endsWith('@g.us')) return from; // groups keep their id

  // 1. SenderAlt carries the real JID when addressing is LID-based.
  const alt = toPhone(p?._data?.Info?.SenderAlt || '');
  if (alt) return alt;

  // 2. Fall back to WAHA's LID mapping table.
  if (from.endsWith('@lid')) {
    const mapped = await resolveLidToPhone(from);
    if (mapped) return mapped;
    log('WARN unresolved LID, using raw id:', from);
    return from; // keep the @lid form rather than inventing a fake number
  }

  return toPhone(from);
}

async function wahaSessionStatus() {
  try {
    const s = await waha(`/api/sessions/${encodeURIComponent(cfg.wahaSession)}`);
    return String(s?.status || 'UNKNOWN');
  } catch (err) {
    if (err.statusCode === 404) return 'NOT_FOUND';
    return `ERROR:${err.message.slice(0, 80)}`;
  }
}

// ---------------------------------------------------------- makaug calls ---

/**
 * Link health to makaug. `status: WORKING` on the WAHA side says nothing about
 * whether this service can actually talk to makaug — a wrong bridge token fails
 * silently inside the heartbeat. These three values make that visible on
 * /health instead of only in the log stream.
 */
const link = { lastOkAt: 0, lastErrAt: 0, lastError: null, lastStatus: null };

async function makaug(path, { method = 'GET', body, timeoutMs = 30000 } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`${cfg.makaugUrl}${path}`, {
      method,
      headers: {
        'x-whatsapp-web-bridge-token': cfg.bridgeToken,
        'x-whatsapp-web-bridge-client': cfg.clientId,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ac.signal,
    });
    const text = await res.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    link.lastStatus = res.status;
    if (!res.ok) {
      const err = new Error(`makaug ${method} ${path} -> ${res.status}: ${String(text).slice(0, 300)}`);
      err.statusCode = res.status;
      link.lastErrAt = Date.now();
      link.lastError = err.message.slice(0, 200);
      throw err;
    }
    link.lastOkAt = Date.now();
    link.lastError = null;
    return parsed;
  } catch (err) {
    if (!err.statusCode) {
      link.lastErrAt = Date.now();
      link.lastError = String(err.message || err).slice(0, 200);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * True when the bridge token has been given a real value. Compares against the
 * placeholder shipped in the deploy template; never exposes the value itself.
 */
function bridgeTokenConfigured() {
  const t = cfg.bridgeToken;
  if (!t) return false;
  if (/^PLACEHOLDER/i.test(t)) return false;
  if (/^(changeme|replace_me|todo|xxx+)$/i.test(t)) return false;
  return true;
}

// ------------------------------------------------------------ media proxy --

/**
 * WAHA serves media from /api/files/... behind the API key. makaug must not
 * hold that key, so we hand it a signed URL on this service and stream the
 * bytes through.
 */
function proxiedMediaUrl(wahaMediaUrl) {
  if (!wahaMediaUrl) return '';
  let pathPart = '';
  try {
    pathPart = new URL(wahaMediaUrl).pathname;
  } catch {
    pathPart = String(wahaMediaUrl).startsWith('/') ? String(wahaMediaUrl) : '';
  }
  if (!pathPart.startsWith('/api/files/')) return '';
  if (!cfg.publicUrl) return '';
  const p = Buffer.from(pathPart, 'utf8').toString('base64url');
  return `${cfg.publicUrl}/media?p=${p}&s=${sign(p)}`;
}

async function handleMediaProxy(req, res, url) {
  const p = url.searchParams.get('p') || '';
  const s = url.searchParams.get('s') || '';
  if (!p || !timingSafeEqualStr(s, sign(p))) return json(res, 403, { ok: false, error: 'bad_signature' });

  let pathPart;
  try {
    pathPart = Buffer.from(p, 'base64url').toString('utf8');
  } catch {
    return json(res, 400, { ok: false, error: 'bad_path' });
  }
  if (!pathPart.startsWith('/api/files/') || pathPart.includes('..')) {
    return json(res, 400, { ok: false, error: 'bad_path' });
  }

  const upstream = await fetch(`${cfg.wahaUrl}${pathPart}`, { headers: { 'X-Api-Key': cfg.wahaApiKey } });
  if (!upstream.ok || !upstream.body) {
    return json(res, upstream.status || 502, { ok: false, error: 'media_unavailable' });
  }
  res.writeHead(200, {
    'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream',
    ...(upstream.headers.get('content-length') ? { 'Content-Length': upstream.headers.get('content-length') } : {}),
    'Cache-Control': 'private, max-age=900',
  });
  const reader = upstream.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(Buffer.from(value));
  }
  res.end();
}

// ------------------------------------------------------- inbound (webhook) --

/** WAHA signs the raw body with HMAC-SHA512 when WHATSAPP_HOOK_HMAC_KEY is set. */
function hmacValid(rawBody, headerValue) {
  if (!cfg.hookHmacKey) return true; // not configured: accept
  const expected = crypto.createHmac('sha512', cfg.hookHmacKey).update(rawBody).digest('hex');
  return timingSafeEqualStr(expected, String(headerValue || '').trim());
}

function mediaTypeOf(payload) {
  const mime = String(payload?.media?.mimetype || '').toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime) return 'document';
  return 'text';
}

let lastInboundAt = 0;
let inboundCount = 0;

async function handleWahaEvent(evt) {
  const event = String(evt?.event || '');

  if (event === 'session.status') {
    const status = String(evt?.payload?.status || 'unknown');
    log('session.status ->', status);
    sessionStatusCache = status;
    return { handled: true, kind: 'session.status', status };
  }

  if (event !== 'message') return { handled: false, kind: event || 'unknown' };

  const p = evt.payload || {};
  if (p.fromMe === true) return { handled: false, kind: 'own_message' };

  const from = String(p.from || '');
  // Ignore status broadcasts and newsletters; groups are allowed through.
  if (from.endsWith('@broadcast') || from.endsWith('@newsletter')) {
    return { handled: false, kind: 'broadcast' };
  }

  const phone = await senderAddress(p);
  if (!phone) return { handled: false, kind: 'no_sender' };

  const wahaMedia = p.hasMedia && p.media?.url ? p.media.url : '';
  const mediaUrl = wahaMedia ? proxiedMediaUrl(wahaMedia) : '';
  const mediaType = wahaMedia ? mediaTypeOf(p) : 'text';

  if (wahaMedia && !mediaUrl) {
    log('WARN media present but no proxy url (ADAPTER_PUBLIC_URL unset?) id=', p.id);
  }
  if (p.media?.error) {
    log('WARN waha reported media error id=', p.id, String(p.media.error).slice(0, 160));
  }

  const body = {
    phone,
    body: String(p.body || ''),
    message_id: String(p.id || ''),
    contact_name: String(p.notifyName || p._data?.notifyName || ''),
    created_at: p.timestamp ? new Date(Number(p.timestamp) * 1000).toISOString() : new Date().toISOString(),
    ...(mediaUrl ? { media_url: mediaUrl, media_type: mediaType, media_count: 1 } : {}),
    ...(p.location ? { shared_location: { latitude: p.location.latitude, longitude: p.location.longitude } } : {}),
    metadata: {
      source: 'waha_gows_inbound',
      provider: 'waha',
      engine: 'GOWS',
      waha_session: evt.session || cfg.wahaSession,
      waha_event_id: evt.id || null,
      chat_id: from,
      lid: from.endsWith('@lid') ? from : null,
      addressing_mode: p._data?.Info?.AddressingMode || null,
      push_name: p._data?.Info?.PushName || null,
      mime: p.media?.mimetype || null,
      filename: p.media?.filename || null,
    },
  };

  const result = await makaug('/api/whatsapp/web-bridge/inbound', { method: 'POST', body });
  lastInboundAt = Date.now();
  inboundCount += 1;
  log('inbound ->', phone, mediaType, 'ok=', !!result?.ok, result?.ignored ? '(ignored)' : '');
  return { handled: true, kind: 'message' };
}

// ------------------------------------------------------ outbound (outbox) --

let lastSendAt = 0;
let sentCount = 0;
let failedCount = 0;

function nextSendDelay() {
  const since = Date.now() - lastSendAt;
  const target = cfg.sendMinIntervalMs + Math.floor(Math.random() * (cfg.sendJitterMs + 1));
  return Math.max(0, target - since);
}

async function sendViaWaha(msg) {
  const chatId = toChatId(msg.recipient);
  if (!chatId) throw new Error(`unroutable recipient: ${msg.recipient}`);

  const text = String(msg.text || '').trim();
  const caption = String(msg.caption || text || '').trim();
  const mediaUrl = String(msg.media_url || '').trim();
  const mediaType = String(msg.media_type || 'text').toLowerCase();

  if (mediaUrl) {
    const common = { session: cfg.wahaSession, chatId, file: { url: mediaUrl }, caption: caption || undefined };
    if (mediaType === 'image') return waha('/api/sendImage', { method: 'POST', body: common });
    if (mediaType === 'video') return waha('/api/sendVideo', { method: 'POST', body: common });
    if (mediaType === 'audio' || mediaType === 'voice') {
      return waha('/api/sendVoice', { method: 'POST', body: { session: cfg.wahaSession, chatId, file: { url: mediaUrl } } });
    }
    return waha('/api/sendFile', { method: 'POST', body: common });
  }

  if (!text) throw new Error('empty message body');
  return waha('/api/sendText', { method: 'POST', body: { session: cfg.wahaSession, chatId, text } });
}

async function drainOutbox() {
  const qs = new URLSearchParams({
    client_id: cfg.clientId,
    limit: String(cfg.outboxLimit),
    allowed_sources: cfg.allowedSources,
  });
  const res = await makaug(`/api/whatsapp/web-bridge/outbox?${qs.toString()}`);
  const messages = Array.isArray(res?.data) ? res.data : [];
  if (!messages.length) return 0;

  let done = 0;
  for (const msg of messages) {
    const wait = nextSendDelay();
    if (wait > 0) await sleep(wait);
    try {
      {
        const sent = await sendViaWaha(msg);
        lastSendAt = Date.now();
        await makaug(`/api/whatsapp/web-bridge/outbox/${encodeURIComponent(msg.id)}/sent`, {
          method: 'POST',
          body: { client_id: cfg.clientId, bridge_message_id: sent?.id || sent?._data?.id?._serialized || null },
        });
        sentCount += 1;
        log('sent ->', msg.recipient, msg.media_url ? '(media)' : '(text)');
      }
      done += 1;
    } catch (err) {
      failedCount += 1;
      log('send FAILED', msg.id, err.message);
      try {
        await makaug(`/api/whatsapp/web-bridge/outbox/${encodeURIComponent(msg.id)}/failed`, {
          method: 'POST',
          body: { client_id: cfg.clientId, error: String(err.message).slice(0, 500) },
        });
      } catch (ackErr) {
        log('could not ack failure', msg.id, ackErr.message);
      }
    }
  }
  return done;
}

// ------------------------------------------------------------- heartbeat ---

let sessionStatusCache = 'UNKNOWN';

function bridgeStatusFor(wahaStatus) {
  const s = String(wahaStatus || '').toUpperCase();
  if (s === 'WORKING') return 'online';
  if (s === 'SCAN_QR_CODE' || s === 'PASSKEY_REQUIRED' || s === 'PASSKEY_CONFIRMATION_REQUIRED') return 'waiting_for_login';
  if (s === 'STARTING') return 'starting';
  if (s === 'FAILED' || s.startsWith('ERROR')) return 'degraded';
  if (s === 'STOPPED' || s === 'NOT_FOUND') return 'degraded';
  return 'starting';
}

async function heartbeat() {
  const wahaStatus = await wahaSessionStatus();
  sessionStatusCache = wahaStatus;
  const status = bridgeStatusFor(wahaStatus);
  try {
    await makaug('/api/whatsapp/web-bridge/heartbeat', {
      method: 'POST',
      body: {
        client_id: cfg.clientId,
        operator_name: cfg.operatorName,
        status,
        browser_name: 'WAHA GOWS (whatsmeow)',
        current_url: cfg.wahaUrl,
        stats: { sent: sentCount, failed: failedCount, inbound: inboundCount },
        metadata: {
          transport: 'waha_gows',
          waha_status: wahaStatus,
          waha_session: cfg.wahaSession,
          last_inbound_at: lastInboundAt ? new Date(lastInboundAt).toISOString() : null,
          last_send_at: lastSendAt ? new Date(lastSendAt).toISOString() : null,
          note: 'WAHA GOWS transport (no browser).',
        },
      },
    });
  } catch (err) {
    log('heartbeat failed:', err.message);
  }
}

// ------------------------------------------------------------ http server --

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch {
    return json(res, 400, { ok: false, error: 'bad_url' });
  }

  try {
    if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/')) {
      const stale = lastInboundAt ? Date.now() - lastInboundAt : null;
      const tokenOk = bridgeTokenConfigured();
      const linkOk = link.lastOkAt > 0 && link.lastOkAt >= link.lastErrAt;
      const blockers = [];
      if (!tokenOk) blockers.push('WHATSAPP_WEB_BRIDGE_TOKEN is unset or still the placeholder');
      if (!linkOk && link.lastError) blockers.push(`makaug link failing: ${link.lastError}`);
      if (!cfg.publicUrl) blockers.push('ADAPTER_PUBLIC_URL unset — inbound media will be dropped');

      return json(res, 200, {
        ok: true,
        service: 'makaug-waha-bridge',
        waha_status: sessionStatusCache,
        bridge_status: bridgeStatusFor(sessionStatusCache),
        stats: { sent: sentCount, failed: failedCount, inbound: inboundCount },
        last_inbound_ms_ago: stale,
        // Does this service actually reach makaug? WAHA being WORKING says nothing about that.
        makaug_link: {
          ok: linkOk,
          token_configured: tokenOk,
          last_http_status: link.lastStatus,
          last_ok_ms_ago: link.lastOkAt ? Date.now() - link.lastOkAt : null,
          last_error: link.lastError,
        },
        ready_to_reply: tokenOk && linkOk && sessionStatusCache === 'WORKING',
        blockers,
      });
    }

    if (req.method === 'GET' && url.pathname === '/media') {
      return handleMediaProxy(req, res, url);
    }

    if (req.method === 'POST' && url.pathname === '/waha/webhook') {
      const raw = await readBody(req);
      if (!hmacValid(raw, req.headers['x-webhook-hmac'])) {
        log('rejected webhook: bad hmac');
        return json(res, 401, { ok: false, error: 'bad_hmac' });
      }
      let evt;
      try {
        evt = JSON.parse(raw.toString('utf8'));
      } catch {
        return json(res, 400, { ok: false, error: 'bad_json' });
      }
      // Ack fast; never make WhatsApp wait on makaug.
      json(res, 200, { ok: true });
      handleWahaEvent(evt).catch((err) => log('event handling error:', err.message));
      return undefined;
    }

    return json(res, 404, { ok: false, error: 'not_found' });
  } catch (err) {
    log('request error:', err.message);
    if (!res.headersSent) return json(res, err.statusCode || 500, { ok: false, error: 'server_error' });
    return res.end();
  }
});

server.listen(cfg.port, '0.0.0.0', () => {
  log(`listening on :${cfg.port}`);
  log(`waha=${cfg.wahaUrl} session=${cfg.wahaSession} makaug=${cfg.makaugUrl} client=${cfg.clientId}`);
  log(`outbox poll=${cfg.outboxPollMs}ms send-interval>=${cfg.sendMinIntervalMs}ms (+<=${cfg.sendJitterMs}ms jitter)`);
  if (!cfg.publicUrl) log('WARN ADAPTER_PUBLIC_URL is not set - inbound media will be dropped.');
});

// -------------------------------------------------------------- schedulers --

let outboxBusy = false;
// A misconfigured token would otherwise log an error every poll, burying every
// other line in the log. Back off and log sparsely instead.
let pollFailures = 0;
let lastPollErrorLoggedAt = 0;
let skipPollsUntil = 0;

setInterval(async () => {
  if (outboxBusy || Date.now() < skipPollsUntil) return;
  outboxBusy = true;
  try {
    await drainOutbox();
    if (pollFailures) log(`outbox polling recovered after ${pollFailures} failure(s)`);
    pollFailures = 0;
  } catch (err) {
    pollFailures += 1;
    const now = Date.now();
    // After a few consecutive failures, poll every 30s and log once a minute.
    if (pollFailures >= 3) {
      skipPollsUntil = now + 30000;
      if (now - lastPollErrorLoggedAt >= 60000) {
        lastPollErrorLoggedAt = now;
        log(`outbox poll failing (${pollFailures} consecutive, backing off 30s):`, err.message);
      }
    } else {
      log('outbox poll error:', err.message);
    }
  } finally {
    outboxBusy = false;
  }
}, cfg.outboxPollMs).unref?.();

setInterval(() => { heartbeat().catch(() => {}); }, cfg.heartbeatMs).unref?.();
heartbeat().catch(() => {});

process.on('SIGTERM', () => { log('SIGTERM; closing'); server.close(() => process.exit(0)); });
process.on('unhandledRejection', (err) => log('unhandledRejection:', err?.message || err));
