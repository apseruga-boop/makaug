const { buildListingReference } = require('./listingReferenceService');
const { buildSocialSourceTrustReview } = require('./socialSourceTrustService');
const {
  createOwnerEditToken,
  getOwnerPreviewUrl,
  hashOwnerEditToken,
  ownerEditTokenExpiry,
} = require('./listingModerationService');
const { SOURCE } = require('../scripts/seed-sourced-inventory-candidates');

const SOCIAL_SEARCH_BATCH_ID = 'social_search_authorised_20260520';
const LEGACY_SOURCED_INVENTORY_CANDIDATE_SOURCE = SOURCE;
const SOCIAL_SEARCH_SOURCE = 'found_online_property_source_v1';
const DAILY_FOUND_ONLINE_PROPERTY_TARGET = 200;
const LAUNCH_SOURCE_POST_WINDOW_START = '2026-01-01T00:00:00.000Z';
const FOUND_ONLINE_SOURCE_POST_IMPORT_BATCH_ID = 'found_online_source_post_import';
const SOCIAL_SEARCH_FIRST_SEEN_AT = '2026-05-20T00:00:00.000Z';
const SOCIAL_SEARCH_ADDED_TO_MAKAUG_AT = '2026-05-20T00:00:00.000Z';
const PRICE_UPON_APPLICATION_LABEL = 'Price upon application';
const USD_TO_UGX_GUIDE_RATE = 3800;
const ALLOWED_SOCIAL_SOURCE_PLATFORMS = ['youtube', 'tiktok', 'instagram', 'facebook', 'x', 'twitter'];
const PREAPPROVED_PERMISSION_STATUSES = [
  'founder_reported_agent_authorised_upload',
  'founder_reported_agent_authorised_listing',
  'founder_confirmed_preapproved',
  'agent_authorised_upload',
  'agent_authorised_listing',
  'agent_preapproved',
  'owner_agent_preapproved',
];
const SOCIAL_AREA_PIN_OVERRIDES = [
  { name: 'Ndejje', district: 'Wakiso', lat: 0.244, lng: 32.553, aliases: ['Ndejje', 'Ndejje Lubugumu'] },
  { name: 'Bujjuko Akright Estate', district: 'Wakiso', lat: 0.374, lng: 32.389, aliases: ['Bujjuko Akright', 'Bujuuko Akright', 'Akright', 'Bujjuko', 'Bujuuko'] },
  { name: 'Kakiri', district: 'Wakiso', lat: 0.409, lng: 32.38, aliases: ['Kakiri', 'Kakiri Masulita', 'Kakiri Masulita Hoima Road', 'Hoima Road'] },
  { name: 'Masulita', district: 'Wakiso', lat: 0.51, lng: 32.46, aliases: ['Masulita'] },
  { name: 'Kira', district: 'Wakiso', lat: 0.3978, lng: 32.6414, aliases: ['Kira', 'Kira Town'] },
  { name: 'Kira-Mulawa', district: 'Wakiso', lat: 0.412, lng: 32.65, aliases: ['Kira-Mulawa', 'Kira Mulawa', 'Mulawa'] },
  { name: 'Kira-Nsasa', district: 'Wakiso', lat: 0.428, lng: 32.665, aliases: ['Kira-Nsasa', 'Kira Nsasa', 'Nsasa'] },
  { name: 'Katosi', district: 'Mukono', lat: 0.181, lng: 32.797, aliases: ['Katosi', 'Mpunge', 'Mpungwe', 'Katosi Mpunge'] },
  { name: 'Kololo', district: 'Kampala', lat: 0.356, lng: 32.612, aliases: ['Kololo'] }
];
const PUBLIC_SOURCE_CONTACT_POLICY = 'No public phone number is not a blocker when a public social profile or platform message route exists; makaug shows Contact via social source until the agent adds a direct number. Website-only source/contact routes are not accepted for found-online launch inventory.';
const FOUND_ONLINE_LAUNCH_INTAKE_POLICY = {
  source_window_start: LAUNCH_SOURCE_POST_WINDOW_START,
  target_source_year: 2026,
  queue_rule: 'Queue curated exact YouTube social-source property posts and other specific public social property posts from 1 January 2026 onward. The source must be YouTube, TikTok, Instagram, Facebook, or X/Twitter; it must include a source URL, location or area, usable listing/source evidence, and a social/direct contact path. Location is non-negotiable. Missing price becomes Price upon application. Website-only sources are ignored.',
  image_rule: 'Found-online/social imports are public discovery results: do not rehost downloaded TikTok, Facebook, Instagram, YouTube, X, LinkedIn, WhatsApp, or website photos/videos as makaug gallery assets unless the rights holder has explicitly supplied or approved them. Public pages should show source links or official embeds first, then makaug rewritten facts and disclosures.',
  facebook_image_rule: 'For Facebook, store the exact public post URL as source evidence. Do not scrape or rehost Meta media without permission or an approved Meta tool/feed; link back to the source and ask the source/agent for authorised images before using photos publicly. Location must still be present before approval.',
  platform_scope: ['YouTube', 'TikTok', 'Instagram', 'Facebook', 'X/Twitter'],
};
const FOUND_ONLINE_PROFILE_CREATION_POLICY = {
  auto_create_source_profiles: false,
  profile_action: 'defer_until_agent_claims_profile',
  rule: 'Do not automatically create public Makaug agent/broker profiles from found-online or social-source discovery. Store the original poster/source as source attribution only. A public profile is created only when the agent/broker registers or claims the listing through the approved Makaug broker process.',
};

const SOCIAL_SEARCH_AGENTS = [
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

const SOCIAL_SEARCH_LISTINGS = [
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

function publicBaseUrl() {
  return (process.env.PUBLIC_BASE_URL || 'https://makaug.com').replace(/\/+$/, '');
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

function socialAreaAliasPattern(alias = '') {
  return compactText(alias)
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, '\\s+')
    .replace(/-/g, '[-\\s]+');
}

function socialAreaPinFromText(value = '') {
  const haystack = compactText(value);
  if (!haystack) return null;
  const sorted = SOCIAL_AREA_PIN_OVERRIDES
    .flatMap((point) => (point.aliases || [point.name]).map((alias) => ({ ...point, alias })))
    .sort((a, b) => String(b.alias || '').length - String(a.alias || '').length);
  for (const point of sorted) {
    const pattern = socialAreaAliasPattern(point.alias);
    if (!pattern) continue;
    if (new RegExp(`(^|[^a-z0-9])${pattern}([^a-z0-9]|$)`, 'i').test(haystack)) return point;
  }
  return null;
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
  return [
    raw.title,
    raw.source_title,
    raw.caption,
    raw.description,
    raw.summary,
    raw.raw_text,
    raw.source_text,
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

function sourcePostMeetsLaunchIntakeRule(item = {}, agent = {}) {
  const hasSource = Boolean(sourceUrlForItem(item));
  const allowedSocialSource = itemHasAllowedSocialSource(item, agent);
  const hasLocation = Boolean(String(item.address || item.area || item.district || '').trim());
  const hasPrice = hasPublishedPriceOrGuidePrice(item);
  const priceUponApplication = !hasPrice;
  const hasContact = hasAnyPublicContactPath(agent, item);
  const hasImageOrEvidence = Boolean(sourceImageRowsFor(item).length || sourceUrlForItem(item));
  const dateStatus = sourceDateStatusFor(item);
  const preApproval = sourcePreApprovalStatusFor(item);
  const pendingKingSourceReview = !preApproval.preapproved;
  const hasQueuePermission = allowedSocialSource;
  return {
    eligible: hasSource && allowedSocialSource && hasLocation && hasContact && hasImageOrEvidence && dateStatus !== 'before_2026_source_window' && hasQueuePermission,
    has_source_url: hasSource,
    allowed_social_source: allowedSocialSource,
    has_location_or_area: hasLocation,
    has_price_or_guide_price: hasPrice,
    price_upon_application: priceUponApplication,
    price_status: hasPrice ? 'published_price_or_guide_price' : 'price_upon_application',
    price_label: sourcePriceLabelFor(item),
    has_contact_path: hasContact,
    has_image_or_source_evidence: hasImageOrEvidence,
    date_status: dateStatus,
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
  <text x="82" y="90" font-family="Arial, sans-serif" font-size="43" font-weight="800" fill="#ffffff">makaug.com | found-online source evidence</text>
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
  return `USh ${Number(value || 0).toLocaleString('en-UG')}`;
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
  <text x="92" y="90" font-family="Arial, sans-serif" font-size="44" font-weight="800" fill="#ffffff">makaug.com | land size guide</text>
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
    : ` The source did not publish a price, so makaug shows ${PRICE_UPON_APPLICATION_LABEL} until the source confirms it.`;
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
  const steps = [
    'Confirm the exact source post/listing was first published on or after 1 January 2026',
    'Confirm the agent/source still wants this exact listing live on makaug.com',
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
  const imageRows = listingImageRowsFor(item);
  const generatedSupportImageRows = imageRows.filter((image) => /^data:image\//i.test(image.url));
  const sourcePublishedAt = sourcePublishedAtFor(item);
  const sourcePublishedLabel = sourcePublishedLabelFor(item);
  const sourceDateStatus = sourceDateStatusFor(item);
  const preApproval = sourcePreApprovalStatusFor(item);
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
    source_platform: sourcePlatform,
    source_type: item.sourceType || item.source_type || 'found_online_source_post',
    source_name: agent.name || '',
    source_agent_name: agent.name || '',
    source_url: sourceUrl,
    source_post_url: sourceUrl,
    source_title: item.sourceTitle || item.title || '',
    source_caption: item.caption || item.raw_source_post?.caption || item.rawSourcePost?.caption || '',
    source_description: item.description || '',
    source_text: item.sourceText || item.raw_source_post?.source_text || item.rawSourcePost?.source_text || '',
    source_comments: item.raw_source_post?.comments || item.rawSourcePost?.comments || item.comments || '',
    source_visual_text: item.sourceVisualText || item.source_visual_text || item.raw_source_post?.source_visual_text || item.rawSourcePost?.source_visual_text || '',
    video_ocr_text: item.sourceVisualText || item.source_visual_text || item.raw_source_post?.video_ocr_text || item.rawSourcePost?.video_ocr_text || '',
    frame_ocr_text: item.raw_source_post?.frame_ocr_text || item.rawSourcePost?.frame_ocr_text || '',
    source_post_window_start: LAUNCH_SOURCE_POST_WINDOW_START,
    source_post_date_status: sourceDateStatus,
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
    added_to_makaug_at: SOCIAL_SEARCH_ADDED_TO_MAKAUG_AT,
    added_to_makaug_label: 'Added to makaug source review on 20 May 2026',
    source_followers_label: agent.audienceLabel || 'Audience count to confirm from source',
    source_audience_label: agent.audienceLabel || 'Audience count to confirm from source',
    source_contact_url: sourceContactUrl,
    source_contact_label: sourceContactLabel,
    source_contact_method: sourceContactMethod,
    source_contact_platform: sourcePlatform,
    source_contact_available_without_phone: sourceContactAvailableWithoutPhone,
    public_contact_path_available: hasAnyPublicContactPath(agent, item),
    social_source_trust_review: trustReview,
    social_source_trust_score: trustReview.score,
    social_source_trust_level: trustReview.level,
    source_no_phone_policy: PUBLIC_SOURCE_CONTACT_POLICY,
    price_label: sourcePriceLabelFor(item),
    source_price_label: sourcePriceLabelFor(item),
    price_upon_application: !hasPublishedPriceOrGuidePrice(item),
    price_status: hasPublishedPriceOrGuidePrice(item) ? 'published_price_or_guide_price' : 'price_upon_application',
    source_price_policy: 'If the public social source does not publish a price, makaug shows Price upon application and King confirms the price during review/follow-up.',
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
    area_highlights: `${item.area} is a practical Uganda property search area with access to local roads, schools, health facilities, shops, and daily services. Confirm the exact property pin with the listing agent before approval.`,
    nearby_facilities: nearby.map(([name, type, distanceKm]) => ({ name, type, distanceKm })),
    source_labels: ['found online', sourcePlatformFeedLabel(sourcePlatform), '2026+ social-only intake', sourceContactLabel],
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
    `${item.title} is prepared on makaug.com for King review as a found-online authorised listing.`,
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
  const listingType = item.listingType || 'sale';
  return {
    listing_type: listingType,
    title: item.title,
    description: publicDescriptionFor(item),
    district: item.district,
    area: item.area,
    address: item.address,
    price: Number(item.price || 0) > 0 ? item.price : null,
    price_period: item.price_period || item.pricePeriod || 'once',
    bedrooms: item.beds,
    bathrooms: item.baths,
    property_type: item.subtype,
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
    nearest_university: null,
    distance_to_uni_km: null,
    room_type: null,
    room_arrangement: null,
    commercial_intent: null,
    latitude: item.lat,
    longitude: item.lng,
    students_welcome: false,
    verification_terms_accepted: false,
    inquiry_reference: buildListingReference(),
    id_number: null,
    id_document_name: null,
    id_document_url: null,
    new_until: new Date(Date.now() + (30 * 24 * 60 * 60 * 1000)),
    amenities: JSON.stringify(item.listingType === 'land'
      ? ['Found online', 'Road access to verify', 'Title to verify', 'Agent follow-up required']
      : ['Found online', `${sourcePlatformFor(agent, item)} source evidence`, 'Agent follow-up required', 'HD photos to verify']),
    extra_fields: JSON.stringify(extraFieldsFor(item, agentId)),
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
    moderation_notes: `${item.importedFromSourcePost ? 'FOUND-ONLINE SOURCE POST IMPORT' : 'SOCIAL SEARCH LISTING'}. Public source inventory from ${agent.name || 'source'}. Source post: ${sourceUrlForItem(item)}. Confirm it was first posted on or after 1 January 2026, then confirm location, availability, and price or Price upon application. Location is non-negotiable; other source-review checks can be overridden by King. Batch: ${itemBatchId(item)}.`,
    moderation_reason: 'Pending King review of public found-online source, exact pin, latest availability, and image/source evidence.',
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
  const inserted = await client.query(
    `INSERT INTO properties (
      listing_type, title, description, district, area, address, price, price_period,
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
      $31,$32,$33,$34,$35,$36::jsonb,$37::jsonb,$38,$39,$40,
      $41,$42,$43,$44,$45,$46,$47,$48,$49,$50,$51
    ) RETURNING id::text AS id`,
    [
      listing.listing_type, listing.title, listing.description, listing.district,
      listing.area, listing.address, listing.price, listing.price_period,
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
    ) VALUES ($1, $2, $3, NULL, 'pending', $4::jsonb, $5, $6, $7::jsonb)`,
    [
      propertyId,
      'social_search_authorised_seed',
      'social_search_authorised_listing_created',
      JSON.stringify({
        found_online_candidate: true,
        social_search_candidate: true,
        found_online: true,
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

function parseMoneyValue(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  const raw = String(value || '').toLowerCase().replace(/,/g, '').trim();
  const match = raw.match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  const multiplier = /\d(?:\.\d+)?\s*(b|bn|billions?)\b/.test(raw)
    ? 1000000000
    : /\d(?:\.\d+)?\s*(m|mn|millions?)\b/.test(raw)
      ? 1000000
      : /\d(?:\.\d+)?\s*(k|thousands?)\b/.test(raw)
        ? 1000
        : 1;
  if (/^(?:\$|us\$|usd)\s*\d/.test(raw)) return Math.round(amount * multiplier * USD_TO_UGX_GUIDE_RATE);
  if (/\d(?:\.\d+)?\s*(b|bn|billions?)\b/.test(raw)) return Math.round(amount * 1000000000);
  if (/\d(?:\.\d+)?\s*(m|mn|millions?)\b/.test(raw)) return Math.round(amount * 1000000);
  if (/\d(?:\.\d+)?\s*(k|thousands?)\b/.test(raw)) return Math.round(amount * 1000);
  return Math.round(amount);
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeUgandanPublicPhone(value = '') {
  const digits = String(value || '').replace(/\D/g, '');
  if (/^2567\d{8}$/.test(digits)) return `+${digits}`;
  if (/^07\d{8}$/.test(digits)) return `+256${digits.slice(1)}`;
  if (/^7\d{8}$/.test(digits)) return `+256${digits}`;
  return '';
}

function publicPhoneFromText(text = '') {
  const candidates = String(text || '').match(/(?:\+?256|0|7)\s*[\d\s().-]{7,14}\d/g) || [];
  for (const candidate of candidates) {
    const normalized = normalizeUgandanPublicPhone(candidate);
    if (normalized) return normalized;
  }
  return '';
}

function publicEmailFromText(text = '') {
  const match = String(text || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0] : '';
}

function normalizeFoundOnlineListingType(value = '') {
  const raw = String(value || '').toLowerCase();
  const hasDwelling = /\b(apartment|flat|house|home|villa|mansion|duplex|bungalow|bedroom|bedrooms|beds?|living room|sitting room)\b/.test(raw);
  if (raw.includes('rent') || raw.includes('rental') || raw.includes('let')) return 'rent';
  if (raw.includes('student') || raw.includes('hostel') || raw.includes('campus')) return 'students';
  if (raw.includes('commercial') || raw.includes('shop') || raw.includes('office') || raw.includes('warehouse')) return 'commercial';
  if (hasDwelling && (raw.includes('sale') || raw.includes('selling') || raw.includes('buy'))) return 'sale';
  if ((raw.includes('land') || raw.includes('plot') || raw.includes('acre') || raw.includes('decimal') || raw.includes('mailo')) && !hasDwelling) return 'land';
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
  const areaPin = socialAreaPinFromText(`${rawArea} ${sourceText}`);
  const fallbackDistrict = compactText(raw.district || sourceDistricts[0] || raw.city || raw.region || '');
  const district = areaPin?.district || fallbackDistrict || 'Kampala';
  const area = areaPin && (!rawArea || /^(kampala|wakiso|hoima|greater kampala|uganda)$/i.test(rawArea))
    ? areaPin.name
    : (rawArea || areaPin?.name || district);
  const address = String(raw.address || raw.location_label || raw.location || (area && district ? `${area}, ${district}` : area || district)).trim();
  const listingType = normalizeFoundOnlineListingType(raw.listing_type || raw.listingType || raw.property_type || raw.category || raw.title || raw.description);
  const title = String(raw.title || raw.source_title || raw.caption || `${listingType === 'land' ? 'Land' : 'Property'} in ${area}`).trim();
  const baseDescription = compactText(raw.description || raw.caption || raw.summary || title);
  const description = compactText([
    baseDescription,
    sourceVisualText ? `Visible video/still text adds: ${sourceVisualText}` : '',
  ].filter(Boolean).join(' '));
  const youtubeId = raw.youtube_id || raw.youtubeId || raw.youtube_video_id || raw.youtubeVideoId || youtubeIdFromUrl(sourceUrl);
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
    districts: asTextArray(raw.districts || district || 'Uganda'),
    specializations: asTextArray(raw.specializations || [listingType]),
    profilePhotoUrl: raw.profile_photo_url || raw.avatar_url || null,
    bio: raw.source_bio || `Public ${platform} source imported for makaug found-online launch intake.`,
    audienceLabel: raw.audience_label || raw.followers_label || raw.source_followers_label || '',
  };
  return {
    key: postKey,
    agentKey: sourceKey,
    sourceAgent,
    sourceBatch: raw.source_batch || FOUND_ONLINE_SOURCE_POST_IMPORT_BATCH_ID,
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
    sourceContactUrl: raw.source_contact_url || raw.contact_url || sourceAgent.channelUrl || sourceUrl,
    sourcePlatform: platform,
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
    area,
    district,
    address,
    price: parseMoneyValue(raw.price ?? raw.guide_price ?? raw.price_text ?? raw.asking_price),
    priceText: raw.price_text || raw.price_label || '',
    price_period: raw.price_period || raw.pricePeriod || raw.period || ((listingType === 'rent' || listingType === 'students' || listingType === 'commercial') ? 'month' : 'once'),
    listingType,
    subtype: raw.subtype || raw.property_type || null,
    beds: numberOrNull(raw.bedrooms ?? raw.beds),
    baths: numberOrNull(raw.bathrooms ?? raw.baths),
    landSizeValue: numberOrNull(raw.land_size_value ?? raw.landSizeValue),
    landSizeUnit: raw.land_size_unit || raw.landSizeUnit || null,
    lat: numberOrNull(raw.latitude ?? raw.lat) ?? areaPin?.lat ?? null,
    lng: numberOrNull(raw.longitude ?? raw.lng) ?? areaPin?.lng ?? null,
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
  };
}

async function existingFoundOnlineSourcePostListings(client, items = []) {
  const keys = items.map((item) => item.key).filter(Boolean);
  const urls = uniqueUrls(items.map((item) => sourceUrlForItem(item)));
  if (!keys.length && !urls.length) return new Map();
  const result = await client.query(
    `SELECT
       id::text AS id,
       title,
       status,
       moderation_stage,
       inquiry_reference,
       lister_name,
       extra_fields->>'source_listing_key' AS source_listing_key,
       extra_fields->>'source_post_url' AS source_post_url,
       extra_fields->>'source_url' AS source_url
     FROM properties
     WHERE source IN ($1, $4)
       AND COALESCE(status, '') <> 'deleted'
       AND (
         extra_fields->>'source_listing_key' = ANY($2::text[])
         OR extra_fields->>'source_post_url' = ANY($3::text[])
         OR extra_fields->>'source_url' = ANY($3::text[])
       )`,
    [SOCIAL_SEARCH_SOURCE, keys, urls, LEGACY_SOURCED_INVENTORY_CANDIDATE_SOURCE]
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
  }
  return existing;
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
             THEN '256' || SUBSTRING(phone_digits FROM 2)
           WHEN LENGTH(phone_digits) = 9 AND phone_digits ~ '^[37]'
             THEN '256' || phone_digits
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
  const evaluated = items.map((item) => ({
    item,
    agent: sourceAgentForItem(item),
    intake: sourcePostMeetsLaunchIntakeRule(item, sourceAgentForItem(item)),
  }));
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
      reason: 'missing_2026_launch_intake_evidence',
      intake,
    }));

  if (dryRun) {
    const eligible = evaluated.filter(({ intake }) => intake.eligible);
    return {
      ok: true,
      dry_run: true,
      received_posts: Array.isArray(posts) ? posts.length : 0,
      normalized_posts: items.length,
      eligible_to_queue_count: eligible.length,
      source_review_count: sourceReviewRecords.length,
      created_properties: 0,
      existing_properties: 0,
      review_queue_properties: eligible.length,
      queued_listings: eligible.map(({ item, agent }) => ({
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
        dry_run: true,
      })),
      source_review_records: sourceReviewRecords,
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
    existingContactCounts = await existingFoundOnlineContactCounts(client, items);
    const agentIdsByKey = {};
    const created = [];
    const alreadyPresent = [];
    const skippedListings = [...sourceReviewRecords];

    for (const { item, agent, intake } of evaluated) {
      const sourceUrl = sourceUrlForItem(item);
      const existingRow = existing.get(item.key) || existing.get(sourceUrl);
      if (existingRow) {
        alreadyPresent.push({
          key: item.key,
          id: existingRow.id,
          title: existingRow.title,
          agent_key: item.agentKey,
          agent_name: existingRow.lister_name || agent.name || item.agentKey,
          status: existingRow.status || '',
          moderation_stage: existingRow.moderation_stage || '',
          property_url: existingRow.property_url || '',
          source_url: sourceUrl,
          reason: 'already_queued',
          already_present: true,
        });
        continue;
      }
      if (!intake.eligible) continue;
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
    }

    await client.query('COMMIT');
    const duplicateWarnings = alreadyPresent.map((item) => ({
      type: 'exact_source_url_duplicate',
      message: 'This exact social/source link has already been imported to makaug.',
      key: item.key,
      id: item.id,
      title: item.title,
      status: item.status || '',
      moderation_stage: item.moderation_stage || '',
      property_url: item.property_url || '',
      source_url: item.source_url || '',
      agent_name: item.agent_name || '',
    }));
    const reviewQueueListings = [
      ...created,
      ...alreadyPresent.map((item) => ({
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
    return {
      ok: true,
      dry_run: false,
      received_posts: Array.isArray(posts) ? posts.length : 0,
      normalized_posts: items.length,
      eligible_to_queue_count: evaluated.filter(({ intake }) => intake.eligible).length,
      created_properties: created.length,
      existing_properties: alreadyPresent.length,
      review_queue_properties: reviewQueueListings.length,
      queued_listings: reviewQueueListings,
      already_present_properties: alreadyPresent,
      duplicate_warning_count: duplicateWarnings.length,
      duplicate_warnings: duplicateWarnings,
      duplicate_source_url_records: duplicateWarnings,
      source_review_count: skippedListings.length,
      source_review_records: skippedListings,
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
          reason: 'missing_2026_launch_intake_evidence',
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
  normalizeFoundOnlineSourcePost,
  summarizeSocialSearchListings,
  socialSearchDailyTargetStatus,
  sourcePostMeetsLaunchIntakeRule,
  sourceUrlForItem,
  sourceImageRowsFor,
  whatsappShareMessage,
};
