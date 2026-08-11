'use strict';

const http = require('http');
const path = require('path');
const { fork } = require('child_process');

const port = parseInt(process.env.PORT || '10000', 10);
const appPort = port + 1;
const host = '0.0.0.0';
let appReady = false;
let shuttingDown = false;
let appProcess = null;

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'expect',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade'
]);

function proxyHeaders(headers = {}, { request = false } = {}) {
  const forwarded = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase()) && value !== undefined) {
      forwarded[name] = value;
    }
  }
  if (request) forwarded.host = `127.0.0.1:${appPort}`;
  return forwarded;
}

function jsonResponse(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.end(JSON.stringify(payload));
}

function proxyToApp(req, res) {
  const method = String(req.method || 'GET').toUpperCase();
  const headers = proxyHeaders(req.headers, { request: true });
  if (method === 'GET' || method === 'HEAD') delete headers['content-length'];
  const proxyRequest = http.request({
    hostname: '127.0.0.1',
    port: appPort,
    path: req.url,
    method,
    headers
  }, (proxyResponse) => {
    res.writeHead(proxyResponse.statusCode || 502, proxyHeaders(proxyResponse.headers));
    proxyResponse.pipe(res);
  });
  proxyRequest.on('error', (error) => {
    if (res.headersSent) return res.destroy(error);
    return jsonResponse(res, 502, {
      ok: false,
      error: 'application_unavailable',
      country_code: process.env.COUNTRY_CODE || 'ZA'
    });
  });
  if (method === 'GET' || method === 'HEAD') {
    proxyRequest.end();
  } else {
    req.pipe(proxyRequest);
  }
}

const earlyHttpServer = http.createServer((req, res) => {
  if (String(req.url || '').split('?')[0] === '/healthz') {
    return jsonResponse(res, 200, {
      ok: true,
      service: process.env.RENDER_SERVICE_NAME || 'seshaikhaya',
      country_code: process.env.COUNTRY_CODE || 'ZA',
      ready: appReady
    });
  }
  if (!appReady) {
    return jsonResponse(res, 503, {
      ok: false,
      error: 'service_starting',
      country_code: process.env.COUNTRY_CODE || 'ZA'
    });
  }
  return proxyToApp(req, res);
});

function waitForAppReadiness() {
  const request = http.get({
    hostname: '127.0.0.1',
    port: appPort,
    path: '/healthz',
    timeout: 1000
  }, (response) => {
    let body = '';
    response.setEncoding('utf8');
    response.on('data', (chunk) => { body += chunk; });
    response.on('end', () => {
      try {
        appReady = response.statusCode === 200 && JSON.parse(body).ready === true;
      } catch {
        appReady = false;
      }
      if (appReady) {
        console.log('Render application process ready behind liveness proxy', { port: appPort });
      } else if (!shuttingDown) {
        setTimeout(waitForAppReadiness, 250).unref?.();
      }
    });
  });
  request.on('timeout', () => request.destroy());
  request.on('error', () => {
    if (!shuttingDown) setTimeout(waitForAppReadiness, 250).unref?.();
  });
}

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  appProcess?.kill(signal);
  earlyHttpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref?.();
}

earlyHttpServer.on('error', (error) => {
  console.error('Render bootstrap HTTP server failed', error);
  process.exit(1);
});

earlyHttpServer.listen(port, host, () => {
  const address = earlyHttpServer.address();
  console.log('Render bootstrap liveness endpoint accepting traffic', {
    host: typeof address === 'object' && address ? address.address : host,
    port: typeof address === 'object' && address ? address.port : port,
    family: typeof address === 'object' && address ? address.family : null
  });

  appProcess = fork(path.join(__dirname, '..', 'server.js'), [], {
    env: { ...process.env, PORT: String(appPort) },
    stdio: ['inherit', 'inherit', 'inherit', 'ipc']
  });
  appProcess.on('exit', (code, signal) => {
    appReady = false;
    if (shuttingDown) return;
    console.error('Render application process exited', { code, signal });
    process.exit(code || 1);
  });
  waitForAppReadiness();
});

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
