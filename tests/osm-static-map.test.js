'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const sharp = require('sharp');
const {
  latToTileY,
  lonToTileX,
  osmStaticMapBuffer,
  stitchStaticMap,
  tileRange
} = require('../services/osmStaticMap');

test('tile math keeps the Naguru pin inside a modest tile window', () => {
  const zoom = 16;
  const lat = 0.3402;
  const lng = 32.6076;
  const x = lonToTileX(lng, zoom);
  const y = latToTileY(lat, zoom);
  assert.ok(x > 38700 && x < 38710);
  assert.ok(y > 32700 && y < 32720);
  const range = tileRange(lat, lng, zoom, 1200, 680);
  const tiles = (range.tileX1 - range.tileX0 + 1) * (range.tileY1 - range.tileY0 + 1);
  assert.ok(tiles >= 8 && tiles <= 24);
  assert.ok(range.left < x * 256 && x * 256 < range.left + 1200);
  assert.ok(range.top < y * 256 && y * 256 < range.top + 680);
});

test('stitch composes tile buffers into a png with the requested size', async () => {
  const tile = await sharp({ create: { width: 256, height: 256, channels: 3, background: '#8fbc8f' } }).png().toBuffer();
  const png = await stitchStaticMap({
    lat: 0.3402,
    lng: 32.6076,
    zoom: 16,
    width: 480,
    height: 280,
    fetchTile: async () => tile
  });
  assert.ok(png);
  assert.equal(png.subarray(0, 4).toString('hex'), '89504e47');
  const meta = await sharp(png).metadata();
  assert.equal(meta.width, 480);
  assert.equal(meta.height, 280);
  const { channels } = await sharp(png).stats();
  const varies = channels.some((channel) => channel.min !== channel.max);
  assert.equal(varies, true);
});

test('unit tests do not call the tile server', async () => {
  assert.ok(process.env.NODE_TEST_CONTEXT);
  let calls = 0;
  const saved = global.fetch;
  global.fetch = async () => {
    calls += 1;
    throw new Error('no network');
  };
  try {
    assert.equal(await osmStaticMapBuffer({ latitude: 0.3402, longitude: 32.6076 }), null);
    assert.equal(calls, 0);
  } finally {
    global.fetch = saved;
  }
});
