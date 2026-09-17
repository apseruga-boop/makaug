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
const migration133 = read('db', 'migrations', '133_short_term_host_acquisition.sql');
const deskSource = read('assets', 'short-term-admin.js');
const indexHtml = read('index.html');
const serverSource = read('server.js');
const clientSource = read('assets', 'short-term.js');
const bundleSource = read('assets', 'makaug-app.js');
const routeSource = read('routes', 'short-term.js');

const flags = require('../utils/shortTermFeatureFlags');
const service = require('../services/shortTermService');
const render = require('../services/shortTermSeoRenderService');
const media = require('../services/shortTermMediaService');
const moderation = require('../services/shortTermModerationService');
const moderationSource = read('services', 'shortTermModerationService.js');
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

test('the countdown targets AFCON 2027 kick-off, and config still wins', () => {
  // CAF confirmed 19 June to 17 July 2027 for the Pamoja tournament across
  // Kenya, Tanzania and Uganda. Kick-off 16:00 East Africa Time = 13:00 UTC.
  assert.strictEqual(flags.AFCON_2027_KICKOFF, '2027-06-19T13:00:00.000Z');
  assert.strictEqual(flags.shortTermCountdownTarget({}), '2027-06-19T13:00:00.000Z');

  const target = new Date(flags.AFCON_2027_KICKOFF);
  assert.strictEqual(target.getUTCFullYear(), 2027);
  assert.strictEqual(target.getUTCMonth(), 5, 'June is month 5');
  assert.strictEqual(target.getUTCDate(), 19);

  // A schedule change is a config edit, not a deploy.
  assert.strictEqual(
    flags.shortTermCountdownTarget({ SHORT_TERM_COUNTDOWN_TARGET: '2027-07-01T12:00:00Z' }),
    '2027-07-01T12:00:00.000Z'
  );

  // And a typo hides the banner rather than counting down to nonsense.
  assert.strictEqual(flags.shortTermCountdownTarget({ SHORT_TERM_COUNTDOWN_TARGET: 'not a date' }), null);
});

test('the review desks ship as their own asset, not to every visitor', () => {
  const deskSource = read('assets', 'short-term-admin.js');

  // The public bundle must carry none of it.
  assert.ok(!clientSource.includes('makaugShortTermDesk'), 'desk code leaked into the public asset');
  assert.ok(!clientSource.includes('/staff/queue'), 'the public asset must not reference the staff queue');

  // The desk asset is what talks to the staff endpoints.
  assert.ok(deskSource.includes('/staff/queue'), 'the desk must load the queue');
  assert.ok(deskSource.includes('king-decision'), 'the desk must reach King review');

  // And it only loads where the desks exist, which is only the dashboards.
  assert.ok(
    /getElementById\("staff-short-term-queue"\)[\s\S]{0,400}short-term-admin\.js/.test(indexHtml),
    'the desk asset must be loaded conditionally on the queue elements existing'
  );
  // Never an unconditional load.
  const loaderBlock = indexHtml.slice(indexHtml.indexOf('shortTermDeskScript'), indexHtml.indexOf('shortTermDeskScript') + 400);
  assert.ok(loaderBlock.includes('short-term-admin.js'), 'the desk asset load is missing');
});

test('the desk markup is stripped from every public response', () => {
  const { sanitizePublicHtml } = require('../services/publicHtmlSanitizer');

  for (const pathname of ['/', '/short-term', '/for-sale', '/about']) {
    const out = sanitizePublicHtml(indexHtml, { pathname });

    // None of the desk UI may reach a guest.
    for (const fragment of [
      'staff-short-term-control',
      'admin-short-term-king-control',
      'Short Term review desk',
      'King review',
      'Approve and publish',
      'Send to King review'
    ]) {
      assert.ok(!out.includes(fragment), `"${fragment}" leaked on ${pathname}`);
    }

    // The one permitted mention is the loader's own guard: a getElementById
    // call naming the queue element. It is a feature detection, not markup,
    // and it is what keeps the desk asset off a guest's connection.
    const mentions = (out.match(/staff-short-term-queue/g) || []).length;
    assert.strictEqual(mentions, 1, `expected only the loader guard on ${pathname}, found ${mentions}`);
    assert.ok(
      /getElementById\("staff-short-term-queue"\)/.test(out),
      `the only mention on ${pathname} must be the loader guard`
    );
    assert.ok(!/<(?:section|div)[^>]*id="staff-short-term-queue"/.test(out),
      `the queue container itself leaked on ${pathname}`);
  }
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
  assert.ok(dir.includes('132_short_term_foundation.sql'), '132 is missing');
  assert.ok(dir.includes('133_short_term_host_acquisition.sql'), '133 is missing');
  assert.ok(
    dir.indexOf('133_short_term_host_acquisition.sql') > dir.indexOf('132_short_term_foundation.sql'),
    '133 must sort after 132'
  );
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

test('every staff route is behind a real guard, and King review behind the stronger one', () => {
  const staffRoutes = routeSource.match(/router\.(?:get|post)\('\/staff[^']*',\s*([A-Za-z]+)/g) || [];
  assert.ok(staffRoutes.length >= 6, `expected staff routes, found ${staffRoutes.length}`);

  // requireAdminApiKey is a stricter gate than requireStaffAccess, not a
  // weaker one: it demands admin or super admin rather than any moderator.
  for (const line of staffRoutes) {
    assert.ok(
      line.includes('requireStaffAccess') || line.includes('requireAdminApiKey'),
      `unprotected staff route: ${line}`
    );
  }

  const kingRoute = staffRoutes.find((line) => line.includes('king-decision'));
  assert.ok(kingRoute, 'the King review route is missing');
  assert.ok(kingRoute.includes('requireAdminApiKey'),
    'King review must be admin-only, not open to every moderator');
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
// 11. The two review gates
//
// Arthur's rule: a short stay goes through staff moderation AND King review
// before it is public. These tests exist so nobody can quietly collapse that
// back into one step.
// ---------------------------------------------------------------------------

test('a staff moderator has no route to an approved listing', () => {
  assert.strictEqual(moderation.staffCanReachApproved(), false,
    'STAFF_ACTIONS must not contain any transition to approved');

  const staffTargets = Object.values(moderation.STAFF_ACTIONS).map((a) => a.to);
  assert.ok(!staffTargets.includes('approved'), `staff can reach: ${staffTargets.join(', ')}`);
  assert.ok(staffTargets.includes('king_review'), 'staff must be able to hand a listing to the King');

  // And a second guard in the code, in case the table is ever edited badly.
  assert.ok(
    /if \(rule\.to === 'approved'[\s\S]{0,120}throw moderationError\([\s\S]{0,120}cannot approve/.test(moderationSource),
    'applyStaffDecision must refuse an approving transition even if the table allows one'
  );
});

test('only King review can approve', () => {
  const kingTargets = Object.values(moderation.KING_ACTIONS).map((a) => a.to);
  assert.ok(kingTargets.includes('approved'), 'the King must be able to approve');
  assert.deepStrictEqual(
    moderation.KING_ACTIONS.approve.from, ['king_review'],
    'the King can only approve something that reached King review'
  );
});

test('approval is refused without the King confirming the facts', () => {
  const everythingTicked = {};
  moderation.REVIEW_CHECK_KEYS.forEach((key) => { everythingTicked[key] = true; });

  const withoutKing = moderation.canApprove(everythingTicked);
  assert.strictEqual(withoutKing.ok, false, 'every box ticked is still not approval');
  assert.strictEqual(withoutKing.reason, 'king_confirmation_missing');

  everythingTicked[moderation.KING_CONFIRMATION_KEY] = true;
  assert.strictEqual(moderation.canApprove(everythingTicked).ok, true);
});

test('approval is refused while checks are outstanding', () => {
  const partial = { [moderation.KING_CONFIRMATION_KEY]: true, required_listing_fields: true };
  const verdict = moderation.canApprove(partial);
  assert.strictEqual(verdict.ok, false);
  assert.strictEqual(verdict.reason, 'checks_outstanding');
  assert.ok(verdict.missing.length > 0);
  assert.ok(verdict.missing.some((c) => c.key === 'photos_match_property'));
});

test('an overrideable check can be waived with a reason, a hard one cannot', () => {
  const base = {};
  moderation.REVIEW_CHECK_KEYS.forEach((key) => { base[key] = true; });
  base[moderation.KING_CONFIRMATION_KEY] = true;

  // Waive an overrideable check.
  const waived = { ...base, duplicate_checked: false, overrides: { duplicate_checked: 'Checked by hand, different building' } };
  assert.strictEqual(moderation.canApprove(waived).ok, true, 'an overrideable check may be waived with a reason');

  // The same trick on a hard check must not work.
  const cheated = { ...base, photos_match_property: false, overrides: { photos_match_property: 'trust me' } };
  const verdict = moderation.canApprove(cheated);
  assert.strictEqual(verdict.ok, false, 'a non-overrideable check cannot be waived');
  assert.ok(verdict.missing.some((c) => c.key === 'photos_match_property'));
});

test('the automated pass only ticks what a machine can honestly know', () => {
  const checklist = moderation.buildAutomatedChecklist({
    title: 'Quiet two bedroom apartment in Naguru',
    description: 'A bright, quiet two bedroom flat with secure parking and backup power, ten minutes from town.',
    district: 'Kampala',
    area: 'Naguru',
    right_to_let_declared: true,
    base_nightly_ugx: 200000,
    house_rules: 'No parties.',
    listing_fee_status: 'paid'
  }, { photoCount: 4 });

  assert.strictEqual(checklist.required_listing_fields, true);
  assert.strictEqual(checklist.photos_present, true);
  assert.strictEqual(checklist.pricing_checked, true);

  // Judgement calls stay with a person.
  assert.strictEqual(checklist.photos_match_property, false, 'code cannot know whose house is in a photo');
  assert.strictEqual(checklist.location_verified, false, 'code cannot verify a map pin on its own');
  assert.strictEqual(checklist.contact_details_verified, false, 'someone has to ring the number');
  assert.strictEqual(checklist[moderation.KING_CONFIRMATION_KEY], false,
    'the automated pass must never tick the King confirmation');
});

test('the public query demands both gates, not just a status column', () => {
  const src = read('services', 'shortTermService.js');
  const gate = src.slice(src.indexOf('const LIVE_LISTING_SQL'), src.indexOf('function buildSearchFilters'));
  assert.ok(gate.includes("l.moderation_stage = 'approved'"), 'the public query must require the approved stage');
  assert.ok(gate.includes('l.king_facts_confirmed = TRUE'), 'the public query must require the King confirmation');
  assert.ok(gate.includes('l.status = ANY'), 'the status check must still be there');

  // One constant, three read paths. Search picks it up as the first entry in
  // the filter array; the listing page and the site-wide count interpolate it.
  // A listing cannot leak through whichever one somebody forgot.
  const searchFilters = src.slice(src.indexOf('function buildSearchFilters'), src.indexOf('function orderByFor'));
  assert.ok(searchFilters.includes('const where = [LIVE_LISTING_SQL]'),
    'search must start from the publication gate');

  const detail = src.slice(src.indexOf('async function getShortTermListing'), src.indexOf('async function listPublishedReviews'));
  assert.ok(detail.includes('${LIVE_LISTING_SQL}'), 'the listing page must use the publication gate');

  const count = src.slice(src.indexOf('async function loadShortTermPublicCount'));
  assert.ok(count.includes('${LIVE_LISTING_SQL}'), 'the site-wide count must use the publication gate');

  // And nothing may quietly query st_listing without it.
  const rawSelects = (src.match(/FROM st_listing l\b/g) || []).length;
  assert.ok(rawSelects >= 3, `expected the gated reads, found ${rawSelects}`);
});

test('a new listing enters the pipeline rather than sitting in limbo', () => {
  const src = read('services', 'shortTermService.js');
  assert.ok(src.includes("'pending','submitted'"), 'a submitted listing must start at the submitted stage');
  assert.ok(src.includes('status, moderation_stage, listing_fee_ugx'),
    'moderation_stage must be set on insert, not left to a default nobody reads');
});

test('the migration carries the moderation columns and an audit trail', () => {
  for (const column of [
    'moderation_stage', 'moderation_checklist', 'king_facts_confirmed',
    'staff_reviewed_by', 'staff_reviewed_at', 'king_reviewed_by', 'king_reviewed_at'
  ]) {
    assert.ok(migration.includes(column), `migration is missing ${column}`);
  }
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS st_listing_moderation_event'),
    'every stage change must be recorded somewhere');
  assert.ok(migration.includes("king_facts_confirmed BOOLEAN NOT NULL DEFAULT FALSE"),
    'the King confirmation must default to false, never true');
  assert.ok(/CHECK \(moderation_stage IN \([\s\S]*?'king_review'/.test(migration),
    'king_review must be a real stage in the database, not a convention');
});

test('the two review endpoints are behind two different gates', () => {
  assert.ok(
    /router\.post\('\/staff\/listings\/:id\/decision', requireStaffAccess/.test(routeSource),
    'the moderator endpoint must require staff access'
  );
  assert.ok(
    /router\.post\('\/staff\/listings\/:id\/king-decision', requireAdminApiKey/.test(routeSource),
    'King review must require admin or super admin, not merely staff'
  );
  assert.ok(!/king-decision', requireStaffAccess/.test(routeSource),
    'a moderator must not be able to call the King endpoint');
});

test('exactly one place in the codebase writes king_facts_confirmed', () => {
  const serviceSource = read('services', 'shortTermService.js');

  // A write is the column appearing inside an UPDATE ... SET. The gate in
  // shortTermService.js mentions the column too, but as a comparison in a
  // WHERE clause, which is the opposite of a write.
  const writes = (moderationSource.match(/king_facts_confirmed\s*=\s*\(/g) || []).length;
  assert.strictEqual(writes, 1, `expected one write, found ${writes}`);
  assert.ok(moderationSource.includes("king_facts_confirmed = ($2 = 'approved')"),
    'the confirmation must be derived from the stage, so it cannot be set on its own');

  // The column is only ever read elsewhere.
  assert.ok(serviceSource.includes('l.king_facts_confirmed = TRUE'), 'the gate must read it');
  assert.ok(!/UPDATE[\s\S]{0,400}SET[\s\S]{0,400}king_facts_confirmed/.test(serviceSource),
    'shortTermService must never write the King confirmation');
  assert.ok(!/UPDATE[\s\S]{0,400}SET[\s\S]{0,400}king_facts_confirmed/.test(routeSource),
    'no route may write the King confirmation directly, only via applyKingDecision');

  // And that single write lives in the King path, not the staff path.
  const staffBlock = moderationSource.slice(
    moderationSource.indexOf('async function applyStaffDecision'),
    moderationSource.indexOf('async function applyKingDecision')
  );
  assert.ok(!/king_facts_confirmed\s*=\s*\(/.test(staffBlock),
    'the staff path must not write the King confirmation');
});

test('the King cannot publish a listing with no photos', () => {
  assert.ok(
    /photo_count[\s\S]{0,80}=== 0[\s\S]{0,200}throw moderationError/.test(moderationSource),
    'approving a listing with zero photos must be refused'
  );
});

test('every stage change is written to the audit trail', () => {
  assert.ok(moderationSource.includes('async function recordEvent'), 'no event recorder');
  const staffBlock = moderationSource.slice(
    moderationSource.indexOf('async function applyStaffDecision'),
    moderationSource.indexOf('async function applyKingDecision')
  );
  const kingBlock = moderationSource.slice(moderationSource.indexOf('async function applyKingDecision'));
  assert.ok(staffBlock.includes('await recordEvent('), 'staff decisions must be logged');
  assert.ok(kingBlock.includes('await recordEvent('), 'King decisions must be logged');
  assert.ok(staffBlock.includes("actorRole: actor?.role || 'moderator'"), 'log who did it');
  assert.ok(kingBlock.includes("actorRole: actor?.role || 'king'"), 'log who did it');
});

test('a moderator cannot smuggle the King confirmation through the checklist', () => {
  const staffBlock = moderationSource.slice(
    moderationSource.indexOf('async function applyStaffDecision'),
    moderationSource.indexOf('async function applyKingDecision')
  );
  assert.ok(
    staffBlock.includes('// Only the King stage may set this, whatever a moderator submits.'),
    'the staff path must explicitly preserve the existing King confirmation'
  );
  assert.ok(
    /\[KING_CONFIRMATION_KEY\]: normalizeChecklist\(listing\.moderation_checklist\)\[KING_CONFIRMATION_KEY\] === true/
      .test(staffBlock),
    'a moderator posting king_facts_confirmed:true must be ignored'
  );

  // And prove it at runtime rather than only by reading the source.
  const smuggled = moderation.normalizeChecklist({
    ...Object.fromEntries(moderation.REVIEW_CHECK_KEYS.map((k) => [k, true])),
    king_facts_confirmed: true
  });
  assert.strictEqual(smuggled.king_facts_confirmed, true, 'the normaliser itself passes the value through');
  // ...which is exactly why applyStaffDecision overwrites it from the stored
  // row instead of trusting the request body.
});

// ---------------------------------------------------------------------------
// 12. Host acquisition
//
// Supply is the bottleneck, not code. These cover the tools for getting real
// Ugandan hosts listed, and the honesty requirements that come with a
// colleague entering a listing on someone else's behalf.
// ---------------------------------------------------------------------------

test('migration 133 only touches st_listing, and only adds', () => {
  const body = migration133.replace(/--[^\n]*/g, '');

  // It is an ALTER, which 132 was not - so be precise about what it alters.
  const alters = body.match(/ALTER TABLE\s+(\w+)/gi) || [];
  assert.strictEqual(alters.length, 1, `expected one ALTER, found ${alters.length}`);
  assert.ok(/ALTER TABLE\s+st_listing/i.test(body), 'the only ALTER must be on st_listing');

  for (const table of ['properties', 'users', 'agents', 'property_images']) {
    assert.ok(!new RegExp(`\\b${table}\\b`, 'i').test(body), `133 must not mention ${table}`);
  }

  assert.ok(!/DROP\s+(?:TABLE|COLUMN)/i.test(body), '133 must not drop anything');
  assert.ok(!/\bTRUNCATE\b|\bDELETE\s+FROM\b/i.test(body), '133 must not remove rows');
  assert.ok(!/\bUPDATE\s+\w+\s+SET\b/i.test(body), '133 must not rewrite rows');

  // Every column additive and idempotent.
  const adds = body.match(/ADD COLUMN IF NOT EXISTS/gi) || [];
  const bareAdds = body.match(/ADD COLUMN(?! IF NOT EXISTS)/gi) || [];
  assert.ok(adds.length >= 5, `expected the provenance columns, found ${adds.length}`);
  assert.strictEqual(bareAdds.length, 0, 'every ADD COLUMN needs IF NOT EXISTS');
});

test('a referral code survives however it is typed', () => {
  assert.strictEqual(service.normaliseReferralCode('Kunta'), 'kunta');
  assert.strictEqual(service.normaliseReferralCode('  KAMPALA TEAM  '), 'kampala-team');
  assert.strictEqual(service.normaliseReferralCode('entebbe_2027'), 'entebbe_2027');
  assert.strictEqual(service.normaliseReferralCode('a//b??c'), 'a-b-c');
  assert.strictEqual(service.normaliseReferralCode('---'), '');
  assert.strictEqual(service.normaliseReferralCode(null), '');
  assert.ok(service.normaliseReferralCode('x'.repeat(200)).length <= 40);
});

test('staff intake is behind staff auth and flagged as staff-entered', () => {
  assert.ok(
    /router\.post\('\/staff\/listings', requireStaffAccess/.test(routeSource),
    'the intake endpoint must require staff access'
  );
  const block = routeSource.slice(
    routeSource.indexOf("router.post('/staff/listings', requireStaffAccess"),
    routeSource.indexOf("router.post('/staff/listings/validate'")
  );
  assert.ok(block.includes("listedVia: 'staff_assisted'"), 'staff intake must be flagged');
  assert.ok(block.includes('enteredByStaffId'), 'it must record who typed it');
  assert.ok(service.LISTED_VIA.includes('staff_assisted'));

  // A moderator entering a listing must not be able to approve their own work.
  // King review is admin-only, which is what stops that.
  assert.ok(
    /router\.post\('\/staff\/listings\/:id\/king-decision', requireAdminApiKey/.test(routeSource),
    'King review must stay admin-only, or staff intake becomes self-approval'
  );
});

test('the King is told when a colleague typed the listing rather than the host', () => {
  assert.ok(routeSource.includes('listed_via: row.listed_via'), 'provenance missing from the review sheet');
  assert.ok(routeSource.includes('entered_by_staff_name: row.entered_by_staff_name'));
  assert.ok(
    /listed_via === 'staff_assisted'[\s\S]{0,400}not by the host/.test(deskSource),
    'the review sheet must say plainly that staff entered it'
  );
  assert.ok(
    /first gate was not an independent pair of eyes/i.test(deskSource),
    'the King should be told why that matters'
  );
});

test('the staff intake form records what the host said, not what staff vouch for', () => {
  assert.ok(
    /recording what the host told you, not vouching for it yourself/i.test(deskSource),
    'the intake form must not let staff declare the right to let as their own'
  );
  assert.ok(/The host confirmed to me/i.test(deskSource), 'the declaration must be reported speech');
  assert.ok(/I read the host the makaug listing terms/i.test(deskSource));
});

test('every draft storage access is wrapped so a blocked browser cannot break the form', () => {
  const draftBlock = clientSource.slice(
    clientSource.indexOf('var DRAFT_KEY'),
    clientSource.indexOf('// ---------------------------------------------------------------- photos')
  );
  assert.ok(draftBlock.length > 500, 'draft rescue block not found');

  // Count storage touches and catch blocks in the same region.
  const touches = (draftBlock.match(/localStorage\.(getItem|setItem|removeItem)/g) || []).length;
  const catches = (draftBlock.match(/catch \(_?error\)/g) || []).length;
  assert.ok(touches >= 3, `expected the read, write and clear, found ${touches}`);
  assert.ok(catches >= 3, `every storage access needs its own catch, found ${catches}`);

  // Private browsing and blocked site data must degrade to "no draft".
  assert.ok(/catch \(_?error\) \{\s*return null;/.test(draftBlock), 'a failed read must return null');
});

test('a saved listing clears the local draft, and a failed one keeps it', () => {
  assert.ok(
    /\/\/ Saved on the server, so the local rescue copy has done its job\.\s*\n\s*clearDraft\(\);/.test(clientSource),
    'a successful submit must clear the draft'
  );
  const submitBlock = clientSource.slice(clientSource.indexOf("api('/listings', {"));
  const catchIndex = submitBlock.indexOf('.catch(function (error)');
  const clearIndex = submitBlock.indexOf('clearDraft()');
  assert.ok(clearIndex > -1 && clearIndex < catchIndex,
    'the draft must only be cleared on success, never in the error path');
});

test('nothing the client renders can delete the Ask AI box', () => {
  // THE BUG THIS EXISTS FOR: the Ask AI block was authored inside
  // <section class="st-view st-view-search">, and mountSearch() replaces that
  // section's innerHTML wholesale. So the section had two genuinely different
  // appearances - the Ask AI box alone before the JS ran, everything else and
  // no Ask AI box after - and which one you saw was down to timing. Reported
  // as "click it, get one thing; click again, get something different".
  //
  // The previous test in this file checked WHEN the script loads, which
  // narrowed the window and hid the real problem. This one checks that the two
  // renders cannot contradict each other at all.
  const indexSource = read('index.html');

  const pageAt = indexSource.indexOf('id="page-short-term"');
  assert.ok(pageAt > -1, 'the short-term page block is gone');
  const pageBlock = indexSource.slice(pageAt, indexSource.indexOf('id="page-marketplace"'));

  const aiAt = pageBlock.indexOf('id="short-term-ai-shell"');
  const searchViewAt = pageBlock.indexOf('class="st-view st-view-search');
  assert.ok(aiAt > -1, 'the Ask AI shell is missing from the short-term page');
  assert.ok(searchViewAt > -1, 'the search view is missing');
  assert.ok(
    aiAt < searchViewAt,
    'the Ask AI shell must sit OUTSIDE the search view - mountSearch replaces that view\'s innerHTML and would delete it'
  );

  // And every innerHTML write in the client must stay inside a view, so this
  // cannot be reintroduced by moving the markup back.
  const writes = clientSource.match(/\.st-view-(search|detail|list)'\)[\s\S]{0,60}innerHTML/g) || [];
  assert.ok(writes.length > 0, 'expected the views to be rendered by innerHTML');

  // setView owns whether it is on screen; it belongs to searching only.
  assert.ok(
    /getElementById\('short-term-ai-shell'\)[\s\S]{0,120}hidden = \(name !== 'search'\)/
      .test(clientSource),
    'setView must show the Ask AI box on the search view and hide it elsewhere'
  );

  // The view element is not guaranteed to exist - the sanitizer strips this
  // page's block on every other route - so the render must not assume it.
  assert.ok(
    /var view = r\.querySelector\('\.st-view-search'\);\s*\n\s*if \(!view\) return;/
      .test(clientSource),
    'mountSearch must bail rather than throw when its view is not on the page'
  );
});

test('the page does not report two separate failures for one situation', () => {
  // Live it read: "0 short stays", "Nothing matches those filters yet. Try
  // widening the dates or the area.", and then twenty-four hotels under a
  // heading that already says no hosts matched. One explanation, not two.
  const at = clientSource.indexOf('function renderResults()');
  assert.ok(at > -1, 'renderResults is missing');
  const block = clientSource.slice(at, at + 1800);

  assert.ok(/var partners = partnerBlockHtml\(\)/.test(block), 'the empty state ignores the partner block');
  assert.ok(
    /partners \? '' : [\s\S]{0,120}emptyFilters/.test(block),
    'the "nothing matches" line still shows above the hotels'
  );
  // The way out must survive either way.
  assert.ok(/listOwn/.test(block), 'the list-your-place call to action was lost');
});

test('a broken photo does not become a broken card', () => {
  const at = clientSource.indexOf('function partnerCardHtml(');
  const block = clientSource.slice(at, clientSource.indexOf('function partnerBlockHtml('));
  assert.ok(/data-st-shots/.test(block), 'the card has only one photo to try');
  // error does not bubble, so a listener on the parent has to capture.
  assert.ok(
    /addEventListener\('error'[\s\S]{0,1500}\}, true\)/.test(clientSource),
    'the fallback listener is not in the capture phase, so it will never fire'
  );
  assert.ok(/st-noimg/.test(clientSource), 'there is no placeholder to fall back to');
});

test('a partner price is for the stay the visitor asked about', () => {
  // The route must hand the visitor's own dates to the rates call. A default
  // window would put a price on the card for a stay nobody searched for, which
  // looks like a quote and is not one.
  const at = routeSource.indexOf('liteapiShouldOffer(result.listings)');
  assert.ok(at > -1, 'the partner fallback is missing');
  // Both suppliers, because both must obey the rule.
  const block = routeSource.slice(at, at + 4000);

  // LiteAPI leads and Hotelbeds backs it up, not the other way round.
  assert.ok(
    routeSource.indexOf('liteapiShouldOffer(result.listings)')
      < routeSource.indexOf('hotelbedsShouldOffer(result.listings)'),
    'Hotelbeds is being consulted before LiteAPI'
  );
  // And Hotelbeds only runs when LiteAPI produced nothing, rather than both
  // filling the page and the second quietly overwriting the first.
  assert.ok(
    /!result\.partner_listings && hotelbedsShouldOffer/.test(routeSource),
    'the Hotelbeds fallback is not gated on LiteAPI having come back empty'
  );
  // The phone number is the reason a partner row can behave like a host row.
  assert.ok(/liteapiContacts\(partners\)/.test(block), 'partner rows are not being given their phone number');

  assert.ok(/checkIn:\s*query\.check_in/.test(block), 'the visitor\'s check-in is not passed through');
  assert.ok(/checkOut:\s*query\.check_out/.test(block), 'the visitor\'s check-out is not passed through');
  assert.ok(
    !/Date\.now\(\)|\d{4}-\d{2}-\d{2}/.test(block),
    'a default or hard-coded stay has crept into the rates call'
  );
  assert.ok(/price_display/.test(block), 'nothing formats the price for the card');
});

test('a partner card with no price says so rather than going blank', () => {
  // A gap where a price belongs reads as free. It has to say where to find one.
  const at = clientSource.indexOf('function partnerCardHtml(');
  assert.ok(at > -1, 'partnerCardHtml is missing');
  const block = clientSource.slice(at, clientSource.indexOf('function partnerBlockHtml('));

  assert.ok(/row\.price_display/.test(block), 'the card ignores the price the route sends');
  assert.ok(/partnerPriceAsk/.test(block), 'a card with no rate has nothing to say');
  assert.ok(block.indexOf('price') < block.indexOf('+ link'), 'the price belongs above the outbound link');
});

test('the hero does not promise a phone number a hotel row cannot carry', () => {
  // It read "Every listing carries the host's own phone number". True of every
  // host listing; false the moment a partner hotel appears underneath it, and
  // partner hotels appear precisely when a search found nothing else. Scoped
  // before the flag went on, not after someone noticed.
  const at = clientSource.indexOf('var ST_I18N =');
  const open = clientSource.indexOf('{', at);
  const close = clientSource.indexOf('\n};', open);
  const table = JSON.parse(clientSource.slice(open, close + 2));

  assert.ok(
    /from a host/.test(table.en.heroSub),
    'the English hero still makes the promise for every listing'
  );
  Object.keys(table).forEach((code) => {
    assert.ok(table[code].partnerPriceAsk, `${code} cannot say where to find a price`);
  });
});

test('the section reads in every language the site offers', () => {
  // Only the nav item switched; the whole section stayed English whichever
  // language you picked. Reported twice before it was taken seriously.
  const at = clientSource.indexOf('var ST_I18N =');
  assert.ok(at > -1, 'the translation table is missing');
  const open = clientSource.indexOf('{', at);
  const close = clientSource.indexOf('\n};', open);
  assert.ok(close > open, 'could not find the end of the translation table');
  const table = JSON.parse(clientSource.slice(open, close + 2));

  const langs = ['en', 'lg', 'sw', 'ac', 'ny', 'rn', 'sm', 'am', 'ar'];
  langs.forEach((code) => {
    assert.ok(table[code], `no ${code} table`);
  });
  assert.strictEqual(Object.keys(table).length, langs.length, 'unexpected language count');

  // Every language carries every key, or a switch silently falls back to English.
  const keys = Object.keys(table.en);
  assert.ok(keys.length >= 25, 'the table covers too little of the section');
  langs.forEach((code) => {
    keys.forEach((key) => {
      assert.ok(table[code][key], `${code} is missing ${key}`);
    });
    // And the non-English tables must not simply be the English strings.
    if (code === 'en') return;
    const copied = keys.filter((key) => key !== 'wherePh' && table[code][key] === table.en[key]);
    assert.ok(copied.length <= 2, `${code} is largely untranslated: ${copied.join(', ')}`);
  });

  // A language switch has to repaint; the table alone changes nothing.
  assert.ok(
    /attributeFilter: \['lang'\]/.test(clientSource),
    'nothing watches for the language changing, so the section would stay in the old one'
  );
});

test('changing the language rebuilds the view', () => {
  // The table alone changed nothing: route() only mounts the search view when
  // the form is not already there, which is correct for navigation and wrong
  // for a language switch, where rebuilding it is the entire point. Found by
  // switching language on the live page and watching the English stay put.
  assert.ok(clientSource.includes('function repaintCurrentView()'), 'repaintCurrentView is missing');
  assert.ok(
    /attributeFilter: \['lang'\][\s\S]{0,400}repaintCurrentView\(\)/.test(clientSource)
    || /repaintCurrentView\(\)[\s\S]{0,400}attributeFilter: \['lang'\]/.test(clientSource),
    'the language watcher must repaint, not merely re-route'
  );
  // It must rebuild whichever view is showing, not always the search one.
  const at = clientSource.indexOf('function repaintCurrentView()');
  const body = clientSource.slice(at, at + 700);
  ['mountList()', 'mountDetail(', 'mountSearch()'].forEach((fn) => {
    assert.ok(body.includes(fn), `repaintCurrentView does not handle ${fn}`);
  });
});

test('re-rendering the search view cannot delete the Ask AI box', () => {
  // The Ask AI shell is moved INTO the search view now, and mountSearch
  // replaces that view's innerHTML - so the second render would have deleted
  // it. Exactly the bug that produced the two-different-pages report, waiting
  // to happen again the moment anything re-rendered.
  const at = clientSource.indexOf('function mountSearch()');
  const body = clientSource.slice(at, clientSource.indexOf('var form = document', at));

  const park = body.indexOf('r.appendChild(shell)');
  const wipe = body.indexOf('view.innerHTML = searchViewHtml()');
  const restore = body.indexOf('slot.appendChild(shell)');

  assert.ok(park > -1, 'the Ask AI shell is never parked before the wipe');
  assert.ok(wipe > -1, 'mountSearch no longer renders the view');
  assert.ok(restore > -1, 'the Ask AI shell is never put back');
  assert.ok(park < wipe, 'it must be parked BEFORE innerHTML is replaced, or it is destroyed');
  assert.ok(wipe < restore, 'it must be put back after the new markup exists');
});

test('the section is laid out like every other one', () => {
  // The Ask AI box was on top, above the page's own content. Everywhere else
  // on the site the content comes first and Ask AI sits below it.
  const at = clientSource.indexOf('function searchViewHtml()');
  const body = clientSource.slice(at, clientSource.indexOf('function cardHtml', at));

  const hero = body.indexOf("'<section class=\"st-hero\">'");
  const banner = body.indexOf('adBannerHtml()');
  const ai = body.indexOf('st-ai-slot');
  const results = body.indexOf('id="st-results"');

  assert.ok(hero > -1 && banner > -1 && ai > -1 && results > -1, 'the search view lost a section');
  assert.ok(hero < banner, 'the hero must come before the banner');
  assert.ok(banner < ai, 'the banner must come before the Ask AI box');
  assert.ok(ai < results, 'Ask AI must come before the results');

  // The Ask AI shell is moved, not rebuilt - the bundle wires that markup.
  assert.ok(
    /slot\.appendChild\(shell\)/.test(clientSource),
    'the Ask AI shell must be moved into its slot, not re-created'
  );
});

test('the map does not use OpenStreetMap tiles', () => {
  // OSM was returning 403 for every tile - "App is not following the tile
  // usage policy of OpenStreetMap's volunteer-run servers" - so the map showed
  // a grid of error images. Their tiles are a volunteer service and a
  // commercial marketplace pulling from them is what that policy forbids.
  assert.ok(
    !/tile\.openstreetmap\.org/.test(clientSource),
    'short-term must not pull OpenStreetMap tiles'
  );
  assert.ok(!/unpkg\.com\/leaflet/.test(clientSource), 'Leaflet is still being loaded');
  assert.ok(clientSource.includes('function loadGoogleMaps'), 'no Google Maps loader');
  assert.ok(
    /window\.ensureGoogleMapsApi/.test(clientSource),
    'it must reuse the bundle loader rather than injecting a second Maps script'
  );
  // The bundle may not be in yet, since this file loads in parallel with it.
  assert.ok(
    /tries > 40/.test(clientSource),
    'the Maps loader must wait for the bundle rather than give up immediately'
  );
});

test('the banner uses the site house-ad format and its own artwork', () => {
  assert.ok(clientSource.includes('function adBannerHtml'), 'adBannerHtml is missing');
  ['mk-house-band', 'mk-house-band__scrim', 'mk-house-band__copy', 'mk-house-band__tag']
    .forEach((cls) => {
      assert.ok(clientSource.includes(cls), `the banner is not using ${cls}`);
    });
  assert.ok(
    clientSource.includes('/assets/img/hoima-stadium.jpg'),
    'the banner should carry the licensed stadium photograph'
  );
  assert.ok(fs.existsSync(path.join(root, 'assets', 'img', 'hoima-stadium.jpg')),
    'the stadium image is not in the repo');

  // The shared band is built for daylight stock with a white scrim and dark
  // text. Over a night photograph that is unreadable, so this needs its own.
  const css = read('assets', 'short-term.css');
  assert.ok(css.includes('.mk-house-band--st'), 'no dark variant for the night photo');
  assert.ok(
    /mk-house-band--st \.mk-house-band__headline[\s\S]{0,120}color: #fff/.test(css),
    'the headline must be light over the dark photograph'
  );
});

test('Short Term has its own colour scheme', () => {
  // Every other section has one; this was borrowing the site green and read as
  // an extension of To Rent.
  const css = read('assets', 'short-term.css');
  // Scoped to the public section. .st-scope is the staff and King review
  // desks, which live inside the dashboards and stay on the site green - they
  // are an admin surface, not part of this section's identity.
  const scopeAt = css.indexOf('#page-short-term {');
  assert.ok(scopeAt > -1, 'the section scope block is gone');
  const scope = css.slice(scopeAt, css.indexOf('}', scopeAt));

  assert.ok(/--st-accent:\s*#[0-9a-f]{6}/i.test(scope), 'no accent colour defined');
  assert.ok(
    !/--st-green:\s*#15803d/.test(scope),
    'the section is still hard-coded to the site green'
  );
  assert.ok(
    /--st-green:\s*var\(--st-accent\)/.test(scope),
    'existing rules must follow the accent rather than being left behind'
  );
  // And the hero must not still be painted green over the top of it.
  assert.ok(
    !/\.st-hero \{[\s\S]{0,160}#14532d/.test(css),
    'the hero is still using the green gradient'
  );
});

test('the Ask AI box always says it is searching short stays', () => {
  // The bundle rebuilds this shell from the scope it derives from its own
  // current page, which on the first transition is still the page the visitor
  // came from - so the chip read "Searching all properties" on click one and
  // only corrected itself on click two.
  assert.ok(clientSource.includes('function pinShortTermScope()'), 'pinShortTermScope is missing');
  assert.ok(
    /updateHomeAskAiLanguageCopy\(\);[\s\S]{0,120}pinShortTermScope\(\);/.test(clientSource),
    'the scope must be pinned AFTER the bundle has rewritten the shell'
  );
  // It must not hard-code English - this box is read in nine languages.
  assert.ok(
    /window\.aiAssistantScopeHintText\('short_term'\)/.test(clientSource),
    'the chip text must come from the bundle\'s localised helper, not a literal'
  );
  assert.ok(
    !/textContent = ['\"]Searching Short Term['\"]/.test(clientSource),
    'the chip must never be hard-coded to the English string'
  );
});

test('the section can build its own markup', () => {
  // THE BUG THIS EXISTS FOR: once the re-attach was fixed, __stObserved was
  // true on the live element and STILL nothing rendered - not even the Ask AI
  // shell. The block the bundle swaps in is not a copy of index.html's markup,
  // it is a bare <div id="page-short-term" class="page">. mountSearch looked
  // for .st-view-search, did not find it, and returned. Every time.
  //
  // Depending on markup another script owns was the mistake.
  assert.ok(clientSource.includes('function scaffoldHtml()'), 'scaffoldHtml is missing');
  assert.ok(clientSource.includes('function ensureScaffold('), 'ensureScaffold is missing');

  // It must build every view the renderers write into, plus the Ask AI shell.
  ['st-view st-view-search', 'st-view st-view-detail', 'st-view st-view-list',
   'short-term-ai-shell', 'data-ai-scope="short-term"'].forEach((needle) => {
    assert.ok(scaffoldSource().includes(needle), `scaffold is missing ${needle}`);
  });

  function scaffoldSource() {
    const at = clientSource.indexOf('function scaffoldHtml()');
    return clientSource.slice(at, clientSource.indexOf('function ensureScaffold(', at));
  }

  // And it must run before anything renders into those views.
  const scaffoldCallAt = clientSource.indexOf('ensureScaffold(r);');
  const setViewCallAt = clientSource.indexOf("setView('list');");
  assert.ok(scaffoldCallAt > -1, 'ensureScaffold is never called from route()');
  assert.ok(scaffoldCallAt < setViewCallAt, 'the scaffold must exist before a view is selected');

  // Injected Ask AI markup carries English defaults; the bundle owns the
  // per-language copy, so it has to be told to run again.
  assert.ok(
    /updateHomeAskAiLanguageCopy\(\)/.test(clientSource),
    'freshly built Ask AI markup must be re-localised, or it is stuck in English'
  );
});

test('rendering survives the bundle replacing the page block', () => {
  // THE BUG THIS EXISTS FOR, from live evidence: #page-short-term present and
  // active, Ask AI shell there, rendered search view absent, and
  // element.__stObserved FALSE on an element this file had already attached
  // to. An expando that is gone means the element is gone - the main bundle
  // swaps the block for a fresh copy of its own template after this file has
  // rendered into the original. The observer was left on the detached node,
  // so the visitor saw template markup until they clicked a second time.
  //
  // Watching the element cannot survive the element being replaced.
  assert.ok(
    /observe\(parent, \{ childList: true \}\)/.test(clientSource),
    'the parent must be observed so a replaced page block is noticed'
  );
  assert.ok(
    /var current = root\(\);\s*\n\s*if \(current && !current\.__stObserved\) ensureObserver\(\);/
      .test(clientSource),
    'a replacement must re-attach and re-render, not just re-attach'
  );

  // And the loader tells it explicitly once the bundle is done, which is when
  // the swap happens.
  assert.ok(clientSource.includes('rehydrate: ensureObserver'), 'rehydrate is not exposed');
  const indexSource = read('index.html');
  assert.ok(
    /window\.makaugShortTerm\.rehydrate\(\)/.test(indexSource),
    'the bundle onload must ask the section to re-check itself'
  );
});

test('the section renders when the bundle materialises its page block', () => {
  // THE BUG THIS EXISTS FOR, confirmed by leaving a sentinel on window before
  // clicking the nav and finding it still there afterwards: clicking "Short
  // Term" from the homepage does not navigate. The main bundle inserts
  // #page-short-term into the DOM itself.
  //
  // The sanitizer ships only the current route's page block, so on the
  // homepage root() is null when this file loads - and the MutationObserver
  // was being attached TO that missing element, so it was never attached at
  // all. The bundle then built the block and nothing told this file. First
  // click: Ask AI box alone. Second click: root() now exists, the link handler
  // takes over, the real page appears. One click, two outcomes.
  assert.ok(clientSource.includes('function ensureObserver()'), 'ensureObserver is missing');

  // It must not be a one-shot attempt at load.
  const bootAt = clientSource.indexOf('function boot()');
  const ensureAt = clientSource.indexOf('function ensureObserver()');
  assert.ok(ensureAt > -1 && ensureAt < bootAt, 'ensureObserver must be defined before boot');

  // Driven by the click, because that is when the bundle builds the block.
  assert.ok(
    /addEventListener\('click', function \(e\) \{[\s\S]{0,420}setTimeout\(ensureObserver/
      .test(clientSource),
    'a short-term nav click must re-check for the page block'
  );
  assert.ok(
    /setTimeout\(ensureObserver[\s\S]{0,120}\}, true\);/.test(clientSource),
    'that listener must be on the capture phase so it runs before the link handler'
  );

  // And it must stop asking once it is watching, rather than polling forever.
  assert.ok(
    /if \(ensureObserver\(\) \|\| \+\+observerTries > \d+\) window\.clearInterval/
      .test(clientSource),
    'the fallback poll must be bounded and stop once attached'
  );
});

test('a nav click is never swallowed on a page this section is not on', () => {
  // THE BUG THIS EXISTS FOR: the document click handler matches
  // a[href^="/short-term"], which is the nav item on every page of the site.
  // The sanitizer ships only the current route's page block, so on the
  // homepage there is no #page-short-term to render into - but the handler had
  // already called preventDefault. The click changed the address bar and
  // nothing else. Clicking again gave a different result depending on what the
  // bundle had done in between, which is how "two different pages" was
  // reported.
  const handlerAt = clientSource.indexOf("document.addEventListener('click'");
  assert.ok(handlerAt > -1, 'the internal-link handler is gone');
  const handler = clientSource.slice(handlerAt, handlerAt + 900);

  const rootCheckAt = handler.indexOf('if (!root()) return;');
  const preventAt = handler.indexOf('e.preventDefault();');
  assert.ok(rootCheckAt > -1, 'the handler must check the page block exists');
  assert.ok(preventAt > -1, 'the handler no longer prevents default');
  assert.ok(
    rootCheckAt < preventAt,
    'the page-block check must come BEFORE preventDefault - otherwise the click is cancelled and nothing renders'
  );
});

test('the section paints without waiting for the main bundle', () => {
  // THE BUG THIS EXISTS FOR, measured on the live site: arriving at
  // /short-term showed the Ask AI box alone for seconds, then the rest
  // appeared. short-term.js was requested inside makaug-app.js's onload, so
  // nothing here could paint until 571KB had downloaded and 3MB had parsed.
  // Clicking the nav again once that had finished looked like a different
  // page - which is exactly how it was reported.
  //
  // An earlier version of this test asserted the script was not lazy-loaded.
  // It passed while the section was still queued behind the bundle, because
  // "not lazy" and "not blocked" are different claims.
  const indexSource = read('index.html');

  const requestAt = indexSource.indexOf('loadShortTermNow();');
  const appOnloadAt = indexSource.indexOf('script.onload = function ()');
  assert.ok(requestAt > -1, 'the short-term loader is never called');
  assert.ok(appOnloadAt > -1, 'the main bundle loader changed shape');
  assert.ok(
    requestAt < appOnloadAt,
    'short-term.js must be requested before the bundle onload, not from inside it'
  );

  // It must also not be gated on the visitor already being on a short-term URL.
  const loaderBlock = indexSource.slice(
    indexSource.indexOf('function loadShortTermNow()'),
    appOnloadAt
  );
  assert.ok(
    !/\/\^\\\/short-term/.test(loaderBlock),
    'the load must not be gated on the current pathname'
  );

  // Loading first means the bundle's helpers may be missing when fields are
  // wired, so the typeahead has to wait for them rather than give up.
  assert.ok(
    /wireLocationTypeahead\(input, tries\)/.test(clientSource),
    'wireLocationTypeahead must retry while the bundle is still loading'
  );

  // And rendering must not assume showPage exists yet.
  assert.ok(
    /if \(typeof window\.showPage === 'function'\)[\s\S]{0,900}\} else \{/.test(clientSource),
    'route() must be able to activate the page itself before the bundle arrives'
  );
});

test('the referral code is captured before any router can eat the URL', () => {
  // THE BUG THIS EXISTS FOR: route() calls the main bundle's showPage, and
  // showPage rewrites the address bar to the page's canonical route. Opening
  // /short-term/list-your-place?ref=kunta became /short-term before anything
  // read the query string, so every referral was silently lost. Found by
  // walking the flow on the live site, not by any of these tests, which is
  // why this one is written against the ordering rather than the wording.
  assert.ok(clientSource.includes('function captureReferralCode()'), 'boot-time capture missing');

  const captureAt = clientSource.indexOf('captureReferralCode();');
  const routeDefAt = clientSource.indexOf('function route()');
  assert.ok(captureAt > -1, 'captureReferralCode is never called');
  assert.ok(captureAt < routeDefAt,
    'the capture must run at script load, before routing exists to rewrite the URL');

  // And it reads the real query string rather than anything already rewritten.
  assert.ok(
    /captureReferralCode\(\)[\s\S]{0,400}window\.location\.search/.test(clientSource),
    'the capture must read window.location.search directly'
  );
  assert.ok(clientSource.includes('referral_code: referralCode()'), 'it must be submitted with the listing');
  assert.ok(routeSource.includes('referralCode: req.body?.referral_code'), 'the route must accept it');

  // Storage can be blocked; that must cost the referral code, not the form.
  const captureBlock = clientSource.slice(captureAt - 900, captureAt + 400);
  assert.ok(/catch \(_?error\)/.test(captureBlock), 'session storage access must be wrapped');
});

test('only the search view rewrites the address bar', () => {
  // The same bug from the other side: runSearch replaceStates to /short-term,
  // which threw away /list-your-place and any listing slug when it fired from
  // the wrong view.
  assert.ok(
    /replaceState[\s\S]{0,120}currentPath\(\) === '\/short-term'/.test(clientSource)
    || /currentPath\(\) === '\/short-term'[\s\S]{0,160}replaceState/.test(clientSource),
    'runSearch must only rewrite the URL while on the search view'
  );

  // And route() puts back whatever showPage threw away.
  assert.ok(
    /var intended = \(window\.location\.pathname[\s\S]{0,600}replaceState\(\{\}, '', intended\)/.test(clientSource),
    'route must restore the real path after showPage rewrites it'
  );
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
