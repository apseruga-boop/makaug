'use strict';

/**
 * C20 (10 Oct 2026, Turebe check). The approval gates rejected price periods
 * the listing forms offer: Per Week, Per Year, Negotiable, Per Acre, Per Plot,
 * POA. normalizePricePeriodForWrite() had no alias for wk, neg, poa, acre or
 * plot, and listingDataIntegrity.js only allowed month for rent and once for
 * sale/land. POA listings (no price) also failed listingPriceQuality.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  PRICE_PERIOD_FORM_OPTIONS,
  allowedPricePeriods,
  normalizePricePeriod,
  pricePeriodSuffix
} = require('../config/pricePeriods');
const { listingDataIntegrityReport, HOSPITALITY_SHORT_TERM_MESSAGE } = require('../utils/listingDataIntegrity');
const { listingPriceQuality } = require('../utils/listingPriceQuality');
const { normalizePricePeriodForWrite } = require('../utils/propertyPriceCurrency');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

// A realistic listing per form section with a sane price for that period.
const SECTION_LISTING = {
  sale: { listing_type: 'sale', title: 'Four-bedroom house for sale in Muyenga', description: 'Four-bedroom house for sale in Muyenga, Kampala.', bedrooms: 4 },
  rent: { listing_type: 'rent', title: 'Two-bedroom apartment to let in Ntinda', description: 'Two-bedroom apartment to let in Ntinda, Kampala.', bedrooms: 2 },
  land_sale: { listing_type: 'land', transaction_type: 'sale', title: 'Titled plot of land for sale in Gayaza', description: 'Titled land for sale in Gayaza, 50x100 plot.' },
  land_rent: { listing_type: 'land', transaction_type: 'rent', title: 'Farm land for lease in Mukono', description: 'Agricultural land for lease in Mukono.' },
  commercial_sale: { listing_type: 'commercial', transaction_type: 'sale', property_type: 'shop', title: 'Shop for sale in Kampala', description: 'Retail shop for sale on Kampala Road.' },
  commercial_rent: { listing_type: 'commercial', transaction_type: 'rent', property_type: 'office', title: 'Office space to let in Nakasero', description: 'Office space to let in Nakasero, Kampala.' },
  student: { listing_type: 'student', title: 'Student hostel room near Makerere', description: 'Student hostel room near Makerere University.' }
};

const SANE_PRICE = {
  once: 450_000_000, neg: 450_000_000, acre: 60_000_000, plot: 35_000_000,
  month: 1_500_000, week: 400_000, year: 18_000_000, acre_yr: 1_200_000, semester: 1_200_000
};

function listingFor(section, value) {
  const period = normalizePricePeriodForWrite(value);
  const base = {
    ...SECTION_LISTING[section],
    district: 'Kampala',
    area: 'Ntinda',
    price_currency: 'UGX',
    price_original_currency: 'UGX',
    lister_phone: '+256700000000',
    price_period: period
  };
  if (period === 'poa') return { ...base, price: null, price_original: null, price_on_application: true };
  if (section === 'student' && period === 'year') return { ...base, price: 3_600_000, price_original: 3_600_000 };
  if (section === 'land_rent' && period === 'month') return { ...base, price: 900_000, price_original: 900_000 };
  return { ...base, price: SANE_PRICE[period], price_original: SANE_PRICE[period] };
}

test('every option the forms offer saves as one canonical spelling and passes both approval gates', () => {
  const canonical = new Set(['once', 'neg', 'poa', 'month', 'week', 'year', 'semester', 'acre', 'plot', 'acre_yr']);
  for (const [section, options] of Object.entries(PRICE_PERIOD_FORM_OPTIONS)) {
    for (const option of options) {
      const listing = listingFor(section, option.value);
      assert.ok(canonical.has(listing.price_period), `${section}/${option.value} saved as ${listing.price_period}`);
      const integrity = listingDataIntegrityReport(listing);
      const periodIssues = integrity.issues.filter((issue) => /period|price|poa|hospitality/.test(issue.code));
      assert.deepEqual(periodIssues, [], `${section}/${option.value}: ${JSON.stringify(periodIssues)}`);
      const quality = listingPriceQuality(listing);
      assert.equal(quality.ok, true, `${section}/${option.value}: ${quality.reasons.join(', ')}`);
    }
  }
});

test('the aliases cover the form values and older spellings', () => {
  const cases = { wk: 'week', week: 'week', weekly: 'week', per_week: 'week', yr: 'year', 'Per Year': 'year', neg: 'neg', negotiable: 'neg',
    poa: 'poa', price_on_application: 'poa', acre: 'acre', plot: 'plot', acre_yr: 'acre_yr', mo: 'month', monthly: 'month', sem: 'semester', once: 'once' };
  for (const [input, expected] of Object.entries(cases)) assert.equal(normalizePricePeriodForWrite(input), expected, input);
});

test('the allow-list per category is exactly what the brief lists', () => {
  const list = (type, transaction) => [...allowedPricePeriods(type, transaction)].sort();
  assert.deepEqual(list('rent'), ['month', 'week', 'year']);
  assert.deepEqual(list('commercial', 'rent'), ['month', 'week', 'year']);
  assert.deepEqual(list('sale'), ['neg', 'once', 'poa']);
  assert.deepEqual(list('commercial', 'sale'), ['neg', 'once', 'poa']);
  assert.deepEqual(list('land', 'sale'), ['acre', 'neg', 'once', 'plot', 'poa']);
  assert.deepEqual(list('land', 'rent'), ['acre', 'acre_yr', 'month', 'neg', 'once', 'plot', 'poa', 'year']);
  assert.deepEqual(list('student'), ['month', 'semester', 'year']);
});

test('a POA sale with no price passes both gates', () => {
  const listing = listingFor('sale', 'poa');
  assert.equal(listing.price, null);
  assert.deepEqual(listingDataIntegrityReport(listing).issues.filter((issue) => /price|period/.test(issue.code)), []);
  assert.equal(listingPriceQuality(listing).ok, true);
  // A sale with no price and no POA still fails.
  assert.ok(listingPriceQuality({ ...listing, price_on_application: false, price_period: 'once' }).reasons.includes('missing_or_placeholder_price'));
});

test('a monthly sale and a one-off rent still fail', () => {
  assert.ok(listingDataIntegrityReport({ ...listingFor('rent', 'mo'), price_period: 'once' }).issues.some((issue) => issue.code === 'price_period_conflicts_with_category'));
  assert.ok(listingDataIntegrityReport({ ...listingFor('sale', 'once'), price_period: 'month' }).issues.some((issue) => issue.code === 'price_period_conflicts_with_category'));
});

test('a nightly rent fails with the Short Term message; a monthly "Airbnb" flat passes', () => {
  const nightly = { ...listingFor('rent', 'mo'), price: 150_000, price_original: 150_000, price_period: 'night' };
  const report = listingDataIntegrityReport(nightly);
  const hospitality = report.issues.find((issue) => issue.code === 'unsupported_hospitality_or_nightly');
  assert.ok(hospitality, JSON.stringify(report.issues));
  assert.equal(hospitality.message, 'Nightly and short-stay places go in Short Term stays (/short-term), not the main listings.');
  assert.equal(HOSPITALITY_SHORT_TERM_MESSAGE, hospitality.message);
  const airbnbMonthly = {
    ...listingFor('rent', 'mo'),
    title: 'Furnished Airbnb apartment for rent in Kololo',
    description: 'Fully furnished Airbnb-style two-bedroom apartment for rent in Kololo at UGX 3,000,000 per month.',
    price: 3_000_000,
    price_original: 3_000_000
  };
  const airbnbReport = listingDataIntegrityReport(airbnbMonthly);
  assert.deepEqual(airbnbReport.issues.filter((issue) => /hospitality|period|ambiguous/.test(issue.code)), []);
  assert.equal(listingPriceQuality(airbnbMonthly).ok, true);
});

test('period suffixes print words, not codes', () => {
  assert.equal(pricePeriodSuffix('wk'), '/week');
  assert.equal(pricePeriodSuffix('yr'), '/year');
  assert.equal(pricePeriodSuffix('acre'), '/acre');
  assert.equal(pricePeriodSuffix('plot'), '/plot');
  assert.equal(pricePeriodSuffix('night'), '/night');
  assert.equal(pricePeriodSuffix('neg'), '');
  assert.equal(normalizePricePeriod('Per Week'), 'week');
});

test('the browser forms read the shared options from /config.js, and the bundled fallback matches them', () => {
  const server = read('server.js');
  assert.match(server, /window\.MAKAUG_PRICE_PERIOD_OPTIONS = \$\{JSON\.stringify\(PRICE_PERIOD_FORM_OPTIONS\)\};/);
  const app = read('assets/makaug-app.js');
  const match = app.match(/const LISTING_PRICE_PERIOD_OPTIONS_FALLBACK = (\{[\s\S]*?\n\});/);
  assert.ok(match, 'fallback constant present');
  // eslint-disable-next-line no-new-func
  const fallback = Function(`return (${match[1]});`)();
  assert.deepEqual(fallback, JSON.parse(JSON.stringify(PRICE_PERIOD_FORM_OPTIONS)));
  assert.match(app, /const LISTING_PRICE_PERIOD_OPTIONS = Object\.freeze\(\(typeof window !== "undefined" && window\.MAKAUG_PRICE_PERIOD_OPTIONS\) \|\| LISTING_PRICE_PERIOD_OPTIONS_FALLBACK\);/);
});

test('the short-term validator is unchanged: UGX-only nightly price, 250,000 a night passes (regression guard)', () => {
  const { validateListingSubmission } = require('../services/shortTermService');
  const priceErrors = (result) => (result.errors || []).filter((error) => /nightly price/i.test(error));
  const base = { title: 'Garden cottage in Ntinda', description: 'A quiet garden cottage in Ntinda with parking, Wi-Fi and a kitchen for guests.', district: 'Kampala', area: 'Ntinda', host_name: 'Host', host_phone: '0780863394', place_type: 'entire_place', right_to_let_declared: true, terms_accepted: true };
  assert.deepEqual(priceErrors(validateListingSubmission({ ...base, base_nightly_ugx: 250000 })), []);
  // There is no USD field: a USD-only submission has no UGX nightly price and fails.
  assert.ok(priceErrors(validateListingSubmission({ ...base, base_nightly_usd: 60 })).includes('Set a nightly price in Uganda Shillings.'));
  assert.ok(priceErrors(validateListingSubmission({ ...base, base_nightly_ugx: 60_000_000 })).includes('That nightly price looks wrong. Check the figure.'));
});

test('SEO: weekly and yearly rents print words and keep their price in bounds', () => {
  const { priceLabel } = require('../services/publicSeoRenderService');
  const { priceInSeoBounds } = require('../services/publicSeoService');
  assert.equal(priceLabel({ price: 700000, price_period: 'wk' }).replace(/ /g, ' '), 'UGX 700,000/week');
  assert.equal(priceLabel({ price: 18000000, price_period: 'yr' }).replace(/ /g, ' '), 'UGX 18,000,000/year');
  assert.equal(priceLabel({ price: 60000000, price_period: 'acre', listing_type: 'land' }).replace(/ /g, ' '), 'UGX 60,000,000/acre');
  assert.equal(priceLabel({ price: null, price_period: 'poa', price_on_application: true }), 'Price on application');
  assert.equal(priceInSeoBounds({ listing_type: 'rent', price: 700000, price_period: 'week' }), true);
  assert.equal(priceInSeoBounds({ listing_type: 'rent', price: 18000000, price_period: 'year' }), true);
  assert.equal(priceInSeoBounds({ listing_type: 'rent', price: 90000000, price_period: 'week' }), false);
});

test('the browser price label: no "/neg" or "/poa" codes', () => {
  const app = read('assets/makaug-app.js');
  assert.match(app, /if \(\["once", "total", "sale", "one off", "cash", "neg", "negotiable", "poa", "price on application"\]\.includes\(key\)\) return "";/);
  assert.match(app, /period === "poa" \|\| period === "price_on_application"\) return translateListingLabel\("Price upon application"\);/);
  assert.match(app, /function adminShortTermMoveHtml\(issueCodes = \[\]\)/);
});

test('every write path turns the POA period into price_on_application and drops the number', () => {
  const properties = read('routes/properties.js');
  assert.match(properties, /if \(patch\.price_period === 'poa'\) patch\.price_on_application = true;/);
  assert.match(properties, /(?:const|let) priceOnApplication = parseBooleanLike\(body\.price_on_application \|\| body\.priceOnApplication, false\) \|\| submittedPricePeriod === 'poa';/);
  assert.match(read('routes/staff.js'), /if \(normalized\.price_period === 'poa'\) normalized\.price_on_application = true;/);
  assert.match(read('routes/admin.js'), /if \(\(!property\.price \|\| property\.price <= 0\) && !isPriceOnApplication\(property\)\) blockers\.push\('price'\);/);
});
