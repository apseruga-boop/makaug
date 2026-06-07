const ADVERTISING_USD_RATE = Math.max(1, Number(process.env.ADVERTISING_USD_RATE || 3800));

const CREATIVE_ACCEPTED_FORMATS = ['JPG', 'PNG', 'WebP'];
const CREATIVE_MAX_FILE_SIZE_MB = 2;

const CREATIVE_GUIDELINES = {
  accepted_formats: CREATIVE_ACCEPTED_FORMATS,
  max_file_size_mb: CREATIVE_MAX_FILE_SIZE_MB,
  safe_area_note: 'Keep key text, logo, and call-to-action inside the central 80% safe area so mobile crops do not hide them.',
  prompt_template: [
    'Create a polished makaug.com display advert for {brand_or_property}.',
    'Ad placement: {placement_label}. Required image size: {primary_size}. Also prepare mobile-safe composition for {mobile_size}.',
    'Audience: property seekers in {target_locations}. Offer: {offer}.',
    'Style: Uganda property marketplace, clean, premium, trustworthy, no clutter, high-contrast CTA.',
    'Include readable headline: {headline}. CTA: {call_to_action}.',
    'Leave space for makaug sponsored label and do not add tiny unreadable text.'
  ].join(' ')
};

const ADVERTISING_PLACEMENTS = [
  {
    key: 'sitewide_top_leaderboard',
    label: 'Sitewide Top Leaderboard',
    page_key: 'all',
    page_label: 'All main discovery pages',
    slot_type: 'leaderboard',
    size_label: '970x250 desktop / 320x100 mobile',
    primary_size: '970x250',
    mobile_size: '320x100',
    is_premium: true,
    base_price_ugx: 650000,
    daily_price_ugx: 120000,
    weekly_price_ugx: 650000,
    monthly_price_ugx: 2200000,
    cpm_price_ugx: 52000,
    minimum_duration_days: 1,
    preview_image_url: 'https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=1200&q=80',
    notes: 'Premium banner across the main homepage, rent, sale, land, commercial, student, and broker discovery journeys.',
    sort_order: 10
  },
  {
    key: 'homepage_hero_sponsor',
    label: 'Homepage Hero Sponsor',
    page_key: 'home',
    page_label: 'Homepage',
    slot_type: 'hero',
    size_label: 'Full-width hero sponsor / 970x250 fallback',
    primary_size: '1600x520',
    mobile_size: '1080x1080',
    is_premium: true,
    base_price_ugx: 350000,
    daily_price_ugx: 70000,
    weekly_price_ugx: 350000,
    monthly_price_ugx: 1200000,
    cpm_price_ugx: 45000,
    minimum_duration_days: 1,
    preview_image_url: 'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=1200&q=80',
    notes: 'High-visibility homepage sponsor placement for property, brand, lender, agency, or launch offer.',
    sort_order: 20
  },
  {
    key: 'sale_inline_native',
    label: 'For Sale Inline Sponsored Card',
    page_key: 'sale',
    page_label: 'For sale results',
    slot_type: 'native_card',
    size_label: 'Listing grid card / 1200x800 image',
    primary_size: '1200x800',
    mobile_size: '1080x1080',
    is_premium: false,
    base_price_ugx: 180000,
    daily_price_ugx: 35000,
    weekly_price_ugx: 180000,
    monthly_price_ugx: 650000,
    cpm_price_ugx: 30000,
    minimum_duration_days: 1,
    preview_image_url: 'https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=1200&q=80',
    notes: 'Native sponsored card in for-sale search results.',
    sort_order: 30
  },
  {
    key: 'rent_inline_native',
    label: 'Rental Inline Sponsored Card',
    page_key: 'rent',
    page_label: 'Rental results',
    slot_type: 'native_card',
    size_label: 'Listing grid card / 1200x800 image',
    primary_size: '1200x800',
    mobile_size: '1080x1080',
    is_premium: false,
    base_price_ugx: 180000,
    daily_price_ugx: 35000,
    weekly_price_ugx: 180000,
    monthly_price_ugx: 650000,
    cpm_price_ugx: 30000,
    minimum_duration_days: 1,
    preview_image_url: 'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=1200&q=80',
    notes: 'Native sponsored card in rental search results.',
    sort_order: 40
  },
  {
    key: 'students_leaderboard',
    label: 'Student Page Leaderboard',
    page_key: 'students',
    page_label: 'Student accommodation',
    slot_type: 'leaderboard',
    size_label: '970x250 desktop / 320x100 mobile',
    primary_size: '970x250',
    mobile_size: '320x100',
    is_premium: true,
    base_price_ugx: 220000,
    daily_price_ugx: 45000,
    weekly_price_ugx: 220000,
    monthly_price_ugx: 780000,
    cpm_price_ugx: 36000,
    minimum_duration_days: 1,
    preview_image_url: 'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?w=1200&q=80',
    notes: 'Student accommodation sponsor and university targeting.',
    sort_order: 50
  },
  {
    key: 'commercial_leaderboard',
    label: 'Commercial Page Leaderboard',
    page_key: 'commercial',
    page_label: 'Commercial property',
    slot_type: 'leaderboard',
    size_label: '970x250 desktop / 320x100 mobile',
    primary_size: '970x250',
    mobile_size: '320x100',
    is_premium: true,
    base_price_ugx: 240000,
    daily_price_ugx: 50000,
    weekly_price_ugx: 240000,
    monthly_price_ugx: 850000,
    cpm_price_ugx: 38000,
    minimum_duration_days: 1,
    preview_image_url: 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=1200&q=80',
    notes: 'Business, office, retail, and commercial investor sponsor.',
    sort_order: 60
  },
  {
    key: 'land_leaderboard',
    label: 'Land Page Leaderboard',
    page_key: 'land',
    page_label: 'Land',
    slot_type: 'leaderboard',
    size_label: '970x250 desktop / 320x100 mobile',
    primary_size: '970x250',
    mobile_size: '320x100',
    is_premium: true,
    base_price_ugx: 240000,
    daily_price_ugx: 50000,
    weekly_price_ugx: 240000,
    monthly_price_ugx: 850000,
    cpm_price_ugx: 38000,
    minimum_duration_days: 1,
    preview_image_url: 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=1200&q=80',
    notes: 'Land buyers, surveyors, legal support, and developers.',
    sort_order: 70
  },
  {
    key: 'brokers_spotlight',
    label: 'Broker Directory Spotlight',
    page_key: 'brokers',
    page_label: 'Broker directory',
    slot_type: 'spotlight',
    size_label: 'Profile spotlight / 1200x800 image',
    primary_size: '1200x800',
    mobile_size: '1080x1080',
    is_premium: false,
    base_price_ugx: 160000,
    daily_price_ugx: 30000,
    weekly_price_ugx: 160000,
    monthly_price_ugx: 580000,
    cpm_price_ugx: 28000,
    minimum_duration_days: 1,
    preview_image_url: 'https://images.unsplash.com/photo-1521791136064-7986c2920216?w=1200&q=80',
    notes: 'Featured broker or agency promotion.',
    sort_order: 80
  },
  {
    key: 'property_detail_mpu',
    label: 'Property Detail MPU',
    page_key: 'property_detail',
    page_label: 'Property detail pages',
    slot_type: 'mpu',
    size_label: '300x250 desktop / responsive',
    primary_size: '300x250',
    mobile_size: '320x100',
    is_premium: false,
    base_price_ugx: 120000,
    daily_price_ugx: 25000,
    weekly_price_ugx: 120000,
    monthly_price_ugx: 430000,
    cpm_price_ugx: 24000,
    minimum_duration_days: 1,
    preview_image_url: 'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=1200&q=80',
    notes: 'Contextual ad on property detail pages.',
    sort_order: 90
  },
  {
    key: 'whatsapp_sponsored_match',
    label: 'WhatsApp Sponsored Match',
    page_key: 'whatsapp',
    page_label: 'WhatsApp assistant',
    slot_type: 'chatbot_native',
    size_label: 'Assistant result card / text plus 1080x1080 creative',
    primary_size: '1080x1080',
    mobile_size: '1080x1080',
    is_premium: true,
    base_price_ugx: 200000,
    daily_price_ugx: 40000,
    weekly_price_ugx: 200000,
    monthly_price_ugx: 720000,
    cpm_price_ugx: 34000,
    minimum_duration_days: 1,
    preview_image_url: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=1200&q=80',
    notes: 'Sponsored result inside WhatsApp AI property, agent, and campaign journeys.',
    sort_order: 100
  },
  {
    key: 'whatsapp_bulk_audience',
    label: 'WhatsApp Bulk Audience Campaign',
    page_key: 'whatsapp',
    page_label: 'Opted-in WhatsApp audience',
    slot_type: 'broadcast',
    size_label: 'Approved text plus 1080x1080 image',
    primary_size: '1080x1080',
    mobile_size: '1080x1080',
    is_premium: true,
    base_price_ugx: 300000,
    daily_price_ugx: 300000,
    weekly_price_ugx: 300000,
    monthly_price_ugx: 0,
    cpm_price_ugx: 65000,
    minimum_duration_days: 1,
    preview_image_url: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=1200&q=80',
    notes: 'Bulk WhatsApp advertising to approved opt-in audience segments. Exact quote depends on segment, compliance approval, and send volume.',
    sort_order: 110,
    manual_quote_required: true
  }
];

const ADVERTISING_PACKAGES = [
  {
    key: 'featured_property_boost',
    label: 'Featured Property Boost',
    category: 'listing_boost',
    price_ugx: 75000,
    duration_days: 7,
    pricing_model: 'fixed_days',
    placements: ['property_search', 'category_pages', 'similar_properties'],
    placement_keys: ['sale_inline_native', 'rent_inline_native', 'property_detail_mpu'],
    description: 'Push one approved listing higher in matching search journeys and similar-property recommendations.'
  },
  {
    key: 'regional_search_boost',
    label: 'Regional Search Boost',
    category: 'regional',
    price_ugx: 150000,
    duration_days: 14,
    pricing_model: 'fixed_days',
    placements: ['district_search', 'area_search', 'map_results'],
    placement_keys: ['sale_inline_native', 'rent_inline_native'],
    description: 'Promote a property, agent, or business to people searching specific districts and areas.'
  },
  {
    key: 'homepage_banner',
    label: 'Homepage Banner',
    category: 'display',
    price_ugx: 350000,
    duration_days: 7,
    pricing_model: 'fixed_days',
    placements: ['homepage_top', 'homepage_mid'],
    placement_keys: ['homepage_hero_sponsor'],
    description: 'Premium brand visibility on the makaug homepage.'
  },
  {
    key: 'agent_spotlight',
    label: 'Agent Spotlight',
    category: 'agent',
    price_ugx: 160000,
    duration_days: 7,
    pricing_model: 'fixed_days',
    placements: ['find_brokers', 'agent_cards', 'property_detail'],
    placement_keys: ['brokers_spotlight', 'property_detail_mpu'],
    description: 'Feature a verified broker profile in broker discovery and relevant property journeys.'
  },
  {
    key: 'student_accommodation_push',
    label: 'Student Accommodation Push',
    category: 'student',
    price_ugx: 220000,
    duration_days: 7,
    pricing_model: 'fixed_days',
    placements: ['students_page', 'university_search', 'whatsapp_student_results'],
    placement_keys: ['students_leaderboard', 'whatsapp_sponsored_match'],
    description: 'Promote hostels, studios, and student rooms near universities and student search flows.'
  },
  {
    key: 'commercial_land_sponsor',
    label: 'Commercial and Land Sponsor',
    category: 'commercial_land',
    price_ugx: 240000,
    duration_days: 7,
    pricing_model: 'fixed_days',
    placements: ['commercial_page', 'land_page', 'map_results'],
    placement_keys: ['commercial_leaderboard', 'land_leaderboard'],
    description: 'Sponsor commercial property or land inventory for investors and business buyers.'
  },
  {
    key: 'whatsapp_chatbot_sponsor',
    label: 'WhatsApp Chatbot Sponsor',
    category: 'whatsapp',
    price_ugx: 200000,
    duration_days: 7,
    pricing_model: 'fixed_days',
    placements: ['whatsapp_search_results', 'whatsapp_agent_results'],
    placement_keys: ['whatsapp_sponsored_match'],
    description: 'Appear inside relevant WhatsApp assistant recommendations where the ad matches the user intent.'
  },
  {
    key: 'email_whatsapp_blast',
    label: 'Email and WhatsApp Campaign',
    category: 'campaign',
    price_ugx: 300000,
    duration_days: 1,
    pricing_model: 'one_off',
    placements: ['email', 'whatsapp_broadcast'],
    placement_keys: ['whatsapp_bulk_audience'],
    description: 'Send an approved offer to an opted-in makaug audience segment. Final WhatsApp bulk pricing depends on segment and volume.'
  },
  {
    key: 'haymaker_all_platform',
    label: 'Haymaker All-Platform Package',
    category: 'bundle',
    price_ugx: 950000,
    duration_days: 30,
    pricing_model: 'fixed_days',
    placements: ['homepage', 'search', 'map', 'whatsapp', 'email', 'agent_cards'],
    placement_keys: ['homepage_hero_sponsor', 'sale_inline_native', 'rent_inline_native', 'brokers_spotlight', 'whatsapp_sponsored_match'],
    description: 'Full-suite campaign across website, search, WhatsApp assistant, email, and featured placements.'
  },
  {
    key: 'creative_design_addon',
    label: 'Creative Design Add-on',
    category: 'creative',
    price_ugx: 80000,
    duration_days: 0,
    pricing_model: 'one_off',
    placements: ['creative_service'],
    placement_keys: [],
    description: 'makaug prepares banner copy and size-ready creative from the advertiser logo and offer.'
  }
];

function copy(item) {
  return item && typeof item === 'object' ? { ...item } : item;
}

function formatUgx(value) {
  return `UGX ${Number(value || 0).toLocaleString('en-UG')}`;
}

function formatUsdFromUgx(value) {
  const usd = Number(value || 0) / ADVERTISING_USD_RATE;
  return `USD ${Math.max(0, usd).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function getAdvertisingPackages() {
  return ADVERTISING_PACKAGES.map((item) => ({
    ...copy(item),
    price_usd: Math.round(Number(item.price_ugx || 0) / ADVERTISING_USD_RATE)
  }));
}

function getAdvertisingPlacements() {
  return ADVERTISING_PLACEMENTS
    .map((item) => decoratePlacement(item))
    .sort((a, b) => Number(a.sort_order || 100) - Number(b.sort_order || 100));
}

function findAdvertisingPackage(key) {
  const normalized = String(key || '').trim().toLowerCase();
  return getAdvertisingPackages().find((item) => item.key === normalized) || null;
}

function findAdvertisingPlacement(key) {
  const normalized = String(key || '').trim().toLowerCase();
  return getAdvertisingPlacements().find((item) => item.key === normalized) || null;
}

function summarizeAdvertisingPackageKeys(keys = []) {
  const selected = new Set((Array.isArray(keys) ? keys : [keys]).map((key) => String(key || '').trim().toLowerCase()).filter(Boolean));
  return getAdvertisingPackages().filter((item) => selected.has(item.key));
}

function summarizeAdvertisingPlacementKeys(keys = []) {
  const selected = new Set((Array.isArray(keys) ? keys : [keys]).map((key) => String(key || '').trim().toLowerCase()).filter(Boolean));
  return getAdvertisingPlacements().filter((item) => selected.has(item.key));
}

function normalizePositiveInt(value, fallback = 0) {
  const number = parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function quotePlacement(placement, { durationDays = 7, impressions = 0 } = {}) {
  const safeDuration = normalizePositiveInt(durationDays, 7);
  const safeImpressions = normalizePositiveInt(impressions, 0);
  const weekly = Number(placement.weekly_price_ugx || placement.base_price_ugx || 0);
  const daily = Number(placement.daily_price_ugx || Math.ceil(weekly / 5) || 0);
  const monthly = Number(placement.monthly_price_ugx || weekly * 4 || 0);
  let durationAmount = weekly;
  let durationLabel = '7 days';

  if (safeDuration <= 1) {
    durationAmount = daily;
    durationLabel = '1 day';
  } else if (safeDuration >= 28 && monthly > 0) {
    durationAmount = monthly;
    durationLabel = '1 month';
  } else if (safeDuration !== 7) {
    durationAmount = Math.max(daily * safeDuration, Math.ceil((weekly / 7) * safeDuration));
    durationLabel = `${safeDuration} days`;
  }

  const impressionAmount = safeImpressions > 0
    ? Math.ceil(safeImpressions / 1000) * Number(placement.cpm_price_ugx || 0)
    : 0;

  return {
    placement_key: placement.key,
    placement_label: placement.label,
    duration_days: safeDuration,
    duration_label: durationLabel,
    duration_amount_ugx: durationAmount,
    impressions: safeImpressions,
    cpm_price_ugx: Number(placement.cpm_price_ugx || 0),
    impression_amount_ugx: impressionAmount,
    total_ugx: durationAmount + impressionAmount
  };
}

function buildAdvertisingQuoteBreakdown({
  packageKeys = [],
  placementKeys = [],
  durationDays = 7,
  impressions = 0
} = {}) {
  const packages = summarizeAdvertisingPackageKeys(packageKeys).map((pkg) => ({
    type: 'package',
    key: pkg.key,
    label: pkg.label,
    price_ugx: Number(pkg.price_ugx || 0),
    duration_days: Number(pkg.duration_days || 0),
    pricing_model: pkg.pricing_model
  }));
  const placements = summarizeAdvertisingPlacementKeys(placementKeys).map((placement) => quotePlacement(placement, { durationDays, impressions }));
  const total = packages.reduce((sum, item) => sum + item.price_ugx, 0)
    + placements.reduce((sum, item) => sum + item.total_ugx, 0);
  return {
    currency: 'UGX',
    display_currency: 'USD',
    ugx_per_usd: ADVERTISING_USD_RATE,
    package_items: packages,
    placement_items: placements,
    total_ugx: total,
    total_usd: Math.round(total / ADVERTISING_USD_RATE),
    total_label: `${formatUgx(total)} (${formatUsdFromUgx(total)})`
  };
}

function estimateAdvertisingQuote(keys = []) {
  return summarizeAdvertisingPackageKeys(keys).reduce((total, item) => total + Number(item.price_ugx || 0), 0);
}

function decoratePlacement(item = {}) {
  const base = {
    ...copy(item),
    is_active: Object.prototype.hasOwnProperty.call(item, 'is_active') ? !!item.is_active : true,
    accepted_formats: CREATIVE_ACCEPTED_FORMATS,
    max_file_size_mb: CREATIVE_MAX_FILE_SIZE_MB,
    price_labels: {
      day: formatUgx(item.daily_price_ugx || item.base_price_ugx || 0),
      week: formatUgx(item.weekly_price_ugx || item.base_price_ugx || 0),
      month: item.monthly_price_ugx ? formatUgx(item.monthly_price_ugx) : 'Quote required',
      cpm: formatUgx(item.cpm_price_ugx || 0)
    },
    usd_labels: {
      day: formatUsdFromUgx(item.daily_price_ugx || item.base_price_ugx || 0),
      week: formatUsdFromUgx(item.weekly_price_ugx || item.base_price_ugx || 0),
      month: item.monthly_price_ugx ? formatUsdFromUgx(item.monthly_price_ugx) : 'Quote required',
      cpm: formatUsdFromUgx(item.cpm_price_ugx || 0)
    }
  };
  base.creative_prompt = CREATIVE_GUIDELINES.prompt_template
    .replace('{placement_label}', base.label || 'makaug display advert')
    .replace('{primary_size}', base.primary_size || base.size_label || '970x250')
    .replace('{mobile_size}', base.mobile_size || '320x100');
  return base;
}

function mergePlacementWithCatalog(row = {}) {
  const catalog = findAdvertisingPlacement(row.key) || {};
  return decoratePlacement({
    ...catalog,
    ...row,
    base_price_ugx: row.base_price_ugx != null ? Number(row.base_price_ugx || 0) : catalog.base_price_ugx,
    weekly_price_ugx: row.base_price_ugx != null ? Number(row.base_price_ugx || 0) : catalog.weekly_price_ugx,
    notes: row.notes || catalog.notes,
    preview_image_url: row.preview_image_url || catalog.preview_image_url,
    sort_order: row.sort_order != null ? row.sort_order : catalog.sort_order
  });
}

function getAdvertisingRateCard() {
  return {
    currency: 'UGX',
    display_currency: 'USD',
    ugx_per_usd: ADVERTISING_USD_RATE,
    source_note: 'Launch rates are controlled from the makaug Advertising Desk and may be updated without code changes when placement rows exist in the database.',
    payment: {
      primary_provider: 'paypal',
      tracking: 'Invoices, payment_links, provider_reference, webhook payloads, and admin manual-paid audit logs track payment status before a campaign can go live.'
    },
    creative_guidelines: CREATIVE_GUIDELINES,
    packages: getAdvertisingPackages(),
    placements: getAdvertisingPlacements()
  };
}

function buildWhatsAppAdvertisingSummary() {
  const placements = getAdvertisingPlacements().filter((item) => ['homepage_hero_sponsor', 'sale_inline_native', 'property_detail_mpu', 'whatsapp_sponsored_match', 'whatsapp_bulk_audience'].includes(item.key));
  const lines = placements.map((slot) => `- ${slot.label}: ${slot.price_labels.week}/week, ${slot.price_labels.day}/day, CPM ${slot.price_labels.cpm}`);
  return [
    '*Advertise with makaug.com*',
    'Launch options include homepage display, sponsored listing cards, property-detail ads, broker/profile spotlights, and WhatsApp sponsored matches.',
    'WhatsApp bulk audience campaigns use approved opt-in segments and template-safe creative; exact pricing is confirmed by audience and send volume.',
    '',
    '*Starting prices*',
    ...lines,
    '',
    `PayPal payment links can be issued after makaug confirms the package. Email info@makaug.com or continue here with your business name, target area, dates, budget, and creative brief.`,
    'Rate card: https://makaug.com/advertise'
  ].join('\n');
}

module.exports = {
  ADVERTISING_USD_RATE,
  buildAdvertisingQuoteBreakdown,
  buildWhatsAppAdvertisingSummary,
  estimateAdvertisingQuote,
  findAdvertisingPackage,
  findAdvertisingPlacement,
  formatUgx,
  formatUsdFromUgx,
  getAdvertisingPackages,
  getAdvertisingPlacements,
  getAdvertisingRateCard,
  mergePlacementWithCatalog,
  quotePlacement,
  summarizeAdvertisingPackageKeys,
  summarizeAdvertisingPlacementKeys
};
