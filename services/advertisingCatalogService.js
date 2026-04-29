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
    description: 'Premium brand visibility on the MakaUg homepage.'
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
    description: 'Send an approved offer to an opted-in MakaUg audience segment.'
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
    description: 'MakaUg prepares banner copy and size-ready creative from the advertiser logo and offer.'
  }
];

function getAdvertisingPackages() {
  return ADVERTISING_PACKAGES.map((item) => ({ ...item }));
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
  findAdvertisingPackage,
  summarizeAdvertisingPackageKeys,
  estimateAdvertisingQuote
};
