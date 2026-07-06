const assert = require('assert');
const path = require('path');

const {
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

  const sql = sourceQualitySuppressedSql('p');
  assert(sql.includes('building[[:space:]]+permit'), 'SQL suppression should include building permit keyword');
  assert(sql.includes('how[[:space:]]+big[[:space:]]+is'), 'SQL suppression should include plot-size explainer keyword');
  assert(sql.includes('sameblood'), 'SQL suppression should include known source keyword');
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
