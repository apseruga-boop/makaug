const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  buildPublicSeoSnapshot,
  canonicalLocationRouteSlug,
  categoryPageSeoMeta,
  sitemapEntries
} = require('../services/publicSeoService');

const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'assets', 'makaug-app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const admin = fs.readFileSync(path.join(root, 'routes', 'admin.js'), 'utf8');
const properties = fs.readFileSync(path.join(root, 'routes', 'properties.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'db', 'migrations', '110_k32_launch_traffic.sql'), 'utf8');

const snapshot = buildPublicSeoSnapshot([
  { id: 'sale-1', listing_type: 'sale', area: 'Ntinda', district: 'Kampala', updated_at: '2026-08-05T08:00:00.000Z' },
  { id: 'sale-2', listing_type: 'sale', area: 'Ntinda', district: 'Kampala', updated_at: '2026-08-05T08:01:00.000Z' },
  { id: 'rent-1', listing_type: 'rent', students_welcome: true, area: 'Makerere', district: 'Kampala' },
  { id: 'land-1', listing_type: 'land', area: 'Kira', district: 'Wakiso' }
]);

assert.equal(snapshot.counts.sale.get('kampala:ntinda'), 2, 'Ntinda sale count should use the canonical registry');
assert.equal(snapshot.counts.students.get('kampala:makerere'), 1, 'student-welcome rent should appear in student SEO counts');
assert.equal(canonicalLocationRouteSlug({ location: 'Ntinda', district: 'Kampala' }), 'ntinda-kampala');

const areaMeta = categoryPageSeoMeta('/for-sale/ntinda-kampala', snapshot);
assert(areaMeta, 'area metadata should resolve');
assert.equal(areaMeta.count, 2);
assert(areaMeta.title.includes('Ntinda, Kampala (2)'), 'area title should include location and honest count');
assert.equal(areaMeta.canonical, 'https://makaug.com/for-sale/ntinda-kampala');
assert.equal(areaMeta.image, 'https://makaug.com/assets/house-ads-v3/sale.webp');

const sitemap = sitemapEntries(snapshot);
assert(sitemap.some((entry) => entry.loc === 'https://makaug.com/for-sale/ntinda-kampala'));
assert(sitemap.some((entry) => entry.loc === 'https://makaug.com/property/sale-1'));
assert(!sitemap.some((entry) => entry.loc.includes('/to-rent/ntinda-kampala')), 'zero-count area/category combinations should not be published');

assert(server.includes("app.get('/robots.txt'"), 'robots route must be explicit');
assert(server.includes("app.get('/sitemap.xml'"), 'property sitemap route must be explicit');
assert(server.includes('patchPublicPageSeoMeta'), 'category and detail metadata must share one patcher');
assert(fs.readFileSync(path.join(root, 'services', 'publicSeoService.js'), 'utf8').includes("publicVisibleInventoryWhere('properties')"), 'SEO counts and sitemap must use the authoritative public predicate');
assert(server.includes('RealEstateListing'), 'detail pages should expose listing structured data');
assert(!server.includes('/assets/og-cover.jpg'), 'SEO metadata must not reference a missing fallback image');
assert(app.includes('Look at this on makaug.com:'), 'property share copy must use the launch wording');
assert(app.includes('utm_campaign", "property_share'), 'property shares must be attributed');
assert(app.includes('stripTransactionFromPropertyType'), 'duplicate sale/rent suffixes must be removed');
assert(app.includes('collapseDuplicateTransactionTitle'), 'stored card titles must collapse duplicate transaction wording');
assert(!app.includes('sale: "Home for sale"'), 'default sale subtype must not contain the transaction twice');
assert(properties.includes('collapseDuplicatePublicTransaction'), 'API-generated public titles must collapse duplicate transaction wording');
assert(properties.includes('WITH public_page_ids AS MATERIALIZED'), 'public card searches must limit indexed IDs before hydrating image data');
assert(server.includes('collapseDuplicatePublicTransaction'), 'detail SEO metadata must collapse duplicate transaction wording');
assert(app.includes('renderCanonicalSeoLandingIntro'), 'area routes need visible count and cross-links');
assert(admin.includes('unique_visitors_30m'), 'King needs a live 30-minute visitor count');
assert(admin.includes('traffic_sources'), 'King needs source/medium reporting');
assert(html.includes('admin-ai-visitors-live'), 'King launch traffic UI must render live visitors');
assert(html.includes('k32-launch-traffic-20260805'), 'K32 release marker must be present');
assert(server.includes('k32-launch-traffic-load-shed-20260805'), 'public warmup must expose the K32 load-shed marker');
assert(server.includes('k32-launch-warmup-opt-in-20260805'), 'public warmup must expose the opt-in marker');
assert(server.includes("process.env.PUBLIC_INVENTORY_CACHE_WARMUP || 'false'"), 'public warmup must be disabled unless explicitly enabled');
assert(fs.readFileSync(path.join(root, 'routes', 'ai.js'), 'utf8').includes('assistantSearchPrewarmInFlight'), 'Ask AI prewarm must never overlap itself');
assert(fs.readFileSync(path.join(root, 'routes', 'ai.js'), 'utf8').includes("process.env.ASSISTANT_SEARCH_PREWARM_ENABLED || 'false'"), 'Ask AI prewarm must be disabled unless explicitly enabled');
assert(migration.includes('idx_properties_public_price_desc_launch'));
assert(migration.includes('idx_analytics_events_launch_visitors'));

console.log('k32 launch traffic tests passed');
