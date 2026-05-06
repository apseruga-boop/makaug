'use strict';

const PROTECTED_ROUTE_PREFIXES = [
  '/account',
  '/dashboard',
  '/student-dashboard',
  '/broker-dashboard',
  '/field-agent-dashboard',
  '/advertiser-dashboard',
  '/admin',
  '/crm',
  '/revenue',
  '/moderation',
  '/notifications',
  '/payments',
  '/contracts',
  '/whatsapp-inbox'
];

const PUBLIC_FORBIDDEN_STRINGS = [
  'My Account',
  'Sign in required',
  'Profile Information',
  'Security',
  'Current Password',
  'Update Password',
  'Property Finder Dashboard',
  'Student Dashboard',
  'Broker Dashboard',
  'Field Agent Dashboard',
  'Advertiser Dashboard',
  'Admin Dashboard',
  'Admin API Key',
  'Platform control access',
  'Ad Revenue',
  'Review Queue',
  'Advertising Desk',
  'WhatsApp AI Inbox',
  'Listing Review',
  'Motherboard Listing Control',
  'Recent Users',
  'Recent Brokers',
  'Recent Reports',
  'Field Broker Dashboard',
  'CRM',
  'Lead Centre',
  'Data source: local browser data',
  'Paste ADMIN_API_KEY',
  'Inquiry Number: -',
  'Location setup (step-by-step)',
  'dashboard metrics',
  'internal metrics'
];

const PUBLIC_MODAL_IDS = [
  'admin-evidence-modal',
  'admin-whatsapp-modal',
  'list-choice-modal',
  'listing-submit-modal',
  'save-property-modal',
  'auth-modal',
  'looking-modal',
  'report-modal',
  'broker-reg-modal',
  'page-modal',
  'preview-photo-modal',
  'detail-photo-modal'
];

const PUBLIC_PAGE_IDS = [
  'page-home',
  'page-sale',
  'page-rent',
  'page-students',
  'page-commercial',
  'page-land',
  'page-brokers',
  'page-mortgage',
  'page-ai-chatbot',
  'page-fraud',
  'page-broker-profile',
  'page-detail',
  'page-list-property',
  'page-about',
  'page-saved'
];

const PUBLIC_ROUTE_PAGE_MAP = {
  '/': ['page-home'],
  '/for-sale': ['page-sale'],
  '/sale': ['page-sale'],
  '/to-rent': ['page-rent'],
  '/rent': ['page-rent'],
  '/students': ['page-students'],
  '/student-accommodation': ['page-students'],
  '/commercial': ['page-commercial'],
  '/land': ['page-land'],
  '/brokers': ['page-brokers'],
  '/find-brokers': ['page-brokers'],
  '/mortgage': ['page-mortgage'],
  '/mortgage-finder': ['page-mortgage'],
  '/discover-ai-chatbot': ['page-ai-chatbot'],
  '/ai-chatbot': ['page-ai-chatbot'],
  '/fraud': ['page-fraud'],
  '/anti-fraud': ['page-fraud'],
  '/safety': ['page-fraud'],
  '/report-fraud': ['page-fraud'],
  '/list-property': ['page-list-property'],
  '/about': ['page-about'],
  '/saved': ['page-saved']
};

const AUTH_ROUTE_PREFIXES = [
  '/login',
  '/signup',
  '/student-signup',
  '/broker-signup',
  '/field-agent-signup',
  '/advertiser-signup',
  '/forgot-password',
  '/verify-email'
];

const SYNTHETIC_PUBLIC_ROUTE_CONTENT = {
  '/advertise': {
    title: 'Advertise with MakaUg',
    eyebrow: 'Paid advertising campaigns',
    body: 'Run paid sponsored listings, broker spotlights, student accommodation campaigns, mortgage partner placements, and WhatsApp-first lead campaigns. Free property listing lives on List Property; this page is for campaign packages, review, payment links, and advertiser dashboard access.',
    ctas: ['Start advertising', 'Create advertiser account', 'Ask MakaUg about advertising on WhatsApp'],
    links: ['/advertiser-signup', '/advertiser-dashboard', 'https://wa.me/256760112587?text=Hello%20MakaUg,%20I%20want%20to%20advertise']
  },
  '/how-it-works': {
    title: 'How MakaUg Works',
    eyebrow: 'Step-by-step property journeys',
    body: 'Search property, use filters, save properties and searches, create alerts, contact on WhatsApp, book viewings or callbacks, list property, pass review and safety checks, use dashboards, and report suspicious listings.',
    extraHtml: `
      <div class="grid md:grid-cols-2 lg:grid-cols-5 gap-3 mt-6">
        <div class="rounded-2xl border border-green-100 bg-green-50 p-4"><strong>1. Search property</strong><span class="block text-sm text-gray-600 mt-1">Start with sale, rent, land, student rooms, commercial, or brokers.</span></div>
        <div class="rounded-2xl border border-green-100 bg-green-50 p-4"><strong>2. Use filters</strong><span class="block text-sm text-gray-600 mt-1">Narrow by budget, location, beds, amenities, and purpose.</span></div>
        <div class="rounded-2xl border border-green-100 bg-green-50 p-4"><strong>3. Save options</strong><span class="block text-sm text-gray-600 mt-1">Save properties and searches into your MakaUg account.</span></div>
        <div class="rounded-2xl border border-green-100 bg-green-50 p-4"><strong>4. Create alerts</strong><span class="block text-sm text-gray-600 mt-1">Get notified when matching listings go live.</span></div>
        <div class="rounded-2xl border border-green-100 bg-green-50 p-4"><strong>5. WhatsApp contact</strong><span class="block text-sm text-gray-600 mt-1">Contact owners, brokers, or MakaUg with listing context.</span></div>
        <div class="rounded-2xl border border-green-100 bg-green-50 p-4"><strong>6. Book viewing</strong><span class="block text-sm text-gray-600 mt-1">Request a viewing or callback when the lister allows it.</span></div>
        <div class="rounded-2xl border border-green-100 bg-green-50 p-4"><strong>7. List property</strong><span class="block text-sm text-gray-600 mt-1">Use the guided free listing form with address, photos, and verification.</span></div>
        <div class="rounded-2xl border border-green-100 bg-green-50 p-4"><strong>8. Review checks</strong><span class="block text-sm text-gray-600 mt-1">MakaUg checks details before publishing listings.</span></div>
        <div class="rounded-2xl border border-green-100 bg-green-50 p-4"><strong>9. Use dashboards</strong><span class="block text-sm text-gray-600 mt-1">Track saved items, leads, bookings, campaigns, and follow-ups.</span></div>
        <div class="rounded-2xl border border-green-100 bg-green-50 p-4"><strong>10. Report suspicious</strong><span class="block text-sm text-gray-600 mt-1">Flag risky listings quickly so admin can review.</span></div>
      </div>
    `,
    ctas: ['Search property', 'List Property', 'Get help'],
    links: ['/for-sale', '/list-property', '/help']
  },
  '/careers': {
    title: 'Careers at MakaUg',
    eyebrow: 'Build Uganda-first property technology',
    body: 'MakaUg works with people who care about trust, field operations, student accommodation, advertising, data quality, and safer property discovery.',
    extraHtml: `
      <form id="career-interest-form" onsubmit="submitCareerInterest(event)" class="mt-8 rounded-3xl bg-white border border-green-100 p-5 space-y-3">
        <h2 class="text-xl font-black text-gray-900">Send career interest</h2>
        <p class="text-sm text-gray-600">Share your role interest, contact details, and an optional CV link. MakaUg logs this for admin follow-up.</p>
        <div class="grid md:grid-cols-2 gap-3">
          <input name="name" class="border border-gray-200 rounded-xl px-4 py-3 text-sm" placeholder="Full name" required>
          <input name="email" type="email" class="border border-gray-200 rounded-xl px-4 py-3 text-sm" placeholder="Email address" required>
          <input name="phone" class="border border-gray-200 rounded-xl px-4 py-3 text-sm" placeholder="Phone / WhatsApp">
          <select name="role_interest" class="border border-gray-200 rounded-xl px-4 py-3 text-sm bg-white" required>
            <option value="">Role interest</option>
            <option value="Field operations">Field operations</option>
            <option value="Trust and safety">Trust and safety</option>
            <option value="Product and engineering">Product and engineering</option>
            <option value="Market growth">Market growth</option>
            <option value="Customer support">Customer support</option>
            <option value="Other">Other</option>
          </select>
          <select name="preferred_contact" class="border border-gray-200 rounded-xl px-4 py-3 text-sm bg-white">
            <option value="email">Email</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="phone">Phone call</option>
          </select>
          <input name="cv_url" type="url" class="border border-gray-200 rounded-xl px-4 py-3 text-sm" placeholder="CV link, e.g. Google Drive">
        </div>
        <textarea name="cover_note" rows="3" class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm" placeholder="Short note, availability, or relevant experience"></textarea>
        <div id="career-interest-status" class="hidden rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800"></div>
        <button type="submit" class="w-full bg-green-700 hover:bg-green-600 text-white rounded-xl px-4 py-3 text-center font-bold">Send career interest</button>
      </form>
    `,
    ctas: ['Send career interest', 'Contact MakaUg', 'Field agent signup'],
    links: ['/careers#career-interest-form', 'https://wa.me/256760112587?text=Hello%20MakaUg,%20I%20am%20interested%20in%20careers', '/field-agent-signup']
  },
  '/help': {
    title: 'MakaUg Help Centre',
    eyebrow: 'Help and WhatsApp support',
    body: 'Find quick help for searching, listing, student accommodation, saved searches and alerts, viewings and callbacks, brokers and agents, land and title safety, fraud reports, account access, and paid advertising.',
    extraHtml: `
      <div class="grid md:grid-cols-2 lg:grid-cols-5 gap-3 mt-6">
        <a class="rounded-2xl border border-green-100 bg-green-50 p-4 hover:border-green-300" href="/for-sale"><strong>Finding property</strong><span class="block text-sm text-gray-600 mt-1">Search, filters, maps, and recommendations.</span></a>
        <a class="rounded-2xl border border-green-100 bg-green-50 p-4 hover:border-green-300" href="/list-property"><strong>Listing property</strong><span class="block text-sm text-gray-600 mt-1">Address, photos, verification, and review.</span></a>
        <a class="rounded-2xl border border-green-100 bg-green-50 p-4 hover:border-green-300" href="/student-accommodation"><strong>Student accommodation</strong><span class="block text-sm text-gray-600 mt-1">Campus searches, budget, safety, and callbacks.</span></a>
        <a class="rounded-2xl border border-green-100 bg-green-50 p-4 hover:border-green-300" href="/dashboard"><strong>Saved searches and alerts</strong><span class="block text-sm text-gray-600 mt-1">Save searches and choose alert channels.</span></a>
        <a class="rounded-2xl border border-green-100 bg-green-50 p-4 hover:border-green-300" href="/help"><strong>Book viewings and callbacks</strong><span class="block text-sm text-gray-600 mt-1">Request a viewing, callback, or WhatsApp follow-up.</span></a>
        <a class="rounded-2xl border border-green-100 bg-green-50 p-4 hover:border-green-300" href="/brokers"><strong>Brokers and agents</strong><span class="block text-sm text-gray-600 mt-1">Profiles, leads, trust, and enquiries.</span></a>
        <a class="rounded-2xl border border-green-100 bg-green-50 p-4 hover:border-green-300" href="/safety"><strong>Land and title safety</strong><span class="block text-sm text-gray-600 mt-1">Verify title, seller authority, and payment safety.</span></a>
        <a class="rounded-2xl border border-green-100 bg-green-50 p-4 hover:border-green-300" href="/anti-fraud"><strong>Fraud and suspicious listings</strong><span class="block text-sm text-gray-600 mt-1">Report risky listings and get safety help.</span></a>
        <a class="rounded-2xl border border-green-100 bg-green-50 p-4 hover:border-green-300" href="/login"><strong>Account and login</strong><span class="block text-sm text-gray-600 mt-1">Sign in, create account, roles, and OTP.</span></a>
        <a class="rounded-2xl border border-green-100 bg-green-50 p-4 hover:border-green-300" href="/advertise"><strong>Advertising with MakaUg</strong><span class="block text-sm text-gray-600 mt-1">Campaign packages, payment, and performance.</span></a>
      </div>
      <form id="help-request-form" onsubmit="submitHelpRequest(event)" class="mt-8 rounded-3xl bg-white border border-green-100 p-5 space-y-3">
        <h3 class="text-xl font-black text-gray-900">Contact MakaUg support</h3>
        <div class="grid md:grid-cols-2 gap-3">
          <input name="name" required class="border border-green-100 rounded-xl px-4 py-3 text-sm" placeholder="Your name">
          <input name="email" type="email" required class="border border-green-100 rounded-xl px-4 py-3 text-sm" placeholder="Email address">
          <input name="phone" required class="border border-green-100 rounded-xl px-4 py-3 text-sm" placeholder="Phone / WhatsApp">
          <select name="topic" class="border border-green-100 rounded-xl px-4 py-3 text-sm"><option>Finding property</option><option>Listing property</option><option>Student accommodation</option><option>Fraud report</option><option>Advertising with MakaUg</option><option>Account and login</option></select>
        </div>
        <textarea name="message" required class="w-full border border-green-100 rounded-xl px-4 py-3 text-sm" rows="4" placeholder="How can MakaUg help?"></textarea>
        <select name="preferredContactMethod" class="w-full border border-green-100 rounded-xl px-4 py-3 text-sm"><option value="whatsapp">WhatsApp</option><option value="phone">Phone call</option><option value="email">Email</option></select>
        <button type="submit" class="rounded-xl bg-green-700 px-5 py-3 text-white font-bold">Send help request</button>
        <div data-help-request-status class="text-sm text-gray-600"></div>
      </form>
    `,
    ctas: ['WhatsApp support', 'Report an issue', 'Tell MakaUg what you need'],
    links: ['https://wa.me/256760112587?text=Hello%20MakaUg,%20I%20need%20help', '/report-fraud', '/dashboard?intent=property-need']
  },
  '/safety': {
    i18nPrefix: 'safety',
    ctaKeys: ['reportCta', 'whatsappCta', 'fraudCta'],
    title: 'makaug.com Safety Tips',
    eyebrow: 'Verify before paying',
    body: 'Simple, practical checks for every property journey: view safely, verify identity, confirm authority, use traceable payments, and report suspicious pressure quickly.',
    extraHtml: `
      <div class="rounded-3xl bg-white border border-green-100 p-5 mt-6">
        <h3 class="text-2xl font-black text-gray-900" data-content-i18n="safety.introTitle">A safer property journey starts before the viewing</h3>
        <p class="text-sm text-gray-600 mt-2 max-w-3xl" data-content-i18n="safety.introBody">Treat every listing as something to verify. Keep messages, compare prices, inspect in person, confirm documents, and avoid paying anyone who rushes you.</p>
      </div>
      <div class="grid md:grid-cols-2 lg:grid-cols-4 gap-4 mt-6" data-safety-stakeholder-grid="1">
        <article class="rounded-3xl bg-white border border-green-100 p-4"><div data-safety-illustration="renters" class="h-24 rounded-2xl bg-green-50 grid place-items-center text-green-800"><i class="fas fa-house-user text-4xl"></i></div><strong class="block mt-3" data-content-i18n="safety.rentersTitle">Renters</strong><span class="block text-sm text-gray-600 mt-1" data-content-i18n="safety.rentersText">View first, check utilities, confirm authority, and never send reservation money before verification.</span></article>
        <article class="rounded-3xl bg-white border border-green-100 p-4"><div data-safety-illustration="buyers" class="h-24 rounded-2xl bg-amber-50 grid place-items-center text-amber-700"><i class="fas fa-file-signature text-4xl"></i></div><strong class="block mt-3" data-content-i18n="safety.buyersTitle">Buyers</strong><span class="block text-sm text-gray-600 mt-1" data-content-i18n="safety.buyersText">Confirm seller authority, inspect the location, use legal support, and keep traceable records.</span></article>
        <article class="rounded-3xl bg-white border border-green-100 p-4"><div data-safety-illustration="students" class="h-24 rounded-2xl bg-blue-50 grid place-items-center text-blue-700"><i class="fas fa-graduation-cap text-4xl"></i></div><strong class="block mt-3" data-content-i18n="safety.studentsTitle">Students and parents</strong><span class="block text-sm text-gray-600 mt-1" data-content-i18n="safety.studentsText">Check campus distance, access, water, power, rules, and emergency support before paying.</span></article>
        <article class="rounded-3xl bg-white border border-green-100 p-4"><div data-safety-illustration="owners" class="h-24 rounded-2xl bg-orange-50 grid place-items-center text-orange-700"><i class="fas fa-key text-4xl"></i></div><strong class="block mt-3" data-content-i18n="safety.ownersTitle">Owners and sellers</strong><span class="block text-sm text-gray-600 mt-1" data-content-i18n="safety.ownersText">Share only necessary documents, verify serious prospects, and keep written records.</span></article>
        <article class="rounded-3xl bg-white border border-green-100 p-4"><div data-safety-illustration="brokers" class="h-24 rounded-2xl bg-lime-50 grid place-items-center text-lime-700"><i class="fas fa-briefcase text-4xl"></i></div><strong class="block mt-3" data-content-i18n="safety.brokersTitle">Brokers</strong><span class="block text-sm text-gray-600 mt-1" data-content-i18n="safety.brokersText">Use accurate details, confirm owner authority, record communication, and disclose fees clearly.</span></article>
        <article class="rounded-3xl bg-white border border-green-100 p-4"><div data-safety-illustration="land" class="h-24 rounded-2xl bg-emerald-50 grid place-items-center text-emerald-700"><i class="fas fa-map-marked-alt text-4xl"></i></div><strong class="block mt-3" data-content-i18n="safety.landTitle">Land seekers</strong><span class="block text-sm text-gray-600 mt-1" data-content-i18n="safety.landText">Check title, boundaries, access roads, neighbours, and survey details before any payment.</span></article>
        <article class="rounded-3xl bg-white border border-green-100 p-4"><div data-safety-illustration="commercial" class="h-24 rounded-2xl bg-slate-50 grid place-items-center text-slate-700"><i class="fas fa-store text-4xl"></i></div><strong class="block mt-3" data-content-i18n="safety.commercialTitle">Commercial users</strong><span class="block text-sm text-gray-600 mt-1" data-content-i18n="safety.commercialText">Confirm zoning, loading, parking, power, lease terms, and business permits.</span></article>
        <article class="rounded-3xl bg-white border border-green-100 p-4"><div data-safety-illustration="diaspora" class="h-24 rounded-2xl bg-purple-50 grid place-items-center text-purple-700"><i class="fas fa-globe-africa text-4xl"></i></div><strong class="block mt-3" data-content-i18n="safety.diasporaTitle">Diaspora buyers</strong><span class="block text-sm text-gray-600 mt-1" data-content-i18n="safety.diasporaText">Use trusted local verification, legal support, video walk-throughs, and traceable payments only.</span></article>
      </div>
      <div class="grid lg:grid-cols-2 gap-5 mt-6">
        <section class="rounded-3xl bg-green-50 border border-green-100 p-5">
          <h3 class="text-xl font-black text-green-950">Before money changes hands</h3>
          <ul class="mt-4 space-y-2 text-sm text-green-950">
            <li>View or verify the property through someone you trust.</li>
            <li>Confirm the identity and authority of the owner, broker, or caretaker.</li>
            <li>For land, verify title and boundaries through official channels.</li>
            <li>Use written terms, receipts, and traceable payment channels.</li>
            <li>Report pressure, fake documents, or suspicious payment requests.</li>
          </ul>
        </section>
        <section class="rounded-3xl bg-white border border-red-100 p-5">
          <h3 class="text-xl font-black text-gray-900">See something suspicious?</h3>
          <p class="text-sm text-gray-600 mt-2">Stop the conversation, keep screenshots and payment details, then report it so makaug.com can review the listing.</p>
          <a href="/report-fraud" class="inline-flex mt-4 rounded-xl bg-red-600 px-4 py-2 text-sm font-black text-white">Report suspicious listing</a>
        </section>
      </div>
    `,
    ctas: ['Report suspicious listing', 'Ask makaug.com on WhatsApp', 'Read anti-fraud guidance'],
    links: ['/report-fraud', 'https://wa.me/256760112587?text=Hello%20makaug.com,%20I%20need%20safety%20help', '/anti-fraud']
  },
  '/terms': {
    title: 'MakaUg Terms and Conditions',
    eyebrow: 'Legal review required',
    body: 'These terms explain acceptable use, listing responsibilities, moderation, advertising, payments, user content, account access, and platform limitations. Final legal review is still required before formal publication.',
    ctas: ['Contact support', 'Privacy policy', 'Cookie policy'],
    links: ['/help', '/privacy-policy', '/cookie-policy']
  },
  '/privacy-policy': {
    title: 'MakaUg Privacy Policy',
    eyebrow: 'Data protection',
    body: 'MakaUg uses personal data for account access, property enquiries, saved searches, alerts, fraud prevention, support, advertising operations, and consent-aware analytics.',
    ctas: ['Data request', 'Update preferences', 'Contact privacy support'],
    links: ['/help', '/login?next=%2Faccount%3Ftab%3Dpreferences', 'mailto:info@makaug.com?subject=Privacy%20request']
  },
  '/cookie-policy': {
    title: 'MakaUg Cookie Policy',
    eyebrow: 'Cookies and preferences',
    body: 'MakaUg uses necessary cookies for security and sessions, plus preference, analytics, and advertising cookies where configured and lawful.',
    ctas: ['Manage preferences', 'Privacy policy', 'Contact support'],
    links: ['/login?next=%2Faccount%3Ftab%3Dpreferences', '/privacy-policy', '/help']
  }
};

function normalizePath(pathname = '/') {
  const raw = String(pathname || '/').split('?')[0].split('#')[0] || '/';
  return raw.length > 1 ? raw.replace(/\/+$/, '') : raw;
}

function isProtectedPath(pathname = '/') {
  const path = normalizePath(pathname).toLowerCase();
  return PROTECTED_ROUTE_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

function isAuthRoute(pathname = '/') {
  const pathName = normalizePath(pathname).toLowerCase();
  return AUTH_ROUTE_PREFIXES.some((route) => pathName === route || pathName.startsWith(`${route}/`));
}

function roleCanAccessProtectedPath(auth = {}, pathname = '') {
  const role = String(auth?.role || '').toLowerCase();
  const audience = String(auth?.audience || auth?.account_kind || '').toLowerCase();
  const pathName = normalizePath(pathname).toLowerCase();
  const isAdminRole = role === 'admin' || role === 'super_admin';
  if (role === 'super_admin') return true;
  if (pathName.startsWith('/admin')) return isAdminRole;
  if (pathName.startsWith('/broker-dashboard')) return role === 'agent_broker' || isAdminRole;
  if (pathName.startsWith('/field-agent-dashboard')) return role === 'field_agent' || isAdminRole;
  if (pathName.startsWith('/student-dashboard')) return isAdminRole || audience === 'student';
  if (pathName.startsWith('/advertiser-dashboard')) return isAdminRole || audience === 'advertiser';
  if (pathName.startsWith('/dashboard')) return isAdminRole || audience === 'finder' || audience === 'property_finder' || !audience;
  return Boolean(role);
}

function removeBetweenMarkers(html, startMarker, endMarker) {
  let output = String(html || '');
  let start = output.indexOf(startMarker);
  while (start !== -1) {
    const end = output.indexOf(endMarker, start + startMarker.length);
    if (end === -1) break;
    output = `${output.slice(0, start)}${output.slice(end)}`;
    start = output.indexOf(startMarker);
  }
  return output;
}

function findDivBlockEnd(html, start) {
  const source = String(html || '');
  const tagRe = /<\/?div\b[^>]*>/gi;
  tagRe.lastIndex = start;
  let depth = 0;
  let match;
  while ((match = tagRe.exec(source))) {
    if (match[0].startsWith('</')) {
      depth -= 1;
      if (depth <= 0) return tagRe.lastIndex;
    } else {
      depth += 1;
    }
  }
  return -1;
}

function removeElementById(html, id) {
  let output = String(html || '');
  let start = output.indexOf(`<div id="${id}"`);
  while (start !== -1) {
    const end = findDivBlockEnd(output, start);
    if (end === -1) break;
    output = `${output.slice(0, start)}${output.slice(end)}`;
    start = output.indexOf(`<div id="${id}"`);
  }
  return output;
}

function getPageBlockBounds(html, pageId) {
  const startMarker = `<div id="${pageId}"`;
  const start = String(html || '').indexOf(startMarker);
  if (start === -1) return null;
  const restStart = start + startMarker.length;
  const nextPage = String(html || '').indexOf('<div id="page-', restStart);
  const footer = String(html || '').indexOf('<footer', restStart);
  const script = String(html || '').indexOf('<script>', restStart);
  const candidates = [nextPage, footer, script].filter((idx) => idx !== -1);
  const end = candidates.length ? Math.min(...candidates) : String(html || '').length;
  return { start, end };
}

function removePageBlockById(html, pageId) {
  let output = String(html || '');
  const bounds = getPageBlockBounds(output, pageId);
  if (!bounds) return output;
  return `${output.slice(0, bounds.start)}${output.slice(bounds.end)}`;
}

function getPublicPageIdsForRoute(pathname = '/') {
  const pathName = normalizePath(pathname).toLowerCase();
  if (isAuthRoute(pathName)) return [];
  if (SYNTHETIC_PUBLIC_ROUTE_CONTENT[pathName]) return [];
  if (pathName.startsWith('/property/')) return ['page-detail'];
  if (pathName.startsWith('/agents/') || pathName.startsWith('/broker/')) return ['page-broker-profile'];
  return PUBLIC_ROUTE_PAGE_MAP[pathName] || ['page-home'];
}

function activatePublicPageBlock(html, pathname = '/') {
  const keep = getPublicPageIdsForRoute(pathname);
  if (!keep.length) return html;
  let output = String(html || '');
  for (const pageId of keep) {
    const start = output.indexOf(`<div id="${pageId}"`);
    if (start === -1) continue;
    const end = output.indexOf('>', start);
    if (end === -1) continue;
    const opening = output.slice(start, end + 1);
    let nextOpening = opening;
    if (/class="/.test(nextOpening)) {
      nextOpening = nextOpening.replace(/class="([^"]*)"/, (_match, classes) => {
        const cleanClasses = String(classes || '').split(/\s+/).filter((item) => item && item !== 'active');
        cleanClasses.push('active');
        return `class="${cleanClasses.join(' ')}"`;
      });
    } else {
      nextOpening = nextOpening.replace(/>$/, ' class="active">');
    }
    output = `${output.slice(0, start)}${nextOpening}${output.slice(end + 1)}`;
  }
  return output;
}

function renderSyntheticRouteContent(pathname = '/') {
  const pathName = normalizePath(pathname).toLowerCase();
  const content = SYNTHETIC_PUBLIC_ROUTE_CONTENT[pathName];
  if (!content) return '';
  const ctaHtml = content.ctas.map((item, index) => {
    const href = (content.links || [])[index] || '/help';
    const external = /^https?:|^mailto:/i.test(href);
    const ctaKey = content.i18nPrefix && content.ctaKeys?.[index]
      ? ` data-content-i18n="${content.i18nPrefix}.${content.ctaKeys[index]}"`
      : '';
    return `<a href="${href}"${external ? ' target="_blank" rel="noopener noreferrer"' : ''} class="inline-flex rounded-lg bg-white/90 px-3 py-2 text-sm font-semibold text-green-900"${ctaKey}>${item}</a>`;
  }).join('');
  const videoContext = {
    '/about': 'about',
    '/how-it-works': 'how-it-works',
    '/help': 'help',
    '/safety': 'safety',
    '/anti-fraud': 'safety',
    '/list-property': 'list-property',
    '/student-accommodation': 'students',
    '/students': 'students'
  }[pathName] || '';
  const videoSection = videoContext
    ? `<section class="max-w-5xl mx-auto px-4 pb-10"><div class="rounded-3xl bg-white border border-green-100 p-5 md:p-6" data-howto-video-grid="${videoContext}"></div></section>`
    : '';
  return `
  <main id="page-${pathName.slice(1).replace(/[^a-z0-9-]/g, '-')}" class="page active" data-public-route="${pathName}">
    <section class="bg-green-800 py-10 text-white">
      <div class="max-w-5xl mx-auto px-4">
        <p class="text-green-200 text-sm font-bold uppercase tracking-wide"${content.i18nPrefix ? ` data-content-i18n="${content.i18nPrefix}.eyebrow"` : ''}>${content.eyebrow}</p>
        <h1 class="text-4xl font-black serif mt-2"${content.i18nPrefix ? ` data-content-i18n="${content.i18nPrefix}.title"` : ''}>${content.title}</h1>
        <p class="text-green-50 mt-3 max-w-3xl"${content.i18nPrefix ? ` data-content-i18n="${content.i18nPrefix}.subtitle"` : ''}>${content.body}</p>
        <div class="flex flex-wrap gap-2 mt-5">${ctaHtml}</div>
      </div>
    </section>
    <section class="max-w-5xl mx-auto px-4 py-10">
      <div class="bg-white border border-green-100 rounded-2xl p-6">
        <h2 class="text-2xl font-bold text-gray-900 serif"${content.i18nPrefix ? ` data-content-i18n="${content.i18nPrefix}.title"` : ''}>${content.title}</h2>
        <p class="text-gray-600 mt-3"${content.i18nPrefix ? ` data-content-i18n="${content.i18nPrefix}.subtitle"` : ''}>${content.body}</p>
        ${content.extraHtml || ''}
        <a href="https://wa.me/256760112587" class="inline-flex mt-5 rounded-xl bg-green-700 px-5 py-3 text-white font-semibold">Ask makaug.com on WhatsApp</a>
      </div>
    </section>
    ${videoSection}
  </main>
`;
}

function injectSyntheticRouteContent(html, pathname = '/') {
  const synthetic = renderSyntheticRouteContent(pathname);
  if (!synthetic) return html;
  const footerIndex = String(html || '').indexOf('<footer');
  if (footerIndex === -1) return `${html}${synthetic}`;
  return `${String(html).slice(0, footerIndex)}${synthetic}${String(html).slice(footerIndex)}`;
}

function stripUnneededPublicPageBlocks(html, pathname = '/') {
  const pathName = normalizePath(pathname).toLowerCase();
  const keep = new Set(getPublicPageIdsForRoute(pathName));
  let output = String(html || '');
  for (const pageId of PUBLIC_PAGE_IDS) {
    if (!keep.has(pageId)) {
      output = removePageBlockById(output, pageId);
    }
  }
  return output;
}

function stripProtectedPageBlocks(html) {
  let output = String(html || '');
  output = removeBetweenMarkers(output, '<div id="page-account"', '<div id="page-finder-dashboard"');
  output = removeBetweenMarkers(output, '<div id="page-finder-dashboard"', '<div id="page-student-dashboard"');
  output = removeBetweenMarkers(output, '<div id="page-student-dashboard"', '<div id="page-agent-dashboard"');
  output = removeBetweenMarkers(output, '<div id="page-agent-dashboard"', '<div id="page-field-dashboard"');
  output = removeBetweenMarkers(output, '<div id="page-field-dashboard"', '<div id="page-admin-dashboard"');
  output = removeBetweenMarkers(output, '<div id="page-admin-dashboard"', '<div id="page-about"');
  output = removeBetweenMarkers(output, '<div id="page-admin-docs"', '<div id="page-saved"');
  output = removeElementById(output, 'admin-evidence-modal');
  output = removeElementById(output, 'admin-whatsapp-modal');
  return output;
}

function stripPublicModalBlocks(html, pathname = '/') {
  let output = String(html || '');
  const pathName = normalizePath(pathname).toLowerCase();
  const preserve = new Set(pathName === '/list-property' ? ['list-choice-modal', 'listing-submit-modal'] : []);
  for (const id of PUBLIC_MODAL_IDS) {
    if (preserve.has(id)) continue;
    output = removeElementById(output, id);
  }
  return output;
}

function authRouteMode(pathname = '/') {
  const pathName = normalizePath(pathname).toLowerCase();
  if (pathName.includes('student')) return 'student';
  if (pathName.includes('broker')) return 'agent';
  if (pathName.includes('field-agent')) return 'field_agent';
  if (pathName.includes('advertiser')) return 'advertiser';
  return 'finder';
}

function renderAuthRouteContent(pathname = '/') {
  if (!isAuthRoute(pathname)) return '';
  const mode = authRouteMode(pathname);
  const roleLabels = {
    finder: 'Property Finder',
    student: 'Student',
    agent: 'Broker',
    field_agent: 'Field Agent',
    advertiser: 'Advertiser'
  };
  const roleLabel = roleLabels[mode] || roleLabels.finder;
  return `
  <main id="page-login" class="page active" data-page="login" data-public-route="/login">
    <section class="min-h-[52vh] bg-gradient-to-br from-green-950 via-green-900 to-emerald-800 py-14 text-white">
      <div class="max-w-3xl mx-auto px-4 text-center">
        <p class="text-green-200 text-sm font-bold uppercase tracking-wide">makaug.com account</p>
        <h1 class="text-4xl font-black serif mt-2">Opening your makaug.com account panel</h1>
        <p class="text-green-50 mt-3">Sign in or create your account in the same secure drawer used across the site.</p>
        <button type="button" onclick="openAuthSignIn('${mode}')" class="mt-6 inline-flex items-center justify-center bg-white text-green-900 rounded-xl px-5 py-3 font-black">Open account panel</button>
        <p class="text-xs text-green-100 mt-4">Selected account type: ${roleLabel}. You can choose a different account type inside the panel before creating an account.</p>
      </div>
    </section>
  </main>
`;
}

function injectAuthRouteContent(html, pathname = '/') {
  const authContent = renderAuthRouteContent(pathname);
  if (!authContent) return html;
  const footerIndex = String(html || '').indexOf('<footer');
  if (footerIndex === -1) return `${html}${authContent}`;
  return `${String(html).slice(0, footerIndex)}${authContent}${String(html).slice(footerIndex)}`;
}

function sanitizePublicHtml(html, options = {}) {
  const pathname = typeof options === 'string' ? options : options?.pathname;
  let output = stripProtectedPageBlocks(html);
  output = stripUnneededPublicPageBlocks(output, pathname || '/');
  output = activatePublicPageBlock(output, pathname || '/');
  output = injectSyntheticRouteContent(output, pathname || '/');
  output = injectAuthRouteContent(output, pathname || '/');
  output = stripPublicModalBlocks(output, pathname || '/');
  for (const forbidden of PUBLIC_FORBIDDEN_STRINGS) {
    output = output.split(forbidden).join('');
  }
  output = output.replace(/moderation/gi, 'review');
  return output;
}

function renderProtectedLoginShell(pathname = '/', options = {}) {
  const next = normalizePath(pathname);
  const safeNext = /moderation/i.test(next) ? '/admin' : next;
  const loginUrl = `/login?next=${encodeURIComponent(safeNext)}`;
  const title = String(options.title || 'Private MakaUg area');
  const message = String(options.message || 'This MakaUg workspace is private. Sign in with the right account to continue.');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,noarchive">
  <title>Sign in | MakaUg</title>
  <style>
    body{margin:0;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f7faf7;color:#152033;min-height:100vh;display:grid;place-items:center}
    main{width:min(92vw,420px);background:white;border:1px solid #dcefe0;border-radius:22px;padding:28px;box-shadow:0 18px 44px rgba(15,72,35,.10)}
    .brand{display:flex;align-items:center;gap:12px;margin-bottom:18px;font-weight:900;font-size:26px;color:#14783d}
    .mark{width:42px;height:42px;border-radius:12px;background:#2f7d3b;color:#fff;display:grid;place-items:center}
    h1{font-size:24px;margin:0 0 8px}
    p{line-height:1.5;color:#526070;margin:0 0 18px}
    a{display:block;text-align:center;background:#14783d;color:#fff;text-decoration:none;border-radius:14px;padding:13px 16px;font-weight:800}
  </style>
</head>
<body>
  <main>
    <div class="brand"><span class="mark">M</span><span>makaug<span style="color:#e89b1b">.com</span></span></div>
    <h1>${title.replace(/[<>&"]/g, '')}</h1>
    <p>${message.replace(/[<>&"]/g, '')}</p>
    <a href="${loginUrl}">Continue to sign in</a>
  </main>
</body>
</html>`;
}

module.exports = {
  PUBLIC_FORBIDDEN_STRINGS,
  isProtectedPath,
  roleCanAccessProtectedPath,
  renderProtectedLoginShell,
  sanitizePublicHtml
};
