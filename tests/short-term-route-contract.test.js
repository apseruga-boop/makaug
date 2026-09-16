'use strict';

// Short Term stays - route and contract tests.
//
// These run without a database. Anything that needs Postgres is proved by the
// SQL being parsed and the shapes being right, not by hitting a live server.
//
// What they are actually protecting:
//   1. The feature flag really is a kill switch.
//   2. The migration cannot damage anything that already exists.
//   3. The discovery-platform position is not quietly engineered away.
//   4. The public page does not leak anything on makaug's forbidden list.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

const migration = read('db', 'migrations', '132_short_term_foundation.sql');
const indexHtml = read('index.html');
const serverSource = read('server.js');
const clientSource = read('assets', 'short-term.js');
const bundleSource = read('assets', 'makaug-app.js');
const routeSource = read('routes', 'short-term.js');

const flags = require('../utils/shortTermFeatureFlags');
const service = require('../services/shortTermService');
const render = require('../services/shortTermSeoRenderService');
const media = require('../services/shortTermMediaService');
const mediaSource = read('services', 'shortTermMediaService.js');
const { PUBLIC_FORBIDDEN_STRINGS } = require('../services/publicHtmlSanitizer');

const results = [];
function test(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, error });
  }
}

const asyncTests = [];
function testAsync(name, fn) {
  asyncTests.push({ name, fn });
}

async function runAsyncTests() {
  for (const { name, fn } of asyncTests) {
    try {
      await fn();
      results.push({ name, ok: true });
    } catch (error) {
      results.push({ name, ok: false, error });
    }
  }
}

// ---------------------------------------------------------------------------
// 1. The flag is a real kill switch
// ---------------------------------------------------------------------------

test('short term is off unless the flag is explicitly on', () => {
  assert.strictEqual(flags.shortTermEnabled({}), false);
  assert.strictEqual(flags.shortTermEnabled({ SHORT_TERM_ENABLED: '' }), false);
  assert.strictEqual(flags.shortTermEnabled({ SHORT_TERM_ENABLED: 'false' }), false);
  assert.strictEqual(flags.shortTermEnabled({ SHORT_TERM_ENABLED: 'no' }), false);
  assert.strictEqual(flags.shortTermEnabled({ SHORT_TERM_ENABLED: 'true' }), true);
  assert.strictEqual(flags.shortTermEnabled({ SHORT_TERM_ENABLED: '1' }), true);
});

test('intake and reviews cannot switch on while the master flag is off', () => {
  const env = { SHORT_TERM_INTAKE_ENABLED: 'true', SHORT_TERM_REVIEWS_ENABLED: 'true' };
  assert.strictEqual(flags.shortTermIntakeEnabled(env), false);
  assert.strictEqual(flags.shortTermReviewsEnabled(env), false);
  assert.strictEqual(flags.shortTermCountdownEnabled(env), false);
});

test('nav entries are hidden in the HTML when the flag is off', () => {
  const html = '<a id="nav-short-term" data-short-term-entry href="/short-term">Short Term</a>';
  const off = flags.applyShortTermVisibility(html, {});
  assert.ok(/hidden/.test(off), 'entry should carry hidden');
  assert.ok(/display:none!important/.test(off), 'entry should be display:none');

  const on = flags.applyShortTermVisibility(html, { SHORT_TERM_ENABLED: 'true' });
  assert.strictEqual(on, html, 'markup must be untouched when the flag is on');
});

test('the client config is only injected when the flag is on', () => {
  const html = '<html><head></head><body></body></html>';
  assert.strictEqual(flags.injectShortTermRuntimeConfig(html, {}), html);

  const on = flags.injectShortTermRuntimeConfig(html, { SHORT_TERM_ENABLED: 'true' });
  assert.ok(on.includes('makaug-short-term-config'), 'config script missing');
  assert.ok(on.includes('"enabled":true'), 'enabled flag missing');
});

test('the client script refuses to boot without the server config', () => {
  assert.ok(
    /window\.__makaugShortTerm\.enabled\s*!==\s*true\)\s*return/.test(clientSource),
    'assets/short-term.js must bail out when the runtime config says the section is dark'
  );
});

test('the countdown does not render without a configured date', () => {
  assert.strictEqual(flags.shortTermCountdownTarget({}), null);
  assert.strictEqual(flags.shortTermCountdownTarget({ SHORT_TERM_COUNTDOWN_TARGET: 'not a date' }), null);
  assert.strictEqual(
    flags.shortTermCountdownTarget({ SHORT_TERM_COUNTDOWN_TARGET: '2027-01-15T00:00:00Z' }),
    '2027-01-15T00:00:00.000Z'
  );
});

test('every /api/short-term route sits behind the flag guard', () => {
  const guard = routeSource.indexOf('router.use((req, res, next) => {');
  const firstRoute = routeSource.search(/router\.(get|post|put|patch|delete)\(/);
  assert.ok(guard > -1, 'flag guard middleware missing');
  assert.ok(firstRoute > guard, 'a route is declared before the flag guard');
  assert.ok(routeSource.includes("return res.status(404).json({ ok: false, error: 'Not found' })"));
});

// ---------------------------------------------------------------------------
// 2. The migration cannot damage anything that already exists
// ---------------------------------------------------------------------------

test('migration 132 is additive only', () => {
  const statements = migration
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

  assert.ok(!/\bALTER\s+TABLE\b/i.test(statements), 'migration must not ALTER any table');
  assert.ok(!/\bDROP\s+TABLE\b/i.test(statements), 'migration must not DROP a table');
  assert.ok(!/\bDROP\s+COLUMN\b/i.test(statements), 'migration must not DROP a column');
  assert.ok(!/\bTRUNCATE\b/i.test(statements), 'migration must not TRUNCATE');
  assert.ok(!/\bDELETE\s+FROM\b/i.test(statements), 'migration must not DELETE');
  assert.ok(!/\bUPDATE\s+\w+\s+SET\b/i.test(statements), 'migration must not UPDATE existing rows');
});

test('migration 132 never references an existing makaug table', () => {
  const protectedTables = ['properties', 'users', 'agents', 'property_images', 'property_inquiries'];
  const body = migration.replace(/--[^\n]*/g, '');
  for (const table of protectedTables) {
    const pattern = new RegExp(`\\b(?:REFERENCES|FROM|JOIN|INTO|TABLE)\\s+${table}\\b`, 'i');
    assert.ok(!pattern.test(body), `migration must not touch ${table}`);
  }
});

test('every table created by migration 132 is namespaced st_', () => {
  const created = Array.from(migration.matchAll(/CREATE TABLE IF NOT EXISTS\s+(\w+)/gi))
    .map((match) => match[1]);
  assert.ok(created.length >= 8, `expected at least 8 tables, found ${created.length}`);
  for (const name of created) {
    assert.ok(name.startsWith('st_'), `${name} is not in the st_ namespace`);
  }
});

test('migration 132 is idempotent', () => {
  const creates = migration.match(/CREATE TABLE(?! IF NOT EXISTS)/gi) || [];
  assert.strictEqual(creates.length, 0, 'every CREATE TABLE needs IF NOT EXISTS');
  const indexes = migration.match(/CREATE INDEX(?! IF NOT EXISTS)/gi) || [];
  assert.strictEqual(indexes.length, 0, 'every CREATE INDEX needs IF NOT EXISTS');
});

test('the migration filename sorts after 131', () => {
  const dir = fs.readdirSync(path.join(root, 'db', 'migrations')).filter((f) => f.endsWith('.sql')).sort();
  const last = dir[dir.length - 1];
  assert.strictEqual(last, '132_short_term_foundation.sql', `last migration is ${last}`);
});

// ---------------------------------------------------------------------------
// 3. The discovery-platform position holds
// ---------------------------------------------------------------------------

test('st_lead has no reply, status or expiry column', () => {
  const block = migration.slice(
    migration.indexOf('CREATE TABLE IF NOT EXISTS st_lead'),
    migration.indexOf('CREATE INDEX IF NOT EXISTS idx_st_lead_listing')
  );
  assert.ok(block.length > 0, 'st_lead block not found');
  for (const forbidden of ['replied_at', 'response_status', 'expires_at', 'host_responded']) {
    assert.ok(!block.includes(forbidden), `st_lead must not carry ${forbidden}: tracking replies makes makaug a broker`);
  }
  // There is deliberately no `status` column on a lead.
  assert.ok(!/^\s*status\s+TEXT/m.test(block), 'st_lead must not have a status column');
});

test('the listing fee is a flat 50,000 for 3 months, with no commission anywhere', () => {
  assert.strictEqual(service.LISTING_FEE_UGX, 50000);
  assert.strictEqual(service.LISTING_TERM_MONTHS, 3);
  const all = [migration, routeSource, clientSource, read('services', 'shortTermService.js')].join('\n');
  assert.ok(!/commission_(?:rate|pct|amount)/i.test(all), 'no commission field may exist');
  assert.ok(!/take_rate|platform_fee_pct/i.test(all), 'no take-rate field may exist');
});

test('the guest-facing copy states plainly that makaug takes no booking and no money', () => {
  assert.ok(/does not take bookings/i.test(clientSource));
  assert.ok(/does not handle money|never handles guest money|not handle money/i.test(clientSource + routeSource));
  assert.ok(/not an agent, a broker or a party to your stay/i.test(clientSource));
});

test('the enquiry response hands back the host contact and says makaug will not chase', () => {
  assert.ok(routeSource.includes('contact: listing.contact'), 'the host contact must come back with the enquiry');
  assert.ok(/makaug does not pass messages on/i.test(routeSource));
});

test('reviews land unpublished', () => {
  const src = read('services', 'shortTermService.js');
  assert.ok(src.includes("'pending')"), 'reviews must be inserted as pending');
  assert.ok(/status = 'published'/.test(src), 'only published reviews may be read back');
});

// ---------------------------------------------------------------------------
// 4. Pricing and calendar maths
// ---------------------------------------------------------------------------

const sample = {
  base_nightly_ugx: 200000,
  cleaning_fee_ugx: 30000,
  min_nights: 2,
  max_guests: 4,
  weekly_discount_pct: 10,
  monthly_discount_pct: 20,
  rate_overrides: [{ starts_on: '2027-01-10', ends_on: '2027-01-12', nightly_ugx: 500000, label: 'Peak' }]
};

test('check-out is exclusive: 9th to 12th is three nights', () => {
  assert.strictEqual(service.nightsBetween('2027-01-09', '2027-01-12'), 3);
  assert.deepStrictEqual(
    service.eachNight('2027-01-09', '2027-01-12'),
    ['2027-01-09', '2027-01-10', '2027-01-11']
  );
});

test('rate overrides apply per night, not to the whole stay', () => {
  const quote = service.quoteStay(sample, { checkIn: '2027-01-09', checkOut: '2027-01-12', guests: 3 });
  assert.strictEqual(quote.nights, 3);
  assert.strictEqual(quote.nights_subtotal_ugx, 200000 + 500000 + 500000);
  assert.strictEqual(quote.total_ugx, 1200000 + 30000);
  assert.strictEqual(quote.discount_ugx, 0, 'a 3 night stay earns no weekly discount');
});

test('the weekly discount starts at seven nights, the monthly at twenty-eight', () => {
  const week = service.quoteStay({ ...sample, rate_overrides: [] }, { checkIn: '2027-03-01', checkOut: '2027-03-08' });
  assert.strictEqual(week.nights, 7);
  assert.strictEqual(week.discount_pct, 10);

  const month = service.quoteStay({ ...sample, rate_overrides: [] }, { checkIn: '2027-03-01', checkOut: '2027-03-29' });
  assert.strictEqual(month.nights, 28);
  assert.strictEqual(month.discount_pct, 20);
});

test('a quote flags a stay below the minimum and a party over capacity', () => {
  const quote = service.quoteStay(sample, { checkIn: '2027-01-09', checkOut: '2027-01-10', guests: 9 });
  assert.strictEqual(quote.nights, 1);
  assert.strictEqual(quote.meets_min_nights, false);
  assert.strictEqual(quote.over_capacity, true);
});

test('a quote always carries the estimate disclaimer', () => {
  const quote = service.quoteStay(sample, { checkIn: '2027-01-09', checkOut: '2027-01-12' });
  assert.ok(/estimate, not a booking/i.test(quote.disclaimer));
});

test('bad dates produce no quote rather than a wrong one', () => {
  assert.strictEqual(service.quoteStay(sample, {}), null);
  assert.strictEqual(service.quoteStay(sample, { checkIn: '2027-01-12', checkOut: '2027-01-09' }), null);
  assert.strictEqual(service.quoteStay(sample, { checkIn: 'soon', checkOut: 'later' }), null);
  assert.strictEqual(service.quoteStay(sample, { checkIn: '2027-02-30', checkOut: '2027-03-02' }), null);
});

test('availability respects blocked nights and an unpublished calendar', () => {
  const calendar = [
    { starts_on: '2027-01-01', ends_on: '2027-01-31', is_available: true },
    { starts_on: '2027-01-11', ends_on: '2027-01-11', is_available: false }
  ];
  assert.strictEqual(service.isStayAvailable(calendar, '2027-01-09', '2027-01-11').available, true);
  assert.strictEqual(service.isStayAvailable(calendar, '2027-01-09', '2027-01-12').available, false);
  assert.strictEqual(service.isStayAvailable(calendar, '2027-02-09', '2027-02-12').available, false);
  // No calendar means "ask the host", never a promise of a free night.
  assert.strictEqual(service.isStayAvailable([], '2027-01-09', '2027-01-12').available, null);
});

// ---------------------------------------------------------------------------
// 5. Validation
// ---------------------------------------------------------------------------

test('Ugandan phone numbers normalise however they are typed', () => {
  ['0780863394', '+256 780 863 394', '256780863394', '780863394', '00256780863394']
    .forEach((input) => assert.strictEqual(service.normalisePhone(input), '+256780863394', input));
  assert.strictEqual(service.isValidUgandaPhone('0780863394'), true);
  assert.strictEqual(service.isValidUgandaPhone('12345'), false);
});

test('a listing cannot be submitted without the right-to-let and terms declarations', () => {
  const base = {
    title: 'Quiet two bedroom apartment in Naguru',
    description: 'A bright, quiet two bedroom flat with secure parking and backup power, ten minutes from the city.',
    district: 'Kampala',
    area: 'Naguru',
    host_name: 'Sarah N',
    host_phone: '0780863394',
    base_nightly_ugx: 200000
  };
  const missing = service.validateListingSubmission(base);
  assert.strictEqual(missing.ok, false);
  assert.ok(missing.errors.some((e) => /right to let/i.test(e)));
  assert.ok(missing.errors.some((e) => /listing terms/i.test(e)));

  const complete = service.validateListingSubmission({
    ...base,
    right_to_let_declared: true,
    terms_accepted: true,
    amenities: ['wifi', 'backup_power', 'not_a_real_amenity'],
    availability: [{ starts_on: '2027-01-01', ends_on: '2027-01-31' }]
  });
  assert.strictEqual(complete.ok, true, complete.errors.join('; '));
  assert.deepStrictEqual(complete.value.amenities, ['wifi', 'backup_power'], 'unknown amenities must be dropped');
  assert.strictEqual(complete.value.host_phone, '+256780863394');
  assert.strictEqual(complete.value.availability.length, 1);
});

test('an enquiry needs a name and at least one way to reply', () => {
  assert.strictEqual(service.validateLead({ guest_name: 'A' }).ok, false);
  assert.strictEqual(service.validateLead({ guest_name: 'Arthur' }).ok, false);
  assert.strictEqual(service.validateLead({ guest_name: 'Arthur', guest_phone: '0780863394' }).ok, true);
  assert.strictEqual(service.validateLead({ guest_name: 'Arthur', guest_email: 'a@b.com' }).ok, true);
  assert.strictEqual(
    service.validateLead({ guest_name: 'Arthur', guest_phone: '0780863394', check_in: '2027-01-12', check_out: '2027-01-09' }).ok,
    false
  );
});

test('a review needs a real score and more than a word', () => {
  assert.strictEqual(service.validateReview({ reviewer_name: 'Sam', rating: 0, comment: 'Great place, very clean.' }).ok, false);
  assert.strictEqual(service.validateReview({ reviewer_name: 'Sam', rating: 9, comment: 'Great place, very clean.' }).ok, false);
  assert.strictEqual(service.validateReview({ reviewer_name: 'Sam', rating: 4, comment: 'good' }).ok, false);
  const ok = service.validateReview({ reviewer_name: 'Sam', rating: 4, comment: 'Clean, quiet and the water never went off.', reviewer_contact: '0780863394' });
  assert.strictEqual(ok.ok, true);
  assert.ok(ok.value.reviewer_contact_hash, 'the contact must be hashed');
  assert.ok(!String(ok.value.reviewer_contact_hash).includes('780863394'), 'the raw contact must never be stored');
});

// ---------------------------------------------------------------------------
// 6. The section is actually visible in the product
// ---------------------------------------------------------------------------

test('Short Term is in the desktop and mobile nav, and nothing was removed', () => {
  assert.ok(indexHtml.includes('id="nav-short-term"'), 'desktop nav entry missing');
  assert.ok(indexHtml.includes('id="mnav-short-term"'), 'mobile nav entry missing');
  assert.ok(indexHtml.includes('data-short-term-entry'), 'nav entries must be flag-controllable');

  // Arthur's rule: nothing that was already in the nav may disappear.
  ['nav-sale', 'nav-rent', 'nav-students', 'nav-commercial', 'nav-land',
    'nav-off-plan', 'nav-brokers', 'nav-mortgage', 'nav-valuation',
    'nav-ai', 'nav-marketplace', 'nav-about'].forEach((id) => {
    assert.ok(indexHtml.includes(`id="${id}"`), `${id} disappeared from the nav`);
  });
});

test('the Short Term page and its server-render target exist in index.html', () => {
  assert.ok(indexHtml.includes('id="page-short-term"'), 'page container missing');
  assert.ok(indexHtml.includes('id="short-term-ssr"'), 'server-render target missing');
  assert.ok(indexHtml.includes('/assets/short-term.css'), 'stylesheet not linked');
  assert.ok(indexHtml.includes('/assets/short-term.js'), 'client script not loaded');
});

test('the single page app knows the /short-term route', () => {
  assert.ok(bundleSource.includes('"short-term": "/short-term"'), 'page to route mapping missing');
  assert.ok(bundleSource.includes('"/short-term": "short-term"'), 'route to page mapping missing');
});

test('the server mounts the API and serves the public page', () => {
  assert.ok(serverSource.includes("app.use('/api/short-term', shortTermRoutes)"), 'API not mounted');
  assert.ok(serverSource.includes("app.get('/short-term'"), 'public index route missing');
  assert.ok(serverSource.includes("app.get('/short-term/:slug'"), 'public detail route missing');
  assert.ok(serverSource.includes("app.get('/short-term/list-your-place'"), 'host page route missing');

  // The host page must be declared before the catch-all slug route, or
  // /short-term/list-your-place is read as a listing and 404s.
  assert.ok(
    serverSource.indexOf("app.get('/short-term/list-your-place'") < serverSource.indexOf("app.get('/short-term/:slug'"),
    'list-your-place must be routed before the :slug catch-all'
  );
});

test('the public routes fall through untouched when the flag is off', () => {
  const routeBlock = serverSource.slice(
    serverSource.indexOf("app.get('/short-term'"),
    serverSource.indexOf("app.get('/agents/:id'")
  );
  const guards = routeBlock.match(/if \(!shortTermEnabled\(\)\) return next\(\);/g) || [];
  assert.strictEqual(guards.length, 3, `expected 3 flag guards, found ${guards.length}`);
});

test('the Short Term page is registered with the public HTML sanitizer', () => {
  const sanitizer = read('services', 'publicHtmlSanitizer.js');
  assert.ok(sanitizer.includes("'page-short-term'"), 'page id not registered');
  assert.ok(sanitizer.includes("'/short-term': ['page-short-term']"), 'route mapping missing');
  assert.ok(sanitizer.includes("'/short-term/': 'page-short-term'"), 'detail route mapping missing');

  // An unregistered page container leaks into every other route's HTML and
  // gets swept into the shared homepage components. Prove it does not.
  const { sanitizePublicHtml } = require('../services/publicHtmlSanitizer');
  const home = sanitizePublicHtml(indexHtml, { pathname: '/' });
  assert.ok(!home.includes('id="page-short-term"'), 'the short term page must not ship inside the homepage');
  assert.ok(home.includes('id="nav-short-term"'), 'the nav entry must still be on the homepage');

  const own = sanitizePublicHtml(indexHtml, { pathname: '/short-term' });
  assert.ok(own.includes('id="page-short-term"'), 'the short term page must ship on its own route');
  assert.ok(own.includes('id="short-term-ssr"'), 'the server-render target must survive sanitising');
});

test('the shared homepage core does not carry the short term page', () => {
  const mapComponent = read('packages', 'shared-country-core', 'components', 'map.html');
  assert.ok(!mapComponent.includes('page-short-term'),
    'the short term container leaked into the shared homepage components; rebuild with npm run build:shared-homepage');
  const topbar = read('packages', 'shared-country-core', 'components', 'topbar-nav.html');
  assert.ok(topbar.includes('nav-short-term'), 'the nav entry must be in the canonical topbar');
  assert.ok(topbar.includes('data-short-term-entry'), 'the canonical nav entry must stay flag-controllable');
});

// ---------------------------------------------------------------------------
// 7. Server-rendered output
// ---------------------------------------------------------------------------

const renderSample = {
  id: '22222222-2222-4222-8222-222222222222',
  reference: 'ST-000001',
  slug: 'quiet-two-bed-naguru-st-000001',
  url: '/short-term/quiet-two-bed-naguru-st-000001',
  title: 'Quiet two bedroom in Naguru',
  description: 'Bright, quiet and secure, with backup power and a water tank.',
  district: 'Kampala',
  area: 'Naguru',
  place_type_label: 'Entire place',
  bedrooms: 2,
  beds: 3,
  bathrooms: 2,
  max_guests: 4,
  nightly_ugx: 200000,
  nightly_display: 'UGX 200,000',
  primary_image: '/assets/house-ads-v3/rent.webp',
  images: [{ url: '/assets/house-ads-v3/rent.webp' }],
  review_count: 3,
  review_average: 4.67,
  latitude: 0.3391,
  longitude: 32.6067,
  check_in_from: '14:00',
  check_out_by: '10:00'
};

test('server-rendered cards carry the real listing, not a placeholder', () => {
  const html = '<html><body><div id="short-term-ssr"></div></body></html>';
  const out = render.renderShortTermSeoHtml(html, { listings: [renderSample], baseUrl: 'https://makaug.com' });
  assert.strictEqual(out.injected, true);
  assert.ok(out.html.includes('Quiet two bedroom in Naguru'));
  assert.ok(out.html.includes('UGX 200,000'));
  assert.ok(out.html.includes('/short-term/quiet-two-bed-naguru-st-000001'));
  assert.ok(/makaug does not take bookings/i.test(out.html), 'the SSR block must carry the disclaimer');
});

test('an empty result set renders an honest empty state, never invented stock', () => {
  const html = '<html><body><div id="short-term-ssr"></div></body></html>';
  const out = render.renderShortTermSeoHtml(html, { listings: [], baseUrl: 'https://makaug.com' });
  assert.ok(/No short stays are published yet/i.test(out.html));
  assert.ok(!/UGX/.test(out.html), 'an empty page must not print a price');
  assert.strictEqual(out.structuredData.numberOfItems, 0);
});

test('HTML without the container is returned untouched rather than mangled', () => {
  const html = '<html><body><p>nothing here</p></body></html>';
  const out = render.renderShortTermSeoHtml(html, { listings: [renderSample] });
  assert.strictEqual(out.html, html);
  assert.strictEqual(out.injected, false);
});

test('a listing produces valid VacationRental structured data for Google', () => {
  const data = render.vacationRentalStructuredData(renderSample, 'https://makaug.com');
  assert.strictEqual(data['@type'], 'VacationRental');
  assert.strictEqual(data.address.addressCountry, 'UG');
  assert.strictEqual(data.containsPlace.numberOfBedrooms, 2);
  assert.strictEqual(data.geo.latitude, 0.3391);
  assert.strictEqual(data.aggregateRating.reviewCount, 3);
  assert.ok(JSON.stringify(data).length > 200);
});

test('server-rendered output escapes anything a host typed', () => {
  const nasty = {
    ...renderSample,
    title: '<script>alert(1)</script>',
    description: '"><img src=x onerror=alert(1)>'
  };
  const out = render.renderShortTermSeoHtml('<div id="short-term-ssr"></div>', { listings: [nasty] });
  // The payload text may survive; what must not survive is a live tag or a
  // live attribute. Angle brackets and quotes have to come back as entities.
  assert.ok(!out.html.includes('<script'), 'a script tag survived escaping');
  assert.ok(!out.html.includes('<img src=x'), 'an img tag survived escaping');
  assert.ok(out.html.includes('&lt;script&gt;'), 'expected the script tag escaped');
  assert.ok(out.html.includes('&lt;img src=x'), 'expected the img tag escaped');
  assert.ok(out.html.includes('&quot;&gt;'), 'expected the attribute break-out escaped');
});

// ---------------------------------------------------------------------------
// 8. makaug's public HTML leakage rule
// ---------------------------------------------------------------------------

test('the Short Term markup leaks none of the forbidden admin strings', () => {
  const start = indexHtml.indexOf('<div id="page-short-term"');
  const end = indexHtml.indexOf('<div id="page-marketplace"');
  assert.ok(start > -1 && end > start, 'could not isolate the short term page block');
  const block = indexHtml.slice(start, end);

  const surfaces = [block, clientSource, render.renderShortTermSsrBlock([renderSample], { baseUrl: '' })];
  for (const forbidden of PUBLIC_FORBIDDEN_STRINGS) {
    for (const surface of surfaces) {
      assert.ok(
        !surface.includes(forbidden),
        `forbidden public string leaked into short term markup: ${forbidden}`
      );
    }
  }
});

test('nothing in the public client calls a staff endpoint', () => {
  assert.ok(!clientSource.includes('/staff/'), 'the public client must never call a staff route');
  assert.ok(!clientSource.includes('ADMIN_API_KEY'), 'no admin key may appear in public JavaScript');
});

test('staff routes are behind requireStaffAccess', () => {
  const staffRoutes = routeSource.match(/router\.(?:get|post)\('\/staff[^']*',\s*([A-Za-z]+)/g) || [];
  assert.ok(staffRoutes.length >= 4, `expected staff routes, found ${staffRoutes.length}`);
  for (const line of staffRoutes) {
    assert.ok(line.includes('requireStaffAccess'), `unprotected staff route: ${line}`);
  }
});

// ---------------------------------------------------------------------------
// 9. The site-wide property total
// ---------------------------------------------------------------------------

test('short term stays are folded into the site-wide total only', () => {
  const metrics = read('services', 'publicInventoryMetricsService.js');
  assert.ok(metrics.includes('addShortTermToSiteWideSummary'), 'helper missing');
  assert.ok(
    metrics.includes('if (callerWhere && String(callerWhere).trim()) return summary;'),
    'a filtered count must not be inflated by the site-wide short term figure'
  );
  assert.ok(metrics.includes('if (!shortTermEnabled()) return summary;'), 'must respect the flag');

  const { normalizePublicOpportunitySummary } = require('../services/publicInventoryMetricsService');
  const summary = normalizePublicOpportunitySummary({ sale: 10, rent: 5 });
  assert.strictEqual(summary.short_term, 0, 'short term must default to zero');
  assert.strictEqual(summary.total, 15, 'the existing total must be unchanged with the flag off');
});

test('the short term count cannot take the existing count down', () => {
  const src = read('services', 'shortTermService.js');
  assert.ok(src.includes("to_regclass('public.st_listing') IS NULL"), 'must survive a missing table');
  assert.ok(/catch \(error\) \{[\s\S]*?return 0;/.test(src), 'must fail soft to zero');
});

// ---------------------------------------------------------------------------
// 10. Photo upload
// ---------------------------------------------------------------------------

const LISTING_A = '22222222-2222-4222-8222-222222222222';
const LISTING_B = '33333333-3333-4333-8333-333333333333';

function withSecret(fn, secret = 'short-term-test-secret') {
  const previous = process.env.JWT_SECRET;
  process.env.JWT_SECRET = secret;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previous;
  }
}

test('an upload token only works for the listing it was issued for', () => {
  withSecret(() => {
    const token = media.createUploadToken(LISTING_A);
    assert.strictEqual(media.verifyUploadToken(LISTING_A, token), true);
    assert.throws(() => media.verifyUploadToken(LISTING_B, token), /not valid for this listing/i);
  });
});

test('a forged, malformed or expired upload token is rejected', () => {
  withSecret(() => {
    const token = media.createUploadToken(LISTING_A);
    const [expiry] = token.split('.');

    assert.throws(() => media.verifyUploadToken(LISTING_A, `${expiry}.forgedsignature`), /not valid/i);
    assert.throws(() => media.verifyUploadToken(LISTING_A, 'nonsense'), /not valid/i);
    assert.throws(() => media.verifyUploadToken(LISTING_A, ''), /not valid/i);
    assert.throws(() => media.verifyUploadToken(LISTING_A, `${Date.now() - 1000}.x`), /expired/i);
  });
});

test('a token signed with a different secret is rejected', () => {
  const token = withSecret(() => media.createUploadToken(LISTING_A), 'secret-one');
  withSecret(() => {
    assert.throws(() => media.verifyUploadToken(LISTING_A, token), /not valid/i);
  }, 'secret-two');
});

test('uploads fail closed when no signing key is configured', () => {
  const previous = process.env.JWT_SECRET;
  delete process.env.JWT_SECRET;
  try {
    assert.throws(() => media.createUploadToken(LISTING_A), /signing key is not configured/i);
  } finally {
    if (previous !== undefined) process.env.JWT_SECRET = previous;
  }
});

test('photos go to a new prefix and never near existing media', () => {
  assert.strictEqual(media.MEDIA_KEY_PREFIX, 'short-term');
  assert.ok(mediaSource.includes('`${MEDIA_KEY_PREFIX}/${listingId}`'),
    'every object key must be namespaced under short-term/<listing id>');
});

test('only real image types are accepted, and only up to the size cap', () => {
  assert.deepStrictEqual(media.ALLOWED_MIME_TYPES, ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
  assert.throws(() => media.parseImageDataUrl('data:application/pdf;base64,AAAA'), /JPEG, PNG or WebP/i);
  assert.throws(() => media.parseImageDataUrl('not a data url'), /could not be read/i);
  assert.throws(() => media.parseImageDataUrl('data:image/png;base64,'), /could not be read|empty/i);

  const oversized = 'data:image/jpeg;base64,' + 'A'.repeat(Math.ceil((media.MAX_UPLOAD_BYTES + 1024) * 4 / 3));
  assert.throws(() => media.parseImageDataUrl(oversized), /too big/i);
});

test('the client shrinks photos before sending them', () => {
  assert.ok(/CLIENT_MAX_EDGE\s*=\s*1600/.test(clientSource), 'client-side downscale is missing');
  assert.ok(clientSource.includes("canvas.toDataURL('image/jpeg'"), 'client must re-encode before upload');
  assert.ok(/one request per photo|One request per photo/i.test(clientSource),
    'photos must upload one at a time so a dropped connection keeps what landed');
});

test('the photo endpoints exist and sit behind the intake flag', () => {
  assert.ok(routeSource.includes("router.post('/listings/:id/photos'"), 'upload endpoint missing');
  assert.ok(routeSource.includes("router.get('/listings/:id/photos'"), 'listing endpoint missing');
  const block = routeSource.slice(routeSource.indexOf("router.post('/listings/:id/photos'"));
  assert.ok(block.indexOf('shortTermIntakeEnabled()') < block.indexOf('attachListingPhoto'),
    'the upload endpoint must check the intake flag before doing any work');
  assert.ok(routeSource.includes('photoLimiter'), 'photo uploads must be rate limited');
});

test('the listing submission hands back an upload token and the photo config', () => {
  assert.ok(routeSource.includes('upload_token: uploadToken'), 'submission must return the token');
  assert.ok(routeSource.includes('photos_ready: photoUploadReady()'), 'submission must say whether uploads work');
  assert.ok(routeSource.includes('max_per_listing: MAX_IMAGES_PER_LISTING'), '/meta must publish the photo limits');
});

// --- these actually process an image, so they are async ---

testAsync('re-encoding strips the GPS coordinates a phone writes into a photo', async () => {
  let sharp;
  try {
    sharp = require('sharp');
  } catch (_) {
    // sharp missing is itself covered by the fail-closed test below.
    return;
  }

  // A photo tagged with a location, exactly as a phone would produce.
  const tagged = await sharp({
    create: { width: 240, height: 180, channels: 3, background: { r: 40, g: 120, b: 70 } }
  })
    .jpeg()
    .withMetadata({
      exif: {
        IFD0: { Copyright: 'makaug test', Make: 'TestPhone' },
        GPS: { GPSLatitudeRef: 'N', GPSLongitudeRef: 'E' }
      }
    })
    .toBuffer();

  const before = await sharp(tagged).metadata();
  assert.ok(before.exif, 'the fixture should start with EXIF, otherwise this test proves nothing');

  const cleaned = await media.normaliseImage(tagged);
  const after = await sharp(cleaned.bytes).metadata();

  assert.ok(!after.exif, 'EXIF survived re-encoding, so a host location could be published');
  assert.strictEqual(cleaned.mimeType, 'image/jpeg');
});

testAsync('oversized photos are scaled down to the long-edge cap', async () => {
  let sharp;
  try {
    sharp = require('sharp');
  } catch (_) {
    return;
  }
  const big = await sharp({
    create: { width: 4000, height: 3000, channels: 3, background: { r: 200, g: 200, b: 200 } }
  }).jpeg().toBuffer();

  const out = await media.normaliseImage(big);
  assert.strictEqual(out.width, media.MAX_EDGE_PX);
  assert.ok(out.height <= media.MAX_EDGE_PX);
  assert.ok(out.bytes.length < big.length, 'the processed image should be smaller than the original');
});

testAsync('a file that is not really an image is refused', async () => {
  await assert.rejects(
    () => media.normaliseImage(Buffer.from('this is plainly not an image')),
    /not an image we can read/i
  );
});

test('photo upload fails closed rather than storing an untouched photo', () => {
  assert.ok(/if \(!sharp\) \{[\s\S]*?throw mediaError/.test(mediaSource),
    'a missing image processor must refuse the upload, not fall through to storing raw bytes');
  assert.ok(mediaSource.includes('if (!cloudMediaStorageConfigured())'),
    'uploads must refuse when object storage is not configured');
});

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

runAsyncTests().then(() => {
  const failed = results.filter((r) => !r.ok);
  for (const result of results) {
    console.log(`${result.ok ? 'ok  ' : 'FAIL'} - ${result.name}`);
    if (!result.ok) console.log(`       ${result.error.message}`);
  }
  console.log(`\n${results.length - failed.length}/${results.length} short term contract tests passed`);

  if (failed.length) {
    process.exitCode = 1;
  }
}).catch((error) => {
  console.error('short term contract test harness failed', error);
  process.exitCode = 1;
});
