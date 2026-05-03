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

function normalizePath(pathname = '/') {
  const raw = String(pathname || '/').split('?')[0].split('#')[0] || '/';
  return raw.length > 1 ? raw.replace(/\/+$/, '') : raw;
}

function isProtectedPath(pathname = '/') {
  const path = normalizePath(pathname).toLowerCase();
  return PROTECTED_ROUTE_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
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
  if (pathName.startsWith('/property/')) return ['page-detail'];
  if (pathName.startsWith('/agents/') || pathName.startsWith('/broker/')) return ['page-broker-profile'];
  return PUBLIC_ROUTE_PAGE_MAP[pathName] || ['page-home'];
}

function stripUnneededPublicPageBlocks(html, pathname = '/') {
  const pathName = normalizePath(pathname).toLowerCase();
  const isAuthRoute = [
    '/login',
    '/signup',
    '/student-signup',
    '/broker-signup',
    '/field-agent-signup',
    '/advertiser-signup',
    '/forgot-password',
    '/verify-email'
  ].some((route) => pathName === route || pathName.startsWith(`${route}/`));
  if (isAuthRoute) return html;

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
  output = removeBetweenMarkers(output, '<div id="admin-evidence-modal"', '<script>');
  return output;
}

function stripPublicModalBlocks(html, pathname = '/') {
  const pathName = normalizePath(pathname).toLowerCase();
  const isAuthRoute = [
    '/login',
    '/signup',
    '/student-signup',
    '/broker-signup',
    '/field-agent-signup',
    '/advertiser-signup',
    '/forgot-password',
    '/verify-email'
  ].some((route) => pathName === route || pathName.startsWith(`${route}/`));
  if (isAuthRoute) return html;
  let output = String(html || '');
  for (const marker of PUBLIC_MODAL_START_MARKERS) {
    output = removeBetweenMarkers(output, marker, '<script>');
  }
  return output;
}

function sanitizePublicHtml(html, options = {}) {
  const pathname = typeof options === 'string' ? options : options?.pathname;
  let output = stripProtectedPageBlocks(html);
  output = stripUnneededPublicPageBlocks(output, pathname || '/');
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
