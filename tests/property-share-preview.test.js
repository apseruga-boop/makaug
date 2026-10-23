'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const sharp = require('sharp');
const { renderShareCard, shareImagePath, propertyShareRevision, formatSharePrice } = require('../services/shareCardService');
const { createOgShareRouter, clearOgShareCache } = require('../routes/ogShare');

const ID = '11111111-1111-4111-8111-111111111111';
const listing = {
  id: ID, title: 'House in Ntinda', listing_type: 'sale', propertyType: 'House',
  price: 45000000, pricePeriod: 'once', bedrooms: 3, area: 'Ntinda', district: 'Kampala',
  photoUrl: 'https://media.makaug.com/properties/house.jpg', foundOnline: true
};

test('share prices retain the same units as the listing', () => {
  assert.equal(formatSharePrice(1500000, 'month'), 'UGX 1.5M/month');
  assert.equal(formatSharePrice(85000000, 'acre'), 'UGX 85M/acre');
  assert.equal(formatSharePrice(500000, 'semester'), 'UGX 500k/semester');
  assert.equal(formatSharePrice(0, 'once'), '');
});

test('a property without a usable photo keeps its own price and title in the card', async () => {
  const original = await renderShareCard({ kind: 'property', listing: { ...listing, photo: null } });
  const repriced = await renderShareCard({ kind: 'property', listing: { ...listing, price: 55000000, photo: null } });
  const renamed = await renderShareCard({ kind: 'property', listing: { ...listing, title: 'House in Kira', photo: null } });
  const corruptPhoto = await renderShareCard({ kind: 'property', listing: { ...listing, photo: Buffer.from('not an image') } });
  assert.ok(!original.equals(repriced), 'the missing-photo card must still show the listing price');
  assert.ok(!original.equals(renamed), 'the missing-photo card must still identify this listing');
  assert.deepEqual(corruptPhoto, original, 'a broken photo keeps the same honest listing details');
  const metadata = await sharp(original).metadata();
  assert.equal(metadata.width, 1200);
  assert.equal(metadata.height, 630);
});

test('the share image URL changes with the listing price or cover, but not tracking parameters', () => {
  const revision = propertyShareRevision(listing);
  const changedPrice = propertyShareRevision({ ...listing, price: 55000000 });
  const changedPhoto = propertyShareRevision({ ...listing, photoUrl: 'https://media.makaug.com/properties/new.jpg' });
  assert.notEqual(revision, changedPrice);
  assert.notEqual(revision, changedPhoto);
  assert.equal(revision, propertyShareRevision({ ...listing, utm_source: 'whatsapp' }));
  const image = new URL(shareImagePath('property', ID, 'lg', revision), 'https://makaug.com');
  assert.equal(image.pathname, `/og/property/${ID}.jpg`);
  assert.equal(image.searchParams.get('lang'), 'lg');
  assert.equal(image.searchParams.get('v'), revision);
});

test('the real image endpoint refreshes a cached listing after its price or photo changes', async () => {
  clearOgShareCache();
  let current = { ...listing };
  const photos = await Promise.all(['#15803d', '#dc2626'].map((background) => sharp({
    create: { width: 80, height: 80, channels: 3, background }
  }).jpeg().toBuffer()));
  let reads = 0;
  const app = express();
  app.use('/og', createOgShareRouter({
    limiter: (_req, _res, next) => next(),
    loadProperty: async () => current,
    fetchPhoto: async (url) => { reads += 1; return photos[url.endsWith('new.jpg') ? 1 : 0]; }
  }));
  const server = await new Promise((resolve) => {
    const handle = app.listen(0, '127.0.0.1', () => resolve(handle));
  });
  try {
    const url = `http://127.0.0.1:${server.address().port}/og/property/${ID}.jpg`;
    const get = async () => Buffer.from(await (await fetch(url)).arrayBuffer());
    const first = await get();
    assert.deepEqual(await get(), first);
    assert.equal(reads, 1, 'a cache hit must not fetch the same photo again');
    current = { ...current, price: 55000000 };
    assert.ok(!(await get()).equals(first), 'a changed price must render a new card');
    const beforePhoto = await get();
    current = { ...current, photoUrl: 'https://media.makaug.com/properties/new.jpg' };
    assert.ok(!(await get()).equals(beforePhoto), 'a changed cover must render a new card');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('a temporary photo failure preserves the listing and retries instead of caching a generic card', async () => {
  clearOgShareCache();
  let available = false;
  const photo = await sharp({ create: { width: 80, height: 80, channels: 3, background: '#15803d' } }).jpeg().toBuffer();
  const app = express();
  app.use('/og', createOgShareRouter({
    limiter: (_req, _res, next) => next(),
    loadProperty: async () => listing,
    fetchPhoto: async () => { if (!available) throw new Error('temporary photo timeout'); return photo; }
  }));
  const server = await new Promise((resolve) => {
    const handle = app.listen(0, '127.0.0.1', () => resolve(handle));
  });
  try {
    const url = `http://127.0.0.1:${server.address().port}/og/property/${ID}.jpg`;
    const missing = await fetch(url);
    assert.equal(missing.headers.get('cache-control'), 'public, max-age=60, must-revalidate');
    const before = Buffer.from(await missing.arrayBuffer());
    const expected = await renderShareCard({ kind: 'property', listing: { ...listing, photo: null } });
    assert.ok(before.equals(expected), 'the fallback retains this listing, including its price');
    available = true;
    const recovered = await fetch(url);
    assert.equal(recovered.headers.get('x-makaug-og-card'), 'property');
    assert.ok(!before.equals(Buffer.from(await recovered.arrayBuffer())), 'the photo must reappear as soon as the fetch recovers');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('a JPEG with readable headers but broken pixels is retried after its source recovers', async () => {
  clearOgShareCache();
  const photo = await sharp({ create: { width: 80, height: 80, channels: 3, background: '#15803d' } }).jpeg().toBuffer();
  const truncated = photo.subarray(0, 300);
  assert.equal((await sharp(truncated).metadata()).format, 'jpeg');
  await assert.rejects(() => sharp(truncated).stats());
  let available = false;
  const originalFetch = global.fetch;
  global.fetch = (url, options) => url === listing.photoUrl
    ? Promise.resolve(new Response(available ? photo : truncated, { headers: { 'Content-Type': 'image/jpeg' } }))
    : originalFetch(url, options);
  const app = express();
  app.use('/og', createOgShareRouter({ limiter: (_req, _res, next) => next(), loadProperty: async () => listing }));
  const server = await new Promise((resolve) => {
    const handle = app.listen(0, '127.0.0.1', () => resolve(handle));
  });
  try {
    const url = `http://127.0.0.1:${server.address().port}/og/property/${ID}.jpg`;
    const missing = await fetch(url);
    assert.equal(missing.headers.get('cache-control'), 'public, max-age=60, must-revalidate');
    const before = Buffer.from(await missing.arrayBuffer());
    available = true;
    const recovered = await fetch(url);
    assert.equal(recovered.headers.get('cache-control'), 'public, max-age=86400, stale-while-revalidate=604800');
    assert.ok(!before.equals(Buffer.from(await recovered.arrayBuffer())));
  } finally {
    global.fetch = originalFetch;
    await new Promise((resolve) => server.close(resolve));
  }
});
