const { buildListingReference } = require('./listingReferenceService');
const { buildSocialSourceTrustReview } = require('./socialSourceTrustService');
const {
  inferNearestUniversityFromListing,
  normalizeUniversityList,
  normalizeUniversityName
} = require('../utils/universityMatcher');
const {
  createOwnerEditToken,
  getOwnerPreviewUrl,
  hashOwnerEditToken,
  ownerEditTokenExpiry,
} = require('./listingModerationService');
const { SOURCE } = require('../scripts/seed-sourced-inventory-candidates');
const {
  sourceLocationQualityForRecord,
  sourcePositiveListingGateForRecord,
  sourceQualitySuppressionForRecord,
} = require('../utils/sourceContentQuality');
const {
  normalizeSourceUrl,
  suppressedSourceRowsForUrls,
} = require('./suppressedSourceService');
const {
  normalizeCommercialTransactionType,
  normalizeListingPricePeriod,
  normalizeCommercialPropertyType,
  commercialMisclassificationWarning,
} = require('../utils/commercialClassification');
const { listingPriceQuality } = require('../utils/listingPriceQuality');
const {
  CANONICAL_PROPERTY_CURRENCY,
  configuredRateToCanonicalCurrency,
  configuredUsdToUgxRate,
  propertyPriceMetadata,
  sourcePriceAmount,
} = require('../utils/propertyPriceCurrency');
const {
  foreignSourceMarketStatus,
  maskConstructionCostsForPriceExtraction,
  normalizeUgandanSourcePhone,
  safeSourcePriceCandidate,
  ugandanPhoneFromSourceText,
} = require('../utils/sourceIntakeIntegrity');
const {
  resolveCanonicalUgandaLocation,
  resolveCanonicalUgandaLocationFromText,
} = require('../utils/locationRegistry');
const {
  buildHarvestFingerprints,
  hammingDistanceHex,
} = require('./propertyHarvestDedupService');
const {
  deriveListingClassification,
  listingDataIntegrityReport,
} = require('../utils/listingDataIntegrity');

const ACTIVE_COUNTRY_CODE = String(process.env.COUNTRY_CODE || 'UG').trim().toUpperCase();
const IS_SOUTH_AFRICA = ACTIVE_COUNTRY_CODE === 'ZA';
const TARGET_COUNTRY_NAME = IS_SOUTH_AFRICA ? 'South Africa' : 'Uganda';
const TARGET_BRAND_NAME = IS_SOUTH_AFRICA ? 'seshaikhaya' : 'makaug';
const TARGET_PUBLIC_BASE_URL = IS_SOUTH_AFRICA ? 'https://seshaikhaya.com' : 'https://makaug.com';
const TARGET_DIAL_DIGITS = IS_SOUTH_AFRICA ? '27' : '256';
const TARGET_LOCAL_PHONE_PATTERN = IS_SOUTH_AFRICA ? '^[6-8]' : '^[37]';
const NON_TARGET_LOCATION_REASON = IS_SOUTH_AFRICA ? 'non_south_africa_location' : 'non_uganda_location';

const SOCIAL_SEARCH_BATCH_ID = 'social_search_authorised_20260520';
const LEGACY_SOURCED_INVENTORY_CANDIDATE_SOURCE = IS_SOUTH_AFRICA ? 'south_africa_source_registry' : SOURCE;
const SOCIAL_SEARCH_SOURCE = 'found_online_property_source_v1';
const DAILY_FOUND_ONLINE_PROPERTY_TARGET = 200;
const LAUNCH_SOURCE_POST_WINDOW_START = '2026-01-01T00:00:00.000Z';
const FOUND_ONLINE_SOURCE_POST_IMPORT_BATCH_ID = 'found_online_source_post_import';
const SOCIAL_SEARCH_FIRST_SEEN_AT = '2026-05-20T00:00:00.000Z';
const SOCIAL_SEARCH_ADDED_TO_MAKAUG_AT = '2026-05-20T00:00:00.000Z';
const PRICE_UPON_APPLICATION_LABEL = 'Price on application';
const USD_TO_CANONICAL_GUIDE_RATE = IS_SOUTH_AFRICA
  ? configuredRateToCanonicalCurrency('USD')
  : configuredUsdToUgxRate();
const ALLOWED_SOCIAL_SOURCE_PLATFORMS = ['youtube', 'tiktok', 'instagram', 'facebook', 'x', 'twitter'];
const STUDENT_SOURCE_LISTING_PATTERN = /\b(?:students?|student\s+accommodation|hostel|campus|university|college|per\s+semester|residential\s+hostel|rooms?\s+near\s+(?:campus|university|college)|near\s+(?:makerere|kyambogo|mubs|ucu|must|nkumba))\b/i;
const STUDENT_NEAR_CAMPUS_RADIUS_KM = 2;
const STUDENT_CAMPUS_COORDINATES = [
  { name: 'Makerere University', lat: 0.3356, lng: 32.5686 },
  { name: 'Kyambogo University', lat: 0.3489, lng: 32.6301 },
  { name: 'Makerere University Business School (MUBS)', lat: 0.335, lng: 32.615 },
  { name: 'Uganda Christian University (UCU)', lat: 0.3542, lng: 32.742 },
  { name: 'Nkumba University', lat: 0.0958, lng: 32.5097 },
  { name: 'Mbarara University of Science and Technology (MUST)', lat: -0.6162, lng: 30.6569 },
];
const PREAPPROVED_PERMISSION_STATUSES = [
  'founder_reported_agent_authorised_upload',
  'founder_reported_agent_authorised_listing',
  'founder_confirmed_preapproved',
  'agent_authorised_upload',
  'agent_authorised_listing',
  'agent_preapproved',
  'owner_agent_preapproved',
];
const PUBLIC_SOURCE_CONTACT_POLICY = 'No public phone number is not a blocker when a public social profile or platform message route exists; makaug shows Contact via social source until the agent adds a direct number. Website-only source/contact routes are not accepted for found-online launch inventory.';
const FOUND_ONLINE_LAUNCH_INTAKE_POLICY = {
  source_window_start: LAUNCH_SOURCE_POST_WINDOW_START,
  target_source_year: 2026,
  queue_rule: 'Always-on harvest mode: queue every supported public social property post from 1 January 2026 onward into review, regardless of poster type. Missing phone, media, price, exact pin, or a recognized location spelling are review notes, not capture blockers. Manually supplied exact social-post URLs may also enter King review when older, but must identify a specific property and carry an availability/date warning. Unknown locations stay pending for staff verification; explicit foreign listings are classified separately. Original-poster comments are optional. Website-only sources are ignored. Nothing harvested publishes automatically.',
  image_rule: 'Found-online/social imports are public discovery results: do not rehost downloaded TikTok, Facebook, Instagram, YouTube, X, LinkedIn, WhatsApp, or website photos/videos as makaug gallery assets unless the rights holder has explicitly supplied or approved them. Public pages should show source links or official embeds first, then makaug rewritten facts and disclosures.',
  facebook_image_rule: 'For Facebook, store the exact public post URL as source evidence. Do not scrape or rehost Meta media without permission or an approved Meta tool/feed; link back to the source and ask the source/agent for authorised images before using photos publicly. Location must still be present before approval.',
  platform_scope: ['YouTube', 'TikTok', 'Instagram', 'Facebook', 'X/Twitter'],
};
const FOUND_ONLINE_PROFILE_CREATION_POLICY = {
  auto_create_source_profiles: false,
  profile_action: 'defer_until_agent_claims_profile',
  rule: 'Do not automatically create public Makaug agent/broker profiles from found-online or social-source discovery. Store the original poster/source as source attribution only. A public profile is created only when the agent/broker registers or claims the listing through the approved Makaug broker process.',
};

const UGANDA_SOCIAL_SEARCH_AGENTS = [
  {
    key: 'lady-property-agent-ug',
    name: 'Lady Property Agent UG',
    company: 'Lady Property Agent UG',
    licence: 'SOCIAL-LADY-PROPERTY-AGENT-UG-20260520',
    phone: '+256787120739',
    email: null,
    channelUrl: 'https://www.youtube.com/@Ladypropertyagentug',
    audienceLabel: '831 YouTube subscribers',
    profilePhotoUrl: 'https://yt3.googleusercontent.com/fLX5gMJAbsiikF0Uyy33SBAOSsmswg1kn0tcTE92wqJ1-rZHT-X4GQb7ECHWVCVw8Qfa-JSQNg=s900-c-k-c0x00ffffff-no-rj',
    districts: ['Kampala', 'Wakiso'],
    specializations: ['Homes for sale', 'YouTube Shorts', 'Social property search'],
    bio: 'Lady Property Agent UG shares Uganda home tours and sale opportunities through public video updates. This makaug profile is prepared from founder-reported permission and public channel information for King review.',
  },
  {
    key: 'legit-properties',
    name: 'Legit Properties',
    company: 'Legit Properties',
    licence: 'SOCIAL-LEGIT-PROPERTIES-20260520',
    phone: '+256753807185',
    phoneAlt: '+256788230027',
    email: 'Legitproperties01@gmail.com',
    channelUrl: 'https://www.youtube.com/@legitproperties',
    audienceLabel: '2.17K YouTube subscribers',
    profilePhotoUrl: 'https://yt3.googleusercontent.com/2WltSWvD532jCw3ZHDAd2yU8XbijZl_UgnQm5ULd5WCNN3BXafdtNuf8JnuUysd_DDcbFUKTito=s900-c-k-c0x00ffffff-no-rj',
    districts: ['Kampala', 'Wakiso'],
    specializations: ['Homes for sale', 'Land for sale', 'Commercial plots'],
    bio: 'Legit Properties markets homes and plots around Greater Kampala and Wakiso. This makaug profile uses founder-reported permission and public social property information for approval review.',
  },
  {
    key: 'ezra-homes-ug',
    name: 'EZRA HOMES UG',
    company: 'EZRA HOMES UG',
    licence: 'SOCIAL-EZRA-HOMES-UG-20260520',
    phone: '+256709895507',
    email: null,
    channelUrl: 'https://www.youtube.com/@EZRAHOMESUG',
    audienceLabel: '446 YouTube subscribers',
    profilePhotoUrl: 'https://yt3.googleusercontent.com/bO2ClW0VsbnRPGeMFROGTfNfwzK7NsFwSNcfNx7XWNVAWSES4_9kAWxFGOzo0UtHVByDuJ4INGE=s900-c-k-c0x00ffffff-no-rj',
    districts: ['Kampala', 'Wakiso'],
    specializations: ['Homes for sale', 'Apartment blocks', 'Video tours'],
    bio: 'EZRA HOMES UG shares Uganda houses and apartment blocks for sale through public video tours. Listings here are prepared as found-online records for King review.',
  },
  {
    key: 'empire-property-ug',
    name: 'Empire Property UG',
    company: 'Empire Property Realty & Property Management',
    licence: 'SOCIAL-EMPIRE-PROPERTY-UG-20260520',
    phone: null,
    email: null,
    channelUrl: 'https://www.youtube.com/@EmpirepropertyUG',
    audienceLabel: '3K YouTube subscribers',
    profilePhotoUrl: 'https://yt3.googleusercontent.com/0ibJE_KwHLIg5hd_IIsv-BwHBN5LWb9j83CcJASvSq_GU0YKw_SG3MIgDQZm6lO_NPi8JQTe=s900-c-k-c0x00ffffff-no-rj',
    districts: ['Kampala', 'Wakiso'],
    specializations: ['Homes for sale', 'Land for sale', 'Property management'],
    bio: 'Empire Property UG presents Uganda property and management opportunities through public social video updates. This profile is prepared for makaug sourced-listing review.',
  },
  {
    key: 'zuya-group',
    name: 'ZUYA GROUP',
    company: 'ZUYA GROUP',
    licence: 'SOCIAL-ZUYA-GROUP-20260520',
    phone: '+256701541291',
    email: null,
    website: 'https://zuyagroup.com',
    channelUrl: 'https://www.youtube.com/@ZUYAGROUP',
    audienceLabel: '28.2K YouTube subscribers',
    profilePhotoUrl: 'https://yt3.googleusercontent.com/_FfLWOf-CA4IsDpEpIwqQPZKv5Aqt-Ys54goVWk-R2X6r5hwb6NGvvH5r2pl1fALyZwStGZd4w=s900-c-k-c0x00ffffff-no-rj',
    districts: ['Kampala', 'Wakiso'],
    specializations: ['Homes for sale', 'Land for sale', 'Luxury homes'],
    bio: 'ZUYA GROUP shares top homes and land opportunities in Uganda through public property videos and its website. This makaug profile is prepared for sourced-inventory review.',
  },
  {
    key: 'dream-home-real-estate',
    name: 'Dream Home Real Estate',
    company: 'Dream Home Real Estate',
    licence: 'SOCIAL-DREAM-HOME-REAL-ESTATE-20260520',
    phone: '+256750719382',
    phoneAlt: '+256777647991',
    email: null,
    channelUrl: 'https://www.youtube.com/results?search_query=Dream+Home+Real+Estate+Uganda',
    audienceLabel: 'YouTube audience to confirm from source',
    profilePhotoUrl: '',
    districts: ['Kampala', 'Wakiso'],
    specializations: ['Homes for sale', 'Dream home search', 'Local property matching'],
    bio: 'Dream Home Real Estate helps buyers find homes around Greater Kampala. The profile is prepared from founder-provided channel information; no property record is auto-created until a specific recent video gives enough location and source evidence. Missing source prices are marked Price upon application.',
  },
  {
    key: 'realtor-mahad',
    name: 'Realtor Mahad',
    company: 'Realtor Mahad',
    licence: 'SOCIAL-REALTOR-MAHAD-20260520',
    phone: '+256789906044',
    email: null,
    channelUrl: 'https://www.youtube.com/@realtormahad',
    audienceLabel: '8.27K YouTube subscribers',
    profilePhotoUrl: 'https://yt3.googleusercontent.com/t8_2YJ9AcwzwUOi23e6_P3PunsXfi_drG3HzEwCEVmk6R5qr2eYk4gb9-ejDzCuULTgG5wKnX_E=s900-c-k-c0x00ffffff-no-rj',
    districts: ['Kampala', 'Wakiso'],
    specializations: ['Homes for sale', 'Investment consultant', 'Property management'],
    bio: 'Realtor Mahad presents Uganda real estate, investment, and property management content. The profile is prepared for makaug review from founder-reported permission and public channel details.',
  },
];
const SOCIAL_SEARCH_AGENTS = IS_SOUTH_AFRICA ? [] : UGANDA_SOCIAL_SEARCH_AGENTS;

const NEARBY = {
  kyanja: [
    ['Kyanja trading centre', 'Town centre', 0.6],
    ['Komamboga market access', 'Shopping', 0.8],
    ['Kisaasi College School area', 'School', 1.4],
    ['Kyanja Medical Centre area', 'Hospital / clinic', 1.2],
    ['Northern Bypass access', 'Road access', 2.0],
  ],
  akright: [
    ['Akright City access', 'Estate access', 0.4],
    ['Bwebajja town shops', 'Shopping', 1.1],
    ['Entebbe Road access', 'Road access', 1.6],
    ['Quality International School area', 'School', 2.5],
    ['Mildmay Uganda hospital area', 'Hospital', 4.5],
  ],
  kira: [
    ['Kira town centre shops', 'Town centre', 0.3],
    ['Kira Municipal Council offices', 'Public services', 0.4],
    ['Kira Health Centre III', 'Hospital / clinic', 0.8],
    ['Kira Secondary School Namugongo', 'Secondary school', 1.4],
    ['Namugongo Road access', 'Road access', 0.5],
  ],
  kasangati: [
    ['Kasangati town centre', 'Town centre', 0.6],
    ['Nangabo Road access', 'Road access', 0.6],
    ['Kasangati Health Centre IV', 'Hospital / clinic', 1.2],
    ['Gayaza High School area', 'School', 4.0],
    ['Kira-Kasangati Road access', 'Road access', 0.8],
  ],
  kitende: [
    ['Kitende town shops', 'Shopping', 0.5],
    ['Entebbe Road access', 'Road access', 0.6],
    ["St. Mary's Kitende area", 'School', 1.2],
    ['Bwebajja access', 'Neighbourhood', 1.8],
    ['Kajansi Health Centre area', 'Hospital / clinic', 3.0],
  ],
  kajjansi: [
    ['Kajjansi town centre', 'Town centre', 0.4],
    ['Entebbe Road access', 'Road access', 0.4],
    ['Kajjansi Health Centre area', 'Hospital / clinic', 1.0],
    ['Kitende school corridor', 'School', 3.5],
    ['Bwebajja access', 'Neighbourhood', 2.0],
  ],
  seguku: [
    ['Seguku town access', 'Town centre', 0.5],
    ['Prayer Mountain access', 'Landmark', 0.6],
    ['Entebbe Road access', 'Road access', 1.0],
    ['Seguku Health Centre area', 'Hospital / clinic', 1.5],
    ['Lubowa school corridor', 'School', 2.0],
  ],
};

const UGANDA_SOCIAL_SEARCH_LISTINGS = [
  {
    agentKey: 'lady-property-agent-ug',
    key: 'lady-komamboga-kyanja-4bed-900m',
    youtubeId: '3Yx4HFkQssE',
    sourceTitle: '4 BEDROOM HOUSE FOR SLAE IN KOMAMBOGA',
    title: '4-Bed Home in Komamboga near Kyanja',
    description: "A four-bedroom home for sale around Komamboga near Kyanja, prepared from Lady Property Agent UG's latest public Shorts feed and founder-reported permission. The source image shows a finished home exterior/interior walkthrough style, with the price signal shown as USh 900,000,000. Confirm exact road, viewing status, room count, and final photos before approval.",
    area: 'Komamboga / Kyanja',
    district: 'Kampala',
    address: 'Komamboga near Kyanja, Kampala',
    price: 900000000,
    beds: 4,
    baths: null,
    subtype: 'Standalone House',
    lat: 0.394,
    lng: 32.598,
    nearbyKey: 'kyanja',
  },
  {
    agentKey: 'legit-properties',
    key: 'legit-kasangati-nangabo-4bed-400m',
    youtubeId: '1jsCm2DdByA',
    sourceTitle: 'house for sale in kasangati nangabo 400m ugx',
    title: '4-Bed House in Kasangati-Nangabo',
    description: "A house for sale around Kasangati-Nangabo, prepared from Legit Properties' public Shorts feed and founder-reported permission. The source title gives the guide price as USh 400,000,000. Confirm the exact gate/pin, bedrooms, bathrooms, title details, and latest availability before public approval.",
    area: 'Kasangati-Nangabo',
    district: 'Wakiso',
    address: 'Kasangati-Nangabo, Wakiso',
    price: 400000000,
    beds: 4,
    baths: null,
    subtype: 'Standalone House',
    lat: 0.434,
    lng: 32.61,
    nearbyKey: 'kasangati',
  },
  {
    agentKey: 'legit-properties',
    key: 'legit-kira-house-350m',
    youtubeId: 'JVh0xv-tBmc',
    sourceTitle: 'house for sale in Kira Kampala Uganda 350m',
    title: 'House for Sale in Kira at USh 350M',
    description: "A Kira house-for-sale candidate from Legit Properties' recent public Shorts feed. The public source title gives a guide price of USh 350,000,000. Confirm exact location, bedroom/bathroom count, title status, and current availability before public approval.",
    area: 'Kira',
    district: 'Wakiso',
    address: 'Kira, Wakiso',
    price: 350000000,
    beds: null,
    baths: null,
    subtype: 'Standalone House',
    lat: 0.3978,
    lng: 32.6414,
    nearbyKey: 'kira',
  },
  {
    agentKey: 'ezra-homes-ug',
    key: 'ezra-komamboga-kyanja-4bed-850m',
    youtubeId: 'argJvxx6Ak8',
    sourceTitle: 'Brand new home for sale at Komamboga near Kyanja 4 bedrooms 850M Ugx',
    title: 'Brand New 4-Bed Home in Komamboga near Kyanja',
    description: "A brand new four-bedroom home around Komamboga near Kyanja from EZRA HOMES UG's public Shorts feed. The source title gives the guide price as USh 850,000,000. Confirm final viewing status, exact road/pin, title details, and any extra rooms before public approval.",
    area: 'Komamboga / Kyanja',
    district: 'Kampala',
    address: 'Komamboga near Kyanja, Kampala',
    price: 850000000,
    beds: 4,
    baths: null,
    subtype: 'Standalone House',
    lat: 0.394,
    lng: 32.598,
    nearbyKey: 'kyanja',
  },
  {
    agentKey: 'ezra-homes-ug',
    key: 'ezra-kyebando-apartment-block-4b',
    youtubeId: 'JtYZETe6YSI',
    sourceTitle: 'Apartment blocks for sale at Kyebando Kampala Asking Price 4B negotiable',
    title: 'Apartment Block for Sale in Kyebando',
    description: "An apartment block sale candidate in Kyebando, Kampala from EZRA HOMES UG's public Shorts feed. The source title indicates an asking price of USh 4,000,000,000 negotiable. Confirm unit count, rental income, land size, title details, and exact pin before approval.",
    area: 'Kyebando',
    district: 'Kampala',
    address: 'Kyebando, Kampala',
    price: 4000000000,
    beds: null,
    baths: null,
    subtype: 'Apartment Block',
    lat: 0.368,
    lng: 32.584,
    nearbyKey: 'kyanja',
  },
  {
    agentKey: 'ezra-homes-ug',
    key: 'ezra-kira-mulawa-bungalow-550m',
    youtubeId: '2T_lzqoqZz8',
    sourceTitle: 'Elegant bungalow for sale at Kira Mulawa 550M UGX',
    title: 'Elegant Bungalow in Kira-Mulawa',
    description: "An elegant bungalow for sale in Kira-Mulawa from EZRA HOMES UG's public Shorts feed. The source title gives the guide price as USh 550,000,000. Confirm exact road, bedrooms, bathrooms, title status, and current availability before approval.",
    area: 'Kira-Mulawa',
    district: 'Wakiso',
    address: 'Kira-Mulawa, Wakiso',
    price: 550000000,
    beds: null,
    baths: null,
    subtype: 'Bungalow',
    lat: 0.412,
    lng: 32.65,
    nearbyKey: 'kira',
  },
  {
    agentKey: 'ezra-homes-ug',
    key: 'ezra-bwebajja-akright-4bed-750m',
    youtubeId: 'bUWkceAWjoM',
    sourceTitle: 'Beautiful 4 bedroom bungalow for sale at Bwebajja Akright 750M UGX',
    title: 'Beautiful 4-Bed Bungalow in Bwebajja Akright',
    description: "A beautiful four-bedroom bungalow for sale at Bwebajja Akright from EZRA HOMES UG's public Shorts feed. The source title gives the guide price as USh 750,000,000. Confirm exact pin, room count, land size, and availability before approval.",
    area: 'Bwebajja Akright',
    district: 'Wakiso',
    address: 'Bwebajja Akright, Wakiso',
    price: 750000000,
    beds: 4,
    baths: null,
    subtype: 'Bungalow',
    lat: 0.198,
    lng: 32.535,
    nearbyKey: 'akright',
  },
  {
    agentKey: 'ezra-homes-ug',
    key: 'ezra-kira-mulawa-5bed-950m',
    youtubeId: '1mXuQ3nt1hc',
    sourceTitle: 'Brand new 5 bedroom house for sale at Kira Mulawa 950M',
    title: 'Brand New 5-Bed House in Kira-Mulawa',
    description: "A brand new five-bedroom house for sale in Kira-Mulawa from EZRA HOMES UG's public Shorts feed. The guide price from the source title is USh 950,000,000. Confirm exact location, bathrooms, title details, and availability before approval.",
    area: 'Kira-Mulawa',
    district: 'Wakiso',
    address: 'Kira-Mulawa, Wakiso',
    price: 950000000,
    beds: 5,
    baths: null,
    subtype: 'Standalone House',
    lat: 0.412,
    lng: 32.65,
    nearbyKey: 'kira',
  },
  {
    agentKey: 'ezra-homes-ug',
    key: 'ezra-kira-town-4bed-550m',
    youtubeId: 'jgzyKevhA_I',
    sourceTitle: 'Brand new 4 bedroom house for sale at Kira Town 550M UGX',
    title: 'Brand New 4-Bed House in Kira Town',
    description: "A brand new four-bedroom house for sale around Kira Town from EZRA HOMES UG's public Shorts feed. The guide price from the source title is USh 550,000,000. Confirm final pin, bathrooms, title details, and availability before approval.",
    area: 'Kira Town',
    district: 'Wakiso',
    address: 'Kira Town, Wakiso',
    price: 550000000,
    beds: 4,
    baths: null,
    subtype: 'Standalone House',
    lat: 0.3978,
    lng: 32.6414,
    nearbyKey: 'kira',
  },
  {
    agentKey: 'ezra-homes-ug',
    key: 'ezra-kira-nsasa-650m',
    youtubeId: 'b5Yw1kKMidY',
    sourceTitle: 'Brand new luxury home for sale at Kira Nsasa 650M UGX',
    title: 'Brand New Luxury Home in Kira-Nsasa',
    description: "A brand new luxury home for sale at Kira-Nsasa from EZRA HOMES UG's public Shorts feed. The source title gives the guide price as USh 650,000,000. Confirm room count, exact pin, title details, and availability before approval.",
    area: 'Kira-Nsasa',
    district: 'Wakiso',
    address: 'Kira-Nsasa, Wakiso',
    price: 650000000,
    beds: null,
    baths: null,
    subtype: 'Standalone House',
    lat: 0.428,
    lng: 32.665,
    nearbyKey: 'kira',
  },
  {
    agentKey: 'empire-property-ug',
    key: 'empire-kitende-400m',
    youtubeId: 'wDu6UzYyqyQ',
    sourceTitle: 'House for sale in Kitende, Entebbe Road sitting on 12 decimals with 4 spacious bedrooms listed for 400M Ugx',
    title: '4-Bed House in Kitende on Entebbe Road',
    description: "A four-bedroom house for sale in Kitende on Entebbe Road from Empire Property UG's public Shorts feed. The public source card shows a 12-decimal setting and USh 400,000,000 guide price. Confirm exact pin, title details, bathroom count, and availability before public approval.",
    area: 'Kitende',
    district: 'Wakiso',
    address: 'Kitende, Entebbe Road, Wakiso',
    price: 400000000,
    beds: 4,
    baths: null,
    subtype: 'Standalone House',
    lat: 0.197,
    lng: 32.535,
    nearbyKey: 'kitende',
  },
  {
    agentKey: 'empire-property-ug',
    key: 'empire-kajjansi-650m',
    youtubeId: 'XQZL7eeICzg',
    sourceTitle: 'House for sale in Uganda. Kajjansi 650m ugx',
    title: 'House for Sale in Kajjansi at USh 650M',
    description: "A Kajjansi house-for-sale candidate from Empire Property UG's public Shorts feed. The source title gives a USh 650,000,000 guide price. Confirm the exact estate/gate, bedroom count, title details, and availability before public approval.",
    area: 'Kajjansi',
    district: 'Wakiso',
    address: 'Kajjansi, Wakiso',
    price: 650000000,
    beds: null,
    baths: null,
    subtype: 'Standalone House',
    lat: 0.216,
    lng: 32.552,
    nearbyKey: 'kajjansi',
  },
  {
    agentKey: 'empire-property-ug',
    key: 'empire-23-decimals-land-220m',
    youtubeId: 'Hz3gpyzhR9s',
    sourceTitle: 'Land for sale in Uganda . 23 decimals | 220m ugx many plots available',
    title: '23-Decimal Land for Sale at USh 220M',
    description: "A 23-decimal land-for-sale candidate from Empire Property UG's public Shorts feed. The source title gives a guide price of USh 220,000,000 and mentions multiple plots available. Confirm exact district, estate, boundaries, title details, and current availability before approval.",
    listingType: 'land',
    area: 'Greater Kampala',
    district: 'Wakiso',
    address: 'Greater Kampala / Wakiso, Uganda',
    price: 220000000,
    beds: null,
    baths: null,
    subtype: 'Residential Plot',
    landSizeValue: 23,
    landSizeUnit: 'decimals',
    lat: 0.31,
    lng: 32.58,
    nearbyKey: 'kira',
  },
  {
    agentKey: 'empire-property-ug',
    key: 'empire-4bed-600m',
    youtubeId: 'AytqW7i0MGg',
    sourceTitle: 'House for sale in Uganda. 4bedrooms | 600m',
    title: '4-Bed House for Sale at USh 600M',
    description: "A four-bedroom house-for-sale candidate from Empire Property UG's public Shorts feed. The source title gives a USh 600,000,000 guide price. Confirm exact area, pin, title details, and current availability before public approval.",
    area: 'Greater Kampala',
    district: 'Wakiso',
    address: 'Greater Kampala / Wakiso, Uganda',
    price: 600000000,
    beds: 4,
    baths: null,
    subtype: 'Standalone House',
    lat: 0.31,
    lng: 32.58,
    nearbyKey: 'kira',
  },
  {
    agentKey: 'zuya-group',
    key: 'zuya-seguku-prayer-mountain-plot-270m',
    youtubeId: 'qCW66LkAJVM',
    sourceTitle: 'Prime plot for sale in Seguku prayer mountain 270Million',
    title: 'Prime Plot in Seguku near Prayer Mountain',
    description: "A prime plot for sale in Seguku near Prayer Mountain from ZUYA GROUP's public Shorts feed. The source title gives a guide price of USh 270,000,000. Confirm exact plot size, title, boundaries, access road, and availability before approval.",
    listingType: 'land',
    area: 'Seguku',
    district: 'Wakiso',
    address: 'Seguku near Prayer Mountain, Wakiso',
    price: 270000000,
    beds: null,
    baths: null,
    subtype: 'Residential Plot',
    lat: 0.247,
    lng: 32.555,
    nearbyKey: 'seguku',
  },
  {
    agentKey: 'zuya-group',
    key: 'zuya-kampala-7bed-1-8b',
    youtubeId: 'xw4diiCKelE',
    sourceTitle: '7 bedroom house for sale in Kampala Uganda $500,000 or ugx1.8b',
    title: '7-Bed House for Sale in Kampala',
    description: "A seven-bedroom house-for-sale candidate in Kampala from ZUYA GROUP's public Shorts feed. The source title quotes $500,000 or USh 1,800,000,000. Confirm the exact neighbourhood, title details, amenities, and current availability before approval.",
    area: 'Kampala',
    district: 'Kampala',
    address: 'Kampala, Uganda',
    price: 1800000000,
    beds: 7,
    baths: null,
    subtype: 'Standalone House',
    lat: 0.318,
    lng: 32.582,
    nearbyKey: 'kyanja',
  },
  {
    agentKey: 'zuya-group',
    key: 'zuya-kira-4bed-520m',
    youtubeId: 'eKMTCu52AGg',
    sourceTitle: '4 bedroom new house for sale in Kira Uganda 520million',
    title: 'New 4-Bed House for Sale in Kira',
    description: "A new four-bedroom house for sale in Kira from ZUYA GROUP's public Shorts feed. The source title gives a guide price of USh 520,000,000. Confirm exact road, bathrooms, title details, and availability before approval.",
    area: 'Kira',
    district: 'Wakiso',
    address: 'Kira, Wakiso',
    price: 520000000,
    beds: 4,
    baths: null,
    subtype: 'Standalone House',
    lat: 0.3978,
    lng: 32.6414,
    nearbyKey: 'kira',
  },
  {
    agentKey: 'zuya-group',
    key: 'zuya-entebbe-road-4bed-490m',
    youtubeId: 'FxqB8zK58vc',
    sourceTitle: '4 bedroom house for sale on Entebbe road Uganda at only 490Million cash money',
    title: '4-Bed House on Entebbe Road',
    description: "A four-bedroom house for sale on Entebbe Road from ZUYA GROUP's public Shorts feed. The source title gives a guide price of USh 490,000,000. Confirm exact section of Entebbe Road, pin, title details, and availability before approval.",
    area: 'Entebbe Road',
    district: 'Wakiso',
    address: 'Entebbe Road, Wakiso',
    price: 490000000,
    beds: 4,
    baths: null,
    subtype: 'Standalone House',
    lat: 0.216,
    lng: 32.552,
    nearbyKey: 'kajjansi',
  },
];
const SOCIAL_SEARCH_LISTINGS = IS_SOUTH_AFRICA ? [] : UGANDA_SOCIAL_SEARCH_LISTINGS;

function publicBaseUrl() {
  return (process.env.PUBLIC_BASE_URL || TARGET_PUBLIC_BASE_URL).replace(/\/+$/, '');
}

function agentByKey(key) {
  return SOCIAL_SEARCH_AGENTS.find((agent) => agent.key === key);
}

function slugKey(value = '', fallback = 'source') {
  const slug = String(value || '')
    .toLowerCase()
    .replace(/https?:\/\//g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || fallback;
}

function compactText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function cleanSourceListingTitle(value = '', fallback = 'Property listing') {
  const cleaned = compactText(value)
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/#[\p{L}\p{N}_-]+/gu, ' ')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, ' ')
    .replace(/[\p{Extended_Pictographic}\p{Symbol}\uFE0F]/gu, ' ')
    .replace(/\b(?:call|whatsapp|wa)\s*[:.-]?\s*$/i, ' ')
    .replace(/[|•]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,.;:–—-]+|[\s,.;:–—-]+$/g, '')
    .trim();
  return (cleaned || compactText(fallback) || 'Property listing').slice(0, 180);
}

function asTextArray(value = []) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  return String(value || '')
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function sourceVisualTextForRawPost(raw = {}) {
  const values = [
    raw.source_visual_text,
    raw.visual_text,
    raw.video_text,
    raw.video_ocr_text,
    raw.frame_text,
    raw.frame_ocr_text,
    raw.image_text,
    raw.image_ocr_text,
    raw.screen_text,
    raw.overlay_text,
    raw.still_text,
    raw.ocr_text,
  ].flatMap((value) => (Array.isArray(value) ? value : [value]));
  return compactText(values.filter(Boolean).join(' '));
}

function sourceTextForRawPost(raw = {}) {
  const explicitPriceText = [raw.price_text, raw.guide_price, raw.asking_price]
    .filter((value) => typeof value === 'string' && /[^\d\s.,]/.test(value));
  return [
    raw.title,
    raw.source_title,
    raw.caption,
    raw.description,
    raw.summary,
    raw.raw_text,
    raw.source_text,
    ...explicitPriceText,
    sourceVisualTextForRawPost(raw),
    raw.comments,
    raw.comment,
    raw.owner_comment,
    raw.owner_comments,
    raw.owner_response,
    raw.poster_reply,
    raw.poster_response,
    raw.reply,
    raw.replies,
  ].map((value) => compactText(value)).filter(Boolean).join(' ');
}

function explicitSourcePriceTextsFromEvidence(text = '') {
  const sourceText = maskConstructionCostsForPriceExtraction(compactText(text));
  const patterns = IS_SOUTH_AFRICA
    ? [
      /(?:\b(?:ZAR|R|USD|US\$|EUR|GBP)\s*|[R$€£]\s*)\d[\d,.]*(?:\s*(?:bn|b|billion|billions|m|mn|million|millions|k|thousand|thousands))?(?:\s*(?:ZAR|USD|EUR|GBP))?/gi,
      /\b\d+(?:\.\d+)?\s*(?:bn|b|billion|billions|m|mn|million|millions|k|thousand|thousands)\b(?:\s*(?:ZAR|R))?/gi
    ]
    : [
      /(?:\b(?:UGX|USh|Shs?|USD|US\$)\s*|\$\s*)\d[\d,.]*(?:\s*(?:bn|b|billion|billions|m|mn|million|millions|k|thousand|thousands))?(?:\s*(?:UGX|USh|Shs?))?/gi,
      /\b\d+(?:\.\d+)?\s*(?:bn|b|billion|billions|m|mn|million|millions|k|thousand|thousands)\b(?:\s*(?:UGX|USh|Shs?))?/gi
    ];
  const matches = [];
  for (const pattern of patterns) {
    for (const match of sourceText.matchAll(pattern)) matches.push(compactText(match[0]));
  }
  return [...new Set(matches)].filter(Boolean);
}

function strongestSourcePriceCandidate(raw = {}, sourceText = '') {
  const candidates = [
    raw.price_text,
    raw.price_label,
    raw.asking_price,
    raw.guide_price,
    ...explicitSourcePriceTextsFromEvidence(sourceText),
    raw.price
  ].filter((value) => value != null && value !== '');
  for (const candidate of candidates) {
    const safe = safeSourcePriceCandidate(candidate, sourceText);
    if (safe.value != null && safe.value !== '') return safe;
  }
  return safeSourcePriceCandidate(candidates[0] ?? null, sourceText);
}

function itemBatchId(item = {}) {
  return String(item.sourceBatch || item.source_batch || SOCIAL_SEARCH_BATCH_ID).trim() || SOCIAL_SEARCH_BATCH_ID;
}

function sourceAgentForItem(item = {}) {
  const embeddedAgent = item.sourceAgent || item.agent || item.agentProfile;
  if (embeddedAgent && typeof embeddedAgent === 'object') return embeddedAgent;
  return agentByKey(item.agentKey) || {};
}

function agentHasPublicContact(agent = {}) {
  return hasAnyPublicContactPath(agent);
}

function youtubeUrl(id) {
  return `https://www.youtube.com/watch?v=${id}`;
}

function youtubeIdFromUrl(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^[a-zA-Z0-9_-]{6,}$/.test(raw) && !/^https?:\/\//i.test(raw)) return raw;
  try {
    const url = new URL(raw);
    if (/youtu\.be$/i.test(url.hostname)) return url.pathname.split('/').filter(Boolean)[0] || '';
    if (/youtube\.com$/i.test(url.hostname) || /\.youtube\.com$/i.test(url.hostname)) {
      if (url.pathname === '/watch') return url.searchParams.get('v') || '';
      const shorts = url.pathname.match(/^\/shorts\/([^/?#]+)/i);
      if (shorts) return shorts[1] || '';
      const embed = url.pathname.match(/^\/embed\/([^/?#]+)/i);
      if (embed) return embed[1] || '';
    }
  } catch (_) {}
  return '';
}

function safeUrl(value = '') {
  const url = String(value || '').trim();
  return /^https?:\/\//i.test(url) ? url : '';
}

function uniqueUrls(values = []) {
  const seen = new Set();
  return values
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .map(safeUrl)
    .filter(Boolean)
    .filter((url) => {
      const key = url.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function sourceUrlForItem(item = {}) {
  return safeUrl(item.sourceUrl)
    || safeUrl(item.postUrl)
    || safeUrl(item.listingUrl)
    || safeUrl(item.videoUrl)
    || safeUrl(item.publicUrl)
    || safeUrl(item.url)
    || (item.youtubeId ? youtubeUrl(item.youtubeId) : '');
}

function normalizedSourceUrlForItem(item = {}) {
  return normalizeSourceUrl(sourceUrlForItem(item));
}

async function suppressedSourceRowsForItems(db, items = []) {
  if (!db || (typeof db.query !== 'function' && !db.pool)) return new Map();
  const executor = typeof db.query === 'function' ? db : db.pool;
  const urls = items.flatMap((item) => [
    sourceUrlForItem(item),
    item.sourceUrl,
    item.source_url,
    item.source_post_url,
    item.postUrl,
    item.post_url,
    item.listingUrl,
    item.videoUrl,
    item.url,
  ]);
  return suppressedSourceRowsForUrls(executor, urls);
}

function sourceContactCandidateUrls(agent = {}, item = {}) {
  return uniqueUrls([
    agent.channelUrl,
    agent.facebookUrl,
    agent.instagramUrl,
    agent.tiktokUrl,
    agent.xUrl,
    agent.twitterUrl,
    item.sourceContactUrl,
    item.contactUrl,
    sourceUrlForItem(item),
  ]).filter(urlLooksAllowedSocialSource);
}

function hasAnyPublicContactPath(agent = {}, item = {}) {
  return Boolean(
    String(agent.phone || agent.phoneAlt || agent.email || item.phone || item.phoneAlt || item.email || '').trim()
      || sourceContactCandidateUrls(agent, item).length
  );
}

function normalizeSourcePlatformName(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'x/twitter') return 'x';
  return normalized;
}

function isAllowedSocialSourcePlatform(platform = '') {
  return ALLOWED_SOCIAL_SOURCE_PLATFORMS.includes(normalizeSourcePlatformName(platform));
}

function urlLooksAllowedSocialSource(value = '') {
  const url = safeUrl(value).toLowerCase();
  return Boolean(url && /(youtube\.com|youtu\.be|tiktok\.com|instagram\.com|facebook\.com|fb\.watch|x\.com|twitter\.com)/i.test(url));
}

function itemHasAllowedSocialSource(item = {}, agent = {}) {
  const platform = sourcePlatformFor(agent, item);
  return isAllowedSocialSourcePlatform(platform) && urlLooksAllowedSocialSource(sourceUrlForItem(item));
}

function itemIsExactTikTokVideoSource(item = {}, agent = {}) {
  const platform = normalizeSourcePlatformName(sourcePlatformFor(agent, item));
  const sourceUrl = sourceUrlForItem(item);
  return platform === 'tiktok' && /tiktok\.com\/@[^/]+\/video\/\d+/i.test(sourceUrl);
}

function parseBooleanFlag(value) {
  if (value === true) return true;
  if (value === false || value == null) return false;
  return /^(true|1|yes|y|on)$/i.test(String(value).trim());
}

function sourcePreApprovalStatusFor(item = {}) {
  const curatedYouTubeSocialSource = item.importedFromSourcePost !== true
    && normalizeSourcePlatformName(sourcePlatformFor({}, item)) === 'youtube'
    && urlLooksAllowedSocialSource(sourceUrlForItem(item));
  if (curatedYouTubeSocialSource) {
    return {
      preapproved: true,
      consent_confirmed: true,
      image_rights_confirmed: true,
      permission_status: 'founder_reported_agent_authorised_upload',
    };
  }
  const raw = item.raw_source_post || {};
  const permissionStatus = String(
    item.permission_status
      || item.permissionStatus
      || raw.permission_status
      || raw.permissionStatus
      || ''
  ).trim().toLowerCase();
  const consentConfirmed = parseBooleanFlag(
    item.consent_confirmed
      ?? item.consentConfirmed
      ?? item.agent_authorised
      ?? item.agentAuthorised
      ?? item.pre_approved
      ?? item.preApproved
      ?? raw.consent_confirmed
      ?? raw.consentConfirmed
      ?? raw.agent_authorised
      ?? raw.agentAuthorised
      ?? raw.pre_approved
      ?? raw.preApproved
  );
  const imageRightsConfirmed = parseBooleanFlag(
    item.image_rights_confirmed
      ?? item.imageRightsConfirmed
      ?? item.authorised_images
      ?? item.authorisedImages
      ?? item.pre_approved
      ?? item.preApproved
      ?? raw.image_rights_confirmed
      ?? raw.imageRightsConfirmed
      ?? raw.authorised_images
      ?? raw.authorisedImages
      ?? raw.pre_approved
      ?? raw.preApproved
  );
  const explicitPreapproved = parseBooleanFlag(
    item.pre_approved
      ?? item.preApproved
      ?? item.agent_preapproved
      ?? item.agentPreapproved
      ?? raw.pre_approved
      ?? raw.preApproved
      ?? raw.agent_preapproved
      ?? raw.agentPreapproved
  );
  return {
    preapproved: explicitPreapproved || (consentConfirmed && imageRightsConfirmed && PREAPPROVED_PERMISSION_STATUSES.includes(permissionStatus)),
    consent_confirmed: consentConfirmed || explicitPreapproved,
    image_rights_confirmed: imageRightsConfirmed || explicitPreapproved,
    permission_status: permissionStatus || (explicitPreapproved ? 'agent_preapproved' : 'pending_king_source_review'),
  };
}

function parseSourceDate(value = '') {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function sourceDateStatusFor(item = {}) {
  const date = parseSourceDate(sourcePublishedAtFor(item));
  if (!date) return 'needs_source_platform_date_confirmation';
  return date >= new Date(LAUNCH_SOURCE_POST_WINDOW_START)
    ? 'confirmed_2026_plus_source_window'
    : 'before_2026_source_window';
}

function hasPublishedPriceOrGuidePrice(item = {}) {
  const text = String(item.guidePrice || item.priceText || '').trim();
  const poaText = /\b(?:price\s*)?(?:upon application|on request|poa)\b/i.test(text);
  return Number(item.price || 0) > 0 || Boolean(text && !poaText);
}

function sourcePriceLabelFor(item = {}) {
  if (Number(item.price || 0) > 0) {
    return `${money(item.price)}${item.price_period && item.price_period !== 'once' ? `/${item.price_period}` : ''}`;
  }
  const text = String(item.guidePrice || item.priceText || '').trim();
  return text && !/\b(?:price\s*)?(?:upon application|on request|poa)\b/i.test(text) ? text : PRICE_UPON_APPLICATION_LABEL;
}

function isManualExactSocialIntake(item = {}) {
  const raw = item.raw_source_post || item.rawSourcePost || {};
  const nestedRaw = raw.raw_source_post || raw.rawSourcePost || {};
  const importMethod = String(
    raw.import_method
      || nestedRaw.import_method
      || item.import_method
      || ''
  ).trim().toLowerCase();
  return importMethod === 'no_api_exact_social_url_intake'
    || importMethod === 'tiktok_exact_video_intake';
}

function hasSpecificPropertySignal(item = {}) {
  const haystack = compactText([
    item.title,
    item.sourceTitle,
    item.description,
    item.sourceText,
    item.sourceVisualText,
    item.raw_source_post?.caption,
  ].filter(Boolean).join(' ')).toLowerCase();
  return /\b(?:for sale|for rent|to let|to rent|bed(?:room)?s?|studio|bedsitter|house|home|apartment|flat|villa|bungalow|mansion|duplex|condo|property|plot|plots|land|acre|acres|decimal|decimals|hostel|room|rooms|shop|office|warehouse|commercial|building)\b/.test(haystack);
}

function isPureHashtagSourceJunk(item = {}) {
  const raw = item.raw_source_post || item.rawSourcePost || {};
  const text = compactText([
    raw.title,
    raw.caption,
    raw.description,
    item.sourceTitle,
    item.sourceText,
  ].filter(Boolean).join(' '));
  if (!text || !/#\w+/u.test(text)) return false;
  const meaningful = text
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/#[\p{L}\p{N}_-]+/gu, ' ')
    .replace(/[\p{Extended_Pictographic}\p{Symbol}\uFE0F\s.,;:|/\\()[\]{}!?-]+/gu, ' ')
    .trim();
  return meaningful.length < 4;
}

function sourcePostMeetsLaunchIntakeRule(item = {}, agent = {}) {
  const hasSource = Boolean(sourceUrlForItem(item));
  const allowedSocialSource = itemHasAllowedSocialSource(item, agent);
  const locationQuality = sourceLocationQualityForItem(item, agent);
  const hasPrice = hasPublishedPriceOrGuidePrice(item);
  const priceUponApplication = !hasPrice;
  const imageRows = sourceImageRowsFor(item);
  const hasDirectContact = Boolean(String(agent.phone || agent.phoneAlt || agent.email || item.phone || item.phoneAlt || item.email || '').trim());
  const hasContact = hasAnyPublicContactPath(agent, item);
  const hasImageOrEvidence = Boolean(imageRows.length || sourceUrlForItem(item));
  const dateStatus = sourceDateStatusFor(item);
  const preApproval = sourcePreApprovalStatusFor(item);
  const sourceQuality = sourceQualityReviewForItem(item, agent);
  const positiveListingGate = sourcePositiveListingGateForItem(item, agent);
  const dataIntegrity = item.dataIntegrity || item.data_integrity || listingDataIntegrityReport({
    ...item,
    listing_type: item.listingType || item.listing_type,
    price_currency: item.priceCurrency || item.price_currency,
    price_original_currency: item.priceOriginalCurrency || item.price_original_currency,
    price_original: item.priceOriginal ?? item.price_original,
    price_fx_rate_ugx: item.priceFxRateUgx ?? item.price_fx_rate_ugx,
    price_on_application: !hasPublishedPriceOrGuidePrice(item),
    lister_phone: agent.phone || agent.phoneAlt || item.phone || '',
    source_contact_url: sourceContactUrlForAgent(agent, item),
    source_url: sourceUrlForItem(item),
    extra_fields: item.raw_source_post || item.rawSourcePost || {},
  });
  const countryGate = item.countryGate || item.country_gate || { allowed: true, reason: '', matched: '' };
  const hasLocation = item.locationEvidenceConfirmed !== false && (
    Boolean(String(item.address || item.area || item.district || '').trim())
      || positiveListingGate.has_uganda_location_signal === true
  );
  const pendingKingSourceReview = !preApproval.preapproved;
  const hasQueuePermission = allowedSocialSource;
  const requiresSpecificSourcePostLocation = item.importedFromSourcePost === true;
  const locationPassesIntake = !requiresSpecificSourcePostLocation || locationQuality.ok || positiveListingGate.has_uganda_location_signal === true;
  const lowSignalOnlySuppressed = sourceQuality.suppressed && /^low_signal_/i.test(String(sourceQuality.reason || ''));
  const sourceQualityHardBlocked = sourceQuality.suppressed && !lowSignalOnlySuppressed;
  const positiveGateHardBlocked = positiveListingGate.reason === 'not_a_listing'
    || positiveListingGate.reason === NON_TARGET_LOCATION_REASON;
  const integrityHardBlocked = dataIntegrity.issue_codes.includes('unsupported_hospitality_or_nightly');
  const manualExactSocialIntake = isManualExactSocialIntake(item);
  const specificPropertySignal = hasSpecificPropertySignal(item);
  const pureHashtagJunk = isPureHashtagSourceJunk(item);
  const dateWindowAllowsQueue = manualExactSocialIntake || dateStatus !== 'before_2026_source_window';
  const manualExactPasses = !manualExactSocialIntake || (
    specificPropertySignal
      && hasContact
      && hasImageOrEvidence
  );
  const captureToReview = Boolean(
    hasSource
      && allowedSocialSource
      && countryGate.allowed !== false
      && dateWindowAllowsQueue
      && !sourceQualityHardBlocked
      && !positiveGateHardBlocked
      && !integrityHardBlocked
      && !pureHashtagJunk
      && manualExactPasses
  );
  const blockingReasons = [
    !hasSource ? 'missing_exact_source_url' : '',
    !allowedSocialSource ? 'unsupported_source_platform' : '',
    countryGate.allowed === false ? (countryGate.reason || `non_${ACTIVE_COUNTRY_CODE.toLowerCase()}_country_or_currency`) : '',
    manualExactSocialIntake && !hasContact ? 'missing_public_contact_or_source_route' : '',
    manualExactSocialIntake && !hasImageOrEvidence ? 'missing_source_evidence' : '',
    manualExactSocialIntake && !specificPropertySignal ? 'not_a_specific_property_listing' : '',
    !dateWindowAllowsQueue ? 'before_2026_automated_source_window' : '',
    sourceQualityHardBlocked ? (sourceQuality.reason || 'non_listing_source_content') : '',
    positiveGateHardBlocked ? (positiveListingGate.reason || 'not_a_listing') : '',
    integrityHardBlocked ? 'unsupported_hospitality_or_nightly' : '',
    pureHashtagJunk ? 'pure_hashtag_source_junk' : '',
  ].filter(Boolean);
  return {
    eligible: captureToReview,
    blocking_reasons: blockingReasons,
    capture_mode: 'launch_review_first',
    capture_rule: `supported social property posts go to review even when phone, media, or exact ${TARGET_COUNTRY_NAME} location needs human confirmation; only explicit foreign evidence is location-rejected`,
    has_source_url: hasSource,
    allowed_social_source: allowedSocialSource,
    country_gate_passed: countryGate.allowed !== false,
    country_gate_reason: countryGate.reason || '',
    country_gate_matched: countryGate.matched || '',
    has_location_or_area: hasLocation,
    has_specific_location: locationQuality.ok,
    requires_specific_source_post_location: requiresSpecificSourcePostLocation,
    location_passes_intake: locationPassesIntake,
    location_quality_status: locationQuality.status,
    location_quality_reason: locationQuality.reason,
    location_quality_matched: locationQuality.matched || '',
    district_only_location: locationQuality.status === 'district_only_location',
    has_price_or_guide_price: hasPrice,
    price_upon_application: priceUponApplication,
    price_status: hasPrice ? 'published_price_or_guide_price' : 'price_upon_application',
    price_label: sourcePriceLabelFor(item),
    has_contact_path: hasContact,
    has_image_or_source_evidence: hasImageOrEvidence,
    date_status: dateStatus,
    manual_exact_social_intake: manualExactSocialIntake,
    date_window_allows_queue: dateWindowAllowsQueue,
    older_exact_source_requires_availability_review: manualExactSocialIntake && dateStatus === 'before_2026_source_window',
    original_poster_comment_required: false,
    preapproved: preApproval.preapproved,
    consent_confirmed: preApproval.consent_confirmed,
    image_rights_confirmed: preApproval.image_rights_confirmed,
    permission_status: preApproval.permission_status,
    exact_tiktok_pending_king_review: itemIsExactTikTokVideoSource(item, agent) && pendingKingSourceReview,
    pending_king_source_review: pendingKingSourceReview,
    queue_permission_status: hasQueuePermission
      ? (preApproval.preapproved ? 'preapproved_social_source' : 'social_source_pending_king_review_location_required')
      : 'unsupported_source_platform',
    website_source_blocked: hasSource && !allowedSocialSource,
    no_phone_ok_with_source_contact: Boolean(!String(agent.phone || agent.phoneAlt || item.phone || item.phoneAlt || '').trim() && hasContact),
    source_quality_suppressed: sourceQuality.suppressed,
    source_quality_reason: sourceQuality.reason,
    source_quality_matched: sourceQuality.matched,
    source_quality_listing_signal: sourceQuality.listing_signal || '',
    source_quality_low_signal_only: lowSignalOnlySuppressed,
    source_quality_hard_blocked: sourceQualityHardBlocked,
    source_quality_location_status: sourceQuality.location_status || locationQuality.status,
    positive_listing_gate_passed: positiveListingGate.ok,
    positive_listing_gate_reason: positiveListingGate.reason || '',
    positive_listing_gate_details: positiveListingGate.details || [],
    positive_listing_gate_hard_blocked: positiveGateHardBlocked,
    weak_contact_captured_for_review: !hasDirectContact,
    weak_media_captured_for_review: !imageRows.length,
    weak_location_captured_for_review: !locationPassesIntake || !locationQuality.ok,
    has_uganda_location_signal: positiveListingGate.has_uganda_location_signal === true,
    has_concrete_listing_signal: positiveListingGate.has_listing_signal === true,
    data_integrity: dataIntegrity,
    data_integrity_hard_blocked: integrityHardBlocked,
    pure_hashtag_source_junk: pureHashtagJunk,
  };
}

function sourceReviewReasonForIntake(intake = {}) {
  if (intake.suppressed_source_url) return 'skipped_suppressed';
  if (intake.country_gate_passed === false) return NON_TARGET_LOCATION_REASON;
  if (intake.source_quality_suppressed && /^low_signal_/i.test(String(intake.source_quality_reason || ''))) {
    return 'low_signal_source_location';
  }
  if (intake.source_quality_suppressed) return 'non_listing_source_content';
  if (intake.positive_listing_gate_passed === false) {
    return intake.positive_listing_gate_reason || 'not_a_listing';
  }
  if (intake.requires_specific_source_post_location && intake.has_location_or_area && !intake.has_specific_location) {
    return 'low_signal_source_location';
  }
  return 'missing_2026_launch_intake_evidence';
}

function youtubeConfidenceReviewForItem(item = {}) {
  return item.raw_source_post?.youtube_confidence_review
    || item.raw_source_post?.raw_source_post?.youtube_confidence_review
    || item.rawSourcePost?.youtube_confidence_review
    || item.rawSourcePost?.raw_source_post?.youtube_confidence_review
    || null;
}

function sourceJobForItem(item = {}) {
  return item.raw_source_post?.source_job
    || item.raw_source_post?.raw_source_post?.source_job
    || item.rawSourcePost?.source_job
    || item.rawSourcePost?.raw_source_post?.source_job
    || {};
}

function sourceJobIsHashtag(job = {}, item = {}) {
  const raw = item.raw_source_post || item.rawSourcePost || {};
  if (raw.youtube_hashtag_source === true || raw.raw_source_post?.youtube_hashtag_source === true) return true;
  const text = [
    job.source_type,
    job.sourceType,
    job.source_record_kind,
    job.sourceRecordKind,
    job.source_name,
    job.sourceName,
    job.source_url,
    job.sourceUrl,
    item.sourceType,
    item.source_type,
    item.sourceUrl,
    item.source_url,
  ].map((value) => String(value || '')).join(' ').toLowerCase();
  return text.includes('hashtag') || /youtube\.com\/hashtag\//i.test(text);
}

function sourcePostIsYouTubeApiPost(item = {}, agent = sourceAgentForItem(item)) {
  const raw = item.raw_source_post || item.rawSourcePost || {};
  const nested = raw.raw_source_post || raw.rawSourcePost || {};
  const job = sourceJobForItem(item);
  const platform = normalizeSourcePlatformName(sourcePlatformFor(agent, item));
  const sourceUrl = sourceUrlForItem(item);
  return Boolean(
    platform === 'youtube'
      && (
        raw.import_method === 'youtube_data_api_search'
        || nested.import_method === 'youtube_data_api_search'
        || job.platform === 'youtube'
        || item.youtubeId
        || item.youtube_id
        || /(?:youtube\.com|youtu\.be)/i.test(sourceUrl)
      )
  );
}

function sourcePostAutoLiveStatusFor(item = {}, agent = sourceAgentForItem(item)) {
  const review = youtubeConfidenceReviewForItem(item) || {};
  const job = sourceJobForItem(item);
  const sourceIsHashtag = sourceJobIsHashtag(job, item);
  const sourceIsYouTubeApi = sourcePostIsYouTubeApiPost(item, agent);
  const reviewSaysAutoLive = review.auto_live_ready === true
    || review.status === 'youtube_hashtag_auto_live_ready'
    || review.status === 'youtube_api_auto_live_ready';
  const reviewSaysYouTubeApiReady = review.live_ready === true
    || review.status === 'youtube_confident_live_ready'
    || review.status === 'youtube_hashtag_auto_live_ready'
    || review.status === 'youtube_api_auto_live_ready';
  const reviewHasPropertySignal = review.checks?.property_signal !== false;
  const hasLocation = review.location_status === 'area_or_neighbourhood_detected';
  const hasSourceDate = review.date_status === 'confirmed_2026_plus_source_window';
  const hasCategory = Boolean(item.listingType || item.listing_type || review.category_status && !/needs_review/i.test(String(review.category_status)));
  const hasContactPath = hasAnyPublicContactPath(agent, item);
  const allowedSocialSource = itemHasAllowedSocialSource(item, agent);
  const youtubeApiReady = Boolean(
    sourceIsYouTubeApi
      && reviewSaysYouTubeApiReady
      && reviewHasPropertySignal
      && hasLocation
      && hasSourceDate
      && hasCategory
      && hasContactPath
      && allowedSocialSource
      && sourceUrlForItem(item)
  );
  const hashtagReady = Boolean(
    reviewSaysAutoLive
      && sourceIsHashtag
      && reviewHasPropertySignal
      && hasLocation
      && hasSourceDate
      && hasCategory
      && hasContactPath
      && allowedSocialSource
      && sourceUrlForItem(item)
  );
  const readyForHumanReview = Boolean(hashtagReady || youtubeApiReady);
  return {
    approved: false,
    status: 'pending',
    moderation_stage: 'submitted',
    policy: 'always_on_harvest_review_only_v1',
    reason: readyForHumanReview
      ? 'High-confidence harvested listing is ready for human review; harvesting never auto-publishes.'
      : 'Harvested listing remains pending while source, location, category, date, contact, or duplicate evidence is reviewed.',
    ready_for_human_review: readyForHumanReview,
    source_is_hashtag: sourceIsHashtag,
    source_is_youtube_api: sourceIsYouTubeApi,
    review_status: review.status || '',
    review_score: review.score ?? null,
    phone_status: review.phone_status || '',
    location_status: review.location_status || '',
    date_status: review.date_status || '',
  };
}

function normalizedStatusValue(status = '') {
  return String(status || '').trim().toLowerCase();
}

function statusValuesFromRecord(statusOrRecord = '') {
  if (statusOrRecord && typeof statusOrRecord === 'object') {
    return [
      statusOrRecord.status,
      statusOrRecord.moderation_status,
      statusOrRecord.moderation_stage,
      statusOrRecord.review_status,
    ].map(normalizedStatusValue).filter(Boolean);
  }
  const normalized = normalizedStatusValue(statusOrRecord);
  return normalized ? [normalized] : [];
}

function isLiveOrApprovedStatus(statusOrRecord = '') {
  const finalStatuses = new Set(['approved', 'live', 'published', 'sold', 'hidden', 'deleted', 'rejected', 'archived']);
  return statusValuesFromRecord(statusOrRecord).some((status) => finalStatuses.has(status));
}

function isReviewQueueStatus(statusOrRecord = '') {
  if (isLiveOrApprovedStatus(statusOrRecord)) return false;
  const statuses = statusValuesFromRecord(statusOrRecord);
  const normalized = statuses[0] || 'pending';
  return Boolean(normalized && !['deleted', 'archived', 'rejected', 'hidden'].includes(normalized));
}

function sourceContactUrlForAgent(agent = {}, item = {}) {
  return sourceContactCandidateUrls(agent, item)[0] || '';
}

function normalizedContactPhoneKey(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10 && digits.startsWith('0')) digits = `256${digits.slice(1)}`;
  if (digits.length === 9 && /^7|^3/.test(digits)) digits = `256${digits}`;
  return digits.length >= 9 ? `phone:${digits}` : '';
}

function normalizedContactKeyForSource(agent = {}, item = {}) {
  const phoneKey = normalizedContactPhoneKey(agent.phone || agent.phoneAlt || item.phone || item.phoneAlt || '');
  if (phoneKey) return phoneKey;
  const email = String(agent.email || item.email || '').trim().toLowerCase();
  if (email) return `email:${email}`;
  const contactUrl = sourceContactUrlForAgent(agent, item).trim().toLowerCase().replace(/\/+$/g, '');
  return contactUrl ? `source:${contactUrl}` : '';
}

function contentFingerprintForSourceItem(item = {}, agent = sourceAgentForItem(item)) {
  const phone = normalizedContactPhoneKey(agent.phone || agent.phoneAlt || item.phone || item.contactPhone || '').replace(/^phone:/, '');
  const area = compactText(item.area || item.location || item.district || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const listingType = normalizeFoundOnlineListingType(item.listingType || item.listing_type || item.property_type || item.title || '');
  const price = Math.max(0, Math.round(Number(item.price || item.price_ugx || 0) || 0));
  if (!phone || !area || !listingType || !price) return '';
  return [phone, area, listingType, price].join('|');
}

function harvestFingerprintsForItem(item = {}) {
  const raw = item.raw_source_post || item.rawSourcePost || {};
  const nested = raw.harvest_dedup || {};
  const preserved = Object.fromEntries(Object.entries(nested).filter(([, value]) => value != null && value !== ''));
  return {
    ...buildHarvestFingerprints({
      ...raw,
      source_url: sourceUrlForItem(item),
      caption: item.caption || item.sourceTitle || raw.caption,
      title: item.title,
      description: item.description,
      source_text: item.sourceText || raw.source_text,
      contact_phone: item.sourceAgent?.phone || raw.contact_phone,
      source_contact_url: item.sourceContactUrl || raw.source_contact_url,
      area: item.area,
      district: item.district,
      price: item.price,
    }, {
      imageHash: nested.primary_image_dhash || raw.primary_image_dhash || '',
      imagePHash: nested.primary_image_phash || raw.primary_image_phash || '',
    }),
    ...preserved,
  };
}

function sourceContactMethodForAgent(agent = {}) {
  if (agent.phone) return 'phone';
  if (agent.email) return 'email';
  if (agent.facebookUrl) return 'facebook';
  if (agent.instagramUrl) return 'instagram';
  if (agent.tiktokUrl) return 'tiktok';
  if (agent.xUrl || agent.twitterUrl) return 'x';
  if (agent.channelUrl) return 'social';
  return 'source';
}

function sourceContactLabelForAgent(agent = {}) {
  if (agent.phone) return 'Call or WhatsApp the agent';
  if (agent.email) return 'Email the agent';
  if (agent.facebookUrl) return 'Contact through the public Facebook source';
  if (agent.instagramUrl) return 'Contact through the public Instagram source';
  if (agent.tiktokUrl) return 'Contact through the public TikTok source';
  if (agent.xUrl || agent.twitterUrl) return 'Contact through the public X/Twitter source';
  if (agent.channelUrl) return 'Contact through the public social channel';
  return 'Open the public source page';
}

function sourcePlatformFor(agent = {}, item = {}) {
  const explicit = String(item.sourcePlatform || item.platform || agent.platform || agent.sourcePlatform || '').trim();
  if (explicit) return explicit;
  const evidence = [
    agent.channelUrl,
    agent.website,
    agent.facebookUrl,
    agent.instagramUrl,
    agent.tiktokUrl,
    agent.xUrl,
    agent.twitterUrl,
    item.sourceUrl,
    item.postUrl,
    item.listingUrl,
    item.publicUrl,
    item.videoUrl,
    item.youtubeId ? 'youtube' : '',
  ].filter(Boolean).join(' ').toLowerCase();
  if (evidence.includes('tiktok')) return 'TikTok';
  if (evidence.includes('instagram')) return 'Instagram';
  if (evidence.includes('facebook')) return 'Facebook';
  if (evidence.includes('twitter.com') || evidence.includes('x.com')) return 'X';
  if (evidence.includes('youtube') || item.youtubeId) return 'YouTube';
  if (evidence.includes('http')) return 'Website';
  return 'Online source';
}

function sourcePlatformFeedLabel(platform = '') {
  const normalized = String(platform || '').trim().toLowerCase();
  if (normalized === 'x') return 'public X property feed';
  if (normalized === 'twitter') return 'public X/Twitter property feed';
  if (normalized === 'youtube') return 'public YouTube Shorts feed';
  if (normalized === 'tiktok') return 'public TikTok property feed';
  if (normalized === 'instagram') return 'public Instagram property feed';
  if (normalized === 'facebook') return 'public Facebook property feed';
  if (normalized === 'website') return 'public property website feed';
  return 'public online property source';
}

const DEFAULT_SOCIAL_SOURCE_IMAGE_FRAMES = [
  { file: 'hqdefault.jpg', label: 'Source video cover still', primary: true },
  { file: '0.jpg', label: 'Source video preview still', primary: false },
  { file: '1.jpg', label: 'Source video supporting still', primary: false },
  { file: '2.jpg', label: 'Source video additional still', primary: false },
  { file: '3.jpg', label: 'Source video extra still', primary: false },
];

function youtubeImageRowsFor(item) {
  if (!item.youtubeId) return [];
  const base = `https://i.ytimg.com/vi/${item.youtubeId}`;
  const configuredFrames = Array.isArray(item.imageFrames) ? item.imageFrames.filter(Boolean) : [];
  const frames = (configuredFrames.length ? configuredFrames : DEFAULT_SOCIAL_SOURCE_IMAGE_FRAMES)
    .filter((frame) => frame?.file && frame?.label)
    .slice(0, 5);
  return frames.map((frame, index) => ({
    url: `${base}/${frame.file}`,
    slot_key: frame.label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''),
    room_label: frame.label,
    is_primary: Boolean(index === 0 || frame.primary),
    sort_order: index,
  }));
}

function sourceEvidenceCardDataUrl(item = {}, agent = {}) {
  const sourceUrl = sourceUrlForItem(item) || sourceContactUrlForAgent(agent, item) || 'Source URL to verify';
  const platform = sourcePlatformFor(agent, item);
  const title = item.title || item.sourceTitle || 'Found-online property source';
  const area = item.address || [item.area, item.district].filter(Boolean).join(', ') || 'Location/area to verify';
  const priceText = sourcePriceLabelFor(item);
  const posted = sourcePublishedLabelFor(item);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="820" viewBox="0 0 1280 820">
  <rect width="1280" height="820" fill="#f8fafc"/>
  <rect x="0" y="0" width="1280" height="145" fill="#155e75"/>
  <text x="82" y="90" font-family="Arial, sans-serif" font-size="43" font-weight="800" fill="#ffffff">${TARGET_BRAND_NAME} | found-online source evidence</text>
  <rect x="84" y="205" width="1112" height="470" rx="24" fill="#ffffff" stroke="#bae6fd" stroke-width="5"/>
  <text x="124" y="285" font-family="Arial, sans-serif" font-size="40" font-weight="800" fill="#0f172a">${escapeSvg(title)}</text>
  <text x="124" y="355" font-family="Arial, sans-serif" font-size="31" fill="#334155">${escapeSvg(area)}</text>
  <text x="124" y="425" font-family="Arial, sans-serif" font-size="32" font-weight="800" fill="#166534">${escapeSvg(priceText)}</text>
  <text x="124" y="492" font-family="Arial, sans-serif" font-size="27" fill="#475569">Platform: ${escapeSvg(platform)} | ${escapeSvg(posted)}</text>
  <text x="124" y="560" font-family="Arial, sans-serif" font-size="24" fill="#475569">Public source: ${escapeSvg(sourceUrl).slice(0, 110)}</text>
  <text x="124" y="628" font-family="Arial, sans-serif" font-size="24" fill="#7c2d12">Evidence card only. Replace with direct public/authorised listing photos when available.</text>
</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

function sourceImageRowsFor(item = {}) {
  const configured = uniqueUrls([
    item.imageUrl,
    item.thumbnailUrl,
    item.ogImageUrl,
    item.coverImageUrl,
    item.facebookImageUrl,
    item.instagramImageUrl,
    item.tiktokImageUrl,
    item.xImageUrl,
    item.twitterImageUrl,
    item.photoUrls,
    item.imageUrls,
    item.mediaUrls,
    item.platformImageUrls,
  ]).slice(0, 5);
  if (configured.length) {
    return configured.map((url, index) => ({
      url,
      slot_key: index === 0 ? 'source_primary_image' : `source_image_${index + 1}`,
      room_label: index === 0 ? 'Source listing image' : 'Source supporting image',
      is_primary: index === 0,
      sort_order: index,
    }));
  }
  return youtubeImageRowsFor(item);
}

function money(value) {
  return IS_SOUTH_AFRICA
    ? `R ${Number(value || 0).toLocaleString('en-ZA')}`
    : `USh ${Number(value || 0).toLocaleString('en-UG')}`;
}

function escapeSvg(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function landSizeText(item = {}) {
  if (!item.landSizeValue) return 'Size to verify';
  const unit = item.landSizeUnit || '';
  const acres = unit.toLowerCase().startsWith('decimal')
    ? Number(item.landSizeValue) / 100
    : unit.toLowerCase().startsWith('acre')
      ? Number(item.landSizeValue)
      : null;
  const sqft = acres ? Math.round(acres * 43560) : null;
  return sqft
    ? `${item.landSizeValue} ${unit} | approx ${acres.toFixed(2)} acres | ${sqft.toLocaleString('en-UG')} sq ft`
    : `${item.landSizeValue} ${unit}`.trim();
}

function landSizeDiagramDataUrl(item = {}) {
  const title = item.title || 'Land size guide';
  const area = item.address || [item.area, item.district].filter(Boolean).join(', ') || 'Location to verify';
  const sizeText = landSizeText(item);
  const priceText = sourcePriceLabelFor(item);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="820" viewBox="0 0 1280 820">
  <rect width="1280" height="820" fill="#f7fbef"/>
  <rect x="0" y="0" width="1280" height="145" fill="#2f7d42"/>
  <text x="92" y="90" font-family="Arial, sans-serif" font-size="44" font-weight="800" fill="#ffffff">${TARGET_BRAND_NAME} | land size guide</text>
  <rect x="88" y="205" width="530" height="430" rx="28" fill="#ffffff" stroke="#2f7d42" stroke-width="7"/>
  <rect x="198" y="288" width="310" height="250" rx="8" fill="#dff4e7" stroke="#2f7d42" stroke-width="8" stroke-dasharray="18 14"/>
  <text x="230" y="425" font-family="Arial, sans-serif" font-size="42" font-weight="800" fill="#205b31">LAND</text>
  <line x1="198" y1="560" x2="508" y2="560" stroke="#374151" stroke-width="5"/>
  <text x="225" y="605" font-family="Arial, sans-serif" font-size="25" fill="#374151">illustrative boundary</text>
  <rect x="680" y="205" width="512" height="430" rx="28" fill="#ffffff" stroke="#cbd5e1" stroke-width="4"/>
  <text x="720" y="292" font-family="Arial, sans-serif" font-size="44" font-weight="800" fill="#111827">${escapeSvg(title)}</text>
  <text x="720" y="360" font-family="Arial, sans-serif" font-size="31" fill="#374151">${escapeSvg(area)}</text>
  <text x="720" y="442" font-family="Arial, sans-serif" font-size="34" font-weight="800" fill="#2f7d42">${escapeSvg(sizeText)}</text>
  <text x="720" y="512" font-family="Arial, sans-serif" font-size="36" font-weight="800" fill="#8a1f45">${escapeSvg(priceText)}</text>
  <text x="720" y="582" font-family="Arial, sans-serif" font-size="25" fill="#374151">Guide image only. Confirm actual plot, title, access road and boundaries with the source/agent.</text>
</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

function landVisualStrategy(item = {}) {
  if (item.listingType !== 'land') return '';
  return 'For found-online land, public pages should use source links or official embeds rather than copied social photos. Store any evidence cards for King review only, then ask the source/agent for authorised HD plot photos before showing photos publicly.';
}

function listingImageRowsFor(item = {}) {
  const agent = sourceAgentForItem(item);
  const sourceRows = sourceImageRowsFor(item);
  const evidenceRows = sourceRows.length ? sourceRows : [{
    url: sourceEvidenceCardDataUrl(item, agent),
    slot_key: 'source_evidence_card',
    room_label: 'Source evidence card - image pending',
    is_primary: true,
    sort_order: 0,
  }];
  if (item.listingType !== 'land') return evidenceRows;
  const diagram = {
    url: landSizeDiagramDataUrl(item),
    slot_key: 'land_size_guide_illustration',
    room_label: 'Land-size guide illustration',
    is_primary: evidenceRows.length === 0,
    sort_order: evidenceRows.length,
  };
  const visibleEvidenceRows = evidenceRows.slice(0, 4);
  return [...visibleEvidenceRows, diagram].slice(0, 5).map((image, index) => ({
    ...image,
    sort_order: index,
    is_primary: index === 0,
  }));
}

function publicDescriptionFor(item = {}) {
  const agent = sourceAgentForItem(item);
  const listingType = item.listingType === 'land'
    ? 'land listing'
    : item.listingType === 'commercial'
      ? 'commercial property'
      : item.beds
        ? `${item.beds}-bedroom home`
        : 'property';
  const area = item.address || [item.area, item.district].filter(Boolean).join(', ');
  const priceText = hasPublishedPriceOrGuidePrice(item)
    ? ` The guide price shown in the source is ${sourcePriceLabelFor(item)}.`
    : ` The source did not publish a price, so ${TARGET_BRAND_NAME} shows ${PRICE_UPON_APPLICATION_LABEL} until the source confirms it.`;
  const roomText = item.beds
    ? ` It is presented as a ${item.beds}-bedroom ${item.subtype || 'property'}${item.baths ? ` with ${item.baths} bathrooms` : ''}.`
    : item.landSizeValue
      ? ` The source indicates a land size of ${item.landSizeValue}${item.landSizeUnit || ''}.`
      : '';
  const sourceTitle = item.sourceTitle ? ` The source post is titled "${item.sourceTitle}".` : '';
  const firstPosted = sourcePublishedLabelFor(item);
  const raw = String(item.description || '')
    .replace(/prepared from[^.?!]*\./gi, '')
    .replace(/founder-reported permission/gi, '')
    .replace(/\s*Confirm[^.?!]*(?:before\s+(?:public\s+)?approval|before approval)\.?/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  const intro = `${item.title} is a ${listingType} around ${area}.`;
  const agentLine = agent.name ? ` It is connected to ${agent.name}'s public property source, with the available contact route shown on the listing for direct enquiry.` : '';
  const guidance = ' Viewers should use the gallery, source evidence, map area and contact route to confirm availability and arrange a viewing.';
  return [intro, roomText, priceText, raw && raw !== intro ? ` ${raw}` : '', sourceTitle, ` ${firstPosted.replace(/\.*$/, '')}.`, agentLine, guidance]
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

function reviewSteps(item = {}) {
  const manualOlderExactSource = isManualExactSocialIntake(item)
    && sourceDateStatusFor(item) === 'before_2026_source_window';
  const steps = [
    manualOlderExactSource
      ? 'This manually supplied exact source post predates 2026; confirm that the property is still available before approval'
      : 'Confirm the exact source post/listing was first published on or after 1 January 2026',
    `Confirm the agent/source still wants this exact listing live on ${publicBaseUrl()}`,
    `Confirm current availability and price, or keep ${PRICE_UPON_APPLICATION_LABEL} if the source does not publish one`,
    'Confirm the exact road/map pin and update it if the agent gives a better pin',
    'Confirm title/ownership evidence or broker authority before public approval',
    'Keep differentiated evidence-based source images, public platform thumbnails, authorised screenshots, or labelled evidence cards; upload direct HD agent photos when supplied',
  ];
  if (item.listingType === 'land') {
    steps.push('Confirm plot size, boundaries, access road, and title tenure before approval');
  } else {
    steps.push('Confirm bedroom, bathroom, parking, and land-size details before approval');
  }
  return steps;
}

function sourcePublishedAtFor(item = {}) {
  return item.firstPostedOnlineAt
    || item.sourcePublishedAt
    || item.videoPublishedAt
    || item.youtubePublishedAt
    || item.postPublishedAt
    || item.platformPublishedAt
    || item.publishedAt
    || item.originalPostedAt
    || item.sourcePostedAt
    || item.postedAt
    || null;
}

function sourcePublishedLabelFor(item = {}) {
  const publishedAt = sourcePublishedAtFor(item);
  if (!publishedAt) {
    return 'Original post date is being confirmed from the source platform for the 2026+ found-online window.';
  }
  const dateText = String(publishedAt).slice(0, 10);
  return dateText ? `First posted online on ${dateText}` : 'Original post date is being confirmed from the source platform.';
}

function sourceQualityReviewForItem(item = {}, agent = sourceAgentForItem(item)) {
  return sourceQualitySuppressionForRecord({
    ...item,
    source_name: agent.name || item.agentKey || '',
    source_agent_name: agent.name || item.agentKey || '',
    lister_name: agent.name || '',
    extra_fields: {
      source_name: agent.name || '',
      source_agent_name: agent.name || '',
      public_display_name: agent.name || '',
      source_title: item.sourceTitle || item.source_title || item.title || '',
      source_caption: item.caption || item.raw_source_post?.caption || item.rawSourcePost?.caption || '',
      source_description: item.description || '',
      source_text: item.sourceText || item.source_text || item.raw_source_post?.source_text || item.rawSourcePost?.source_text || '',
      source_visual_text: item.sourceVisualText || item.source_visual_text || item.raw_source_post?.source_visual_text || item.rawSourcePost?.source_visual_text || '',
      youtube_source_title: item.youtube_source_title || item.sourceTitle || '',
      raw_source_post: item.raw_source_post || item.rawSourcePost || {}
    }
  });
}

function sourcePositiveListingGateForItem(item = {}, agent = sourceAgentForItem(item)) {
  return sourcePositiveListingGateForRecord({
    ...item,
    title: item.title || item.sourceTitle || item.source_title || '',
    description: item.description || item.caption || item.sourceText || item.source_text || '',
    source_name: agent.name || item.agentKey || '',
    source_agent_name: agent.name || item.agentKey || '',
    lister_name: agent.name || '',
    source_platform: sourcePlatformFor(agent, item),
    source_url: sourceUrlForItem(item),
    price: item.price,
    bedrooms: item.beds ?? item.bedrooms,
    beds: item.beds ?? item.bedrooms,
    listing_type: item.listingType || item.listing_type || '',
    property_type: item.subtype || item.property_type || '',
    latitude: item.lat ?? item.latitude,
    longitude: item.lng ?? item.longitude,
    extra_fields: {
      source_name: agent.name || '',
      source_agent_name: agent.name || '',
      public_display_name: agent.name || '',
      source_title: item.sourceTitle || item.source_title || item.title || '',
      source_caption: item.caption || item.raw_source_post?.caption || item.rawSourcePost?.caption || '',
      source_description: item.description || '',
      source_text: item.sourceText || item.source_text || item.raw_source_post?.source_text || item.rawSourcePost?.source_text || '',
      source_visual_text: item.sourceVisualText || item.source_visual_text || item.raw_source_post?.source_visual_text || item.rawSourcePost?.source_visual_text || '',
      youtube_source_title: item.youtube_source_title || item.sourceTitle || '',
      resolved_location_label: item.address || item.location_label || '',
      map_pin_label: item.address || item.location_label || '',
      raw_source_post: item.raw_source_post || item.rawSourcePost || {}
    }
  });
}

function sourceLocationQualityForItem(item = {}, agent = sourceAgentForItem(item)) {
  return sourceLocationQualityForRecord({
    ...item,
    source_name: agent.name || item.agentKey || '',
    source_agent_name: agent.name || item.agentKey || '',
    lister_name: agent.name || '',
    extra_fields: {
      source_name: agent.name || '',
      source_agent_name: agent.name || '',
      public_display_name: agent.name || '',
      source_title: item.sourceTitle || item.source_title || item.title || '',
      source_caption: item.caption || item.raw_source_post?.caption || item.rawSourcePost?.caption || '',
      youtube_source_title: item.youtube_source_title || item.sourceTitle || '',
      resolved_location_label: item.address || item.location_label || '',
      map_pin_label: item.address || item.location_label || '',
      raw_source_post: item.raw_source_post || item.rawSourcePost || {}
    }
  });
}

function distanceKmBetween(lat1, lng1, lat2, lng2) {
  const radiusKm = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos((lat1 * Math.PI) / 180)
    * Math.cos((lat2 * Math.PI) / 180)
    * Math.sin(dLng / 2) ** 2;
  return radiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function sourceItemCoordinates(item = {}) {
  const lat = numberOrNull(item.lat ?? item.latitude);
  const lng = numberOrNull(item.lng ?? item.longitude);
  if (lat == null || lng == null) return null;
  if (Number(lat) === 0 && Number(lng) === 0) return null;
  return { lat, lng };
}

function nearestCampusByCoordinates(item = {}) {
  const coords = sourceItemCoordinates(item);
  if (!coords) return null;
  return STUDENT_CAMPUS_COORDINATES
    .map((campus) => ({
      ...campus,
      distance_km: distanceKmBetween(coords.lat, coords.lng, campus.lat, campus.lng)
    }))
    .filter((campus) => campus.distance_km <= STUDENT_NEAR_CAMPUS_RADIUS_KM)
    .sort((a, b) => a.distance_km - b.distance_km)[0] || null;
}

function isStudentSourceListing(item = {}) {
  const type = String(item.listingType || item.listing_type || item.type || '').trim().toLowerCase();
  if (type === 'student' || type === 'students') return true;
  const extra = item.extra_fields && typeof item.extra_fields === 'object' ? item.extra_fields : {};
  const text = [
    item.title,
    item.description,
    item.caption,
    item.sourceTitle,
    item.source_title,
    item.sourceText,
    item.source_text,
    item.area,
    item.address,
    item.nearest_university,
    item.university,
    item.campus,
    extra.source_title,
    extra.source_caption,
    extra.source_description,
    extra.source_text,
    extra.nearest_university,
    extra.student_campus,
    extra.student_university,
  ].map((value) => String(value || '')).filter(Boolean).join(' ');
  return STUDENT_SOURCE_LISTING_PATTERN.test(text);
}

function nearestUniversityForSourceItem(item = {}) {
  const extra = item.extra_fields && typeof item.extra_fields === 'object' ? item.extra_fields : {};
  if (!isStudentSourceListing(item) && !inferNearestUniversityFromListing(item)) return '';
  const campusByCoords = nearestCampusByCoordinates(item);
  if (campusByCoords) return campusByCoords.name;
  return normalizeUniversityName(
    item.nearest_university
    || item.nearestUniversity
    || item.nearest_uni
    || item.university
    || item.campus
    || extra.nearest_university
    || extra.nearestUniversity
    || extra.student_campus
    || extra.student_university
  ) || inferNearestUniversityFromListing({
    ...item,
    listing_type: item.listingType || item.listing_type,
    extra_fields: {
      ...extra,
      source_title: item.sourceTitle || item.source_title || item.title || extra.source_title || '',
      source_caption: item.caption || item.raw_source_post?.caption || item.rawSourcePost?.caption || extra.source_caption || '',
      source_description: item.description || extra.source_description || '',
      source_text: item.sourceText || item.source_text || item.raw_source_post?.source_text || item.rawSourcePost?.source_text || extra.source_text || '',
      source_visual_text: item.sourceVisualText || item.source_visual_text || item.raw_source_post?.source_visual_text || item.rawSourcePost?.source_visual_text || extra.source_visual_text || '',
      resolved_location_label: item.address || item.location_label || extra.resolved_location_label || '',
      map_pin_label: item.address || item.location_label || extra.map_pin_label || ''
    }
  });
}

function extraFieldsFor(item, agentId = null, propertyUrl = '', ownerPreviewUrl = '') {
  const agent = sourceAgentForItem(item);
  const sourceUrl = sourceUrlForItem(item);
  const sourceContactUrl = sourceContactUrlForAgent(agent, item);
  const sourceContactMethod = sourceContactMethodForAgent(agent);
  const sourceContactLabel = sourceContactLabelForAgent(agent);
  const sourcePlatform = sourcePlatformFor(agent, item);
  const hasDirectAgentPhone = Boolean(String(agent.phone || agent.phoneAlt || '').trim());
  const sourceContactAvailableWithoutPhone = Boolean(!hasDirectAgentPhone && sourceContactUrl);
  const nearby = NEARBY[item.nearbyKey] || [];
  const sourceImageRows = sourceImageRowsFor(item);
  const sourceThumbnailUrl = sourceImageRows[0]?.url || item.thumbnailUrl || item.sourceThumbnailUrl || item.videoThumbnailUrl || '';
  const imageRows = listingImageRowsFor(item);
  const generatedSupportImageRows = imageRows.filter((image) => /^data:image\//i.test(image.url));
  const sourcePublishedAt = sourcePublishedAtFor(item);
  const sourcePublishedLabel = sourcePublishedLabelFor(item);
  const sourceDateStatus = sourceDateStatusFor(item);
  const manualExactSocialIntake = isManualExactSocialIntake(item);
  const olderExactSourceRequiresAvailabilityReview = manualExactSocialIntake
    && sourceDateStatus === 'before_2026_source_window';
  const preApproval = sourcePreApprovalStatusFor(item);
  const youtubeConfidenceReview = youtubeConfidenceReviewForItem(item);
  const autoLive = sourcePostAutoLiveStatusFor(item, agent);
  const positiveListingGate = sourcePositiveListingGateForItem(item, agent);
  const nearestUniversity = nearestUniversityForSourceItem(item);
  const trustReview = buildSocialSourceTrustReview({
    ...item,
    agent,
    source_url: sourceUrl,
    source_post_url: sourceUrl,
    source_contact_url: sourceContactUrl,
    source_platform: sourcePlatform,
    source_name: agent.name,
    source_published_at: sourcePublishedAt,
    first_posted_online_at: sourcePublishedAt,
    source_followers_label: agent.audienceLabel || item.audienceLabel || '',
    source_account_created_at: item.source_account_created_at || item.account_created_at || agent.accountCreatedAt || '',
    source_account_age_label: item.source_account_age_label || item.accountAgeLabel || agent.accountAgeLabel || '',
    source_video_count: item.source_video_count || item.source_post_count || item.videoCount || item.postCount || '',
    source_video_count_label: item.source_video_count_label || item.source_post_count_label || item.postingVolumeLabel || '',
    price_label: sourcePriceLabelFor(item),
    price_upon_application: !hasPublishedPriceOrGuidePrice(item),
    contact_phone: agent.phone || agent.phoneAlt || item.contactPhone || item.phone || '',
    email: agent.email || item.email || '',
    raw_source_post: item.raw_source_post || item.rawSourcePost || {}
  });
  return {
    found_online_candidate: true,
    social_search_candidate: true,
    found_online: true,
    source_badge: 'found_online',
    source_batch: itemBatchId(item),
    source_listing_key: item.key,
    source_registry_key: agent.key || item.agentKey || '',
    content_fingerprint: contentFingerprintForSourceItem(item, agent),
    ...harvestFingerprintsForItem(item),
    canonical_location_id: item.canonicalLocationId || item.canonical_location_id || null,
    canonical_location_level: item.canonicalLocationLevel || item.canonical_location_level || null,
    location_resolution_status: item.locationResolutionStatus || item.location_resolution_status || null,
    location_resolution_confidence: item.locationResolutionConfidence ?? item.location_resolution_confidence ?? null,
    raw_location: item.rawLocation || item.raw_location || null,
    country_gate: item.countryGate || item.country_gate || null,
    source_price_rejection_reason: item.sourcePriceRejectionReason || item.source_price_rejection_reason || null,
    source_platform: sourcePlatform,
    source_type: item.sourceType || item.source_type || 'found_online_source_post',
    transaction_type: item.transactionType || item.transaction_type || null,
    commercial_type: item.listingType === 'commercial' ? (item.subtype || null) : null,
    commercial_classification_warning: commercialMisclassificationWarning({
      ...item,
      listing_type: item.listingType || item.listing_type
    }) || null,
    source_name: agent.name || '',
    source_agent_name: agent.name || '',
    source_url: sourceUrl,
    source_post_url: sourceUrl,
    thumbnail_url: sourceThumbnailUrl,
    source_thumbnail_url: sourceThumbnailUrl,
    video_thumbnail_url: sourceThumbnailUrl,
    source_title: item.sourceTitle || item.title || '',
    source_caption: item.caption || item.raw_source_post?.caption || item.rawSourcePost?.caption || '',
    source_description: item.description || '',
    source_text: item.sourceText || item.raw_source_post?.source_text || item.rawSourcePost?.source_text || '',
    nearest_university: nearestUniversity || null,
    student_campus: nearestUniversity || null,
    student_universities: nearestUniversity ? normalizeUniversityList([nearestUniversity]) : [],
    source_comments: item.raw_source_post?.comments || item.rawSourcePost?.comments || item.comments || '',
    source_visual_text: item.sourceVisualText || item.source_visual_text || item.raw_source_post?.source_visual_text || item.rawSourcePost?.source_visual_text || '',
    video_ocr_text: item.sourceVisualText || item.source_visual_text || item.raw_source_post?.video_ocr_text || item.rawSourcePost?.video_ocr_text || '',
    frame_ocr_text: item.raw_source_post?.frame_ocr_text || item.rawSourcePost?.frame_ocr_text || '',
    source_post_window_start: LAUNCH_SOURCE_POST_WINDOW_START,
    source_post_date_status: sourceDateStatus,
    manual_exact_social_intake: manualExactSocialIntake,
    older_exact_source_requires_availability_review: olderExactSourceRequiresAvailabilityReview,
    original_poster_comment_required: false,
    first_seen_online_at: SOCIAL_SEARCH_FIRST_SEEN_AT,
    first_seen_online_label: 'First picked up by makaug source watch on 20 May 2026',
    first_posted_online_at: sourcePublishedAt || null,
    source_published_at: sourcePublishedAt || null,
    video_published_at: sourcePublishedAt || null,
    youtube_source_published_at: sourcePublishedAt || null,
    first_posted_online_label: sourcePublishedLabel,
    source_published_label: sourcePublishedLabel,
    original_publish_date_status: sourcePublishedAt
      ? 'Source platform publish date captured from the stored source record.'
      : 'Original post date is being confirmed from the source platform.',
    youtube_confidence_review: youtubeConfidenceReview,
    youtube_confidence_status: youtubeConfidenceReview?.status || '',
    youtube_confidence_score: youtubeConfidenceReview?.score ?? null,
    youtube_live_ready: youtubeConfidenceReview?.live_ready === true,
    youtube_phone_status: youtubeConfidenceReview?.phone_status || '',
    youtube_location_status: youtubeConfidenceReview?.location_status || '',
    youtube_category_status: youtubeConfidenceReview?.category_status || '',
    auto_live_source_import: autoLive.approved,
    auto_live_policy: autoLive.policy,
    auto_live_reason: autoLive.reason,
    auto_live_review_status: autoLive.review_status,
    auto_live_review_score: autoLive.review_score,
    auto_live_source_is_hashtag: autoLive.source_is_hashtag,
    auto_live_source_is_youtube_api: autoLive.source_is_youtube_api,
    added_to_makaug_at: SOCIAL_SEARCH_ADDED_TO_MAKAUG_AT,
    added_to_makaug_label: 'Added to makaug source review on 20 May 2026',
    source_followers_label: agent.audienceLabel || 'Audience count to confirm from source',
    source_audience_label: agent.audienceLabel || 'Audience count to confirm from source',
    source_contact_url: sourceContactUrl,
    source_contact_label: sourceContactLabel,
    source_contact_method: sourceContactMethod,
    source_contact_platform: sourcePlatform,
    source_contact_available_without_phone: sourceContactAvailableWithoutPhone,
    public_contact_phone: agent.phone || agent.phoneAlt || item.contactPhone || item.phone || '',
    contact_phone: agent.phone || agent.phoneAlt || item.contactPhone || item.phone || '',
    public_contact_path_available: hasAnyPublicContactPath(agent, item),
    source_unavailable: item.sourceUnavailable === true || item.source_unavailable === true,
    source_url_status: item.sourceUrlStatus || item.source_url_status || '',
    source_unavailable_reason: item.sourceUnavailableReason || item.source_unavailable_reason || '',
    social_source_trust_review: trustReview,
    social_source_trust_score: trustReview.score,
    social_source_trust_level: trustReview.level,
    source_no_phone_policy: PUBLIC_SOURCE_CONTACT_POLICY,
    price_label: sourcePriceLabelFor(item),
    source_price_label: sourcePriceLabelFor(item),
    price_currency: item.priceCurrency || item.price_currency || CANONICAL_PROPERTY_CURRENCY,
    price_original_currency: item.priceOriginalCurrency || item.price_original_currency || CANONICAL_PROPERTY_CURRENCY,
    price_original: item.priceOriginal ?? item.price_original ?? item.price ?? null,
    price_fx_rate_ugx: item.priceFxRateUgx ?? item.price_fx_rate_ugx ?? null,
    price_fx_as_of: item.priceFxAsOf || item.price_fx_as_of || null,
    price_conversion_basis: (item.priceOriginalCurrency || item.price_original_currency) === 'USD'
      ? `Original public USD guide converted to canonical ${CANONICAL_PROPERTY_CURRENCY} for search and sorting.`
      : `Original public ${CANONICAL_PROPERTY_CURRENCY} guide stored without conversion.`,
    price_upon_application: !hasPublishedPriceOrGuidePrice(item),
    price_status: hasPublishedPriceOrGuidePrice(item) ? 'published_price_or_guide_price' : 'price_upon_application',
    source_price_policy: `If the public social source does not publish a price, ${TARGET_BRAND_NAME} shows Price on application and King confirms the price during review/follow-up.`,
    source_quality_review: sourceQualityReviewForItem(item, agent),
    source_positive_listing_gate: positiveListingGate,
    source_positive_listing_gate_passed: positiveListingGate.ok === true,
    source_positive_listing_gate_reason: positiveListingGate.reason || '',
    source_positive_listing_gate_details: positiveListingGate.details || [],
    source_channel_url: agent.channelUrl || '',
    source: SOCIAL_SEARCH_SOURCE,
    agent_permission_reported: preApproval.preapproved,
    permission_status: preApproval.permission_status,
    preapproved_source_post: preApproval.preapproved,
    consent_required: true,
    consent_confirmed: preApproval.consent_confirmed,
    image_rights_confirmed: preApproval.image_rights_confirmed,
    image_rights_status: preApproval.image_rights_confirmed
      ? 'preapproved_social_source_media_or_evidence'
      : 'source_review_pending_location_required',
    image_evidence_policy: FOUND_ONLINE_LAUNCH_INTAKE_POLICY.image_rule,
    facebook_image_policy: FOUND_ONLINE_LAUNCH_INTAKE_POLICY.facebook_image_rule,
    launch_intake_policy: FOUND_ONLINE_LAUNCH_INTAKE_POLICY,
    land_visual_strategy: landVisualStrategy(item),
    generated_land_size_diagram: item.listingType === 'land',
    generated_source_evidence_card: imageRows.some((image) => image.slot_key === 'source_evidence_card'),
    generated_support_image_urls: generatedSupportImageRows.map((image) => image.url),
    minimum_reliable_image_count: 1,
    owner_or_agent_name: agent.name,
    public_display_name: agent.name,
    lister_registration_status: 'registered',
    broker_agent_id: agentId,
    broker_submission: true,
    contact_source_status: 'public_source_contact_route_available',
    contact_phone_alt: agent.phoneAlt || '',
    website: agent.website || '',
    youtube_channel_url: agent.channelUrl || '',
    video_url: item.videoUrl || item.youtubeId || item.tiktokUrl || item.instagramReelUrl ? sourceUrl : '',
    youtube_url: item.youtubeId ? sourceUrl : '',
    youtube_video_id: item.youtubeId,
    youtube_source_title: item.sourceTitle,
    youtube_source_published_label: sourcePublishedLabel,
    resolved_location_label: item.address,
    map_pin_label: item.address,
    map_pin_accuracy_note: 'Closest responsible area-level pin from public source title/screenshot context; confirm exact gate or plot pin with the agent before public approval.',
    map_pin_confidence: ['Greater Kampala', 'Kampala'].includes(item.area) ? 'city_level_needs_agent_confirmation' : 'area_level_close',
    map_pin_status: 'close_area_pin_from_public_social_source_needs_exact_agent_confirmation',
    map_pin_confirmed: false,
    latitude_source: 'manual_public_source_area_pin',
    longitude_source: 'manual_public_source_area_pin',
    area_highlights: `${item.area} is a ${TARGET_COUNTRY_NAME} property search area. Confirm the exact property pin and local amenities with the listing agent before approval.`,
    nearby_facilities: nearby.map(([name, type, distanceKm]) => ({ name, type, distanceKm })),
    source_labels: [
      'found online',
      sourcePlatformFeedLabel(sourcePlatform),
      olderExactSourceRequiresAvailabilityReview ? 'older exact source - availability review required' : '2026+ social-only intake',
      sourceContactLabel,
    ],
    source_urls: uniqueUrls([agent.channelUrl, sourceUrl, sourceContactUrl, item.sourceUrls]),
    photo_source_urls: sourceImageRows.map((image) => image.url),
    authorised_photo_urls: imageRows.map((image) => image.url),
    property_url_status: 'public_after_approval',
    property_url: propertyUrl || '',
    owner_preview_url: ownerPreviewUrl || '',
    whatsapp_share_card: propertyUrl ? whatsappShareMessage(item, propertyUrl, ownerPreviewUrl) : '',
    review_required_steps: reviewSteps(item),
  };
}

function whatsappShareMessage(item, propertyUrl, ownerPreviewUrl = '') {
  const agent = sourceAgentForItem(item);
  const sourceContactUrl = sourceContactUrlForAgent(agent, item);
  const sourceUrl = sourceUrlForItem(item);
  const priceLabel = sourcePriceLabelFor(item);
  return [
    `Hi, this is ${agent.name || 'the listing agent'}.`,
    `${item.title} is prepared on ${publicBaseUrl()} for King review as a found-online listing.`,
    `Location: ${item.address}`,
    `Price: ${priceLabel}.`,
    `${item.youtubeId ? 'Source video' : 'Source post'}: ${sourceUrl}`,
    sourcePublishedLabelFor(item),
    ownerPreviewUrl ? `Private preview: ${ownerPreviewUrl}` : '',
    `Public link after approval: ${propertyUrl}`,
    agent.phone ? `Call/WhatsApp: ${agent.phone}${agent.phoneAlt ? ` / ${agent.phoneAlt}` : ''}` : '',
    !agent.phone && sourceContactUrl ? `Contact via source: ${sourceContactUrl}` : '',
  ].filter(Boolean).join('\n');
}

function buildSocialSearchListing(item, agentId = null) {
  const agent = sourceAgentForItem(item);
  const autoLive = sourcePostAutoLiveStatusFor(item, agent);
  const originalListingType = item.listingType || 'sale';
  const explicitlyStudent = isStudentSourceListing({ ...item, listingType: originalListingType });
  const campusByCoords = explicitlyStudent ? nearestCampusByCoordinates(item) : null;
  const nearestUniversity = explicitlyStudent
    ? (campusByCoords?.name || nearestUniversityForSourceItem({ ...item, listingType: originalListingType }))
    : '';
  const studentListing = explicitlyStudent;
  const listingType = studentListing ? 'students' : originalListingType;
  const pricePeriod = normalizeListingPricePeriod(item.price_period || item.pricePeriod, {
    listingType,
    title: item.title,
    description: [
      item.description,
      item.sourceText,
      item.source_text,
      item.sourceTitle,
      item.source_title
    ].filter(Boolean).join(' ')
  });
  const transactionType = ['commercial', 'land'].includes(listingType)
    ? normalizeCommercialTransactionType(item.transactionType || item.transaction_type, {
      pricePeriod,
      title: item.title,
      description: [
        item.description,
        item.sourceText,
        item.source_text,
        item.sourceTitle,
        item.source_title
      ].filter(Boolean).join(' ')
    })
    : '';
  const propertyType = listingType === 'commercial'
    ? normalizeCommercialPropertyType(item.subtype || item.property_type, {
      title: item.title,
      description: item.description
    })
    : item.subtype;
  const classificationWarning = commercialMisclassificationWarning({
    ...item,
    listing_type: listingType
  });
  if (listingType === 'commercial' && (!transactionType || !propertyType)) {
    autoLive.approved = false;
    autoLive.status = 'pending';
    autoLive.moderation_stage = 'source_review';
    autoLive.reason = 'Commercial transaction and subtype need staff confirmation before publication.';
  }
  const priceQuality = listingPriceQuality({
    ...item,
    listing_type: listingType,
    transaction_type: transactionType || null,
    price: item.price,
    price_period: pricePeriod,
    title: item.title,
    description: [
      item.description,
      item.sourceText,
      item.source_text,
      item.sourceTitle,
      item.source_title
    ].filter(Boolean).join(' ')
  }, {
    requireSourcePriceEvidence: true
  });
  if (!priceQuality.ok) {
    autoLive.approved = false;
    autoLive.status = 'pending';
    autoLive.moderation_stage = 'source_review';
    autoLive.reason = `Price evidence needs staff review: ${priceQuality.reasons.join(', ')}.`;
  }
  const dataIntegrity = listingDataIntegrityReport({
    ...item,
    listing_type: listingType,
    transaction_type: transactionType || null,
    property_type: propertyType || null,
    price_currency: item.priceCurrency || item.price_currency || CANONICAL_PROPERTY_CURRENCY,
    price_original_currency: item.priceOriginalCurrency || item.price_original_currency || CANONICAL_PROPERTY_CURRENCY,
    price_original: item.priceOriginal ?? item.price_original ?? item.price ?? null,
    price_fx_rate_ugx: item.priceFxRateUgx ?? item.price_fx_rate_ugx ?? null,
    price_on_application: !hasPublishedPriceOrGuidePrice(item),
    lister_phone: agent.phone || agent.phoneAlt || '',
    source_contact_url: sourceContactUrlForAgent(agent, item),
    source_url: sourceUrlForItem(item),
    extra_fields: item.raw_source_post || item.rawSourcePost || {},
  }, { requireCompleteEvidence: true });
  if (!dataIntegrity.ok) {
    autoLive.approved = false;
    autoLive.status = 'pending';
    autoLive.moderation_stage = 'source_review';
    autoLive.reason = `Data integrity review required: ${dataIntegrity.issue_codes.join(', ')}.`;
  }
  const manualOlderExactSource = isManualExactSocialIntake(item)
    && sourceDateStatusFor(item) === 'before_2026_source_window';
  return {
    listing_type: listingType,
    transaction_type: transactionType || null,
    title: item.title,
    description: publicDescriptionFor(item),
    district: item.district,
    area: item.area,
    address: item.address,
    price: Number(item.price || 0) > 0 ? item.price : null,
    price_currency: item.priceCurrency || item.price_currency || CANONICAL_PROPERTY_CURRENCY,
    price_original_currency: item.priceOriginalCurrency || item.price_original_currency || CANONICAL_PROPERTY_CURRENCY,
    price_original: item.priceOriginal ?? item.price_original ?? item.price ?? null,
    price_fx_rate_ugx: item.priceFxRateUgx ?? item.price_fx_rate_ugx ?? null,
    price_fx_as_of: item.priceFxAsOf || item.price_fx_as_of || null,
    price_period: pricePeriod || (transactionType === 'rent' ? 'month' : 'once'),
    price_on_application: !hasPublishedPriceOrGuidePrice(item),
    bedrooms: item.beds,
    bathrooms: item.baths,
    property_type: propertyType || null,
    title_type: listingType === 'land' ? null : null,
    year_built: null,
    furnishing: null,
    contract_months: null,
    deposit_amount: null,
    land_size_value: item.landSizeValue || null,
    land_size_unit: item.landSizeUnit || null,
    floor_area_sqm: null,
    usable_size_sqm: null,
    parking_bays: null,
    nearest_university: nearestUniversity || null,
    distance_to_uni_km: campusByCoords ? Number(campusByCoords.distance_km.toFixed(1)) : null,
    room_type: null,
    room_arrangement: null,
    commercial_intent: listingType === 'commercial' ? (transactionType || null) : null,
    latitude: item.lat,
    longitude: item.lng,
    students_welcome: studentListing,
    verification_terms_accepted: false,
    inquiry_reference: buildListingReference(),
    id_number: null,
    id_document_name: null,
    id_document_url: null,
    new_until: new Date(Date.now() + (30 * 24 * 60 * 60 * 1000)),
    amenities: JSON.stringify(item.listingType === 'land'
      ? ['Found online', 'Road access to verify', 'Title to verify', 'Agent follow-up required']
      : ['Found online', `${sourcePlatformFor(agent, item)} source evidence`, 'Agent follow-up required', 'HD photos to verify']),
    extra_fields: JSON.stringify({
      ...extraFieldsFor(item, agentId),
      price_quality: priceQuality,
      data_integrity_review: dataIntegrity
    }),
    lister_name: agent.name || 'Found-online Source Desk',
    lister_phone: agent.phone || null,
    lister_email: agent.email || null,
    lister_type: 'agent',
    agent_id: agentId,
    source: SOCIAL_SEARCH_SOURCE,
    listed_via: 'found_online',
    status: 'pending',
    moderation_stage: 'submitted',
    reviewed_at: null,
    moderation_notes: `${item.importedFromSourcePost ? 'FOUND-ONLINE SOURCE POST IMPORT' : 'SOCIAL SEARCH LISTING'}. Public source inventory from ${agent.name || 'source'}. Source post: ${sourceUrlForItem(item)}. ${manualOlderExactSource ? 'This manually supplied exact source post predates 2026; confirm current availability, location, and price or Price upon application before approval.' : 'Confirm source date, location, availability, category, contact route, and price or Price upon application before approval.'} Harvesting is review-only and cannot publish this listing. Original-poster comments are optional supporting evidence.${classificationWarning ? ` ${classificationWarning}` : ''} Batch: ${itemBatchId(item)}.`,
    moderation_reason: `Pending King review of public found-online source, exact pin, latest availability, price, and image/source evidence. ${autoLive.reason}`,
    images: listingImageRowsFor(item),
    source_item: item,
  };
}

function plannedSocialSearchListings(agentIdsByKey = {}) {
  return SOCIAL_SEARCH_LISTINGS.map((item) => buildSocialSearchListing(item, agentIdsByKey[item.agentKey] || null));
}

async function upsertSocialAgent(client, agent) {
  const existing = await client.query(
    `SELECT id
     FROM agents
     WHERE licence_number = $1
        OR ($2::text IS NOT NULL AND (phone = $2 OR whatsapp = $2))
        OR ($3::text IS NOT NULL AND LOWER(COALESCE(email, '')) = LOWER($3))
     ORDER BY updated_at DESC
     LIMIT 1`,
    [agent.licence, agent.phone || null, agent.email || null]
  );
  const values = [
    agent.name,
    agent.company,
    agent.licence,
    agent.phone || null,
    agent.phone || null,
    agent.email || null,
    agent.districts,
    agent.specializations,
    agent.profilePhotoUrl || null,
    agent.bio,
    `Founder-reported permission and public social source onboarding for ${agent.name}. Channel: ${agent.channelUrl}`,
  ];

  if (existing.rows[0]?.id) {
    const updated = await client.query(
      `UPDATE agents
       SET full_name = $1,
           company_name = $2,
           licence_number = $3,
           registration_status = 'registered',
           listing_limit = 2147483647,
           phone = COALESCE($4, phone),
           whatsapp = COALESCE($5, whatsapp),
           email = COALESCE($6, email),
           districts_covered = $7::text[],
           specializations = $8::text[],
           profile_photo_url = COALESCE($9, profile_photo_url),
           bio = $10,
           verification_reason = $11,
           privacy_consent_accepted = TRUE,
           privacy_consent_at = COALESCE(privacy_consent_at, NOW()),
           data_retention_notice_accepted = TRUE,
           data_retention_notice_at = COALESCE(data_retention_notice_at, NOW()),
           status = 'approved',
           approved_at = COALESCE(approved_at, NOW()),
           updated_at = NOW()
       WHERE id = $12
       RETURNING id::text AS id`,
      [...values, existing.rows[0].id]
    );
    return updated.rows[0].id;
  }

  const inserted = await client.query(
    `INSERT INTO agents (
      full_name, company_name, licence_number, registration_status, listing_limit,
      phone, whatsapp, email, districts_covered, specializations, profile_photo_url,
      bio, verification_reason, privacy_consent_accepted, privacy_consent_at,
      data_retention_notice_accepted, data_retention_notice_at, status, approved_at
    ) VALUES (
      $1,$2,$3,'registered',2147483647,$4,$5,$6,$7::text[],$8::text[],$9,
      $10,$11,TRUE,NOW(),TRUE,NOW(),'approved',NOW()
    )
    RETURNING id::text AS id`,
    values
  );
  return inserted.rows[0].id;
}

async function cleanupSocialSearchBatch(client) {
  const deleted = await client.query(
    `DELETE FROM properties
     WHERE source IN ($1, $3)
       AND extra_fields->>'source_batch' = $2
       AND COALESCE(status, 'pending') NOT IN ('approved', 'live', 'published', 'sold')
     RETURNING id`,
    [SOCIAL_SEARCH_SOURCE, SOCIAL_SEARCH_BATCH_ID, LEGACY_SOURCED_INVENTORY_CANDIDATE_SOURCE]
  );
  return { properties: deleted.rowCount };
}

async function existingSocialSearchListingKeys(client) {
  const result = await client.query(
    `SELECT
       id::text AS id,
       title,
       status,
       moderation_stage,
       inquiry_reference,
       lister_name,
       extra_fields->>'source_listing_key' AS source_listing_key
     FROM properties
     WHERE source IN ($1, $3)
       AND extra_fields->>'source_batch' = $2
       AND COALESCE(extra_fields->>'source_listing_key', '') <> ''
       AND COALESCE(status, '') <> 'deleted'`,
    [SOCIAL_SEARCH_SOURCE, SOCIAL_SEARCH_BATCH_ID, LEGACY_SOURCED_INVENTORY_CANDIDATE_SOURCE]
  );
  return new Map(result.rows
    .filter((row) => row.source_listing_key)
    .map((row) => [row.source_listing_key, {
      ...row,
      property_url: `${publicBaseUrl()}/property/${row.id}`,
    }]));
}

async function insertListing(client, listing, agentId) {
  const ownerPreviewToken = createOwnerEditToken();
  const ownerPreviewTokenHash = hashOwnerEditToken(ownerPreviewToken);
  const ownerPreviewExpiresAt = ownerEditTokenExpiry();
  const autoLive = sourcePostAutoLiveStatusFor(listing.source_item, sourceAgentForItem(listing.source_item));
  const inserted = await client.query(
    `INSERT INTO properties (
      listing_type, transaction_type, title, description, district, area, address, price,
      price_currency, price_original_currency, price_original, price_fx_rate_ugx, price_fx_as_of, price_period,
      price_on_application,
      bedrooms, bathrooms, property_type, title_type, year_built, furnishing,
      contract_months, deposit_amount, land_size_value, land_size_unit,
      floor_area_sqm, usable_size_sqm, parking_bays, nearest_university,
      distance_to_uni_km, room_type, room_arrangement, commercial_intent,
      latitude, longitude, students_welcome, verification_terms_accepted,
      inquiry_reference, id_number, id_document_name, id_document_url, new_until,
      amenities, extra_fields, lister_name, lister_phone, lister_email,
      lister_type, agent_id, source, listed_via, status, moderation_stage,
      reviewed_at, moderation_notes, moderation_reason,
      owner_edit_token_hash, owner_edit_token_expires_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
      $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
      $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,
      $31,$32,$33,$34,$35,$36,$37,$38,$39,$40,
      $41,$42,$43::jsonb,$44::jsonb,$45,$46,$47,$48,$49,$50,
      $51,$52,$53,$54,$55,$56,$57,$58
    ) RETURNING id::text AS id`,
    [
      listing.listing_type, listing.transaction_type, listing.title, listing.description, listing.district,
      listing.area, listing.address, listing.price, listing.price_currency, listing.price_original_currency,
      listing.price_original, listing.price_fx_rate_ugx, listing.price_fx_as_of, listing.price_period,
      listing.price_on_application === true,
      listing.bedrooms, listing.bathrooms, listing.property_type, listing.title_type,
      listing.year_built, listing.furnishing, listing.contract_months,
      listing.deposit_amount, listing.land_size_value, listing.land_size_unit,
      listing.floor_area_sqm, listing.usable_size_sqm, listing.parking_bays,
      listing.nearest_university, listing.distance_to_uni_km, listing.room_type,
      listing.room_arrangement, listing.commercial_intent, listing.latitude,
      listing.longitude, listing.students_welcome, listing.verification_terms_accepted,
      listing.inquiry_reference, listing.id_number, listing.id_document_name,
      listing.id_document_url, listing.new_until, listing.amenities,
      listing.extra_fields, listing.lister_name, listing.lister_phone,
      listing.lister_email, listing.lister_type, agentId, listing.source,
      listing.listed_via, listing.status, listing.moderation_stage, listing.reviewed_at,
      listing.moderation_notes, listing.moderation_reason,
      ownerPreviewTokenHash, ownerPreviewExpiresAt,
    ]
  );
  const propertyId = inserted.rows[0].id;
  const propertyUrl = `${publicBaseUrl()}/property/${propertyId}`;
  const ownerPreviewUrl = getOwnerPreviewUrl({ id: propertyId }, ownerPreviewToken);

  for (const image of listing.images) {
    await client.query(
      `INSERT INTO property_images (property_id, url, is_primary, sort_order, slot_key, room_label)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [propertyId, image.url, image.is_primary, image.sort_order, image.slot_key, image.room_label]
    );
  }

  await client.query(
    `UPDATE properties
     SET extra_fields = COALESCE(extra_fields, '{}'::jsonb)
       || $2::jsonb
     WHERE id = $1`,
    [propertyId, JSON.stringify(extraFieldsFor(listing.source_item, agentId, propertyUrl, ownerPreviewUrl))]
  );

  await client.query(
    `INSERT INTO property_moderation_events (
      property_id, actor_id, action, status_from, status_to, checklist, reason, notes, delivery
    ) VALUES ($1, $2, $3, NULL, $4, $5::jsonb, $6, $7, $8::jsonb)`,
    [
      propertyId,
      'always_on_harvest_engine',
      'harvested_listing_created_for_review',
      listing.status || 'pending',
      JSON.stringify({
        found_online_candidate: true,
        social_search_candidate: true,
        found_online: true,
        auto_live_source_import: false,
        auto_live_policy: autoLive.policy,
        auto_live_review_status: autoLive.review_status,
        preapproved_source_post: sourcePreApprovalStatusFor(listing.source_item).preapproved,
        consent_confirmed: sourcePreApprovalStatusFor(listing.source_item).consent_confirmed,
        image_rights_confirmed: sourcePreApprovalStatusFor(listing.source_item).image_rights_confirmed,
        source_batch: itemBatchId(listing.source_item),
        source_url: sourceUrlForItem(listing.source_item),
        youtube_url: listing.source_item.youtubeId ? youtubeUrl(listing.source_item.youtubeId) : '',
      }),
      listing.moderation_reason,
      listing.moderation_notes,
      JSON.stringify({
        batch_id: itemBatchId(listing.source_item),
        property_url: propertyUrl,
        owner_preview_url: ownerPreviewUrl,
        owner_preview_expires_at: ownerPreviewExpiresAt,
        agent_id: agentId,
        whatsapp_share_card: whatsappShareMessage(listing.source_item, propertyUrl, ownerPreviewUrl),
      }),
    ]
  );

  return {
    id: propertyId,
    title: listing.title,
    inquiry_reference: listing.inquiry_reference,
    property_url: propertyUrl,
    owner_preview_url: ownerPreviewUrl,
    owner_preview_expires_at: ownerPreviewExpiresAt,
    status: listing.status,
    moderation_stage: listing.moderation_stage,
    source_url: sourceUrlForItem(listing.source_item),
    youtube_url: listing.source_item.youtubeId ? youtubeUrl(listing.source_item.youtubeId) : '',
    agent_name: listing.lister_name,
    whatsapp_share_card: whatsappShareMessage(listing.source_item, propertyUrl, ownerPreviewUrl),
  };
}

async function verifyCreatedListingRows(client, created = []) {
  const ids = created.map((item) => String(item?.id || '').trim()).filter(Boolean);
  if (!ids.length) return { verified: true, count: 0, ids: [] };
  const result = await client.query(
    `SELECT id::text AS id
     FROM properties
     WHERE id = ANY($1::uuid[])
       AND source = $2
       AND COALESCE(status, '') <> 'deleted'`,
    [ids, SOCIAL_SEARCH_SOURCE]
  );
  const persistedIds = (result.rows || []).map((row) => String(row.id || '')).filter(Boolean);
  if (persistedIds.length !== ids.length) {
    const error = new Error(`Found Online queue persistence check failed: expected ${ids.length} rows, found ${persistedIds.length}.`);
    error.code = 'FOUND_ONLINE_PERSISTENCE_CHECK_FAILED';
    throw error;
  }
  return { verified: true, count: persistedIds.length, ids: persistedIds };
}

function parseMoneyValue(value) {
  return propertyPriceMetadata(value, {
    ...(IS_SOUTH_AFRICA
      ? { usdToZarRate: USD_TO_CANONICAL_GUIDE_RATE }
      : { usdToUgxRate: USD_TO_CANONICAL_GUIDE_RATE })
  }).price;
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeUgandanPublicPhone(value = '') {
  return normalizeUgandanSourcePhone(value);
}

function publicPhoneFromText(text = '') {
  return ugandanPhoneFromSourceText(text);
}

function publicEmailFromText(text = '') {
  const match = String(text || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0] : '';
}

function normalizeFoundOnlineListingType(value = '', options = {}) {
  const raw = String(value || '').toLowerCase();
  const hasDwelling = /\b(apartment|flat|house|home|villa|mansion|duplex|bungalow|bedroom|bedrooms|beds?|living room|sitting room)\b/.test(raw);
  if (/\b(rental|income|investment)\s+(property|building|block)\s+(?:available\s+)?for sale\b/.test(raw)) return 'sale';
  if (raw.includes('commercial') || raw.includes('shop') || raw.includes('office') || raw.includes('warehouse')) return 'commercial';
  if (STUDENT_SOURCE_LISTING_PATTERN.test(raw)) return 'students';
  const saleAsset = /\b(for sale|on sale|available for sale|selling)\b/.test(raw)
    && /\b(property|building|block|apartment|flat|house|home|villa|mansion|duplex|bungalow|bedroom|bedrooms|rental income)\b/.test(raw)
    && !/\b(student|hostel|campus|university|college|student accommodation)\b/.test(raw);
  if (saleAsset) return 'sale';
  if (raw.includes('rent') || raw.includes('rental') || raw.includes('let')) return 'rent';
  if (hasDwelling && (raw.includes('sale') || raw.includes('selling') || raw.includes('buy'))) return 'sale';
  if ((raw.includes('land') || raw.includes('plot') || raw.includes('acre') || raw.includes('decimal') || raw.includes('mailo')) && !hasDwelling) return 'land';
  const sourceAmount = sourcePriceAmount(options.price);
  if (hasDwelling && Number.isFinite(sourceAmount) && sourceAmount >= 10000 && sourceAmount <= 15000000) return 'rent';
  return 'sale';
}

function normalizeFoundOnlineSourcePost(raw = {}, index = 0) {
  const sourceUrl = sourceUrlForItem(raw)
    || safeUrl(raw.source_url)
    || safeUrl(raw.post_url)
    || safeUrl(raw.source_post_url)
    || safeUrl(raw.permalink)
    || safeUrl(raw.url);
  const sourceVisualText = sourceVisualTextForRawPost(raw);
  const sourceText = sourceTextForRawPost(raw);
  const extractedPhone = publicPhoneFromText(sourceText);
  const extractedEmail = publicEmailFromText(sourceText);
  const sourceName = String(raw.source_name || raw.agent_name || raw.lister_name || raw.page_name || raw.account_name || raw.sourceKey || raw.source_key || 'Found-online source').trim();
  const sourceKey = slugKey(raw.source_key || raw.sourceRegistryKey || raw.source_registry_key || sourceName || sourceUrl, `source-${index + 1}`);
  const postKey = slugKey(raw.source_listing_key || raw.key || raw.post_id || raw.id || sourceUrl || `${sourceKey}-${raw.title || index + 1}`, `source-post-${index + 1}`);
  const platform = sourcePlatformFor({
    platform: raw.platform,
    sourcePlatform: raw.source_platform,
    channelUrl: raw.source_page_url || raw.source_contact_url || raw.source_url,
    website: raw.website_url || raw.website,
    facebookUrl: raw.facebook_url,
    instagramUrl: raw.instagram_url,
    tiktokUrl: raw.tiktok_url,
    xUrl: raw.x_url || raw.twitter_url,
  }, {
    ...raw,
    sourceUrl,
    sourcePlatform: raw.source_platform || raw.platform,
  });
  const sourceDistricts = asTextArray(raw.districts);
  const rawArea = compactText(raw.area || raw.location || raw.neighbourhood || raw.neighborhood || '');
  const fallbackDistrict = compactText(raw.district || sourceDistricts[0] || raw.city || raw.region || '');
  const explicitLocation = resolveCanonicalUgandaLocation(rawArea, fallbackDistrict);
  const textLocation = resolveCanonicalUgandaLocationFromText(`${rawArea} ${sourceText}`, fallbackDistrict);
  const locationResolution = explicitLocation.status === 'matched'
    && !['district', 'region', 'province'].includes(explicitLocation.match.level)
    ? explicitLocation
    : textLocation.status === 'matched'
      ? textLocation
      : explicitLocation.status === 'matched'
        ? explicitLocation
        : textLocation;
  const canonicalLocation = locationResolution.status === 'matched' ? locationResolution.match : null;
  const district = canonicalLocation?.province || canonicalLocation?.district || '';
  const city = canonicalLocation?.city || canonicalLocation?.town || '';
  const suburb = canonicalLocation?.suburb || (canonicalLocation?.level === 'suburb' ? canonicalLocation?.name : '');
  const locationEvidenceConfirmed = Object.prototype.hasOwnProperty.call(raw, 'location_evidence_confirmed')
    ? parseBooleanFlag(raw.location_evidence_confirmed)
    : Boolean(canonicalLocation);
  const area = canonicalLocation?.name || '';
  const address = String(raw.address || raw.location_label || raw.location || (area && district ? `${area}, ${district}` : area || district)).trim();
  const priceCandidate = strongestSourcePriceCandidate(raw, sourceText);
  const unsafeSourcePrice = priceCandidate.value;
  const rawListingType = normalizeFoundOnlineListingType(
    raw.listing_type || raw.listingType || raw.property_type || raw.category || raw.title || raw.description,
    { price: unsafeSourcePrice }
  );
  const sourceHasExplicitTransaction = /\b(for sale|on sale|available for sale|for rent|to rent|to let|for lease)\b/i.test(sourceText);
  const sourceHasPropertyCategorySignal = /\b(?:apartment|flat|house|home|villa|mansion|duplex|bungalow|bedroom|beds?|land|plot|acre|decimal|hostel|student|campus|commercial|office|shop|retail|warehouse|factory|showroom)\b/i.test(sourceText);
  const sourceTextListingType = sourceHasPropertyCategorySignal
    ? normalizeFoundOnlineListingType(sourceText, { price: unsafeSourcePrice })
    : rawListingType;
  const evidenceClassification = deriveListingClassification({
    ...raw,
    title: raw.title || raw.source_title,
    description: raw.description || raw.caption,
    source_text: sourceText,
    source_visual_text: sourceVisualText,
    listing_type: sourceTextListingType,
  });
  let listingType = (sourceHasExplicitTransaction || sourceHasPropertyCategorySignal)
    ? (evidenceClassification.listing_type || normalizeFoundOnlineListingType(sourceText, { price: unsafeSourcePrice }))
    : rawListingType;
  if (listingType === 'student' && rawListingType === 'students') listingType = 'students';
  const title = cleanSourceListingTitle(
    raw.title || raw.source_title || raw.caption,
    `${listingType === 'land' ? 'Land' : 'Property'}${area ? ` in ${area}` : ''}`
  );
  const baseDescription = compactText(raw.description || raw.caption || raw.summary || title);
  const description = compactText([
    baseDescription,
    sourceVisualText ? `Visible video/still text adds: ${sourceVisualText}` : '',
  ].filter(Boolean).join(' '));
  const pricePeriod = evidenceClassification.price_period || normalizeListingPricePeriod(raw.price_period || raw.pricePeriod || raw.period, {
    listingType,
    title,
    description: `${description} ${sourceText}`
  });
  const transactionType = ['commercial', 'land'].includes(listingType)
    ? normalizeCommercialTransactionType(
      raw.transaction_type || raw.transactionType || raw.commercial_mode || raw.commercial_intent,
      { pricePeriod, title, description: `${description} ${sourceText}` }
    ) || evidenceClassification.transaction_type
    : '';
  const commercialSubtype = listingType === 'commercial'
    ? normalizeCommercialPropertyType(raw.subtype || raw.property_type || raw.commercial_type, {
      title,
      description: `${description} ${sourceText}`
    }) || evidenceClassification.commercial_type
    : (raw.subtype || raw.property_type || null);
  const normalizedStudentSource = isStudentSourceListing({
    ...raw,
    listingType,
    title,
    sourceTitle: raw.source_title || raw.caption || title,
    description,
    sourceText,
    sourceVisualText,
    area,
    district,
    province: district,
    city,
    suburb,
    address
  });
  const nearestUniversity = normalizedStudentSource
    ? nearestUniversityForSourceItem({
      ...raw,
      listingType,
      title,
      sourceTitle: raw.source_title || raw.caption || title,
      description,
      sourceText,
      sourceVisualText,
      area,
      district,
      address
    })
    : '';
  const youtubeId = raw.youtube_id || raw.youtubeId || raw.youtube_video_id || raw.youtubeVideoId || youtubeIdFromUrl(sourceUrl);
  const countryGate = foreignSourceMarketStatus([
    sourceText,
    raw.price_currency,
    raw.currency,
    raw.source_currency,
    raw.country,
    raw.market,
  ].filter(Boolean).join(' '));
  const safePrice = countryGate.allowed
    ? priceCandidate
    : { value: null, reason: countryGate.reason };
  const ingestedAt = raw.ingested_at || raw.imported_at || raw.first_seen_at || new Date().toISOString();
  const sourcePriceMetadata = propertyPriceMetadata(safePrice.value, {
    currency: raw.price_currency || raw.currency || raw.source_currency,
    ...(IS_SOUTH_AFRICA
      ? { usdToZarRate: USD_TO_CANONICAL_GUIDE_RATE }
      : { usdToUgxRate: USD_TO_CANONICAL_GUIDE_RATE }),
    fxAsOf: raw.price_fx_as_of || ingestedAt
  });
  const sourceAgent = {
    key: sourceKey,
    name: sourceName,
    company: raw.company_name || raw.company || sourceName,
    licence: String(raw.licence || raw.license || `FOUND-ONLINE-${sourceKey.toUpperCase()}`).slice(0, 120),
    phone: normalizeUgandanPublicPhone(raw.phone || raw.contact_phone || raw.lister_phone || raw.whatsapp || '') || extractedPhone || null,
    phoneAlt: raw.phone_alt || raw.contact_phone_alt || raw.lister_phone_alt || '',
    email: raw.email || raw.contact_email || raw.lister_email || extractedEmail || null,
    channelUrl: raw.source_page_url || raw.source_contact_url || raw.channel_url || raw.profile_url || raw.account_url || raw.source_url || sourceUrl,
    website: raw.website_url || raw.website || '',
    facebookUrl: raw.facebook_url || (/facebook\.com/i.test(sourceUrl) ? sourceUrl : ''),
    instagramUrl: raw.instagram_url || (/instagram\.com/i.test(sourceUrl) ? sourceUrl : ''),
    tiktokUrl: raw.tiktok_url || (/tiktok\.com/i.test(sourceUrl) ? sourceUrl : ''),
    xUrl: raw.x_url || raw.twitter_url || (/(^|\/\/)(x|twitter)\.com/i.test(sourceUrl) ? sourceUrl : ''),
    platform,
    sourcePlatform: platform,
    districts: asTextArray(raw.districts || district || TARGET_COUNTRY_NAME),
    specializations: asTextArray(raw.specializations || [listingType]),
    profilePhotoUrl: raw.profile_photo_url || raw.avatar_url || null,
    bio: raw.source_bio || `Public ${platform} source imported for ${TARGET_BRAND_NAME} found-online launch intake.`,
    audienceLabel: raw.audience_label || raw.followers_label || raw.source_followers_label || '',
  };
  const dataIntegrity = listingDataIntegrityReport({
    ...raw,
    title,
    description,
    source_text: sourceText,
    source_visual_text: sourceVisualText,
    listing_type: listingType,
    transaction_type: transactionType,
    property_type: commercialSubtype,
    area,
    district,
    province: district,
    city,
    suburb,
    canonical_location_id: canonicalLocation?.key,
    canonical_location_level: canonicalLocation?.level,
    price: sourcePriceMetadata.price,
    price_currency: sourcePriceMetadata.price_currency,
    price_original_currency: sourcePriceMetadata.price_original_currency,
    price_original: sourcePriceMetadata.price_original,
    price_fx_rate_ugx: sourcePriceMetadata.price_fx_rate_ugx,
    price_period: pricePeriod,
    price_on_application: !Number(sourcePriceMetadata.price || 0),
    lister_phone: sourceAgent.phone,
    source_contact_url: sourceAgent.channelUrl,
    source_url: sourceUrl,
    bedrooms: raw.bedrooms ?? raw.beds,
  });
  return {
    key: postKey,
    agentKey: sourceKey,
    sourceAgent,
    sourceBatch: raw.source_batch || FOUND_ONLINE_SOURCE_POST_IMPORT_BATCH_ID,
    sourceType: raw.source_type || raw.sourceType || raw.raw_source_post?.source_job?.source_type || 'found_online_source_post',
    importedFromSourcePost: true,
    title,
    sourceTitle: raw.source_title || raw.caption || title,
    description,
    sourceText,
    sourceVisualText,
    source_visual_text: sourceVisualText,
    sourceUrl,
    postUrl: sourceUrl,
    videoUrl: raw.video_url || raw.youtube_url || raw.tiktok_url || sourceUrl,
    youtubeId: youtubeId || null,
    tiktokUrl: raw.tiktok_url || (/tiktok\.com/i.test(sourceUrl) ? sourceUrl : ''),
    thumbnailUrl: raw.thumbnail_url || raw.source_thumbnail_url || raw.video_thumbnail_url || raw.cover_image_url || '',
    sourceThumbnailUrl: raw.source_thumbnail_url || raw.thumbnail_url || raw.video_thumbnail_url || raw.cover_image_url || '',
    sourceContactUrl: raw.source_contact_url || raw.contact_url || sourceAgent.channelUrl || sourceUrl,
    sourcePlatform: platform,
    sourceUnavailable: raw.source_unavailable === true || raw.sourceUnavailable === true,
    sourceUrlStatus: raw.source_url_status || raw.sourceUrlStatus || '',
    sourceUnavailableReason: raw.source_unavailable_reason || raw.sourceUnavailableReason || '',
    sourcePublishedAt:
      raw.first_posted_online_at
      || raw.first_posted_at
      || raw.platform_posted_at
      || raw.video_posted_at
      || raw.video_published_at
      || raw.youtube_published_at
      || raw.youtube_source_published_at
      || raw.post_published_at
      || raw.published_at
      || raw.posted_at
      || raw.source_published_at
      || raw.source_posted_at
      || raw.original_posted_at
      || raw.created_at
      || null,
    locationEvidenceConfirmed,
    locationResolutionStatus: canonicalLocation ? 'canonical_match' : 'unresolved',
    locationResolutionConfidence: canonicalLocation ? 1 : 0,
    canonicalLocationId: canonicalLocation?.key || null,
    canonicalLocationLevel: canonicalLocation?.level || null,
    rawLocation: rawArea || fallbackDistrict || null,
    area,
    district,
    province: district,
    city,
    suburb,
    address,
    countryGate,
    sourcePriceRejectionReason: safePrice.reason || sourcePriceMetadata.rejection_reason || '',
    price: sourcePriceMetadata.price,
    priceCurrency: sourcePriceMetadata.price_currency,
    priceOriginalCurrency: sourcePriceMetadata.price_original_currency,
    priceOriginal: sourcePriceMetadata.price_original,
    priceFxRateUgx: sourcePriceMetadata.price_fx_rate_ugx,
    priceFxAsOf: sourcePriceMetadata.price_fx_as_of,
    priceText: safePrice.value == null ? '' : (raw.price_text || raw.price_label || ''),
    price_period: pricePeriod,
    transactionType: transactionType || null,
    transaction_type: transactionType || null,
    listingType,
    nearest_university: nearestUniversity || null,
    student_universities: nearestUniversity ? normalizeUniversityList([nearestUniversity]) : [],
    subtype: commercialSubtype || null,
    beds: numberOrNull(raw.bedrooms ?? raw.beds),
    baths: numberOrNull(raw.bathrooms ?? raw.baths),
    landSizeValue: numberOrNull(raw.land_size_value ?? raw.landSizeValue),
    landSizeUnit: raw.land_size_unit || raw.landSizeUnit || null,
    lat: numberOrNull(raw.latitude ?? raw.lat) ?? canonicalLocation?.lat ?? null,
    lng: numberOrNull(raw.longitude ?? raw.lng) ?? canonicalLocation?.lng ?? null,
    imageUrls: asTextArray(raw.image_urls || raw.images || raw.photo_urls || raw.media_urls),
    photoUrls: asTextArray(raw.photo_urls),
    mediaUrls: asTextArray(raw.media_urls),
    sourceUrls: asTextArray(raw.source_urls),
    permission_status: raw.permission_status || raw.permissionStatus || '',
    consent_confirmed: raw.consent_confirmed ?? raw.consentConfirmed ?? raw.agent_authorised ?? raw.agentAuthorised ?? raw.pre_approved ?? raw.preApproved ?? false,
    image_rights_confirmed: raw.image_rights_confirmed ?? raw.imageRightsConfirmed ?? raw.authorised_images ?? raw.authorisedImages ?? raw.pre_approved ?? raw.preApproved ?? false,
    pre_approved: raw.pre_approved ?? raw.preApproved ?? raw.agent_preapproved ?? raw.agentPreapproved ?? false,
    raw_source_post: {
      ...raw,
      source_text: raw.source_text || sourceText,
      source_visual_text: raw.source_visual_text || sourceVisualText,
    },
    harvestDedup: raw.harvest_dedup || {
      canonical_source_url: raw.canonical_source_url || '',
      source_platform_id: raw.source_platform_id || '',
      caption_simhash: raw.caption_simhash || '',
      primary_image_dhash: raw.primary_image_dhash || '',
      primary_image_phash: raw.primary_image_phash || '',
      contact_cluster_key: raw.contact_cluster_key || '',
      composite_listing_key: raw.composite_listing_key || '',
    },
    dataIntegrity,
  };
}

async function existingFoundOnlineSourcePostListings(client, items = []) {
  // king-harvester-duplicate-lookup-20260809: keep each fingerprint lookup in
  // its own indexable branch instead of forcing one broad JSON expression scan.
  const keys = items.map((item) => item.key).filter(Boolean);
  const urls = uniqueUrls(items.map((item) => sourceUrlForItem(item)));
  const normalizedUrls = [...new Set(items.map(normalizedSourceUrlForItem).filter(Boolean))];
  const fingerprints = [...new Set(items.map((item) => contentFingerprintForSourceItem(item)).filter(Boolean))];
  const harvestFingerprints = items.map(harvestFingerprintsForItem);
  const platformIds = [...new Set(harvestFingerprints.map((item) => item.source_platform_id).filter(Boolean))];
  const captionHashes = [...new Set(harvestFingerprints.map((item) => item.caption_simhash).filter(Boolean))];
  const imageHashes = [...new Set(harvestFingerprints.map((item) => item.primary_image_dhash).filter(Boolean))];
  const imagePHashes = [...new Set(harvestFingerprints.map((item) => item.primary_image_phash).filter(Boolean))];
  const compositeKeys = [...new Set(harvestFingerprints.map((item) => item.composite_listing_key).filter(Boolean))];
  const contactKeys = [...new Set(harvestFingerprints.map((item) => item.contact_cluster_key).filter(Boolean))];
  if (!keys.length && !urls.length && !fingerprints.length && !platformIds.length && !captionHashes.length && !imageHashes.length && !imagePHashes.length && !compositeKeys.length && !contactKeys.length) return new Map();
  const lookupUrls = uniqueUrls([...urls, ...normalizedUrls]);
  const selectExisting = `SELECT
       properties.id::text AS id,
       title,
       area,
       district,
       price,
       status,
       moderation_stage,
       inquiry_reference,
       lister_name,
       extra_fields->>'source_listing_key' AS source_listing_key,
       extra_fields->>'content_fingerprint' AS content_fingerprint,
       extra_fields->>'source_platform_id' AS source_platform_id,
       extra_fields->>'caption_simhash' AS caption_simhash,
       extra_fields->>'primary_image_dhash' AS primary_image_dhash,
       extra_fields->>'primary_image_phash' AS primary_image_phash,
       extra_fields->>'contact_cluster_key' AS contact_cluster_key,
       extra_fields->>'composite_listing_key' AS composite_listing_key,
       extra_fields->>'source_post_url' AS source_post_url,
       COALESCE(
         extra_fields->>'source_url',
         extra_fields->>'source_post_url',
         extra_fields->>'youtube_url',
         extra_fields->>'video_url',
         extra_fields->>'original_url'
       ) AS source_url
     FROM properties`;
  const result = await client.query(
    `WITH matching_property_ids AS (
       SELECT id FROM properties
       WHERE COALESCE(status, '') <> 'deleted'
         AND COALESCE(extra_fields->>'source_url', extra_fields->>'source_post_url', '') <> ''
         AND COALESCE(extra_fields->>'source_url', extra_fields->>'source_post_url', '') = ANY($1::text[])
       UNION
       SELECT id FROM properties
       WHERE COALESCE(status, '') <> 'deleted'
         AND COALESCE(extra_fields->>'source_listing_key', '') <> ''
         AND extra_fields->>'source_listing_key' = ANY($2::text[])
       UNION
       SELECT id FROM properties
       WHERE COALESCE(status, '') <> 'deleted'
         AND COALESCE(extra_fields->>'content_fingerprint', '') <> ''
         AND extra_fields->>'content_fingerprint' = ANY($3::text[])
       UNION
       SELECT id FROM properties
       WHERE COALESCE(status, '') <> 'deleted'
         AND COALESCE(extra_fields->>'source_platform_id', '') <> ''
         AND extra_fields->>'source_platform_id' = ANY($4::text[])
       UNION
       SELECT id FROM properties
       WHERE COALESCE(status, '') <> 'deleted'
         AND COALESCE(extra_fields->>'caption_simhash', '') <> ''
         AND extra_fields->>'caption_simhash' = ANY($5::text[])
       UNION
       SELECT id FROM properties
       WHERE COALESCE(status, '') <> 'deleted'
         AND COALESCE(extra_fields->>'primary_image_dhash', '') <> ''
         AND extra_fields->>'primary_image_dhash' = ANY($6::text[])
       UNION
       SELECT id FROM properties
       WHERE COALESCE(status, '') <> 'deleted'
         AND COALESCE(extra_fields->>'primary_image_phash', '') <> ''
         AND extra_fields->>'primary_image_phash' = ANY($7::text[])
       UNION
       SELECT id FROM properties
       WHERE COALESCE(status, '') <> 'deleted'
         AND COALESCE(extra_fields->>'composite_listing_key', '') <> ''
         AND extra_fields->>'composite_listing_key' = ANY($8::text[])
       UNION
       SELECT id FROM properties
       WHERE COALESCE(status, '') <> 'deleted'
         AND COALESCE(extra_fields->>'contact_cluster_key', '') <> ''
         AND extra_fields->>'contact_cluster_key' = ANY($9::text[])
     )
     ${selectExisting}
     INNER JOIN matching_property_ids ON matching_property_ids.id = properties.id`,
    [lookupUrls, keys, fingerprints, platformIds, captionHashes, imageHashes, imagePHashes, compositeKeys, contactKeys]
  );
  const existing = new Map();
  for (const row of result.rows) {
    const payload = {
      ...row,
      property_url: `${publicBaseUrl()}/property/${row.id}`,
    };
    if (row.source_listing_key) existing.set(row.source_listing_key, payload);
    if (row.source_post_url) existing.set(row.source_post_url, payload);
    if (row.source_url) existing.set(row.source_url, payload);
    if (row.content_fingerprint) existing.set(`fingerprint:${row.content_fingerprint}`, payload);
    if (row.source_platform_id) existing.set(`platform:${row.source_platform_id}`, payload);
    if (row.caption_simhash) existing.set(`caption:${row.caption_simhash}`, payload);
    if (row.primary_image_dhash) existing.set(`image:${row.primary_image_dhash}`, payload);
    if (row.primary_image_phash) existing.set(`phash:${row.primary_image_phash}`, payload);
    if (row.composite_listing_key) existing.set(`composite:${row.composite_listing_key}`, payload);
    if (row.contact_cluster_key) {
      const candidateKey = `contact-candidates:${row.contact_cluster_key}`;
      existing.set(candidateKey, [...(existing.get(candidateKey) || []), payload]);
    }
    const normalized = normalizeSourceUrl(row.source_post_url) || normalizeSourceUrl(row.source_url);
    if (normalized) existing.set(normalized, payload);
  }
  return existing;
}

function existingFoundOnlineRowForItem(existing = new Map(), item = {}) {
  const sourceUrl = sourceUrlForItem(item);
  const exact = existing.get(item.key)
    || existing.get(sourceUrl)
    || existing.get(normalizedSourceUrlForItem(item))
    || null;
  if (exact) return { ...exact, duplicate_match_type: 'exact_source_url_duplicate' };
  const fingerprint = contentFingerprintForSourceItem(item);
  const contentMatch = fingerprint ? existing.get(`fingerprint:${fingerprint}`) : null;
  if (contentMatch) return { ...contentMatch, duplicate_match_type: 'content_fingerprint_duplicate' };
  const harvest = harvestFingerprintsForItem(item);
  const contactCandidates = harvest.contact_cluster_key
    ? existing.get(`contact-candidates:${harvest.contact_cluster_key}`) || []
    : [];
  const itemAreaToken = compactText(item.area || item.district || '').toLowerCase();
  const itemPrice = Number(item.price || 0) || 0;
  const contextualContactCandidates = contactCandidates.filter((row) => {
    const rowAreaToken = compactText(row.area || row.district || '').toLowerCase();
    const rowPrice = Number(row.price || 0) || 0;
    const sameArea = !itemAreaToken || !rowAreaToken || itemAreaToken === rowAreaToken;
    const similarPrice = !itemPrice || !rowPrice || Math.abs(itemPrice - rowPrice) / Math.max(itemPrice, rowPrice) <= 0.25;
    return sameArea && similarPrice;
  });
  const nearImageMatch = harvest.primary_image_dhash
    ? contextualContactCandidates.find((row) => {
      const distance = hammingDistanceHex(harvest.primary_image_dhash, row.primary_image_dhash || '');
      return distance != null && distance <= 8;
    })
    : null;
  const nearPHashMatch = harvest.primary_image_phash
    ? contextualContactCandidates.find((row) => {
      const distance = hammingDistanceHex(harvest.primary_image_phash, row.primary_image_phash || '');
      return distance != null && distance <= 10;
    })
    : null;
  const nearCaptionMatch = harvest.caption_simhash
    ? contextualContactCandidates.find((row) => {
      const distance = hammingDistanceHex(harvest.caption_simhash, row.caption_simhash || '');
      return distance != null && distance <= 16;
    })
    : null;
  const matches = [
    ['stable_platform_id_duplicate', harvest.source_platform_id && existing.get(`platform:${harvest.source_platform_id}`)],
    ['composite_listing_duplicate', harvest.composite_listing_key && existing.get(`composite:${harvest.composite_listing_key}`)],
    ['primary_image_dhash_duplicate', harvest.primary_image_dhash && existing.get(`image:${harvest.primary_image_dhash}`)],
    ['primary_image_dhash_near_duplicate', nearImageMatch],
    ['primary_image_phash_duplicate', harvest.primary_image_phash && existing.get(`phash:${harvest.primary_image_phash}`)],
    ['primary_image_phash_near_duplicate', nearPHashMatch],
    ['caption_simhash_duplicate', harvest.caption_simhash && existing.get(`caption:${harvest.caption_simhash}`)],
    ['caption_simhash_near_duplicate', nearCaptionMatch],
  ];
  const matched = matches.find(([, row]) => row);
  return matched ? { ...matched[1], duplicate_match_type: matched[0] } : null;
}

function registerExistingFoundOnlineItem(existing = new Map(), item = {}, row = {}) {
  const payload = {
    ...row,
    area: row.area || item.area || '',
    district: row.district || item.district || '',
    price: row.price || item.price || null,
    source_listing_key: item.key,
    source_url: sourceUrlForItem(item),
    source_post_url: sourceUrlForItem(item),
    content_fingerprint: contentFingerprintForSourceItem(item),
    ...harvestFingerprintsForItem(item),
  };
  if (item.key) existing.set(item.key, payload);
  const sourceUrl = sourceUrlForItem(item);
  if (sourceUrl) existing.set(sourceUrl, payload);
  const normalizedUrl = normalizedSourceUrlForItem(item);
  if (normalizedUrl) existing.set(normalizedUrl, payload);
  if (payload.content_fingerprint) existing.set(`fingerprint:${payload.content_fingerprint}`, payload);
  if (payload.source_platform_id) existing.set(`platform:${payload.source_platform_id}`, payload);
  if (payload.caption_simhash) existing.set(`caption:${payload.caption_simhash}`, payload);
  if (payload.primary_image_dhash) existing.set(`image:${payload.primary_image_dhash}`, payload);
  if (payload.primary_image_phash) existing.set(`phash:${payload.primary_image_phash}`, payload);
  if (payload.composite_listing_key) existing.set(`composite:${payload.composite_listing_key}`, payload);
  if (payload.contact_cluster_key) {
    const candidateKey = `contact-candidates:${payload.contact_cluster_key}`;
    existing.set(candidateKey, [...(existing.get(candidateKey) || []), payload]);
  }
  return payload;
}

function alreadyPresentFoundOnlineRow(item = {}, agent = {}, existingRow = {}) {
  return {
    key: item.key,
    id: existingRow.id,
    title: existingRow.title,
    agent_key: item.agentKey,
    agent_name: existingRow.lister_name || agent.name || item.agentKey,
    status: existingRow.status || '',
    moderation_stage: existingRow.moderation_stage || '',
    property_url: existingRow.property_url || '',
    source_url: sourceUrlForItem(item),
    reason: existingRow.duplicate_match_type || 'already_queued',
    duplicate_match_type: existingRow.duplicate_match_type || 'exact_source_url_duplicate',
    already_present: true,
  };
}

function duplicateWarningsForFoundOnlineRows(rows = []) {
  return rows.map((item) => ({
    type: item.duplicate_match_type || 'exact_source_url_duplicate',
    message: item.duplicate_match_type === 'content_fingerprint_duplicate'
      ? 'A listing with the same phone, area, property type, and price has already been imported.'
      : /^caption_simhash/.test(item.duplicate_match_type || '')
        ? 'A near-identical source caption has already been imported.'
        : /^primary_image_(?:dhash|phash)/.test(item.duplicate_match_type || '')
          ? 'The primary source image matches an existing harvested listing.'
          : item.duplicate_match_type === 'composite_listing_duplicate'
            ? 'The seller, area, price, and source-media fingerprint match an existing listing.'
            : `This exact social/source link or stable platform post ID has already been imported to ${TARGET_BRAND_NAME}.`,
    key: item.key,
    id: item.id,
    title: item.title,
    status: item.status || '',
    moderation_stage: item.moderation_stage || '',
    property_url: item.property_url || '',
    source_url: item.source_url || '',
    agent_name: item.agent_name || '',
  }));
}

function foundOnlinePerUrlResults(items = [], {
  created = [],
  alreadyPresent = [],
  sourceReviewRecords = [],
  dryRunRows = [],
  dryRun = false,
} = {}) {
  const matchFor = (rows, item) => {
    const itemUrl = normalizedSourceUrlForItem(item);
    return rows.find((row) => {
      if (row?.key && item.key && String(row.key) === String(item.key)) return true;
      const rowUrl = normalizeSourceUrl(row?.source_url || row?.sourceUrl || row?.post_url || '');
      return Boolean(itemUrl && rowUrl && itemUrl === rowUrl);
    }) || null;
  };
  const results = items.map((item) => {
    const sourceUrl = sourceUrlForItem(item);
    const createdRow = matchFor(created, item);
    const existingRow = matchFor(alreadyPresent, item);
    const skippedRow = matchFor(sourceReviewRecords, item);
    const dryRunRow = matchFor(dryRunRows, item);
    if (createdRow) {
      return {
        key: item.key,
        source_key: item.agentKey || '',
        source_url: sourceUrl,
        platform: item.sourcePlatform || '',
        outcome: 'created',
        reason: 'created_in_review_queue',
        property_id: createdRow.id || null,
        status: createdRow.status || '',
        moderation_stage: createdRow.moderation_stage || '',
        title: createdRow.title || item.title || ''
      };
    }
    if (existingRow) {
      return {
        key: item.key,
        source_key: item.agentKey || '',
        source_url: sourceUrl,
        platform: item.sourcePlatform || '',
        outcome: 'duplicate',
        classification: 'duplicate',
        reason: existingRow.reason || existingRow.duplicate_match_type || 'already_queued',
        property_id: existingRow.id || null,
        status: existingRow.status || '',
        moderation_stage: existingRow.moderation_stage || '',
        title: existingRow.title || item.title || ''
      };
    }
    if (skippedRow) {
      const reason = skippedRow.reason || 'source_review_required';
      return {
        key: item.key,
        source_key: item.agentKey || '',
        source_url: sourceUrl,
        platform: item.sourcePlatform || '',
        outcome: 'skipped',
        classification: reason === NON_TARGET_LOCATION_REASON
          ? (IS_SOUTH_AFRICA ? 'non_south_africa' : 'non_uganda')
          : reason === 'not_a_listing' || reason === 'non_listing_source_content'
            ? 'not_a_listing'
            : 'launch_intake',
        reason,
        property_id: null,
        status: '',
        moderation_stage: 'source_review',
        title: skippedRow.title || item.title || ''
      };
    }
    if (dryRun && dryRunRow) {
      return {
        key: item.key,
        source_key: item.agentKey || '',
        source_url: sourceUrl,
        platform: item.sourcePlatform || '',
        outcome: 'would_create',
        reason: 'would_create_in_review_queue',
        property_id: null,
        status: dryRunRow.status || '',
        moderation_stage: dryRunRow.moderation_stage || '',
        title: dryRunRow.title || item.title || ''
      };
    }
    return {
      key: item.key,
      source_key: item.agentKey || '',
      source_url: sourceUrl,
      platform: item.sourcePlatform || '',
      outcome: 'skipped',
      reason: 'unaccounted_import_result',
      property_id: null,
      status: '',
      moderation_stage: '',
      title: item.title || ''
    };
  });
  const summary = results.reduce((counts, item) => {
    counts[item.outcome] = (counts[item.outcome] || 0) + 1;
    return counts;
  }, {});
  return { results, summary };
}

async function existingFoundOnlineContactCounts(client, items = []) {
  const phoneKeys = [];
  const emailKeys = [];
  const sourceKeys = [];
  for (const item of items) {
    const agent = sourceAgentForItem(item);
    const contactKey = normalizedContactKeyForSource(agent, item);
    if (contactKey.startsWith('phone:')) phoneKeys.push(contactKey.slice('phone:'.length));
    if (contactKey.startsWith('email:')) emailKeys.push(contactKey.slice('email:'.length));
    if (contactKey.startsWith('source:')) sourceKeys.push(contactKey.slice('source:'.length));
  }
  const uniquePhones = [...new Set(phoneKeys)].filter(Boolean);
  const uniqueEmails = [...new Set(emailKeys)].filter(Boolean);
  const uniqueSources = [...new Set(sourceKeys)].filter(Boolean);
  if (!uniquePhones.length && !uniqueEmails.length && !uniqueSources.length) return {};
  const result = await client.query(
    `WITH normalized AS (
       SELECT
         CASE
           WHEN LENGTH(phone_digits) = 10 AND phone_digits LIKE '0%'
             THEN '${TARGET_DIAL_DIGITS}' || SUBSTRING(phone_digits FROM 2)
           WHEN LENGTH(phone_digits) = 9 AND phone_digits ~ '${TARGET_LOCAL_PHONE_PATTERN}'
             THEN '${TARGET_DIAL_DIGITS}' || phone_digits
           ELSE phone_digits
         END AS phone_key,
         LOWER(COALESCE(lister_email, '')) AS email_key,
         LOWER(TRIM(BOTH '/' FROM COALESCE(extra_fields->>'source_contact_url', extra_fields->>'source_url', ''))) AS source_key
       FROM (
         SELECT
           REGEXP_REPLACE(COALESCE(lister_phone, extra_fields->>'contact_phone_alt', ''), '\\D', '', 'g') AS phone_digits,
           lister_email,
           extra_fields
         FROM properties
         WHERE source IN ($1, $5)
           AND COALESCE(status, '') <> 'deleted'
       ) property_contacts
     ),
     matched AS (
       SELECT
         CASE
           WHEN phone_key = ANY($2::text[]) THEN 'phone:' || phone_key
           WHEN email_key = ANY($3::text[]) THEN 'email:' || email_key
           WHEN source_key = ANY($4::text[]) THEN 'source:' || source_key
           ELSE ''
         END AS contact_key
       FROM normalized
     )
     SELECT contact_key, COUNT(*)::int AS count
     FROM matched
     WHERE contact_key <> ''
     GROUP BY contact_key`,
    [SOCIAL_SEARCH_SOURCE, uniquePhones, uniqueEmails, uniqueSources, LEGACY_SOURCED_INVENTORY_CANDIDATE_SOURCE]
  );
  return result.rows.reduce((acc, row) => {
    if (row.contact_key) acc[row.contact_key] = Number(row.count || 0);
    return acc;
  }, {});
}

async function queueFoundOnlineSourcePostListings({
  db,
  posts = [],
  dryRun = false,
  createProfilesForRepeatedSourcesOnly = false,
} = {}) {
  const items = (Array.isArray(posts) ? posts : [])
    .map((post, index) => normalizeFoundOnlineSourcePost(post, index))
    .filter((item) => item.sourceUrl || item.title);
  const suppressedSources = await suppressedSourceRowsForItems(db, items);
  const evaluated = items.map((item) => ({
    item,
    agent: sourceAgentForItem(item),
    suppressed_source: suppressedSources.get(normalizedSourceUrlForItem(item)),
  })).map(({ item, agent, suppressed_source: suppressedSource }) => {
    const intake = sourcePostMeetsLaunchIntakeRule(item, agent);
    return {
      item,
      agent,
      suppressed_source: suppressedSource || null,
      intake: suppressedSource
        ? {
          ...intake,
          eligible: false,
          suppressed_source_url: normalizedSourceUrlForItem(item),
          suppressed_source_reason: suppressedSource.reason || 'source_previously_rejected',
        }
        : intake,
    };
  });
  const eligibleSourceCounts = evaluated.reduce((acc, { item, intake }) => {
    if (intake.eligible) acc[item.agentKey] = (acc[item.agentKey] || 0) + 1;
    return acc;
  }, {});
  const eligibleContactCounts = evaluated.reduce((acc, { item, agent, intake }) => {
    if (!intake.eligible) return acc;
    const contactKey = normalizedContactKeyForSource(agent, item);
    if (contactKey) acc[contactKey] = (acc[contactKey] || 0) + 1;
    return acc;
  }, {});
  let existingContactCounts = {};
  const shouldCreateSourceProfile = () => FOUND_ONLINE_PROFILE_CREATION_POLICY.auto_create_source_profiles === true;
  const sourceProfileKeyForItem = (item = {}, agent = {}) => {
    const contactKey = normalizedContactKeyForSource(agent, item);
    if (contactKey && Number(eligibleContactCounts[contactKey] || 0) + Number(existingContactCounts[contactKey] || 0) > 1) {
      return `found-online-${contactKey.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()}`;
    }
    return item.agentKey;
  };
  const sourceReviewRecords = evaluated
    .filter(({ intake }) => !intake.eligible)
    .map(({ item, agent, intake }) => ({
      key: item.key,
      title: item.title,
      agent_key: item.agentKey,
      agent_name: agent.name || item.agentKey,
      source_url: sourceUrlForItem(item),
      source_contact_url: sourceContactUrlForAgent(agent, item),
      reason: sourceReviewReasonForIntake(intake),
      intake,
      suppressed_source: intake.suppressed_source_url ? {
        source_url: intake.suppressed_source_url,
        reason: intake.suppressed_source_reason,
      } : undefined,
      source_quality: intake.source_quality_suppressed ? {
        suppressed: true,
        reason: intake.source_quality_reason,
        matched: intake.source_quality_matched,
      } : undefined,
    }));
  const sourceQualitySuppressedRecords = sourceReviewRecords.filter((item) => item.intake?.source_quality_suppressed);
  const suppressedSourceRecords = sourceReviewRecords.filter((item) => item.intake?.suppressed_source_url);
  const lowSignalSourceLocationRecords = sourceReviewRecords.filter((item) => item.reason === 'low_signal_source_location');
  const foreignRejectedRecords = sourceReviewRecords.filter((item) => item.reason === NON_TARGET_LOCATION_REASON);

  let previewExisting = new Map();
  if (dryRun && db?.pool) {
    const previewClient = await db.pool.connect();
    try {
      previewExisting = await existingFoundOnlineSourcePostListings(previewClient, items);
    } finally {
      previewClient.release();
    }
  }

  if (dryRun) {
    const eligible = evaluated.filter(({ intake }) => intake.eligible);
    const alreadyPresent = [];
    const previewCombined = new Map(previewExisting);
    const dryRunRows = eligible.flatMap(({ item, agent, intake }) => {
      const existingRow = existingFoundOnlineRowForItem(previewCombined, item);
      if (existingRow) {
        alreadyPresent.push(alreadyPresentFoundOnlineRow(item, agent, existingRow));
        return [];
      }
      const autoLive = sourcePostAutoLiveStatusFor(item, agent);
      const row = {
        key: item.key,
        title: item.title,
        area: item.area,
        district: item.district,
        price: item.price,
        price_text: item.priceText,
        price_label: item.price ? '' : PRICE_UPON_APPLICATION_LABEL,
        listing_type: item.listingType,
        source_platform: item.sourcePlatform,
        first_posted_at: item.sourcePublishedAt,
        contact_phone: agent.phone || '',
        contact_email: agent.email || '',
        source_url: sourceUrlForItem(item),
        source_contact_url: sourceContactUrlForAgent(agent, item),
        agent_name: agent.name || item.agentKey,
        profile_action: FOUND_ONLINE_PROFILE_CREATION_POLICY.profile_action,
        profile_key: shouldCreateSourceProfile(item, agent) ? sourceProfileKeyForItem(item, agent) : null,
        profile_policy: FOUND_ONLINE_PROFILE_CREATION_POLICY.rule,
        auto_live_ready: autoLive.approved,
        auto_live_policy: autoLive.policy,
        status: autoLive.status,
        moderation_stage: autoLive.moderation_stage,
        intake,
        dry_run: true,
      };
      registerExistingFoundOnlineItem(previewCombined, item, {
        id: `dry-run:${item.key}`,
        title: item.title,
        status: row.status,
        moderation_stage: row.moderation_stage,
        lister_name: agent.name || item.agentKey,
        property_url: '',
      });
      return [row];
    });
    const autoLiveRows = dryRunRows.filter((item) => item.auto_live_ready);
    const reviewRows = dryRunRows.filter((item) => !item.auto_live_ready);
    const duplicateWarnings = duplicateWarningsForFoundOnlineRows(alreadyPresent);
    const perUrl = foundOnlinePerUrlResults(items, {
      alreadyPresent,
      sourceReviewRecords,
      dryRunRows,
      dryRun: true,
    });
    return {
      ok: true,
      dry_run: true,
      received_posts: Array.isArray(posts) ? posts.length : 0,
      normalized_posts: items.length,
      eligible_to_queue_count: eligible.length,
      source_review_count: sourceReviewRecords.length,
      suppressed_source_count: suppressedSourceRecords.length,
      source_quality_suppressed_count: sourceQualitySuppressedRecords.length,
      low_signal_source_location_count: lowSignalSourceLocationRecords.length,
      foreign_rejected_count: foreignRejectedRecords.length,
      created_properties: 0,
      would_create_properties: dryRunRows.length,
      existing_properties: alreadyPresent.length,
      created_auto_live_properties: 0,
      existing_auto_live_properties: 0,
      auto_live_properties: autoLiveRows.length,
      review_queue_properties: reviewRows.length,
      auto_live_listings: autoLiveRows,
      queued_listings: dryRunRows,
      review_queue_listings: reviewRows,
      already_present_properties: alreadyPresent,
      duplicate_warning_count: duplicateWarnings.length,
      duplicate_warnings: duplicateWarnings,
      duplicate_source_url_records: duplicateWarnings,
      per_url_results: perUrl.results,
      per_url_summary: perUrl.summary,
      source_review_records: sourceReviewRecords,
      suppressed_source_records: suppressedSourceRecords,
      source_quality_suppressed_records: sourceQualitySuppressedRecords,
      low_signal_source_location_records: lowSignalSourceLocationRecords,
      foreign_rejected_records: foreignRejectedRecords,
      daily_target_status: {
        ...socialSearchDailyTargetStatus(),
        imported_post_eligible_count: eligible.length,
      },
    };
  }

  if (!db?.pool) throw new Error('db.pool is required');
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await existingFoundOnlineSourcePostListings(client, items);
    if (shouldCreateSourceProfile()) {
      existingContactCounts = await existingFoundOnlineContactCounts(client, items);
    }
    const agentIdsByKey = {};
    const created = [];
    const alreadyPresent = [];
    const skippedListings = [...sourceReviewRecords];

    for (const { item, agent, intake } of evaluated) {
      let existingRow = existingFoundOnlineRowForItem(existing, item);
      if (existingRow) {
        alreadyPresent.push(alreadyPresentFoundOnlineRow(item, agent, existingRow));
        continue;
      }
      if (!intake.eligible) continue;
      const fingerprint = contentFingerprintForSourceItem(item);
      if (fingerprint) {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`found-online:${fingerprint}`]);
        const lockedExisting = await existingFoundOnlineSourcePostListings(client, [item]);
        existingRow = existingFoundOnlineRowForItem(lockedExisting, item);
        if (existingRow) {
          alreadyPresent.push(alreadyPresentFoundOnlineRow(item, agent, existingRow));
          registerExistingFoundOnlineItem(existing, item, existingRow);
          continue;
        }
      }
      const createProfile = shouldCreateSourceProfile(item, agent);
      const profileKey = sourceProfileKeyForItem(item, agent);
      if (createProfile && !agentIdsByKey[profileKey]) {
        agentIdsByKey[profileKey] = await upsertSocialAgent(client, {
          ...agent,
          key: profileKey,
          source_contact_group_key: profileKey,
        });
      }
      const agentId = createProfile ? agentIdsByKey[profileKey] : null;
      const listing = buildSocialSearchListing(item, agentId);
      const inserted = await insertListing(client, listing, agentId);
      inserted.profile_action = createProfile ? 'create_or_update_source_profile' : FOUND_ONLINE_PROFILE_CREATION_POLICY.profile_action;
      inserted.profile_key = createProfile ? profileKey : null;
      inserted.profile_policy = FOUND_ONLINE_PROFILE_CREATION_POLICY.rule;
      created.push(inserted);
      registerExistingFoundOnlineItem(existing, item, {
        ...inserted,
        lister_name: agent.name || item.agentKey,
      });
    }

    const persistence = await verifyCreatedListingRows(client, created);
    if (evaluated.some(({ intake }) => intake.eligible) && !created.length && !alreadyPresent.length) {
      const error = new Error('Eligible Found Online rows were evaluated, but none were created or matched as existing.');
      error.code = 'FOUND_ONLINE_QUEUE_EMPTY';
      throw error;
    }
    await client.query('COMMIT');
    const autoLiveCreated = created.filter((item) => isLiveOrApprovedStatus(item));
    const reviewCreated = created.filter((item) => isReviewQueueStatus(item));
    const alreadyPresentReviewQueue = alreadyPresent.filter((item) => isReviewQueueStatus(item));
    const alreadyLiveOrApproved = alreadyPresent.filter((item) => isLiveOrApprovedStatus(item));
    const duplicateWarnings = duplicateWarningsForFoundOnlineRows(alreadyPresent);
    const perUrl = foundOnlinePerUrlResults(items, {
      created,
      alreadyPresent,
      sourceReviewRecords: skippedListings,
      dryRun: false,
    });
    const reviewQueueListings = [
      ...reviewCreated,
      ...alreadyPresentReviewQueue.map((item) => ({
        id: item.id,
        title: item.title,
        property_url: item.property_url,
        agent_name: item.agent_name,
        status: item.status,
        moderation_stage: item.moderation_stage,
        source_url: item.source_url,
        source_listing_key: item.key,
        already_present: true,
        review_queue_visible: true,
      })),
    ];
    const autoLiveListings = [
      ...autoLiveCreated,
      ...alreadyLiveOrApproved.map((item) => ({
        id: item.id,
        title: item.title,
        property_url: item.property_url,
        agent_name: item.agent_name,
        status: item.status,
        moderation_stage: item.moderation_stage,
        source_url: item.source_url,
        source_listing_key: item.key,
        already_present: true,
        already_live_or_approved: true,
      })),
    ];
    return {
      ok: true,
      dry_run: false,
      received_posts: Array.isArray(posts) ? posts.length : 0,
      normalized_posts: items.length,
      eligible_to_queue_count: evaluated.filter(({ intake }) => intake.eligible).length,
      created_properties: created.length,
      existing_properties: alreadyPresent.length,
      created_auto_live_properties: autoLiveCreated.length,
      created_review_queue_properties: reviewCreated.length,
      existing_auto_live_properties: alreadyLiveOrApproved.length,
      auto_live_properties: autoLiveListings.length,
      review_queue_properties: reviewQueueListings.length,
      auto_live_listings: autoLiveListings,
      queued_listings: reviewQueueListings,
      already_present_properties: alreadyPresent,
      already_present_review_queue_properties: alreadyPresentReviewQueue,
      already_live_or_approved_properties: alreadyLiveOrApproved,
      duplicate_warning_count: duplicateWarnings.length,
      duplicate_warnings: duplicateWarnings,
      duplicate_source_url_records: duplicateWarnings,
      per_url_results: perUrl.results,
      per_url_summary: perUrl.summary,
      source_review_count: skippedListings.length,
      suppressed_source_count: suppressedSourceRecords.length,
      source_quality_suppressed_count: sourceQualitySuppressedRecords.length,
      low_signal_source_location_count: lowSignalSourceLocationRecords.length,
      foreign_rejected_count: foreignRejectedRecords.length,
      source_review_records: skippedListings,
      persistence_verified: persistence.verified,
      persisted_property_count: persistence.count,
      persisted_property_ids: persistence.ids,
      suppressed_source_records: suppressedSourceRecords,
      source_quality_suppressed_records: sourceQualitySuppressedRecords,
      low_signal_source_location_records: lowSignalSourceLocationRecords,
      foreign_rejected_records: foreignRejectedRecords,
      daily_target_status: {
        ...socialSearchDailyTargetStatus({ createdCount: created.length, alreadyPresentCount: alreadyPresent.length }),
        imported_post_eligible_count: evaluated.filter(({ intake }) => intake.eligible).length,
      },
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function sourceKeyCandidatesForItem(item = {}) {
  return [
    item.key,
    item.source_listing_key,
    item.sourceListingKey,
    item.post_id,
    item.postId,
    item.id,
  ].map((value) => String(value || '').trim()).filter(Boolean);
}

function sourceVideoIdForItem(item = {}) {
  return String(
    item.youtubeId
    || item.youtube_id
    || item.youtubeVideoId
    || item.youtube_video_id
    || youtubeIdFromUrl(sourceUrlForItem(item))
    || ''
  ).trim();
}

function sourceVideoIdForRow(row = {}) {
  const extra = row.extra_fields && typeof row.extra_fields === 'object' ? row.extra_fields : {};
  return String(
    extra.youtube_video_id
    || extra.youtube_id
    || youtubeIdFromUrl(extra.source_url)
    || youtubeIdFromUrl(extra.source_post_url)
    || youtubeIdFromUrl(extra.youtube_url)
    || youtubeIdFromUrl(extra.video_url)
    || youtubeIdFromUrl(row.source_url)
    || ''
  ).trim();
}

function addExistingRowCandidate(existing = new Map(), key = '', row = {}) {
  const normalized = String(key || '').trim();
  if (normalized && !existing.has(normalized)) existing.set(normalized, row);
}

async function existingFoundOnlineSourceRowsForReprocess(client, items = []) {
  const keys = [...new Set(items.flatMap(sourceKeyCandidatesForItem))].filter(Boolean);
  const urls = uniqueUrls(items.flatMap((item) => [
    sourceUrlForItem(item),
    item.sourceUrl,
    item.source_url,
    item.source_post_url,
    item.postUrl,
    item.post_url,
    item.youtube_url,
    item.video_url,
  ]));
  const videoIds = [...new Set(items.map(sourceVideoIdForItem).filter(Boolean))];
  if (!keys.length && !urls.length && !videoIds.length) return new Map();
  const result = await client.query(
    `SELECT
       id::text AS id,
       title,
       status,
       moderation_stage,
       inquiry_reference,
       lister_name,
       agent_id::text AS agent_id,
       extra_fields,
       extra_fields->>'source_listing_key' AS source_listing_key,
       extra_fields->>'source_post_url' AS source_post_url,
       COALESCE(
         extra_fields->>'source_url',
         extra_fields->>'youtube_url',
         extra_fields->>'video_url',
         extra_fields->>'original_url'
       ) AS source_url
     FROM properties
     WHERE COALESCE(status, '') <> 'deleted'
       AND (
         extra_fields->>'source_listing_key' = ANY($1::text[])
         OR extra_fields->>'source_post_url' = ANY($2::text[])
         OR extra_fields->>'source_url' = ANY($2::text[])
         OR extra_fields->>'youtube_url' = ANY($2::text[])
         OR extra_fields->>'video_url' = ANY($2::text[])
         OR extra_fields->>'original_url' = ANY($2::text[])
         OR extra_fields->>'youtube_video_id' = ANY($3::text[])
         OR EXISTS (
           SELECT 1
           FROM unnest($3::text[]) AS video_id
           WHERE video_id <> ''
             AND (
               COALESCE(extra_fields->>'source_url', '') ILIKE '%' || video_id || '%'
               OR COALESCE(extra_fields->>'source_post_url', '') ILIKE '%' || video_id || '%'
               OR COALESCE(extra_fields->>'youtube_url', '') ILIKE '%' || video_id || '%'
               OR COALESCE(extra_fields->>'video_url', '') ILIKE '%' || video_id || '%'
               OR COALESCE(extra_fields->>'original_url', '') ILIKE '%' || video_id || '%'
             )
         )
       )`,
    [keys, urls, videoIds]
  );
  const existing = new Map();
  for (const row of result.rows) {
    const payload = {
      ...row,
      property_url: `${publicBaseUrl()}/property/${row.id}`,
    };
    addExistingRowCandidate(existing, row.source_listing_key, payload);
    addExistingRowCandidate(existing, row.source_post_url, payload);
    addExistingRowCandidate(existing, row.source_url, payload);
    const videoId = sourceVideoIdForRow(row);
    addExistingRowCandidate(existing, videoId, payload);
    if (videoId) addExistingRowCandidate(existing, `youtube:${videoId}`, payload);
  }
  return existing;
}

async function updateExistingFoundOnlineSourcePostListing(client, existingRow = {}, item = {}, agentId = null) {
  const listing = buildSocialSearchListing(item, agentId);
  const autoLive = sourcePostAutoLiveStatusFor(item, sourceAgentForItem(item));
  const propertyUrl = `${publicBaseUrl()}/property/${existingRow.id}`;
  const existingExtra = existingRow.extra_fields && typeof existingRow.extra_fields === 'object'
    ? existingRow.extra_fields
    : {};
  const ownerPreviewUrl = existingExtra.owner_preview_url || '';
  const finalExtraFields = {
    ...extraFieldsFor(item, agentId, propertyUrl, ownerPreviewUrl),
    youtube_source_text_enrichment_version: 'youtube-source-text-enrichment-20260707',
    youtube_source_reenriched_at: new Date().toISOString(),
    youtube_source_reenrichment_result: autoLive.approved ? 'auto_live_after_backlog_enrichment' : 'still_pending_after_backlog_enrichment',
    reprocessed_existing_source_post: true,
  };
  const updated = await client.query(
    `UPDATE properties
     SET listing_type = $2,
         transaction_type = $3,
         title = $4,
         description = $5,
         district = $6,
         area = $7,
         address = $8,
         price = $9,
         price_currency = $10,
         price_original = $11,
         price_fx_rate_ugx = $12,
         price_fx_as_of = $13,
         price_period = $14,
         bedrooms = $15,
         bathrooms = $16,
         property_type = $17,
         land_size_value = $18,
         land_size_unit = $19,
         latitude = $20,
         longitude = $21,
         students_welcome = $22,
         amenities = $23::jsonb,
         status = $24,
         moderation_stage = $25,
         reviewed_at = CASE WHEN $26::boolean THEN COALESCE(reviewed_at, NOW()) ELSE reviewed_at END,
         moderation_notes = $27,
         moderation_reason = $28,
         extra_fields = COALESCE(extra_fields, '{}'::jsonb) || $29::jsonb,
         updated_at = NOW()
     WHERE id = $1
     RETURNING id::text AS id, title, status, moderation_stage`,
    [
      existingRow.id,
      listing.listing_type,
      listing.transaction_type,
      listing.title,
      listing.description,
      listing.district,
      listing.area,
      listing.address,
      listing.price,
      listing.price_currency,
      listing.price_original,
      listing.price_fx_rate_ugx,
      listing.price_fx_as_of,
      listing.price_period,
      listing.bedrooms,
      listing.bathrooms,
      listing.property_type,
      listing.land_size_value,
      listing.land_size_unit,
      listing.latitude,
      listing.longitude,
      listing.students_welcome,
      listing.amenities,
      listing.status,
      listing.moderation_stage,
      autoLive.approved,
      listing.moderation_notes,
      listing.moderation_reason,
      JSON.stringify(finalExtraFields),
    ]
  );
  await client.query(
    `INSERT INTO property_moderation_events (
      property_id, actor_id, action, status_from, status_to, checklist, reason, notes, delivery
    ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9::jsonb)`,
    [
      existingRow.id,
      autoLive.approved ? 'youtube_hashtag_backlog_enricher' : 'youtube_hashtag_backlog_reviewer',
      autoLive.approved ? 'youtube_hashtag_backlog_enriched_auto_live' : 'youtube_hashtag_backlog_enriched_pending',
      existingRow.status || 'pending',
      listing.status || 'pending',
      JSON.stringify({
        found_online_candidate: true,
        social_search_candidate: true,
        reprocessed_existing_source_post: true,
        auto_live_source_import: autoLive.approved,
        auto_live_policy: autoLive.policy,
        auto_live_review_status: autoLive.review_status,
        source_batch: itemBatchId(item),
        source_url: sourceUrlForItem(item),
        youtube_url: item.youtubeId ? youtubeUrl(item.youtubeId) : sourceUrlForItem(item),
        youtube_video_id: sourceVideoIdForItem(item),
        youtube_source_text_enrichment_version: 'youtube-source-text-enrichment-20260707',
      }),
      listing.moderation_reason,
      listing.moderation_notes,
      JSON.stringify({
        property_url: propertyUrl,
        owner_preview_url: ownerPreviewUrl,
        agent_id: agentId,
        whatsapp_share_card: whatsappShareMessage(item, propertyUrl, ownerPreviewUrl),
      }),
    ]
  );
  return {
    ...updated.rows[0],
    property_url: propertyUrl,
    source_url: sourceUrlForItem(item),
    youtube_url: item.youtubeId ? youtubeUrl(item.youtubeId) : sourceUrlForItem(item),
    agent_name: listing.lister_name,
    auto_live_ready: autoLive.approved,
    auto_live_policy: autoLive.policy,
    auto_live_review_status: autoLive.review_status,
  };
}

async function markExistingFoundOnlineSourcePostEnrichedPending(client, existingRow = {}, item = {}, agentId = null, reason = '') {
  const autoLive = sourcePostAutoLiveStatusFor(item, sourceAgentForItem(item));
  const propertyUrl = `${publicBaseUrl()}/property/${existingRow.id}`;
  const existingExtra = existingRow.extra_fields && typeof existingRow.extra_fields === 'object'
    ? existingRow.extra_fields
    : {};
  const ownerPreviewUrl = existingExtra.owner_preview_url || '';
  const finalExtraFields = {
    ...extraFieldsFor(item, agentId, propertyUrl, ownerPreviewUrl),
    youtube_source_text_enrichment_version: 'youtube-source-text-enrichment-20260707',
    youtube_source_reenriched_at: new Date().toISOString(),
    youtube_source_reenrichment_result: reason || 'held_after_backlog_enrichment',
    reprocessed_existing_source_post: true,
  };
  const updated = await client.query(
    `UPDATE properties
     SET extra_fields = COALESCE(extra_fields, '{}'::jsonb) || $2::jsonb,
         moderation_reason = COALESCE(NULLIF(moderation_reason, ''), $3),
         updated_at = NOW()
     WHERE id = $1
     RETURNING id::text AS id, title, status, moderation_stage`,
    [
      existingRow.id,
      JSON.stringify(finalExtraFields),
      reason || 'Still pending after YouTube source text enrichment; source evidence is not specific enough for auto-live.',
    ]
  );
  await client.query(
    `INSERT INTO property_moderation_events (
      property_id, actor_id, action, status_from, status_to, checklist, reason, notes, delivery
    ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9::jsonb)`,
    [
      existingRow.id,
      'youtube_hashtag_backlog_reviewer',
      'youtube_hashtag_backlog_enriched_pending',
      existingRow.status || 'pending',
      existingRow.status || 'pending',
      JSON.stringify({
        found_online_candidate: true,
        social_search_candidate: true,
        reprocessed_existing_source_post: true,
        auto_live_source_import: false,
        auto_live_policy: autoLive.policy,
        auto_live_review_status: autoLive.review_status,
        source_batch: itemBatchId(item),
        source_url: sourceUrlForItem(item),
        youtube_url: item.youtubeId ? youtubeUrl(item.youtubeId) : sourceUrlForItem(item),
        youtube_video_id: sourceVideoIdForItem(item),
        youtube_source_text_enrichment_version: 'youtube-source-text-enrichment-20260707',
      }),
      reason || 'Still pending after YouTube source text enrichment.',
      `YouTube source text/comments were enriched, but this row remains pending because it does not meet the auto-live gate. Source: ${sourceUrlForItem(item)}.`,
      JSON.stringify({
        property_url: propertyUrl,
        owner_preview_url: ownerPreviewUrl,
        agent_id: agentId,
      }),
    ]
  );
  return {
    ...updated.rows[0],
    property_url: propertyUrl,
    source_url: sourceUrlForItem(item),
    youtube_url: item.youtubeId ? youtubeUrl(item.youtubeId) : sourceUrlForItem(item),
    agent_name: sourceAgentForItem(item).name || existingRow.lister_name || '',
    auto_live_ready: false,
    auto_live_policy: autoLive.policy,
    auto_live_review_status: autoLive.review_status,
    held_reason: reason || 'held_after_backlog_enrichment',
  };
}

async function reprocessExistingFoundOnlineSourcePostListings({
  db,
  posts = [],
  dryRun = false,
} = {}) {
  const items = (Array.isArray(posts) ? posts : [])
    .map((post, index) => normalizeFoundOnlineSourcePost(post, index))
    .filter((item) => item.sourceUrl || item.title);
  const evaluated = items.map((item) => ({
    item,
    agent: sourceAgentForItem(item),
    intake: sourcePostMeetsLaunchIntakeRule(item, sourceAgentForItem(item)),
  }));
  if (!db?.pool) throw new Error('db.pool is required');
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await existingFoundOnlineSourceRowsForReprocess(client, items);
    const matched = [];
    const updated = [];
    const skipped = [];

    for (const { item, agent, intake } of evaluated) {
      const sourceUrl = sourceUrlForItem(item);
      const videoId = sourceVideoIdForItem(item);
      const existingRow = existing.get(item.key)
        || existing.get(sourceUrl)
        || existing.get(videoId)
        || existing.get(videoId ? `youtube:${videoId}` : '');
      if (!existingRow) {
        skipped.push({
          key: item.key,
          title: item.title,
          source_url: sourceUrl,
          youtube_video_id: videoId,
          reason: 'no_existing_property_for_source',
        });
        continue;
      }
      const autoLive = sourcePostAutoLiveStatusFor(item, agent);
      const payload = {
        key: item.key,
        id: existingRow.id,
        title: item.title,
        previous_title: existingRow.title || '',
        status: existingRow.status || '',
        moderation_stage: existingRow.moderation_stage || '',
        property_url: existingRow.property_url || `${publicBaseUrl()}/property/${existingRow.id}`,
        source_url: sourceUrl,
        youtube_video_id: videoId,
        intake,
        auto_live_ready: autoLive.approved,
        auto_live_policy: autoLive.policy,
        auto_live_review_status: autoLive.review_status,
      };
      matched.push(payload);
      if (isLiveOrApprovedStatus(existingRow)) {
        skipped.push({
          ...payload,
          reason: 'already_live_or_final',
        });
        continue;
      }
      if (!isReviewQueueStatus(existingRow)) {
        skipped.push({
          ...payload,
          reason: 'not_review_queue_status',
        });
        continue;
      }
      if (!intake.eligible) {
        const reason = sourceReviewReasonForIntake(intake);
        if (dryRun) {
          skipped.push({
            ...payload,
            reason,
          });
          continue;
        }
        const updatedRow = await markExistingFoundOnlineSourcePostEnrichedPending(client, existingRow, item, existingRow.agent_id || null, reason);
        updated.push(updatedRow);
        continue;
      }
      if (dryRun) {
        skipped.push({
          ...payload,
          reason: autoLive.approved ? 'dry_run_would_auto_live' : 'dry_run_would_update_pending',
        });
        continue;
      }
      const updatedRow = await updateExistingFoundOnlineSourcePostListing(client, existingRow, item, existingRow.agent_id || null);
      updated.push(updatedRow);
    }

    if (dryRun) {
      await client.query('ROLLBACK');
    } else {
      await client.query('COMMIT');
    }
    const autoLiveUpdated = updated.filter((item) => isLiveOrApprovedStatus(item));
    const reviewUpdated = updated.filter((item) => isReviewQueueStatus(item));
    const dryRunAutoLive = dryRun ? skipped.filter((item) => item.reason === 'dry_run_would_auto_live') : [];
    const dryRunPendingUpdates = dryRun ? skipped.filter((item) => item.reason === 'dry_run_would_update_pending') : [];
    return {
      ok: true,
      dry_run: dryRun,
      received_posts: Array.isArray(posts) ? posts.length : 0,
      normalized_posts: items.length,
      matched_existing_properties: matched.length,
      updated_properties: updated.length,
      auto_live_properties: autoLiveUpdated.length + dryRunAutoLive.length,
      review_queue_properties: reviewUpdated.length + dryRunPendingUpdates.length,
      auto_live_listings: [...autoLiveUpdated, ...dryRunAutoLive],
      review_queue_listings: [...reviewUpdated, ...dryRunPendingUpdates],
      matched_properties: matched,
      skipped_records: skipped,
      skipped_count: skipped.length,
    };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    throw error;
  } finally {
    client.release();
  }
}

async function seedSocialSearchAuthorisedListings({ db, replace = true } = {}) {
  if (!db?.pool) throw new Error('db.pool is required');
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const agentIdsByKey = {};
    const skippedAgents = [];
    const eligibleCountsByAgent = SOCIAL_SEARCH_LISTINGS.reduce((acc, item) => {
      const agent = agentByKey(item.agentKey);
      if (sourcePostMeetsLaunchIntakeRule(item, agent).eligible) {
        acc[item.agentKey] = (acc[item.agentKey] || 0) + 1;
      }
      return acc;
    }, {});
    const shouldCreateProfileForSeedItem = () => FOUND_ONLINE_PROFILE_CREATION_POLICY.auto_create_source_profiles === true;
    for (const agent of SOCIAL_SEARCH_AGENTS) {
      if (!agentHasPublicContact(agent)) {
        skippedAgents.push({
          key: agent.key,
          name: agent.name,
          channelUrl: agent.channelUrl || agent.website || '',
          reason: 'missing_any_public_contact_path',
        });
        continue;
      }
      skippedAgents.push({
        key: agent.key,
        name: agent.name,
        channelUrl: agent.channelUrl || '',
        reason: FOUND_ONLINE_PROFILE_CREATION_POLICY.profile_action,
        policy: FOUND_ONLINE_PROFILE_CREATION_POLICY.rule,
      });
    }
    const cleanup = replace ? await cleanupSocialSearchBatch(client) : null;
    const existingListingKeys = await existingSocialSearchListingKeys(client);
    const created = [];
    const alreadyPresent = [];
    const skippedListings = [];
    for (const item of SOCIAL_SEARCH_LISTINGS) {
      if (existingListingKeys.has(item.key)) {
        const existing = existingListingKeys.get(item.key) || {};
        const reviewQueueVisible = isReviewQueueStatus(existing);
        const alreadyLiveOrApproved = isLiveOrApprovedStatus(existing);
        alreadyPresent.push({
          id: existing.id,
          title: existing.title || item.title,
          inquiry_reference: existing.inquiry_reference || '',
          property_url: existing.property_url || `${publicBaseUrl()}/property/${existing.id}`,
          agent_name: existing.lister_name || agentByKey(item.agentKey)?.name || '',
          status: existing.status || '',
          moderation_stage: existing.moderation_stage || '',
          source_url: sourceUrlForItem(item),
          youtube_url: youtubeUrl(item.youtubeId),
          source_listing_key: item.key,
          already_present: true,
          review_queue_visible: reviewQueueVisible,
          already_live_or_approved: alreadyLiveOrApproved,
        });
        skippedListings.push({
          key: item.key,
          id: existing.id,
          title: existing.title || item.title,
          agent_key: item.agentKey,
          status: existing.status || '',
          moderation_stage: existing.moderation_stage || '',
          property_url: existing.property_url || '',
          source_url: sourceUrlForItem(item),
          reason: alreadyLiveOrApproved ? 'already_live_or_approved' : 'already_queued',
          already_live_or_approved: alreadyLiveOrApproved,
        });
        continue;
      }
      if (shouldCreateProfileForSeedItem(item) && !agentIdsByKey[item.agentKey]) {
        const agent = agentByKey(item.agentKey) || {};
        skippedListings.push({
          key: item.key,
          title: item.title,
          agent_key: item.agentKey,
          agent_name: agent.name || item.agentKey,
          source_url: sourceUrlForItem(item),
          source_contact_url: sourceContactUrlForAgent(agent, item),
          reason: 'agent_missing_public_contact_path',
        });
        continue;
      }
      const intake = sourcePostMeetsLaunchIntakeRule(item, agentByKey(item.agentKey));
      if (!intake.eligible) {
        skippedListings.push({
          key: item.key,
          title: item.title,
          agent_key: item.agentKey,
          agent_name: agentByKey(item.agentKey)?.name || item.agentKey,
          source_url: sourceUrlForItem(item),
          source_contact_url: sourceContactUrlForAgent(agentByKey(item.agentKey), item),
          reason: sourceReviewReasonForIntake(intake),
          intake,
        });
        continue;
      }
      const agentId = shouldCreateProfileForSeedItem(item) ? agentIdsByKey[item.agentKey] : null;
      const listing = buildSocialSearchListing(item, agentId);
      const inserted = await insertListing(client, listing, agentId);
      inserted.profile_action = agentId ? 'create_or_update_source_profile' : FOUND_ONLINE_PROFILE_CREATION_POLICY.profile_action;
      inserted.profile_policy = FOUND_ONLINE_PROFILE_CREATION_POLICY.rule;
      created.push(inserted);
    }
    await client.query('COMMIT');
    const alreadyPresentReviewQueue = alreadyPresent.filter((item) => item.review_queue_visible && !item.already_live_or_approved && isReviewQueueStatus(item));
    const alreadyLiveOrApproved = alreadyPresent.filter((item) => item.already_live_or_approved);
    const sourceReviewRecords = [
      ...skippedAgents.map((agent) => ({
        key: agent.key,
        title: agent.name,
        source_name: agent.name,
        reason: agent.reason,
        source_url: agent.channelUrl || '',
      })),
      ...skippedListings.filter((item) => !['already_queued', 'already_live_or_approved'].includes(item.reason)),
    ];
    const reviewQueueListings = [...created, ...alreadyPresentReviewQueue];
    const dailyTargetStatus = socialSearchDailyTargetStatus({
      alreadyPresentCount: alreadyPresent.length,
      createdCount: created.length,
    });
    return {
      ok: true,
      source: SOCIAL_SEARCH_SOURCE,
      batch_id: SOCIAL_SEARCH_BATCH_ID,
      replace,
      cleanup,
      agents: SOCIAL_SEARCH_AGENTS
        .filter((agent) => agentIdsByKey[agent.key])
        .map((agent) => ({
        id: agentIdsByKey[agent.key],
        name: agent.name,
        company: agent.company,
        phone: agent.phone,
        phoneAlt: agent.phoneAlt || '',
        email: agent.email || '',
        channelUrl: agent.channelUrl,
        sourceContactUrl: sourceContactUrlForAgent(agent),
        sourceContactMethod: sourceContactMethodForAgent(agent),
        noPhonePolicy: PUBLIC_SOURCE_CONTACT_POLICY,
        audienceLabel: agent.audienceLabel || '',
      })),
      skipped_agents: skippedAgents,
      skipped_listings: skippedListings,
      created_properties: created.length,
      existing_properties: alreadyPresent.length,
      existing_properties_total: alreadyPresent.length,
      review_queue_properties: reviewQueueListings.length,
      already_present_properties: alreadyPresentReviewQueue,
      already_present_all_properties: alreadyPresent,
      already_present_review_queue_properties: alreadyPresentReviewQueue,
      already_live_or_approved_properties: alreadyLiveOrApproved,
      source_review_records: sourceReviewRecords,
      source_review_count: sourceReviewRecords.length,
      queued_listings: reviewQueueListings,
      review_queue_listings: reviewQueueListings,
      daily_target_status: dailyTargetStatus,
      by_type: created.reduce((acc, item) => {
        const original = SOCIAL_SEARCH_LISTINGS.find((listing) => (
          (item.youtube_url && listing.youtubeId === item.youtube_url.split('v=')[1])
          || sourceUrlForItem(listing) === item.source_url
        ));
        const type = original?.listingType || 'sale';
        acc[type] = (acc[type] || 0) + 1;
        return acc;
      }, {}),
      listings: created,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function socialSearchDailyTargetStatus({ createdCount = 0, alreadyPresentCount = 0 } = {}) {
  const seedEligibleListings = SOCIAL_SEARCH_LISTINGS.filter((item) => sourcePostMeetsLaunchIntakeRule(item, agentByKey(item.agentKey)).eligible);
  const eligibleToQueueCount = seedEligibleListings.length;
  const targetGap = Math.max(0, DAILY_FOUND_ONLINE_PROPERTY_TARGET - eligibleToQueueCount);
  const queuedOrAlreadyPresentCount = Number(createdCount || 0) + Number(alreadyPresentCount || 0);
  return {
    target: DAILY_FOUND_ONLINE_PROPERTY_TARGET,
    evidence_ready_count: SOCIAL_SEARCH_LISTINGS.length,
    eligible_to_queue_count: eligibleToQueueCount,
    queued_or_already_present_count: queuedOrAlreadyPresentCount,
    skipped_until_public_contact_count: SOCIAL_SEARCH_LISTINGS.length - eligibleToQueueCount,
    target_gap: targetGap,
    meets_daily_minimum: eligibleToQueueCount >= DAILY_FOUND_ONLINE_PROPERTY_TARGET,
    blocking_reason: targetGap
      ? `Need ${targetGap} more specific eligible social property posts from 1 January 2026 onward with source URL, location/area, usable image/source evidence, and a phone, email, or public social contact path before the 200/day King review minimum is met. Missing source prices are queued as Price upon application. Curated exact YouTube source posts are accepted; website-only sources are ignored.`
      : 'Daily minimum met; continue queuing every extra eligible 2026+ found-online property post because there is no cap.',
    evidence_policy: FOUND_ONLINE_LAUNCH_INTAKE_POLICY.queue_rule,
    no_phone_source_contact_policy:
      PUBLIC_SOURCE_CONTACT_POLICY,
    source_page_vs_property_policy:
      'The 30,000 source database is source pages, hashtags, accounts, and discovery feeds across X/Twitter, Instagram, TikTok, YouTube, Facebook, and student accommodation social sources. King queues curated exact YouTube social-source property posts and other specific public social property posts/listings from 1 January 2026 onward that meet the found-online intake rule. Location is non-negotiable; website-only sources and source pages without a matched post stay out of property inventory.',
    next_required_inputs: [
      'Run inventory:import-source-posts or the protected admin source-post import API with extracted platform posts so every eligible 2026+ post is queued.',
      'Use platform/API exports for YouTube, Meta/Facebook/Instagram, X, and TikTok or an authenticated review workflow for member-only sources.',
      'Promote discovery feeds into reviewed source pages/accounts, then import posts that expose location, usable images/source evidence, and either a direct number or public social contact route; if the source omits price, mark Price upon application.',
    ],
  };
}

function summarizeSocialSearchListings() {
  const listings = plannedSocialSearchListings();
  const seedEligibleListings = SOCIAL_SEARCH_LISTINGS.filter((item) => sourcePostMeetsLaunchIntakeRule(item, agentByKey(item.agentKey)).eligible);
  const profileEligibleAgents = FOUND_ONLINE_PROFILE_CREATION_POLICY.auto_create_source_profiles ? SOCIAL_SEARCH_AGENTS : [];
  const byAgent = SOCIAL_SEARCH_LISTINGS.reduce((acc, item) => {
    const agent = agentByKey(item.agentKey)?.name || item.agentKey;
    acc[agent] = (acc[agent] || 0) + 1;
    return acc;
  }, {});
  const byType = SOCIAL_SEARCH_LISTINGS.reduce((acc, item) => {
    const type = item.listingType || 'sale';
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {});
  return {
    count: listings.length,
    agents_count: profileEligibleAgents.length,
    source_profiles_deferred_count: SOCIAL_SEARCH_AGENTS.length - profileEligibleAgents.length,
    profile_policy: FOUND_ONLINE_PROFILE_CREATION_POLICY.rule,
    seed_eligible_count: seedEligibleListings.length,
    skipped_until_public_contact_count: SOCIAL_SEARCH_LISTINGS.length - seedEligibleListings.length,
    by_agent: byAgent,
    by_type: byType,
    batch_id: SOCIAL_SEARCH_BATCH_ID,
    daily_target_status: socialSearchDailyTargetStatus(),
    samples: listings.slice(0, 8).map((listing) => ({
      title: listing.title,
      area: listing.area,
      district: listing.district,
      price: listing.price,
      source_url: sourceUrlForItem(listing.source_item),
      source_contact_url: sourceContactUrlForAgent(agentByKey(listing.source_item.agentKey), listing.source_item),
      source_audience_label: agentByKey(listing.source_item.agentKey)?.audienceLabel || '',
      images: listing.images.length,
    })),
  };
}

module.exports = {
  SOCIAL_SEARCH_BATCH_ID,
  SOCIAL_SEARCH_SOURCE,
  DAILY_FOUND_ONLINE_PROPERTY_TARGET,
  LAUNCH_SOURCE_POST_WINDOW_START,
  FOUND_ONLINE_SOURCE_POST_IMPORT_BATCH_ID,
  PRICE_UPON_APPLICATION_LABEL,
  FOUND_ONLINE_LAUNCH_INTAKE_POLICY,
  FOUND_ONLINE_PROFILE_CREATION_POLICY,
  SOCIAL_SEARCH_AGENTS,
  SOCIAL_SEARCH_LISTINGS,
  plannedSocialSearchListings,
  seedSocialSearchAuthorisedListings,
  queueFoundOnlineSourcePostListings,
  reprocessExistingFoundOnlineSourcePostListings,
  normalizeFoundOnlineSourcePost,
  buildSocialSearchListing,
  summarizeSocialSearchListings,
  socialSearchDailyTargetStatus,
  sourcePostAutoLiveStatusFor,
  sourcePostMeetsLaunchIntakeRule,
  foundOnlinePerUrlResults,
  contentFingerprintForSourceItem,
  cleanSourceListingTitle,
  sourceUrlForItem,
  sourceImageRowsFor,
  whatsappShareMessage,
  _harvestDedupTest: {
    existingFoundOnlineRowForItem,
    harvestFingerprintsForItem,
    registerExistingFoundOnlineItem,
  },
};
