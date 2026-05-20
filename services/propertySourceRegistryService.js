'use strict';

const PROPERTY_SOURCE_REGISTRY_BATCH_ID = 'property_source_registry_20260520';
const REGISTRY_SEEN_AT = '2026-05-20T00:00:00.000Z';

const SOURCE_LANGUAGES = ['English', 'Luganda', 'Kiswahili'];
const CORE_HASHTAGS = [
  'UgandaRealEstate',
  'KampalaRealEstate',
  'HousesForSaleUganda',
  'PropertyUganda',
  'KampalaHomes',
  'LandForSaleUganda',
];

function source({
  key,
  name,
  platform,
  sourceType = 'creator_channel',
  url,
  handle = '',
  phone = '',
  phoneAlt = '',
  email = '',
  website = '',
  districts = ['Kampala', 'Wakiso'],
  listingTypes = ['sale'],
  languages = SOURCE_LANGUAGES,
  hashtags = CORE_HASHTAGS,
  status = 'active',
  trustLevel = 'review_needed',
  consentStatus = 'public_source_review_needed',
  scrapePolicy = 'manual_review_only',
  canContactDirectly = false,
  firstSeenAt = REGISTRY_SEEN_AT,
  lastSeenAt = REGISTRY_SEEN_AT,
  notes = '',
  metadata = {},
}) {
  return {
    key,
    name,
    platform,
    sourceType,
    url,
    handle,
    phone,
    phoneAlt,
    email,
    website,
    districts,
    listingTypes,
    languages,
    hashtags,
    status,
    trustLevel,
    consentStatus,
    scrapePolicy,
    canContactDirectly,
    firstSeenAt,
    lastSeenAt,
    lastCheckedAt: REGISTRY_SEEN_AT,
    notes,
    metadata: {
      launch_batch: PROPERTY_SOURCE_REGISTRY_BATCH_ID,
      review_required: true,
      freshness_window_days: 90,
      listing_candidate_rule: 'Do not create a property listing from this source unless a specific public post/video/listing has clear location, price or guide price, agent/contact path, source URL, and evidence-based images.',
      source_use: 'Find public property posts, prepare candidates for King review, attribute source, and request owner/agent confirmation before public approval.',
      ...metadata,
    },
  };
}

const BASE_PROPERTY_SOURCE_REGISTRY = [
  source({
    key: 'carnelian-properties-uganda',
    name: 'Carnelian Properties Uganda',
    platform: 'youtube',
    url: 'https://www.youtube.com/@CarnelianPropertiesuganda',
    handle: '@CarnelianPropertiesuganda',
    phone: '+256700294005',
    phoneAlt: '+256785599477',
    email: 'carnelianproperties4@gmail.com',
    listingTypes: ['sale'],
    districts: ['Kampala', 'Wakiso'],
    consentStatus: 'founder_reported_agent_permission',
    trustLevel: 'authorised_founder_contact',
    canContactDirectly: true,
    notes: 'Founder reported direct permission to load recent house-tour listings and use stills for King review.',
    metadata: {
      evidence: 'Founder screenshots and YouTube profile details',
      priority: 'launch_inventory',
    },
  }),
  source({
    key: 'bakaima-real-estate-agents',
    name: 'Bakaima Real Estate Agents',
    platform: 'website',
    url: 'https://www.bakaima.co.ug',
    handle: 'Bakaima Real Estate Agents',
    phone: '+256702060075',
    phoneAlt: '+256782936302',
    email: 'info@bakaima.co.ug',
    website: 'https://www.bakaima.co.ug',
    listingTypes: ['land'],
    districts: ['Wakiso', 'Kampala', 'Mukono', 'Jinja', 'Mityana', 'Hoima'],
    hashtags: ['LandForSaleUganda', 'Bakaima', 'UgandaLand', 'PlotsForSaleUganda'],
    consentStatus: 'founder_reported_agent_permission',
    trustLevel: 'authorised_founder_contact',
    canContactDirectly: true,
    notes: 'Founder reported Bakaima authorised estate-plot source material for King review.',
  }),
  source({
    key: 'lady-property-agent-ug',
    name: 'Lady Property Agent UG',
    platform: 'youtube',
    url: 'https://www.youtube.com/@Ladypropertyagentug',
    handle: '@Ladypropertyagentug',
    phone: '+256787120739',
    listingTypes: ['sale', 'rent'],
    districts: ['Kampala', 'Wakiso'],
    metadata: { public_contact_seen_on_video_stills: true },
  }),
  source({
    key: 'legit-properties',
    name: 'Legit Properties',
    platform: 'youtube',
    url: 'https://www.youtube.com/@legitproperties',
    handle: '@legitproperties',
    phone: '+256703420715',
    listingTypes: ['sale', 'land', 'commercial'],
    districts: ['Kampala', 'Wakiso', 'Mukono'],
  }),
  source({
    key: 'dream-home-real-estate',
    name: 'Dream Home Real Estate',
    platform: 'youtube',
    url: 'https://www.youtube.com/results?search_query=Dream+Home+Real+Estate+Uganda+Agaba+Lewis+William',
    handle: 'Dream Home Real Estate',
    phone: '+256750719382',
    phoneAlt: '+256777647991',
    listingTypes: ['sale', 'rent'],
    districts: ['Kampala', 'Wakiso'],
    metadata: { contact_source: 'Founder screenshot of channel description' },
  }),
  source({
    key: 'realtor-mahad',
    name: 'Realtor Mahad',
    platform: 'youtube',
    url: 'https://www.youtube.com/@realtormahad',
    handle: '@realtormahad',
    phone: '+256789906044',
    listingTypes: ['sale', 'rent', 'airbnb'],
    districts: ['Kampala', 'Wakiso'],
  }),
  source({
    key: 'empire-property-ug',
    name: 'Empire Property UG',
    platform: 'youtube',
    url: 'https://www.youtube.com/@EmpirepropertyUG',
    handle: '@EmpirepropertyUG',
    listingTypes: ['sale', 'rent'],
    districts: ['Kampala', 'Wakiso'],
  }),
  source({
    key: 'ezra-homes-ug',
    name: 'EZRA HOMES UG',
    platform: 'youtube',
    url: 'https://www.youtube.com/@EZRAHOMESUG',
    handle: '@EZRAHOMESUG',
    phone: '+256709895507',
    listingTypes: ['sale', 'apartments'],
    districts: ['Kampala', 'Wakiso'],
  }),
  source({
    key: 'zuya-group',
    name: 'ZUYA GROUP',
    platform: 'youtube',
    url: 'https://www.youtube.com/@ZUYAGROUP',
    handle: '@ZUYAGROUP',
    website: 'https://zuyagroup.com',
    listingTypes: ['sale', 'land'],
    districts: ['Kampala', 'Wakiso', 'Mukono'],
  }),
  source({
    key: 'youtube-uganda-houses-for-sale-search',
    name: 'YouTube search: Uganda houses for sale',
    platform: 'youtube',
    sourceType: 'search_feed',
    url: 'https://www.youtube.com/results?search_query=Uganda+houses+for+sale+Kampala',
    listingTypes: ['sale'],
    districts: ['Kampala', 'Wakiso', 'Mukono', 'Entebbe'],
    scrapePolicy: 'search_results_to_manual_review_only',
    canContactDirectly: false,
    metadata: { query: 'Uganda houses for sale Kampala', use_case: 'Daily source discovery' },
  }),
  source({
    key: 'youtube-uganda-land-for-sale-search',
    name: 'YouTube search: Uganda land and plots',
    platform: 'youtube',
    sourceType: 'search_feed',
    url: 'https://www.youtube.com/results?search_query=Uganda+land+plots+for+sale',
    listingTypes: ['land'],
    districts: ['Wakiso', 'Mukono', 'Mityana', 'Jinja', 'Hoima', 'Kampala'],
    scrapePolicy: 'search_results_to_manual_review_only',
    canContactDirectly: false,
    metadata: { query: 'Uganda land plots for sale', use_case: 'Daily land source discovery' },
  }),
  source({
    key: 'youtube-kampala-apartments-for-rent-search',
    name: 'YouTube search: Kampala apartments for rent',
    platform: 'youtube',
    sourceType: 'search_feed',
    url: 'https://www.youtube.com/results?search_query=Kampala+apartments+for+rent+Uganda',
    listingTypes: ['rent'],
    districts: ['Kampala', 'Wakiso', 'Entebbe'],
    scrapePolicy: 'search_results_to_manual_review_only',
    canContactDirectly: false,
    metadata: { query: 'Kampala apartments for rent Uganda', use_case: 'Daily rental source discovery' },
  }),
  source({
    key: 'youtube-student-hostels-kampala-search',
    name: 'YouTube search: Kampala student hostels',
    platform: 'youtube',
    sourceType: 'search_feed',
    url: 'https://www.youtube.com/results?search_query=Kampala+student+hostel+rooms+Uganda',
    listingTypes: ['students', 'rent'],
    districts: ['Kampala', 'Wakiso', 'Mukono'],
    scrapePolicy: 'search_results_to_manual_review_only',
    canContactDirectly: false,
    metadata: { query: 'Kampala student hostel rooms Uganda', use_case: 'Daily student accommodation source discovery' },
  }),
  source({
    key: 'youtube-commercial-property-uganda-search',
    name: 'YouTube search: Uganda commercial property',
    platform: 'youtube',
    sourceType: 'search_feed',
    url: 'https://www.youtube.com/results?search_query=Uganda+commercial+property+shops+offices+for+rent',
    listingTypes: ['commercial', 'rent'],
    districts: ['Kampala', 'Wakiso', 'Mukono', 'Jinja'],
    scrapePolicy: 'search_results_to_manual_review_only',
    canContactDirectly: false,
    metadata: { query: 'Uganda commercial property shops offices for rent', use_case: 'Daily commercial source discovery' },
  }),
  source({
    key: 'tiktok-uganda-real-estate-hashtag',
    name: 'TikTok hashtag: Uganda real estate',
    platform: 'tiktok',
    sourceType: 'hashtag_feed',
    url: 'https://www.tiktok.com/tag/ugandarealestate',
    listingTypes: ['sale', 'rent', 'land'],
    scrapePolicy: 'public_hashtag_manual_review_only',
    canContactDirectly: false,
    metadata: { hashtag: '#UgandaRealEstate' },
  }),
  source({
    key: 'tiktok-houses-for-sale-uganda-hashtag',
    name: 'TikTok hashtag: houses for sale Uganda',
    platform: 'tiktok',
    sourceType: 'hashtag_feed',
    url: 'https://www.tiktok.com/tag/housesforsaleuganda',
    listingTypes: ['sale'],
    scrapePolicy: 'public_hashtag_manual_review_only',
    canContactDirectly: false,
    metadata: { hashtag: '#HousesForSaleUganda' },
  }),
  source({
    key: 'tiktok-kampala-rentals-hashtag',
    name: 'TikTok hashtag: Kampala rentals',
    platform: 'tiktok',
    sourceType: 'hashtag_feed',
    url: 'https://www.tiktok.com/tag/kampalarentals',
    listingTypes: ['rent', 'students'],
    scrapePolicy: 'public_hashtag_manual_review_only',
    canContactDirectly: false,
    metadata: { hashtag: '#KampalaRentals' },
  }),
  source({
    key: 'tiktok-land-for-sale-uganda-hashtag',
    name: 'TikTok hashtag: land for sale Uganda',
    platform: 'tiktok',
    sourceType: 'hashtag_feed',
    url: 'https://www.tiktok.com/tag/landforsaleuganda',
    listingTypes: ['land'],
    scrapePolicy: 'public_hashtag_manual_review_only',
    canContactDirectly: false,
    metadata: { hashtag: '#LandForSaleUganda' },
  }),
  source({
    key: 'instagram-uganda-real-estate-hashtag',
    name: 'Instagram hashtag: Uganda real estate',
    platform: 'instagram',
    sourceType: 'hashtag_feed',
    url: 'https://www.instagram.com/explore/tags/ugandarealestate/',
    listingTypes: ['sale', 'rent', 'land'],
    scrapePolicy: 'public_hashtag_manual_review_only',
    canContactDirectly: false,
    metadata: { hashtag: '#UgandaRealEstate' },
  }),
  source({
    key: 'instagram-kampala-real-estate-hashtag',
    name: 'Instagram hashtag: Kampala real estate',
    platform: 'instagram',
    sourceType: 'hashtag_feed',
    url: 'https://www.instagram.com/explore/tags/kampalarealestate/',
    listingTypes: ['sale', 'rent', 'commercial'],
    scrapePolicy: 'public_hashtag_manual_review_only',
    canContactDirectly: false,
    metadata: { hashtag: '#KampalaRealEstate' },
  }),
  source({
    key: 'instagram-houses-for-sale-uganda-hashtag',
    name: 'Instagram hashtag: houses for sale Uganda',
    platform: 'instagram',
    sourceType: 'hashtag_feed',
    url: 'https://www.instagram.com/explore/tags/housesforsaleuganda/',
    listingTypes: ['sale'],
    scrapePolicy: 'public_hashtag_manual_review_only',
    canContactDirectly: false,
    metadata: { hashtag: '#HousesForSaleUganda' },
  }),
  source({
    key: 'facebook-marketplace-uganda-property',
    name: 'Facebook Marketplace: Uganda property',
    platform: 'facebook',
    sourceType: 'marketplace_feed',
    url: 'https://www.facebook.com/marketplace/kampala/propertyrentals',
    listingTypes: ['rent', 'sale'],
    districts: ['Kampala', 'Wakiso', 'Mukono'],
    scrapePolicy: 'public_marketplace_manual_review_only',
    canContactDirectly: false,
    metadata: { category: 'property rentals and sales', login_may_be_required: true },
  }),
  source({
    key: 'facebook-search-kampala-real-estate-groups',
    name: 'Facebook search: Kampala real estate groups',
    platform: 'facebook',
    sourceType: 'group_search_feed',
    url: 'https://www.facebook.com/search/groups/?q=Kampala%20real%20estate',
    listingTypes: ['sale', 'rent', 'land'],
    scrapePolicy: 'public_or_member_group_manual_review_only',
    canContactDirectly: false,
    metadata: { query: 'Kampala real estate', login_may_be_required: true },
  }),
  source({
    key: 'facebook-search-uganda-land-for-sale',
    name: 'Facebook search: Uganda land for sale',
    platform: 'facebook',
    sourceType: 'group_search_feed',
    url: 'https://www.facebook.com/search/groups/?q=Uganda%20land%20for%20sale',
    listingTypes: ['land'],
    scrapePolicy: 'public_or_member_group_manual_review_only',
    canContactDirectly: false,
    metadata: { query: 'Uganda land for sale', login_may_be_required: true },
  }),
  source({
    key: 'uganda-property-centre',
    name: 'Uganda Property Centre',
    platform: 'website',
    sourceType: 'property_portal',
    url: 'https://www.ugandapropertycentre.com/',
    listingTypes: ['sale', 'rent', 'land', 'commercial'],
    districts: ['Kampala', 'Wakiso', 'Entebbe', 'Mukono'],
    scrapePolicy: 'respect_site_terms_manual_review_only',
    canContactDirectly: false,
    metadata: { portal_type: 'public property listings' },
  }),
  source({
    key: 'uganda-property-centre-rentals',
    name: 'Uganda Property Centre rentals',
    platform: 'website',
    sourceType: 'property_portal_feed',
    url: 'https://www.ugandapropertycentre.com/for-rent',
    listingTypes: ['rent'],
    districts: ['Kampala', 'Wakiso', 'Entebbe', 'Mukono'],
    scrapePolicy: 'respect_site_terms_manual_review_only',
    canContactDirectly: false,
    metadata: { portal_type: 'public rental listings' },
  }),
  source({
    key: 'uganda-property-centre-sales',
    name: 'Uganda Property Centre sales',
    platform: 'website',
    sourceType: 'property_portal_feed',
    url: 'https://www.ugandapropertycentre.com/for-sale',
    listingTypes: ['sale', 'land'],
    districts: ['Kampala', 'Wakiso', 'Entebbe', 'Mukono'],
    scrapePolicy: 'respect_site_terms_manual_review_only',
    canContactDirectly: false,
    metadata: { portal_type: 'public sale listings' },
  }),
  source({
    key: 'jiji-uganda-real-estate',
    name: 'Jiji Uganda Real Estate',
    platform: 'website',
    sourceType: 'classifieds_portal',
    url: 'https://jiji.ug/real-estate',
    listingTypes: ['sale', 'rent', 'land', 'commercial'],
    districts: ['Kampala', 'Wakiso', 'Mukono', 'Entebbe'],
    scrapePolicy: 'respect_site_terms_manual_review_only',
    canContactDirectly: false,
    metadata: { portal_type: 'public classified listings' },
  }),
  source({
    key: 'jiji-uganda-houses-apartments-for-sale',
    name: 'Jiji Uganda houses and apartments for sale',
    platform: 'website',
    sourceType: 'classifieds_portal_feed',
    url: 'https://jiji.ug/houses-apartments-for-sale',
    listingTypes: ['sale'],
    districts: ['Kampala', 'Wakiso', 'Mukono', 'Entebbe'],
    scrapePolicy: 'respect_site_terms_manual_review_only',
    canContactDirectly: false,
    metadata: { portal_type: 'public sale classifieds' },
  }),
  source({
    key: 'jiji-uganda-houses-apartments-for-rent',
    name: 'Jiji Uganda houses and apartments for rent',
    platform: 'website',
    sourceType: 'classifieds_portal_feed',
    url: 'https://jiji.ug/houses-apartments-for-rent',
    listingTypes: ['rent'],
    districts: ['Kampala', 'Wakiso', 'Mukono', 'Entebbe'],
    scrapePolicy: 'respect_site_terms_manual_review_only',
    canContactDirectly: false,
    metadata: { portal_type: 'public rental classifieds' },
  }),
  source({
    key: 'lamudi-uganda-property',
    name: 'Lamudi Uganda',
    platform: 'website',
    sourceType: 'property_portal',
    url: 'https://www.lamudi.co.ug/',
    listingTypes: ['sale', 'rent', 'land', 'commercial'],
    districts: ['Kampala', 'Wakiso', 'Mukono', 'Entebbe'],
    scrapePolicy: 'respect_site_terms_manual_review_only',
    canContactDirectly: false,
    metadata: { portal_type: 'public property listings' },
  }),
  source({
    key: 'lamudi-uganda-houses-for-sale',
    name: 'Lamudi Uganda houses for sale',
    platform: 'website',
    sourceType: 'property_portal_feed',
    url: 'https://www.lamudi.co.ug/houses/buy/',
    listingTypes: ['sale'],
    districts: ['Kampala', 'Wakiso', 'Entebbe', 'Mukono'],
    scrapePolicy: 'respect_site_terms_manual_review_only',
    canContactDirectly: false,
    metadata: { portal_type: 'public sale listings' },
  }),
  source({
    key: 'lamudi-uganda-houses-for-rent',
    name: 'Lamudi Uganda houses for rent',
    platform: 'website',
    sourceType: 'property_portal_feed',
    url: 'https://www.lamudi.co.ug/houses/rent/',
    listingTypes: ['rent'],
    districts: ['Kampala', 'Wakiso', 'Entebbe', 'Mukono'],
    scrapePolicy: 'respect_site_terms_manual_review_only',
    canContactDirectly: false,
    metadata: { portal_type: 'public rental listings' },
  }),
  source({
    key: 'opulent-properties-uganda',
    name: 'Opulent Properties Uganda',
    platform: 'website',
    sourceType: 'agency_website',
    url: 'https://opulentpropertiesug.com/',
    phone: '+256704434505',
    phoneAlt: '+256775808050',
    email: 'liveopulentug@gmail.com',
    website: 'https://opulentpropertiesug.com/',
    listingTypes: ['sale', 'rent', 'commercial'],
    districts: ['Kampala', 'Wakiso'],
    trustLevel: 'public_contact_review_needed',
    canContactDirectly: true,
    metadata: { evidence: 'Public website contact and project listing pages' },
  }),
  source({
    key: 'kampala-real-estates',
    name: 'Kampala Real Estates',
    platform: 'website',
    sourceType: 'agency_portal',
    url: 'https://www.kampalarealestates.com/',
    website: 'https://www.kampalarealestates.com/',
    listingTypes: ['sale', 'rent', 'commercial'],
    districts: ['Kampala', 'Wakiso'],
    scrapePolicy: 'respect_site_terms_manual_review_only',
    canContactDirectly: false,
    metadata: { portal_type: 'public agency listings', evidence: 'Public property category/listing pages' },
  }),
  source({
    key: 'odana-real-estate',
    name: 'Odana Real Estate',
    platform: 'facebook',
    sourceType: 'agency_page',
    url: 'https://www.facebook.com/106671800937273',
    phone: '+256702929333',
    listingTypes: ['sale', 'rent', 'land'],
    districts: ['Kampala', 'Wakiso'],
    trustLevel: 'public_contact_review_needed',
    canContactDirectly: true,
    metadata: { evidence: 'Public directory record with Facebook page and phone' },
  }),
  source({
    key: 'masaba-and-sons-property-consultants',
    name: 'Masaba and Sons Property Consultants UG Ltd',
    platform: 'youtube',
    sourceType: 'creator_channel',
    url: 'https://www.youtube.com/results?search_query=Masaba+and+Sons+property+consultants+Uganda',
    handle: 'Masaba and Sons property consultants ug ltd',
    phone: '+256784051646',
    listingTypes: ['sale', 'rent', 'land'],
    districts: ['Kampala', 'Wakiso'],
    trustLevel: 'public_contact_review_needed',
    canContactDirectly: true,
    metadata: { evidence: 'Public channel analytics/profile description record with phone and real estate services' },
  }),
  source({
    key: 'the-property-show-africa',
    name: 'The Property Show Africa',
    platform: 'youtube',
    sourceType: 'media_channel',
    url: 'https://propertyshowafrica.com/',
    website: 'https://propertyshowafrica.com/',
    listingTypes: ['sale', 'rent', 'land', 'commercial'],
    districts: ['Kampala', 'Wakiso'],
    scrapePolicy: 'media_source_manual_review_only',
    canContactDirectly: false,
    metadata: { evidence: 'Public real-estate media platform with property showcases and YouTube link' },
  }),
  source({
    key: 'spectrum-real-estate-solutions',
    name: 'Spectrum Real Estate Solutions',
    platform: 'website',
    sourceType: 'agency_website',
    url: 'https://spectrumproperties.co.ug/',
    website: 'https://spectrumproperties.co.ug/',
    listingTypes: ['sale', 'rent'],
    districts: ['Kampala', 'Wakiso'],
    scrapePolicy: 'respect_site_terms_manual_review_only',
    canContactDirectly: false,
    metadata: { evidence: 'Public agency property pages' },
  }),
  source({
    key: 'ugabox-property-for-sale',
    name: 'Ugabox property listings',
    platform: 'website',
    sourceType: 'classifieds_portal_feed',
    url: 'https://www.ugabox.com/shop/property-for-sale.html',
    listingTypes: ['sale', 'rent', 'land'],
    districts: ['Kampala', 'Wakiso'],
    scrapePolicy: 'respect_site_terms_manual_review_only',
    canContactDirectly: false,
    metadata: { portal_type: 'public classified listings' },
  }),
  source({
    key: 'real-estate-database-uganda',
    name: 'Real Estate Database Uganda',
    platform: 'website',
    sourceType: 'property_portal',
    url: 'https://www.realestatedatabase.net/',
    website: 'https://www.realestatedatabase.net/',
    listingTypes: ['sale', 'rent', 'land', 'commercial'],
    districts: ['Kampala', 'Wakiso', 'Entebbe', 'Mukono'],
    scrapePolicy: 'respect_site_terms_manual_review_only',
    canContactDirectly: false,
    metadata: { portal_type: 'public property search portal' },
  }),
  source({
    key: 'real-muloodi-property-network',
    name: 'Real Muloodi Property Network',
    platform: 'website',
    sourceType: 'property_advertising_platform',
    url: 'https://www.realmuloodi.com/',
    website: 'https://www.realmuloodi.com/',
    listingTypes: ['sale', 'rent', 'land'],
    districts: ['Kampala', 'Wakiso'],
    scrapePolicy: 'respect_site_terms_manual_review_only',
    canContactDirectly: false,
    metadata: { portal_type: 'public real estate advertising platform' },
  }),
];

const DISCOVERY_AREAS = [
  ['Kampala', 'Kampala Central'], ['Kampala', 'Kololo'], ['Kampala', 'Nakasero'], ['Kampala', 'Naguru'],
  ['Kampala', 'Ntinda'], ['Kampala', 'Bukoto'], ['Kampala', 'Kisaasi'], ['Kampala', 'Muyenga'],
  ['Kampala', 'Munyonyo'], ['Kampala', 'Makindye'], ['Kampala', 'Lubowa'], ['Kampala', 'Seguku'],
  ['Wakiso', 'Kira'], ['Wakiso', 'Namugongo'], ['Wakiso', 'Naalya'], ['Wakiso', 'Najjera'],
  ['Wakiso', 'Kyanja'], ['Wakiso', 'Komamboga'], ['Wakiso', 'Kasangati'], ['Wakiso', 'Gayaza'],
  ['Wakiso', 'Matugga'], ['Wakiso', 'Bwebajja'], ['Wakiso', 'Kitende'], ['Wakiso', 'Kajjansi'],
  ['Wakiso', 'Entebbe'], ['Wakiso', 'Garuga'], ['Wakiso', 'Wakiso Town'], ['Wakiso', 'Nansana'],
  ['Wakiso', 'Kira-Kasangati Road'], ['Mukono', 'Mukono Town'], ['Mukono', 'Seeta'], ['Mukono', 'Namanve'],
  ['Mukono', 'Namugongo-Mukono'], ['Mukono', 'Buvuma corridor'], ['Jinja', 'Jinja City'], ['Jinja', 'Njeru'],
  ['Mbale', 'Mbale Town'], ['Mbarara', 'Mbarara City'], ['Masaka', 'Masaka City'], ['Gulu', 'Gulu City'],
  ['Arua', 'Arua City'], ['Fort Portal', 'Fort Portal'], ['Hoima', 'Hoima City'], ['Lira', 'Lira City'],
  ['Soroti', 'Soroti City'], ['Mityana', 'Mityana Town'], ['Mpigi', 'Mpigi Town'], ['Kayunga', 'Kayunga Town'],
  ['Wakiso', 'Bweyogerere'], ['Wakiso', 'Bulindo'],
];

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function compactTag(value) {
  return String(value || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

function listingTypesForIntent(intent) {
  if (/rent|rental|hostel|student/i.test(intent)) return ['rent', 'students'];
  if (/land|plot/i.test(intent)) return ['land'];
  if (/commercial|shop|office/i.test(intent)) return ['commercial', 'rent'];
  return ['sale'];
}

function discoverySource({ platform, sourceType, area, district, intent, url, index }) {
  const label = `${area} ${intent}`;
  const slug = slugify(`${platform}-${sourceType}-${label}-${index}`);
  return source({
    key: `discovery-${slug}`,
    name: `${platform[0].toUpperCase()}${platform.slice(1)} discovery: ${label}`,
    platform,
    sourceType,
    url,
    districts: [district],
    listingTypes: listingTypesForIntent(intent),
    hashtags: [
      'UgandaRealEstate',
      'PropertyUganda',
      compactTag(label),
    ].filter(Boolean),
    status: 'candidate',
    trustLevel: 'source_discovery_needed',
    consentStatus: 'public_source_review_needed',
    scrapePolicy: 'public_search_manual_review_only',
    canContactDirectly: false,
    notes: 'Generated source-discovery feed. Promote specific public agents/pages/posts into verified source records only after manual review.',
    metadata: {
      generated_source_discovery: true,
      query: label,
      review_goal: 'Find active public agents, pages, posts, or videos; capture contact details only when publicly listed.',
      expected_action: 'Daily sweep should identify real pages/channels from this feed and prepare King-review candidates.',
    },
  });
}

function expandedDiscoverySources() {
  const sources = [];
  const tikTokIntents = ['houses for sale Uganda', 'rentals Uganda', 'land plots for sale Uganda', 'student hostels Uganda'];
  const instagramIntents = ['real estate agents Uganda', 'houses for sale Uganda'];
  const facebookIntents = ['property pages Uganda', 'real estate groups Uganda', 'land for sale Uganda', 'rentals Uganda'];
  DISCOVERY_AREAS.forEach(([district, area], areaIndex) => {
    tikTokIntents.forEach((intent, intentIndex) => {
      const query = `${area} ${intent}`;
      sources.push(discoverySource({
        platform: 'tiktok',
        sourceType: 'public_search_feed',
        area,
        district,
        intent,
        index: `${areaIndex}-${intentIndex}`,
        url: `https://www.tiktok.com/search?q=${encodeURIComponent(query)}`,
      }));
    });
    instagramIntents.forEach((intent, intentIndex) => {
      const query = `${area} ${intent}`;
      sources.push(discoverySource({
        platform: 'instagram',
        sourceType: 'public_search_feed',
        area,
        district,
        intent,
        index: `${areaIndex}-${intentIndex}`,
        url: `https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(query)}`,
      }));
    });
    facebookIntents.forEach((intent, intentIndex) => {
      const query = `${area} ${intent}`;
      const searchType = /group/i.test(intent) ? 'groups' : (/pages/i.test(intent) ? 'pages' : 'posts');
      sources.push(discoverySource({
        platform: 'facebook',
        sourceType: `public_${searchType}_search_feed`,
        area,
        district,
        intent,
        index: `${areaIndex}-${intentIndex}`,
        url: `https://www.facebook.com/search/${searchType}/?q=${encodeURIComponent(query)}`,
      }));
    });
  });
  return sources;
}

const PROPERTY_SOURCE_REGISTRY = [
  ...BASE_PROPERTY_SOURCE_REGISTRY,
  ...expandedDiscoverySources(),
];

function byPlatformSummary(sources = PROPERTY_SOURCE_REGISTRY) {
  return sources.reduce((acc, item) => {
    acc[item.platform] = (acc[item.platform] || 0) + 1;
    return acc;
  }, {});
}

function byStatusSummary(sources = PROPERTY_SOURCE_REGISTRY) {
  return sources.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});
}

function summarizePropertySourceRegistry() {
  return {
    batch_id: PROPERTY_SOURCE_REGISTRY_BATCH_ID,
    count: PROPERTY_SOURCE_REGISTRY.length,
    by_platform: byPlatformSummary(),
    by_status: byStatusSummary(),
    direct_contact_sources: PROPERTY_SOURCE_REGISTRY.filter((item) => item.canContactDirectly).length,
    hashtags: [...new Set(PROPERTY_SOURCE_REGISTRY.flatMap((item) => item.hashtags || []))].slice(0, 18),
    samples: PROPERTY_SOURCE_REGISTRY.slice(0, 10).map((item) => ({
      key: item.key,
      name: item.name,
      platform: item.platform,
      source_type: item.sourceType,
      source_url: item.url,
      contact_phone: item.phone,
      can_contact_directly: item.canContactDirectly,
    })),
  };
}

function normalizeArray(value) {
  return Array.isArray(value) ? value.filter(Boolean).map((item) => String(item).trim()).filter(Boolean) : [];
}

function normalizeSourceForDb(item) {
  return {
    source_key: item.key,
    source_name: item.name,
    platform: item.platform,
    source_type: item.sourceType,
    source_url: item.url,
    handle: item.handle || null,
    contact_phone: item.phone || null,
    contact_phone_alt: item.phoneAlt || null,
    contact_email: item.email || null,
    website_url: item.website || null,
    districts: normalizeArray(item.districts),
    listing_types: normalizeArray(item.listingTypes),
    languages: normalizeArray(item.languages),
    hashtags: normalizeArray(item.hashtags),
    status: item.status || 'active',
    trust_level: item.trustLevel || 'review_needed',
    consent_status: item.consentStatus || 'public_source_review_needed',
    scrape_policy: item.scrapePolicy || 'manual_review_only',
    can_contact_directly: item.canContactDirectly === true,
    first_seen_at: item.firstSeenAt || REGISTRY_SEEN_AT,
    last_seen_at: item.lastSeenAt || null,
    last_checked_at: item.lastCheckedAt || REGISTRY_SEEN_AT,
    notes: item.notes || '',
    metadata: item.metadata || {},
  };
}

async function seedPropertySourceRegistry({ db, sources = PROPERTY_SOURCE_REGISTRY } = {}) {
  if (!db?.pool) throw new Error('db.pool is required');
  const client = await db.pool.connect();
  const rows = sources.map(normalizeSourceForDb);
  try {
    await client.query('BEGIN');
    const upserted = [];
    for (const row of rows) {
      const result = await client.query(
        `INSERT INTO property_source_registry (
          source_key, source_name, platform, source_type, source_url, handle,
          contact_phone, contact_phone_alt, contact_email, website_url,
          districts, listing_types, languages, hashtags, status, trust_level,
          consent_status, scrape_policy, can_contact_directly, first_seen_at,
          last_seen_at, last_checked_at, notes, metadata
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
          $11::text[],$12::text[],$13::text[],$14::text[],$15,$16,
          $17,$18,$19,$20::timestamptz,$21::timestamptz,$22::timestamptz,$23,$24::jsonb
        )
        ON CONFLICT (source_key) DO UPDATE SET
          source_name = EXCLUDED.source_name,
          platform = EXCLUDED.platform,
          source_type = EXCLUDED.source_type,
          source_url = EXCLUDED.source_url,
          handle = EXCLUDED.handle,
          contact_phone = EXCLUDED.contact_phone,
          contact_phone_alt = EXCLUDED.contact_phone_alt,
          contact_email = EXCLUDED.contact_email,
          website_url = EXCLUDED.website_url,
          districts = EXCLUDED.districts,
          listing_types = EXCLUDED.listing_types,
          languages = EXCLUDED.languages,
          hashtags = EXCLUDED.hashtags,
          status = EXCLUDED.status,
          trust_level = EXCLUDED.trust_level,
          consent_status = EXCLUDED.consent_status,
          scrape_policy = EXCLUDED.scrape_policy,
          can_contact_directly = EXCLUDED.can_contact_directly,
          first_seen_at = LEAST(property_source_registry.first_seen_at, EXCLUDED.first_seen_at),
          last_seen_at = EXCLUDED.last_seen_at,
          last_checked_at = EXCLUDED.last_checked_at,
          notes = EXCLUDED.notes,
          metadata = COALESCE(property_source_registry.metadata, '{}'::jsonb) || EXCLUDED.metadata,
          updated_at = NOW()
        RETURNING id::text, source_key, source_name, platform, source_type, source_url,
          contact_phone, contact_phone_alt, contact_email, website_url, status, trust_level,
          consent_status, can_contact_directly, notes, metadata`,
        [
          row.source_key,
          row.source_name,
          row.platform,
          row.source_type,
          row.source_url,
          row.handle,
          row.contact_phone,
          row.contact_phone_alt,
          row.contact_email,
          row.website_url,
          row.districts,
          row.listing_types,
          row.languages,
          row.hashtags,
          row.status,
          row.trust_level,
          row.consent_status,
          row.scrape_policy,
          row.can_contact_directly,
          row.first_seen_at,
          row.last_seen_at,
          row.last_checked_at,
          row.notes,
          JSON.stringify(row.metadata),
        ]
      );
      upserted.push(result.rows[0]);
    }
    await client.query('COMMIT');
    return {
      ok: true,
      batch_id: PROPERTY_SOURCE_REGISTRY_BATCH_ID,
      upserted_sources: upserted.length,
      by_platform: byPlatformSummary(sources),
      by_status: byStatusSummary(sources),
      sources: upserted,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function listPropertySourceRegistry({ db, limit = 250 } = {}) {
  if (!db?.query) throw new Error('db.query is required');
  const cappedLimit = Math.max(1, Math.min(Number(limit) || 250, 1000));
  const [result, totalResult, platformResult] = await Promise.all([
    db.query(
    `SELECT
       id::text AS id,
       source_key,
       source_name,
       platform,
       source_type,
       source_url,
       handle,
       contact_phone,
       contact_phone_alt,
       contact_email,
       website_url,
       districts,
       listing_types,
       languages,
       hashtags,
       status,
       trust_level,
       consent_status,
       scrape_policy,
       can_contact_directly,
       first_seen_at,
       last_seen_at,
       last_checked_at,
       notes,
       metadata
     FROM property_source_registry
     ORDER BY
       CASE status WHEN 'active' THEN 0 WHEN 'candidate' THEN 1 ELSE 2 END,
       platform,
       source_name
     LIMIT $1`,
    [cappedLimit]
    ),
    db.query('SELECT COUNT(*)::int AS count FROM property_source_registry'),
    db.query('SELECT platform, COUNT(*)::int AS count FROM property_source_registry GROUP BY platform ORDER BY platform')
  ]);
  const byPlatform = platformResult.rows.reduce((acc, row) => {
    acc[row.platform] = row.count;
    return acc;
  }, {});
  return {
    ok: true,
    batch_id: PROPERTY_SOURCE_REGISTRY_BATCH_ID,
    count: totalResult.rows[0]?.count || result.rows.length,
    returned_count: result.rows.length,
    by_platform: byPlatform,
    sources: result.rows,
  };
}

module.exports = {
  PROPERTY_SOURCE_REGISTRY_BATCH_ID,
  PROPERTY_SOURCE_REGISTRY,
  normalizeSourceForDb,
  summarizePropertySourceRegistry,
  seedPropertySourceRegistry,
  listPropertySourceRegistry,
};
