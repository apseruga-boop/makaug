'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');

const db = require('../config/database');
const agents = require('../routes/agents');

const UNKNOWN = '11111111-1111-4111-8111-111111111111';
const LISTING = '22222222-2222-4222-8222-222222222222';

function app() {
  const server = express();
  server.use(express.json());
  server.use('/api/agents', agents);
  server.use((error, _req, res, _next) => {
    res.status(error.status || 500).json({ ok: false, error: error.message || 'failed' });
  });
  return server;
}

test('a non-UUID agent id is 400 on the booking routes and is not queried', async () => {
  const original = db.query;
  let calls = 0;
  db.query = async () => {
    calls += 1;
    return { rows: [] };
  };
  try {
    const server = app();
    for (const path of [
      '/api/agents/null/booking-options',
      '/api/agents/nope/booking-options',
      '/api/agents/null/listing-booking',
      '/api/agents/null/listings',
      '/api/agents/null'
    ]) {
      const response = await request(server).get(path);
      assert.equal(response.status, 400, path);
      assert.equal(response.body.ok, false);
      assert.equal(response.body.error, 'Invalid agent id');
    }
    const posted = await request(server).post('/api/agents/null/bookings').send({});
    assert.equal(posted.status, 400);
    assert.equal(posted.body.error, 'Invalid agent id');
    assert.equal(calls, 0);
  } finally {
    db.query = original;
  }
});

test('an unknown agent UUID is 404 JSON on the booking routes', async () => {
  const original = db.query;
  const calls = [];
  db.query = async (sql) => {
    calls.push(sql);
    return { rows: [] };
  };
  try {
    const server = app();
    const options = await request(server).get(`/api/agents/${UNKNOWN}/booking-options`);
    assert.equal(options.status, 404);
    assert.equal(options.body.ok, false);
    assert.equal(options.body.error, 'Agent not found');

    const listing = await request(server).get(`/api/agents/${UNKNOWN}/listing-booking?listing_id=${LISTING}`);
    assert.equal(listing.status, 404);
    assert.equal(listing.body.error, 'Agent not found');

    const posted = await request(server).post(`/api/agents/${UNKNOWN}/bookings`).send({});
    assert.equal(posted.status, 404);
    assert.equal(posted.body.error, 'Agent not found');

    assert.ok(calls.length >= 1);
    assert.ok(calls.every((sql) => /FROM agents/i.test(sql)));
  } finally {
    db.query = original;
  }
});
