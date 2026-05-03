'use strict';

const BASE_URL = String(process.env.BASE_URL || 'https://makaug.com').replace(/\/$/, '');

const ROUTES = [
  '/',
  '/for-sale',
  '/to-rent',
  '/student-accommodation',
  '/students',
  '/land',
  '/commercial',
  '/brokers',
  '/mortgage',
  '/advertise',
  '/about',
  '/how-it-works',
  '/careers',
  '/help',
  '/safety',
  '/anti-fraud',
  '/privacy-policy',
  '/cookie-policy',
  '/terms',
  '/report-fraud',
  '/list-property',
  '/login'
];

const FORBIDDEN_VISIBLE_TEXT = [
  'Admin Dashboard',
  'Admin API Key',
  'Property Finder Dashboard',
  'Student Dashboard',
  'Broker Dashboard',
  'Field Agent Dashboard',
  'Advertiser Dashboard',
  'Lead Centre',
  'Recent Users',
  'Motherboard Listing Control',
  'Listing Review',
  'Paste ADMIN_API_KEY',
  'Sign Out'
];

const MARKERS = {
  '/': ['Find your next home, land, rental, or student room'],
  '/for-sale': ['For Sale', 'No homes for sale', 'Save Search'],
  '/to-rent': ['To Rent', 'No rentals', 'Save Search'],
  '/student-accommodation': ['Student Accommodation', 'Student Housing', 'Campus', 'Student rooms', 'Save Search'],
  '/students': ['Students', 'Student Housing', 'Find rooms near campus', 'Campus'],
  '/land': ['Land', 'Land for Sale', 'Title', 'Plot', 'Save Search'],
  '/commercial': ['Commercial', 'Business space', 'Offices', 'Shops', 'Warehouses'],
  '/brokers': ['Brokers', 'Find a Broker', 'Broker directory', 'Verified brokers'],
  '/mortgage': ['Mortgage', 'Mortgage Finder', 'repayment', 'mortgage help'],
  '/advertise': ['Advertise', 'Campaign', 'Sponsored', 'advertising package'],
  '/about': ['About', 'MakaUg', 'mission'],
  '/how-it-works': ['How MakaUg Works', 'Search property', 'List property'],
  '/careers': ['Careers', 'Field agent signup'],
  '/help': ['Help', 'Help Centre', 'WhatsApp support'],
  '/safety': ['Safety', 'Safety Tips', 'Verify before paying'],
  '/anti-fraud': ['Anti-Fraud', 'Report suspicious', 'Fraud'],
  '/privacy-policy': ['Privacy Policy', 'Data protection'],
  '/cookie-policy': ['Cookie Policy', 'Cookies'],
  '/terms': ['Terms', 'Terms and Conditions', 'Legal review'],
  '/report-fraud': ['Report suspicious', 'Fraud', 'Report a Listing'],
  '/list-property': ['List Your Property', 'Find address or place', 'Submit for review'],
  '/login': ['Sign in or create your MakaUg account', 'Email address or phone number']
};

function visibleText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function routeActiveMarker(route, html) {
  const expectations = {
    '/for-sale': 'page-sale',
    '/to-rent': 'page-rent',
    '/student-accommodation': 'page-students',
    '/students': 'page-students',
    '/land': 'page-land',
    '/commercial': 'page-commercial',
    '/brokers': 'page-brokers',
    '/mortgage': 'page-mortgage',
    '/advertise': 'page-advertise',
    '/how-it-works': 'page-how-it-works',
    '/careers': 'page-careers',
    '/help': 'page-help',
    '/safety': 'page-safety',
    '/anti-fraud': 'page-fraud',
    '/privacy-policy': 'page-privacy-policy',
    '/cookie-policy': 'page-cookie-policy',
    '/terms': 'page-terms',
    '/report-fraud': 'page-fraud',
    '/list-property': 'page-list-property',
    '/login': 'page-login',
    '/about': 'page-about'
  };
  const id = expectations[route];
  if (!id) return /class="[^"]*\bactive\b[^"]*"/.test(html);
  return new RegExp(`id="${id}"[^>]*class="[^"]*\\bactive\\b[^"]*"`, 'i').test(html);
}

async function probe(route) {
  const url = `${BASE_URL}${route === '/' ? '/' : route}?v=${Date.now()}`;
  const response = await fetch(url, { cache: 'no-store' });
  const html = await response.text();
  const text = visibleText(html);
  const failures = [];

  if (response.status !== 200) failures.push(`expected 200, got ${response.status}`);
  if (text.length < 900) failures.push(`body too short (${text.length})`);
  if (!routeActiveMarker(route, html)) failures.push('no active route content marker');
  const markers = MARKERS[route] || [];
  if (!markers.some((marker) => text.toLowerCase().includes(marker.toLowerCase()))) {
    failures.push(`missing route marker (${markers.join(' | ')})`);
  }
  for (const forbidden of FORBIDDEN_VISIBLE_TEXT) {
    if (text.includes(forbidden)) failures.push(`forbidden visible text: ${forbidden}`);
  }
  if (text.includes('This area only This area only')) failures.push('duplicate location scope label');

  return {
    route,
    status: response.status,
    length: text.length,
    marker: markers.find((marker) => text.toLowerCase().includes(marker.toLowerCase())) || '',
    ok: failures.length === 0,
    failures
  };
}

async function main() {
  const results = [];
  for (const route of ROUTES) {
    results.push(await probe(route));
  }
  for (const result of results) {
    console.log(`${result.ok ? 'PASS' : 'FAIL'} ${result.route} status=${result.status} length=${result.length} marker=${result.marker || '-'}`);
    for (const failure of result.failures) console.log(`  - ${failure}`);
  }
  const failed = results.filter((result) => !result.ok);
  if (failed.length) {
    console.error(`Public route probe failed for ${failed.length} route(s).`);
    process.exit(1);
  }
  console.log(`Public route probe passed for ${results.length} route(s) against ${BASE_URL}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
