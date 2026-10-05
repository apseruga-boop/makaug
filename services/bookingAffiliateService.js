'use strict';

// ---------------------------------------------------------------------------
// Partner click-out links. This is makaug's only earning route on partner
// hotels: a visitor clicks through, books on the partner's own site, and the
// partner pays a commission on the completed stay. makaug takes no booking,
// holds no guest money and is not the merchant - exactly as everywhere else in
// this section.
//
// TWO NETWORKS, in order of preference.
//
// 1. TRAVELPAYOUTS (live route). Booking.com pays ~4% of a completed stay and
//    Agoda ~6%, both through Travelpayouts, which does not gate signup on site
//    traffic. The link format differs per programme and changes without notice,
//    so it is NOT built here: each programme's link is pasted in whole as a
//    TEMPLATE from the Travelpayouts deeplink generator, with {url} marking
//    where the destination goes. A template with no {url} is used as-is, which
//    is the right behaviour for a programme with no deep linking.
//
//      TRAVELPAYOUTS_BOOKING_TEMPLATE=https://tp.media/r?marker=123456&p=4976&campaign_id=101&u={url}
//      TRAVELPAYOUTS_AGODA_TEMPLATE=https://tp.media/r?marker=123456&p=5873&campaign_id=102&u={url}
//
//    Paste the generator's output and put {url} where the destination sits. No
//    code change is ever needed to fix a changed marker, programme or campaign.
//
// 2. CJ AFFILIATE (dormant). Booking.com MEA, advertiser 4347392, declined
//    makaug's application on 1 Oct 2026 on traffic and content grounds. The
//    code stays so it can be switched on without a rebuild if they reconsider:
//    BOOKING_AFFILIATE_ENABLED, CJ_PUBLISHER_PID, BOOKING_CJ_AD_ID.
//
// With nothing configured this returns an empty list and the page shows no
// click-out at all. That is the rollback, and it is the default.
// ---------------------------------------------------------------------------

const CJ_CLICK_HOST = 'https://www.dpbolvw.net';
const BOOKING_SEARCH = 'https://www.booking.com/searchresults.html';
const AGODA_SEARCH = 'https://www.agoda.com/search';
const CJ_ADVERTISER_ID = '4347392';
const DEFAULT_SID = 'makaug-short-term';

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function isoDate(value) {
  const text = clean(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  return isFinite(Date.parse(text + 'T00:00:00Z')) ? text : null;
}

// The stay the visitor actually asked for, or nothing. A made-up window would
// send them to prices for dates they never chose.
function stayFrom(query = {}) {
  const from = isoDate(query.check_in);
  const to = isoDate(query.check_out);
  const dated = from && to && Date.parse(to) > Date.parse(from);
  return {
    checkIn: dated ? from : null,
    checkOut: dated ? to : null,
    adults: Math.min(16, Math.max(1, Math.round(Number(query.guests)) || 2)),
    place: clean(query.q).replace(/\s+/g, ' ').slice(0, 80)
  };
}

function bookingSearchUrl(query = {}) {
  const stay = stayFrom(query);
  const url = new URL(BOOKING_SEARCH);
  url.searchParams.set('ss', stay.place && !/uganda/i.test(stay.place)
    ? stay.place + ', Uganda'
    : (stay.place || 'Uganda'));
  if (stay.checkIn) {
    url.searchParams.set('checkin', stay.checkIn);
    url.searchParams.set('checkout', stay.checkOut);
  }
  url.searchParams.set('group_adults', String(stay.adults));
  url.searchParams.set('group_children', '0');
  url.searchParams.set('no_rooms', '1');
  return url.toString();
}

function agodaSearchUrl(query = {}) {
  const stay = stayFrom(query);
  const url = new URL(AGODA_SEARCH);
  url.searchParams.set('city', '');
  url.searchParams.set('text', stay.place && !/uganda/i.test(stay.place)
    ? stay.place + ', Uganda'
    : (stay.place || 'Uganda'));
  if (stay.checkIn) {
    url.searchParams.set('checkIn', stay.checkIn);
    url.searchParams.set('checkOut', stay.checkOut);
  }
  url.searchParams.set('adults', String(stay.adults));
  url.searchParams.set('rooms', '1');
  return url.toString();
}

// A pasted template is trusted only so far: it has to be an https link, and
// {url} is filled with an encoded destination. Anything else is ignored rather
// than rendered, because a broken partner link on a live page earns nothing and
// looks like a fault in makaug.
function fromTemplate(template, destination) {
  const raw = clean(template);
  if (!/^https:\/\//i.test(raw)) return null;
  if (!raw.includes('{url}')) return raw;
  if (!destination) return null;
  return raw.replace(/\{url\}/g, encodeURIComponent(destination));
}

// ---------------------------------------------------------------------------
// CJ, kept for the day Booking.com reconsiders.
// ---------------------------------------------------------------------------

function readConfig(env = process.env) {
  return {
    enabled: clean(env.BOOKING_AFFILIATE_ENABLED).toLowerCase() === 'true',
    pid: clean(env.CJ_PUBLISHER_PID),
    adId: clean(env.BOOKING_CJ_AD_ID)
  };
}

function isConfigured(env = process.env) {
  const config = readConfig(env);
  return config.enabled && /^\d{4,}$/.test(config.pid) && /^\d{4,}$/.test(config.adId);
}

function trackedUrl(destination, { env = process.env, sid = DEFAULT_SID } = {}) {
  const config = readConfig(env);
  const tag = clean(sid).replace(/[^a-z0-9_-]/gi, '').slice(0, 64) || DEFAULT_SID;
  return CJ_CLICK_HOST + '/click-' + config.pid + '-' + config.adId
    + '?url=' + encodeURIComponent(destination)
    + '&sid=' + encodeURIComponent(tag);
}

function bookingLinkFor(query = {}, env = process.env) {
  if (!isConfigured(env)) return null;
  const destination = bookingSearchUrl(query);
  return {
    provider: 'booking.com',
    network: 'cj',
    advertiser_id: CJ_ADVERTISER_ID,
    url: trackedUrl(destination, { env }),
    destination
  };
}

// ---------------------------------------------------------------------------
// What the search endpoint hands the page: zero, one or two click-outs.
// ---------------------------------------------------------------------------

function affiliateOffersFor(query = {}, env = process.env) {
  const offers = [];

  const travelpayouts = [
    { provider: 'booking.com', label: 'Booking.com', template: env.TRAVELPAYOUTS_BOOKING_TEMPLATE, destination: bookingSearchUrl(query) },
    { provider: 'agoda', label: 'Agoda', template: env.TRAVELPAYOUTS_AGODA_TEMPLATE, destination: agodaSearchUrl(query) }
  ];

  travelpayouts.forEach((row) => {
    const url = fromTemplate(row.template, row.destination);
    if (!url) return;
    offers.push({
      provider: row.provider,
      label: row.label,
      network: 'travelpayouts',
      url,
      destination: row.destination
    });
  });

  // Only if Travelpayouts is not carrying Booking.com already: two Booking.com
  // buttons side by side is a worse page, and the second click would not be
  // attributed anywhere useful.
  if (!offers.some((offer) => offer.provider === 'booking.com')) {
    const cj = bookingLinkFor(query, env);
    if (cj) offers.push(Object.assign({ label: 'Booking.com' }, cj));
  }

  return offers;
}

module.exports = {
  CJ_ADVERTISER_ID,
  CJ_CLICK_HOST,
  affiliateOffersFor,
  agodaSearchUrl,
  bookingLinkFor,
  bookingSearchUrl,
  fromTemplate,
  isConfigured,
  readConfig,
  trackedUrl
};
