'use strict';

// /advertise packages and the in-page house-ad bands. Every amount comes from
// the rate card (config/pricing.js), and the display rule applies to all of
// them: a weekly price inside 50,000–200,000 is sold as is, anything else is
// "Price on request" (price_ugx null, quote_on_request true). Bookings of 28
// days or more get the 4-week discount as its own quote line.
const PRICING = require('../config/pricing');

const PACKAGE_PRICES = new Map(PRICING.display.packages.map((row) => [row.key, row]));
const BAND_PRICES = new Map(PRICING.display.bands.map((row) => [row.key, row.weekly_price_ugx]));

const ADVERTISING_PACKAGES = [
  {
    key: 'featured_property_boost',
    label: 'Featured Property Boost',
    category: 'listing_boost',
    rate_card_line: 'featured',
    pricing_model: 'fixed_days',
    placements: ['property_search', 'category_pages', 'similar_properties'],
    description: 'Push one approved listing higher in matching search journeys and similar-property recommendations.'
  },
  {
    key: 'regional_search_boost',
    label: 'Regional Search Boost',
    category: 'regional',
    pricing_model: 'fixed_days',
    placements: ['district_search', 'area_search', 'map_results'],
    description: 'Promote a property, agent, or business to people searching specific districts and areas.'
  },
  {
    key: 'homepage_banner',
    label: 'Homepage Banner',
    category: 'display',
    pricing_model: 'fixed_days',
    placements: ['homepage_top', 'homepage_mid'],
    description: 'Premium brand visibility on the makaug homepage.'
  },
  {
    key: 'agent_spotlight',
    label: 'Agent Spotlight',
    category: 'agent',
    pricing_model: 'fixed_days',
    placements: ['find_brokers', 'agent_cards', 'property_detail'],
    description: 'Feature a verified broker profile in broker discovery and relevant property journeys.'
  },
  {
    key: 'student_accommodation_push',
    label: 'Student Accommodation Push',
    category: 'student',
    pricing_model: 'fixed_days',
    placements: ['students_page', 'university_search', 'whatsapp_student_results'],
    description: 'Promote hostels, studios, and student rooms near universities and student search flows.'
  },
  {
    key: 'commercial_land_sponsor',
    label: 'Commercial and Land Sponsor',
    category: 'commercial_land',
    pricing_model: 'fixed_days',
    placements: ['commercial_page', 'land_page', 'map_results'],
    description: 'Sponsor commercial property or land inventory for investors and business buyers.'
  },
  {
    key: 'whatsapp_chatbot_sponsor',
    label: 'WhatsApp Chatbot Sponsor',
    category: 'whatsapp',
    pricing_model: 'fixed_days',
    placements: ['whatsapp_search_results', 'whatsapp_agent_results'],
    description: 'Appear inside relevant WhatsApp assistant recommendations where the ad matches the user intent.'
  },
  {
    key: 'haymaker_all_platform',
    label: 'Haymaker All-Platform Package',
    category: 'bundle',
    pricing_model: 'fixed_days',
    placements: ['homepage', 'search', 'map', 'whatsapp', 'email', 'agent_cards'],
    description: 'Full-suite campaign across website, search, WhatsApp assistant, email, and featured placements.'
  },
  {
    key: 'creative_design_addon',
    label: 'Creative Design Add-on',
    category: 'creative',
    pricing_model: 'one_off',
    placements: ['creative_service'],
    description: 'makaug prepares banner copy and size-ready creative from the advertiser logo and offer.'
  }
];

const ADVERTISING_PLACEMENTS = [
  {
    key: 'home-featured',
    label: 'Homepage Featured Properties Band',
    page_key: 'home',
    slot_type: 'house_band',
    size_label: 'Full width x 200px',
    is_premium: true,
    is_active: true,
    preview_image_url: '/assets/house-ads-v3/home-hero.webp',
    headline: 'Home starts here.',
    cta_label: 'Advertise here',
    cta_url: '/advertise',
    background_position: 'left center',
    copy_side: 'right',
    notes: 'House Ads v3 band after homepage featured properties.',
    sort_order: 10
  },
  {
    key: 'home-brokers',
    label: 'Homepage Featured Agents Band',
    page_key: 'home',
    slot_type: 'house_band',
    size_label: 'Full width x 200px',
    is_premium: true,
    is_active: true,
    preview_image_url: '/assets/house-ads-v3/agents.webp',
    headline: 'The right hands for your keys.',
    cta_label: 'Advertise here',
    cta_url: '/advertise',
    background_position: 'left center',
    copy_side: 'right',
    notes: 'House Ads v3 band after homepage featured agents.',
    sort_order: 20
  },
  {
    key: 'sale-grid',
    label: 'For Sale Results Band',
    page_key: 'sale',
    slot_type: 'house_band',
    size_label: 'Full width x 200px',
    is_premium: false,
    is_active: true,
    preview_image_url: '/assets/house-ads-v3/sale.webp',
    headline: 'Say hello to yours.',
    cta_label: 'Advertise here',
    cta_url: '/advertise',
    background_position: 'center 30%',
    copy_side: 'right',
    notes: 'House Ads v3 band after for-sale results.',
    sort_order: 30
  },
  {
    key: 'rent-grid',
    label: 'Rental Results Band',
    page_key: 'rent',
    slot_type: 'house_band',
    size_label: 'Full width x 200px',
    is_premium: false,
    is_active: true,
    preview_image_url: '/assets/house-ads-v3/rent.webp',
    headline: 'Move in Monday.',
    cta_label: 'Advertise here',
    cta_url: '/advertise',
    background_position: 'left center',
    copy_side: 'right',
    notes: 'House Ads v3 band after rental results.',
    sort_order: 40
  },
  {
    key: 'student-grid',
    label: 'Student Accommodation Results Band',
    page_key: 'students',
    slot_type: 'house_band',
    size_label: 'Full width x 200px',
    is_premium: true,
    is_active: true,
    preview_image_url: '/assets/house-ads-v3/students.webp',
    headline: 'Your campus. Your room.',
    cta_label: 'Advertise here',
    cta_url: '/advertise',
    background_position: 'left 25%',
    copy_side: 'right',
    notes: 'House Ads v3 band after student accommodation results.',
    sort_order: 50
  },
  {
    key: 'commercial-grid',
    label: 'Commercial Results Band',
    page_key: 'commercial',
    slot_type: 'house_band',
    size_label: 'Full width x 200px',
    is_premium: true,
    is_active: true,
    preview_image_url: '/assets/house-ads-v3/commercial.webp',
    headline: 'Open for business.',
    cta_label: 'Advertise here',
    cta_url: '/advertise',
    background_position: 'right center',
    copy_side: 'left',
    notes: 'House Ads v3 mirrored band after commercial results.',
    sort_order: 60
  },
  {
    key: 'land-grid',
    label: 'Land Results Band',
    page_key: 'land',
    slot_type: 'house_band',
    size_label: 'Full width x 200px',
    is_premium: true,
    is_active: true,
    preview_image_url: '/assets/house-ads-v3/land.webp',
    headline: 'Own the hill.',
    cta_label: 'Advertise here',
    cta_url: '/advertise',
    background_position: 'center 40%',
    copy_side: 'right',
    notes: 'House Ads v3 band after land results.',
    sort_order: 70
  },
  {
    key: 'marketplace-results',
    label: 'Marketplace Results Band',
    page_key: 'marketplace',
    slot_type: 'house_band',
    size_label: 'Full width x 200px',
    is_premium: false,
    is_active: true,
    preview_image_url: '/assets/house-ads-v3/marketplace.webp',
    headline: 'Built by people who care.',
    cta_label: 'Advertise here',
    cta_url: '/advertise',
    background_position: 'left center',
    copy_side: 'right',
    notes: 'House Ads v3 band after marketplace results.',
    sort_order: 80
  },
  {
    key: 'brokers-grid',
    label: 'Broker Directory Band',
    page_key: 'brokers',
    slot_type: 'house_band',
    size_label: 'Full width x 200px',
    is_premium: false,
    is_active: true,
    preview_image_url: '/assets/house-ads-v3/brokers.webp',
    headline: 'Walk in with an expert.',
    cta_label: 'Advertise here',
    cta_url: '/advertise',
    background_position: '20% center',
    copy_side: 'right',
    notes: 'House Ads v3 band after broker directory results.',
    sort_order: 90
  },
  {
    key: 'mortgage-results',
    label: 'Mortgage Results Band',
    page_key: 'mortgage',
    slot_type: 'house_band',
    size_label: 'Full width x 200px',
    is_premium: true,
    is_active: true,
    preview_image_url: '/assets/house-ads-v3/mortgage.webp',
    headline: 'Closer than you think.',
    cta_label: 'Advertise here',
    cta_url: '/advertise',
    background_position: '25% 30%',
    copy_side: 'right',
    notes: 'House Ads v3 band after mortgage results.',
    sort_order: 100
  },
  {
    key: 'property-detail',
    label: 'Property Detail Band',
    page_key: 'property_detail',
    slot_type: 'house_band',
    size_label: 'Full width x 200px',
    is_premium: false,
    is_active: true,
    preview_image_url: '/assets/house-ads-v3/detail.webp',
    headline: 'Open the door.',
    cta_label: 'Advertise here',
    cta_url: '/advertise',
    background_position: 'left center',
    copy_side: 'right',
    notes: 'House Ads v3 band after property detail content.',
    sort_order: 110
  }
];

function pricedPackage(item) {
  if (item.rate_card_line) {
    const line = PRICING[item.rate_card_line];
    const days = line.days || 7;
    return {
      ...item,
      ...PRICING.displayOffer(line.amount_ugx, days),
      // The rate-card line is sold at its own price, inside the display range or not.
      price_ugx: line.amount_ugx,
      quote_on_request: false,
      duration_days: days,
      pricing_model: 'fixed_days',
      price_period: line.period,
      vat_label: PRICING.vat.label
    };
  }
  const price = PACKAGE_PRICES.get(item.key) || {};
  const days = Number(price.duration_days || 0);
  return {
    ...item,
    duration_days: days,
    pricing_model: days > 0 ? 'fixed_days' : 'one_off',
    ...PRICING.displayOffer(price.price_ugx, days),
    price_period: days > 0 ? `${days} days` : 'one-off',
    vat_label: PRICING.vat.label
  };
}

function pricedPlacement(item) {
  const offer = PRICING.displayOffer(BAND_PRICES.has(item.key) ? BAND_PRICES.get(item.key) : item.base_price_ugx, 7);
  return {
    ...item,
    base_price_ugx: offer.price_ugx,
    price_period: 'week',
    quote_on_request: offer.quote_on_request,
    vat_label: PRICING.vat.label
  };
}

function getAdvertisingPackages() {
  return ADVERTISING_PACKAGES.map((item) => pricedPackage(item));
}

function getAdvertisingPlacements() {
  return ADVERTISING_PLACEMENTS.map((item) => pricedPlacement(item));
}

function findAdvertisingPlacement(key) {
  const normalized = String(key || '').trim().toLowerCase();
  return getAdvertisingPlacements().find((item) => item.key === normalized) || null;
}

// A database row may carry an old price (the 650k sitewide leaderboard, a
// 350k band): the catalog/rate card wins for catalog keys, and every price
// goes through the display rule.
function mergePlacementWithCatalog(row = {}) {
  const catalog = findAdvertisingPlacement(row.key);
  if (catalog) {
    // Staff copy edits (headline, CTA, image…) still win; the price never does.
    return {
      ...catalog,
      ...row,
      base_price_ugx: catalog.base_price_ugx,
      price_period: catalog.price_period,
      quote_on_request: catalog.quote_on_request,
      vat_label: catalog.vat_label
    };
  }
  return pricedPlacement({ ...row });
}

function mergePlacementRowsWithCatalog(rows = []) {
  const rowMap = new Map(
    (Array.isArray(rows) ? rows : [])
      .filter((row) => row && row.key)
      .map((row) => [String(row.key).trim().toLowerCase(), row])
  );
  const merged = ADVERTISING_PLACEMENTS.map((item) => (
    mergePlacementWithCatalog(rowMap.get(item.key) || item)
  ));
  const catalogKeys = new Set(ADVERTISING_PLACEMENTS.map((item) => item.key));
  for (const row of rowMap.values()) {
    if (!catalogKeys.has(String(row.key).trim().toLowerCase())) {
      merged.push(mergePlacementWithCatalog({ ...row }));
    }
  }
  return merged;
}

function getAdvertisingRateCard() {
  return {
    currency: 'UGX',
    rate_card_version: PRICING.version,
    vat: { included: true, label: PRICING.vat.label },
    display: {
      min_weekly_ugx: PRICING.display.min_weekly_ugx,
      max_weekly_ugx: PRICING.display.max_weekly_ugx,
      four_week_discount_percent: PRICING.display.four_week_discount_percent
    },
    placements: getAdvertisingPlacements(),
    packages: getAdvertisingPackages()
  };
}

function findAdvertisingPackage(key) {
  const normalized = String(key || '').trim().toLowerCase();
  return getAdvertisingPackages().find((item) => item.key === normalized) || null;
}

// Unknown keys (including the removed email/WhatsApp blast on old enquiries)
// are ignored, so old enquiries still render.
function summarizeAdvertisingPackageKeys(keys = []) {
  const selected = new Set((Array.isArray(keys) ? keys : [keys]).map((key) => String(key || '').trim().toLowerCase()).filter(Boolean));
  return getAdvertisingPackages().filter((item) => selected.has(item.key));
}

/**
 * A quote: one line per priced item, the 10% four-week discount as its own
 * line for bookings of 28 days or more, and the price-on-request items listed
 * separately (staff quote them, or the advertiser's budget stands).
 * Packages are priced for their own duration; placements per week.
 */
function buildAdvertisingQuoteBreakdown({ packageKeys = [], placementKeys = [], durationDays = 7 } = {}) {
  const lines = [];
  const onRequest = [];
  let longestDays = 0;
  for (const pkg of summarizeAdvertisingPackageKeys(packageKeys)) {
    longestDays = Math.max(longestDays, Number(pkg.duration_days || 0));
    if (pkg.quote_on_request || pkg.price_ugx == null) onRequest.push({ key: pkg.key, label: pkg.label });
    else lines.push({ kind: 'package', key: pkg.key, label: pkg.label, amount_ugx: pkg.price_ugx, duration_days: pkg.duration_days });
  }
  const weeks = Math.max(1, Math.ceil(Math.max(1, Number(durationDays) || 7) / 7));
  const placementList = (Array.isArray(placementKeys) ? placementKeys : [placementKeys]).filter(Boolean);
  if (placementList.length) longestDays = Math.max(longestDays, weeks * 7);
  for (const key of placementList) {
    const placement = findAdvertisingPlacement(key);
    if (!placement) continue;
    if (placement.quote_on_request || placement.base_price_ugx == null) onRequest.push({ key: placement.key, label: placement.label });
    else lines.push({ kind: 'placement', key: placement.key, label: `${placement.label} × ${weeks} week${weeks === 1 ? '' : 's'}`, amount_ugx: placement.base_price_ugx * weeks, duration_days: weeks * 7 });
  }
  const subtotal = lines.reduce((sum, line) => sum + Number(line.amount_ugx || 0), 0);
  const discount = PRICING.fourWeekDiscountUgx(subtotal, Math.max(longestDays, Number(durationDays) || 0));
  if (discount > 0) {
    lines.push({ kind: 'discount', key: 'four_week_discount', label: `${PRICING.display.four_week_discount_percent}% off 4-week booking`, amount_ugx: -discount });
  }
  return {
    lines,
    subtotal_ugx: subtotal,
    discount_ugx: discount,
    total_ugx: subtotal - discount,
    quote_on_request: onRequest,
    has_quote_on_request: onRequest.length > 0,
    vat_label: PRICING.vat.label
  };
}

function estimateAdvertisingQuote(keys = [], options = {}) {
  return buildAdvertisingQuoteBreakdown({ packageKeys: keys, durationDays: options.durationDays || 7 }).total_ugx;
}

module.exports = {
  getAdvertisingPackages,
  getAdvertisingPlacements,
  getAdvertisingRateCard,
  findAdvertisingPackage,
  findAdvertisingPlacement,
  mergePlacementWithCatalog,
  mergePlacementRowsWithCatalog,
  summarizeAdvertisingPackageKeys,
  buildAdvertisingQuoteBreakdown,
  estimateAdvertisingQuote
};
