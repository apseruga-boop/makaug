'use strict';

const { tenantFor } = require('./config/tenants');

const SESHAIKHAYA_LAUNCH_MARKER = 'seshaikhaya-za-foundation-20260811';
const SOUTH_AFRICA_PROVINCES = Object.freeze([
  'Western Cape',
  'Gauteng',
  'KwaZulu-Natal',
  'Eastern Cape',
  'Free State',
  'Limpopo',
  'Mpumalanga',
  'North West',
  'Northern Cape'
]);
const SOUTH_AFRICA_BOND_PROVIDERS = Object.freeze([
  {
    id: 'standard-bank', name: 'Standard Bank', residentialRate: null, commercialRate: null, landRate: null,
    minDepositPct: { residential: 10, commercial: 20, land: 20, default: 10 },
    maxYears: { residential: 20, commercial: 20, land: 20, default: 20 }, arrangementFeePct: null,
    sourceLabel: 'Standard Bank South Africa home loans',
    sourceUrl: 'https://www.standardbank.co.za/southafrica/personal/products-and-services/borrow-for-your-needs/home-loans/qualify-me',
    sourceNote: 'Rates, deposit, term, fees and approval are quote-specific.', sourceVerifiedAt: '2026-08-11'
  },
  {
    id: 'absa', name: 'Absa', residentialRate: null, commercialRate: null, landRate: null,
    minDepositPct: { residential: 10, commercial: 20, land: 20, default: 10 },
    maxYears: { residential: 20, commercial: 20, land: 20, default: 20 }, arrangementFeePct: null,
    sourceLabel: 'Absa South Africa home loans',
    sourceUrl: 'https://www.absa.co.za/personal/loans/for-a-home/understanding-home-loans/',
    sourceNote: 'Rates, deposit, term, fees and approval are quote-specific.', sourceVerifiedAt: '2026-08-11'
  },
  {
    id: 'fnb', name: 'FNB', residentialRate: null, commercialRate: null, landRate: null,
    minDepositPct: { residential: 10, commercial: 20, land: 20, default: 10 },
    maxYears: { residential: 20, commercial: 20, land: 20, default: 20 }, arrangementFeePct: null,
    sourceLabel: 'FNB South Africa home loans', sourceUrl: 'https://www.fnb.co.za/home-loans/new-home-loan.html',
    sourceNote: 'Rates, deposit, term, fees and approval are quote-specific.', sourceVerifiedAt: '2026-08-11'
  },
  {
    id: 'nedbank', name: 'Nedbank', residentialRate: null, commercialRate: null, landRate: null,
    minDepositPct: { residential: 10, commercial: 20, land: 20, default: 10 },
    maxYears: { residential: 20, commercial: 20, land: 20, default: 20 }, arrangementFeePct: null,
    sourceLabel: 'Nedbank South Africa home loans', sourceUrl: 'https://personal.nedbank.co.za/borrow/home-loans.html',
    sourceNote: 'Rates, deposit, term, fees and approval are quote-specific.', sourceVerifiedAt: '2026-08-11'
  },
  {
    id: 'investec', name: 'Investec', residentialRate: null, commercialRate: null, landRate: null,
    minDepositPct: { residential: 0, commercial: 20, land: 20, default: 10 },
    maxYears: { residential: 20, commercial: 20, land: 20, default: 20 }, arrangementFeePct: null,
    sourceLabel: 'Investec South Africa home loans', sourceUrl: 'https://www.investec.com/en_za/individuals/finance/home-loan.html',
    sourceNote: 'Eligibility, rates, term, fees and approval are quote-specific.', sourceVerifiedAt: '2026-08-11'
  },
  {
    id: 'sa-home-loans', name: 'SA Home Loans', residentialRate: null, commercialRate: null, landRate: null,
    minDepositPct: { residential: 10, commercial: 20, land: 20, default: 10 },
    maxYears: { residential: 20, commercial: 20, land: 20, default: 20 }, arrangementFeePct: null,
    sourceLabel: 'SA Home Loans', sourceUrl: 'https://www.sahomeloans.com/',
    sourceNote: 'Rates, deposit, term, fees and approval are quote-specific.', sourceVerifiedAt: '2026-08-11'
  },
  {
    id: 'ooba', name: 'ooba Home Loans', residentialRate: null, commercialRate: null, landRate: null,
    minDepositPct: { residential: 10, commercial: 20, land: 20, default: 10 },
    maxYears: { residential: 20, commercial: 20, land: 20, default: 20 }, arrangementFeePct: null,
    sourceLabel: 'ooba bond originator', sourceUrl: 'https://www.ooba.co.za/home-loans/',
    sourceNote: 'ooba is a bond originator. Any lender offer and approval remain quote-specific.', sourceVerifiedAt: '2026-08-11'
  }
]);

function optionMarkup(items) {
  return items.map((item) => `<option value="${item.code}">${item.label}</option>`).join('\n          ');
}

function replaceSelectOptions(html, id, items) {
  const options = optionMarkup(items);
  const pattern = new RegExp(`(<select id="${id}"[^>]*>)[\\s\\S]*?(</select>)`, 'i');
  return html.replace(pattern, `$1\n          ${options}\n        $2`);
}

function removeAnchorById(html, id) {
  const pattern = new RegExp(`\\s*<a\\b[^>]*\\bid="${id}"[^>]*>[\\s\\S]*?</a>`, 'i');
  return html.replace(pattern, '');
}

function replaceMeta(html, selector, value) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(<meta\\b[^>]*(?:name|property)="${escaped}"[^>]*content=")[^"]*("[^>]*>)`, 'i');
  return html.replace(pattern, `$1${value}$2`);
}

function injectBeforeHeadEnd(html, source) {
  return html.includes(source) ? html : html.replace('</head>', `${source}\n</head>`);
}

function applySouthAfricaHtml(html) {
  const tenant = tenantFor('ZA');
  let output = String(html || '');

  output = output
    .replace(/<html lang="[^"]*"/, '<html lang="en-ZA"')
    .replace('<title>makaug.com | Uganda Property Portal</title>', '<title>seshaikhaya.com | South Africa Property</title>')
    .replace(/<meta name="facebook-domain-verification"[^>]*>\s*/i, '')
    .replace(/<link rel="sitemap"[^>]*Marketplace directory sitemap[^>]*>\s*/i, '')
    .replace(/<link rel="icon" href="\/favicon\.ico" sizes="any">/i, '<link rel="icon" type="image/svg+xml" href="/assets/icons/seshaikhaya-mark.svg">')
    .replace(/<link rel="icon" type="image\/svg\+xml" href="\/assets\/icons\/makaug-mark\.svg">/i, '')
    .replace(/<link rel="icon" type="image\/png" sizes="32x32" href="\/assets\/icons\/makaug-icon-32\.png">/i, '<link rel="icon" type="image/png" sizes="32x32" href="/assets/icons/seshaikhaya-icon-32.png">')
    .replace(/<link rel="icon" type="image\/png" sizes="16x16" href="\/assets\/icons\/makaug-icon-16\.png">/i, '<link rel="icon" type="image/png" sizes="16x16" href="/assets/icons/seshaikhaya-icon-16.png">')
    .replace(/<link rel="apple-touch-icon"[^>]*>/i, '<link rel="apple-touch-icon" sizes="180x180" href="/assets/icons/seshaikhaya-apple-touch-icon.png">')
    .replace('<link rel="manifest" href="/site.webmanifest">', '<link rel="manifest" href="/seshaikhaya.webmanifest">')
    .replace('<meta name="theme-color" content="#15803d">', '<meta name="theme-color" content="#007749">')
    .replace('<body class="bg-gray-50">', '<body class="bg-gray-50" data-country-code="ZA" data-tenant="seshaikhaya">')
    .replace(/<div class="topbar-left flex items-center gap-4">[\s\S]*?<\/div>/i,
      `<div class="topbar-left flex items-center gap-4">
        <span class="inline-flex items-center gap-2"><span aria-hidden="true">🇿🇦</span> South Africa property</span>
        <a href="mailto:${tenant.email}" class="hover:text-amber-200 hidden sm:block"><i class="fas fa-envelope text-amber-300"></i> ${tenant.email}</a>
      </div>`)
    .replace(/<div class="w-10 h-10 rounded-xl bg-green-700 text-white font-black text-xl flex items-center justify-center serif">M<\/div>/,
      '<img src="/assets/icons/seshaikhaya-mark.svg" alt="" width="44" height="44" class="seshaikhaya-logo-mark">')
    .replace(/<div class="text-2xl font-black text-green-800 serif">makaug<span class="text-amber-500">\.com<\/span><\/div>/,
      '<div class="text-2xl font-black text-green-800 serif">sesha<span class="text-amber-500">ikhaya</span></div>')
    .replace('UGANDA PROPERTY', 'SOUTH AFRICA PROPERTY')
    .replace('Use makaug in 9 languages', 'Use seshaikhaya in 11 written languages')
    .replace('A property search engine for Uganda', 'South Africa’s home for property')
    .replace('makaug uses AI-powered search algorithms to scan public online property sources across Uganda, organising',
      'seshaikhaya uses AI-assisted search and human review to organise South African')
    .replace('<span id="hero-property-count">thousands of</span>', '<span id="hero-property-count">reviewed</span>')
    .replace('Search in any language — makaug AI finds real listings.', 'Ask in any South African written language — seshaikhaya finds reviewed listings.')
    .replace(/Ask makaug AI/g, 'Ask seshaikhaya AI')
    .replace(/Mortgage Finder/g, 'Bond Finder')
    .replace(/Request Mortgage Call/g, 'Request Bond Call')
    .replace(/What is a Mortgage\?/g, 'What is a home loan?')
    .replace(/Mortgage Terms Explained/g, 'Bond terms explained')
    .replace(/Mortgage\/Budget Centre/g, 'Bond/Budget Centre')
    .replace(/Open Mortgage Finder/g, 'Open Bond Finder')
    .replace(/<div class="text-2xl font-black serif" id="footer-brand-title">makaug\.com<\/div>/,
      '<div class="text-2xl font-black serif" id="footer-brand-title">seshaikhaya.com</div>')
    .replace(/<p id="footer-brand-copy"[\s\S]*?<\/p>/,
      '<p id="footer-brand-copy" class="text-green-100 text-sm mt-3 leading-relaxed">South Africa’s home for property — buy, rent, land, commercial and student accommodation.</p>')
    .replace(/<div class="mt-4 space-y-2 text-sm text-green-200">[\s\S]*?<\/div>/,
      `<div class="mt-4 space-y-2 text-sm text-green-100">
        <a id="footer-email-label" href="mailto:${tenant.email}" class="block hover:text-white">📧 ${tenant.email}</a>
        <span id="footer-location-label" class="block">📍 South Africa</span>
        <span class="block">WhatsApp number connection pending; test transport is enabled.</span>
      </div>`)
    .replace(/© 2026 makaug\.com/g, '© 2026 seshaikhaya.com')
    .replace(/https:\/\/makaug\.com/g, tenant.domain)
    .replace(/info@makaug\.com/g, tenant.email)
    .replace(/\bUSh\b/g, 'R')
    .replace(/\bUGX\b/g, 'ZAR')
    .replace(/\bUganda's\b/g, "South Africa's")
    .replace(/\bUgandan\b/g, 'South African')
    .replace(/\bUganda\b/g, 'South Africa')
    .replace(/\bKampala\b/g, 'Johannesburg')
    .replace(/Search thousands of listings/g, 'Search reviewed listings')
    .replace(/all 146 districts/g, 'all 9 provinces')
    .replace(/146 districts/g, '9 provinces')
    .replace(/\bdistricts\b/g, 'provinces')
    .replace(/\bdistrict\b/g, 'province')
    .replace(/📧 Email: info@seshaikhaya\.com/g, `📧 Email: ${tenant.email}`)
    .replace(/makaug\.com/g, 'seshaikhaya.com');

  for (const id of ['nav-valuation', 'mnav-valuation', 'nav-marketplace', 'mnav-marketplace']) {
    output = removeAnchorById(output, id);
  }
  output = output
    .replace(/\s*<a\b[^>]*href="\/marketplace[^>]*>[\s\S]*?<\/a>/gi, '')
    .replace(/\s*<a\b[^>]*href="\/valuation[^>]*>[\s\S]*?<\/a>/gi, '')
    .replace(/\s*<a\b[^>]*href="https:\/\/wa\.me\/256760112587[^>]*>[\s\S]*?<\/a>/gi, '')
    .replace(/\s*<a\b[^>]*href="https:\/\/(?:www\.)?(?:instagram|linkedin|facebook|youtube|tiktok|x|twitter)\.com\/[^>]*>[\s\S]*?<\/a>/gi, '');

  output = replaceSelectOptions(output, 'lang-sel', tenant.languages);
  output = replaceSelectOptions(output, 'lang-sel-spotlight', tenant.languages);
  output = replaceSelectOptions(output, 'lp-review-lang-sel', tenant.languages);
  output = replaceSelectOptions(output, 'cur-sel', tenant.currencies);

  output = replaceMeta(output, 'description', "South Africa's home for property. Find reviewed homes, rentals, student accommodation, commercial property and land.");
  output = replaceMeta(output, 'og:site_name', 'seshaikhaya.com');
  output = replaceMeta(output, 'og:title', 'seshaikhaya.com | South Africa Property');
  output = replaceMeta(output, 'og:description', "South Africa's home for property — buy, rent, land, commercial and student.");
  output = replaceMeta(output, 'og:url', `${tenant.domain}/`);
  output = replaceMeta(output, 'twitter:title', 'seshaikhaya.com | South Africa Property');
  output = replaceMeta(output, 'twitter:description', "South Africa's home for property — buy, rent, land, commercial and student.");

  const runtimeConfig = JSON.stringify({
    ...tenant,
    languages: tenant.languages,
    currencies: tenant.currencies,
    lenders: tenant.lenders,
    fxRates: {
      USD: Number(process.env.ZAR_PER_USD || 18),
      EUR: Number(process.env.ZAR_PER_EUR || 21),
      GBP: Number(process.env.ZAR_PER_GBP || 24)
    },
    marker: SESHAIKHAYA_LAUNCH_MARKER
  }).replace(/</g, '\\u003c');
  output = injectBeforeHeadEnd(output, `  <meta name="seshaikhaya-release-marker" content="${SESHAIKHAYA_LAUNCH_MARKER}">\n  <link rel="stylesheet" href="/assets/seshaikhaya.css?v=${SESHAIKHAYA_LAUNCH_MARKER}">\n  <script>window.__COUNTRY_CONFIG__=${runtimeConfig};</script>`);
  return output;
}

function southAfricaLanguagePatch() {
  const dictionaries = {
    af: { siteTitle: 'seshaikhaya.com | Suid-Afrikaanse Eiendom', brandSubtitle: 'SUID-AFRIKA EIENDOM', navSale: 'Te Koop', navRent: 'Te Huur', navStudents: 'Studente', navCommercial: 'Kommersieel', navLand: 'Grond', navBrokers: 'Vind Eiendomsagente', navMortgage: 'Verbandvinder', navAI: 'Vra KI', pageAbout: 'Oor ons', heroRent: 'Huur', heroBuy: 'Koop', heroSearch: 'Soek', heroLocationLabel: 'Ligging', languageSet: 'Taal verander' },
    zu: { siteTitle: 'seshaikhaya.com | Izakhiwo zaseNingizimu Afrika', brandSubtitle: 'IZAKHIWO ZASENINGIZIMU AFRIKA', navSale: 'Okuthengiswayo', navRent: 'Okuqashwayo', navStudents: 'Abafundi', navCommercial: 'Ezohwebo', navLand: 'Umhlaba', navBrokers: 'Thola ama-ejenti', navMortgage: 'Thola ibhondi', navAI: 'Buza i-AI', pageAbout: 'Mayelana nathi', heroRent: 'Qasha', heroBuy: 'Thenga', heroSearch: 'Sesha', heroLocationLabel: 'Indawo', languageSet: 'Ulimi lushintshiwe' },
    xh: { siteTitle: 'seshaikhaya.com | Izindlu eMzantsi Afrika', brandSubtitle: 'IZINDLU EMZANTSI AFRIKA', navSale: 'Ezithengiswayo', navRent: 'Ezokuqeshisa', navStudents: 'Abafundi', navCommercial: 'Urhwebo', navLand: 'Umhlaba', navBrokers: 'Fumana ii-arhente', navMortgage: 'Fumana ibhondi', navAI: 'Buza i-AI', pageAbout: 'Ngathi', heroRent: 'Qesha', heroBuy: 'Thenga', heroSearch: 'Khangela', heroLocationLabel: 'Indawo', languageSet: 'Ulwimi lutshintshiwe' },
    nso: { siteTitle: 'seshaikhaya.com | Dithoto tša Afrika Borwa', brandSubtitle: 'DITHOTO TŠA AFRIKA BORWA', navSale: 'Di a rekišwa', navRent: 'Di a hirišwa', navStudents: 'Baithuti', navCommercial: 'Kgwebo', navLand: 'Naga', navBrokers: 'Hwetša baemedi', navMortgage: 'Hwetša bond', navAI: 'Botšiša AI', pageAbout: 'Ka rena', heroRent: 'Hira', heroBuy: 'Reka', heroSearch: 'Nyaka', heroLocationLabel: 'Lefelo', languageSet: 'Polelo e fetotšwe' },
    tn: { siteTitle: 'seshaikhaya.com | Ditsha tsa Aforika Borwa', brandSubtitle: 'DITSHA TSA AFORIKA BORWA', navSale: 'Tse di rekisiwang', navRent: 'Tse di hirilwang', navStudents: 'Baithuti', navCommercial: 'Kgwebo', navLand: 'Lefatshe', navBrokers: 'Batla baemedi', navMortgage: 'Batla bond', navAI: 'Botsa AI', pageAbout: 'Ka ga rona', heroRent: 'Hira', heroBuy: 'Reka', heroSearch: 'Batla', heroLocationLabel: 'Lefelo', languageSet: 'Puo e fetotswe' },
    st: { siteTitle: 'seshaikhaya.com | Thepa ya Afrika Borwa', brandSubtitle: 'THEPA YA AFRIKA BORWA', navSale: 'E a rekiswa', navRent: 'E a hiriswa', navStudents: 'Baithuti', navCommercial: 'Kgwebo', navLand: 'Mobu', navBrokers: 'Fumana baemedi', navMortgage: 'Fumana bond', navAI: 'Botsa AI', pageAbout: 'Ka rona', heroRent: 'Hira', heroBuy: 'Reka', heroSearch: 'Batla', heroLocationLabel: 'Sebaka', languageSet: 'Puo e fetotswe' },
    ts: { siteTitle: 'seshaikhaya.com | Tindlu ta Afrika Dzonga', brandSubtitle: 'TINDLU TA AFRIKA DZONGA', navSale: 'Swa xavisiwa', navRent: 'Swa hirisiwa', navStudents: 'Vadyondzi', navCommercial: 'Mabindzu', navLand: 'Misava', navBrokers: 'Kuma vayimeri', navMortgage: 'Kuma bond', navAI: 'Vutisa AI', pageAbout: 'Hi hina', heroRent: 'Hira', heroBuy: 'Xava', heroSearch: 'Lava', heroLocationLabel: 'Ndhawu', languageSet: 'Ririmi ri cincile' },
    ss: { siteTitle: 'seshaikhaya.com | Tindlu taseNingizimu Afrika', brandSubtitle: 'TINDLU TASE NINGIZIMU AFRIKA', navSale: 'Kuyatsengiswa', navRent: 'Kuyacashiswa', navStudents: 'Bafundzi', navCommercial: 'Temabhizinisi', navLand: 'Umhlaba', navBrokers: 'Tfola ema-ejenti', navMortgage: 'Tfola ibhondi', navAI: 'Buta i-AI', pageAbout: 'Ngatsi', heroRent: 'Cashisa', heroBuy: 'Tsenga', heroSearch: 'Sesha', heroLocationLabel: 'Indzawo', languageSet: 'Lulwimi lushintjiwe' },
    ve: { siteTitle: 'seshaikhaya.com | Ndaka dza Afrika Tshipembe', brandSubtitle: 'NDAKA DZA AFRIKA TSHIPEMBE', navSale: 'Dzi khou rengiswa', navRent: 'Dzi khou hiriswa', navStudents: 'Matshudeni', navCommercial: 'Mabindu', navLand: 'Mavu', navBrokers: 'Wanani vhaimeleli', navMortgage: 'Wanani bond', navAI: 'Vhudzisani AI', pageAbout: 'Nga ha riṋe', heroRent: 'Hira', heroBuy: 'Renga', heroSearch: 'Ṱoḓa', heroLocationLabel: 'Fhethu', languageSet: 'Luambo lwo shandulwa' },
    nr: { siteTitle: 'seshaikhaya.com | Izindlu zeSewula Afrika', brandSubtitle: 'IZINDLU ZESEWULA AFRIKA', navSale: 'Ezithengiswako', navRent: 'Eziqashiswako', navStudents: 'Abafundi', navCommercial: 'Zokurhweba', navLand: 'Inarha', navBrokers: 'Fumana ama-ejenti', navMortgage: 'Fumana ibhondi', navAI: 'Buza i-AI', pageAbout: 'Ngathi', heroRent: 'Qasha', heroBuy: 'Thenga', heroSearch: 'Rhubhulula', heroLocationLabel: 'Indawo', languageSet: 'Ilimi litjhugululiwe' }
  };
  return `\nObject.entries(${JSON.stringify(dictionaries)}).forEach(([code, values]) => { I18N_UI[code] = Object.assign({}, I18N_UI.en, values); });\n`;
}

function applySouthAfricaJavaScript(source) {
  const tenant = tenantFor('ZA');
  const provinceArray = JSON.stringify(SOUTH_AFRICA_PROVINCES);
  const bondProviders = JSON.stringify(SOUTH_AFRICA_BOND_PROVIDERS);
  const writtenLanguageCodes = JSON.stringify(tenant.languages.map((language) => language.code));
  let output = String(source || '')
    .replace(/const BrandConfig = Object\.freeze\(\{[\s\S]*?\n\}\);/, `const BrandConfig = Object.freeze({\n  productDisplayName: "seshaikhaya.com",\n  domain: "seshaikhaya.com",\n  legalOrInternalName: "seshaikhaya",\n  tagline: "South Africa Property"\n});`)
    .replace(/const DISTRICTS = \[[\s\S]*?\n\];\nconst PROPERTIES = \[[\s\S]*?\n\];\n\nconst SAMPLE_PROPERTY_GALLERIES = \{[\s\S]*?\n\};/, `const DISTRICTS = ${provinceArray};\nconst PROPERTIES = [];\n\nconst SAMPLE_PROPERTY_GALLERIES = {};`)
    .replace(/const BROKERS = \[[\s\S]*?\n\];\n\nBROKERS\.forEach/, 'const BROKERS = [];\n\nBROKERS.forEach')
    .replace(/const CURRENCIES = \{[\s\S]*?\n\};\nconst REVIEW_USD_TO_UGX_GUIDE_RATE = \d+;/,
      `const ZA_FX_RATES = window.__COUNTRY_CONFIG__?.fxRates || {};\nconst CURRENCIES = {\n  ZAR: { fmt: (v, p) => v ? \`R \${formatCompact(v)}\${p ? "/" + p : ""}\` : "Price on application" },\n  USD: { fmt: (v, p) => v ? \`$\${Math.round(v / Number(ZA_FX_RATES.USD || 18)).toLocaleString()}\${p ? "/" + p : ""}\` : "Price on application" },\n  GBP: { fmt: (v, p) => v ? \`£\${Math.round(v / Number(ZA_FX_RATES.GBP || 24)).toLocaleString()}\${p ? "/" + p : ""}\` : "Price on application" },\n  EUR: { fmt: (v, p) => v ? \`€\${Math.round(v / Number(ZA_FX_RATES.EUR || 21)).toLocaleString()}\${p ? "/" + p : ""}\` : "Price on application" }\n};\nconst REVIEW_USD_TO_UGX_GUIDE_RATE = Number(ZA_FX_RATES.USD || 18);`)
    .replace(/const HERO_PRICE_OPTIONS_UGX = \[[\s\S]*?\n\];\nconst HERO_PRICE_OPTIONS_BY_TAB = \{[\s\S]*?\n\};\nconst HERO_BEDROOM_OPTIONS =/,
      `const HERO_PRICE_OPTIONS_UGX = [\n  { value: "", labelKey: "heroAny" },\n  { value: "5000", label: "R 5K" },\n  { value: "10000", label: "R 10K" },\n  { value: "20000", label: "R 20K" },\n  { value: "500000", label: "R 500K" },\n  { value: "1000000", label: "R 1M" },\n  { value: "2000000", label: "R 2M" },\n  { value: "5000000", label: "R 5M" },\n  { value: "10000000", label: "R 10M+" }\n];\nconst HERO_PRICE_OPTIONS_BY_TAB = {\n  sale: [\n    { value: "", labelKey: "heroAny" },\n    { value: "500000", label: "R 500K" },\n    { value: "1000000", label: "R 1M" },\n    { value: "2000000", label: "R 2M" },\n    { value: "5000000", label: "R 5M" },\n    { value: "10000000", label: "R 10M+" }\n  ],\n  rent: [\n    { value: "", labelKey: "heroAny" },\n    { value: "5000", label: "R 5K" },\n    { value: "10000", label: "R 10K" },\n    { value: "15000", label: "R 15K" },\n    { value: "25000", label: "R 25K" },\n    { value: "50000", label: "R 50K+" }\n  ],\n  students: [\n    { value: "", labelKey: "heroAny" },\n    { value: "2500", label: "R 2.5K" },\n    { value: "5000", label: "R 5K" },\n    { value: "7500", label: "R 7.5K" },\n    { value: "10000", label: "R 10K+" }\n  ],\n  commercial: [\n    { value: "", labelKey: "heroAny" },\n    { value: "10000", label: "R 10K" },\n    { value: "25000", label: "R 25K" },\n    { value: "50000", label: "R 50K" },\n    { value: "100000", label: "R 100K" },\n    { value: "500000", label: "R 500K+" }\n  ],\n  land: [\n    { value: "", labelKey: "heroAny" },\n    { value: "250000", label: "R 250K" },\n    { value: "500000", label: "R 500K" },\n    { value: "1000000", label: "R 1M" },\n    { value: "2500000", label: "R 2.5M" },\n    { value: "5000000", label: "R 5M+" }\n  ]\n};\nconst HERO_BEDROOM_OPTIONS =`)
    .replace(/const DEFAULT_MORTGAGE_PROVIDERS = \[[\s\S]*?\n\];\nconst AUDITED_MORTGAGE_PROVIDER_BY_ID/,
      `const DEFAULT_MORTGAGE_PROVIDERS = ${bondProviders};\nconst AUDITED_MORTGAGE_PROVIDER_BY_ID`)
    .replace('const DEFAULT_MORTGAGE_RATE_UPDATED_AT = "2026-06-21";', 'const DEFAULT_MORTGAGE_RATE_UPDATED_AT = "2026-08-11";')
    .replace('const MAP_DEFAULT_CENTER = { lat: 1.3733, lng: 32.2903 };', 'const MAP_DEFAULT_CENTER = { lat: -30.5595, lng: 22.9375 };')
    .replace('const MAP_UGANDA_OVERVIEW_CENTER = { lat: 1.3733, lng: 32.2903 };', 'const MAP_UGANDA_OVERVIEW_CENTER = { lat: -30.5595, lng: 22.9375 };')
    .replace(/const UGANDA_COORD_BOUNDS = \{[\s\S]*?\n\};/, `const UGANDA_COORD_BOUNDS = {\n  latMin: -35.0,\n  latMax: -22.0,\n  lngMin: 16.0,\n  lngMax: 33.0\n};`)
    .replace('return plausibleTotal || 1889;', 'return plausibleTotal || 0;')
    .replace('const LANG_FALLBACK = {', `${southAfricaLanguagePatch()}\nconst LANG_FALLBACK = {`)
    .replace(/const LANG_FALLBACK = \{[\s\S]*?\n\};/, `const LANG_FALLBACK = {\n  en: "en", af: "en", zu: "en", xh: "en", nso: "en", tn: "en", st: "en", ts: "en", ss: "en", ve: "en", nr: "en"\n};`)
    .replace(/function getSupportedMakaugLanguageCode\(lang\) \{[\s\S]*?\n\}/,
      `function getSupportedMakaugLanguageCode(lang) {\n  const code = String(lang || "").trim().toLowerCase();\n  const base = code.split("-")[0];\n  const supported = ${writtenLanguageCodes};\n  return supported.includes(base) && I18N_UI[base] ? base : "";\n}`)
    .replace(/makaug_lang/g, 'seshaikhaya_lang')
    .replace(/let activeCur = "UGX";/, 'let activeCur = "ZAR";')
    .replace(/UGX: \{ fmt: \(v, p\) => v \? `USh \$\{formatCompact\(v\)\}\$\{p \? "\/" \+ p : ""\}` : "Price upon application" \},/,
      'ZAR: { fmt: (v, p) => v ? `R ${formatCompact(v)}${p ? "/" + p : ""}` : "Price on application" },')
    .replace(/\(CURRENCIES\[activeCur\] \|\| CURRENCIES\.UGX\)/g, '(CURRENCIES[activeCur] || CURRENCIES.ZAR)')
    .replace(/\bMortgage Finder\b/g, 'Bond Finder')
    .replace(/\bMortgage\/Budget Centre\b/g, 'Bond/Budget Centre')
    .replace(/\bOpen Mortgage Finder\b/g, 'Open Bond Finder')
    .replace(/makaug uses AI-powered search algorithms to scan public online property sources across Uganda, organising/g,
      'seshaikhaya uses AI-assisted search and human review to organise')
    .replace(/Use makaug in 9 languages/g, 'Use seshaikhaya in 11 written languages')
    .replace(/Uganda's #1 Free Property Platform/gi, "South Africa's home for property")
    .replace(/Uganda's first completely free property platform\./gi, 'A property platform built for South Africa.')
    .replace(/📧 Email: info@makaug\.com/g, '📧 Email: hello@seshaikhaya.com')
    .replace(/\bUSh\b/g, 'R')
    .replace(/\bUGX\b/g, 'ZAR')
    .replace(/\bUganda's\b/g, "South Africa's")
    .replace(/\bUganda\b/g, 'South Africa')
    .replace(/"UGANDA PROPERTY"/g, '"SOUTH AFRICA PROPERTY"')
    .replace(/Ugandan area/g, 'South African area')
    .replace(/all 146 districts/gi, 'all 9 provinces')
    .replace(/146 districts/gi, '9 provinces')
    .replace(/2-bed in Ntinda under 1\.5M/g, '2-bed in Sea Point under R25K/month')
    .replace(/2-bed apartment to rent in Ntinda under 1\.5m/g, '2-bed apartment to rent in Sea Point under R25K/month')
    .replace(/Search thousands of listings/g, 'Search reviewed listings')
    .replace(/\bKampala\b/g, 'Johannesburg')
    .replace(/"District"/g, '"Province"')
    .replace(/"Select district"/g, '"Select province"')
    .replace(/"All districts"/g, '"All provinces"')
    .replace(/\+256 7XX XXX XXX/g, '+27 XX XXX XXXX')
    .replace(/info@makaug\.com/g, 'hello@seshaikhaya.com')
    .replace(/makaug\.com/g, 'seshaikhaya.com')
    .replace(/\bmakaug(?=\s|,|\.|:|!|\?)/gi, 'seshaikhaya')
    .replace(/256760112587/g, '');

  output = `window.__COUNTRY_CONFIG__ = window.__COUNTRY_CONFIG__ || ${JSON.stringify(tenant)};\n${output}`;
  return output;
}

module.exports = {
  SESHAIKHAYA_LAUNCH_MARKER,
  SOUTH_AFRICA_PROVINCES,
  SOUTH_AFRICA_BOND_PROVIDERS,
  applySouthAfricaHtml,
  applySouthAfricaJavaScript
};
