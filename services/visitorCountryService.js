'use strict';

// Resolves the country a site visitor is browsing from, for agent reports.
// Order: edge geo headers (Cloudflare / Render edge), then the browser's IANA
// time zone sent with the analytics event. No IP lookup service, no cost.

const COUNTRY_NAMES = {
  UG: 'Uganda', KE: 'Kenya', RW: 'Rwanda', TZ: 'Tanzania', BI: 'Burundi', SS: 'South Sudan',
  CD: 'DR Congo', ET: 'Ethiopia', SO: 'Somalia', NG: 'Nigeria', GH: 'Ghana', ZA: 'South Africa',
  ZM: 'Zambia', ZW: 'Zimbabwe', MW: 'Malawi', MZ: 'Mozambique', BW: 'Botswana', EG: 'Egypt',
  GB: 'United Kingdom', IE: 'Ireland', US: 'United States', CA: 'Canada', AE: 'United Arab Emirates',
  SA: 'Saudi Arabia', QA: 'Qatar', OM: 'Oman', KW: 'Kuwait', BH: 'Bahrain', IN: 'India', CN: 'China',
  DE: 'Germany', FR: 'France', NL: 'Netherlands', BE: 'Belgium', SE: 'Sweden', NO: 'Norway',
  DK: 'Denmark', IT: 'Italy', ES: 'Spain', CH: 'Switzerland', AU: 'Australia', NZ: 'New Zealand',
  JP: 'Japan', TR: 'Turkey', IL: 'Israel', PK: 'Pakistan', SG: 'Singapore', MY: 'Malaysia'
};

const TIMEZONE_COUNTRY = {
  'Africa/Kampala': 'UG', 'Africa/Nairobi': 'KE', 'Africa/Kigali': 'RW', 'Africa/Dar_es_Salaam': 'TZ',
  'Africa/Bujumbura': 'BI', 'Africa/Juba': 'SS', 'Africa/Kinshasa': 'CD', 'Africa/Lubumbashi': 'CD',
  'Africa/Addis_Ababa': 'ET', 'Africa/Mogadishu': 'SO', 'Africa/Lagos': 'NG', 'Africa/Accra': 'GH',
  'Africa/Johannesburg': 'ZA', 'Africa/Lusaka': 'ZM', 'Africa/Harare': 'ZW', 'Africa/Blantyre': 'MW',
  'Africa/Maputo': 'MZ', 'Africa/Gaborone': 'BW', 'Africa/Cairo': 'EG',
  'Europe/London': 'GB', 'Europe/Belfast': 'GB', 'Europe/Dublin': 'IE', 'Europe/Berlin': 'DE',
  'Europe/Paris': 'FR', 'Europe/Amsterdam': 'NL', 'Europe/Brussels': 'BE', 'Europe/Stockholm': 'SE',
  'Europe/Oslo': 'NO', 'Europe/Copenhagen': 'DK', 'Europe/Rome': 'IT', 'Europe/Madrid': 'ES',
  'Europe/Zurich': 'CH', 'Europe/Istanbul': 'TR',
  'Asia/Dubai': 'AE', 'Asia/Riyadh': 'SA', 'Asia/Qatar': 'QA', 'Asia/Muscat': 'OM', 'Asia/Kuwait': 'KW',
  'Asia/Bahrain': 'BH', 'Asia/Kolkata': 'IN', 'Asia/Calcutta': 'IN', 'Asia/Shanghai': 'CN',
  'Asia/Tokyo': 'JP', 'Asia/Jerusalem': 'IL', 'Asia/Karachi': 'PK', 'Asia/Singapore': 'SG',
  'Asia/Kuala_Lumpur': 'MY',
  'America/New_York': 'US', 'America/Chicago': 'US', 'America/Denver': 'US', 'America/Phoenix': 'US',
  'America/Los_Angeles': 'US', 'America/Anchorage': 'US', 'America/Detroit': 'US',
  'America/Toronto': 'CA', 'America/Vancouver': 'CA', 'America/Edmonton': 'CA', 'America/Winnipeg': 'CA',
  'America/Halifax': 'CA',
  'Australia/Sydney': 'AU', 'Australia/Melbourne': 'AU', 'Australia/Brisbane': 'AU', 'Australia/Perth': 'AU',
  'Australia/Adelaide': 'AU', 'Pacific/Auckland': 'NZ'
};

function normalizeCountryCode(value) {
  const code = String(value || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return '';
  if (code === 'XX' || code === 'T1') return ''; // Cloudflare: unknown / Tor
  return code;
}

function countryFromTimezone(timezone) {
  const tz = String(timezone || '').trim();
  return TIMEZONE_COUNTRY[tz] || '';
}

function resolveVisitorCountry(req, params = {}) {
  const header = (name) => (req && typeof req.get === 'function' ? req.get(name) : '') || '';
  const fromEdge = normalizeCountryCode(
    header('cf-ipcountry') || header('x-vercel-ip-country') || header('x-country-code') || header('x-geo-country')
  );
  if (fromEdge) return fromEdge;
  return countryFromTimezone(params.visitor_timezone || params.visitorTimezone);
}

function countryName(code) {
  const normalized = normalizeCountryCode(code);
  if (!normalized) return 'Unknown';
  return COUNTRY_NAMES[normalized] || normalized;
}

module.exports = {
  COUNTRY_NAMES,
  TIMEZONE_COUNTRY,
  countryFromTimezone,
  countryName,
  normalizeCountryCode,
  resolveVisitorCountry
};
