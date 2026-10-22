'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const express = require('express');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const {
  WIDTH,
  HEIGHT,
  CATEGORIES,
  HOME_ALT,
  normalizeShareLang,
  shareImagePath,
  shareCardAlt,
  shareCardText,
  shareCardKeyForPath,
  usableListingPhoto,
  renderShareCard
} = require('../services/shareCardService');
const { createOgShareRouter, clearOgShareCache } = require('../routes/ogShare');

const LANGS = ['lg', 'sw', 'ac', 'ny', 'rn', 'sm', 'am', 'ar'];
const AGENT_ID = 'b06c4547-9312-415c-90af-3296e88bf53a';
const PROPERTY_ID = '11111111-1111-4111-8111-111111111111';

async function expectCard(buffer) {
  assert.ok(buffer.length > 1000 && buffer.length < 300 * 1024, `card is ${buffer.length} bytes`);
  assert.equal(buffer.subarray(0, 3).toString('hex'), 'ffd8ff');
  const meta = await sharp(buffer).metadata();
  assert.equal(meta.format, 'jpeg');
  assert.equal(meta.width, WIDTH);
  assert.equal(meta.height, HEIGHT);
}

function listen(app) {
  const server = http.createServer(app);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('static card copy is translated in every site language pack', () => {
  const keys = [
    HOME_ALT,
    'Houses, apartments, land, rentals and commercial property',
    'View profile on makaug.com',
    'Rentals',
    'Student rooms',
    'Property value',
    'Mortgage finder',
    'Brokers directory',
    'Discover',
    'Live listings',
    'Price range',
    'Offices, shops and warehouses'
  ];
  for (const lang of LANGS) {
    for (const key of keys) {
      const value = shareCardText(lang, key);
      assert.notEqual(value, key, `${lang} should translate ${key}`);
      if (lang === 'ar') assert.match(value, /[\u0600-\u06FF]/, `${key} should be Arabic`);
      if (lang === 'am') assert.match(value, /[\u1200-\u137F]/, `${key} should be Amharic`);
    }
  }
  assert.equal(shareCardText('en', 'View profile on makaug.com'), 'View profile on makaug.com');
  assert.equal(shareCardAlt('home', 'lg'), shareCardText('lg', HOME_ALT));
  assert.match(shareCardAlt('agent', 'sw', { agentName: 'Jonathan Wassajja' }), /Jonathan Wassajja/);
  assert.equal(shareCardKeyForPath('/mortgage-finder'), 'mortgage');
  assert.equal(shareCardKeyForPath('/discover-ai-chatbot'), 'discover');
  assert.equal(shareCardKeyForPath('/valuation'), 'value');
  assert.equal(shareImagePath('property', PROPERTY_ID, 'lg'), `/og/property/${PROPERTY_ID}.jpg?lang=lg`);
  assert.equal(normalizeShareLang('en-UG'), 'en');
  assert.equal(usableListingPhoto('https://p16-sign.tiktokcdn.com/cover.jpg'), false);
  assert.equal(usableListingPhoto('https://media.makaug.com/listings/house.jpg'), true);
});

test('home, category, agent and property cards are 1200 by 630 and under 300 KB', async () => {
  const home = await renderShareCard({ kind: 'home' });
  await expectCard(home);
  const luganda = await renderShareCard({ kind: 'home', lang: 'lg' });
  await expectCard(luganda);
  assert.notEqual(home.toString('base64'), luganda.toString('base64'));
  for (const key of Object.keys(CATEGORIES)) {
    await expectCard(await renderShareCard({ kind: 'category', category: key }));
  }
  const portrait = await sharp({
    create: { width: 40, height: 40, channels: 3, background: { r: 20, g: 120, b: 60 } }
  }).jpeg().toBuffer();
  const verified = await renderShareCard({
    kind: 'agent',
    agent: {
      name: 'Jonathan Wassajja',
      verified: true,
      districts: 'Kampala, Wakiso',
      liveCount: 5,
      minPrice: 28000000,
      maxPrice: 45000000,
      photo: portrait
    }
  });
  const plain = await renderShareCard({
    kind: 'agent',
    agent: {
      name: 'Jonathan Wassajja',
      verified: false,
      districts: 'Kampala, Wakiso',
      liveCount: 5,
      minPrice: 28000000,
      maxPrice: 45000000,
      photo: portrait
    }
  });
  await expectCard(verified);
  await expectCard(plain);
  assert.notEqual(verified.toString('base64'), plain.toString('base64'));
  const withPhoto = await renderShareCard({
    kind: 'property',
    listing: {
      photo: portrait,
      price: 45000000,
      propertyType: 'House',
      bedrooms: 3,
      area: 'Ntinda',
      district: 'Kampala',
      listing_type: 'sale',
      foundOnline: false
    }
  });
  const landCard = await renderShareCard({ kind: 'category', category: 'land' });
  const withoutPhoto = await renderShareCard({
    kind: 'property',
    listing: { listing_type: 'land', photo: null, price: 120000000, area: 'Kitende', district: 'Wakiso' }
  });
  await expectCard(withPhoto);
  assert.equal(withoutPhoto.toString('base64'), landCard.toString('base64'));
});

test('share-card endpoints cache a JPEG and fall back when the record or photo is missing', async () => {
  clearOgShareCache();
  const portrait = await sharp({
    create: { width: 80, height: 80, channels: 3, background: { r: 12, g: 90, b: 40 } }
  }).jpeg().toBuffer();
  const app = express();
  app.use('/og', createOgShareRouter({
    limiter: (req, res, next) => next(),
    loadAgent: async (id) => (id === AGENT_ID ? {
      name: 'Jonathan Wassajja',
      verified: true,
      districts: 'Kampala',
      liveCount: 5,
      minPrice: 28000000,
      maxPrice: 45000000,
      photo: portrait
    } : null),
    loadProperty: async (id) => {
      if (id === PROPERTY_ID) {
        return {
          listing_type: 'sale',
          propertyType: 'House',
          price: 45000000,
          bedrooms: 4,
          area: 'Ntinda',
          district: 'Kampala',
          foundOnline: false,
          photo: portrait
        };
      }
      if (id === '22222222-2222-4222-8222-222222222222') {
        return {
          listing_type: 'land',
          propertyType: 'Plot',
          price: 120000000,
          area: 'Kitende',
          district: 'Wakiso',
          foundOnline: true,
          photoUrl: 'https://p16-sign.tiktokcdn.com/expiring.jpg'
        };
      }
      return null;
    }
  }));
  const server = await listen(app);
  try {
    const { port } = server.address();
    const paths = [
      '/og/home.jpg',
      '/og/category/sale.jpg',
      '/og/category/rent.jpg',
      '/og/category/land.jpg',
      '/og/category/commercial.jpg',
      '/og/category/short-stay.jpg',
      '/og/category/students.jpg',
      '/og/category/marketplace.jpg',
      '/og/category/value.jpg',
      '/og/category/mortgage.jpg',
      '/og/category/brokers.jpg',
      '/og/category/discover.jpg',
      `/og/agent/${AGENT_ID}.jpg`,
      `/og/property/${PROPERTY_ID}.jpg`,
      '/og/property/22222222-2222-4222-8222-222222222222.jpg',
      '/og/agent/missing-id.jpg',
      '/og/category/not-a-section.jpg'
    ];
    for (const cardPath of paths) {
      const response = await fetch(`http://127.0.0.1:${port}${cardPath}`);
      const body = Buffer.from(await response.arrayBuffer());
      assert.equal(response.status, 200, cardPath);
      assert.equal(response.headers.get('content-type'), 'image/jpeg', cardPath);
      assert.equal(response.headers.get('cache-control'), 'public, max-age=86400, stale-while-revalidate=604800', cardPath);
      await expectCard(body);
    }
    const missingAgent = await fetch(`http://127.0.0.1:${port}/og/agent/missing-id.jpg`);
    const home = await fetch(`http://127.0.0.1:${port}/og/home.jpg`);
    assert.equal(missingAgent.headers.get('x-makaug-og-card'), 'home');
    assert.equal(home.headers.get('x-makaug-og-card'), 'home');
    const noPhoto = await fetch(`http://127.0.0.1:${port}/og/property/22222222-2222-4222-8222-222222222222.jpg`);
    const land = await fetch(`http://127.0.0.1:${port}/og/category/land.jpg`);
    assert.equal(noPhoto.headers.get('x-makaug-og-card'), 'land');
    assert.equal(Buffer.from(await noPhoto.arrayBuffer()).toString('base64'), Buffer.from(await land.arrayBuffer()).toString('base64'));
    const arabic = await fetch(`http://127.0.0.1:${port}/og/category/sale.jpg?lang=ar`);
    await expectCard(Buffer.from(await arabic.arrayBuffer()));
    assert.equal(arabic.headers.get('x-makaug-og-card'), 'sale');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('public pages point og:image, twitter:image and image alt at the matching card', () => {
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.equal((server.match(/\/assets\/og-cover\.jpg/g) || []).length, 2);
  assert.match(html, /property="og:image" content="https:\/\/makaug\.com\/assets\/og-cover\.jpg"/);
  assert.match(html, /property="og:image:width" content="1200"/);
  assert.match(html, /property="og:image:height" content="630"/);
  assert.match(html, new RegExp(`property="og:image:alt" content="${HOME_ALT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  assert.match(html, /name="twitter:image" content="https:\/\/makaug\.com\/assets\/og-cover\.jpg"/);
  assert.doesNotMatch(html, /twitter:site/);
  assert.match(server, /og:image:width/);
  assert.match(server, /og:image:alt/);
  assert.match(server, /shareImagePath\('home'/);
  assert.match(server, /shareImagePath\('property'/);
  assert.match(server, /shareImagePath\('agent'/);
  assert.match(server, /shareImagePath\('short-stay'/);
  assert.match(server, /shareCardKeyForPath\(req\.path\)/);
  assert.match(server, /app\.use\('\/og', createOgShareRouter/);
  for (const key of Object.keys(CATEGORIES)) {
    assert.ok(key);
  }
});
