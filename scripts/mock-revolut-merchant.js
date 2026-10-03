#!/usr/bin/env node
// A tiny stand-in for the Revolut Merchant API, for local end-to-end tests only.
// POST /api/orders, GET /api/orders/:id, GET|POST /api/1.0/webhooks, POST /__complete/:id
const http = require('http');
const crypto = require('crypto');

const port = Number(process.env.PORT || 4555);
const orders = new Map();
const webhooks = [];

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    const body = raw ? JSON.parse(raw) : {};
    const auth = req.headers.authorization || '';
    if (!req.url.startsWith('/__') && !req.url.startsWith('/checkout') && auth !== 'Bearer sk_mock_secret') return send(res, 401, { message: 'bad key' });
    if (req.method === 'POST' && req.url === '/api/orders') {
      if (!req.headers['revolut-api-version']) return send(res, 400, { message: 'version header missing' });
      if (!Number.isInteger(body.amount) || !body.currency) return send(res, 422, { message: 'amount/currency' });
      const id = crypto.randomUUID();
      const order = { id, token: crypto.randomUUID(), state: 'pending', amount: body.amount, currency: body.currency, description: body.description,
        merchant_order_data: body.merchant_order_data, redirect_url: body.redirect_url, checkout_url: `http://127.0.0.1:${port}/checkout/${id}`, created_at: new Date().toISOString() };
      orders.set(id, order);
      return send(res, 201, order);
    }
    const m = req.url.match(/^\/api\/orders\/([^/]+)$/);
    if (req.method === 'GET' && m) return orders.has(m[1]) ? send(res, 200, orders.get(m[1])) : send(res, 404, { message: 'not found' });
    const c = req.url.match(/^\/__complete\/([^/]+)$/);
    if (req.method === 'POST' && c && orders.has(c[1])) {
      Object.assign(orders.get(c[1]), { state: 'completed', completed_at: new Date().toISOString() });
      return send(res, 200, { ok: true });
    }
    if (req.url === '/api/1.0/webhooks' && req.method === 'GET') return send(res, 200, webhooks.map(({ signing_secret, ...w }) => w));
    if (req.url === '/api/1.0/webhooks' && req.method === 'POST') {
      const hook = { id: crypto.randomUUID(), url: body.url, events: body.events, signing_secret: 'whsec_mocksecret' };
      webhooks.push(hook);
      return send(res, 201, hook);
    }
    const w = req.url.match(/^\/api\/1\.0\/webhooks\/([^/]+)$/);
    if (w) return send(res, 200, webhooks.find((h) => h.id === w[1]) || {});
    return send(res, 404, { message: 'no route' });
  });
}).listen(port, '127.0.0.1', () => console.log(`mock revolut on ${port}`));
