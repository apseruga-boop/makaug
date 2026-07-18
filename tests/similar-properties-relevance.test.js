const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const appJs = fs.readFileSync(path.join(root, "assets", "makaug-app.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");

const marker = "similar-relevance-v2-20260718";

assert(indexHtml.includes(marker), "production HTML must carry the similar relevance marker");
assert(appJs.includes(`SIMILAR_PROPERTIES_RELEVANCE_MARKER = "${marker}"`), "client bundle must carry the similar relevance marker");
assert(appJs.includes("function similarPropertyCategory(property = {})"), "similar properties must normalize listing category before ranking");
assert(appJs.includes("function similarPropertyPurpose(property = {})"), "similar properties must normalize sale/rent purpose before ranking");
assert(appJs.includes("function similarPropertyPrice(property = {})"), "similar properties must reject unpriced candidates");
assert(appJs.includes("function similarPropertyLocation(property = {})"), "similar properties must support text locations when coordinates are missing");
assert(appJs.includes("function similarPropertyScore(subject, candidate, context = {})"), "similar properties must score survivors after hard gates");
assert(appJs.includes("function getSimilarProperties(property, limit = 8)"), "similar properties should return up to 8 relevant cards");
assert(appJs.includes("const similar = getSimilarProperties(p, 8)"), "detail page should ask for the wider 6-8 similar-property set");

assert(
  appJs.includes("if (similarPropertyCategory(candidate) !== subjectCategory) return false;")
    && appJs.includes("if (similarPropertyPurpose(candidate) !== subjectPurpose) return false;"),
  "similar property hard gates must keep candidates in the same category and sale/rent purpose"
);

assert(
  appJs.includes("if (!candidatePrice) return false;")
    && appJs.includes("if (priceRatio > 0.5) return false;")
    && appJs.includes("return similarPropertyLocation(candidate).usable;"),
  "similar property hard gates must exclude price=0, >50% price drift, and no-location candidates"
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
  appJs.includes("const local = eligible.filter")
    && appJs.includes("const regional = eligible.filter")
    && appJs.includes("local.length >= minLocalResults ? local"),
  "similar property widening must prefer same area/district before region/global fallbacks"
);

assert(
  !appJs.includes("if (xType !== type) score += 80;")
    && !appJs.includes("score += Math.min(priceDiff * 70, 70);"),
  "old penalty-only similar-property ranking must be removed"
);

console.log("similar properties relevance checks passed");
