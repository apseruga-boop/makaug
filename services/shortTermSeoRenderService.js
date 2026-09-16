'use strict';

// Server-rendered Short Term content.
//
// Two jobs:
//   1. Put real listing cards inside #short-term-ssr so a crawler, a scraper
//      or a visitor with JavaScript off sees actual inventory rather than an
//      empty shell. makaug's own rules say a feature that only exists as
//      hidden UI is not shipped, and an empty div is hidden UI.
//   2. Emit VacationRental / ItemList structured data. Google distributes
//      vacation rentals from that markup for free, which is the cheapest
//      supply of guests makaug will ever get.

const { SHORT_TERM_MARKER, formatUgx } = require('./shortTermService');

const SSR_CONTAINER_PATTERN = /(<div\b[^>]*\bid=["']short-term-ssr["'][^>]*>)([\s\S]*?)(<\/div>)/i;

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function truncate(value, length) {
  const raw = String(value || '').replace(/\s+/g, ' ').trim();
  if (raw.length <= length) return raw;
  return `${raw.slice(0, length - 1).trimEnd()}…`;
}

function renderCard(listing, baseUrl) {
  const url = `${String(baseUrl || '').replace(/\/+$/, '')}${listing.url || '/short-term'}`;
  const image = listing.primary_image ? escapeHtml(listing.primary_image) : '';
  const score = listing.review_count > 0 && listing.review_average != null
    ? `<span class="st-ssr-score">${listing.review_average.toFixed(1)} from ${listing.review_count} review${listing.review_count === 1 ? '' : 's'}</span>`
    : '<span class="st-ssr-score st-ssr-score-new">New listing</span>';

  return `<article class="st-ssr-card" itemscope itemtype="https://schema.org/Accommodation">
  <a class="st-ssr-card-link" href="${escapeHtml(url)}" itemprop="url">
    ${image ? `<img class="st-ssr-card-image" src="${image}" alt="${escapeHtml(listing.title)}" loading="lazy" width="400" height="280" itemprop="image">` : ''}
    <h3 class="st-ssr-card-title" itemprop="name">${escapeHtml(listing.title)}</h3>
  </a>
  <p class="st-ssr-card-where"><span itemprop="addressLocality">${escapeHtml(listing.area)}</span>, ${escapeHtml(listing.district)}</p>
  <p class="st-ssr-card-spec">${escapeHtml(listing.place_type_label)} &middot; ${listing.bedrooms} bedroom${listing.bedrooms === 1 ? '' : 's'} &middot; sleeps ${listing.max_guests}</p>
  <p class="st-ssr-card-price"><strong>${escapeHtml(listing.nightly_display)}</strong> per night</p>
  <p class="st-ssr-card-meta">${score}</p>
  <p class="st-ssr-card-desc" itemprop="description">${escapeHtml(truncate(listing.description, 160))}</p>
</article>`;
}

function renderShortTermSsrBlock(listings = [], options = {}) {
  const baseUrl = options.baseUrl || '';
  if (!listings.length) {
    return `<p class="st-ssr-empty">No short stays are published yet. If you have a place in Uganda that you rent by the night, <a href="/short-term/list-your-place">list it on makaug</a>.</p>`;
  }
  const cards = listings.map((listing) => renderCard(listing, baseUrl)).join('\n');
  return `<h2 class="st-ssr-heading">Short stays in Uganda</h2>
<div class="st-ssr-grid">
${cards}
</div>
<p class="st-ssr-note">Prices are set by each host and shown per night in Uganda Shillings. makaug lists the place and the host's own contact details. makaug does not take bookings, does not handle payment and is not a party to any stay.</p>`;
}

function shortTermItemListStructuredData(listings = [], baseUrl = '') {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Short stays in Uganda',
    numberOfItems: listings.length,
    itemListElement: listings.slice(0, 20).map((listing, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      url: `${base}${listing.url || '/short-term'}`,
      name: listing.title
    }))
  };
}

function vacationRentalStructuredData(listing, baseUrl = '') {
  if (!listing) return null;
  const base = String(baseUrl || '').replace(/\/+$/, '');
  const data = {
    '@context': 'https://schema.org',
    '@type': 'VacationRental',
    name: listing.title,
    description: truncate(listing.description, 900),
    url: `${base}${listing.url || '/short-term'}`,
    identifier: listing.reference || listing.id,
    address: {
      '@type': 'PostalAddress',
      addressLocality: listing.area,
      addressRegion: listing.district,
      addressCountry: 'UG'
    },
    containsPlace: {
      '@type': 'Accommodation',
      occupancy: { '@type': 'QuantitativeValue', value: listing.max_guests },
      numberOfBedrooms: listing.bedrooms,
      numberOfBathroomsTotal: listing.bathrooms,
      numberOfBeds: listing.beds
    },
    checkinTime: listing.check_in_from || undefined,
    checkoutTime: listing.check_out_by || undefined
  };

  if (Number.isFinite(listing.latitude) && Number.isFinite(listing.longitude)) {
    data.geo = {
      '@type': 'GeoCoordinates',
      latitude: listing.latitude,
      longitude: listing.longitude
    };
  }

  if (Array.isArray(listing.images) && listing.images.length) {
    data.image = listing.images.map((item) => item.url).filter(Boolean).slice(0, 10);
  }

  if (listing.review_count > 0 && listing.review_average != null) {
    data.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: listing.review_average,
      reviewCount: listing.review_count,
      bestRating: 5,
      worstRating: 1
    };
  }

  if (Number(listing.nightly_ugx) > 0) {
    data.priceRange = formatUgx(listing.nightly_ugx);
  }

  return data;
}

/**
 * Drops server-rendered markup into #short-term-ssr. If the container is not
 * in the page (because the flag is off and the section was stripped, or the
 * markup moved) the HTML is returned untouched rather than mangled.
 */
function renderShortTermSeoHtml(html, { listings = [], baseUrl = '' } = {}) {
  const source = String(html || '');
  const block = renderShortTermSsrBlock(listings, { baseUrl });
  const structuredData = shortTermItemListStructuredData(listings, baseUrl);

  if (!SSR_CONTAINER_PATTERN.test(source)) {
    return { html: source, structuredData, injected: false, marker: SHORT_TERM_MARKER };
  }

  const rendered = source.replace(
    SSR_CONTAINER_PATTERN,
    (_match, open, _inner, close) => `${open}${block}${close}`
  );

  return { html: rendered, structuredData, injected: true, marker: SHORT_TERM_MARKER };
}

module.exports = {
  SSR_CONTAINER_PATTERN,
  escapeHtml,
  renderShortTermSeoHtml,
  renderShortTermSsrBlock,
  shortTermItemListStructuredData,
  vacationRentalStructuredData
};
