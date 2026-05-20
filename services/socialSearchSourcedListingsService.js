const { buildListingReference } = require('./listingReferenceService');
const {
  createOwnerEditToken,
  getOwnerPreviewUrl,
  hashOwnerEditToken,
  ownerEditTokenExpiry,
} = require('./listingModerationService');
const { SOURCE } = require('../scripts/seed-sourced-inventory-candidates');

const SOCIAL_SEARCH_BATCH_ID = 'social_search_authorised_20260520';
const SOCIAL_SEARCH_SOURCE = SOURCE;

const SOCIAL_SEARCH_AGENTS = [
  {
    key: 'lady-property-agent-ug',
    name: 'Lady Property Agent UG',
    company: 'Lady Property Agent UG',
    licence: 'SOCIAL-LADY-PROPERTY-AGENT-UG-20260520',
    phone: '+256787120739',
    email: null,
    channelUrl: 'https://www.youtube.com/@Ladypropertyagentug',
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
    profilePhotoUrl: 'https://yt3.googleusercontent.com/bO2ClW0VsbnRPGeMFROGTfNfwzK7NsFwSNcfNx7XWNVAWSES4_9kAWxFGOzo0UtHVByDuJ4INGE=s900-c-k-c0x00ffffff-no-rj',
    districts: ['Kampala', 'Wakiso'],
    specializations: ['Homes for sale', 'Apartment blocks', 'Video tours'],
    bio: 'EZRA HOMES UG shares Uganda houses and apartment blocks for sale through public video tours. Listings here are prepared as found-online sourced candidates for King review.',
  },
  {
    key: 'empire-property-ug',
    name: 'Empire Property UG',
    company: 'Empire Property Realty & Property Management',
    licence: 'SOCIAL-EMPIRE-PROPERTY-UG-20260520',
    phone: null,
    email: null,
    channelUrl: 'https://www.youtube.com/@EmpirepropertyUG',
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
    profilePhotoUrl: '',
    districts: ['Kampala', 'Wakiso'],
    specializations: ['Homes for sale', 'Dream home search', 'Local property matching'],
    bio: 'Dream Home Real Estate helps buyers find homes around Greater Kampala. The profile is prepared from founder-provided channel information; no property record is auto-created until a specific recent video gives enough price and location evidence.',
  },
  {
    key: 'realtor-mahad',
    name: 'Realtor Mahad',
    company: 'Realtor Mahad',
    licence: 'SOCIAL-REALTOR-MAHAD-20260520',
    phone: '+256789906044',
    email: null,
    channelUrl: 'https://www.youtube.com/@realtormahad',
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

function agentHasPublicContact(agent = {}) {
  return Boolean(String(agent.phone || agent.email || agent.website || '').trim());
}

function youtubeUrl(id) {
  return `https://www.youtube.com/watch?v=${id}`;
}

const DEFAULT_SOCIAL_SOURCE_IMAGE_FRAMES = [
  { file: 'hqdefault.jpg', label: 'Source video still - primary view', primary: true },
  { file: '1.jpg', label: 'Source video still - supporting view', primary: false },
  { file: '2.jpg', label: 'Source video still - additional view', primary: false },
];

function youtubeImageRowsFor(item) {
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

function money(value) {
  return `USh ${Number(value || 0).toLocaleString('en-UG')}`;
}

function publicDescriptionFor(item = {}) {
  return String(item.description || '')
    .replace(/\s*Confirm[^.?!]*(?:before\s+(?:public\s+)?approval)\.?/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function reviewSteps(item = {}) {
  const steps = [
    'Confirm the agent still wants this exact listing live on makaug.com',
    'Confirm current availability and guide price before approval',
    'Confirm the exact road/map pin and update it if the agent gives a better pin',
    'Confirm title/ownership evidence or broker authority before public approval',
    'Keep only differentiated, evidence-based source images; upload direct HD agent photos when supplied',
  ];
  if (item.listingType === 'land') {
    steps.push('Confirm plot size, boundaries, access road, and title tenure before approval');
  } else {
    steps.push('Confirm bedroom, bathroom, parking, and land-size details before approval');
  }
  return steps;
}

function extraFieldsFor(item, agentId = null, propertyUrl = '', ownerPreviewUrl = '') {
  const agent = agentByKey(item.agentKey) || {};
  const sourceUrl = youtubeUrl(item.youtubeId);
  const nearby = NEARBY[item.nearbyKey] || [];
  const imageRows = youtubeImageRowsFor(item);
  return {
    sourced_inventory_candidate: true,
    social_search_candidate: true,
    found_online: true,
    source_badge: 'found_online',
    source_batch: SOCIAL_SEARCH_BATCH_ID,
    source_listing_key: item.key,
    source_registry_key: agent.key || item.agentKey || '',
    source_platform: 'YouTube',
    source_type: 'social_video_channel',
    source_name: agent.name || '',
    source_url: sourceUrl,
    first_seen_online_at: '2026-05-20T00:00:00.000Z',
    first_seen_online_label: 'First seen by makaug source watch on 20 May 2026',
    original_publish_date_status: 'King review should confirm the exact platform publish date before approval.',
    source: SOCIAL_SEARCH_SOURCE,
    agent_permission_reported: true,
    permission_status: 'founder_reported_agent_authorised_upload',
    consent_required: false,
    consent_confirmed: true,
    image_rights_confirmed: true,
    image_rights_status: 'authorised_public_social_video_thumbnail_from_agent_channel',
    image_evidence_policy: 'Use a minimum of 3 source images only when they are distinct enough to review. Do not invent room labels or duplicate uncertain stills; upload HD agent images when available.',
    minimum_reliable_image_count: 3,
    owner_or_agent_name: agent.name,
    public_display_name: agent.name,
    lister_registration_status: 'registered',
    broker_agent_id: agentId,
    broker_submission: true,
    contact_source_status: 'founder_confirmed_and_public_youtube_channel',
    contact_phone_alt: agent.phoneAlt || '',
    website: agent.website || '',
    youtube_channel_url: agent.channelUrl || '',
    video_url: sourceUrl,
    youtube_url: sourceUrl,
    youtube_video_id: item.youtubeId,
    youtube_source_title: item.sourceTitle,
    youtube_source_published_label: 'Latest public Shorts feed checked on 20 May 2026; King review should confirm exact publish date before approval.',
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
    source_labels: ['found online', 'public YouTube Shorts feed', 'founder reported agent permission'],
    source_urls: [agent.channelUrl, sourceUrl].filter(Boolean),
    photo_source_urls: imageRows.map((image) => image.url),
    authorised_photo_urls: imageRows.map((image) => image.url),
    property_url_status: 'public_after_approval',
    property_url: propertyUrl || '',
    owner_preview_url: ownerPreviewUrl || '',
    whatsapp_share_card: propertyUrl ? whatsappShareMessage(item, propertyUrl, ownerPreviewUrl) : '',
    review_required_steps: reviewSteps(item),
  };
}

function whatsappShareMessage(item, propertyUrl, ownerPreviewUrl = '') {
  const agent = agentByKey(item.agentKey) || {};
  return [
    `Hi, this is ${agent.name || 'the listing agent'}.`,
    `${item.title} is prepared on makaug.com for King review as a found-online authorised listing.`,
    `Location: ${item.address}`,
    item.price ? `Guide price: ${money(item.price)}.` : '',
    `Source video: ${youtubeUrl(item.youtubeId)}`,
    ownerPreviewUrl ? `Private preview: ${ownerPreviewUrl}` : '',
    `Public link after approval: ${propertyUrl}`,
    agent.phone ? `Call/WhatsApp: ${agent.phone}${agent.phoneAlt ? ` / ${agent.phoneAlt}` : ''}` : '',
  ].filter(Boolean).join('\n');
}

function buildSocialSearchListing(item, agentId = null) {
  const listingType = item.listingType || 'sale';
  return {
    listing_type: listingType,
    title: item.title,
    description: publicDescriptionFor(item),
    district: item.district,
    area: item.area,
    address: item.address,
    price: item.price,
    price_period: 'once',
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
      : ['Found online', 'Video tour source', 'Agent follow-up required', 'HD photos to verify']),
    extra_fields: JSON.stringify(extraFieldsFor(item, agentId)),
    lister_name: agentByKey(item.agentKey)?.name || 'Social Search Sourcing Desk',
    lister_phone: agentByKey(item.agentKey)?.phone || null,
    lister_email: agentByKey(item.agentKey)?.email || null,
    lister_type: 'agent',
    agent_id: agentId,
    source: SOCIAL_SEARCH_SOURCE,
    listed_via: 'sourced_inventory',
    status: 'pending',
    moderation_stage: 'submitted',
    reviewed_at: null,
    moderation_notes: `SOCIAL SEARCH AUTHORISED LISTING. Founder reported permission to load ${agentByKey(item.agentKey)?.name || 'agent'} public social inventory. Source video: ${youtubeUrl(item.youtubeId)}. Confirm exact publish date, availability, price, pin, and image rights before approval. Batch: ${SOCIAL_SEARCH_BATCH_ID}.`,
    moderation_reason: 'Pending King review of public social source, exact pin, latest availability, and sourced candidate approval override.',
    images: youtubeImageRowsFor(item),
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
     WHERE source = $1
       AND extra_fields->>'source_batch' = $2
     RETURNING id`,
    [SOCIAL_SEARCH_SOURCE, SOCIAL_SEARCH_BATCH_ID]
  );
  return { properties: deleted.rowCount };
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
        sourced_inventory_candidate: true,
        social_search_candidate: true,
        found_online: true,
        consent_confirmed: true,
        image_rights_confirmed: true,
        source_batch: SOCIAL_SEARCH_BATCH_ID,
        youtube_url: youtubeUrl(listing.source_item.youtubeId),
      }),
      listing.moderation_reason,
      listing.moderation_notes,
      JSON.stringify({
        batch_id: SOCIAL_SEARCH_BATCH_ID,
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
    youtube_url: youtubeUrl(listing.source_item.youtubeId),
    agent_name: listing.lister_name,
    whatsapp_share_card: whatsappShareMessage(listing.source_item, propertyUrl, ownerPreviewUrl),
  };
}

async function seedSocialSearchAuthorisedListings({ db, replace = true } = {}) {
  if (!db?.pool) throw new Error('db.pool is required');
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const agentIdsByKey = {};
    const skippedAgents = [];
    for (const agent of SOCIAL_SEARCH_AGENTS) {
      if (!agentHasPublicContact(agent)) {
        skippedAgents.push({
          key: agent.key,
          name: agent.name,
          reason: 'missing_public_phone_email_or_website',
        });
        continue;
      }
      agentIdsByKey[agent.key] = await upsertSocialAgent(client, agent);
    }
    const cleanup = replace ? await cleanupSocialSearchBatch(client) : null;
    const created = [];
    const skippedListings = [];
    for (const item of SOCIAL_SEARCH_LISTINGS) {
      if (!agentIdsByKey[item.agentKey]) {
        skippedListings.push({
          key: item.key,
          title: item.title,
          agent_key: item.agentKey,
          reason: 'agent_missing_public_contact',
        });
        continue;
      }
      const listing = buildSocialSearchListing(item, agentIdsByKey[item.agentKey]);
      created.push(await insertListing(client, listing, agentIdsByKey[item.agentKey]));
    }
    await client.query('COMMIT');
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
      })),
      skipped_agents: skippedAgents,
      skipped_listings: skippedListings,
      created_properties: created.length,
      by_type: created.reduce((acc, item) => {
        const original = SOCIAL_SEARCH_LISTINGS.find((listing) => listing.youtubeId === item.youtube_url.split('v=')[1]);
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

function summarizeSocialSearchListings() {
  const listings = plannedSocialSearchListings();
  const eligibleAgentKeys = new Set(SOCIAL_SEARCH_AGENTS.filter(agentHasPublicContact).map((agent) => agent.key));
  const seedEligibleListings = SOCIAL_SEARCH_LISTINGS.filter((item) => eligibleAgentKeys.has(item.agentKey));
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
    agents_count: SOCIAL_SEARCH_AGENTS.length,
    seed_eligible_count: seedEligibleListings.length,
    skipped_until_public_contact_count: SOCIAL_SEARCH_LISTINGS.length - seedEligibleListings.length,
    by_agent: byAgent,
    by_type: byType,
    batch_id: SOCIAL_SEARCH_BATCH_ID,
    samples: listings.slice(0, 8).map((listing) => ({
      title: listing.title,
      area: listing.area,
      district: listing.district,
      price: listing.price,
      source_url: youtubeUrl(listing.source_item.youtubeId),
      images: listing.images.length,
    })),
  };
}

module.exports = {
  SOCIAL_SEARCH_BATCH_ID,
  SOCIAL_SEARCH_SOURCE,
  SOCIAL_SEARCH_AGENTS,
  SOCIAL_SEARCH_LISTINGS,
  plannedSocialSearchListings,
  seedSocialSearchAuthorisedListings,
  summarizeSocialSearchListings,
  whatsappShareMessage,
};
