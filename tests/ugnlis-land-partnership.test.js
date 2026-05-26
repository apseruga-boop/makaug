const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const {
  buildUgNlisAssistantReply,
  buildUgNlisLandVerificationPack,
  sanitizeUgNlisLandVerificationFields,
  UGNLIS_PORTAL_URL,
  UGNLIS_MINISTRY_PAGE_URL,
  UGNLIS_SEARCH_FEE_UGX,
  UGNLIS_SUPPORTED_ONLINE_SEARCH_DISTRICTS
} = require('../services/ugnlisLandVerificationService');

function testServicePack() {
  assert.strictEqual(UGNLIS_PORTAL_URL, 'https://ugnlis.mlhud.go.ug/');
  assert.strictEqual(UGNLIS_MINISTRY_PAGE_URL, 'https://mlhud.go.ug/ugnlis/');
  assert.strictEqual(UGNLIS_SEARCH_FEE_UGX, 10000);
  ['Mukono', 'Wakiso', 'Kampala', 'Moroto', 'Arua', 'Kabarole'].forEach((district) => {
    assert(UGNLIS_SUPPORTED_ONLINE_SEARCH_DISTRICTS.includes(district), `${district} must be listed as an online-search district`);
  });

  const sanitized = sanitizeUgNlisLandVerificationFields({
    ugnlis_title_volume: ' 12 ',
    ugnlis_title_folio: ' 8 ',
    ugnlis_block: ' 244 ',
    ugnlis_plot: ' 51 ',
    ugnlis_search_letter_url: 'https://example.com/search-letter.pdf'
  });
  assert.strictEqual(sanitized.ugnlis_title_volume, '12');
  assert.strictEqual(sanitized.land_verification_status, 'search_letter_supplied');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(sanitized, 'land_verification_concierge_requested'), false);

  const pack = buildUgNlisLandVerificationPack({ extra_fields: sanitized });
  assert.strictEqual(pack.status, 'search_letter_supplied');
  assert.strictEqual(pack.title_reference, 'Volume 12 / Folio 8');
  assert.strictEqual(pack.parcel_reference, 'Block 244 / Plot 51');
  assert.strictEqual(pack.search_letter_url, 'https://example.com/search-letter.pdf');
  assert(pack.evidence.some((item) => item.label === 'Search letter'));
}

function testRoutesAndUi() {
  const propertiesRoute = read('routes/properties.js');
  assert(propertiesRoute.includes("require('../services/ugnlisLandVerificationService')"));
  assert(propertiesRoute.includes('sanitizeUgNlisLandVerificationFields'));
  assert(propertiesRoute.includes('land_verification'));
  assert(propertiesRoute.includes('ugnlis_transaction_number'));

  const adminRoute = read('routes/admin.js');
  assert(adminRoute.includes("router.patch('/properties/:id/land-verification'"));
  assert(adminRoute.includes('admin_land_verification_updated'));
  assert(adminRoute.includes('land_verification_updated'));

  const whatsappRoute = read('routes/whatsapp.js');
  assert(whatsappRoute.includes('buildUgNlisAssistantReply'));
  assert(whatsappRoute.includes('isUgNlisLandVerificationIntent'));
  assert(whatsappRoute.includes('stripLinksAndIdsForNumericParsing'));
  assert(!whatsappRoute.includes('land search concierge'));
  assert(!whatsappRoute.includes('safe next steps'));
  assert(whatsappRoute.includes('ugnlis_official_info_requested_at'));

  const frontend = read('assets/makaug-app.js');
  assert(frontend.includes('shouldShowUgNlisAdvisory'));
  assert(frontend.includes('renderUgNlisVerificationCard'));
  assert(frontend.includes('saveAdminLandVerificationReview'));
  assert(frontend.includes('about.landHubTitle'));
  assert(frontend.includes('Official searches happen on UgNLIS'));
  assert(frontend.includes('Before opening UgNLIS'));
  assert(frontend.includes('role="tooltip"'));
  assert(!frontend.includes('Land Search Concierge'));
  assert(frontend.includes('titleSensitiveTypes'));
  assert(frontend.includes('Official searches happen on UgNLIS'));

  const html = read('index.html');
  assert(html.includes('about.landHubTitle'));
  assert(html.includes('https://ugnlis.mlhud.go.ug/'));
  assert(html.includes('ugnlis-official-portal-20260525'));
  assert(read('routes/health.js').includes('053_remove_land_search_help_flags.sql'));
  assert(read('db/migrations/053_remove_land_search_help_flags.sql').includes("- 'land_verification_concierge_requested'"));
}

function testWhatsappCopy() {
  const reply = buildUgNlisAssistantReply({ language: 'en', baseUrl: 'https://makaug.com' });
  assert(reply.includes('UgNLIS'));
  assert(reply.includes('https://ugnlis.mlhud.go.ug/'));
  assert(reply.includes('https://makaug.com/safety'));
  assert(reply.includes('Have ready before you open UgNLIS'));
  assert(reply.includes('Title search: title volume and folio'));
  assert(!reply.includes('makaug will keep the evidence trail'));
}

testServicePack();
testRoutesAndUi();
testWhatsappCopy();

console.log('UgNLIS land partnership regression checks passed.');
