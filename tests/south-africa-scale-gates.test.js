'use strict';

const assert = require('assert');

process.env.COUNTRY_CODE = 'ZA';
process.env.ZA_CONFIDENCE_AUTO_PUBLISH_ENABLED = 'false';

const { evaluateSouthAfricaAutoPublish } = require('../services/southAfricaAutoPublishPolicyService');
const { buildPilotPlan, selectPilotQueries, PILOT_SCOPE } = require('../services/southAfricaScalePilotService');
const { harvestAutomationEnabled } = require('../utils/harvestFeatureFlags');
const propertiesRoute = require('../routes/properties');

const completeItem = {
  title: 'Three-bedroom family home in Lynnwood',
  source_verified: true,
  source_verification_status: 'official_api_verified',
  canonicalLocationId: 'gauteng:pretoria:lynnwood',
  canonicalLocationLevel: 'suburb',
  locationResolutionStatus: 'canonical_match',
  locationResolutionConfidence: 1,
  price: 1450000,
  priceCurrency: 'ZAR',
  priceOnApplication: false,
  listingType: 'sale',
  categoryConfidence: 'strong',
  dataIntegrity: { ok: true, issue_codes: [], classification: { listing_type: 'sale', confidence: 'strong' } },
  autoPublishDedupePassed: true,
};
const intake = { eligible: true, complete_location: true, data_integrity: completeItem.dataIntegrity };

const held = evaluateSouthAfricaAutoPublish(completeItem, { intake, dedupePassed: true });
assert.equal(held.eligible, true);
assert.equal(held.approved, false);
assert.equal(held.enabled, false);
assert.match(held.reason, /is off/i);

process.env.ZA_CONFIDENCE_AUTO_PUBLISH_ENABLED = 'true';
const enabled = evaluateSouthAfricaAutoPublish(completeItem, { intake, dedupePassed: true });
assert.equal(enabled.eligible, true);
assert.equal(enabled.approved, true);

for (const [name, patch, blocker] of [
  ['POA', { price: 0, priceOnApplication: true }, 'price_on_application'],
  ['ambiguous category', { categoryConfidence: 'weak' }, 'category_not_confident'],
  ['junk title', { title: 'Property in Lynnwood' }, 'junk_or_generic_title'],
  ['unverified source', { source_verified: false, source_verification_status: 'unverified_source' }, 'source_not_verified'],
  ['dedupe not proven', { autoPublishDedupePassed: false }, 'duplicate_check_not_passed'],
  ['risk flagged', { risk_flags: ['suspected_fraud'] }, 'risk_flag_present'],
]) {
  const result = evaluateSouthAfricaAutoPublish({ ...completeItem, ...patch }, {
    intake,
    dedupePassed: name !== 'dedupe not proven',
  });
  assert.equal(result.eligible, false, name);
  assert(result.blockers.includes(blocker), `${name}: ${result.blockers.join(',')}`);
}

const queries = selectPilotQueries();
assert.equal(queries.length, PILOT_SCOPE.query_job_cap);
assert(queries.every((row) => row.province === 'Gauteng'));
assert.deepEqual(new Set(queries.map((row) => row.platform)), new Set(['facebook', 'tiktok']));
assert.deepEqual(new Set(queries.map((row) => row.track)), new Set(['agent', 'fsbo']));

const blockedPlan = buildPilotPlan({
  COUNTRY_CODE: 'ZA',
  HARVEST_AUTOMATION_ENABLED: 'false',
  ZA_SCALE_PILOT_ENABLED: 'false',
  ZA_CURRENT_MONTHLY_SPEND_USD: '7.25',
  ZA_MONTHLY_SPEND_CAP_USD: '13',
});
assert.equal(blockedPlan.ok, false);
assert(blockedPlan.blockers.some((reason) => /Facebook Groups/.test(reason)));
assert(blockedPlan.blockers.some((reason) => /TikTok broad discovery/.test(reason)));
assert.equal(blockedPlan.cost.within_cap, true);

assert.equal(harvestAutomationEnabled({
  COUNTRY_CODE: 'ZA',
  HARVEST_AUTOMATION_ENABLED: 'true',
  ZA_SCALE_HARVEST_ENABLED: 'true',
  ZA_SCALE_DAVE_PILOT_PASS: 'false',
  ZA_PLATFORM_ACCESS_APPROVED: 'true',
}), false);
assert.equal(harvestAutomationEnabled({
  COUNTRY_CODE: 'ZA',
  HARVEST_AUTOMATION_ENABLED: 'true',
  ZA_SCALE_HARVEST_ENABLED: 'true',
  ZA_SCALE_DAVE_PILOT_PASS: 'true',
  ZA_PLATFORM_ACCESS_APPROVED: 'true',
}), true);

const privateSellerExtra = {
  found_online: true,
  social_search_candidate: true,
  private_seller: true,
  source_track: 'fsbo',
  source_url: 'https://www.tiktok.com/@seller/video/1234567890123456789',
  source_contact_url: 'https://www.tiktok.com/@seller',
  public_contact_phone: '+27821234567',
  contact_phone: '+27821234567',
  raw_source_post: { caption: 'Call 082 123 4567 about this house' },
};
const safePrivateSellerExtra = propertiesRoute._test.publicExtraFields(privateSellerExtra);
assert.equal(safePrivateSellerExtra.public_contact_phone, null);
assert.equal(safePrivateSellerExtra.contact_phone, null);
assert.equal(safePrivateSellerExtra.source_contact_url, null);
assert.equal(safePrivateSellerExtra.contact_via_platform, true);
assert.equal(safePrivateSellerExtra.contact_gate, 'seshaikhaya_enquiry');
assert.equal(safePrivateSellerExtra.source_url, privateSellerExtra.source_url);
assert.equal(propertiesRoute._test.publicContactPhoneForRow({
  source: 'found_online_property_source_v1',
  listed_via: 'found_online',
  lister_type: 'owner',
  lister_phone: '+27821234567',
  extra_fields: privateSellerExtra,
}, safePrivateSellerExtra), '');

console.log('south-africa scale gate tests passed');
