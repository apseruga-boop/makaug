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

// Travel extras for a stay: transfers, eSIMs, tours, cars and flights.
// Hotel brands stay in BRAND_DEFS. Compare prices does not read this list.
// A partner is omitted until TRAVELPAYOUTS_<PARTNER>_PROGRAM_ID is set, so the
// block stays hidden until those values are approved. Campaign id is optional
// and is added to the click URL when TRAVELPAYOUTS_<PARTNER>_CAMPAIGN_ID is set.
// Destinations point at Entebbe Airport (EBB), Kampala or Uganda where the
// partner has a page or search that accepts that place.
const EXTRA_GROUPS = [
  {
    key: 'transfers',
    partners: [
      {
        key: 'kiwitaxi',
        label: 'Kiwitaxi',
        programEnv: 'TRAVELPAYOUTS_KIWITAXI_PROGRAM_ID',
        campaignEnv: 'TRAVELPAYOUTS_KIWITAXI_CAMPAIGN_ID',
        url: 'https://kiwitaxi.com/en/uganda/entebbe'
      },
      {
        key: 'welcome_pickups',
        label: 'Welcome Pickups',
        programEnv: 'TRAVELPAYOUTS_WELCOME_PICKUPS_PROGRAM_ID',
        campaignEnv: 'TRAVELPAYOUTS_WELCOME_PICKUPS_CAMPAIGN_ID',
        url: 'https://www.welcomepickups.com/kampala/airport-to-city/'
      },
      {
        key: 'gettransfer',
        label: 'GetTransfer',
        programEnv: 'TRAVELPAYOUTS_GETTRANSFER_PROGRAM_ID',
        campaignEnv: 'TRAVELPAYOUTS_GETTRANSFER_CAMPAIGN_ID',
        url: 'https://gettransfer.com/en/transfers/new?from_name=Entebbe%20International%20Airport&to_name=Kampala'
      }
    ]
  },
  {
    key: 'esims',
    partners: [
      {
        key: 'airalo',
        label: 'Airalo',
        programEnv: 'TRAVELPAYOUTS_AIRALO_PROGRAM_ID',
        campaignEnv: 'TRAVELPAYOUTS_AIRALO_CAMPAIGN_ID',
        url: 'https://www.airalo.com/uganda-esim'
      },
      {
        key: 'yesim',
        label: 'Yesim',
        programEnv: 'TRAVELPAYOUTS_YESIM_PROGRAM_ID',
        campaignEnv: 'TRAVELPAYOUTS_YESIM_CAMPAIGN_ID',
        url: 'https://yesim.app/country/uganda/'
      },
      {
        key: 'saily',
        label: 'Saily',
        programEnv: 'TRAVELPAYOUTS_SAILY_PROGRAM_ID',
        campaignEnv: 'TRAVELPAYOUTS_SAILY_CAMPAIGN_ID',
        url: 'https://saily.com/esim-uganda/'
      }
    ]
  },
  {
    key: 'tours',
    partners: [
      {
        key: 'klook',
        label: 'Klook',
        programEnv: 'TRAVELPAYOUTS_KLOOK_PROGRAM_ID',
        campaignEnv: 'TRAVELPAYOUTS_KLOOK_CAMPAIGN_ID',
        url: 'https://www.klook.com/en-US/search/result/?query=Kampala%2C%20Uganda'
      },
      {
        key: 'kkday',
        label: 'KKday',
        programEnv: 'TRAVELPAYOUTS_KKDAY_PROGRAM_ID',
        campaignEnv: 'TRAVELPAYOUTS_KKDAY_CAMPAIGN_ID',
        url: 'https://www.kkday.com/en/product/productlist?keyword=Kampala%20Uganda'
      },
      {
        key: 'tiqets',
        label: 'Tiqets',
        programEnv: 'TRAVELPAYOUTS_TIQETS_PROGRAM_ID',
        campaignEnv: 'TRAVELPAYOUTS_TIQETS_CAMPAIGN_ID',
        url: 'https://www.tiqets.com/en/search?q=Kampala%2C%20Uganda'
      }
    ]
  },
  {
    key: 'cars',
    partners: [
      {
        key: 'localrent',
        label: 'Localrent',
        programEnv: 'TRAVELPAYOUTS_LOCALRENT_PROGRAM_ID',
        campaignEnv: 'TRAVELPAYOUTS_LOCALRENT_CAMPAIGN_ID',
        // Localrent publishes no Uganda city page. The query still names Kampala.
        url: 'https://www.localrent.com/en/?city=Kampala&country=Uganda'
      },
      {
        key: 'economybookings',
        label: 'Economybookings',
        programEnv: 'TRAVELPAYOUTS_ECONOMYBOOKINGS_PROGRAM_ID',
        campaignEnv: 'TRAVELPAYOUTS_ECONOMYBOOKINGS_CAMPAIGN_ID',
        url: 'https://www.economybookings.com/en/search?pickup=Entebbe%20International%20Airport&iata=EBB'
      }
    ]
  },
  {
    key: 'flights',
    partners: [
      {
        key: 'kiwi',
        label: 'Kiwi.com',
        programEnv: 'TRAVELPAYOUTS_KIWI_PROGRAM_ID',
        campaignEnv: 'TRAVELPAYOUTS_KIWI_CAMPAIGN_ID',
        url: 'https://www.kiwi.com/en/search/results/entebbe-uganda/anywhere'
      },
      {
        key: 'aviasales',
        label: 'Aviasales',
        programEnv: 'TRAVELPAYOUTS_AVIASALES_PROGRAM_ID',
        campaignEnv: 'TRAVELPAYOUTS_AVIASALES_CAMPAIGN_ID',
        url: 'https://www.aviasales.com/search?origin_iata=EBB&destination_iata='
      }
    ]
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

function extrasConfig(env = process.env) {
  const marker = clean(env.TRAVELPAYOUTS_MARKER);
  const groups = EXTRA_GROUPS.map((group) => ({
    key: group.key,
    partners: group.partners.map((partner) => {
      const programId = clean(env[partner.programEnv]);
      const url = clean(partner.url);
      if (!programId || !/^https:\/\//i.test(url)) return null;
      return {
        key: partner.key,
        label: partner.label,
        programId,
        campaignId: clean(env[partner.campaignEnv]),
        url
      };
    }).filter(Boolean)
  })).filter((group) => group.partners.length);
  return {
    marker,
    groups,
    enabled: Boolean(marker && groups.length)
  };
}

function extraLinks({ marker, groups, subId } = {}) {
  if (!clean(marker)) return [];
  const links = [];
  (Array.isArray(groups) ? groups : []).forEach((group) => {
    (group.partners || []).forEach((partner) => {
      const href = trackedLink({
        marker,
        programId: partner.programId,
        campaignId: partner.campaignId,
        url: partner.url,
        subId
      });
      if (!href) return;
      links.push({
        key: partner.key,
        label: partner.label,
        group: group.key,
        href,
        subId: sanitizeSubId(subId)
      });
    });
  });
  return links;
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
  EXTRA_GROUPS,
  brandSearchUrl,
  compareLinks,
  driveHeadSnippet,
  extraLinks,
  extrasConfig,
  hotelSubId,
  publicConfig,
  sanitizeSubId,
  searchSubId,
  trackedLink,
  trafficExtra
};
