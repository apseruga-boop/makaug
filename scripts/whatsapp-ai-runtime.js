#!/usr/bin/env node
'use strict';

const http = require('http');
const https = require('https');
const crypto = require('crypto');

const PORT = Math.max(1, Number(process.env.PORT || 10000));
const HOST = String(process.env.HOST || '0.0.0.0');
const OPENAI_API_KEY = String(process.env.OPENAI_API_KEY || '').trim();
const OPENAI_PROJECT = String(process.env.OPENAI_PROJECT || '').trim();
const OPENAI_ORGANIZATION = String(process.env.OPENAI_ORGANIZATION || '').trim();
const RUNTIME_TOKEN = String(process.env.WHATSAPP_AI_RUNTIME_TOKEN || '').trim();
const OPENAI_ORIGIN = String(process.env.OPENAI_API_ORIGIN || 'https://api.openai.com').replace(/\/+$/, '');
const MAX_REQUEST_BYTES = Math.max(1_000_000, Number(process.env.WHATSAPP_AI_MAX_REQUEST_BYTES || 20_000_000));
const UPSTREAM_TIMEOUT_MS = Math.max(5_000, Number(process.env.WHATSAPP_AI_UPSTREAM_TIMEOUT_MS || 45_000));
const WORKER_FRESH_MS = Math.max(
  30_000,
  Number(process.env.WHATSAPP_AI_WORKER_FRESH_SECONDS || 180) * 1000
);
const RELEASE_MARKER = 'makaug-always-on-whatsapp-runtime-20260814';

let lastWorkerHeartbeat = null;

function json(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function bearerToken(req) {
  return String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i)?.[1] || '';
}

function authorized(req) {
  return Boolean(RUNTIME_TOKEN) && safeEqual(bearerToken(req), RUNTIME_TOKEN);
}

function workerStatus(now = Date.now()) {
  const lastSeenAt = lastWorkerHeartbeat?.received_at || 0;
  const ageMs = lastSeenAt ? now - lastSeenAt : null;
  const fresh = Number.isFinite(ageMs) && ageMs <= WORKER_FRESH_MS;
  return {
    fresh,
    age_ms: ageMs,
    client_id: lastWorkerHeartbeat?.client_id || null,
    status: lastWorkerHeartbeat?.status || 'unknown',
    reported_at: lastWorkerHeartbeat?.reported_at || null,
    received_at: lastSeenAt ? new Date(lastSeenAt).toISOString() : null
  };
}

async function readRequestBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_REQUEST_BYTES) {
      const error = new Error('request_too_large');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function recordHeartbeat(req, res) {
  if (!authorized(req)) return json(res, 401, { ok: false, error: 'unauthorized' });
  let payload = {};
  try {
    const raw = await readRequestBody(req);
    payload = raw.length ? JSON.parse(raw.toString('utf8')) : {};
  } catch (error) {
    return json(res, error.statusCode || 400, { ok: false, error: 'invalid_heartbeat_payload' });
  }
  lastWorkerHeartbeat = {
    client_id: String(payload.client_id || '').slice(0, 160),
    status: String(payload.status || 'unknown').slice(0, 80),
    reported_at: payload.reported_at || null,
    received_at: Date.now()
  };
  return json(res, 200, { ok: true, marker: RELEASE_MARKER });
}

async function proxyOpenAi(req, res) {
  if (!authorized(req)) return json(res, 401, { ok: false, error: 'unauthorized' });
  if (!OPENAI_API_KEY) return json(res, 503, { ok: false, error: 'openai_not_configured' });

  let body;
  try {
    body = await readRequestBody(req);
  } catch (error) {
    return json(res, error.statusCode || 400, { ok: false, error: error.message || 'invalid_request' });
  }

  const target = new URL(req.url, OPENAI_ORIGIN);
  const headers = {
    Authorization: `Bearer ${OPENAI_API_KEY}`,
    Accept: req.headers.accept || 'application/json',
    'Content-Type': req.headers['content-type'] || 'application/json',
    'Content-Length': body.length,
    'User-Agent': 'makaug-whatsapp-ai-runtime/1.0'
  };
  if (OPENAI_PROJECT) headers['OpenAI-Project'] = OPENAI_PROJECT;
  if (OPENAI_ORGANIZATION) headers['OpenAI-Organization'] = OPENAI_ORGANIZATION;

  const upstream = https.request(target, {
    method: req.method,
    headers,
    timeout: UPSTREAM_TIMEOUT_MS
  }, (upstreamRes) => {
    res.writeHead(upstreamRes.statusCode || 502, {
      'Content-Type': upstreamRes.headers['content-type'] || 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...(upstreamRes.headers['x-request-id'] ? { 'x-request-id': upstreamRes.headers['x-request-id'] } : {})
    });
    upstreamRes.pipe(res);
  });

  upstream.on('timeout', () => upstream.destroy(new Error('openai_upstream_timeout')));
  upstream.on('error', (error) => {
    if (res.headersSent) return res.destroy(error);
    return json(res, 502, { ok: false, error: 'openai_upstream_unavailable' });
  });
  upstream.end(body);
}

async function handler(req, res) {
  const path = new URL(req.url, 'http://runtime.local').pathname;
  if (req.method === 'GET' && path === '/health') {
    return json(res, 200, {
      ok: true,
      service: 'makaug-whatsapp-ai-runtime',
      country_code: 'UG',
      marker: RELEASE_MARKER
    });
  }
  if (req.method === 'GET' && path === '/ready') {
    const worker = workerStatus();
    const ready = Boolean(OPENAI_API_KEY && RUNTIME_TOKEN && worker.fresh && worker.status === 'online');
    return json(res, ready ? 200 : 503, {
      ok: ready,
      service: 'makaug-whatsapp-ai-runtime',
      marker: RELEASE_MARKER,
      openai_configured: Boolean(OPENAI_API_KEY),
      runtime_token_configured: Boolean(RUNTIME_TOKEN),
      worker
    });
  }
  if (req.method === 'POST' && path === '/heartbeat') return recordHeartbeat(req, res);
  if (path.startsWith('/v1/')) return proxyOpenAi(req, res);
  return json(res, 404, { ok: false, error: 'not_found' });
}

if (require.main === module) {
  http.createServer((req, res) => {
    Promise.resolve(handler(req, res)).catch(() => {
      if (!res.headersSent) json(res, 500, { ok: false, error: 'runtime_error' });
      else res.end();
    });
  }).listen(PORT, HOST, () => {
    // eslint-disable-next-line no-console
    console.log(`${new Date().toISOString()} [whatsapp-ai-runtime] listening on ${HOST}:${PORT} marker=${RELEASE_MARKER}`);
  });
}

module.exports = {
  RELEASE_MARKER,
  authorized,
  handler,
  safeEqual,
  workerStatus
};
