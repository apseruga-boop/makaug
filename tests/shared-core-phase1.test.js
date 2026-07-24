const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { sanitizePublicHtml } = require("../services/publicHtmlSanitizer");
const {
  COMPONENT_NAMES,
  SHARED_CORE_PHASE1_MARKER,
  applyUgandaHomepage,
  extractHomepageComponents,
  renderKenyaHomepage,
  tenantFor
} = require("../packages/shared-country-core");

const root = path.resolve(__dirname, "..");
const raw = fs.readFileSync(path.join(root, "index.html"), "utf8");
const baseline = sanitizePublicHtml(raw, { pathname: "/" });
const renderedUganda = applyUgandaHomepage(baseline);

assert(renderedUganda.includes(SHARED_CORE_PHASE1_MARKER), "Uganda shared-core marker missing");
assert.strictEqual(
  renderedUganda.replace(` ${SHARED_CORE_PHASE1_MARKER}`, ""),
  baseline,
  "Uganda homepage changed outside the diagnostic marker"
);

const extracted = extractHomepageComponents(baseline);
assert.deepStrictEqual(Object.keys(extracted), COMPONENT_NAMES);
for (const name of COMPONENT_NAMES) {
  assert(extracted[name].length > 100, `${name} component is unexpectedly empty`);
}

const kenya = renderKenyaHomepage({ assetVersion: "test-commit" });
for (const expected of [
  "Nyumba KE | Kenya Property Portal",
  'data-country-code="KE"',
  "KENYA PROPERTY",
  "A property search engine for Kenya",
  "Search in English or Kiswahili",
  "KSh",
  "47 counties",
  "/for-sale",
  "/to-rent",
  "/student-accommodation",
  "/commercial",
  "/land",
  "/brokers",
  "/mortgage",
  "/marketplace",
  "/list-property",
  SHARED_CORE_PHASE1_MARKER
]) {
  assert(kenya.includes(expected), `Kenya homepage missing ${expected}`);
}
for (const forbidden of [
  "0760112587",
  "256760112587",
  "info@makaug.com",
  "wa.me",
  "WhatsApp",
  "instagram.com/nyumbake",
  "linkedin.com/company/nyumbake",
  "youtube.com/@nyumbake",
  "facebook.com/nyumbake",
  "Uganda's first",
  "146 districts",
  "USh (UGX)"
]) {
  assert(!kenya.includes(forbidden), `Kenya homepage leaked Uganda value: ${forbidden}`);
}
assert.strictEqual((kenya.match(/id="home-ask-ai-feature"/g) || []).length, 1);
assert.strictEqual((kenya.match(/id="page-home"/g) || []).length, 1);
assert.deepStrictEqual(tenantFor("KE").languages.map((language) => language.code), ["en", "sw"]);

console.log("shared-core-phase1 tests passed");
