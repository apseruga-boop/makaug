'use strict';

// ---------------------------------------------------------------------------
// Booking.com, through CJ Affiliate.
//
// makaug is a publisher on CJ (company CID 7762175, website PID 101885222 for
// makaug.com). Booking.com's programme there is "Booking.com MEA", advertiser
// id 4347392. A visitor who clicks through and books on Booking.com earns
// makaug a commission; makaug still takes no booking and touches no money.
//
// Nothing here calls an API at search time. A CJ tracked link is a URL:
//
//   https://www.dpbolvw.net/click-<PID>-<AD_ID>?url=<booking.com url>&sid=<tag>
//
// PID is the makaug.com website id. AD_ID is the id of a Booking.com text link
// in CJ (Links -> Booking.com MEA -> any text link -> "Link ID"). The link id
// only exists once Booking.com has approved the application, which is why the
// whole block stays dark until three env vars are set:
//
//   BOOKING_AFFILIATE_ENABLED=true
//   CJ_PUBLISHER_PID=101885222
//   BOOKING_CJ_AD_ID=<link id from CJ>
//
// Unset any one of them and the Booking.com card disappears. That is the
// rollback.
// ---------------------------------------------------------------------------

const CJ_CLICK_HOST = 'https://www.dpbolvw.net';
const BOOKING_SEARCH = 'https://www.booking.com/searchresults.html';
const CJ_ADVERTISER_ID = '4347392';
const DEFAULT_SID = 'makaug-short-term';

function readConfig(env = process.env) {
  return {
    enabled: String(env.BOOKING_AFFILIATE_ENABLED || '').trim().toLowerCase() === 'true',
    pid: String(env.CJ_PUBLISHER_PID || '').trim(),
    adId: String(env.BOOKING_CJ_AD_ID || '').trim()
  };
}

function isConfigured(env = process.env) {
  const config = readConfig(env);
  return config.enabled && /^\d{4,}$/.test(config.pid) && /^\d{4,}$/.test(config.adId);
}

function isoDate(value) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  return isFinite(Date.parse(text + 'T00:00:00Z')) ? text : null;
}

// The Booking.com search the visitor would have run themselves: same place,
// same dates, same party. Always scoped to Uganda, because that is the only
// market this section covers.
function bookingSearchUrl({ q, checkIn, checkOut, guests } = {}) {
  const url = new URL(BOOKING_SEARCH);
  const place = String(q || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  url.searchParams.set('ss', place && !/uganda/i.test(place) ? place + ', Uganda' : (place || 'Uganda'));

  const from = isoDate(checkIn);
  const to = isoDate(checkOut);
  if (from && to && Date.parse(to) > Date.parse(from)) {
    url.searchParams.set('checkin', from);
    url.searchParams.set('checkout', to);
  }

  const adults = Math.min(16, Math.max(1, Math.round(Number(guests)) || 2));
  url.searchParams.set('group_adults', String(adults));
  url.searchParams.set('no_rooms', '1');
  url.searchParams.set('group_children', '0');
  return url.toString();
}

function trackedUrl(destination, { env = process.env, sid = DEFAULT_SID } = {}) {
  const config = readConfig(env);
  const tag = String(sid || DEFAULT_SID).replace(/[^a-z0-9_-]/gi, '').slice(0, 64) || DEFAULT_SID;
  return CJ_CLICK_HOST + '/click-' + config.pid + '-' + config.adId
    + '?url=' + encodeURIComponent(destination)
    + '&sid=' + encodeURIComponent(tag);
}

// What the search endpoint hands the page. null means "show nothing".
function bookingLinkFor(query = {}, env = process.env) {
  if (!isConfigured(env)) return null;
  const destination = bookingSearchUrl({
    q: query.q,
    checkIn: query.check_in,
    checkOut: query.check_out,
    guests: query.guests
  });
  return {
    provider: 'booking.com',
    network: 'cj',
    advertiser_id: CJ_ADVERTISER_ID,
    url: trackedUrl(destination, { env }),
    destination
  };
}

module.exports = {
  CJ_ADVERTISER_ID,
  CJ_CLICK_HOST,
  bookingLinkFor,
  bookingSearchUrl,
  isConfigured,
  readConfig,
  trackedUrl
};
