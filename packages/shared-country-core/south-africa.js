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

function saslAccessibilityPageHtml() {
  return `
  <main id="page-sasl" class="page active" data-public-route="/sasl" data-sasl-help-page>
    <section class="bg-green-800 py-10 text-white">
      <div class="max-w-5xl mx-auto px-4">
        <p class="text-green-200 text-sm font-bold uppercase tracking-wide">Accessibility</p>
        <h1 class="text-4xl font-black serif mt-2">South African Sign Language (SASL)</h1>
        <p class="text-green-50 mt-3 max-w-3xl">SASL mode keeps English text available while prioritising signed video, captions and clear visual navigation.</p>
      </div>
    </section>
    <section class="max-w-5xl mx-auto px-4 py-10">
      <div class="grid gap-5 md:grid-cols-2">
        <article class="bg-white border border-green-100 rounded-2xl p-6">
          <h2 class="text-2xl font-bold text-gray-900 serif">What SASL mode changes</h2>
          <ul class="mt-4 list-disc pl-5 space-y-2 text-gray-700">
            <li>English text remains visible as the written companion language.</li>
            <li>Available SASL versions of help videos are prioritised.</li>
            <li>Video guidance must include captions or a written transcript.</li>
            <li>The selected accessibility mode is saved on this device.</li>
          </ul>
        </article>
        <article class="bg-white border border-green-100 rounded-2xl p-6" data-sasl-video-support>
          <h2 class="text-2xl font-bold text-gray-900 serif">Signed video support</h2>
          <p class="mt-4 text-gray-700">Signed walkthroughs will be labelled <strong>SASL video</strong>. Where a signed version is not yet available, English captions and written steps remain available.</p>
          <p class="mt-4 text-sm text-gray-600">No silent or uncaptioned help video should be the only explanation of a property journey.</p>
        </article>
      </div>
      <a href="/" class="inline-flex mt-6 rounded-xl bg-green-700 px-5 py-3 text-white font-semibold">Return to property search</a>
    </section>
  </main>`;
}

function southAfricaPrivacyPageHtml(email) {
  return `
  <main id="page-privacy-policy" class="page active" data-public-route="/privacy-policy" data-popia-privacy-notice="2026-08-12">
    <section class="bg-green-800 py-10 text-white">
      <div class="max-w-5xl mx-auto px-4">
        <p class="text-green-200 text-sm font-bold uppercase tracking-wide">POPIA privacy notice</p>
        <h1 class="text-4xl font-black serif mt-2">How seshaikhaya handles personal information</h1>
        <p class="text-green-50 mt-3 max-w-3xl">This notice explains sourced property listings, private-seller contact protection, enquiries, retention, and your rights under South Africa's Protection of Personal Information Act.</p>
        <p class="text-green-100 text-xs mt-3">Effective: 12 August 2026</p>
      </div>
    </section>
    <section class="max-w-5xl mx-auto px-4 py-10 space-y-5 text-sm text-gray-700">
      <article class="bg-white border border-green-100 rounded-2xl p-6">
        <h2 class="text-2xl font-black text-gray-900">Responsible party and Information Officer</h2>
        <p class="mt-3">seshaikhaya is the responsible party for the processing described here. Privacy and data-subject requests go to the seshaikhaya Information Officer queue through the secure form below or <a class="font-bold text-green-700" href="mailto:${email}">${email}</a>. We may verify identity before disclosing or changing personal information.</p>
      </article>
      <div class="grid md:grid-cols-2 gap-5">
        <article class="bg-white border border-green-100 rounded-2xl p-6">
          <h2 class="text-xl font-black text-gray-900">Information and sources</h2>
          <p class="mt-3">We process account and enquiry details, listing facts, canonical location and price data, security and audit records, and limited information from public property posts. A sourced result keeps the original post link and source attribution. Private-seller phone numbers and email addresses are retained server-side for enquiry relay and are not displayed publicly.</p>
        </article>
        <article class="bg-white border border-green-100 rounded-2xl p-6">
          <h2 class="text-xl font-black text-gray-900">Purpose and lawful basis</h2>
          <p class="mt-3">We process information to provide property discovery, relay requested enquiries, prevent fraud, maintain accurate source attribution, secure the service, and handle claims or removals. Depending on the activity, the basis is consent, performance of a requested service, legal obligation, or our and users' legitimate interests, balanced against the data subject's rights. Public-source collection is limited to information deliberately made public or otherwise lawfully available, where POPIA permits it.</p>
        </article>
        <article class="bg-white border border-green-100 rounded-2xl p-6">
          <h2 class="text-xl font-black text-gray-900">Private sellers and enquiries</h2>
          <p class="mt-3">A private seller's personal phone number or email is gated behind “Contact via seshaikhaya”. The seeker submits an enquiry to us; we relay it to the stored contact without exposing that contact in the public listing API or page. The seller decides whether to reply. The original public source remains visible for attribution.</p>
        </article>
        <article class="bg-white border border-green-100 rounded-2xl p-6">
          <h2 class="text-xl font-black text-gray-900">Sharing and safeguards</h2>
          <p class="mt-3">We do not sell personal information. We share only what is needed with hosting, email or messaging, security, analytics, and authorised platform providers, or where law requires it. Access controls, audit logs, encryption where supported, and data minimisation protect the service. Cross-border providers are assessed and contractually restricted where applicable.</p>
        </article>
      </div>
      <article class="bg-white border border-red-100 rounded-2xl p-6" data-youtube-api-privacy>
        <h2 class="text-xl font-black text-gray-900">YouTube API Services</h2>
        <p class="mt-3">seshaikhaya uses YouTube API Services to find public South African property videos and retain source attribution. The API may provide a video's ID and link, title, description, channel name and ID, publication time, and thumbnail URL. We use API-key access to public data only; this feature does not ask users to sign in to YouTube, does not access private YouTube account data, and does not post, edit, or delete anything on YouTube.</p>
        <p class="mt-3">YouTube remains the source of YouTube video metadata. Property categories, prices, locations, confidence decisions, and review outcomes shown by seshaikhaya are seshaikhaya product data and are not supplied or endorsed by YouTube. We do not download or rehost YouTube audiovisual content.</p>
        <p class="mt-3">Public YouTube API data is refreshed or deleted within 30 calendar days. A user or rights holder may ask us to delete related stored data through the secure form below; we action a valid request as soon as possible and within 7 calendar days. Deleting data from seshaikhaya does not delete anything stored by YouTube.</p>
        <p class="mt-3">Use of YouTube features is also governed by the <a class="font-bold text-green-700" href="https://www.youtube.com/t/terms" target="_blank" rel="noopener noreferrer">YouTube Terms of Service</a>. Google's handling of information is explained in the <a class="font-bold text-green-700" href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Google Privacy Policy</a>. An embedded YouTube player may share device, playback, and fraud-prevention information with YouTube when it loads or plays; autoplay remains off.</p>
      </article>
      <article class="bg-white border border-green-100 rounded-2xl p-6">
        <h2 class="text-xl font-black text-gray-900">Retention</h2>
        <ul class="mt-3 list-disc pl-5 space-y-2">
          <li>Public YouTube API data: refreshed or deleted within 30 calendar days.</li>
          <li>Unclaimed sourced-listing facts and private-seller relay contacts: up to 183 days without revalidation, or earlier on removal or expiry.</li>
          <li>Property enquiries: up to 365 days after the last activity.</li>
          <li>Claim, correction and takedown audit records: up to 1,095 days so objections are not accidentally undone and disputes can be investigated.</li>
          <li>We delete or anonymise records when the period ends, unless a legal obligation, active dispute, fraud investigation, or lawful hold requires longer retention.</li>
        </ul>
      </article>
      <article class="bg-white border border-red-100 rounded-2xl p-6">
        <h2 class="text-xl font-black text-gray-900">Claim, correction and immediate removal</h2>
        <p class="mt-3">Each sourced listing provides claim, correction and removal controls. A private seller's removal request immediately hides the public result and records an audit event; staff verification follows without automatically republishing it. You may also request access, correction, deletion, objection, or restriction, and may lodge a complaint with South Africa's Information Regulator.</p>
      </article>
      <article class="bg-white border border-green-100 rounded-2xl p-6" id="popia-request-form">
        <h2 class="text-xl font-black text-gray-900">Send a POPIA request</h2>
        <form class="mt-4 grid gap-3" onsubmit="return submitSouthAfricaPrivacyRequest(event)">
          <input id="popia-request-name" required class="border border-gray-200 rounded-xl px-3 py-2" placeholder="Your name">
          <input id="popia-request-contact" required class="border border-gray-200 rounded-xl px-3 py-2" placeholder="Email or South African phone">
          <select id="popia-request-type" class="border border-gray-200 rounded-xl px-3 py-2 bg-white">
            <option value="access">Access my information</option><option value="correction">Correct my information</option><option value="deletion">Delete my information</option><option value="objection">Object to processing</option><option value="complaint">Privacy complaint</option><option value="other">Other privacy request</option>
          </select>
          <textarea id="popia-request-details" required rows="4" class="border border-gray-200 rounded-xl px-3 py-2" placeholder="Tell the Information Officer what information or listing this concerns"></textarea>
          <button id="popia-request-submit" class="rounded-xl bg-green-700 px-5 py-3 text-white font-bold" type="submit">Send secure request</button>
          <p id="popia-request-status" class="text-sm" role="status" aria-live="polite"></p>
        </form>
      </article>
    </section>
  </main>`;
}

function southAfricaTermsPageHtml(email) {
  return `
  <main id="page-terms" class="page active" data-public-route="/terms" data-south-africa-terms="2026-08-12">
    <section class="bg-green-800 py-10 text-white">
      <div class="max-w-5xl mx-auto px-4">
        <p class="text-green-200 text-sm font-bold uppercase tracking-wide">Platform terms</p>
        <h1 class="text-4xl font-black serif mt-2">seshaikhaya Terms and Conditions</h1>
        <p class="text-green-50 mt-3 max-w-3xl">seshaikhaya is a South African property discovery platform. Third-party results are source-attributed discovery records, not transaction guarantees.</p>
        <p class="text-green-100 text-xs mt-3">Effective: 12 August 2026</p>
      </div>
    </section>
    <section class="max-w-5xl mx-auto px-4 py-10 space-y-5 text-sm text-gray-700">
      <article class="bg-white border border-green-100 rounded-2xl p-6 space-y-4">
        <section><h2 class="text-xl font-black text-gray-900">Platform scope and accounts</h2><p class="mt-2">By using seshaikhaya.com, you agree to these Terms, applicable South African law, and the platform's safety and listing standards. Users must provide accurate information, protect account credentials, and market only property they own or are authorised to list. seshaikhaya is not an escrow service, law firm, estate agency, or party to a property transaction.</p></section>
        <section><h2 class="text-xl font-black text-gray-900">Third-party property sources</h2><p class="mt-2">Some records link to public posts supplied by third parties. seshaikhaya does not claim ownership of their videos, images, captions, trademarks, or contact details, and does not guarantee availability, price, authority, title, or accuracy unless a separate verification label expressly says so. Check the original source and perform independent legal, identity, title, and payment verification.</p></section>
        <section data-youtube-api-terms><h2 class="text-xl font-black text-gray-900">YouTube API Services</h2><p class="mt-2">seshaikhaya uses YouTube API Services for public-source discovery and attribution. By using pages or features that contain YouTube API data or an embedded YouTube player, you also agree to be bound by the <a class="font-bold text-green-700" href="https://www.youtube.com/t/terms" target="_blank" rel="noopener noreferrer">YouTube Terms of Service</a>. YouTube content remains on YouTube and is identified by its source link or branding. seshaikhaya is not affiliated with or endorsed by YouTube or Google. See our <a class="font-bold text-green-700" href="/privacy-policy">Privacy Policy</a> and the <a class="font-bold text-green-700" href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Google Privacy Policy</a>.</p></section>
        <section><h2 class="text-xl font-black text-gray-900">Claim, correction, and removal</h2><p class="mt-2">Owners, sellers, estate agents, creators, rights holders, and authorised representatives may request a claim, correction, or removal. A private-seller removal request immediately hides the public result while staff verify the request. Removing a seshaikhaya record does not delete the original post or other data held by the source platform.</p></section>
        <section><h2 class="text-xl font-black text-gray-900">Safety and prohibited conduct</h2><p class="mt-2">Fraud, impersonation, deceptive listings, forged documents, malicious links, attempts to bypass security, and unauthorised copying or rehosting of third-party media are prohibited. Users must independently verify the property, seller or agent, authority, title or tenure, and payment instructions before transacting.</p></section>
        <section><h2 class="text-xl font-black text-gray-900">Fees, liability, and governing law</h2><p class="mt-2">Free listings, advertising, featured placement, and other paid services may have additional published terms. seshaikhaya does not guarantee a transaction, title validity, seller or tenant performance, financing, or freedom from third-party disputes. These Terms are governed by South African law and disputes are subject to courts with competent jurisdiction in South Africa.</p></section>
        <section><h2 class="text-xl font-black text-gray-900">Contact</h2><p class="mt-2">Questions about these Terms can be sent to <a class="font-bold text-green-700" href="mailto:${email}">${email}</a>.</p></section>
      </article>
    </section>
  </main>`;
}

function applySouthAfricaHtml(html, { pathname = '/' } = {}) {
  const tenant = tenantFor('ZA');
  const normalizedPathname = String(pathname || '/').split('?')[0].split('#')[0].replace(/\/+$/, '') || '/';
  let output = String(html || '');

  output = output
    .replace(/<html lang="[^"]*"/, '<html lang="en-ZA"')
    .replace('<title>makaug.com | Uganda Property Portal</title>', '<title>seshaikhaya.com | South Africa Property</title>')
    .replace(/<meta name="makaug-k24-marker"/i, '<meta name="seshaikhaya-intake-integrity-marker"')
    .replace(/<meta name="makaug-release-marker"/i, '<meta name="seshaikhaya-shared-release-marker"')
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
    .replace('Use makaug in 9 languages', 'Use seshaikhaya in 12 official languages')
    .replace('A property search engine for Uganda', 'South Africa’s home for property')
    .replace('makaug uses AI-powered search algorithms to scan public online property sources across Uganda, organising',
      'seshaikhaya uses AI-assisted search and human review to organise South African')
    .replace('<span id="hero-property-count">thousands of</span>', '<span id="hero-property-count">reviewed</span>')
    .replace('Search in any language — makaug AI finds real listings.', 'Ask in any South African language — seshaikhaya finds reviewed listings.')
    .replace(/Ask makaug AI/g, 'Ask seshaikhaya AI')
    .replace(/makaug how-to video/gi, 'seshaikhaya how-to video')
    .replace(/Help makaug find/g, 'Help seshaikhaya find')
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
    .replace(/\bDistricts\b/g, 'Provinces')
    .replace(/\bDistrict\b/g, 'Province')
    .replace(/\bdistricts\b/g, 'provinces')
    .replace(/\bdistrict\b/g, 'province')
    .replace(/📧 Email: info@seshaikhaya\.com/g, `📧 Email: ${tenant.email}`)
    .replace(/makaug\.com/g, 'seshaikhaya.com')
    .replace(/(<a id="footer-link-help"[\s\S]*?<\/a>)/i,
      '$1\n            <a id="footer-link-sasl" href="/sasl" class="block cursor-pointer hover:text-white">SASL accessibility</a>')
    .replace(/(<option value="private">Privately listed<\/option>)/g,
      '$1\n              <option value="private_seller">Private seller — no agent commission</option>');

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

  if (normalizedPathname === '/sasl') {
    output = output
      .replace('<body class="bg-gray-50" data-country-code="ZA" data-tenant="seshaikhaya">',
        '<body class="bg-gray-50" data-country-code="ZA" data-tenant="seshaikhaya" data-public-route-sasl="true">')
      .replace(/<footer\b/i, `${saslAccessibilityPageHtml()}\n<footer`);
  }
  if (normalizedPathname === '/privacy-policy') {
    output = output.replace(
      /<main id="page-privacy-policy"[\s\S]*?<\/main>/i,
      southAfricaPrivacyPageHtml(tenant.email)
    );
  }
  if (normalizedPathname === '/terms') {
    output = output.replace(
      /<main id="page-terms"[\s\S]*?<\/main>/i,
      southAfricaTermsPageHtml(tenant.email)
    );
  }

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
    nr: { siteTitle: 'seshaikhaya.com | Izindlu zeSewula Afrika', brandSubtitle: 'IZINDLU ZESEWULA AFRIKA', navSale: 'Ezithengiswako', navRent: 'Eziqashiswako', navStudents: 'Abafundi', navCommercial: 'Zokurhweba', navLand: 'Inarha', navBrokers: 'Fumana ama-ejenti', navMortgage: 'Fumana ibhondi', navAI: 'Buza i-AI', pageAbout: 'Ngathi', heroRent: 'Qasha', heroBuy: 'Thenga', heroSearch: 'Rhubhulula', heroLocationLabel: 'Indawo', languageSet: 'Ilimi litjhugululiwe' },
    sasl: { siteTitle: 'seshaikhaya.com | SASL accessibility', brandSubtitle: 'SOUTH AFRICA PROPERTY · SASL MODE', langBanner: 'SASL accessibility mode: English text retained; signed and captioned help prioritised.', languageSet: 'SASL accessibility mode enabled' }
  };
  return `\nObject.entries(${JSON.stringify(dictionaries)}).forEach(([code, values]) => { I18N_UI[code] = Object.assign({}, I18N_UI.en, values); });\n`;
}

function applySouthAfricaJavaScript(source) {
  const tenant = tenantFor('ZA');
  const provinceArray = JSON.stringify(SOUTH_AFRICA_PROVINCES);
  const bondProviders = JSON.stringify(SOUTH_AFRICA_BOND_PROVIDERS);
  const officialLanguageCodes = JSON.stringify(tenant.languages.map((language) => language.code));
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
    .replace(/const LANG_FALLBACK = \{[\s\S]*?\n\};/, `const LANG_FALLBACK = {\n  en: "en", af: "en", zu: "en", xh: "en", nso: "en", tn: "en", st: "en", ts: "en", ss: "en", ve: "en", nr: "en", sasl: "en"\n};`)
    .replace(/function getSupportedMakaugLanguageCode\(lang\) \{[\s\S]*?\n\}/,
      `function getSupportedMakaugLanguageCode(lang) {\n  const code = String(lang || "").trim().toLowerCase();\n  const base = code.split("-")[0];\n  const supported = ${officialLanguageCodes};\n  return supported.includes(base) && I18N_UI[base] ? base : "";\n}`)
    .replace('document.documentElement.lang = currentLang;', `document.documentElement.lang = currentLang === "sasl" ? "en-ZA" : currentLang;\n  document.documentElement.dataset.selectedLanguage = currentLang;\n  document.documentElement.classList.toggle("sasl-accessibility-mode", currentLang === "sasl");\n  if (document.body) {\n    const saslMode = currentLang === "sasl";\n    document.body.classList.toggle("sasl-accessibility-mode", saslMode);\n    let saslBanner = document.getElementById("sasl-accessibility-banner");\n    if (saslMode && !saslBanner) {\n      saslBanner = document.createElement("aside");\n      saslBanner.id = "sasl-accessibility-banner";\n      saslBanner.setAttribute("role", "status");\n      saslBanner.setAttribute("aria-live", "polite");\n      saslBanner.innerHTML = 'SASL accessibility mode is on. English text is retained. <a href="/sasl">Signed video and caption support</a>.';\n      document.body.prepend(saslBanner);\n    }\n    if (saslBanner) saslBanner.hidden = !saslMode;\n    document.querySelectorAll("[data-sasl-video]").forEach((node) => {\n      node.toggleAttribute("data-sasl-priority", saslMode);\n      node.style.order = saslMode ? "-1" : "";\n      const video = node.matches("video") ? node : node.querySelector("video");\n      if (video && saslMode) video.controls = true;\n      video?.querySelectorAll('track[kind="captions"], track[kind="subtitles"]').forEach((track) => {\n        track.default = saslMode;\n      });\n    });\n  }`)
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
    .replace(/Use makaug in 9 languages/g, 'Use seshaikhaya in 12 official languages')
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
    .replace(/\bGayaza\b/g, 'Stellenbosch')
    .replace(/\bMakerere\b/g, 'UCT')
    .replace(/\bKololo\b/g, 'Rosebank')
    .replace(/\bBukoto\b/g, 'Claremont')
    .replace(/\bMuyenga\b/g, 'Bryanston')
    .replace(/\bKira\b/g, 'Midrand')
    .replace(/\bNamugongo\b/g, 'Centurion')
    .replace(/\bMukono\b/g, 'Paarl')
    .replace(/\bMatugga\b/g, 'Franschhoek')
    .replace(/\bNakasero\b/g, 'Sandton')
    .replace(/\bKyambogo\b/g, 'UJ')
    .replace(/\bMUBS\b/g, 'Wits')
    .replace(/under 300M/g, 'under R3M')
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

  output = `window.__COUNTRY_CONFIG__ = window.__COUNTRY_CONFIG__ || ${JSON.stringify(tenant)};\n${output}\n
async function submitSouthAfricaPrivacyRequest(event) {
  event?.preventDefault();
  const status = document.getElementById("popia-request-status");
  const button = document.getElementById("popia-request-submit");
  if (status) { status.textContent = "Sending…"; status.className = "text-sm text-gray-600"; }
  if (button) button.disabled = true;
  try {
    const response = await fetch("/api/contact/privacy-request", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({
        name: document.getElementById("popia-request-name")?.value || "",
        contact: document.getElementById("popia-request-contact")?.value || "",
        request_type: document.getElementById("popia-request-type")?.value || "other",
        details: document.getElementById("popia-request-details")?.value || ""
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || (payload.details || []).join(", ") || "Could not send request");
    if (status) { status.textContent = "Request received. Reference: " + (payload.data?.reference || payload.data?.id || "saved"); status.className = "text-sm font-bold text-green-800"; }
    if (event?.target?.reset) event.target.reset();
  } catch (error) {
    if (status) { status.textContent = error.message || "Could not send request"; status.className = "text-sm font-bold text-red-700"; }
  } finally {
    if (button) button.disabled = false;
  }
  return false;
}`;
  return output;
}

module.exports = {
  SESHAIKHAYA_LAUNCH_MARKER,
  SOUTH_AFRICA_PROVINCES,
  SOUTH_AFRICA_BOND_PROVIDERS,
  applySouthAfricaHtml,
  applySouthAfricaJavaScript
};
