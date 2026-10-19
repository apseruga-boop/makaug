'use strict';

// Travelpayouts click tracking for short-stay partner hotels.
//
// The marker (partner id) is never hard-coded. Set TRAVELPAYOUTS_MARKER in the
// environment. An empty marker hides every affiliate button.
//
// Program and campaign ids come from the Travelpayouts dashboard and change
// without a deploy. A brand whose program id is empty is omitted. Campaign id
// is optional; the click URL works without it.
//
// Drive (the emrld script Travelpayouts uses to finish onboarding) is a
// separate switch, TRAVELPAYOUTS_DRIVE_ENABLED, default off. The page that
// serves /short-term is the only place that prints it.

const DEFAULT_DRIVE_SRC = 'https://emrldtp.cc/NTgxODU0.js?t=581854';

const BRAND_DEFS = [
  {
    key: 'agoda',
    label: 'Agoda',
    programEnv: 'TRAVELPAYOUTS_AGODA_PROGRAM_ID',
    campaignEnv: 'TRAVELPAYOUTS_AGODA_CAMPAIGN_ID'
  },
  {
    key: 'booking',
    label: 'Booking.com',
    programEnv: 'TRAVELPAYOUTS_BOOKING_PROGRAM_ID',
    campaignEnv: 'TRAVELPAYOUTS_BOOKING_CAMPAIGN_ID'
  },
  {
    key: 'trip',
    label: 'Trip.com',
    programEnv: 'TRAVELPAYOUTS_TRIP_PROGRAM_ID',
    campaignEnv: 'TRAVELPAYOUTS_TRIP_CAMPAIGN_ID'
  }
];

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function flagOn(value) {
  return /^(1|true|yes|on)$/i.test(clean(value));
}

function sanitizeSubId(value) {
  return clean(value).replace(/[^A-Za-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 100);
}

function hotelSubId(slug, extra) {
  const base = sanitizeSubId(`st_hotel_${slug || 'hotel'}`) || 'st_hotel';
  const more = sanitizeSubId(extra);
  return more ? `${base}_${more}`.slice(0, 100) : base;
}

function searchSubId(extra) {
  const more = sanitizeSubId(extra);
  return more ? `st_search_${more}`.slice(0, 100) : 'st_search';
}

function trafficExtra(query = {}) {
  return clean(query.ref) || clean(query.utm_source);
}

function brandSearchUrl(key, input = {}) {
  const destination = clean(input.destination) || 'Uganda';
  const adults = String(Math.max(1, Number(input.adults) || 2));
  const checkIn = clean(input.checkIn);
  const checkOut = clean(input.checkOut);
  if (key === 'booking') {
    const url = new URL('https://www.booking.com/searchresults.html');
    url.searchParams.set('ss', destination);
    if (checkIn) url.searchParams.set('checkin', checkIn);
    if (checkOut) url.searchParams.set('checkout', checkOut);
    url.searchParams.set('group_adults', adults);
    url.searchParams.set('no_rooms', '1');
    return url.toString();
  }
  if (key === 'agoda') {
    const url = new URL('https://www.agoda.com/search');
    url.searchParams.set('q', destination);
    if (checkIn) url.searchParams.set('checkIn', checkIn);
    if (checkOut) url.searchParams.set('checkOut', checkOut);
    url.searchParams.set('adults', adults);
    url.searchParams.set('rooms', '1');
    return url.toString();
  }
  if (key === 'trip') {
    const url = new URL('https://www.trip.com/hotels/list');
    url.searchParams.set('keyword', destination);
    if (checkIn) url.searchParams.set('checkin', checkIn);
    if (checkOut) url.searchParams.set('checkout', checkOut);
    url.searchParams.set('adult', adults);
    url.searchParams.set('crn', '1');
    return url.toString();
  }
  return '';
}

function publicConfig(env = process.env) {
  const marker = clean(env.TRAVELPAYOUTS_MARKER);
  const brands = BRAND_DEFS.map((brand) => ({
    key: brand.key,
    label: brand.label,
    programId: clean(env[brand.programEnv]),
    campaignId: clean(env[brand.campaignEnv])
  })).filter((brand) => brand.programId);
  return {
    marker,
    brands,
    enabled: Boolean(marker && brands.length),
    driveEnabled: flagOn(env.TRAVELPAYOUTS_DRIVE_ENABLED),
    driveSrc: clean(env.TRAVELPAYOUTS_DRIVE_SRC) || DEFAULT_DRIVE_SRC
  };
}

function trackedLink({ marker, programId, campaignId, url, subId } = {}) {
  const cleanMarker = clean(marker);
  const program = clean(programId);
  const destination = clean(url);
  if (!cleanMarker || !program || !destination) return '';
  const params = new URLSearchParams();
  params.set('marker', cleanMarker);
  params.set('p', program);
  params.set('u', destination);
  const campaign = clean(campaignId);
  if (campaign) params.set('campaign_id', campaign);
  const sub = sanitizeSubId(subId);
  if (sub) params.set('sub_id', sub);
  return `https://tp.media/r?${params.toString()}`;
}

function compareLinks({ marker, brands, hotelName, checkIn, checkOut, adults, subId } = {}) {
  if (!clean(marker)) return [];
  return (Array.isArray(brands) ? brands : []).map((brand) => {
    const destination = brandSearchUrl(brand.key, {
      destination: hotelName,
      checkIn,
      checkOut,
      adults
    });
    const href = trackedLink({
      marker,
      programId: brand.programId,
      campaignId: brand.campaignId,
      url: destination,
      subId
    });
    return href ? { key: brand.key, label: brand.label, href, subId: sanitizeSubId(subId) } : null;
  }).filter(Boolean);
}

// Printed into <head> of GET /short-term only. The site has no cookie-consent
// banner, so the loader runs immediately unless a consent element is present.
function driveHeadSnippet(env = process.env) {
  const config = publicConfig(env);
  if (!config.driveEnabled) return '';
  const src = JSON.stringify(config.driveSrc).replace(/</g, '\\u003c');
  return `<script id="makaug-tp-drive">
(function(){
  var src = ${src};
  function load(){
    if (document.querySelector('script[data-tp-drive]')) return;
    var s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.setAttribute('data-tp-drive', '1');
    document.head.appendChild(s);
  }
  var granted = window.__makaugCookieConsent === 'granted'
    || (document.documentElement && document.documentElement.getAttribute('data-cookie-consent') === 'granted');
  var banner = document.querySelector('[data-cookie-consent], #cookie-banner, #cookie-consent, [data-cookie-banner]');
  if (granted || !banner) { load(); return; }
  document.addEventListener('makaug:cookie-consent', function (event) {
    var detail = event && event.detail;
    if (!detail || detail.granted !== false) load();
  });
})();
</script>`;
}

module.exports = {
  DEFAULT_DRIVE_SRC,
  BRAND_DEFS,
  brandSearchUrl,
  compareLinks,
  driveHeadSnippet,
  hotelSubId,
  publicConfig,
  sanitizeSubId,
  searchSubId,
  trackedLink,
  trafficExtra
};
