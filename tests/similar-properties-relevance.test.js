const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const appJs = fs.readFileSync(path.join(root, "assets", "makaug-app.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");

const marker = "similar-relevance-v2-20260718";
const recallMarker = "similar-recall-widening-20260718";

const markerCount = (indexHtml.match(new RegExp(marker, "g")) || []).length;
assert(markerCount >= 2, "production HTML must carry the similar relevance marker in both preload and app-loader cache keys");
assert(appJs.includes(`SIMILAR_PROPERTIES_RELEVANCE_MARKER = "${marker}"`), "client bundle must carry the similar relevance marker");
const recallMarkerCount = (indexHtml.match(new RegExp(recallMarker, "g")) || []).length;
assert(recallMarkerCount >= 2, "production HTML must carry the similar recall marker in both preload and app-loader cache keys");
assert(appJs.includes(`SIMILAR_PROPERTIES_RECALL_MARKER = "${recallMarker}"`), "client bundle must carry the similar recall marker");
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
    && appJs.includes("if (similarPropertyPurpose(candidate) !== subjectPurpose) return false;"),
  "similar property hard gates must keep candidates in the same category and sale/rent purpose"
);

assert(
  appJs.includes("if (!candidatePrice) return false;")
    && appJs.includes("return similarPropertyLocation(candidate).usable;"),
  "similar property hard gates must exclude price=0 and no-location candidates before widening"
);

assert(
  appJs.includes("const categoryEligible = getPublicListings()")
    && appJs.includes("if (categoryEligible.length < 2) return [];")
    && appJs.includes("const priceBands = subjectPrice > 0 ? [0.5, 1, Infinity] : [Infinity];")
    && appJs.includes("const locationLevels = subjectLocation.usable")
    && appJs.includes("[\"area\", \"district\", \"region\", \"national\"]")
    && appJs.includes("return similarPropertyPriceWithinBand(subjectPrice, similarPropertyPrice(item.property), band);"),
  "similar property recall must widen area/district/region/national and price band before going empty"
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
