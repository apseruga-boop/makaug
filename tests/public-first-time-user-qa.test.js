const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const appJs = fs.readFileSync(path.join(root, "assets", "makaug-app.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
const serverJs = fs.readFileSync(path.join(root, "server.js"), "utf8");

assert(
  indexHtml.includes("public-i18n-detail-persistence-20260707"),
  "release marker should be present for live deploy verification"
);

assert(
  indexHtml.includes("public-i18n-startup-race-fix-20260707"),
  "startup race marker should be present to bust the public app bundle cache"
);

assert(
  indexHtml.includes("public-i18n-cookie-persistence-20260707"),
  "cookie persistence marker should be present to force the latest public app bundle"
);

assert(
  indexHtml.includes("public-i18n-auth-language-guard-20260707"),
  "auth language guard marker should be present to force the latest public app bundle"
);

assert(
  indexHtml.includes("public-search-area-handoff-20260707"),
  "search handoff marker should be present to force the latest public app bundle"
);

assert(
  indexHtml.includes("public-search-normalize-helper-20260707"),
  "search normalize helper marker should be present to force the corrected public app bundle"
);

assert(
  indexHtml.includes("public-search-route-backend-results-20260707"),
  "route-search backend results marker should be present to force the corrected public app bundle"
);

assert(
  indexHtml.includes("public-home-search-backend-results-20260707"),
  "homepage search backend results marker should be present to force the corrected public app bundle"
);

assert(
  indexHtml.includes("public-qa-cleanup-20260708"),
  "public QA cleanup marker should be present to force the corrected public app bundle"
);

assert(
  indexHtml.includes("public-location-label-fix-20260708"),
  "public location label marker should be present to force the corrected public app bundle"
);

assert(
  indexHtml.includes("public-results-delivery-fix-20260708"),
  "public results delivery marker should be present to force the corrected public app bundle"
);

assert(
  serverJs.includes("publicI18nDetailPersistenceVersion")
    && serverJs.includes("publicI18nStartupRaceFixVersion")
    && serverJs.includes("publicI18nCookiePersistenceVersion")
    && serverJs.includes("publicI18nAuthLanguageGuardVersion")
    && serverJs.includes("publicSearchAreaHandoffVersion")
    && serverJs.includes("publicSearchNormalizeHelperVersion")
    && serverJs.includes("publicSearchRouteBackendResultsVersion")
    && serverJs.includes("publicHomeSearchBackendResultsVersion")
    && serverJs.includes("publicQaCleanupVersion")
    && serverJs.includes("publicLocationLabelFixVersion")
    && serverJs.includes("publicResultsDeliveryFixVersion")
    && serverJs.includes("publicAppVersionSuffixes"),
  "server-rendered public routes should receive the same i18n app-version suffixes as the homepage"
);

assert(
  indexHtml.includes("savedMakaugLang")
    && indexHtml.includes('localStorage.getItem("makaug_lang")')
    && indexHtml.includes("makaug_lang=([^;]+)"),
  "index should apply the saved language from localStorage or cookie before the main bundle loads"
);

assert(
  appJs.includes("function heroPlaceholderKey"),
  "hero placeholder helper should map tabs to translated placeholder keys"
);

assert(
  appJs.includes("function setHeroControlLanguage"),
  "hero select controls should update labels and aria labels when language changes"
);

assert(
  appJs.includes("function getStartupLanguagePreference") && appJs.includes("getCurrentLanguageControlValue()"),
  "startup should preserve a selected/saved non-English language instead of falling back to English"
);

assert(
  appJs.includes("function persistMakaugLanguagePreference")
    && appJs.includes("makaug_lang=${encodeURIComponent(safeLang)}")
    && appJs.includes("function getStoredMakaugLanguagePreference"),
  "language preference should persist through both localStorage and a cookie fallback"
);

assert(
  appJs.includes("const storedLanguagePreference = getStoredMakaugLanguagePreference();")
    && appJs.includes('currentLang === "en"')
    && appJs.includes('(!storedLanguagePreference || storedLanguagePreference === "en")'),
  "auth session refresh should not overwrite a user-selected non-English site language"
);

assert(
  appJs.includes("currentLang = normalizeMakaugLanguageCode(lang);"),
  "setLang should normalize supported language codes before applying UI"
);

assert(
  appJs.includes('label[for="hero-q"]') && appJs.includes('heroInput.setAttribute("aria-label", heroPlaceholder)'),
  "hero search input should translate visible label, placeholder, and aria label"
);

assert(
  appJs.includes('heroLocationControl.setAttribute("aria-label", tr("heroLocationLabel"))'),
  "hero location button aria label should use translated text"
);

[
  /heroPropertyType:\s*"Ekika ky'ekintu"/,
  /heroFilters:\s*"Ebisengejja"/,
  /heroTypeApartment:\s*"Apartimenti"/,
  /heroTypeStudio:\s*"Ekisenge kya studio"/,
  /heroTypeBungalow:\s*"Ennyumba ya bungalow"/,
  /"Property Details":\s*"Ebikwata ku kintu"/,
  /"Property Category \*":\s*"Ekika ky'ekintu \*"/,
  /"List Property":\s*"Teka ekintu kyo"/,
  /"Commercial Property Type \*":\s*"Ekika ky'ekintu ky'obusuubuzi \*"/
].forEach((pattern) => {
  assert(pattern.test(appJs), `missing Luganda translation: ${pattern}`);
});

assert(
  appJs.includes('showPage("detail");\n  setLang(currentLang, true, false);'),
  "property detail route should re-apply the current language after rendering"
);

assert(
  !appJs.includes('const d = dRaw || guessDistrictFromText(q);'),
  "search handoff should not broaden typed area searches back to guessed district-only queries"
);

assert(
  appJs.includes("function heroSearchRouteUrl")
    && appJs.includes("function normalizeInput")
    && appJs.includes('params.set("q", query)')
    && appJs.includes("updateHeroSearchRoute(destinationPage"),
  "homepage typed searches should be preserved as durable route query params"
);

assert(
  appJs.includes("updateHeroSearchRoute(page, payload")
    && appJs.includes("applyHeroSearchHandoff(page)"),
  "route fragments should re-apply the durable search URL after hydration"
);

assert(
  appJs.includes("function publicInventoryRouteSearchPath")
    && appJs.includes("function hydrateVisibleRouteSearchResults")
    && appJs.includes('return `/api/properties/search?${params.toString()}`')
    && appJs.includes("activeRouteSearchPath || publicInventoryCategoryPath(activeCategory)")
    && appJs.includes('syncActiveRouteSearchHandoff("initial_route_search_complete")')
    && appJs.includes("backend_results|route_query|route_search|public_inventory|active_route_search|initial_route_search")
    && appJs.includes('hydrateVisibleRouteSearchResults("homepage_search_backend_results")'),
  "direct category URLs with q/area params should hydrate from backend search results before showing an empty state"
);

assert(
  appJs.includes('const radiusMilesParam = normalizeInput(qs.get("radiusMiles")')
    && appJs.includes("radiusMiles: radiusMilesParam || null")
    && appJs.includes('if (radiusValue) setValue("sale-radius-f", radiusValue);'),
  "plain text route searches should not silently enable the default 10-mile radius filter"
);

assert(
  !appJs.includes("Rukiga translation is not fully available yet")
    && appJs.includes('rn: {')
    && appJs.includes('heroTitleHtml: "Shaka <span class=\\"text-green-300\\">maka</span> yawe enungi"')
    && appJs.includes('heroSearch: "Shaka"'),
  "Rukiga should use its translated homepage/search copy instead of a forced English fallback"
);

console.log("public first-time-user QA regression checks passed");
