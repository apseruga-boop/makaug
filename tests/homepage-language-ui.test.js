const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const appJs = fs.readFileSync(path.join(root, "assets", "makaug-app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

function between(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `Missing section start: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `Missing section end: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("homepage AI assistant has translations for every supported public language", () => {
  const section = between(appJs, "const HOME_ASSISTANT_I18N =", "const FOOTER_I18N =");
  ["en", "lg", "sw", "ac", "ny", "rn", "sm"].forEach((lang) => {
    assert.match(section, new RegExp(`\\n\\s+${lang}: \\{`), `Missing home assistant language pack: ${lang}`);
  });
  assert.match(section, /Omuyambi wa AI mu Listing/);
  assert.match(section, /Msaidizi wa AI/);
});

test("homepage footer uses a dedicated language dictionary instead of mixed listing labels", () => {
  const section = between(appJs, "const FOOTER_I18N =", "function homeAssistantTr");
  ["en", "lg", "sw", "ac", "ny", "rn", "sm"].forEach((lang) => {
    assert.match(section, new RegExp(`\\n\\s+${lang}: \\{`), `Missing footer language pack: ${lang}`);
  });
  assert.match(section, /sale: "Ennyumba ezitundibwa"/);
  assert.match(section, /properties: "Ebika bya property"/);
  assert.doesNotMatch(section, /lg: \{[\s\S]*sale: "Houses for Sale"/);
  assert.match(appJs, /function applyFooterLanguageUI\(\)/);
  assert.match(appJs, /setTextById\("footer-link-sale", footerTr\("sale"\)\)/);
  assert.doesNotMatch(appJs, /setTextById\("footer-link-sale", translateListingLabel/);
});

test("footer contact rows have stable IDs for language switching", () => {
  assert.match(html, /id="footer-whatsapp-label"/);
  assert.match(html, /id="footer-email-label"/);
});

test("selected language is applied after homepage re-rendering", () => {
  assert.match(appJs, /renderMortgageFinder\(\);\n\s+applyLanguageUI\(\);/);
});
