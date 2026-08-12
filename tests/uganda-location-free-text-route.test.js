'use strict';

process.env.COUNTRY_CODE = 'UG';

const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const request = require('supertest');
const propertiesRouter = require('../routes/properties');

const app = express();
app.use('/api/properties', propertiesRouter);

test('resolve route auto-resolves only complete exact aliases', async () => {
  for (const [query, key] of [['Nalumunye', 'wakiso:nalumunye'], ['Kitiko', 'wakiso:kitiko']]) {
    const response = await request(app).get('/api/properties/locations/resolve').query({ q: query });
    assert.equal(response.status, 200, query);
    assert.equal(response.body.data?.canonical_location_id, key, query);
    assert.equal(response.body.meta?.status, 'matched', query);
    assert.equal(response.body.meta?.approval_blocked, false, query);
  }
});

test('resolve route returns explicit suggestions while keeping non-exact input blocked', async () => {
  const cases = [
    ['Ssenge Nansana', 'wakiso:ssenge', 'free_text_exact'],
    ['Bukasa Muyenga', 'kampala:bukasa', 'free_text_exact'],
    ['Nakaseero', 'kampala:nakasero', 'fuzzy'],
    ['Kyaliwajala', 'wakiso:kyaliwajjala', 'fuzzy']
  ];
  for (const [query, key, match] of cases) {
    const response = await request(app).get('/api/properties/locations/resolve').query({ q: query });
    assert.equal(response.status, 200, query);
    assert.equal(response.body.data, null, query);
    assert.equal(response.body.meta?.status, 'suggestion_required', query);
    assert.equal(response.body.meta?.approval_blocked, true, query);
    assert.equal(response.body.meta?.candidates?.[0]?.canonical_location_id, key, query);
    assert.equal(response.body.meta?.candidates?.[0]?.match, match, query);
    assert.equal(response.body.meta?.candidates?.[0]?.auto_resolvable, false, query);
  }
});

test('resolve route leaves genuine junk blocked without a candidate', async () => {
  const response = await request(app).get('/api/properties/locations/resolve').query({ q: 'Zzxqfakeplace' });
  assert.equal(response.status, 200);
  assert.equal(response.body.data, null);
  assert.equal(response.body.meta?.status, 'unmatched');
  assert.equal(response.body.meta?.approval_blocked, true);
  assert.deepEqual(response.body.meta?.candidates, []);
});
