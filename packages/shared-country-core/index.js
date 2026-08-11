const fs = require("fs");
const path = require("path");
const { SHARED_CORE_PHASE1_MARKER, TENANTS, tenantFor } = require("./config/tenants");
const {
  SESHAIKHAYA_LAUNCH_MARKER,
  SOUTH_AFRICA_PROVINCES,
  applySouthAfricaHtml,
  applySouthAfricaJavaScript
} = require("./south-africa");

const COMPONENT_DIR = path.join(__dirname, "components");
const ASSET_DIR = path.join(__dirname, "assets");
const COMPONENT_NAMES = Object.freeze([
  "topbar-nav",
  "hero-search",
  "ask-ai",
  "featured",
  "agents",
  "map",
  "footer"
]);

function readComponent(name) {
  if (!COMPONENT_NAMES.includes(name)) throw new Error(`Unknown shared homepage component: ${name}`);
  return fs.readFileSync(path.join(COMPONENT_DIR, `${name}.html`), "utf8");
}

function sharedAssetPath(name) {
  if (!["homepage.css", "tailwind.css"].includes(name)) {
    throw new Error(`Unknown shared homepage asset: ${name}`);
  }
  return path.join(ASSET_DIR, name);
}

function injectMarker(html, marker = SHARED_CORE_PHASE1_MARKER) {
  const source = String(html || "");
  if (source.includes(marker)) return source;
  const releaseMeta = /(<meta\s+name="makaug-release-marker"\s+content=")([^"]*)(")/i;
  if (releaseMeta.test(source)) {
    return source.replace(releaseMeta, (_match, prefix, markers, suffix) => (
      `${prefix}${String(markers || "").trim()} ${marker}${suffix}`
    ));
  }
  return source.replace("</head>", `  <meta name="shared-core-release-marker" content="${marker}">\n</head>`);
}

function extractHomepageComponents(html) {
  const source = String(html || "");
  const anchors = [
    ["topbar-nav", "<body class=\"bg-gray-50\">", "<div id=\"page-home\" class=\"page active\">"],
    ["hero-search", "<div id=\"page-home\" class=\"page active\">", "<section id=\"home-ask-ai-feature\""],
    ["ask-ai", "<section id=\"home-ask-ai-feature\"", "<section class=\"py-12\">"],
    ["featured", "<section class=\"py-12\">", "<section class=\"py-12 bg-gray-100\">"],
    ["agents", "<section class=\"py-12 bg-gray-100\">", "<section class=\"py-12 bg-white\">"],
    ["map", "<section class=\"py-12 bg-white\">", "<footer class=\"bg-green-900 text-white pt-12 pb-6\">"],
    ["footer", "<footer class=\"bg-green-900 text-white pt-12 pb-6\">", "</footer>"]
  ];
  const components = {};
  for (const [name, startAnchor, endAnchor] of anchors) {
    const start = source.indexOf(startAnchor);
    if (start === -1) throw new Error(`Shared homepage contract is missing ${name} start anchor.`);
    const endStart = source.indexOf(endAnchor, start + startAnchor.length);
    if (endStart === -1) throw new Error(`Shared homepage contract is missing ${name} end anchor.`);
    const includeEnd = name === "footer" ? endAnchor.length : 0;
    components[name] = `${source.slice(start, endStart + includeEnd).trimEnd()}\n`;
  }
  return components;
}

function assertCanonicalComponents(html) {
  const extracted = extractHomepageComponents(html);
  for (const name of COMPONENT_NAMES) {
    const canonical = readComponent(name);
    if (extracted[name] !== canonical) {
      throw new Error(`Makaug homepage component drift detected in ${name}. Rebuild and review the shared core.`);
    }
  }
  return extracted;
}

function applyUgandaHomepage(html) {
  assertCanonicalComponents(html);
  return injectMarker(html);
}

function applyCountryHtml(html, countryCode = "UG", { homepage = false } = {}) {
  const tenant = tenantFor(countryCode);
  if (tenant.countryCode === "ZA") return applySouthAfricaHtml(html);
  if (tenant.countryCode === "UG" && homepage) return applyUgandaHomepage(html);
  return String(html || "");
}

function applyCountryJavaScript(source, countryCode = "UG") {
  const tenant = tenantFor(countryCode);
  if (tenant.countryCode === "ZA") return applySouthAfricaJavaScript(source);
  return String(source || "");
}

function replaceLanguageOptions(html, tenant) {
  const options = tenant.languages
    .map((language) => `<option value="${language.code}">${language.label}</option>`)
    .join("\n          ");
  return html.replace(
    /(<select id="lang-sel"[^>]*>)[\s\S]*?(<\/select>)/,
    `$1\n          ${options}\n        $2`
  ).replace(
    /(<select id="lang-sel-spotlight"[^>]*>)[\s\S]*?(<\/select>)/,
    `$1\n          ${options}\n        $2`
  );
}

function replaceKenyaPriceOptions(html) {
  return html
    .replace(
      /(<select id="hero-min-price-f"[^>]*>)[\s\S]*?(<\/select>)/,
      `$1
              <option value="">Min Price</option>
              <option value="1000000">KSh 1M</option>
              <option value="3000000">KSh 3M</option>
              <option value="5000000">KSh 5M</option>
              <option value="10000000">KSh 10M</option>
              <option value="20000000">KSh 20M</option>
            $2`
    )
    .replace(
      /(<select id="hero-max-price-f"[^>]*>)[\s\S]*?(<\/select>)/,
      `$1
              <option value="">Max Price</option>
              <option value="3000000">KSh 3M</option>
              <option value="5000000">KSh 5M</option>
              <option value="10000000">KSh 10M</option>
              <option value="25000000">KSh 25M</option>
              <option value="50000000">KSh 50M</option>
            $2`
    );
}

function applyKenyaTenant(html) {
  const tenant = TENANTS.KE;
  let output = String(html || "");
  output = output
    .replace('<body class="bg-gray-50">', '<body class="bg-gray-50" data-country-code="KE">')
    .replace(
      /<a id="topbar-whatsapp-link"[\s\S]*?<\/a>/,
      `<a id="topbar-support-link" href="mailto:${tenant.email}" class="hover:text-green-200"><i class="fas fa-envelope text-green-300"></i> Kenya support</a>`
    )
    .replace(/<a href="mailto:info@makaug\.com"[\s\S]*?<\/a>/, "")
    .replace(/<div class="w-10 h-10([^>]*)>M<\/div>/, `<div class="w-10 h-10$1>${tenant.logoLetter}</div>`)
    .replace(/makaug<span class="text-amber-500">\.com<\/span>/g, `nyumba<span class="text-red-600">ke</span>`)
    .replace(/UGANDA PROPERTY/g, "KENYA PROPERTY")
    .replace(/Use makaug in 9 languages/g, "Use Nyumba KE in English or Kiswahili")
    .replace(/A property search engine for Uganda/g, "A property search engine for Kenya")
    .replace(/makaug uses AI-powered search algorithms to scan public online property sources across Uganda, organising/g, "Nyumba KE uses AI-powered search to organise reviewed property opportunities across Kenya, bringing")
    .replace(/Search in any language — makaug AI finds real listings\./g, "Search in English or Kiswahili — Nyumba KE AI finds real listings.")
    .replace(/Ask makaug AI/g, "Ask Nyumba KE AI")
    .replace(/Uganda's first completely free property platform\./g, "Kenya's property search and listing platform.")
    .replace(/Covering all 146 districts\./g, "Built for all 47 counties.")
    .replace(/makaug\.com/g, "nyumbake.com")
    .replace(/\bmakaug\b/g, "Nyumba KE")
    .replace(/\bUganda\b/g, "Kenya")
    .replace(/\bKampala\b/g, "Nairobi")
    .replace(/\b146 districts\b/g, "47 counties")
    .replace(/\bdistricts\b/g, "counties")
    .replace(/\bdistrict\b/g, "county")
    .replace(/\bUSh\b/g, "KSh")
    .replace(/\bUGX\b/g, "KES")
    .replace(/info@nyumbake\.com/g, tenant.email)
    .replace(/https:\/\/wa\.me\/256760112587/g, `mailto:${tenant.email}`)
    .replace(
      /<p id="footer-brand-copy"([\s\S]*?)<\/p>/,
      '<p id="footer-brand-copy"$1</p>'
        .replace("$1", ' class="text-green-200 text-sm mt-3 leading-relaxed">Kenya\'s property search and listing platform. Search reviewed opportunities across all 47 counties.')
    )
    .replace(
      /<div class="mt-4 space-y-2 text-sm text-green-200">[\s\S]*?<\/div>/,
      `<div class="mt-4 space-y-2 text-sm text-green-200">
            <a id="footer-email-label" href="mailto:${tenant.email}" class="block hover:text-white">Email: ${tenant.email}</a>
            <span id="footer-location-label" class="block">Nairobi, Kenya</span>
          </div>`
    )
    .replace(
      /<div class="flex items-center gap-2 text-green-200">[\s\S]*?<\/div>\s*<div class="text-xs text-green-300" id="footer-growth-note">[\s\S]*?<\/div>/,
      '<div class="text-xs text-green-300" id="footer-growth-note">Kenya public beta. Inventory and services are added only after review.</div>'
    )
    .replace(/© 2026 Nyumba KE\.com/g, "© 2026 Nyumba KE")
    .replace(/id="floating-whatsapp-link"/g, 'id="floating-support-link"')
    .replace(/aria-label="Ask Nyumba KE on WhatsApp"/g, 'aria-label="Email Nyumba KE"')
    .replace(/data-public-whatsapp-link/g, "")
    .replace(/data-whatsapp-context="auto"/g, "");
  output = replaceLanguageOptions(output, tenant);
  output = replaceKenyaPriceOptions(output);
  return output;
}

function kenyaHead({ assetVersion = SHARED_CORE_PHASE1_MARKER } = {}) {
  const tenant = tenantFor("KE");
  const version = encodeURIComponent(String(assetVersion || SHARED_CORE_PHASE1_MARKER));
  return `<!DOCTYPE html>
<html lang="en" data-language="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Nyumba KE | Kenya Property Portal</title>
  <meta name="description" content="Search reviewed homes, rentals, land, commercial property and student accommodation across Kenya.">
  <meta name="robots" content="index,follow,max-image-preview:large">
  <meta name="shared-core-release-marker" content="${SHARED_CORE_PHASE1_MARKER}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Nyumba KE">
  <meta property="og:title" content="Nyumba KE | Kenya Property Portal">
  <meta property="og:description" content="Search reviewed property across Kenya.">
  <meta property="og:url" content="${tenant.domain}/">
  <meta property="og:image" content="${tenant.domain}/assets/kenya-property-hero-20260723.jpg">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="Nyumba KE | Kenya Property Portal">
  <meta name="twitter:description" content="Search reviewed property across Kenya.">
  <meta name="twitter:image" content="${tenant.domain}/assets/kenya-property-hero-20260723.jpg">
  <link rel="canonical" href="${tenant.domain}/">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="preconnect" href="https://cdnjs.cloudflare.com">
  <link rel="stylesheet" href="/shared-core/tailwind.css?v=${version}">
  <link rel="stylesheet" href="/shared-core/homepage.css?v=${version}">
  <link rel="stylesheet" href="/shared-homepage-kenya.css?v=${version}">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800;900&display=swap">
</head>`;
}

function renderKenyaHomepage({ assetVersion } = {}) {
  const body = COMPONENT_NAMES.map(readComponent).join("");
  const adapted = applyKenyaTenant(body);
  return `${kenyaHead({ assetVersion })}\n${adapted}
  <script src="/app.js?v=${encodeURIComponent(String(assetVersion || SHARED_CORE_PHASE1_MARKER))}" defer></script>
</body>
</html>`;
}

module.exports = {
  COMPONENT_NAMES,
  SHARED_CORE_PHASE1_MARKER,
  TENANTS,
  SESHAIKHAYA_LAUNCH_MARKER,
  SOUTH_AFRICA_PROVINCES,
  applyCountryHtml,
  applyCountryJavaScript,
  applySouthAfricaHtml,
  applySouthAfricaJavaScript,
  applyUgandaHomepage,
  assertCanonicalComponents,
  extractHomepageComponents,
  injectMarker,
  renderKenyaHomepage,
  sharedAssetPath,
  tenantFor
};
