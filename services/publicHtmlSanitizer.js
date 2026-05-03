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

const PUBLIC_MODAL_START_MARKERS = [
  '<div id="admin-evidence-modal"',
  '<div id="admin-whatsapp-modal"',
  '<div id="list-choice-modal"',
  '<div id="listing-submit-modal"',
  '<div id="save-property-modal"',
  '<div id="auth-modal"',
  '<div id="looking-modal"',
  '<div id="report-modal"',
  '<div id="broker-reg-modal"',
  '<div id="page-modal"',
  '<div id="preview-photo-modal"',
  '<div id="detail-photo-modal"'
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
    body: 'Run paid sponsored listings, broker spotlights, student accommodation campaigns, mortgage partner placements, and WhatsApp-first lead campaigns. Free property listing lives on List Your Property; this page is for campaign packages, review, payment links, and advertiser dashboard access.',
    ctas: ['Start advertising', 'Create advertiser account', 'Ask MakaUg about advertising on WhatsApp'],
    links: ['/advertiser-signup', '/advertiser-dashboard', 'https://wa.me/256760112587?text=Hello%20MakaUg,%20I%20want%20to%20advertise']
  },
  '/how-it-works': {
    title: 'How MakaUg Works',
    eyebrow: 'Simple property journeys',
    body: 'Search public listings, save what matters, contact verified listers with property context, list property for review, and use MakaUg support when you need help.',
    ctas: ['Search property', 'List property', 'Get help'],
    links: ['/for-sale', '/list-property', '/help']
  },
  '/careers': {
    title: 'Careers at MakaUg',
    eyebrow: 'Build Uganda-first property technology',
    body: 'MakaUg works with people who care about trust, field operations, student accommodation, advertising, data quality, and safer property discovery.',
    ctas: ['Send career interest', 'Contact MakaUg', 'Field agent signup'],
    links: ['mailto:info@makaug.com?subject=Career%20interest%20-%20MakaUg', 'https://wa.me/256760112587?text=Hello%20MakaUg,%20I%20am%20interested%20in%20careers', '/field-agent-signup']
  },
  '/help': {
    title: 'MakaUg Help Centre',
    eyebrow: 'Help and WhatsApp support',
    body: 'Get help with search, saved properties, listing submission, broker registration, student accommodation, viewings, callbacks, fraud reports, and account access.',
    ctas: ['WhatsApp support', 'Report an issue', 'Tell MakaUg what you need'],
    links: ['https://wa.me/256760112587?text=Hello%20MakaUg,%20I%20need%20help', '/report-fraud', '/dashboard?intent=property-need']
  },
  '/safety': {
    title: 'MakaUg Safety Tips',
    eyebrow: 'Verify before paying',
    body: 'View property before payment, verify broker or owner identity, use traceable payments, check land title and seller authority, and report suspicious listings quickly.',
    ctas: ['Report suspicious listing', 'Ask MakaUg on WhatsApp', 'Read anti-fraud guidance'],
    links: ['/report-fraud', 'https://wa.me/256760112587?text=Hello%20MakaUg,%20I%20need%20safety%20help', '/anti-fraud']
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
    return `<a href="${href}"${external ? ' target="_blank" rel="noopener noreferrer"' : ''} class="inline-flex rounded-lg bg-white/90 px-3 py-2 text-sm font-semibold text-green-900">${item}</a>`;
  }).join('');
  return `
  <main id="page-${pathName.slice(1).replace(/[^a-z0-9-]/g, '-')}" class="page active" data-public-route="${pathName}">
    <section class="bg-green-800 py-10 text-white">
      <div class="max-w-5xl mx-auto px-4">
        <p class="text-green-200 text-sm font-bold uppercase tracking-wide">${content.eyebrow}</p>
        <h1 class="text-4xl font-black serif mt-2">${content.title}</h1>
        <p class="text-green-50 mt-3 max-w-3xl">${content.body}</p>
        <div class="flex flex-wrap gap-2 mt-5">${ctaHtml}</div>
      </div>
    </section>
    <section class="max-w-5xl mx-auto px-4 py-10">
      <div class="bg-white border border-green-100 rounded-2xl p-6">
        <h2 class="text-2xl font-bold text-gray-900 serif">${content.title}</h2>
        <p class="text-gray-600 mt-3">${content.body}</p>
        <a href="https://wa.me/256760112587" class="inline-flex mt-5 rounded-xl bg-green-700 px-5 py-3 text-white font-semibold">Ask MakaUg on WhatsApp</a>
      </div>
    </section>
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
  output = removeBetweenMarkers(output, '<div id="admin-evidence-modal"', '<script>');
  return output;
}

function stripPublicModalBlocks(html, pathname = '/') {
  let output = String(html || '');
  for (const marker of PUBLIC_MODAL_START_MARKERS) {
    output = removeBetweenMarkers(output, marker, '<script>');
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
    <section class="bg-gradient-to-br from-green-900 via-green-800 to-emerald-800 py-10 text-white">
      <div class="max-w-6xl mx-auto px-4">
        <p class="text-green-200 text-sm font-bold uppercase tracking-wide">MakaUg account access</p>
        <h1 class="text-4xl font-black serif mt-2">Sign in or create your MakaUg account</h1>
        <p class="text-green-50 mt-3 max-w-3xl">Save properties, create alerts, book viewings, and manage your property search faster.</p>
      </div>
    </section>
    <section class="max-w-6xl mx-auto px-4 py-10">
      <div class="grid lg:grid-cols-[1fr_420px] gap-6 items-start">
        <div class="bg-white border border-green-100 rounded-2xl p-6 shadow-sm">
          <h2 class="text-2xl font-black text-gray-900 serif">Choose how you want to continue</h2>
          <p class="text-gray-600 mt-2">Use one clean MakaUg account for property search, student rooms, broker tools, field work, or advertiser campaigns. Admin access is invite-only and is not available through public signup.</p>
          <div class="grid sm:grid-cols-2 gap-3 mt-5">
            <a href="/signup?role=finder" class="rounded-xl border border-green-100 bg-green-50 p-4 text-green-900 font-bold">Property Finder<span class="block text-xs font-normal text-green-800 mt-1">Save, compare, alert, and book.</span></a>
            <a href="/student-signup" class="rounded-xl border border-blue-100 bg-blue-50 p-4 text-blue-900 font-bold">Student<span class="block text-xs font-normal text-blue-800 mt-1">Campus rooms, alerts, and callbacks.</span></a>
            <a href="/broker-signup" class="rounded-xl border border-amber-100 bg-amber-50 p-4 text-amber-900 font-bold">Broker<span class="block text-xs font-normal text-amber-800 mt-1">Listings, leads, and viewings.</span></a>
            <a href="/field-agent-signup" class="rounded-xl border border-gray-200 bg-gray-50 p-4 text-gray-900 font-bold">Field Agent<span class="block text-xs font-normal text-gray-700 mt-1">Apply, submit, and track feedback.</span></a>
            <a href="/advertiser-signup" class="rounded-xl border border-purple-100 bg-purple-50 p-4 text-purple-900 font-bold sm:col-span-2">Advertiser<span class="block text-xs font-normal text-purple-800 mt-1">Campaigns, payments, and leads.</span></a>
          </div>
        </div>
        <div class="bg-white border border-green-100 rounded-2xl p-6 shadow-lg">
          <p class="text-xs font-bold uppercase tracking-wide text-green-700">${roleLabel}</p>
          <h2 class="text-xl font-black text-gray-900 mt-1">Sign in</h2>
          <p class="text-sm text-gray-600 mt-1">Enter your email address or phone number to continue.</p>
          <label class="block text-xs font-bold text-gray-600 mt-4 mb-1">Email address or phone number</label>
          <input id="login-identifier" class="w-full border border-green-100 rounded-xl px-4 py-3 text-sm" autocomplete="username" placeholder="Email address or phone number">
          <label class="block text-xs font-bold text-gray-600 mt-3 mb-1">Password or OTP</label>
          <input id="login-password" type="password" class="w-full border border-green-100 rounded-xl px-4 py-3 text-sm" autocomplete="current-password" placeholder="Password">
          <button type="button" onclick="openAuthSignIn('${mode}')" class="mt-4 w-full bg-green-700 hover:bg-green-600 text-white py-3 rounded-xl font-bold">Continue</button>
          <div class="mt-4 flex flex-wrap gap-3 text-sm">
            <a href="/signup?role=${mode}" class="text-green-700 font-semibold">Create an account</a>
            <a href="/forgot-password" class="text-gray-600 font-semibold">Forgot password?</a>
          </div>
          <div class="mt-5 rounded-xl bg-green-50 border border-green-100 p-3 text-sm text-green-900">
            Students can sign in here too. Use the student option if you want campus searches, room alerts, and student safety tips.
          </div>
        </div>
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
