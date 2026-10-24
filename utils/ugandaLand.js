'use strict';

// Uganda's land, not the bounding box. The polygon is Natural Earth 10m
// admin-0 with a small border allowance, minus Lakes Victoria, Kyoga, Albert,
// Edward and George. See data/uganda-land.geojson.

const fs = require('fs');
const path = require('path');

const geojson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'uganda-land.geojson'), 'utf8'));
const geometry = geojson.features[0].geometry;

function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const crosses = (yi > lat) !== (yj > lat);
    if (crosses && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function pointInPolygon(lng, lat, coordinates) {
  if (!coordinates || !coordinates.length || !pointInRing(lng, lat, coordinates[0])) return false;
  for (let hole = 1; hole < coordinates.length; hole += 1) {
    if (pointInRing(lng, lat, coordinates[hole])) return false;
  }
  return true;
}

function isOnUgandaLand(lat, lng) {
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons.some((polygon) => pointInPolygon(longitude, latitude, polygon));
}

module.exports = {
  isOnUgandaLand,
  ugandaLandGeometry: geometry
};
