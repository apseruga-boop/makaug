'use strict';
/**
 * Multi-session routing for the WAHA bridge.
 *
 * The bridge was built for one WAHA session (MakaUG). Neondaku (DRC) runs a
 * second session on the same WAHA server. Rather than threading a tenant
 * through every function (and risking MakaUG's path), the bridge spawns a copy
 * of itself as a child process configured for the Neondaku session, and the
 * parent hands it every webhook whose `session` matches. Everything else takes
 * the original, unchanged path.
 *
 * With the NEONDAKU_* env vars unset, nothing here runs: no child, no routing.
 */
const http = require('http');
const { spawn } = require('child_process');

function neondakuTenantFromEnv(env = process.env) {
  if (env.BRIDGE_IS_CHILD) return null; // the child never spawns grandchildren
  const session = String(env.NEONDAKU_WAHA_SESSION || '').trim();
  const baseUrl = String(env.NEONDAKU_BASE_URL || '').trim().replace(/\/+$/, '');
  const token = String(env.NEONDAKU_WEB_BRIDGE_TOKEN || '').trim();
  if (!session || !baseUrl || !token) return null;
  const primarySession = String(env.WAHA_SESSION || 'default');
  if (session === primarySession) {
    throw new Error('NEONDAKU_WAHA_SESSION must differ from WAHA_SESSION');
  }
  return {
    name: 'neondaku',
    session,
    baseUrl,
    token,
    port: Number(env.NEONDAKU_CHILD_PORT || 10001),
    clientId: String(env.NEONDAKU_BRIDGE_CLIENT_ID || 'neondaku-waha-gows'),
  };
}

/** 'child' when the event belongs to the tenant session, else 'primary'. */
function routeFor(evt, tenant) {
  if (!tenant || !evt || typeof evt !== 'object') return 'primary';
  return String(evt.session || '') === tenant.session ? 'child' : 'primary';
}

/** Env for the child: same WAHA/HMAC/media settings, tenant target + token. */
function childEnv(tenant, env = process.env) {
  const out = { ...env };
  for (const k of Object.keys(out)) if (k.startsWith('NEONDAKU_')) delete out[k];
  out.BRIDGE_IS_CHILD = '1';
  out.PORT = String(tenant.port);
  out.WAHA_SESSION = tenant.session;
  out.MAKAUG_BASE_URL = tenant.baseUrl;
  out.WHATSAPP_WEB_BRIDGE_TOKEN = tenant.token;
  out.BRIDGE_CLIENT_ID = tenant.clientId;
  out.BRIDGE_OPERATOR_NAME = 'WAHA GOWS Bridge (Neondaku)';
  // Media links must still point at the public parent URL; keep the parent's
  // media secret so the parent's /media proxy can verify the child's links.
  out.ADAPTER_MEDIA_SECRET = env.ADAPTER_MEDIA_SECRET || env.WHATSAPP_WEB_BRIDGE_TOKEN || '';
  return out;
}

function startChild(tenant, scriptPath, log) {
  let stopped = false;
  let backoff = 1000;
  let proc = null;
  const run = () => {
    if (stopped) return;
    proc = spawn(process.execPath, [scriptPath], { env: childEnv(tenant), stdio: ['ignore', 'inherit', 'inherit'] });
    const started = Date.now();
    proc.on('exit', (code) => {
      if (stopped) return;
      if (Date.now() - started > 60000) backoff = 1000;
      log(`[${tenant.name}] child exited (${code}); restarting in ${backoff}ms`);
      setTimeout(run, backoff).unref?.();
      backoff = Math.min(backoff * 2, 60000);
    });
  };
  run();
  return { stop() { stopped = true; if (proc) proc.kill('SIGTERM'); } };
}

function localRequest(port, { method = 'GET', path, headers = {}, body, timeoutMs = 3000 }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers, timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/** Hand the raw (already HMAC-checked) webhook body to the child unchanged. */
function forwardToChild(tenant, raw, hmacHeader) {
  const headers = { 'content-type': 'application/json', 'content-length': Buffer.byteLength(raw) };
  if (hmacHeader) headers['x-webhook-hmac'] = hmacHeader;
  return localRequest(tenant.port, { method: 'POST', path: '/waha/webhook', headers, body: raw, timeoutMs: 10000 });
}

async function childHealth(tenant) {
  try {
    const r = await localRequest(tenant.port, { path: '/health', timeoutMs: 1500 });
    return JSON.parse(r.body);
  } catch (err) {
    return { ok: false, error: `child unreachable: ${err.message}` };
  }
}

module.exports = { neondakuTenantFromEnv, routeFor, childEnv, startChild, forwardToChild, childHealth };
