'use strict';

const fs = require('fs');
const path = require('path');
const { brochureLanguagePack, interpolate, normalizeBrochureLanguage } = require('./offPlanBrochureI18n');
const { osmStaticMapBuffer } = require('./osmStaticMap');

function cleanText(value, max = 4000) {
  return String(value == null ? '' : value).trim().replace(/\s+/g, ' ').slice(0, max);
}

function formatMoney(value, currency = 'UGX', copy = ENGLISH_FALLBACK) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return copy.priceRequest;
  return `${cleanText(currency, 3).toUpperCase()} ${Math.round(amount).toLocaleString('en-UG')}`;
}

const ENGLISH_FALLBACK = brochureLanguagePack('en');

function formatDate(value, language = 'en', copy = brochureLanguagePack(language)) {
  if (!value) return copy.toVerify;
  const dateOnlyMatch = typeof value === 'string' ? value.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/) : null;
  const date = value instanceof Date
    ? new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate(), 12))
    : dateOnlyMatch
      ? new Date(Date.UTC(Number(dateOnlyMatch[1]), Number(dateOnlyMatch[2]) - 1, Number(dateOnlyMatch[3]), 12))
      : new Date(value);
  if (Number.isNaN(date.getTime())) return cleanText(value, 80);
  const locale = { lg: 'lg-UG', sw: 'sw-UG', am: 'am-ET', ar: 'ar-UG' }[normalizeBrochureLanguage(language)] || 'en-UG';
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Africa/Kampala'
  }).format(date);
}

function publicBaseUrl() {
  return String(process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || 'https://makaug.com').replace(/\/+$/, '');
}

function projectUrl(project) {
  const countryName = project.extra_fields?.country_slug || project.extra_fields?.country_name || (project.country_code === 'KE' ? 'Kenya' : project.country_code);
  const countrySlug = String(countryName || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const route = project.country_code && project.country_code !== 'UG'
    ? `/off-plan/overseas/${encodeURIComponent(countrySlug)}/${encodeURIComponent(project.slug)}`
    : `/off-plan/${encodeURIComponent(project.slug)}`;
  return `${publicBaseUrl()}${route}`;
}

function agentUrl(agent = {}) {
  return agent.id ? `${publicBaseUrl()}/agents/${encodeURIComponent(agent.id)}` : projectUrl({ slug: '' });
}

function googleMapsUrl(project = {}) {
  const lat = Number(project.latitude);
  const lng = Number(project.longitude);
  const query = Number.isFinite(lat) && Number.isFinite(lng)
    ? `${lat},${lng}`
    : [project.area, project.district, project.extra_fields?.country_name || (project.country_code === 'UG' ? 'Uganda' : project.country_code)].filter(Boolean).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function localAssetPath(url) {
  const clean = cleanText(url, 2000).split('?')[0];
  if (!clean.startsWith('/assets/')) return null;
  const relative = clean.replace(/^\/+/, '');
  const candidate = path.resolve(__dirname, '..', relative);
  const assetsRoot = path.resolve(__dirname, '..', 'assets');
  if (!candidate.startsWith(`${assetsRoot}${path.sep}`) || !fs.existsSync(candidate)) return null;
  return candidate;
}

async function safeRemoteImageBuffer(url) {
  const clean = cleanText(url, 2000);
  if (!/^https:\/\/media\.makaug\.com\//i.test(clean)) return null;
  try {
    const response = await fetch(clean, { signal: AbortSignal.timeout(3500) });
    const type = response.headers.get('content-type') || '';
    if (!response.ok || !/^image\/(?:jpeg|png)/i.test(type)) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    return bytes.length && bytes.length <= 8 * 1024 * 1024 ? bytes : null;
  } catch (_error) {
    return null;
  }
}

async function googleStaticMapBuffer(project = {}) {
  // C18: Google's static map is no longer used (no paid Google APIs). The
  // brochure uses its area card instead. Kept as a no-op unless
  // GOOGLE_PLACES_ALLOWED=true and MAP_PROVIDER=google are both set on purpose.
  if (String(process.env.GOOGLE_PLACES_ALLOWED || '').trim().toLowerCase() !== 'true') return null;
  if (String(process.env.MAP_PROVIDER || '').trim().toLowerCase() !== 'google') return null;
  const key = cleanText(process.env.GOOGLE_MAPS_STATIC_API_KEY || process.env.GOOGLE_MAPS_API_KEY, 500);
  const lat = Number(project.latitude);
  const lng = Number(project.longitude);
  if (!key || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const query = new URLSearchParams({
    center: `${lat},${lng}`,
    zoom: project.extra_fields?.map_precision === 'area_centroid' ? '12' : '15',
    size: '900x420',
    scale: '1',
    maptype: 'roadmap',
    markers: `color:red|${lat},${lng}`,
    key
  });
  try {
    const response = await fetch(`https://maps.googleapis.com/maps/api/staticmap?${query}`, { signal: AbortSignal.timeout(4500) });
    if (!response.ok || !(response.headers.get('content-type') || '').startsWith('image/')) {
      const responseText = await response.text().catch(() => '');
      console.warn('[off-plan-brochure-map] Static map unavailable', { status: response.status, body: cleanText(responseText, 180) });
      return null;
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    return bytes.length && bytes.length <= 8 * 1024 * 1024 ? bytes : null;
  } catch (error) {
    console.warn('[off-plan-brochure-map] Static map request failed', { message: cleanText(error?.message, 180) });
    return null;
  }
}

function distanceKmBetween(first = {}, second = {}) {
  const lat1 = Number(first.latitude ?? first.lat);
  const lng1 = Number(first.longitude ?? first.lng);
  const lat2 = Number(second.latitude ?? second.lat);
  const lng2 = Number(second.longitude ?? second.lng);
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return null;
  const radians = (degrees) => degrees * Math.PI / 180;
  const deltaLat = radians(lat2 - lat1);
  const deltaLng = radians(lng2 - lng1);
  const a = Math.sin(deltaLat / 2) ** 2 + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(deltaLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function distanceFromProject(project = {}, place = {}) {
  const supplied = Number(place.distance_km);
  if (Number.isFinite(supplied)) return supplied;
  return distanceKmBetween(project, place);
}

function formatApproximateDistance(project, place, language = 'en') {
  const copy = brochureLanguagePack(language);
  const distance = distanceFromProject(project, place);
  if (!Number.isFinite(distance)) return copy.distanceVerify;
  const display = distance < 0.1 ? '<0.1' : distance.toFixed(distance < 10 ? 1 : 0);
  return interpolate(copy.approximateDistance, { distance: display });
}

function computeMortgageEstimate({ principal, annualRate, years, arrangementFeePct = 0 } = {}) {
  const safePrincipal = Number(principal);
  const safeRate = Number(annualRate);
  const safeYears = Number(years);
  if (!(safePrincipal > 0) || !(safeRate > 0) || !(safeYears > 0)) return null;
  const months = Math.max(1, Math.round(safeYears * 12));
  const monthlyRate = safeRate / 100 / 12;
  const factor = (1 + monthlyRate) ** months;
  const monthly = safePrincipal * monthlyRate * factor / (factor - 1);
  const arrangementFee = safePrincipal * Math.max(0, Number(arrangementFeePct) || 0) / 100;
  const repaymentBeforeFee = monthly * months;
  return {
    principal: safePrincipal,
    years: safeYears,
    months,
    monthly,
    interest: repaymentBeforeFee - safePrincipal,
    arrangementFee,
    total: repaymentBeforeFee + arrangementFee
  };
}


async function resolveBrochureMap(project, options = {}) {
  if (options.mapImageBuffer) return options.mapImageBuffer;
  // Paid Google Static Maps stays off unless both flags are set on purpose.
  // Otherwise the brochure uses the same OpenStreetMap tiles as the site maps.
  const google = await googleStaticMapBuffer(project);
  if (google) return google;
  return osmStaticMapBuffer(project, { width: 1200, height: 680, zoom: 16 });
}

async function brochureBuffer(project, options = {}) {
  const { editorialBrochureBuffer } = require('./offPlanBrochureDesigns');
  const images = Array.isArray(project?.images) ? project.images : [];
  const [mapImageBuffer, imageBuffers] = await Promise.all([
    resolveBrochureMap(project, options),
    Promise.all(images.map((image) => safeRemoteImageBuffer(image.url)))
  ]);
  return editorialBrochureBuffer(project, { ...options, mapBuffer: mapImageBuffer, imageBuffers });
}

module.exports = {
  brochureBuffer,
  computeMortgageEstimate,
  distanceFromProject,
  distanceKmBetween,
  formatApproximateDistance,
  formatDate,
  formatMoney,
  googleMapsUrl,
  googleStaticMapBuffer,
  localAssetPath,
  projectUrl,
  resolveBrochureMap
};
