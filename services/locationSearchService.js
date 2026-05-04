const DEFAULT_SEARCH_RADIUS_MILES = 10;
const DEFAULT_SEARCH_RADIUS_KM = 16.09344;
const UGANDA_BOUNDS = {
  minLat: -1.7,
  maxLat: 4.5,
  minLng: 29.2,
  maxLng: 35.2
};

function toFiniteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function milesToKm(miles) {
  const value = toFiniteNumber(miles);
  if (value == null || value <= 0) return 0;
  return value * 1.609344;
}

function kmToMiles(km) {
  const value = toFiniteNumber(km);
  if (value == null || value <= 0) return 0;
  return value / 1.609344;
}

function normalizeRadiusMiles(value, fallback = DEFAULT_SEARCH_RADIUS_MILES) {
  const miles = toFiniteNumber(value);
  if (miles == null || miles <= 0) return fallback;
  return Math.min(50, Math.max(1, miles));
}

function normalizeRadiusKm(value, fallbackMiles = DEFAULT_SEARCH_RADIUS_MILES) {
  const km = toFiniteNumber(value);
  if (km != null && km > 0) return Math.min(80.5, Math.max(1, km));
  return milesToKm(normalizeRadiusMiles(undefined, fallbackMiles));
}

function isPointInUganda(lat, lng) {
  const nLat = toFiniteNumber(lat);
  const nLng = toFiniteNumber(lng);
  if (nLat == null || nLng == null) return false;
  return nLat >= UGANDA_BOUNDS.minLat
    && nLat <= UGANDA_BOUNDS.maxLat
    && nLng >= UGANDA_BOUNDS.minLng
    && nLng <= UGANDA_BOUNDS.maxLng;
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const aLat = toFiniteNumber(lat1);
  const aLng = toFiniteNumber(lng1);
  const bLat = toFiniteNumber(lat2);
  const bLng = toFiniteNumber(lng2);
  if ([aLat, aLng, bLat, bLng].some((value) => value == null)) return null;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const chord = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * (2 * Math.atan2(Math.sqrt(chord), Math.sqrt(1 - chord)));
}

function roundLocationForAnalytics(lat, lng) {
  const nLat = toFiniteNumber(lat);
  const nLng = toFiniteNumber(lng);
  if (nLat == null || nLng == null) return null;
  return {
    latitude: Number(nLat.toFixed(3)),
    longitude: Number(nLng.toFixed(3))
  };
}

function buildHaversineSql(latRef, lngRef, latColumn = 'p.latitude', lngColumn = 'p.longitude') {
  return `(6371 * 2 * ASIN(SQRT(POWER(SIN(RADIANS((${latColumn} - ${latRef}) / 2)), 2) + COS(RADIANS(${latRef})) * COS(RADIANS(${latColumn})) * POWER(SIN(RADIANS((${lngColumn} - ${lngRef}) / 2)), 2))))`;
}

module.exports = {
  DEFAULT_SEARCH_RADIUS_MILES,
  DEFAULT_SEARCH_RADIUS_KM,
  UGANDA_BOUNDS,
  milesToKm,
  kmToMiles,
  normalizeRadiusMiles,
  normalizeRadiusKm,
  isPointInUganda,
  haversineKm,
  roundLocationForAnalytics,
  buildHaversineSql
};
