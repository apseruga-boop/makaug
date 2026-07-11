const assert = require('assert');
const path = require('path');

const {
  sourceLocationQualityForRecord,
  sourcePositiveListingGateForRecord,
  sourceQualitySuppressionForRecord,
  sourceQualitySuppressedSql,
} = require('../utils/sourceContentQuality');
const seedModulePath = require.resolve(path.join('..', 'scripts', 'seed-sourced-inventory-candidates'));
require.cache[seedModulePath] = {
  id: seedModulePath,
  filename: seedModulePath,
  loaded: true,
  exports: { SOURCE: 'seed_sourced_inventory_candidates' },
};
const {
  queueFoundOnlineSourcePostListings,
} = require('../services/socialSearchSourcedListingsService');

async function run() {
  const daWinci = sourceQualitySuppressionForRecord({
    title: 'How To Apply For a Building Permit Online | Building Regulations',
    source_name: 'DaWinCi Design & Construction',
    description: 'Step by step construction guide for Uganda',
  });
  assert.strictEqual(daWinci.suppressed, true, 'DaWinCi building permit guide should be suppressed');
  assert.strictEqual(daWinci.reason, 'non_listing_tutorial_or_construction_content');

  const sameblood = sourceQualitySuppressionForRecord({
    title: 'Plumbing #pipework Material Costs for a simple house',
    source_name: 'sameblood Media',
    description: 'Construction material cost breakdown',
  });
  assert.strictEqual(sameblood.suppressed, true, 'sameblood construction cost video should be suppressed');

  const samebloodPlotSize = sourceQualitySuppressionForRecord({
    title: 'How big is your 50ft by 100ft Plot of land?',
    source_name: 'sameblood Media',
    description: 'Educational plot-size explainer, not a property for sale',
  });
  assert.strictEqual(samebloodPlotSize.suppressed, true, 'sameblood plot-size explainer should be suppressed');

  const entebbeSale = sourceQualitySuppressionForRecord({
    title: 'What 380m ugx gets you on Entebbe rd',
    source_name: 'UGANDA YAFFEE PROPERTIES',
    description: 'A house showcase for sale on Entebbe Road, UGX 380M',
  });
  assert.strictEqual(entebbeSale.suppressed, false, 'real price/location listing should remain reviewable');
  assert.strictEqual(
    sourceLocationQualityForRecord({
      title: 'What 380m ugx gets you on Entebbe rd',
      area: 'Kampala',
      district: 'Kampala',
      description: 'A house showcase for sale on Entebbe Road, UGX 380M',
    }).ok,
    true,
    'Entebbe Road should count as a usable corridor even when the captured area is broad'
  );

  const kasangatiLand = sourceQualitySuppressionForRecord({
    title: 'Kasangati Mawule on Half an Acre at 450m ugx very Negotiable',
    source_name: 'UGANDA YAFFEE PROPERTIES',
    description: 'Land for sale around Kasangati, Wakiso',
  });
  assert.strictEqual(kasangatiLand.suppressed, false, 'specific priced land listing should remain reviewable');

  const kiwatuleLand = sourceQualitySuppressionForRecord({
    title: 'SIX PLOTS IN KIWATULE UGX 250M',
    source_name: 'ALOSIUS PROPERTIES',
    description: 'Land plots for sale in Kiwatule, Kampala',
  });
  assert.strictEqual(kiwatuleLand.suppressed, false, 'real land listing should remain reviewable');

  const clickbaitDistrictOnly = sourceQualitySuppressionForRecord({
    title: 'I NEED ONE SERIOUS CUSTOMER TO TAKE THIS BEAUTIFUL HOUSE',
    source_name: 'Found online property source',
    area: 'Kampala',
    district: 'Kampala',
    address: 'Kampala',
    price: 130000000,
  });
  assert.strictEqual(clickbaitDistrictOnly.suppressed, true, 'district-only clickbait listings should be hidden from active review');
  assert.strictEqual(clickbaitDistrictOnly.reason, 'low_signal_district_only_promo');

  const kolkataListing = sourceQualitySuppressionForRecord({
    title: 'REAL ESTATE WB KOLKATA 3 BHK flat for sale',
    source_name: 'India Property Updates',
    description: 'Warangal Telugu real estate update, not Uganda property inventory.',
    area: 'Kampala',
    district: 'Kampala',
  });
  assert.strictEqual(kolkataListing.suppressed, true, 'foreign property-market posts should not enter King review');
  assert.strictEqual(kolkataListing.reason, 'foreign_property_market_source');

  const politicsClip = sourcePositiveListingGateForRecord({
    title: 'New Speaker MPs Drama in Parliament',
    description: 'Uganda political news update',
    district: 'Kampala',
  });
  assert.strictEqual(politicsClip.ok, false, 'news/politics clips must not pass the positive listing gate');
  assert.strictEqual(politicsClip.reason, 'not_a_listing');

  const cityVlog = sourcePositiveListingGateForRecord({
    title: 'Kampala City streets on a rainy day',
    description: 'Latest updates from downtown Kampala',
    district: 'Kampala',
  });
  assert.strictEqual(cityVlog.ok, false, 'city vlogs must not pass the positive listing gate');
  assert.strictEqual(cityVlog.reason, 'not_a_listing');

  const foreignTextListing = sourcePositiveListingGateForRecord({
    title: '500,000Rwf Kanombe apartment for rent',
    description: 'Kigali Rwanda apartment update',
    district: '',
  });
  assert.strictEqual(foreignTextListing.ok, false, 'foreign listings without coordinates must not pass the positive listing gate');
  assert.strictEqual(foreignTextListing.reason, 'non_uganda_location');

  const cleanKiraListing = sourcePositiveListingGateForRecord({
    title: '5 bedroom mansion for sale in Kira Kampala Uganda',
    description: 'House for sale with 5 bedrooms and 6 bathrooms',
    district: 'Wakiso',
    area: 'Kira',
    bedrooms: 5,
    latitude: 0.3978,
    longitude: 32.6414,
  });
  assert.strictEqual(cleanKiraListing.ok, true, 'clear Uganda property listings should pass the positive gate');

  const dateOnlyTitle = sourcePositiveListingGateForRecord({
    title: '1 July 2026',
    district: 'Kampala',
    property_type: 'house',
    bedrooms: 3,
    price: 250000000,
  });
  assert.strictEqual(dateOnlyTitle.ok, false, 'date-only imported titles must not pass through extracted property fields');
  assert.strictEqual(dateOnlyTitle.reason, 'not_a_listing');

  const filatomPromo = sourcePositiveListingGateForRecord({
    title: 'Ever wondered what FILATOM means? Find Invest Lease Acquire Trade Own Manage',
    description: 'Early closed testing announcement from a real estate app',
    district: 'Kampala',
    property_type: 'Property',
  });
  assert.strictEqual(filatomPromo.ok, false, 'real-estate app/product promos must not pass as property listings');
  assert.strictEqual(filatomPromo.reason, 'not_a_listing');

  const officeOpeningPromo = sourcePositiveListingGateForRecord({
    title: 'Opening Soon! Our New Kyanja office.',
    district: 'Kampala',
    property_type: 'office',
  });
  assert.strictEqual(officeOpeningPromo.ok, false, 'office-opening promos must not pass as office listings');
  assert.strictEqual(officeOpeningPromo.reason, 'not_a_listing');

  const eastLegonForeignListing = sourcePositiveListingGateForRecord({
    title: 'Sweet 3 Bedroom Home for sale | East Legon Hills | $140,000',
    description: 'Ghana listing',
    district: 'Kampala',
    bedrooms: 3,
  });
  assert.strictEqual(eastLegonForeignListing.ok, false, 'East Legon/Ghana listings must be held even if a Uganda district was defaulted');
  assert.strictEqual(eastLegonForeignListing.reason, 'non_uganda_location');

  const portHarcourtEstate = sourcePositiveListingGateForRecord({
    title: 'Duplex for Sale in Shell Cooperative Estate PH #property',
    district: 'Kampala',
    property_type: 'duplex',
  });
  assert.strictEqual(portHarcourtEstate.ok, false, 'Port Harcourt estate shorthand must not pass via defaulted Uganda district');
  assert.strictEqual(portHarcourtEstate.reason, 'non_uganda_location');

  const indiaHostel = sourcePositiveListingGateForRecord({
    title: 'Students Cafeteria and Hostel Mess Facilities - Usha Martin University, Ranchi, Jharkhand',
    district: 'Kampala',
    property_type: 'hostel',
  });
  assert.strictEqual(indiaHostel.ok, false, 'India hostel/university content must not pass via defaulted Uganda district');
  assert.strictEqual(indiaHostel.reason, 'non_uganda_location');

  const munnarLand = sourcePositiveListingGateForRecord({
    title: 'Land For Sale In Munnar Lakshmi Estate Viripara',
    district: 'Kampala',
    property_type: 'land',
  });
  assert.strictEqual(munnarLand.ok, false, 'Munnar/Kerala land listings must not pass via defaulted Uganda district');
  assert.strictEqual(munnarLand.reason, 'non_uganda_location');

  const southAsianLandUnit = sourcePositiveListingGateForRecord({
    title: 'Prime Investment Opportunity 23 Decimal Residential Land',
    district: 'Kampala',
    property_type: 'land',
  });
  assert.strictEqual(southAsianLandUnit.ok, false, 'South Asian land units such as decimal must hold as foreign');
  assert.strictEqual(southAsianLandUnit.reason, 'non_uganda_location');

  const compactDecimalLandUnit = sourcePositiveListingGateForRecord({
    title: '12decimals Residential Private Mailo land for 230Million',
    district: 'Kampala',
    property_type: 'land',
  });
  assert.strictEqual(compactDecimalLandUnit.ok, false, 'compact decimal land-unit rows must hold under the foreign land-unit gate');
  assert.strictEqual(compactDecimalLandUnit.reason, 'non_uganda_location');

  const sobhaForeignDeveloper = sourcePositiveListingGateForRecord({
    title: '413 Villas at Sobha silver estate',
    district: 'Kampala',
    property_type: 'villa',
  });
  assert.strictEqual(sobhaForeignDeveloper.ok, false, 'Sobha/Dubai-India developer rows must not pass via defaulted Uganda district');
  assert.strictEqual(sobhaForeignDeveloper.reason, 'non_uganda_location');

  const richHomesExplainer = sourcePositiveListingGateForRecord({
    title: 'What Rich Homes Look Like in Uganda Serena Kigo New Rich Neighborhood',
    district: 'Wakiso',
    property_type: 'Property',
  });
  assert.strictEqual(richHomesExplainer.ok, false, 'rich-home explainer/showcase videos must not pass as a specific listing');
  assert.strictEqual(richHomesExplainer.reason, 'not_a_listing');

  const realEstateFuturePromo = sourcePositiveListingGateForRecord({
    title: 'The Future is in Real Estate Cubana Millenium City #propertyinvestment',
    district: 'Kampala',
    property_type: 'estate',
  });
  assert.strictEqual(realEstateFuturePromo.ok, false, 'real-estate investment promos must not pass as specific listings');
  assert.strictEqual(realEstateFuturePromo.reason, 'not_a_listing');

  const kinyarwandaForeignDefault = sourcePositiveListingGateForRecord({
    title: 'REAL ESTATE tubafitiye ibibanza byokumazi nokurikaburimbo nahandi hatandukanye murakaza neza',
    district: 'Kampala',
    property_type: 'land',
  });
  assert.strictEqual(kinyarwandaForeignDefault.ok, false, 'Kinyarwanda foreign/defaulted rows must not pass via a default Uganda district');
  assert.strictEqual(kinyarwandaForeignDefault.reason, 'non_uganda_location');

  const financeComparison = sourcePositiveListingGateForRecord({
    title: 'Treasury bonds vs real estate. Uganda perspective.',
    district: 'Kampala',
    property_type: 'land',
  });
  assert.strictEqual(financeComparison.ok, false, 'finance comparison clips must not pass as listings');
  assert.strictEqual(financeComparison.reason, 'not_a_listing');

  const developmentPlanContent = sourcePositiveListingGateForRecord({
    title: 'A MASTER PHYSICAL DEVELOPMENT PLAN IMPLEMENTED TO DETAIL A DIVE INTO PEARL MARINA ESTATE',
    district: 'Wakiso',
    property_type: 'estate',
  });
  assert.strictEqual(developmentPlanContent.ok, false, 'development-plan explainer content must not pass as a listing');
  assert.strictEqual(developmentPlanContent.reason, 'not_a_listing');

  const scamWarningContent = sourcePositiveListingGateForRecord({
    title: "Don't Buy This House It Has No Road Access It's A Scam",
    district: 'Kampala',
    property_type: 'house',
  });
  assert.strictEqual(scamWarningContent.ok, false, 'scam-warning content must not pass as a listing');
  assert.strictEqual(scamWarningContent.reason, 'not_a_listing');

  const realEstateAdvice = sourcePositiveListingGateForRecord({
    title: 'Investing in real estate in Uganda - Tips #propertylane',
    district: 'Kampala',
    property_type: 'land',
  });
  assert.strictEqual(realEstateAdvice.ok, false, 'real-estate advice/tips clips must not pass as listings');
  assert.strictEqual(realEstateAdvice.reason, 'not_a_listing');

  const realEstateTvSegment = sourcePositiveListingGateForRecord({
    title: 'REAL ESTATE INVESTMENT IN UGANDA - U24 TELEVISION UG',
    district: 'Kampala',
    property_type: 'land',
  });
  assert.strictEqual(realEstateTvSegment.ok, false, 'TV investment segments must not pass as listings');
  assert.strictEqual(realEstateTvSegment.reason, 'not_a_listing');

  const firstTimeInvestorAdvice = sourcePositiveListingGateForRecord({
    title: 'The specified areas to invest in real estate in Uganda as a first time investor',
    district: 'Kampala',
    property_type: 'land',
  });
  assert.strictEqual(firstTimeInvestorAdvice.ok, false, 'first-time investor advice must not pass as a listing');
  assert.strictEqual(firstTimeInvestorAdvice.reason, 'not_a_listing');

  const realEstateJokeShort = sourcePositiveListingGateForRecord({
    title: 'looking for a house in Kampala and you suddenly become a real estate detective #shorts #viral',
    district: 'Kampala',
    property_type: 'house',
  });
  assert.strictEqual(realEstateJokeShort.ok, false, 'joke/shorts content must not pass as a listing');
  assert.strictEqual(realEstateJokeShort.reason, 'not_a_listing');

  const housingExpo = sourcePositiveListingGateForRecord({
    title: 'Uganda Real Estate and Housing Expo',
    district: 'Kampala',
    property_type: 'property',
  });
  assert.strictEqual(housingExpo.ok, false, 'housing expo content must not pass as a listing');
  assert.strictEqual(housingExpo.reason, 'not_a_listing');

  const industryOverview = sourcePositiveListingGateForRecord({
    title: "Uganda's Real Estate Industry Overview",
    district: 'Kampala',
    property_type: 'property',
  });
  assert.strictEqual(industryOverview.ok, false, 'industry overviews must not pass as listings');
  assert.strictEqual(industryOverview.reason, 'not_a_listing');

  const transformationContent = sourcePositiveListingGateForRecord({
    title: 'Real Estate transformation in Kampala',
    district: 'Kampala',
    property_type: 'estate',
  });
  assert.strictEqual(transformationContent.ok, false, 'real-estate transformation content must not pass on estate wording alone');
  assert.strictEqual(transformationContent.reason, 'not_a_listing');

  const realEstateBusinessIdeas = sourcePositiveListingGateForRecord({
    title: 'Sharing ideas on real estate business',
    district: 'Kampala',
    property_type: 'property',
  });
  assert.strictEqual(realEstateBusinessIdeas.ok, false, 'real-estate business idea content must not pass as a listing');
  assert.strictEqual(realEstateBusinessIdeas.reason, 'not_a_listing');

  const bobiWineClip = sourcePositiveListingGateForRecord({
    title: 'Bobi wine is hiding at his friends house in makindye',
    district: 'Kampala',
    property_type: 'house',
  });
  assert.strictEqual(bobiWineClip.ok, false, 'political clips mentioning a house must not pass as listings');
  assert.strictEqual(bobiWineClip.reason, 'not_a_listing');

  const kasokosoLandPolitics = sourcePositiveListingGateForRecord({
    title: "GOVERNMENT DOESN'T OWN LAND. THE PEOPLE OF KASOKOSO WERE GIVEN HOT AIR - COUNSEL BWANIKA",
    district: 'Kampala',
    property_type: 'land',
  });
  assert.strictEqual(kasokosoLandPolitics.ok, false, 'political land-rights clips must not pass as listings');
  assert.strictEqual(kasokosoLandPolitics.reason, 'not_a_listing');

  const publicHealthClip = sourcePositiveListingGateForRecord({
    title: 'We fight Ebola together. century Property Real estate has a plot of 1million 50by50.',
    district: 'Kampala',
    property_type: 'land',
  });
  assert.strictEqual(publicHealthClip.ok, false, 'public-health/news-framed clips must not pass as listings');
  assert.strictEqual(publicHealthClip.reason, 'not_a_listing');

  const dryBlocked = await queueFoundOnlineSourcePostListings({
    dryRun: true,
    posts: [{
      source_url: 'https://www.youtube.com/watch?v=samebloodRoofing001',
      source_contact_url: 'https://www.youtube.com/@samebloodmedia',
      source_name: 'sameblood Media',
      platform: 'YouTube',
      title: 'Material Cost for Simple 2 bedroom house #Roofing',
      description: 'Roofing material costs in Uganda',
      area: 'Kampala',
      district: 'Kampala',
      published_at: '2026-06-15T00:00:00.000Z',
    }],
  });
  assert.strictEqual(dryBlocked.eligible_to_queue_count, 0, 'non-listing construction source should not be eligible');
  assert.strictEqual(dryBlocked.source_quality_suppressed_count, 1, 'non-listing construction source should be counted separately');
  assert.strictEqual(dryBlocked.source_review_records[0].reason, 'non_listing_source_content');

  const dryNewsBlocked = await queueFoundOnlineSourcePostListings({
    dryRun: true,
    posts: [{
      source_url: 'https://www.youtube.com/watch?v=ugandaPoliticsClip',
      source_contact_url: 'https://www.youtube.com/@newsclip',
      source_name: 'Uganda News Clip',
      platform: 'YouTube',
      title: 'New Bill Targets the Leader of the Opposition',
      description: 'Parliament and minister drama from Kampala',
      area: 'Kampala',
      district: 'Kampala',
      published_at: '2026-06-15T00:00:00.000Z',
    }],
  });
  assert.strictEqual(dryNewsBlocked.eligible_to_queue_count, 0, 'news clips should not enter source review as property listings');
  assert.strictEqual(dryNewsBlocked.source_review_records[0].reason, 'not_a_listing');
  assert.strictEqual(dryNewsBlocked.source_review_records[0].intake.positive_listing_gate_passed, false);

  const dryAllowed = await queueFoundOnlineSourcePostListings({
    dryRun: true,
    posts: [{
      source_url: 'https://www.youtube.com/watch?v=6dUcvWuzhiY',
      source_contact_url: 'https://www.youtube.com/@alosiusproperties',
      source_name: 'ALOSIUS PROPERTIES',
      platform: 'YouTube',
      title: 'SIX PLOTS IN KIWATULE UGX 250M',
      description: 'Land plots for sale in Kiwatule, Kampala',
      area: 'Kiwatule',
      district: 'Kampala',
      listing_type: 'land',
      price_text: 'UGX 250M',
      published_at: '2026-06-15T00:00:00.000Z',
    }],
  });
  assert.strictEqual(dryAllowed.eligible_to_queue_count, 1, 'specific land listing should stay eligible');
  assert.strictEqual(dryAllowed.source_quality_suppressed_count, 0, 'specific land listing should not be suppressed');

  const dryDistrictOnlyClickbait = await queueFoundOnlineSourcePostListings({
    dryRun: true,
    posts: [{
      source_url: 'https://www.youtube.com/watch?v=genericClickbait130m',
      source_contact_url: 'https://www.youtube.com/@foundonlineagent',
      source_name: 'Found Online Agent',
      platform: 'YouTube',
      title: 'I NEED ONE SERIOUS CUSTOMER TO TAKE THIS BEAUTIFUL HOUSE',
      description: 'Only serious buyers. Kampala. UGX 130M',
      area: 'Kampala',
      district: 'Kampala',
      address: 'Kampala',
      listing_type: 'sale',
      price_text: 'UGX 130M',
      published_at: '2026-06-15T00:00:00.000Z',
    }],
  });
  assert.strictEqual(dryDistrictOnlyClickbait.eligible_to_queue_count, 0, 'district-only clickbait should not queue');
  assert.strictEqual(dryDistrictOnlyClickbait.low_signal_source_location_count, 1, 'district-only clickbait should be reported separately');
  assert.strictEqual(dryDistrictOnlyClickbait.source_review_records[0].reason, 'low_signal_source_location');
  assert.strictEqual(dryDistrictOnlyClickbait.source_review_records[0].intake.district_only_location, true);

  const dryEntebbeRoad = await queueFoundOnlineSourcePostListings({
    dryRun: true,
    posts: [{
      source_url: 'https://www.youtube.com/watch?v=entebbeRoad380m',
      source_contact_url: 'https://www.youtube.com/@ugandayaffeeproperties',
      source_name: 'UGANDA YAFFEE PROPERTIES',
      platform: 'YouTube',
      title: 'What 380m ugx gets you on Entebbe rd',
      description: 'A real house showcase on Entebbe Road. UGX 380M',
      area: 'Kampala',
      district: 'Kampala',
      listing_type: 'sale',
      price_text: 'UGX 380M',
      published_at: '2026-06-15T00:00:00.000Z',
    }],
  });
  assert.strictEqual(dryEntebbeRoad.eligible_to_queue_count, 1, 'Entebbe Road corridor listings should remain queueable');

  const dryPriceUponApplication = await queueFoundOnlineSourcePostListings({
    dryRun: true,
    posts: [{
      source_url: 'https://www.youtube.com/watch?v=kitendeAffordableHome',
      source_contact_url: 'https://www.youtube.com/@primetimeproperties',
      source_name: 'Primetime Properties',
      platform: 'YouTube',
      title: 'Beautiful Home in Kitende',
      description: 'A specific affordable home around Kitende.',
      area: 'Kitende',
      district: 'Wakiso',
      listing_type: 'sale',
      published_at: '2026-06-15T00:00:00.000Z',
    }],
  });
  assert.strictEqual(dryPriceUponApplication.eligible_to_queue_count, 1, 'specific POA agency listings should still queue');
  assert.strictEqual(dryPriceUponApplication.queued_listings[0].price_label, 'Price upon application');

  const dryLugandaPromo = await queueFoundOnlineSourcePostListings({
    dryRun: true,
    posts: [{
      source_url: 'https://www.tiktok.com/@promo/video/7330000000000000999',
      source_contact_url: 'https://www.tiktok.com/@promo',
      source_name: 'Promo Source',
      platform: 'TikTok',
      title: 'FUUKA LANDLORD LEERO KU SENTE OBUKADDE 40',
      description: 'TUSIGAZAWO PLOT NTONO. Kampala.',
      area: 'Kampala',
      district: 'Kampala',
      listing_type: 'land',
      published_at: '2026-06-15T00:00:00.000Z',
    }],
  });
  assert.strictEqual(dryLugandaPromo.eligible_to_queue_count, 0, 'district-only Luganda promo rows should not queue');
  assert.strictEqual(dryLugandaPromo.source_review_records[0].reason, 'low_signal_source_location');

  const sql = sourceQualitySuppressedSql('p');
  assert(sql.includes('building[[:space:]]+permit'), 'SQL suppression should include building permit keyword');
  assert(sql.includes('how[[:space:]]+big[[:space:]]+is'), 'SQL suppression should include plot-size explainer keyword');
  assert(sql.includes('sameblood'), 'SQL suppression should include known source keyword');
  assert(sql.includes('serious[[:space:]]+customer'), 'SQL suppression should include low-signal promo wording');
  assert(sql.includes('kolkata'), 'SQL suppression should include foreign property-market locations');
  assert(sql.includes('[1-9][[:space:]]*bhk'), 'SQL suppression should include India-style BHK listing labels');
  assert(sql.includes('entebbe[[:space:]]*(road|rd)'), 'SQL suppression should preserve specific Entebbe Road corridor listings');
  assert(!sql.includes('source_text'), 'staff dashboard SQL should not scan large source_text blobs');
  assert(!sql.includes('source_visual_text'), 'staff dashboard SQL should not scan large source_visual_text blobs');
}

run()
  .then(() => {
    console.log('source content quality tests passed');
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
