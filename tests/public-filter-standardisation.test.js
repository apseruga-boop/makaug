const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
const appJs = fs.readFileSync(path.join(root, "assets", "makaug-app.js"), "utf8");
const serverJs = fs.readFileSync(path.join(root, "server.js"), "utf8");

const marker = "public-filter-standardisation-20260710";

assert(indexHtml.includes(marker), "public filter standardisation marker should be in the public HTML");
assert(serverJs.includes(marker), "server should append the public filter standardisation marker when cached HTML is missing it");

[
  "sale-sort-f",
  "rent-sort-f",
  "student-sort-f",
  "commercial-sort-f",
  "land-sort-f",
  "sale-baths-f",
  "sale-title-f",
  "sale-amenity-f",
  "rent-baths-f",
  "rent-furnished-f",
  "rent-amenity-f",
  "student-distance-f",
  "commercial-max-size-f",
  "land-max-size-f",
  "land-title-f"
].forEach((id) => {
  assert(indexHtml.includes(`id="${id}"`), `${id} should render on its category filter bar`);
});

assert(
  /id="sale-sort-f"[^>]+onchange="filterListings\('sale'\)"/.test(indexHtml),
  "sale sort should use the same filter pipeline as sale location, price and bed filters"
);

assert(
  !indexHtml.includes("Use my location (10 mi)")
    && !indexHtml.includes("10 miles")
    && !appJs.includes("Location search uses a 10 mile radius by default."),
  "public filter UI should not expose mile-based radius copy"
);

assert(
  indexHtml.includes("Use my location (10 km)")
    && indexHtml.includes("Location search uses a 10 km radius by default.")
    && appJs.includes("DEFAULT_NEAR_ME_RADIUS_KM = 10")
    && appJs.includes("SEARCH_RADIUS_KM_OPTIONS = [0, 1, 2, 5, 10, 15, 20, 30, 50, 75]")
    && appJs.includes("SEARCH_RADIUS_KM_OPTIONS.map((km)"),
  "public radius controls should be rendered and populated in kilometres"
);

assert(
  appJs.includes('params.set("radiusKm", String(payload.radiusKm))')
    && appJs.includes('payload.radiusUnit = "km"')
    && appJs.includes('radius_unit: "km"'),
  "public search handoff and near-me payloads should prefer radiusKm/radius_unit=km"
);

assert(
  appJs.includes("radiusKmSelectValue(milesToKm(radiusMilesParam))")
    && appJs.includes('const radiusMilesParam = normalizeInput(qs.get("radiusMiles")'),
  "old radiusMiles URLs should be converted into the nearest public km dropdown option"
);

assert(
  appJs.includes('const sort = document.getElementById("sale-sort-f")?.value || "newest"')
    && appJs.includes('publicListingFilterValue(`${key}-sort-f`)')
    && appJs.includes('setValue("commercial-sort-f", filters.sort || "newest")')
    && appJs.includes('setValue("land-sort-f", filters.sort || "newest")'),
  "sort should be preserved and treated as an active filter across category pages"
);

assert(
  appJs.includes('const minBaths = parseInt(document.getElementById("sale-baths-f")?.value || "0", 10)')
    && appJs.includes('const furnishing = (document.getElementById("rent-furnished-f")?.value || "").toLowerCase().trim()')
    && appJs.includes('const maxDistance = parseFloat(document.getElementById("student-distance-f")?.value || "0")')
    && appJs.includes('const maxSize = parseFloat(document.getElementById("commercial-max-size-f")?.value || "0")')
    && appJs.includes('const titleType = (document.getElementById("land-title-f")?.value || "").toLowerCase().trim()'),
  "category filters should use the extra collected facts requested in the audit"
);

console.log("public filter standardisation checks passed");
