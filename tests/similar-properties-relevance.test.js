const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const appJs = fs.readFileSync(path.join(root, "assets", "makaug-app.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");

const marker = "similar-relevance-v2-20260718";
const recallMarker = "similar-recall-widening-20260718";
const aliasRenderMarker = "similar-alias-render-20260718";
const purposeFallbackMarker = "similar-purpose-fallback-20260718";
const hydrationResponseMarker = "similar-hydration-response-20260718";
const explicitCategoryMarker = "similar-explicit-category-20260718";
const hydrationFallbackMarker = "similar-hydration-fallback-20260718";
const endpointFallbackMarker = "similar-endpoint-fallback-20260718";
const hydrationDiagnosticsMarker = "similar-hydration-diagnostics-20260718";

const markerCount = (indexHtml.match(new RegExp(marker, "g")) || []).length;
assert(markerCount >= 2, "production HTML must carry the similar relevance marker in both preload and app-loader cache keys");
assert(appJs.includes(`SIMILAR_PROPERTIES_RELEVANCE_MARKER = "${marker}"`), "client bundle must carry the similar relevance marker");
const recallMarkerCount = (indexHtml.match(new RegExp(recallMarker, "g")) || []).length;
assert(recallMarkerCount >= 2, "production HTML must carry the similar recall marker in both preload and app-loader cache keys");
assert(appJs.includes(`SIMILAR_PROPERTIES_RECALL_MARKER = "${recallMarker}"`), "client bundle must carry the similar recall marker");
const aliasRenderMarkerCount = (indexHtml.match(new RegExp(aliasRenderMarker, "g")) || []).length;
assert(aliasRenderMarkerCount >= 2, "production HTML must carry the similar alias/render marker in both preload and app-loader cache keys");
assert(appJs.includes(`SIMILAR_PROPERTIES_ALIAS_RENDER_MARKER = "${aliasRenderMarker}"`), "client bundle must carry the similar alias/render marker");
const purposeFallbackMarkerCount = (indexHtml.match(new RegExp(purposeFallbackMarker, "g")) || []).length;
assert(purposeFallbackMarkerCount >= 2, "production HTML must carry the similar purpose fallback marker in both preload and app-loader cache keys");
assert(appJs.includes(`SIMILAR_PROPERTIES_PURPOSE_FALLBACK_MARKER = "${purposeFallbackMarker}"`), "client bundle must carry the similar purpose fallback marker");
const hydrationResponseMarkerCount = (indexHtml.match(new RegExp(hydrationResponseMarker, "g")) || []).length;
assert(hydrationResponseMarkerCount >= 2, "production HTML must carry the similar hydration response marker in both preload and app-loader cache keys");
assert(appJs.includes(`SIMILAR_PROPERTIES_HYDRATION_RESPONSE_MARKER = "${hydrationResponseMarker}"`), "client bundle must carry the similar hydration response marker");
const explicitCategoryMarkerCount = (indexHtml.match(new RegExp(explicitCategoryMarker, "g")) || []).length;
assert(explicitCategoryMarkerCount >= 2, "production HTML must carry the similar explicit category marker in both preload and app-loader cache keys");
assert(appJs.includes(`SIMILAR_PROPERTIES_EXPLICIT_CATEGORY_MARKER = "${explicitCategoryMarker}"`), "client bundle must carry the similar explicit category marker");
const hydrationFallbackMarkerCount = (indexHtml.match(new RegExp(hydrationFallbackMarker, "g")) || []).length;
assert(hydrationFallbackMarkerCount >= 2, "production HTML must carry the similar hydration fallback marker in both preload and app-loader cache keys");
assert(appJs.includes(`SIMILAR_PROPERTIES_HYDRATION_FALLBACK_MARKER = "${hydrationFallbackMarker}"`), "client bundle must carry the similar hydration fallback marker");
const endpointFallbackMarkerCount = (indexHtml.match(new RegExp(endpointFallbackMarker, "g")) || []).length;
assert(endpointFallbackMarkerCount >= 2, "production HTML must carry the similar endpoint fallback marker in both preload and app-loader cache keys");
assert(appJs.includes(`SIMILAR_PROPERTIES_ENDPOINT_FALLBACK_MARKER = "${endpointFallbackMarker}"`), "client bundle must carry the similar endpoint fallback marker");
const hydrationDiagnosticsMarkerCount = (indexHtml.match(new RegExp(hydrationDiagnosticsMarker, "g")) || []).length;
assert(hydrationDiagnosticsMarkerCount >= 2, "production HTML must carry the similar hydration diagnostics marker in both preload and app-loader cache keys");
assert(appJs.includes(`SIMILAR_PROPERTIES_HYDRATION_DIAGNOSTICS_MARKER = "${hydrationDiagnosticsMarker}"`), "client bundle must carry the similar hydration diagnostics marker");
assert(appJs.includes("function similarPropertyCategory(property = {})"), "similar properties must normalize listing category before ranking");
assert(appJs.includes("function similarPropertyPurpose(property = {})"), "similar properties must normalize sale/rent purpose before ranking");
assert(appJs.includes("function similarPropertyPrice(property = {})"), "similar properties must reject unpriced candidates");
assert(appJs.includes("function similarPropertyLocation(property = {})"), "similar properties must support text locations when coordinates are missing");
assert(appJs.includes("function similarPropertyScore(subject, candidate, context = {})"), "similar properties must score survivors after hard gates");
assert(appJs.includes("function getSimilarProperties(property, limit = 8)"), "similar properties should return up to 8 relevant cards");
assert(appJs.includes("const similar = getSimilarProperties(p, 8)"), "detail page should ask for the wider 6-8 similar-property set");
assert(appJs.includes("function similarPropertyPriceWithinBand(subjectPrice, candidatePrice, band = 0.5)"), "similar properties must use progressive price bands");
assert(appJs.includes("function similarLocationMatchesScope(subjectLocation = {}, candidateLocation = {}, scope = \"national\")"), "similar properties must use progressive location scopes");
assert(appJs.includes("function similarDedupedSortedItems(items = [])"), "similar properties must dedupe within widened recall");

assert(
  appJs.includes("if (similarPropertyCategory(candidate) !== subjectCategory) return false;")
    && appJs.includes("const purposeEligible = categoryEligible")
    && appJs.includes("const candidatePool = purposeEligible.length ? purposeEligible : categoryEligible;"),
  "similar property hard gates must keep candidates in the same category while preferring same sale/rent purpose when available"
);

assert(
  appJs.includes("\"to-rent\": \"rent\"")
    && appJs.includes("\"student-accommodation\": \"student\"")
    && appJs.includes("\"commercial-property\": \"commercial\"")
    && appJs.includes("const aliasKey = value.replace(/[-\\s]+/g, \"_\");"),
  "similar properties must collapse dashed public-route category aliases before same-category matching"
);

assert(
  appJs.includes("property?.listing_category")
    && appJs.includes("extra.source_listing_type")
    && appJs.includes("const authoritativeParts = [")
    && appJs.includes("if (authoritativeParts.includes(\"rent\")) return \"rent\";")
    && appJs.includes("if (authoritativeParts.includes(\"commercial\")) return \"commercial\";")
    && appJs.includes("isStudentDiscoverable(property)")
    && appJs.includes("return \"student\";")
    && appJs.includes("return \"commercial\";"),
  "similar property category normalization must trust explicit backend category aliases before softer inference"
);

assert(
  appJs.includes("if (!candidatePrice) return false;")
    && appJs.includes("return similarPropertyLocation(candidate).usable;"),
  "similar property hard gates must exclude price=0 and no-location candidates before widening"
);

assert(
  appJs.includes("const categoryEligible = getPublicListings()")
    && appJs.includes("if (categoryEligible.length < 1) return [];")
    && appJs.includes("const eligible = candidatePool")
    && appJs.includes("const priceBands = subjectPrice > 0 ? [0.5, 1, Infinity] : [Infinity];")
    && appJs.includes("const locationLevels = subjectLocation.usable")
    && appJs.includes("[\"area\", \"district\", \"region\", \"national\"]")
    && appJs.includes("return similarPropertyPriceWithinBand(subjectPrice, similarPropertyPrice(item.property), band);"),
  "similar property recall must allow sparse categories and widen area/district/region/national and price band before going empty"
);

assert(
  appJs.includes("function similarPropertyCategoryApiPath(property = {})")
    && appJs.includes("student_portal=1")
    && appJs.includes("category=${encodeURIComponent(category)}")
    && appJs.includes("function hydrateDetailSimilarProperties(property = {})")
    && appJs.includes("limit=96&page=1&include_summary=0")
    && appJs.includes("Array.isArray(response?.properties)")
    && appJs.includes("Array.isArray(response?.data?.properties)")
    && appJs.includes("if (!nextMatches.length && rows.length)")
    && appJs.includes("const hydratedRows = rows.map((row) => upsertPropertyForUi(row) || mapRemotePropertyForUi(row)).filter(Boolean);")
    && appJs.includes("similarDedupedSortedItems(hydratedRows")
    && appJs.includes("setDetailSimilarHydrationDiagnostics({"),
  "direct property detail loads must read same-category public rows from all supported response shapes before giving up on similar cards"
);

assert(
  appJs.includes("function renderDetailSimilarPropertiesSectionHtml(similar = [])")
    && appJs.includes("id=\"detail-similar-properties-grid\"")
    && appJs.includes("data-similar-purpose-fallback")
    && appJs.includes("data-similar-hydration-response")
    && appJs.includes("data-similar-explicit-category")
    && appJs.includes("data-similar-hydration-fallback")
    && appJs.includes("data-similar-endpoint-fallback")
    && appJs.includes("updateDetailSimilarPropertiesSection(nextMatches)")
    && appJs.includes("hydrateDetailSimilarProperties(p);"),
  "detail pages must always include a hydratable similar-properties section and render it when matches appear"
);

assert(
  appJs.includes("usable: !!(area || district || city || hasPoint)"),
  "similar property location must not treat a broad region label alone as a usable location"
);

assert(
  appJs.includes("similarPropertyIsUnavailable(candidate)")
    && appJs.includes("status === \"sold\"")
    && appJs.includes("off\\s*market"),
  "similar property candidates must exclude sold, hidden, deleted, and unavailable rows"
);

assert(
  appJs.includes("subjectCategory === \"student\"")
    && appJs.includes("inferStudentNearestUniversity(subject)")
    && appJs.includes("subjectCategory === \"commercial\"")
    && appJs.includes("subjectCategory === \"land\""),
  "similar property scoring must include student, commercial, and land-specific relevance"
);

assert(
  appJs.includes("if (scope === \"area\") return similarSameArea(subjectLocation, candidateLocation);")
    && appJs.includes("if (scope === \"district\") return similarSameArea(subjectLocation, candidateLocation) || similarSameDistrict(subjectLocation, candidateLocation);")
    && appJs.includes("if (scope === \"region\")"),
  "similar property widening must prefer same area/district before region/national fallbacks"
);

assert(
  !appJs.includes("if (xType !== type) score += 80;")
    && !appJs.includes("score += Math.min(priceDiff * 70, 70);"),
  "old penalty-only similar-property ranking must be removed"
);

console.log("similar properties relevance checks passed");
