const ADVERTISING_SELF_SERVE_MARKER = 'advertising-selfserve-v1-20260713';
const UGX_PER_USD_GUIDE = 3800;

const ADVERTISING_PACKAGES = [
  {
    key: 'featured_property_boost',
    label: 'Featured Property Boost',
    category: 'listing_boost',
    price_ugx: 75000,
    duration_days: 7,
    pricing_model: 'fixed_days',
    placements: ['property_search', 'category_pages', 'similar_properties'],
    placement_keys: ['feature_my_listing'],
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
    placement_keys: ['sponsored_search_result'],
    description: 'Promote a property, agent, or business to people searching specific districts and areas.'
  },
  {
    key: 'homepage_banner',
    label: 'Homepage Banner',
    category: 'display',
    price_ugx: 250000,
    duration_days: 7,
    pricing_model: 'fixed_days',
    placements: ['homepage_top', 'homepage_mid'],
    placement_keys: ['homepage_hero_banner', 'homepage_hero_sponsor'],
    description: 'Premium brand visibility on the makaug homepage.'
  },
  {
    key: 'agent_spotlight',
    label: 'Agent Spotlight',
    category: 'agent',
    price_ugx: 120000,
    duration_days: 14,
    pricing_model: 'fixed_days',
    placements: ['find_brokers', 'agent_cards', 'property_detail'],
    placement_keys: ['broker_agent_spotlight'],
    description: 'Feature a verified broker profile in broker discovery and relevant property journeys.'
  },
  {
    key: 'student_accommodation_push',
    label: 'Student Accommodation Push',
    category: 'student',
    price_ugx: 180000,
    duration_days: 14,
    pricing_model: 'fixed_days',
    placements: ['students_page', 'university_search', 'whatsapp_student_results'],
    placement_keys: ['category_top_slot'],
    description: 'Promote hostels, studios, and student rooms near universities and student search flows.'
  },
  {
    key: 'commercial_land_sponsor',
    label: 'Commercial and Land Sponsor',
    category: 'commercial_land',
    price_ugx: 220000,
    duration_days: 14,
    pricing_model: 'fixed_days',
    placements: ['commercial_page', 'land_page', 'map_results'],
    placement_keys: ['category_top_slot'],
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
    placement_keys: ['whatsapp_lead_campaign'],
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
    placement_keys: ['newsletter_placement', 'whatsapp_lead_campaign'],
    description: 'Send an approved offer to an opted-in makaug audience segment.'
  },
  {
    key: 'haymaker_all_platform',
    label: 'Haymaker All-Platform Package',
    category: 'bundle',
    price_ugx: 950000,
    duration_days: 30,
    pricing_model: 'fixed_days',
    placements: ['homepage', 'search', 'map', 'whatsapp', 'email', 'agent_cards'],
    placement_keys: ['homepage_hero_banner', 'sponsored_search_result', 'feature_my_listing'],
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

const SELF_SERVE_PLACEMENTS = [
  {
    key: 'homepage_hero_banner',
    legacy_keys: ['homepage_hero_sponsor'],
    label: 'Homepage hero banner',
    page_key: 'home',
    slot_type: 'hero',
    icon: 'fa-bullhorn',
    description: 'Own the top of makaug for buyers arriving on the homepage.',
    phase: 'v1',
    self_serve_enabled: true,
    is_premium: true,
    base_price_ugx: 350000,
    weekly_impressions: 52000,
    baseline_weekly_impressions: 36000,
    traffic_multiplier: 1.44,
    min_days: 3,
    primary_size: '1440x420',
    mobile_size: '390x220',
    size_label: 'Homepage hero / responsive',
    template_keys: ['hero_image_left', 'hero_deep_green'],
    accepted_formats: ['JPG', 'PNG', 'WebP'],
    payment_methods: ['paypal', 'mobile_money', 'card'],
    sort_order: 10,
    preview_image_url: 'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=1200&q=80',
    creative_prompt: 'Create a premium makaug homepage hero ad with a calm property image, green CTA, readable headline, and Sponsored makaug label.'
  },
  {
    key: 'sponsored_search_result',
    legacy_keys: ['sale_inline_native', 'rent_inline_native'],
    label: 'Sponsored search result',
    page_key: 'search',
    slot_type: 'native_card',
    icon: 'fa-magnifying-glass-location',
    description: 'Pin a native sponsored tile inside for-sale, rent, land, student, and commercial searches.',
    phase: 'v1',
    self_serve_enabled: true,
    is_premium: false,
    base_price_ugx: 180000,
    weekly_impressions: 41000,
    baseline_weekly_impressions: 30000,
    traffic_multiplier: 1.37,
    min_days: 3,
    primary_size: '720x540',
    mobile_size: '360x300',
    size_label: 'Native listing card',
    template_keys: ['native_listing_card', 'image_price_strip'],
    accepted_formats: ['JPG', 'PNG', 'WebP'],
    payment_methods: ['paypal', 'mobile_money', 'card'],
    sort_order: 20,
    preview_image_url: 'https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=1200&q=80',
    creative_prompt: 'Create a sponsored native property-result card for makaug search with image, headline, supporting line, price/offer, and CTA.'
  },
  {
    key: 'feature_my_listing',
    legacy_keys: ['featured_property_boost'],
    label: 'Feature my listing',
    page_key: 'category',
    slot_type: 'featured_listing',
    icon: 'fa-star',
    description: 'Boost one approved property to the top of its category with a Featured badge.',
    phase: 'v1',
    self_serve_enabled: true,
    is_premium: false,
    base_price_ugx: 75000,
    weekly_impressions: 18000,
    baseline_weekly_impressions: 16000,
    traffic_multiplier: 1.13,
    min_days: 3,
    primary_size: '720x540',
    mobile_size: '360x300',
    size_label: 'Featured listing tile',
    template_keys: ['featured_listing_badge', 'compact_feature'],
    accepted_formats: ['JPG', 'PNG', 'WebP'],
    payment_methods: ['paypal', 'mobile_money', 'card'],
    sort_order: 30,
    preview_image_url: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=1200&q=80',
    creative_prompt: 'Create a makaug featured-listing promotion using the property image, a clear location/price headline, and a View property CTA.'
  },
  {
    key: 'category_top_slot',
    label: 'Category top slot',
    page_key: 'category',
    slot_type: 'leaderboard',
    icon: 'fa-layer-group',
    description: 'Banner at the top of sale, rent, land, student, or commercial pages.',
    phase: 'v2',
    self_serve_enabled: false,
    requires_assisted_booking: true,
    is_premium: true,
    base_price_ugx: 240000,
    weekly_impressions: 26000,
    baseline_weekly_impressions: 22000,
    traffic_multiplier: 1.18,
    min_days: 7,
    primary_size: '970x250',
    mobile_size: '360x140',
    size_label: 'Category leaderboard',
    template_keys: ['leaderboard'],
    accepted_formats: ['JPG', 'PNG', 'WebP'],
    payment_methods: ['paypal', 'mobile_money', 'card'],
    sort_order: 40,
    preview_image_url: 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=1200&q=80'
  },
  {
    key: 'broker_agent_spotlight',
    legacy_keys: ['brokers_spotlight'],
    label: 'Broker / agent spotlight',
    page_key: 'brokers',
    slot_type: 'spotlight',
    icon: 'fa-user-tie',
    description: 'Feature a verified agent profile on broker discovery and related category pages.',
    phase: 'v2',
    self_serve_enabled: false,
    requires_assisted_booking: true,
    is_premium: false,
    base_price_ugx: 160000,
    weekly_impressions: 16000,
    baseline_weekly_impressions: 15000,
    traffic_multiplier: 1.07,
    min_days: 7,
    primary_size: '420x320',
    mobile_size: '360x220',
    size_label: 'Agent spotlight card',
    template_keys: ['broker_card'],
    accepted_formats: ['JPG', 'PNG', 'WebP'],
    payment_methods: ['paypal', 'mobile_money', 'card'],
    sort_order: 50,
    preview_image_url: 'https://images.unsplash.com/photo-1521791136064-7986c2920216?w=1200&q=80'
  },
  {
    key: 'mortgage_partner_placement',
    label: 'Mortgage partner placement',
    page_key: 'mortgage',
    slot_type: 'partner_card',
    icon: 'fa-building-columns',
    description: 'Partner slot on Mortgage Finder for banks, brokers, and mortgage services.',
    phase: 'v2',
    self_serve_enabled: false,
    requires_assisted_booking: true,
    is_premium: true,
    base_price_ugx: 220000,
    weekly_impressions: 9000,
    baseline_weekly_impressions: 10000,
    traffic_multiplier: 0.9,
    min_days: 7,
    primary_size: '620x280',
    mobile_size: '360x220',
    size_label: 'Mortgage partner card',
    template_keys: ['partner_card'],
    accepted_formats: ['JPG', 'PNG', 'WebP'],
    payment_methods: ['paypal', 'mobile_money', 'card'],
    sort_order: 60,
    preview_image_url: 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=1200&q=80'
  },
  {
    key: 'detail_page_sidebar',
    legacy_keys: ['property_detail_mpu'],
    label: 'Detail-page sidebar',
    page_key: 'property_detail',
    slot_type: 'mpu',
    icon: 'fa-rectangle-ad',
    description: 'Contextual sponsored block on listing detail pages.',
    phase: 'v2',
    self_serve_enabled: false,
    requires_assisted_booking: true,
    is_premium: false,
    base_price_ugx: 120000,
    weekly_impressions: 14000,
    baseline_weekly_impressions: 15000,
    traffic_multiplier: 0.93,
    min_days: 7,
    primary_size: '300x250',
    mobile_size: '336x280',
    size_label: '300x250 / responsive',
    template_keys: ['mpu_card'],
    accepted_formats: ['JPG', 'PNG', 'WebP'],
    payment_methods: ['paypal', 'mobile_money', 'card'],
    sort_order: 70,
    preview_image_url: 'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=1200&q=80'
  },
  {
    key: 'newsletter_placement',
    label: 'Newsletter placement',
    page_key: 'email',
    slot_type: 'newsletter',
    icon: 'fa-envelope-open-text',
    description: 'Sponsored block in the weekly makaug email.',
    phase: 'v2',
    self_serve_enabled: false,
    requires_assisted_booking: true,
    is_premium: false,
    base_price_ugx: 300000,
    weekly_impressions: 12000,
    baseline_weekly_impressions: 12000,
    traffic_multiplier: 1,
    min_days: 1,
    primary_size: '600x220',
    mobile_size: '360x180',
    size_label: 'Newsletter sponsor',
    template_keys: ['newsletter'],
    accepted_formats: ['JPG', 'PNG', 'WebP'],
    payment_methods: ['paypal', 'mobile_money', 'card'],
    sort_order: 80,
    preview_image_url: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=1200&q=80'
  },
  {
    key: 'whatsapp_lead_campaign',
    legacy_keys: ['whatsapp_sponsored_match'],
    label: 'WhatsApp lead campaign',
    page_key: 'whatsapp',
    slot_type: 'lead_campaign',
    icon: 'fa-brands fa-whatsapp',
    description: 'Drive opted-in leads from WhatsApp assistant journeys to the advertiser.',
    phase: 'v2',
    self_serve_enabled: false,
    requires_assisted_booking: true,
    is_premium: true,
    base_price_ugx: 200000,
    weekly_impressions: 8000,
    baseline_weekly_impressions: 7000,
    traffic_multiplier: 1.14,
    min_days: 7,
    primary_size: 'assistant card',
    mobile_size: 'assistant card',
    size_label: 'Assistant sponsored match',
    template_keys: ['whatsapp_native'],
    accepted_formats: ['JPG', 'PNG', 'WebP'],
    payment_methods: ['paypal', 'mobile_money', 'card'],
    sort_order: 90,
    preview_image_url: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=1200&q=80'
  }
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function money(value) {
  return `UGX ${Number(value || 0).toLocaleString('en-UG')}`;
}

function usd(value) {
  return `$${Math.round(Number(value || 0) / UGX_PER_USD_GUIDE).toLocaleString('en-US')}`;
}

function normalizeKey(key) {
  return String(key || '').trim().toLowerCase();
}

function dailyBaseRate(placement) {
  const weekly = Number(placement.base_price_ugx || 0);
  return Math.max(0, Math.round(weekly / 7));
}

function trafficMultiplierForPlacement(placement = {}) {
  const explicit = Number(placement.traffic_multiplier || 0);
  if (explicit > 0) return Number(explicit.toFixed(2));
  const weekly = Number(placement.weekly_impressions || 0);
  const baseline = Number(placement.baseline_weekly_impressions || 0);
  if (weekly > 0 && baseline > 0) return Number(Math.max(0.65, Math.min(2.5, weekly / baseline)).toFixed(2));
  return 1;
}

function decoratePlacement(placement) {
  const multiplier = trafficMultiplierForPlacement(placement);
  const daily = dailyBaseRate(placement);
  const weekly = Math.round(daily * 7 * multiplier);
  const month = Math.round(daily * 30 * multiplier);
  const weeklyImpressions = Math.max(0, Math.round(Number(placement.weekly_impressions || 0)));
  const cpm = weeklyImpressions > 0 ? Math.round((weekly / weeklyImpressions) * 1000) : 0;
  return {
    ...clone(placement),
    traffic_multiplier: multiplier,
    daily_base_rate_ugx: daily,
    daily_price_ugx: Math.round(daily * multiplier),
    weekly_price_ugx: weekly,
    monthly_price_ugx: month,
    estimated_weekly_impressions: weeklyImpressions,
    price_labels: {
      day: money(Math.round(daily * multiplier)),
      week: money(weekly),
      month: money(month),
      cpm: cpm ? money(cpm) : 'Ask makaug'
    },
    usd_labels: {
      week: usd(weekly),
      month: usd(month)
    },
    live_traffic_label: weeklyImpressions
      ? `~${weeklyImpressions.toLocaleString('en-UG')} views / week`
      : 'Traffic measured by makaug',
    pricing_formula_label: `${money(daily)} base/day x ${multiplier.toFixed(2)} traffic`
  };
}

function getAdvertisingPackages() {
  return ADVERTISING_PACKAGES.map((item) => ({ ...item }));
}

function findAdvertisingPackage(key) {
  const normalized = normalizeKey(key);
  return getAdvertisingPackages().find((item) => item.key === normalized) || null;
}

function summarizeAdvertisingPackageKeys(keys = []) {
  const selected = new Set((Array.isArray(keys) ? keys : [keys]).map(normalizeKey).filter(Boolean));
  return getAdvertisingPackages().filter((item) => selected.has(item.key));
}

function estimateAdvertisingQuote(keys = []) {
  return summarizeAdvertisingPackageKeys(keys).reduce((total, item) => total + Number(item.price_ugx || 0), 0);
}

function getAdvertisingPlacements(options = {}) {
  const includeAssisted = options.includeAssisted !== false;
  return SELF_SERVE_PLACEMENTS
    .filter((item) => includeAssisted || item.self_serve_enabled)
    .sort((a, b) => Number(a.sort_order || 100) - Number(b.sort_order || 100))
    .map(decoratePlacement);
}

function findAdvertisingPlacement(key) {
  const normalized = normalizeKey(key);
  const match = SELF_SERVE_PLACEMENTS.find((item) => (
    item.key === normalized || (item.legacy_keys || []).map(normalizeKey).includes(normalized)
  ));
  return match ? decoratePlacement(match) : null;
}

function mergePlacementWithCatalog(row = {}) {
  const catalog = findAdvertisingPlacement(row.key) || {};
  const merged = {
    ...catalog,
    ...row,
    key: row.key || catalog.key,
    label: row.label || catalog.label,
    page_key: row.page_key || catalog.page_key,
    slot_type: row.slot_type || catalog.slot_type,
    base_price_ugx: Number(row.base_price_ugx || catalog.base_price_ugx || 0),
    weekly_impressions: Number(row.weekly_impressions || catalog.weekly_impressions || catalog.estimated_weekly_impressions || 0),
    baseline_weekly_impressions: Number(row.baseline_weekly_impressions || catalog.baseline_weekly_impressions || 0),
    traffic_multiplier: Number(row.traffic_multiplier || catalog.traffic_multiplier || 1),
    self_serve_enabled: typeof row.self_serve_enabled === 'boolean' ? row.self_serve_enabled : !!catalog.self_serve_enabled,
    requires_assisted_booking: typeof row.requires_assisted_booking === 'boolean' ? row.requires_assisted_booking : !!catalog.requires_assisted_booking
  };
  return decoratePlacement(merged);
}

function quoteAdvertisingPlacement({ placementKey, durationDays = 7, leadCap = 0, sends = 0 } = {}) {
  const placement = findAdvertisingPlacement(placementKey);
  if (!placement) return null;
  const days = Math.max(Number(placement.min_days || 3), parseInt(durationDays, 10) || 7);
  const daily = Number(placement.daily_base_rate_ugx || dailyBaseRate(placement));
  const multiplier = trafficMultiplierForPlacement(placement);
  let total = Math.round(daily * days * multiplier);
  if (placement.key === 'newsletter_placement' && sends) {
    total = Math.round(Number(placement.base_price_ugx || 0) * Math.max(1, parseInt(sends, 10) || 1) * multiplier);
  }
  if (placement.key === 'whatsapp_lead_campaign' && leadCap) {
    total = Math.round(Math.max(total, (parseInt(leadCap, 10) || 0) * 12000 * multiplier));
  }
  const estimatedImpressions = Math.round((Number(placement.estimated_weekly_impressions || placement.weekly_impressions || 0) / 7) * days);
  return {
    placement_key: placement.key,
    placement_label: placement.label,
    duration_days: days,
    base_rate_ugx: daily,
    traffic_multiplier: multiplier,
    estimated_impressions: estimatedImpressions,
    total_ugx: total,
    total_label: money(total),
    plain_language: `~${estimatedImpressions.toLocaleString('en-UG')} views over ${days} days - ${money(total)}`
  };
}

function buildAdvertisingQuoteBreakdown({ placementKeys = [], packageKeys = [], durationDays = 7, leadCap = 0, sends = 0 } = {}) {
  const placements = (Array.isArray(placementKeys) ? placementKeys : [placementKeys]).map(normalizeKey).filter(Boolean);
  const packages = summarizeAdvertisingPackageKeys(packageKeys);
  const inferredPlacements = packages.flatMap((pkg) => pkg.placement_keys || []);
  const selected = Array.from(new Set([...placements, ...inferredPlacements]));
  const line_items = selected
    .map((placementKey) => quoteAdvertisingPlacement({ placementKey, durationDays, leadCap, sends }))
    .filter(Boolean);
  const packageOnlyTotal = packages
    .filter((pkg) => !(pkg.placement_keys || []).length)
    .reduce((sum, pkg) => sum + Number(pkg.price_ugx || 0), 0);
  const total_ugx = line_items.reduce((sum, item) => sum + Number(item.total_ugx || 0), packageOnlyTotal);
  return {
    marker: ADVERTISING_SELF_SERVE_MARKER,
    duration_days: Math.max(3, parseInt(durationDays, 10) || 7),
    line_items,
    package_keys: packages.map((pkg) => pkg.key),
    total_ugx,
    total_label: money(total_ugx),
    pricing_model: 'hybrid',
    currency: 'UGX'
  };
}

function getAdvertisingRateCard() {
  const placements = getAdvertisingPlacements();
  return {
    marker: ADVERTISING_SELF_SERVE_MARKER,
    pricing_formula: 'base_rate(placement) x duration_days x traffic_multiplier(placement)',
    ugx_per_usd: UGX_PER_USD_GUIDE,
    duration_presets: [7, 14, 28],
    minimum_duration_days: 3,
    payment_methods: [
      { key: 'paypal', label: 'PayPal hosted checkout', provider: 'paypal' },
      { key: 'mobile_money', label: 'MTN/Airtel Mobile Money hosted checkout', provider: process.env.UGANDA_PAYMENT_PROVIDER || 'pesapal_or_flutterwave' },
      { key: 'card', label: 'Card hosted checkout', provider: process.env.UGANDA_PAYMENT_PROVIDER || 'pesapal_or_flutterwave' }
    ],
    placements,
    self_serve_placements: placements.filter((item) => item.self_serve_enabled),
    assisted_placements: placements.filter((item) => !item.self_serve_enabled),
    creative_guidelines: {
      accepted_formats: ['JPG', 'PNG', 'WebP'],
      max_file_size_mb: 5,
      headline_max: 64,
      line_max: 120,
      cta_max: 24,
      palette: {
        primary: '#15603f',
        deep_green: '#0f3d2e',
        background: '#ffffff'
      },
      language_codes: ['en', 'lg', 'sw', 'ach', 'nyn', 'rn', 'lus', 'am', 'ar']
    }
  };
}

module.exports = {
  ADVERTISING_SELF_SERVE_MARKER,
  buildAdvertisingQuoteBreakdown,
  estimateAdvertisingQuote,
  findAdvertisingPackage,
  findAdvertisingPlacement,
  getAdvertisingPlacements,
  getAdvertisingPackages,
  getAdvertisingRateCard,
  mergePlacementWithCatalog,
  quoteAdvertisingPlacement,
  summarizeAdvertisingPackageKeys,
  trafficMultiplierForPlacement
};
