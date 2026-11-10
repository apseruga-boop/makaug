'use strict';

// The off-plan brochure used to call Google's paid Static Maps API. That call
// now returns nothing unless paid Google flags are set on purpose, so the
// location page drew a grey box. This stitches the same OpenStreetMap raster
// tiles the site's Leaflet maps use (https://tile.openstreetmap.org) into one
// PNG, with a pin and the required credit. No API key.

const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { Resvg } = require('@resvg/resvg-js');

const TILE_SIZE = 256;
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTRIBUTION = '© OpenStreetMap contributors';
const USER_AGENT = 'makaug.com/off-plan brochure (https://makaug.com; info@makaug.com)';
const FONT_FILE = path.join(__dirname, '..', 'assets', 'fonts', 'share-card', 'PlusJakartaSans-Regular.ttf');
const CACHE_DIR = path.join(os.tmpdir(), 'makaug-osm-tiles');
const memoryTiles = new Map();
const memoryMaps = new Map();

function lonToTileX(lng, zoom) {
  return ((Number(lng) + 180) / 360) * 2 ** zoom;
}

function latToTileY(lat, zoom) {
  const radians = Number(lat) * Math.PI / 180;
  const mercator = Math.log(Math.tan(radians) + 1 / Math.cos(radians));
  return (1 - mercator / Math.PI) / 2 * 2 ** zoom;
}

function wrapTileX(x, zoom) {
  const n = 2 ** zoom;
  return ((x % n) + n) % n;
}

function tileRange(lat, lng, zoom, width, height) {
  const centerX = lonToTileX(lng, zoom) * TILE_SIZE;
  const centerY = latToTileY(lat, zoom) * TILE_SIZE;
  const left = centerX - width / 2;
  const top = centerY - height / 2;
  const tileX0 = Math.floor(left / TILE_SIZE);
  const tileY0 = Math.floor(top / TILE_SIZE);
  const tileX1 = Math.floor((left + width - 1) / TILE_SIZE);
  const tileY1 = Math.floor((top + height - 1) / TILE_SIZE);
  return { centerX, centerY, left, top, tileX0, tileY0, tileX1, tileY1 };
}

function svgPng(svg, width, height) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: {
      fontFiles: fs.existsSync(FONT_FILE) ? [FONT_FILE] : [],
      loadSystemFonts: false,
      defaultFontFamily: 'Plus Jakarta Sans'
    }
  });
  const png = Buffer.from(resvg.render().asPng());
  return height ? sharp(png).resize(width, height, { fit: 'fill' }).png().toBuffer() : png;
}

function pinSvg() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="46" height="64" viewBox="0 0 46 64" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="23" cy="58" rx="8" ry="3.2" fill="#182230" fill-opacity="0.28"/>
  <path d="M23 2c-11.2 0-20 8.7-20 19.6C3 35.2 23 58 23 58s20-22.8 20-36.4C43 10.7 34.2 2 23 2z" fill="#117a3d" stroke="#ffffff" stroke-width="2.4"/>
  <circle cx="23" cy="21.5" r="7.2" fill="#e9a321"/>
</svg>`;
}

function creditSvg(width) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="26" viewBox="0 0 ${width} 26" xmlns="http://www.w3.org/2000/svg">
  <rect width="${width}" height="26" fill="#ffffff" fill-opacity="0.92"/>
  <text x="${width - 10}" y="17" text-anchor="end" font-family="Plus Jakarta Sans" font-size="12" fill="#1c2430">${OSM_ATTRIBUTION}</text>
</svg>`;
}

function isPng(bytes) {
  return Buffer.isBuffer(bytes) && bytes.length > 40 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
}

async function readCachedTile(zoom, x, y) {
  const key = `${zoom}/${x}/${y}`;
  if (memoryTiles.has(key)) return memoryTiles.get(key);
  try {
    const bytes = await fs.promises.readFile(path.join(CACHE_DIR, `${zoom}-${x}-${y}.png`));
    if (!isPng(bytes)) return null;
    memoryTiles.set(key, bytes);
    return bytes;
  } catch (_error) {
    return null;
  }
}

async function rememberTile(zoom, x, y, bytes) {
  const key = `${zoom}/${x}/${y}`;
  memoryTiles.set(key, bytes);
  await fs.promises.mkdir(CACHE_DIR, { recursive: true }).catch(() => {});
  await fs.promises.writeFile(path.join(CACHE_DIR, `${zoom}-${x}-${y}.png`), bytes).catch(() => {});
}

async function fetchOsmTile(zoom, x, y, fetchImpl, options = {}) {
  const wrappedX = wrapTileX(x, zoom);
  const n = 2 ** zoom;
  if (y < 0 || y >= n) return null;
  if (!options.bypassCache) {
    const cached = await readCachedTile(zoom, wrappedX, y);
    if (cached) return cached;
  }
  const url = TILE_URL.replace('{z}', String(zoom)).replace('{x}', String(wrappedX)).replace('{y}', String(y));
  const load = () => fetchImpl(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Referer: 'https://makaug.com/',
      Accept: 'image/png,image/*;q=0.8'
    },
    signal: AbortSignal.timeout(8000)
  });
  let response = await load();
  if (!response.ok) {
    await new Promise((resolve) => setTimeout(resolve, 350));
    response = await load();
  }
  if (!response.ok) return null;
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!isPng(bytes) || bytes.length > 2 * 1024 * 1024) return null;
  if (!options.bypassCache) await rememberTile(zoom, wrappedX, y, bytes);
  return bytes;
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index]);
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()));
  return results;
}

async function stitchStaticMap({ lat, lng, zoom, width, height, fetchTile }) {
  const range = tileRange(lat, lng, zoom, width, height);
  const tiles = [];
  for (let y = range.tileY0; y <= range.tileY1; y += 1) {
    for (let x = range.tileX0; x <= range.tileX1; x += 1) tiles.push({ x, y });
  }
  const fetched = await mapLimit(tiles, 2, async (tile) => ({
    ...tile,
    bytes: await fetchTile(zoom, tile.x, tile.y)
  }));
  if (fetched.some((tile) => !isPng(tile.bytes))) return null;
  const gridW = (range.tileX1 - range.tileX0 + 1) * TILE_SIZE;
  const gridH = (range.tileY1 - range.tileY0 + 1) * TILE_SIZE;
  const base = await sharp({
    create: { width: gridW, height: gridH, channels: 3, background: '#d5e0d8' }
  }).composite(fetched.map((tile) => ({
    input: tile.bytes,
    left: (tile.x - range.tileX0) * TILE_SIZE,
    top: (tile.y - range.tileY0) * TILE_SIZE
  }))).png().toBuffer();

  let cropLeft = Math.round(range.left - range.tileX0 * TILE_SIZE);
  let cropTop = Math.round(range.top - range.tileY0 * TILE_SIZE);
  cropLeft = Math.max(0, Math.min(cropLeft, gridW - width));
  cropTop = Math.max(0, Math.min(cropTop, gridH - height));
  const cropped = await sharp(base).extract({ left: cropLeft, top: cropTop, width, height }).png().toBuffer();
  const pin = await svgPng(pinSvg(), 46, 64);
  const credit = await svgPng(creditSvg(width), width, 26);
  const pinLeft = Math.max(0, Math.min(width - 46, Math.round(width / 2 - 23)));
  const pinTop = Math.max(0, Math.min(height - 64, Math.round(height / 2 - 58)));
  return sharp(cropped).composite([
    { input: pin, left: pinLeft, top: pinTop },
    { input: credit, left: 0, top: height - 26 }
  ]).png().toBuffer();
}

function networkBlocked(options) {
  if (options.fetchImpl || options.allowNetwork === true) return false;
  return Boolean(process.env.NODE_TEST_CONTEXT);
}

async function osmStaticMapBuffer(project = {}, options = {}) {
  const lat = Number(project.latitude ?? project.lat);
  const lng = Number(project.longitude ?? project.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 85 || Math.abs(lng) > 180) return null;
  const zoom = Number.isInteger(options.zoom) ? options.zoom : (project.extra_fields?.map_precision === 'area_centroid' ? 14 : 16);
  const width = options.width || 1200;
  const height = options.height || 680;
  if (zoom < 3 || zoom > 18 || width < 64 || height < 64 || width > 1600 || height > 1600) return null;
  if (networkBlocked(options)) return null;
  const cacheKey = `${lat.toFixed(5)},${lng.toFixed(5)},${zoom},${width}x${height}`;
  if (!options.fetchImpl && memoryMaps.has(cacheKey)) return memoryMaps.get(cacheKey);
  const fetchImpl = options.fetchImpl || global.fetch;
  try {
    const png = await stitchStaticMap({
      lat,
      lng,
      zoom,
      width,
      height,
      fetchTile: (z, x, y) => fetchOsmTile(z, x, y, fetchImpl, { bypassCache: Boolean(options.fetchImpl) })
    });
    if (png && !options.fetchImpl) memoryMaps.set(cacheKey, png);
    return png || null;
  } catch (error) {
    console.warn('[off-plan-brochure-map] OpenStreetMap tiles unavailable', { message: String(error?.message || error).slice(0, 180) });
    return null;
  }
}

module.exports = {
  OSM_ATTRIBUTION,
  TILE_URL,
  USER_AGENT,
  latToTileY,
  lonToTileX,
  osmStaticMapBuffer,
  stitchStaticMap,
  tileRange,
  wrapTileX
};
