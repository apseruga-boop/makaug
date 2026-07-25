const ADVERTISING_PACKAGES = [
  {
    key: 'featured_property_boost',
    label: 'Featured Property Boost',
    category: 'listing_boost',
    price_ugx: 75000,
    duration_days: 7,
    pricing_model: 'fixed_days',
    placements: ['property_search', 'category_pages', 'similar_properties'],
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
    base_price_ugx: 350000,
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
    base_price_ugx: 300000,
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
    base_price_ugx: 180000,
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
    base_price_ugx: 180000,
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
    base_price_ugx: 220000,
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
    base_price_ugx: 240000,
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
    base_price_ugx: 240000,
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
    base_price_ugx: 180000,
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
    base_price_ugx: 160000,
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
    base_price_ugx: 220000,
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
    base_price_ugx: 120000,
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

function getAdvertisingPackages() {
  return ADVERTISING_PACKAGES.map((item) => ({ ...item }));
}

function getAdvertisingPlacements() {
  return ADVERTISING_PLACEMENTS.map((item) => ({ ...item }));
}

function findAdvertisingPlacement(key) {
  const normalized = String(key || '').trim().toLowerCase();
  return getAdvertisingPlacements().find((item) => item.key === normalized) || null;
}

function mergePlacementWithCatalog(row = {}) {
  const catalog = findAdvertisingPlacement(row.key);
  return catalog ? { ...catalog, ...row } : { ...row };
}

function mergePlacementRowsWithCatalog(rows = []) {
  const rowMap = new Map(
    (Array.isArray(rows) ? rows : [])
      .filter((row) => row && row.key)
      .map((row) => [String(row.key).trim().toLowerCase(), row])
  );
  const merged = getAdvertisingPlacements().map((item) => (
    mergePlacementWithCatalog(rowMap.get(item.key) || item)
  ));
  const catalogKeys = new Set(ADVERTISING_PLACEMENTS.map((item) => item.key));
  for (const row of rowMap.values()) {
    if (!catalogKeys.has(String(row.key).trim().toLowerCase())) {
      merged.push({ ...row });
    }
  }
  return merged;
}

function getAdvertisingRateCard() {
  return {
    currency: 'UGX',
    placements: getAdvertisingPlacements(),
    packages: getAdvertisingPackages()
  };
}

function findAdvertisingPackage(key) {
  const normalized = String(key || '').trim().toLowerCase();
  return getAdvertisingPackages().find((item) => item.key === normalized) || null;
}

function summarizeAdvertisingPackageKeys(keys = []) {
  const selected = new Set((Array.isArray(keys) ? keys : [keys]).map((key) => String(key || '').trim().toLowerCase()).filter(Boolean));
  return getAdvertisingPackages().filter((item) => selected.has(item.key));
}

function estimateAdvertisingQuote(keys = []) {
  return summarizeAdvertisingPackageKeys(keys).reduce((total, item) => total + Number(item.price_ugx || 0), 0);
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
  estimateAdvertisingQuote
};
