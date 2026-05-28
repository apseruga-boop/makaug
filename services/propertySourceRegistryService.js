'use strict';

const PROPERTY_SOURCE_REGISTRY_BATCH_ID = 'property_source_registry_20260520';
const REGISTRY_SEEN_AT = '2026-05-20T00:00:00.000Z';
const PROPERTY_SOURCE_REGISTRY_TARGET_COUNT = 30000;
const PROPERTY_SOURCE_REGISTRY_RESPONSE_SAMPLE_LIMIT = 500;
const X_HASHTAG_DISCOVERY_TARGET_COUNT = 8000;
const CROSS_PLATFORM_HASHTAG_DISCOVERY_TARGET_COUNT = 12000;
const SOURCE_FRESHNESS_WINDOW_DAYS = 366;
const TARGET_SOURCE_YEAR = 2026;
const SOCIAL_FIRST_PLATFORM_PRIORITY = ['tiktok', 'facebook', 'youtube', 'x', 'instagram'];
const SOCIAL_PROFILE_CREATION_RULE = 'Create or update a makaug source/broker profile only when the source shows repeated property activity, plural inventory, or cross-platform presence. A single isolated property post stays as a found-online listing without a profile.';
const SOCIAL_ONE_OFF_LISTING_RULE = 'One-off social posts can become found-online listings when evidence is complete, but do not create a profile until repeated inventory or multi-platform presence is observed.';

const SOURCE_LANGUAGES = ['English', 'Luganda', 'Kiswahili'];
const CORE_HASHTAGS = [
  'UgandaRealEstate',
  'RealEstateUganda',
  'KampalaRealEstate',
  'KampalaProperties',
  'HousesForSaleUganda',
  'PropertyUganda',
  'UgandaProperty',
  'KampalaHomes',
  'LandForSaleUganda',
  'PlotsForSaleUganda',
];

const PROPERTY_HASHTAG_WATCHLIST = [
  'UgandaRealEstate',
  'RealEstateUganda',
  'KampalaRealEstate',
  'KampalaProperties',
  'UgandaProperty',
  'PropertyUganda',
  'UgandaHomes',
  'KampalaProperty',
  'KampalaHomes',
  'HousesForSaleUganda',
  'HomesForSaleUganda',
  'PropertyForSaleUganda',
  'PropertyForSale',
  'HomesForSale',
  'LandForSaleUganda',
  'PlotsForSaleUganda',
  'UgandaLand',
  'UgandaPlots',
  'KampalaRentals',
  'UgandaRentals',
  'ApartmentsForRentKampala',
  'HousesForRentUganda',
  'StudentAccommodationUganda',
  'StudentAccommodationUganda2026',
  'KampalaHostels',
  'UgandaHostels',
  'HostelsKampala',
  'HostelKampala',
  'CampusHostelsUganda',
  'StudentHousingKampala',
  'MakerereHostels',
  'MakerereUniversityHostel',
  'MakerereUniversityHostels',
  'KyambogoHostels',
  'KyambogoUniversityHostel',
  'KyambogoUniversityHostels',
  'MUBSHostels',
  'MUBSHostelsKampala',
  'KIUHostel',
  'KIUHostels',
  'KampalaInternationalUniversityHostel',
  'NkumbaHostels',
  'NdejjeUniversityHostel',
  'UMUHostel',
  'UgandaChristianUniversityHostels',
  'MukonoHostels',
  'BandaHostels',
  'KikoniHostels',
  'WandegeyaHostels',
  'NakawaHostels',
  'KansangaHostels',
  'KabalagalaHostels',
  'NsambyaHostels',
  'CommercialPropertyUganda',
  'CommercialPropertyKampala',
  'OfficeSpaceKampala',
  'OfficeToLetKampala',
  'OfficeRentalKampala',
  'ShopSpaceKampala',
  'ShopsForRentKampala',
  'ShopToLetKampala',
  'RetailShopKampala',
  'KampalaArcadeShop',
  'KikuuboShops',
  'WarehouseForRentUganda',
  'WarehouseToLetKampala',
  'WarehouseForSaleUganda',
  'IndustrialSpaceKampala',
  'NamanveFactory',
  'FactoryForRentKampala',
  'ShowroomKampala',
  'BusinessSpaceKampala',
  'RestaurantSpaceKampala',
  'SalonSpaceKampala',
  'WorkshopSpaceKampala',
  'CommercialPlotKampala',
  'CommercialPlotUganda',
  'NamanveWarehouse',
  'KiraHomes',
  'NamugongoHomes',
  'MuyengaHomes',
  'EntebbeHomes',
  'WakisoLand',
  'MukonoLand',
  'JinjaProperty',
  'MbararaProperty',
  'MbaleProperty',
  'GuluProperty',
  'AruaProperty',
  'HoimaProperty',
  'FortPortalProperty',
  'MasakaProperty',
  'PropertyInvestmentUganda',
  'RealEstateInvesting',
  'PropertyNetwork',
  'UgandaHouseHunt',
  'KampalaHouseHunt',
  'UgandaRental',
  'UgandaHomesForRent',
  'UgandaPropertyAgent',
  'KampalaPropertyAgent',
  'UgandaRealtor',
  'KampalaRealtor',
  'KampalaApartments',
  'KampalaApartmentForRent',
  'ApartmentsForRentUganda',
  'HouseForRentKampala',
  'RentalHouseUganda',
  'ToLetUganda',
  'ToLetKampala',
  'UgandaToLet',
  'NtindaRentals',
  'NaalyaRentals',
  'KiraRentals',
  'FurnishedApartmentsUganda',
  'StudentHostelUganda',
  'HostelsUganda',
  'HostelRoomsUganda',
  'MakerereHostel',
  'KyambogoHostel',
  'MUBSHostel',
  'UCUHostel',
  'StudentRoomsKampala',
  'HostelNearCampus',
  'StudentHousingUganda',
  'CommercialSpaceUganda',
  'CommercialRentUganda',
  'OfficeForRentKampala',
  'OfficeSpaceUganda',
  'ShopForRentKampala',
  'RetailSpaceUganda',
  'WarehouseUganda',
  'WarehouseSpaceKampala',
  'NamanveIndustrial',
  'FactorySpaceUganda',
  'ArcadeShopsKampala',
  'PlotForSaleUganda',
  'LandForSaleKampala',
  'LandForSaleWakiso',
  'LandForSaleMukono',
  'PlotsForSaleWakiso',
  'PlotsForSaleMukono',
  'EstatePlotsUganda',
  'MailoLandUganda',
  'LandTitleUganda',
  '50x100Uganda',
  '25DecimalsUganda',
  'CommercialPropertyKampala',
  'CommercialRentKampala',
  'CommercialSpaceKampala',
  'CommercialLandUganda',
  'IndustrialPropertyUganda',
  'ShowroomForRentKampala',
  'BusinessPremisesUganda',
  'ArcadeShopKampala',
  'KikuuboShop',
  'OfficeForRentUganda',
  'OfficeSpaceNtinda',
  'OfficeSpaceNakasero',
  'WarehouseForRentKampala',
  'NamanveWarehouse',
  'BweyogerereWarehouse',
  'StudentHostelKampala',
  'StudentAccommodationKampala',
  'StudentAccommodationMakerere',
  'StudentAccommodationKyambogo',
  'StudentAccommodationMUBS',
  'StudentAccommodationUCU',
  'StudentAccommodationKIU',
  'StudentAccommodationNkumba',
  'StudentRoomUganda',
  'StudentRoomKampala',
  'SelfContainedHostel',
  'SelfContainedRoomKampala',
  'CampusAccommodationUganda',
  'HostelNearMakerere',
  'HostelNearKyambogo',
  'HostelNearMUBS',
  'HostelNearUCU',
  'UgandaLandForSale',
  'PlotForSaleKampala',
  'PlotsForSaleKampala',
  'HoimaRoadPlots',
  'MityanaRoadPlots',
  'EntebbeRoadPlots',
  'JinjaRoadPlots',
  'KakiriPlots',
  'NamayumbaPlots',
  'BujjukoLand',
  'BujuukoLand',
  'AkrightPlots',
  'KatosiLand',
  'MukonoPlots',
  'GarugaLand',
  'KigoPlots',
  'MunyonyoPlots',
  'NamanveLand',
  'ResidentialPlotsUganda',
  'LakeVictoriaPlots',
  'TitleLandUganda',
  'FreeholdLandUganda',
  'FurnishedApartmentsKampala',
  'RentalsKampala',
  'HousesForRentKampala',
  'ApartmentsToLetKampala',
  'BukotoRentals',
  'KyanjaRentals',
  'MuyengaRentals',
  'KololoApartments',
  'NakaseroApartments',
  'EntebbeRentals',
  'KyaliwajjalaRentals',
  'UgandaPropertyTour',
  'KampalaHouseTour',
  'UgandaHouseTour',
  'KampalaApartmentTour',
  'UgandaApartmentTour',
  'KampalaRealEstateTour',
  'UgandaRealEstateTour',
  'UgandaPropertyShorts',
  'KampalaPropertyShorts',
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
  const record = {
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
      source_record_kind: sourceRecordKind({ sourceType }),
      review_required: true,
      freshness_window_days: SOURCE_FRESHNESS_WINDOW_DAYS,
      target_source_year: TARGET_SOURCE_YEAR,
      target_property_window: 'Scan public property posts, videos, reels, shorts, and listings first published from 1 January 2026 through today, with priority on the newest posts.',
      listing_candidate_rule: 'Create a King review found-online property record for 2026+ public social posts with source URL, location/area, usable image/source evidence, and a phone, email, or public social contact path. Location is non-negotiable. If the source does not publish a price, store Price upon application. Website-only sources stay out of property inventory.',
      platform_priority_order: SOCIAL_FIRST_PLATFORM_PRIORITY,
      platform_priority_rule: 'Use TikTok, Facebook, YouTube, X/Twitter, and Instagram only for found-online launch inventory. Website/portal sources are disabled.',
      profile_creation_rule: SOCIAL_PROFILE_CREATION_RULE,
      single_listing_rule: SOCIAL_ONE_OFF_LISTING_RULE,
      source_use: 'Find public property posts, prepare candidates for King review, attribute source, and request owner/agent confirmation before public approval.',
      image_quality_rule: 'Use social-platform thumbnails, authorised screenshots/stills, or a clearly-labelled makaug evidence card/land-size guide as review evidence. Do not copy website/portal photos, repeat fuzzy frames, invent room labels, or bypass private platform restrictions.',
      ...metadata,
    },
  };
  record.metadata.source_record_kind = sourceRecordKind(record);
  record.metadata.source_record_label = sourceRecordLabel(record);
  return record;
}

function sourceRecordKind(item = {}) {
  const sourceType = String(item.sourceType || item.source_type || '').toLowerCase();
  if (
    sourceType.includes('search_feed')
    || sourceType.includes('hashtag_feed')
    || sourceType.includes('marketplace_feed')
    || sourceType.includes('group_search_feed')
    || sourceType.includes('public_video_search_feed')
    || sourceType.includes('public_reel_search_feed')
  ) {
    return 'discovery_feed';
  }
  return 'source_page';
}

function sourceRecordLabel(item = {}) {
  return sourceRecordKind(item) === 'source_page'
    ? 'Reviewed page/channel/account'
    : 'Discovery feed/search term';
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
    key: 'x-uganda-real-estate-hashtag',
    name: 'X hashtag: Uganda real estate',
    platform: 'x',
    sourceType: 'hashtag_feed',
    url: 'https://x.com/search?q=%23UgandaRealEstate%20Uganda%20property&src=typed_query&f=live',
    handle: '#UgandaRealEstate',
    listingTypes: ['sale', 'rent', 'land', 'commercial', 'students'],
    districts: ['Kampala', 'Wakiso', 'Mukono', 'Jinja', 'Mbarara'],
    scrapePolicy: 'public_hashtag_manual_review_only',
    trustLevel: 'source_discovery_needed',
    status: 'candidate',
    canContactDirectly: false,
    hashtags: ['UgandaRealEstate', 'RealEstateUganda', 'KampalaProperties', 'PropertyUganda'],
    notes: 'X public hashtag feed. Use only to discover public agents/pages/posts; promote a property candidate only after source URL, contact path, location and usable images are clear. If the post has no price, store Price upon application.',
    metadata: {
      hashtag: '#UgandaRealEstate',
      platform_aliases: ['twitter', 'x'],
      public_search_url: true,
    },
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
  source({
    key: 'musbon-real-estate',
    name: 'Musbon Real Estate',
    platform: 'website',
    sourceType: 'agency_portal',
    url: 'https://www.musbonrealestate.com/listings/houses/',
    website: 'https://www.musbonrealestate.com/',
    listingTypes: ['sale', 'rent', 'land'],
    districts: ['Kampala', 'Wakiso'],
    scrapePolicy: 'respect_site_terms_manual_review_only',
    canContactDirectly: false,
    metadata: { portal_type: 'public agency listings' },
  }),
  source({
    key: 'propertypro-uganda',
    name: 'PropertyPro Uganda',
    platform: 'website',
    sourceType: 'property_portal',
    url: 'https://www.propertypro.co.ug/',
    website: 'https://www.propertypro.co.ug/',
    listingTypes: ['sale', 'rent', 'land', 'commercial'],
    districts: ['Kampala', 'Wakiso', 'Entebbe', 'Mukono'],
    scrapePolicy: 'respect_site_terms_manual_review_only',
    canContactDirectly: false,
    metadata: { portal_type: 'public property listings' },
  }),
  source({
    key: 'walisa-property',
    name: 'Walisa Property',
    platform: 'website',
    sourceType: 'agency_portal',
    url: 'https://walisaproperty.com/',
    website: 'https://walisaproperty.com/',
    listingTypes: ['sale', 'rent', 'land'],
    districts: ['Kampala', 'Wakiso'],
    scrapePolicy: 'respect_site_terms_manual_review_only',
    canContactDirectly: false,
    metadata: { portal_type: 'public agency listings' },
  }),
  source({
    key: 'get-housed-uganda',
    name: 'Get Housed',
    platform: 'website',
    sourceType: 'agency_website',
    url: 'https://gethoused.net/',
    website: 'https://gethoused.net/',
    listingTypes: ['sale', 'rent'],
    districts: ['Kampala', 'Wakiso'],
    scrapePolicy: 'respect_site_terms_manual_review_only',
    canContactDirectly: false,
    metadata: { portal_type: 'public agency listings' },
  }),
  source({
    key: 'threalty-services',
    name: 'Threalty Services Limited',
    platform: 'website',
    sourceType: 'agency_website',
    url: 'https://www.threalty.site/',
    website: 'https://www.threalty.site/',
    listingTypes: ['sale', 'rent', 'property_management'],
    districts: ['Kampala', 'Wakiso'],
    scrapePolicy: 'respect_site_terms_manual_review_only',
    canContactDirectly: false,
    metadata: { portal_type: 'public agency website with YouTube insights' },
  }),
  source({
    key: 'twentyfirst-real-estate-uganda',
    name: 'Twentyfirst Real Estate Uganda',
    platform: 'website',
    sourceType: 'agency_portal',
    url: 'https://ug.twentyfirst.re/',
    website: 'https://ug.twentyfirst.re/',
    listingTypes: ['sale', 'rent'],
    districts: ['Kampala', 'Wakiso'],
    scrapePolicy: 'respect_site_terms_manual_review_only',
    canContactDirectly: false,
    metadata: { portal_type: 'public agency listings' },
  }),
  source({
    key: 'zigoti-properties',
    name: 'Zigoti Properties',
    platform: 'website',
    sourceType: 'agency_website',
    url: 'https://www.zigotiproperties.com/virtual-tour.html',
    phone: '+256707346556',
    email: 'zigotiproperties2023@gmail.com',
    website: 'https://www.zigotiproperties.com/',
    listingTypes: ['sale', 'land'],
    districts: ['Mityana', 'Wakiso', 'Kampala'],
    scrapePolicy: 'respect_site_terms_manual_review_only',
    trustLevel: 'public_contact_review_needed',
    canContactDirectly: true,
    metadata: { portal_type: 'public agency virtual tours and land listings' },
  }),
  source({
    key: 'royale-property-consultants',
    name: 'Royale Property Consultants',
    platform: 'website',
    sourceType: 'agency_website',
    url: 'https://royaleproperty.co.ug/',
    phone: '+256700588614',
    website: 'https://royaleproperty.co.ug/',
    listingTypes: ['sale', 'land'],
    districts: ['Kampala', 'Wakiso', 'Mukono', 'Masaka'],
    scrapePolicy: 'respect_site_terms_manual_review_only',
    trustLevel: 'public_contact_review_needed',
    canContactDirectly: true,
    metadata: { portal_type: 'public agency listings and land estates' },
  }),
  source({
    key: 'vaniland-property-consultants',
    name: 'Vaniland Property Consultants',
    platform: 'website',
    sourceType: 'agency_portal',
    url: 'https://vanilandproperty.com/',
    phone: '+256758589258',
    email: 'info@VanilandProperty.com',
    website: 'https://vanilandproperty.com/',
    listingTypes: ['sale', 'rent', 'land', 'commercial'],
    districts: ['Kampala', 'Wakiso'],
    scrapePolicy: 'respect_site_terms_manual_review_only',
    trustLevel: 'public_contact_review_needed',
    canContactDirectly: true,
    metadata: { portal_type: 'public agency listings with WhatsApp/contact details' },
  }),
  source({
    key: 'linev-properties',
    name: 'Linev Properties',
    platform: 'website',
    sourceType: 'agency_website',
    url: 'https://www.linev.ug/',
    website: 'https://www.linev.ug/',
    listingTypes: ['sale', 'rent', 'apartments'],
    districts: ['Kampala', 'Wakiso'],
    scrapePolicy: 'respect_site_terms_manual_review_only',
    canContactDirectly: false,
    metadata: { portal_type: 'public luxury listings and rentals' },
  }),
  source({
    key: 'clam-properties',
    name: 'Clam Properties',
    platform: 'website',
    sourceType: 'agency_portal',
    url: 'https://clamproperty.com/',
    website: 'https://clamproperty.com/',
    listingTypes: ['sale', 'rent', 'land'],
    districts: ['Kampala', 'Wakiso'],
    scrapePolicy: 'respect_site_terms_manual_review_only',
    canContactDirectly: false,
    metadata: { portal_type: 'public agency listings and virtual tours' },
  }),
  source({
    key: 'intuit-holdings',
    name: 'Intuit Holdings Limited',
    platform: 'website',
    sourceType: 'developer_website',
    url: 'https://intuitholdings.com/',
    phone: '+256761015251',
    email: 'info@intuitholdings.com',
    website: 'https://intuitholdings.com/',
    listingTypes: ['sale'],
    districts: ['Kampala'],
    scrapePolicy: 'respect_site_terms_manual_review_only',
    trustLevel: 'public_contact_review_needed',
    canContactDirectly: true,
    metadata: { portal_type: 'public luxury development listings' },
  }),
  source({
    key: 'kayo-properties',
    name: 'Kayo Properties',
    platform: 'website',
    sourceType: 'agency_website',
    url: 'https://kayoproperties.com/contact-us/',
    phone: '+256772955899',
    phoneAlt: '+2563923236089',
    email: 'sales@kayoproperties.com',
    website: 'https://kayoproperties.com/',
    listingTypes: ['sale', 'rent', 'land'],
    districts: ['Kampala', 'Wakiso'],
    scrapePolicy: 'respect_site_terms_manual_review_only',
    trustLevel: 'public_contact_review_needed',
    canContactDirectly: true,
    metadata: { portal_type: 'public agency contact and listing site' },
  }),
  source({
    key: 'abundant-properties-ug',
    name: 'Abundant Properties Ug Ltd',
    platform: 'website',
    sourceType: 'agency_website',
    url: 'https://abundantpropertiesug.com/',
    website: 'https://abundantpropertiesug.com/',
    listingTypes: ['sale', 'land'],
    districts: ['Kampala', 'Wakiso', 'Entebbe'],
    scrapePolicy: 'respect_site_terms_manual_review_only',
    canContactDirectly: false,
    metadata: { portal_type: 'public property site with latest property videos' },
  }),
  source({
    key: 'savoy-real-estates',
    name: 'Savoy Real Estates (UG) Ltd',
    platform: 'website',
    sourceType: 'agency_website',
    url: 'https://www.savoyrealestates.com/',
    website: 'https://www.savoyrealestates.com/',
    listingTypes: ['sale', 'rent', 'property_management'],
    districts: ['Wakiso', 'Kampala'],
    scrapePolicy: 'respect_site_terms_manual_review_only',
    canContactDirectly: false,
    metadata: { portal_type: 'public agency listings and property management' },
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
  ['Wakiso', 'Kiwatule'], ['Wakiso', 'Kungu'], ['Wakiso', 'Najjeera 2'], ['Wakiso', 'Kiwenda'],
  ['Wakiso', 'Nakwero'], ['Wakiso', 'Sonde'], ['Wakiso', 'Kyaliwajjala'], ['Wakiso', 'Kirinya'],
  ['Wakiso', 'Namugongo Shrine area'], ['Wakiso', 'Kira-Mulawa'], ['Wakiso', 'Kira-Nsasa'], ['Wakiso', 'Kasokoso'],
  ['Kampala', 'Kyebando'], ['Kampala', 'Kawempe'], ['Kampala', 'Buziga'], ['Kampala', 'Kansanga'],
  ['Kampala', 'Kabalagala'], ['Kampala', 'Bunga'], ['Kampala', 'Bugolobi'], ['Kampala', 'Mbuya'],
  ['Kampala', 'Luzira'], ['Kampala', 'Naalya'], ['Kampala', 'Kireka'], ['Kampala', 'Rubaga'],
  ['Kampala', 'Mengo'], ['Kampala', 'Old Kampala'], ['Kampala', 'Makerere'], ['Kampala', 'Wandegeya'],
  ['Kampala', 'Kikoni'], ['Kampala', 'Kamwokya'], ['Kampala', 'Mutungo'], ['Kampala', 'Namuwongo'],
  ['Mukono', 'Kyetume'], ['Mukono', 'Namawojjolo'], ['Mukono', 'Katosi Road'], ['Mukono', 'Namilyango'],
  ['Entebbe', 'Kitoro'], ['Entebbe', 'Bugonga'], ['Entebbe', 'Nkumba'], ['Entebbe', 'Lunyo'],
  ['Wakiso', 'Kigo'], ['Wakiso', 'Maya'], ['Wakiso', 'Nsangi'], ['Wakiso', 'Buloba'],
  ['Wakiso', 'Kakiri'], ['Wakiso', 'Namayumba'], ['Wakiso', 'Kakungulu Estate'], ['Wakiso', 'Zana'],
  ['Wakiso', 'Bunamwaya'], ['Wakiso', 'Ndejje'], ['Wakiso', 'Namasuba'], ['Wakiso', 'Katale'],
  ['Wakiso', 'Bujjuko'], ['Wakiso', 'Bujuuko'], ['Wakiso', 'Masulita'], ['Wakiso', 'Hoima Road'],
  ['Wakiso', 'Kyengera'], ['Wakiso', 'Busega'], ['Wakiso', 'Mpererwe'], ['Wakiso', 'Kawempe'],
  ['Wakiso', 'Maganjo'], ['Wakiso', 'Kawuku'], ['Wakiso', 'Kisubi'], ['Wakiso', 'Nabweru'],
  ['Kampala', 'Nakawa'], ['Kampala', 'Banda'], ['Kampala', 'Ndeeba'], ['Kampala', 'Kisenyi'],
  ['Kampala', 'Kikuubo'], ['Kampala', 'Industrial Area'], ['Kampala', 'Lugogo'], ['Kampala', 'Nateete'],
  ['Mukono', 'UCU Mukono'], ['Mukono', 'Goma'], ['Mukono', 'Nakisunga'], ['Mukono', 'Mpunge'],
  ['Mukono', 'Katosi'], ['Mityana', 'Mityana Road'], ['Mpigi', 'Maya'], ['Mpigi', 'Nkozi'],
  ['Wakiso', 'Nkumba'], ['Wakiso', 'KIU Kansanga corridor'], ['Kampala', 'Kikoni Makerere'],
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
  if (/student|hostel|campus|university|makerere|kyambogo|mubs|ucu|accommodation|room/i.test(intent)) return ['students', 'rent'];
  if (/rent|rental|letting|lease|to let/i.test(intent)) return ['rent'];
  if (/land|plot/i.test(intent)) return ['land'];
  if (/commercial|shop|office|warehouse|showroom|retail|restaurant|arcade|factory|industrial/i.test(intent)) return ['commercial', 'rent'];
  return ['sale'];
}

function hashtagWatchlistForIntent(intent, area = '') {
  const tags = ['UgandaRealEstate', 'PropertyUganda', compactTag(area)];
  if (/student|hostel|campus|university|makerere|kyambogo|mubs|ucu|accommodation|room/i.test(intent)) {
    tags.push(
      'StudentAccommodationUganda',
      'StudentHostelUganda',
      'HostelsUganda',
      'HostelRoomsUganda',
      'KampalaHostels',
      'MakerereHostel',
      'MakerereHostels',
      'KyambogoHostel',
      'KyambogoHostels',
      'MUBSHostel',
      'UCUHostel',
      'StudentAccommodationKampala',
      'StudentAccommodationMakerere',
      'StudentAccommodationKyambogo',
      'StudentAccommodationMUBS',
      'StudentAccommodationUCU',
      'StudentAccommodationKIU',
      'StudentAccommodationNkumba',
      'StudentRoomsKampala',
      'StudentRoomUganda',
      'StudentRoomKampala',
      'CampusAccommodationUganda',
      'SelfContainedHostel',
      'SelfContainedRoomKampala',
      'HostelNearCampus',
      'HostelNearMakerere',
      'HostelNearKyambogo',
      'HostelNearMUBS',
      'HostelNearUCU',
      'StudentHousingUganda'
    );
  } else if (/rent|rental|letting|lease|to let/i.test(intent)) {
    tags.push(
      'KampalaRentals',
      'UgandaRentals',
      'UgandaHomesForRent',
      'KampalaApartments',
      'KampalaApartmentForRent',
      'ApartmentsForRentKampala',
      'ApartmentsForRentUganda',
      'HousesForRentUganda',
      'HouseForRentKampala',
      'RentalHouseUganda',
      'ToLetUganda',
      'ToLetKampala',
      'UgandaToLet',
      'NtindaRentals',
      'NaalyaRentals',
      'KiraRentals',
      'FurnishedApartmentsUganda',
      'FurnishedApartmentsKampala',
      'RentalsKampala',
      'HousesForRentKampala',
      'ApartmentsToLetKampala',
      'BukotoRentals',
      'KyanjaRentals',
      'MuyengaRentals',
      'KololoApartments',
      'NakaseroApartments',
      'EntebbeRentals',
      'KyaliwajjalaRentals'
    );
  } else if (/land|plot/i.test(intent)) {
    tags.push(
      'UgandaLandForSale',
      'LandForSaleUganda',
      'LandForSaleKampala',
      'LandForSaleWakiso',
      'LandForSaleMukono',
      'PlotForSaleKampala',
      'PlotsForSaleKampala',
      'PlotsForSaleUganda',
      'PlotsForSaleWakiso',
      'PlotsForSaleMukono',
      'UgandaLand',
      'UgandaPlots',
      'EstatePlotsUganda',
      'MailoLandUganda',
      'LandTitleUganda',
      'TitleLandUganda',
      'FreeholdLandUganda',
      '50x100Uganda',
      '25DecimalsUganda',
      'ResidentialPlotsUganda',
      'HoimaRoadPlots',
      'MityanaRoadPlots',
      'EntebbeRoadPlots',
      'JinjaRoadPlots',
      'KakiriPlots',
      'NamayumbaPlots',
      'BujjukoLand',
      'BujuukoLand',
      'AkrightPlots',
      'KatosiLand',
      'MukonoPlots',
      'GarugaLand',
      'KigoPlots',
      'MunyonyoPlots',
      'NamanveLand',
      'LakeVictoriaPlots'
    );
  } else if (/commercial|shop|office|warehouse|showroom|retail|restaurant|arcade|factory|industrial/i.test(intent)) {
    tags.push(
      'CommercialPropertyUganda',
      'CommercialPropertyKampala',
      'CommercialSpaceUganda',
      'CommercialSpaceKampala',
      'CommercialRentUganda',
      'CommercialRentKampala',
      'CommercialLandUganda',
      'OfficeForRentKampala',
      'OfficeForRentUganda',
      'OfficeSpaceKampala',
      'OfficeSpaceUganda',
      'OfficeSpaceNtinda',
      'OfficeSpaceNakasero',
      'ShopForRentKampala',
      'ShopSpaceKampala',
      'ArcadeShopKampala',
      'KikuuboShop',
      'RetailSpaceUganda',
      'WarehouseForRentUganda',
      'WarehouseForRentKampala',
      'WarehouseUganda',
      'WarehouseSpaceKampala',
      'NamanveWarehouse',
      'NamanveIndustrial',
      'BweyogerereWarehouse',
      'FactorySpaceUganda',
      'ArcadeShopsKampala',
      'IndustrialPropertyUganda',
      'ShowroomForRentKampala',
      'BusinessPremisesUganda'
    );
  } else {
    tags.push(
      'HousesForSaleUganda',
      'HomesForSaleUganda',
      'PropertyForSaleUganda',
      'KampalaProperties',
      'RealEstateUganda',
      'UgandaHouseHunt',
      'KampalaHouseHunt',
      'UgandaPropertyAgent',
      'KampalaPropertyAgent',
      'UgandaRealtor',
      'KampalaRealtor'
    );
  }
  return [...new Set(tags.filter(Boolean))];
}

const DISCOVERY_INTENTS = [
  'houses for sale Uganda',
  'homes for sale Uganda',
  'new house tour Uganda',
  'affordable houses Uganda',
  'luxury homes Uganda',
  'bungalows for sale Uganda',
  'standalone houses Uganda',
  'apartments for sale Uganda',
  'apartments for rent Uganda',
  'rentals Uganda',
  'student hostels Uganda',
  'land plots for sale Uganda',
  'estate plots Uganda',
  'commercial property Uganda',
  'shops for rent Uganda',
  'offices for rent Uganda',
  'real estate agents Uganda',
  'property agents Uganda',
  'broker listings Uganda',
  'gated community Uganda',
  'airbnb investment property Uganda',
  'maisonettes for sale Uganda',
  'duplexes for sale Uganda',
  'new apartments Uganda',
  'houses with title Uganda',
  'homes for rent Kampala Uganda',
  'apartments to let Uganda',
  'rental apartments near Kampala Uganda',
  'furnished apartments Kampala Uganda',
  'standalone house for rent Uganda',
  'land for sale Kampala Uganda',
  'plots with title Uganda',
  'cheap plots for sale Uganda',
  'estate plots Wakiso Uganda',
  'residential land Mukono Uganda',
  'commercial land Uganda',
  'agricultural land Uganda',
  'student accommodation Makerere Uganda',
  'student rooms near campus Uganda',
  'hostel rooms Kyambogo Uganda',
  'student housing MUBS Uganda',
  'self contained student room Uganda',
  'student hostel Kampala Uganda',
  'office space Kampala Uganda',
  'shop space for rent Kampala Uganda',
  'warehouse for rent Namanve Uganda',
  'showroom space Uganda',
  'restaurant space for rent Uganda',
  'commercial building for sale Uganda',
  'arcade shops Kampala Uganda',
  'industrial property Uganda',
  'house for rent Ntinda Uganda',
  'apartment for rent Naalya Uganda',
  'apartment for rent Kira Uganda',
  'house for rent Kira Uganda',
  'house for rent Namugongo Uganda',
  '2 bedroom apartment Kampala rent',
  '3 bedroom house Kampala rent',
  'self contained room Kampala rent',
  'single room self contained Kampala',
  'furnished apartment Nakasero Kampala',
  'furnished apartment Kololo Kampala',
  'hostel near Makerere 2026',
  'student room near Kyambogo',
  'hostel rooms Makerere Kikoni',
  'student accommodation near MUBS',
  'student hostel UCU Mukono',
  'student room near Nkumba University',
  'student rooms near Kampala International University',
  'student accommodation Nakawa Uganda',
  'student hostel Mbarara University',
  'shop to let Kampala',
  'arcade shop for rent Kampala',
  'office space Kololo rent',
  'office space Nakasero rent',
  'office space Ntinda rent',
  'warehouse Namanve rent',
  'warehouse Bweyogerere rent',
  'commercial plot Kampala',
  'retail space Uganda',
  'restaurant space Kampala',
  'showroom to let Kampala',
  'factory space Namanve Uganda',
  '50x100 plot Wakiso',
  '25 decimals plot Kampala',
  'land with title Mukono',
  'mailo land for sale Uganda',
  'residential plots Matugga Uganda',
  'residential plots Gayaza Uganda',
  'residential plots Namugongo Uganda',
  'plots for sale Entebbe Road Uganda',
  'plots for sale Jinja Road Uganda',
  'plots for sale Mityana Road Uganda',
  'commercial land Namanve Uganda',
  '2026 Uganda house for sale',
  '2026 Kampala property for sale',
  '2026 Uganda property rent',
  '2026 Uganda land for sale',
  '2026 Kampala commercial property',
  'property video tour Uganda',
  'house shorts Uganda real estate',
  'Uganda property TikTok agent',
  'TikTok Uganda real estate land plots',
  'TikTok Uganda student hostels',
  'TikTok Uganda commercial property',
  'TikTok Kampala rentals',
  'TikTok houses for rent Uganda',
  'TikTok plots for sale Uganda',
  'TikTok hostel near Makerere',
  'TikTok hostel near Kyambogo',
  'Uganda real estate reels',
  'Facebook property group Uganda',
  'Facebook Uganda land plots',
  'Facebook Kampala rentals',
  'Facebook student accommodation Uganda',
  'Facebook commercial property Kampala',
  'verified agent listing Uganda',
  'new listing Uganda property',
  'property with WhatsApp Uganda',
  'Bujjuko Akright estate plots',
  'Kakiri Masulita Hoima Road plots',
  'Munyonyo Kigo plots for sale',
  'Katosi Mpunge lake view estate plots',
  'Namanve commercial warehouse',
  'Kikuubo shop to let',
  'Nakawa office space rent',
  'Makerere Kikoni student hostel',
  'Kyambogo Banda student hostel',
  'MUBS Nakawa student room',
  'UCU Mukono student hostel',
];

function discoverySource({ platform, sourceType, area, district, intent, url, index }) {
  const label = `${area} ${intent}`;
  const slug = slugify(`${platform}-${sourceType}-${label}-${index}`);
  const hashtagWatchlist = hashtagWatchlistForIntent(intent, area);
  return source({
    key: `discovery-${slug}`,
    name: `${platform[0].toUpperCase()}${platform.slice(1)} discovery: ${label}`,
    platform,
    sourceType,
    url,
    districts: [district],
    listingTypes: listingTypesForIntent(intent),
    hashtags: [...new Set([
      ...hashtagWatchlist,
      compactTag(label),
    ].filter(Boolean))],
    status: 'candidate',
    trustLevel: 'source_discovery_needed',
    consentStatus: 'public_source_review_needed',
    scrapePolicy: 'public_search_manual_review_only',
    canContactDirectly: false,
    notes: 'Generated source-discovery feed. Promote specific public agents/pages/posts into verified source records only after manual review.',
    metadata: {
      generated_source_discovery: true,
      query: label,
      hashtag_watchlist: hashtagWatchlist.map((tag) => `#${tag}`),
      freshness_window_days: SOURCE_FRESHNESS_WINDOW_DAYS,
      target_source_year: TARGET_SOURCE_YEAR,
      target_property_window: 'Prioritise specific posts, videos, reels, shorts, or listings first published or refreshed from 2026 onward, especially the newest available posts.',
      review_goal: 'Find active public agents, pages, posts, or videos; capture contact details only when publicly listed.',
      image_quality_rule: 'Promote only clear, differentiated source images or video stills; avoid duplicate or fuzzy frames.',
      platform_priority_rule: 'Use social channels only; website/portal sources are disabled for found-online launch inventory.',
      profile_creation_rule: SOCIAL_PROFILE_CREATION_RULE,
      single_listing_rule: SOCIAL_ONE_OFF_LISTING_RULE,
      expected_action: 'Daily sweep should identify real pages/channels from this feed and prepare King-review candidates only when source URL, contact path, location, usable images/source evidence are clear. Missing price should be stored as Price upon application. Create a source/broker profile only after repeated inventory or cross-platform presence is visible.',
    },
  });
}

function hashtagDiscoveryUrlFor({ platform, tag, area, intent }) {
  const query = `#${tag} ${area} ${intent}`;
  const normalizedTag = String(tag || '').replace(/^#/, '').toLowerCase();
  if (platform === 'x') {
    return `https://x.com/search?q=${encodeURIComponent(query)}&src=typed_query&f=live`;
  }
  if (platform === 'instagram') {
    return `https://www.instagram.com/explore/tags/${normalizedTag}/`;
  }
  if (platform === 'facebook') {
    return `https://www.facebook.com/hashtag/${encodeURIComponent(normalizedTag)}`;
  }
  if (platform === 'tiktok') {
    return `https://www.tiktok.com/tag/${encodeURIComponent(normalizedTag)}`;
  }
  if (platform === 'youtube') {
    return `https://www.youtube.com/hashtag/${encodeURIComponent(normalizedTag)}`;
  }
  return discoveryUrlFor({ platform, area, intent });
}

function hashtagDiscoverySource({ platform, tag, area, district, intent, index }) {
  const label = `${area} #${tag} ${intent}`;
  const slug = slugify(`${platform}-hashtag-${tag}-${area}-${intent}-${index}`);
  return source({
    key: `hashtag-${slug}`,
    name: `${platform === 'x' ? 'X' : `${platform[0].toUpperCase()}${platform.slice(1)}`} hashtag: #${tag} • ${area}`,
    platform,
    sourceType: 'hashtag_search_feed',
    url: hashtagDiscoveryUrlFor({ platform, tag, area, intent }),
    districts: [district],
    listingTypes: listingTypesForIntent(intent),
    hashtags: [...new Set([tag, ...hashtagWatchlistForIntent(intent, area), compactTag(area)].filter(Boolean))],
    status: 'candidate',
    trustLevel: 'source_discovery_needed',
    consentStatus: 'public_source_review_needed',
    scrapePolicy: 'public_hashtag_manual_review_only',
    canContactDirectly: false,
    notes: 'Generated hashtag-discovery feed. Use to find active public property pages/posts, then create a King candidate only when source evidence, contact path, location and usable images are clear. If no price is published, store Price upon application.',
    metadata: {
      generated_hashtag_discovery: true,
      hashtag: `#${tag}`,
      query: label,
      freshness_window_days: SOURCE_FRESHNESS_WINDOW_DAYS,
      target_source_year: TARGET_SOURCE_YEAR,
      target_property_window: 'Prioritise hashtag results from 2026 onward, especially the newest available posts.',
      platform_aliases: platform === 'x' ? ['twitter', 'x'] : undefined,
      image_quality_rule: 'Promote only clear, differentiated source images or video stills; avoid duplicate or fuzzy frames.',
      platform_priority_rule: 'Use social channels only; website/portal sources are disabled for found-online launch inventory.',
      profile_creation_rule: SOCIAL_PROFILE_CREATION_RULE,
      single_listing_rule: SOCIAL_ONE_OFF_LISTING_RULE,
      expected_action: 'Queue a property when a specific recent listing has enough evidence; promote a source profile only after repeated inventory or cross-platform presence is visible.',
    },
  });
}

function discoveryUrlFor({ platform, area, intent }) {
  const query = `${area} ${intent}`;
  if (platform === 'youtube') {
    return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  }
  if (platform === 'x') {
    return `https://x.com/search?q=${encodeURIComponent(query)}&src=typed_query&f=live`;
  }
  if (platform === 'tiktok') {
    return `https://www.tiktok.com/search?q=${encodeURIComponent(query)}`;
  }
  if (platform === 'instagram') {
    return `https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(query)}`;
  }
  const searchType = /group/i.test(intent) ? 'groups' : 'pages';
  return `https://www.facebook.com/search/${searchType}/?q=${encodeURIComponent(query)}`;
}

function discoverySourceTypeFor({ platform, intent }) {
  if (platform === 'youtube') return 'public_video_search_feed';
  if (platform === 'x') return 'public_post_search_feed';
  if (platform === 'tiktok') return 'public_video_search_feed';
  if (platform === 'instagram') return 'public_reel_search_feed';
  const searchType = /group/i.test(intent) ? 'groups' : 'pages';
  return `public_${searchType}_search_feed`;
}

function hasSourceLimit(sources, limit) {
  return Number.isFinite(limit) && sources.length >= limit;
}

function expandedDiscoverySources(limit = Infinity) {
  const sources = [];
  for (const [[district, area], areaIndex] of DISCOVERY_AREAS.map((item, index) => [item, index])) {
    for (const platform of ['youtube', 'tiktok', 'instagram', 'facebook']) {
      for (const [intentIndex, intent] of DISCOVERY_INTENTS.entries()) {
        sources.push(discoverySource({
          platform,
          sourceType: discoverySourceTypeFor({ platform, intent }),
          area,
          district,
          intent,
          index: `${areaIndex}-${intentIndex}`,
          url: discoveryUrlFor({ platform, area, intent }),
        }));
        if (hasSourceLimit(sources, limit)) return sources;
      }
    }
  }
  return sources;
}

function expandedHashtagDiscoverySources(platforms = ['x', 'instagram', 'facebook', 'tiktok', 'youtube'], limit = Infinity) {
  const sources = [];
  for (const [[district, area], areaIndex] of DISCOVERY_AREAS.map((item, index) => [item, index])) {
    for (const [intentIndex, intent] of DISCOVERY_INTENTS.entries()) {
      for (const [tagIndex, tag] of [...new Set(PROPERTY_HASHTAG_WATCHLIST)].entries()) {
        for (const platform of platforms) {
          sources.push(hashtagDiscoverySource({
            platform,
            tag,
            area,
            district,
            intent,
            index: `${areaIndex}-${intentIndex}-${tagIndex}`,
          }));
          if (hasSourceLimit(sources, limit)) return sources;
        }
      }
    }
  }
  return sources;
}

let propertySourceRegistryCache = null;

function socialSourceRegistryRows(rows = []) {
  return rows.filter((item) => SOCIAL_FIRST_PLATFORM_PRIORITY.includes(String(item.platform || '').toLowerCase()));
}

function buildPropertySourceRegistry() {
  const socialBaseRegistry = socialSourceRegistryRows(BASE_PROPERTY_SOURCE_REGISTRY);
  const generatedXHashtagDiscoverySources = expandedHashtagDiscoverySources(
    ['x'],
    X_HASHTAG_DISCOVERY_TARGET_COUNT
  );
  const generatedCrossPlatformHashtagDiscoverySources = expandedHashtagDiscoverySources(
    ['instagram', 'facebook', 'tiktok', 'youtube'],
    CROSS_PLATFORM_HASHTAG_DISCOVERY_TARGET_COUNT
  );
  const discoverySourceTargetCount = Math.max(
    0,
    PROPERTY_SOURCE_REGISTRY_TARGET_COUNT
      - socialBaseRegistry.length
      - generatedXHashtagDiscoverySources.length
      - generatedCrossPlatformHashtagDiscoverySources.length
  );
  const generatedDiscoverySources = expandedDiscoverySources(discoverySourceTargetCount);

  return [
    ...socialBaseRegistry,
    ...generatedXHashtagDiscoverySources,
    ...generatedCrossPlatformHashtagDiscoverySources,
    ...generatedDiscoverySources,
  ];
}

function getPropertySourceRegistry() {
  if (!propertySourceRegistryCache) {
    propertySourceRegistryCache = buildPropertySourceRegistry();
  }
  return propertySourceRegistryCache;
}

function byPlatformSummary(sources = getPropertySourceRegistry()) {
  return sources.reduce((acc, item) => {
    acc[item.platform] = (acc[item.platform] || 0) + 1;
    return acc;
  }, {});
}

function byStatusSummary(sources = getPropertySourceRegistry()) {
  return sources.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});
}

function summarizePropertySourceRegistry() {
  const registry = getPropertySourceRegistry();
  const sourcePageCount = registry.filter((item) => sourceRecordKind(item) === 'source_page').length;
  const discoveryFeedCount = registry.filter((item) => sourceRecordKind(item) === 'discovery_feed').length;
  const reviewedSourcePagesCount = registry.filter((item) => sourceRecordKind(item) === 'source_page' && item.status === 'active').length;
  return {
    batch_id: PROPERTY_SOURCE_REGISTRY_BATCH_ID,
    target_count: PROPERTY_SOURCE_REGISTRY_TARGET_COUNT,
    count: registry.length,
    by_platform: byPlatformSummary(registry),
    by_status: byStatusSummary(registry),
    by_record_kind: {
      source_page: sourcePageCount,
      discovery_feed: discoveryFeedCount,
    },
    reviewed_source_pages_count: reviewedSourcePagesCount,
    discovery_feed_count: discoveryFeedCount,
    direct_contact_sources: registry.filter((item) => item.canContactDirectly).length,
    hashtags: [...new Set(registry.flatMap((item) => item.hashtags || []))].slice(0, 18),
    samples: registry.slice(0, 10).map((item) => ({
      key: item.key,
      name: item.name,
      platform: item.platform,
      source_type: item.sourceType,
      source_record_kind: sourceRecordKind(item),
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

async function seedPropertySourceRegistry({ db, sources } = {}) {
  if (!db?.pool) throw new Error('db.pool is required');
  const client = await db.pool.connect();
  const registrySources = sources || getPropertySourceRegistry();
  try {
    await client.query('BEGIN');
    let upsertedCount = 0;
    const upsertedSample = [];
    const activeSourceKeys = [];
    for (const item of registrySources) {
      const row = normalizeSourceForDb(item);
      activeSourceKeys.push(row.source_key);
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
      upsertedCount += 1;
      if (upsertedSample.length < PROPERTY_SOURCE_REGISTRY_RESPONSE_SAMPLE_LIMIT) {
        upsertedSample.push(result.rows[0]);
      }
    }
    const pruned = await client.query(
      `DELETE FROM property_source_registry
       WHERE metadata->>'launch_batch' = $1
         AND NOT (source_key = ANY($2::text[]))`,
      [PROPERTY_SOURCE_REGISTRY_BATCH_ID, activeSourceKeys]
    );
    await client.query('COMMIT');
    return {
      ok: true,
      batch_id: PROPERTY_SOURCE_REGISTRY_BATCH_ID,
      upserted_sources: upsertedCount,
      pruned_stale_sources: pruned.rowCount,
      by_platform: byPlatformSummary(registrySources),
      by_status: byStatusSummary(registrySources),
      returned_count: upsertedSample.length,
      response_sample_limit: PROPERTY_SOURCE_REGISTRY_RESPONSE_SAMPLE_LIMIT,
      sources: upsertedSample,
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
  const cappedLimit = Math.max(1, Math.min(Number(limit) || 250, PROPERTY_SOURCE_REGISTRY_TARGET_COUNT));
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
    sources: result.rows.map((row) => ({
      ...row,
      source_record_kind: row.metadata?.source_record_kind || sourceRecordKind(row),
      source_record_label: row.metadata?.source_record_label || sourceRecordLabel(row),
    })),
  };
}

const exported = {
  PROPERTY_SOURCE_REGISTRY_BATCH_ID,
  PROPERTY_SOURCE_REGISTRY_TARGET_COUNT,
  getPropertySourceRegistry,
  normalizeSourceForDb,
  sourceRecordKind,
  sourceRecordLabel,
  summarizePropertySourceRegistry,
  seedPropertySourceRegistry,
  listPropertySourceRegistry,
};

Object.defineProperty(exported, 'PROPERTY_SOURCE_REGISTRY', {
  enumerable: true,
  get: getPropertySourceRegistry,
});

module.exports = exported;
