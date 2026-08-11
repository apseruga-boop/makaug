'use strict';

const http = require('http');

const port = parseInt(process.env.PORT || '10000', 10);
const host = '0.0.0.0';

const earlyHttpServer = http.createServer((req, res) => {
  const appHandler = global.__MAKAUG_RENDER_HTTP_HANDLER__;
  if (typeof appHandler === 'function') return appHandler(req, res);

  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (String(req.url || '').split('?')[0] === '/healthz') {
    res.statusCode = 200;
    return res.end(JSON.stringify({
      ok: true,
      service: process.env.RENDER_SERVICE_NAME || 'seshaikhaya',
      country_code: process.env.COUNTRY_CODE || 'ZA',
      ready: false
    }));
  }

  res.statusCode = 503;
  return res.end(JSON.stringify({
    ok: false,
    error: 'service_starting',
    country_code: process.env.COUNTRY_CODE || 'ZA'
  }));
});

global.__MAKAUG_RENDER_HTTP_SERVER__ = earlyHttpServer;

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
  require('../server');
});
