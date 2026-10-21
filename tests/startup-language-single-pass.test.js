'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const acorn = require('acorn');

const source = fs.readFileSync(require.resolve('../assets/makaug-app.js'), 'utf8');
const node = acorn.parse(source, { ecmaVersion: 'latest' }).body.find((item) => item.type === 'FunctionDeclaration' && item.id.name === 'setLang');
assert.ok(node);
const declaration = source.slice(node.start, node.end);
const languages = ['en', 'lg', 'sw', 'ac', 'ny', 'rn', 'sm', 'am', 'ar'];

function fixture(code = declaration) {
  const calls = [];
  const selectors = Object.fromEntries(['lang-sel', 'lang-sel-spotlight', 'lp-review-lang-sel'].map((id) => [id, { value: 'en' }]));
  const labels = {};
  const context = vm.createContext({
    currentLang: 'en', currentTab: 'sale', currentPage: 'home', activeDetailPropertyId: '',
    document: { documentElement: {}, getElementById: (id) => selectors[id] || null },
    window: { applyOffPlanLanguageUI: () => calls.push('off-plan') },
    normalizeMakaugLanguageCode: (lang) => languages.includes(lang) ? lang : 'en',
    persistMakaugLanguagePreference: (lang) => calls.push(`persist:${lang}`),
    lpVal: (id) => `kept:${id}`,
    tr: (key) => key,
    applyLanguageUI() { calls.push('language'); labels.hero = context.currentLang; labels.region = context.currentLang; },
    populateLpRegionOptions(value) { assert.equal(value, 'kept:lp-region'); calls.push('region'); labels.region = 'new-control'; },
    populateLpDistrictOptions(region, district) { assert.equal(region, 'kept:lp-region'); assert.equal(district, 'kept:list-district-sel'); },
    populateLpCityOptions(district, city) { assert.equal(district, 'kept:list-district-sel'); assert.equal(city, 'kept:lp-city'); },
    populateLpNeighborhoodOptions(district, city, area) { assert.equal(district, 'kept:list-district-sel'); assert.equal(city, 'kept:lp-city'); assert.equal(area, 'kept:lp-neighborhood'); }
  });
  for (const name of ['addAdUnits', 'syncLpAreaFromHierarchy', 'setLpResolvedAltitude', 'setHeroLocationFilter', 'populateRadiusSelects', 'setHeroRadiusState', 'setHeroContextFilter', 'populateUniversitySelects', 'renderAll', 'resetMaps', 'openDetail', 'updateListPreview', 'renderLpVideoPreview', 'updateLpPhotoRequirements', 'renderLpPhotoFeedback', 'renderListReviewSummary', 'renderMortgageFinder', 'updateHomeAskAiLanguageCopy', 'applyMarketplaceLanguageUI', 'refreshBrokerProfileAbout', 'toast']) {
    context[name] = () => calls.push(name);
  }
  vm.runInContext(code, context);
  return { context, calls, selectors, labels };
}

test('startup and fragment language setup translate the final rebuilt controls once for all nine languages', () => {
  for (const language of languages) {
    const f = fixture();
    f.context.setLang(language, true, false);
    assert.equal(f.calls.filter((call) => call === 'language').length, 1);
    assert.ok(f.calls.indexOf('language') > f.calls.indexOf('renderMortgageFinder'));
    assert.equal(f.labels.hero, language);
    assert.equal(f.labels.region, language);
    for (const selector of Object.values(f.selectors)) assert.equal(selector.value, language);
    assert.equal(f.context.document.documentElement.lang, language);
    assert.equal(f.context.document.documentElement.dir, language === 'ar' ? 'rtl' : 'ltr');
    assert.ok(f.calls.includes(`persist:${language}`));
    assert.ok(f.calls.includes('off-plan'));
    assert.ok(!f.calls.includes('renderAll') && !f.calls.includes('resetMaps') && !f.calls.includes('toast'));
  }
});

test('an explicit language change retains re-rendering, detail refresh, and the confirmation toast', () => {
  const f = fixture();
  f.context.currentPage = 'detail'; f.context.activeDetailPropertyId = 'approved-property';
  f.context.setLang('lg');
  assert.equal(f.calls.filter((call) => call === 'language').length, 2);
  for (const name of ['renderAll', 'resetMaps', 'openDetail', 'toast']) assert.ok(f.calls.includes(name));
  assert.equal(f.labels.hero, 'lg'); assert.equal(f.labels.region, 'lg');
});

