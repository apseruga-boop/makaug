const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'assets', 'makaug-app.js'), 'utf8');
const propertiesRoute = fs.readFileSync(path.join(root, 'routes', 'properties.js'), 'utf8');
const locationMigration = fs.readFileSync(path.join(root, 'db', 'migrations', '071_public_search_location_performance.sql'), 'utf8');
const locationLabelMigration = fs.readFileSync(path.join(root, 'db', 'migrations', '072_public_area_district_normalisation.sql'), 'utf8');

assert(html.includes('public-filters-wired-20260711'), 'release marker must be present in the public shell');
assert(app.includes('PUBLIC_FILTERS_WIRED_MARKER = "public-filters-wired-20260711"'), 'app bundle must carry the filter wiring marker');
assert(html.includes('public-filters-wired-v2-20260713'), 'v2 release marker must be present in the public shell');
assert(app.includes('PUBLIC_FILTERS_WIRED_V2_MARKER = "public-filters-wired-v2-20260713"'), 'app bundle must carry the v2 filter wiring marker');
assert(html.includes('public-filters-wired-v3-20260713'), 'v3 release marker must be present in the public shell');
assert(app.includes('PUBLIC_FILTERS_WIRED_V3_MARKER = "public-filters-wired-v3-20260713"'), 'app bundle must carry the v3 filter wiring marker');
assert((html.match(/public-filters-wired-v3-20260713/g) || []).length >= 2, 'v3 marker must be present in both preload and script cache-bust builders');
assert(html.includes('public-filters-location-quality-20260713'), 'location-quality release marker must be present in the public shell');
assert(app.includes('PUBLIC_FILTERS_LOCATION_QUALITY_MARKER = "public-filters-location-quality-20260713"'), 'app bundle must carry the location-quality marker');
assert((html.match(/public-filters-location-quality-20260713/g) || []).length >= 2, 'location-quality marker must be present in both preload and script cache-bust builders');
assert(html.includes('public-filters-location-quality-v2-20260713'), 'location-quality v2 release marker must be present in the public shell');
assert(app.includes('PUBLIC_FILTERS_LOCATION_QUALITY_V2_MARKER = "public-filters-location-quality-v2-20260713"'), 'app bundle must carry the location-quality v2 marker');
assert((html.match(/public-filters-location-quality-v2-20260713/g) || []).length >= 2, 'location-quality v2 marker must be present in both preload and script cache-bust builders');
assert(html.includes('public-filters-location-quality-v3-20260713'), 'location-quality v3 release marker must be present in the public shell');
assert(app.includes('PUBLIC_FILTERS_LOCATION_QUALITY_V3_MARKER = "public-filters-location-quality-v3-20260713"'), 'app bundle must carry the location-quality v3 marker');
assert((html.match(/public-filters-location-quality-v3-20260713/g) || []).length >= 2, 'location-quality v3 marker must be present in both preload and script cache-bust builders');
assert(html.includes('public-filters-location-quality-v4-20260713'), 'location-quality v4 release marker must be present in the public shell');
assert(app.includes('PUBLIC_FILTERS_LOCATION_QUALITY_V4_MARKER = "public-filters-location-quality-v4-20260713"'), 'app bundle must carry the location-quality v4 marker');
assert((html.match(/public-filters-location-quality-v4-20260713/g) || []).length >= 2, 'location-quality v4 marker must be present in both preload and script cache-bust builders');

assert(app.includes('const PUBLIC_FILTER_SEARCH_ENDPOINT = "/api/properties/search"'), 'category filters must fetch the search endpoint');
assert(app.includes('return active ? `${PUBLIC_FILTER_SEARCH_ENDPOINT}?${params.toString()}` : ""'), 'category filter URL must be built from the search endpoint');
assert(app.includes('params.set("listing_type", config.backendCategory)'), 'category searches must submit listing_type');
assert(app.includes('params.set("radiusKm"') && app.includes('params.set("radius_unit", "km")'), 'radius filters must submit kilometres');

for (const id of [
  'sale-sort-f',
  'rent-sort-f',
  'student-sort-f',
  'commercial-sort-f',
  'land-sort-f'
]) {
  assert(html.includes(`id="${id}"`), `${id} must exist`);
}

assert(app.includes('function ensurePublicResultsHeader'), 'results header must be created above the grid');
assert(app.includes('data-public-results-sort'), 'sort control must live in the results header');
assert(app.includes('data-public-results-sort-select'), 'sort select must be rendered as a visible header-owned control');
assert(app.includes('function publicCategorySortOptionsHtml'), 'sort options must be centralized for all categories');
assert(app.includes('"Highest Price"') && app.includes('"Lowest Price"') && app.includes('"Newest Listed"') && app.includes('"Oldest Listed"'), 'Rightmove-style sort labels must exist');
assert(app.includes('function shouldIgnoreCatalogueHydration'), 'active filters must ignore stale generic catalogue hydration');
assert(app.includes('const hydrationKey = `${activeCategory}::${activeCategoryPath}`'), 'hydration promises must be keyed by category and source path');
assert(app.includes('function hydratePublicCategorySearchIfActive'), 'visible filter actions must hydrate from the search endpoint');
assert(app.includes('state?.sourcePath === activeSearchPath'), 'filtered counts must not reuse stale generic category totals');

for (const id of [
  'sale-baths-f',
  'sale-amenity-f',
  'rent-baths-f',
  'rent-furnished-f',
  'rent-amenity-f'
]) {
  assert(html.includes(`id="${id}"`), `${id} must be visible in the public filters`);
}

for (const param of [
  '"min_price"',
  '"max_price"',
  '"min_beds"',
  '"max_beds"',
  '"bathrooms"',
  '"property_type"',
  '"amenities"',
  '"furnished"',
  '"min_size"',
  '"sort"'
]) {
  assert(app.includes(`add(${param}`) || app.includes(`params.set(${param}`), `frontend must submit ${param}`);
}

assert(propertiesRoute.includes('const furnished = cleanText(req.query.furnished || req.query.furnishing)'), 'backend must parse furnishing filters');
assert(propertiesRoute.includes('const minSize = toNullableFloat'), 'backend must parse size filters');
assert(propertiesRoute.includes('const priceSortRankSql'), 'backend must rank unpriced/outlier listings last for price sorting');
assert(propertiesRoute.includes('price_desc: `${priceSortRankSql} ASC, p.price DESC NULLS LAST'), 'backend must sort priced listings high-to-low before unpriced/outliers');
assert(propertiesRoute.includes("oldest: 'p.created_at ASC, p.id ASC'"), 'backend must support oldest sort');
assert(propertiesRoute.includes('function addPublicLocationSearchFilter'), 'public searches must use the stricter location search helper');
assert(propertiesRoute.includes('if (publicOnly || !adminAccess)') && propertiesRoute.includes('addPublicLocationSearchFilter(filters, values, area)'), 'anonymous/public location searches must not use broad title/description fallback');
assert(!propertiesRoute.includes('"COALESCE(p.extra_fields->>\'neighborhood\', \'\')"'), 'public visible-location search must not match hidden neighborhood labels');
assert(!propertiesRoute.includes('OR LOWER(TRIM(COALESCE(${columnSql}, \'\'))) LIKE'), 'public location searches must use exact indexed area/district equality');
assert(propertiesRoute.includes('\\btest zone\\b'), 'public QA/test listings must be suppressed from consumer results');
assert(locationMigration.includes('CREATE EXTENSION IF NOT EXISTS pg_trgm'), 'location search migration must enable trigram indexes');
assert(locationMigration.includes('idx_properties_public_live_type_area_lower'), 'location search migration must index area by listing type');
assert(locationMigration.includes('idx_properties_public_live_type_price_created'), 'location search migration must index sortable public prices');
assert(locationMigration.includes('test zone') && locationMigration.includes("status = 'rejected'"), 'location search migration must reject public test-zone rows');
assert(locationMigration.includes('public_search_suppressed'), 'location search migration must tag suppressed public test rows');
assert(locationMigration.includes('ANALYZE properties'), 'location search migration must refresh planner stats');
assert(locationLabelMigration.includes('public_area_district') && locationLabelMigration.includes("('nansana', 'Wakiso')"), 'district normalisation migration must align visible areas with stored districts');
assert(locationLabelMigration.includes('public_location_district_normalised') && locationLabelMigration.includes('ANALYZE properties'), 'district normalisation migration must tag rows and refresh planner stats');
assert(app.includes('function comparePublicPriceDesc') && app.includes('publicSortablePrice'), 'client-side price sorting must also put unpriced rows last');

console.log('public filter wiring regression checks passed');
