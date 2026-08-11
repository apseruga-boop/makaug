'use strict';

const assert = require('assert');
const whatsappRoute = require('../routes/whatsapp');
const propertyCards = require('../services/whatsappPropertyCardService');
const registry = require('../utils/southAfricaLocationRegistry');

const test = whatsappRoute.__test;
assert.equal(test.ACTIVE_COUNTRY_CODE, 'ZA');
assert.equal(test.ACTIVE_CURRENCY, 'ZAR');
assert.equal(test.parseLanguageChange('Afrikaans'), 'af');
assert.equal(test.parseLanguageChange('speak isiZulu'), 'zu');
assert.equal(test.parseLanguageChange('use Tshivenda'), 've');
assert.match(test.t('en', 'chooseLanguage'), /11\. isiNdebele/);
assert(!/Luganda|Kiswahili|Acholi/.test(test.t('en', 'chooseLanguage')));
assert.match(test.t('en', 'welcome'), /seshaikhaya\.com/);
assert.doesNotMatch(test.t('en', 'welcome'), /Uganda|makaug/i);

assert.equal(test.normalizeContactPhone('082 123 4567'), '+27821234567');
assert.equal(test.isValidContactPhone('+27 82 123 4567'), true);
assert.equal(test.isValidContactPhone('+256 760 112 587'), false);
assert.equal(test.isValidWhatsappUgNin('8001015009087'), true);
assert.equal(test.isValidWhatsappUgNin('PASSPORT: A1234567'), true);
assert.equal(test.isValidWhatsappUgNin('123'), false);

assert.equal(test.formatPrice(1_200_000, ''), 'R 1.2M');
assert.equal(test.formatPrice(8_500, 'month'), 'R 8.5K/month');
const usdBudget = test.parseBudget('apartment under USD 1000 per month');
assert.equal(usdBudget.maxBudgetUgx, 18_000);
assert.equal(usdBudget.canonicalCurrency, 'ZAR');
assert.equal(usdBudget.convertedFromForeign, true);
const zarBudget = test.parseBudget('rent in Sea Point under R 18 500 per month');
assert.equal(zarBudget.maxBudgetUgx, 18_500);

const seaPoint = registry.resolveCanonicalSouthAfricaLocation('Sea Point, Western Cape').match;
const capeTown = registry.resolveCanonicalSouthAfricaLocation('Cape Town, Western Cape').match;
const values = [];
const where = test.addWhatsappCanonicalLocationFilter(
  'WHERE TRUE',
  values,
  { canonical_location_id: capeTown.key },
  'p'
);
assert.deepEqual(values, ['Western Cape', 'Cape Town']);
assert.match(where, /extra_fields->>'city'/);
assert(!where.includes(seaPoint.key), 'city search must use descendant fields, not an exact suburb id');

const card = propertyCards.buildWhatsappPropertyCard({
  id: 'za-card-123456',
  title: 'Apartment in Sea Point',
  listing_type: 'rent',
  area: 'Sea Point',
  district: 'Western Cape',
  price: 18_500,
  price_period: 'month'
});
assert.match(card.caption, /R 18\.5K\/month/);
assert.match(card.propertyUrl, /^https:\/\/seshaikhaya\.com\/property\//);
assert.doesNotMatch(card.caption, /Uganda|USh|makaug/i);

console.log('south-africa-whatsapp-contract tests passed');
