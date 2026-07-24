const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const propertiesRoute = fs.readFileSync(path.join(root, 'routes/properties.js'), 'utf8');
const adminRoute = fs.readFileSync(path.join(root, 'routes/admin.js'), 'utf8');
const databaseConfig = fs.readFileSync(path.join(root, 'config/database.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const metricsService = fs.readFileSync(path.join(root, 'services/publicInventoryMetricsService.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'db/migrations/077_properties_list_count_performance.sql'), 'utf8');
const exactCountMigration = fs.readFileSync(path.join(root, 'db/migrations/092_public_inventory_exact_count_index.sql'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

assert(
  propertiesRoute.includes("loadPublicOpportunitySummary"),
  'properties list/count route should use the bounded public inventory summary helper'
);
assert(
  propertiesRoute.includes("X-Makaug-Properties-Count-Marker"),
  'summary_only responses should expose the fast-count marker header'
);
assert(
  propertiesRoute.includes('const fastPublicCardFields = !adminAccess'),
  'anonymous property lists should use the compact public query instead of the wide moderation row'
);
assert(
  propertiesRoute.includes('if (cardFieldsOnly && !adminAccess)'),
  'only explicit card-only searches should switch to exact lightweight location matching'
);
assert(
  propertiesRoute.includes("count_cache"),
  'properties route should surface count cache/fallback metadata'
);
assert(
  propertiesRoute.includes("Public property list is continuing without a cold summary")
    && propertiesRoute.includes("total_pages: null"),
  'a cold count failure must not turn an otherwise healthy public list into a 500'
);
assert(
  !/function addPublicLaunchSeedFilter[\s\S]*?\n}\n[\s\S]*?COALESCE\(p\.extra_fields::text/.test(
    propertiesRoute.match(/function addPublicLaunchSeedFilter[\s\S]*?\n}/)?.[0] || ''
  ),
  'public list/count hot path must not regex-scan full extra_fields JSON text'
);

assert(
  adminRoute.includes("loadAdminPropertiesSummaryFast"),
  'admin summary should use the split fast properties summary helper'
);
assert(
  adminRoute.includes("admin-summary-v5-properties-list-count-fast"),
  'admin summary cache key should roll for the fast count deployment'
);
assert(
  adminRoute.includes("public_count_marker"),
  'admin summary should expose the shared public count marker'
);
assert(
  adminRoute.includes("admin_summary_route_fallback"),
  'admin summary should return a 200 fallback payload instead of bubbling producer failures to 503'
);
assert(
  adminRoute.includes("POOL_TIMEOUT") && adminRoute.includes("Database client acquisition timed out"),
  'admin summary queries should bound database client acquisition, not only statement execution'
);
assert(
  adminRoute.includes("adminSummaryOne") && adminRoute.includes("adminSummaryRows") && adminRoute.includes("adminSummaryCount"),
  'admin summary widgets should use non-fatal wrappers so one slow widget cannot blank the dashboard'
);
assert(
  adminRoute.includes("adminSummaryLastKnownGoodPayload") && adminRoute.includes("rememberAdminSummaryLastKnownGood"),
  'admin summary should keep a last-known-good payload for cold/pool fallback'
);
assert(
  adminRoute.includes("stale: true") && adminRoute.includes("last_known_good_generated_at"),
  'admin summary fallback should mark stale last-known-good responses explicitly'
);
assert(
  adminRoute.includes("publicLive || null") && !adminRoute.includes("total: 0,\n        pending: 0,\n        approved: 0"),
  'admin summary fallback must not synthesize a misleading all-zero dashboard'
);

assert(
  databaseConfig.includes("DB_POOL_MIN") && databaseConfig.includes("DB_POOL_WARM_CONNECTIONS") && databaseConfig.includes("async function warmPool"),
  'database config should support warming retained pool connections before traffic'
);
assert(
  serverSource.includes("await db.warmPool()") && serverSource.includes("Database pool warmed before accepting traffic"),
  'server startup should warm the database pool before accepting requests'
);
assert(
  serverSource.includes("await loadPublicOpportunitySummary({ timeoutMs: 5000 })")
    && serverSource.includes("Public inventory summary warmed before accepting traffic"),
  'server startup should pre-warm the authoritative public inventory summary before accepting requests'
);

assert(
  metricsService.includes("PUBLIC_INVENTORY_METRICS_MARKER = 'properties-list-count-fast-20260718'"),
  'public inventory metrics service should carry the release marker'
);
assert(
  metricsService.includes("statement_timeout"),
  'public inventory metrics query should be time-bounded'
);
assert(
  metricsService.includes("POOL_TIMEOUT") && metricsService.includes("Database client acquisition timed out"),
  'public inventory metrics should also bound pool acquisition under scrape/prewarm load'
);
assert(
  metricsService.includes("publicVisibleInventoryWhere"),
  'shared service should export the public visible inventory predicate'
);

[
  'idx_properties_public_visible_created_id',
  'idx_properties_public_visible_type_created_id',
  'idx_properties_public_visible_bucket_created_id',
  'idx_properties_public_visible_price_created_id',
  'idx_properties_public_visible_district_created_id',
  'idx_properties_public_visible_area_created_id'
].forEach((indexName) => {
  assert(migration.includes(indexName), `migration 077 should create ${indexName}`);
});
assert(
  exactCountMigration.includes('idx_properties_public_visible_bucket_count_v2')
    && exactCountMigration.includes('MAKAUG TRAINING')
    && exactCountMigration.includes('REMOVE AFTER QA'),
  'migration 092 should match the complete current public inventory predicate'
);
assert(
  html.includes('properties-list-count-fast-20260718'),
  'production HTML should include the properties-list-count-fast marker'
);
assert(
  html.includes('admin-summary-fallback-20260718'),
  'production HTML should include the admin summary fallback marker'
);
assert(
  html.includes('admin-summary-warm-nozero-20260718'),
  'production HTML should include the admin summary warm/no-zero marker'
);
assert(
  html.includes('properties-summary-cold-fallback-20260725'),
  'production HTML should include the cold-summary fallback marker'
);

console.log('properties-list-count-performance: ok');
