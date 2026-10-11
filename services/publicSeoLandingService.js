'use strict';

const {
  CATEGORY_SEO,
  canonicalLocationRouteSlug,
  facetLocationSlug,
  locationForRouteSlug,
  slugifySeoPart
} = require('./publicSeoService');
const { canonicalLocationOptions } = require('../utils/locationRegistry');
const { compactUgx } = require('../utils/compactUgx');
const {
  SEO_FACET_MIN_LISTINGS,
  FACET_DEFINITIONS,
  UNIVERSITY_LANDINGS,
  universityForSlug,
  facetDefinition,
  commercialTransactionFacet
} = require('../utils/publicSeoFacets');

const ROUTE_CATEGORY_KEYS = Object.freeze({
  'for-sale': 'sale',
  'to-rent': 'rent',
  land: 'land',
  commercial: 'commercial'
});

function flexibleLocationForSlug(slug = '') {
  const direct = locationForRouteSlug(slug);
  if (direct) return direct;
  const normalized = slugifySeoPart(slug);
  const matches = canonicalLocationOptions().filter((location) => (
    facetLocationSlug(location) === normalized
    || slugifySeoPart(location.location) === normalized
    || (location.level === 'district' && slugifySeoPart(location.district) === normalized)
  ));
  if (!matches.length) return null;
  return matches.find((location) => location.level === 'district') || matches[0];
}

function resolvePublicSeoLanding(pathname = '') {
  const clean = String(pathname || '/').split('?')[0].replace(/\/+$/, '') || '/';
  let match = clean.match(/^\/student-accommodation\/university\/([^/]+)$/i);
  if (match) {
    const university = universityForSlug(match[1]);
    return university ? {
      kind: 'university',
      categoryKey: 'students',
      university,
      canonicalPath: `/student-accommodation/university/${university.slug}`
    } : null;
  }
  match = clean.match(/^\/hostels\/([^/]+)$/i);
  if (match) {
    const university = universityForSlug(match[1]);
    return university ? {
      kind: 'university-alias',
      categoryKey: 'students',
      university,
      canonicalPath: `/student-accommodation/university/${university.slug}`
    } : null;
  }
  match = clean.match(/^\/commercial\/(for-rent|for-sale)\/([^/]+)$/i);
  if (match) {
    const facetSlug = match[1].toLowerCase();
    const location = flexibleLocationForSlug(match[2]);
    const facet = commercialTransactionFacet(facetSlug);
    return location && facet ? {
      kind: 'commercial-transaction',
      categoryKey: 'commercial',
      location,
      facetSlug,
      facet,
      canonicalPath: `/commercial/${facetSlug}/${facetLocationSlug(location)}`
    } : null;
  }
  match = clean.match(/^\/(for-sale|to-rent|land|commercial)\/([^/]+)\/([^/]+)$/i);
  if (!match) return null;
  const categoryKey = ROUTE_CATEGORY_KEYS[match[1].toLowerCase()];
  const location = flexibleLocationForSlug(match[2]);
  const facetSlug = match[3].toLowerCase();
  const facet = facetDefinition(categoryKey, facetSlug);
  if (!categoryKey || !location || !facet) return null;
  return {
    kind: 'facet',
    categoryKey,
    location,
    facetSlug,
    facet,
    canonicalPath: `${CATEGORY_SEO[categoryKey].route}/${facetLocationSlug(location)}/${facetSlug}`
  };
}

function landingCount(snapshot, landing) {
  if (!landing) return 0;
  if (landing.kind === 'university' || landing.kind === 'university-alias') {
    return Number(snapshot?.universityCounts?.get(landing.university.slug) || 0);
  }
  if (landing.kind === 'commercial-transaction') {
    return Number(snapshot?.commercialTransactionCounts?.get(`${landing.location.canonical_key}|${landing.facetSlug}`) || 0);
  }
  return Number(snapshot?.facetCounts?.[landing.categoryKey]?.get(`${landing.location.canonical_key}|${landing.facetSlug}`) || 0);
}

function locationLabel(location = {}) {
  return location.level === 'district'
    ? location.district
    : `${location.location}, ${location.district}`;
}

function uniqueLandingIntro(landing, count) {
  if (landing.kind === 'university' || landing.kind === 'university-alias') {
    return `Compare ${count || 'current'} hostel and student-room options connected to ${landing.university.name}, including prices, photos and the stated campus distance.`;
  }
  const place = locationLabel(landing.location);
  const detail = landing.facet.kind === 'bedrooms'
    ? `with exactly ${landing.facet.value} bedrooms`
    : landing.facet.kind === 'max_price'
      ? `priced up to UGX ${compactUgx(landing.facet.value)}`
      : landing.facet.kind === 'min_price'
        ? `priced from UGX ${compactUgx(landing.facet.value)}`
        : landing.facet.kind === 'title_type'
          ? `with ${landing.facet.value} title information`
          : landing.facet.kind === 'transaction_type'
            ? `listed for ${landing.facet.value}`
            : `matching ${landing.facet.label.toLowerCase()}`;
  return `Explore ${count || 'current'} reviewed makaug.com opportunities in ${place} ${detail}, with live prices, property facts and direct detail links.`;
}

function kyanjaApartmentCopy(landing, count, options = {}) {
  if (String(process.env.COUNTRY_CODE || 'UG').toUpperCase() !== 'UG'
    || landing.canonicalPath !== '/to-rent/kyanja-kampala/apartments'
    || count < SEO_FACET_MIN_LISTINGS) return null;
  const description = 'Apartments for rent in Kyanja, Kampala. Compare current asking prices, bedroom counts and photos, then confirm availability and arrange a viewing.';
  const introHtml = `<p class="mb-4 text-gray-700" data-landing-intro="1">Compare ${count} apartment rental ${count === 1 ? 'listing' : 'listings'} in Kyanja, Kampala. Open a property to check its stated rent, bedroom count, photos and contact details before arranging a viewing.</p>`;
  if (Number(options.page || 1) > 1) return { description, introHtml, bodyHtml: '' };
  // This is a sample of the cards on this page, never a neighbourhood average.
  // Weekly, annual and unspecified rents cannot be compared as monthly rents.
  const monthlyPrices = (options.listings || [])
    .filter((listing) => !listing.price_on_application && !listing.price_implausible
      && ['mo', 'month', 'monthly', 'per_month'].includes(String(listing.price_period || '').toLowerCase()))
    .map((listing) => Number(listing.price))
    .filter((price) => Number.isFinite(price) && price > 0);
  const prices = monthlyPrices.length >= 3
    ? `<p class="mt-3 text-gray-700">The ${monthlyPrices.length} cards shown here with a stated monthly asking rent range from UGX ${compactUgx(Math.min(...monthlyPrices))} to UGX ${compactUgx(Math.max(...monthlyPrices))} per month. This is the range in these advertised listings, rather than an estimate of all Kyanja rents; availability and the final agreed rent need confirmation.</p>`
    : '';
  const bodyHtml = `<section class="mt-8 rounded-2xl border border-green-100 bg-white p-5" data-landing-copy="1">
    <h2 class="text-xl font-black text-green-950">Comparing apartments for rent in Kyanja</h2>
    <p class="mt-3 text-gray-700">Compare the exact apartment, rather than the headline rent alone. Check which photos belong to the available unit, the bedroom and bathroom counts, and the property's stated location.</p>${prices}
    <h3 class="mt-5 font-black text-green-950">Before arranging a viewing</h3>
    <ul class="mt-3 list-disc space-y-2 pl-5 text-gray-700">
      <li>Confirm that the apartment is still available and ask for its exact address and viewing arrangements.</li>
      <li>Check whether the advertised amount is monthly, weekly or annual, and ask about advance rent, deposits, utilities and any agent fee.</li>
      <li>Inspect the unit and confirm the person offering it is authorised to rent it before paying. Keep a written record of the agreed terms.</li>
    </ul>
    <p class="mt-4 text-gray-700">For other property types, <a href="/to-rent/kyanja-kampala" class="font-semibold text-green-800 underline">browse all rentals in Kyanja</a>. Read the <a href="/safety" class="font-semibold text-green-800 underline">property safety guidance</a> before making a payment.</p>
  </section>`;
  return { description, introHtml, bodyHtml };
}

function publicSeoLandingMeta(landing, snapshot, baseUrl = 'https://makaug.com', options = {}) {
  const root = String(baseUrl || 'https://makaug.com').replace(/\/+$/, '');
  const snapshotCount = landingCount(snapshot, landing);
  const count = Number.isFinite(Number(options.count)) ? Math.max(0, Number(options.count)) : snapshotCount;
  const config = CATEGORY_SEO[landing.categoryKey];
  const universityLanding = landing.kind === 'university' || landing.kind === 'university-alias';
  const place = universityLanding ? landing.university.name : locationLabel(landing.location);
  const h1 = universityLanding
    ? `Hostels and student accommodation near ${landing.university.name}`
    : `${landing.facet.label} in ${place}`;
  const title = `${h1} — ${count} ${count === 1 ? 'Listing' : 'Listings'} | makaug.com`;
  const description = uniqueLandingIntro(landing, count);
  const copy = kyanjaApartmentCopy(landing, count, options);
  const state = {
    page: landing.categoryKey,
    locationId: landing.location?.canonical_key || '',
    area: universityLanding ? landing.university.name : place,
    propertyType: landing.facet?.kind === 'property_type' ? (landing.facet.searchValue || landing.facetSlug) : '',
    transactionType: landing.facet?.kind === 'transaction_type' ? landing.facet.value : '',
    bedrooms: landing.facet?.kind === 'bedrooms' ? String(landing.facet.value) : '',
    minPrice: landing.facet?.kind === 'min_price' ? String(landing.facet.value) : '',
    maxPrice: landing.facet?.kind === 'max_price' ? String(landing.facet.value) : '',
    landTitleType: landing.facet?.kind === 'title_type' ? String(landing.facet.value) : '',
    studentCampus: universityLanding ? landing.university.name : ''
  };
  return {
    key: landing.categoryKey,
    config,
    location: landing.location || null,
    count,
    h1,
    title,
    description: copy?.description || description,
    universitySlug: universityLanding ? landing.university.slug : '',
    ...(copy ? { landingIntroHtml: copy.introHtml, landingBodyHtml: copy.bodyHtml } : {}),
    canonical: `${root}${landing.canonicalPath}`,
    image: `${root}${config.image}`,
    routeState: state,
    breadcrumbs: [
      { name: 'Home', url: `${root}/` },
      { name: config.label, url: `${root}${config.route}` },
      ...(landing.location ? [{ name: locationLabel(landing.location), url: `${root}${config.route}/${canonicalLocationRouteSlug(landing.location)}` }] : []),
      { name: universityLanding ? landing.university.name : landing.facet.label, url: `${root}${landing.canonicalPath}` }
    ]
  };
}

function siblingFacetLinks(snapshot, landing) {
  if (!landing?.location) return [];
  const config = CATEGORY_SEO[landing.categoryKey];
  const locationSlug = facetLocationSlug(landing.location);
  const links = Object.entries(FACET_DEFINITIONS[landing.categoryKey] || {}).map(([slug, definition]) => ({
    href: `${config.route}/${locationSlug}/${slug}`,
    label: definition.label,
    count: Number(snapshot?.facetCounts?.[landing.categoryKey]?.get(`${landing.location.canonical_key}|${slug}`) || 0)
  }));
  if (landing.categoryKey === 'commercial') {
    for (const [slug, definition] of Object.entries({
      'for-rent': commercialTransactionFacet('for-rent'),
      'for-sale': commercialTransactionFacet('for-sale')
    })) {
      links.push({
        href: `/commercial/${slug}/${locationSlug}`,
        label: definition.label,
        count: Number(snapshot?.commercialTransactionCounts?.get(`${landing.location.canonical_key}|${slug}`) || 0)
      });
    }
  }
  return links.filter((link) => link.count >= SEO_FACET_MIN_LISTINGS && link.href !== landing.canonicalPath);
}

module.exports = {
  SEO_FACET_MIN_LISTINGS,
  UNIVERSITY_LANDINGS,
  flexibleLocationForSlug,
  resolvePublicSeoLanding,
  landingCount,
  publicSeoLandingMeta,
  siblingFacetLinks
};
