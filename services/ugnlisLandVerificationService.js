'use strict';

const UGNLIS_PORTAL_URL = 'https://ugnlis.mlhud.go.ug/';
const UGNLIS_MINISTRY_PAGE_URL = 'https://mlhud.go.ug/ugnlis/';
const UGNLIS_SEARCH_FEE_UGX = 10000;
const UGNLIS_SUPPORTED_ONLINE_SEARCH_DISTRICTS = Object.freeze([
  'Mukono',
  'Wakiso',
  'Kampala',
  'Moroto',
  'Arua',
  'Kabarole'
]);

const STATUS_LABELS = Object.freeze({
  not_started: 'Official search not supplied',
  details_collected: 'Title details collected',
  search_letter_supplied: 'Search letter supplied',
  official_verified: 'Official search reviewed',
  issue_found: 'Review needed'
});

function cleanText(value, max = 500) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function cleanDateText(value) {
  const text = cleanText(value, 40);
  if (!text) return '';
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  return text;
}

function cleanUrl(value) {
  const text = cleanText(value, 900);
  return /^https?:\/\//i.test(text) ? text : '';
}

function boolLike(value) {
  if (typeof value === 'boolean') return value;
  return /^(true|1|yes|y|on)$/i.test(cleanText(value));
}

function firstValue(source, keys) {
  for (const key of keys) {
    const value = source?.[key];
    if (value !== undefined && value !== null && cleanText(value)) return value;
  }
  return '';
}

function normalizeUgNlisStatus(value) {
  const key = cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return STATUS_LABELS[key] ? key : '';
}

function flattenInput(input = {}) {
  const safe = input && typeof input === 'object' ? input : {};
  const nested = safe.land_verification && typeof safe.land_verification === 'object' ? safe.land_verification : {};
  const ugnlis = safe.ugnlis && typeof safe.ugnlis === 'object' ? safe.ugnlis : {};
  return { ...safe, ...nested, ...ugnlis };
}

function sanitizeUgNlisLandVerificationFields(input = {}) {
  const source = flattenInput(input);
  const output = {};
  const textFields = [
    ['ugnlis_title_volume', ['ugnlis_title_volume', 'title_volume', 'volume']],
    ['ugnlis_title_folio', ['ugnlis_title_folio', 'title_folio', 'folio']],
    ['ugnlis_county', ['ugnlis_county', 'county']],
    ['ugnlis_block', ['ugnlis_block', 'block']],
    ['ugnlis_plot', ['ugnlis_plot', 'plot']],
    ['ugnlis_transaction_number', ['ugnlis_transaction_number', 'transaction_number', 'transaction_ref']],
    ['ugnlis_search_reference', ['ugnlis_search_reference', 'search_reference', 'search_ref']],
    ['ugnlis_search_notes', ['ugnlis_search_notes', 'search_notes', 'verification_notes']],
    ['land_verification_contact_path', ['land_verification_contact_path', 'contact_path']]
  ];

  textFields.forEach(([target, keys]) => {
    const value = cleanText(firstValue(source, keys), target === 'ugnlis_search_notes' ? 1000 : 180);
    if (value) output[target] = value;
  });

  const searchLetterUrl = cleanUrl(firstValue(source, [
    'ugnlis_search_letter_url',
    'search_letter_url',
    'verification_document_url'
  ]));
  if (searchLetterUrl) output.ugnlis_search_letter_url = searchLetterUrl;

  const searchDate = cleanDateText(firstValue(source, [
    'ugnlis_search_date',
    'search_date',
    'verification_date'
  ]));
  if (searchDate) output.ugnlis_search_date = searchDate;

  const conciergeRequested = firstValue(source, [
    'land_verification_concierge_requested',
    'land_verification_help_requested',
    'land_verification_help',
    'concierge_requested'
  ]);
  if (conciergeRequested !== '') {
    output.land_verification_concierge_requested = boolLike(conciergeRequested);
  }

  const status = normalizeUgNlisStatus(firstValue(source, [
    'land_verification_status',
    'ugnlis_status',
    'status'
  ]));
  if (status) {
    output.land_verification_status = status;
  } else if (searchLetterUrl) {
    output.land_verification_status = 'search_letter_supplied';
  } else if (Object.keys(output).some((key) => key.startsWith('ugnlis_'))) {
    output.land_verification_status = 'details_collected';
  }

  return output;
}

function titleReferenceFrom(extra = {}) {
  const volume = cleanText(extra.ugnlis_title_volume, 80);
  const folio = cleanText(extra.ugnlis_title_folio, 80);
  return [volume && `Volume ${volume}`, folio && `Folio ${folio}`].filter(Boolean).join(' / ');
}

function parcelReferenceFrom(extra = {}) {
  const county = cleanText(extra.ugnlis_county, 120);
  const block = cleanText(extra.ugnlis_block, 80);
  const plot = cleanText(extra.ugnlis_plot, 80);
  return [
    county && `County ${county}`,
    block && `Block ${block}`,
    plot && `Plot ${plot}`
  ].filter(Boolean).join(' / ');
}

function buildUgNlisLandVerificationPack(input = {}) {
  const rawExtra = input?.extra_fields && typeof input.extra_fields === 'object' ? input.extra_fields : input;
  const extra = { ...rawExtra, ...sanitizeUgNlisLandVerificationFields(rawExtra) };
  const status = normalizeUgNlisStatus(extra.land_verification_status) || 'not_started';
  const titleReference = titleReferenceFrom(extra);
  const parcelReference = parcelReferenceFrom(extra);
  const evidence = [
    titleReference && { label: 'Title reference', value: titleReference },
    parcelReference && { label: 'Parcel reference', value: parcelReference },
    cleanText(extra.ugnlis_transaction_number, 120) && {
      label: 'UgNLIS transaction',
      value: cleanText(extra.ugnlis_transaction_number, 120)
    },
    cleanText(extra.ugnlis_search_reference, 120) && {
      label: 'Search reference',
      value: cleanText(extra.ugnlis_search_reference, 120)
    },
    cleanText(extra.ugnlis_search_date, 80) && {
      label: 'Search date',
      value: cleanText(extra.ugnlis_search_date, 80)
    },
    cleanUrl(extra.ugnlis_search_letter_url) && {
      label: 'Search letter',
      value: cleanUrl(extra.ugnlis_search_letter_url)
    }
  ].filter(Boolean);

  return {
    official_portal_url: UGNLIS_PORTAL_URL,
    ministry_page_url: UGNLIS_MINISTRY_PAGE_URL,
    search_fee_ugx: UGNLIS_SEARCH_FEE_UGX,
    supported_online_search_districts: [...UGNLIS_SUPPORTED_ONLINE_SEARCH_DISTRICTS],
    status,
    status_label: STATUS_LABELS[status] || STATUS_LABELS.not_started,
    title_reference: titleReference || null,
    parcel_reference: parcelReference || null,
    search_letter_url: cleanUrl(extra.ugnlis_search_letter_url) || null,
    transaction_number: cleanText(extra.ugnlis_transaction_number, 120) || null,
    search_reference: cleanText(extra.ugnlis_search_reference, 120) || null,
    search_date: cleanText(extra.ugnlis_search_date, 80) || null,
    concierge_requested: boolLike(extra.land_verification_concierge_requested),
    contact_path: cleanText(extra.land_verification_contact_path, 180) || null,
    notes: cleanText(extra.ugnlis_search_notes, 1000) || null,
    evidence,
    public_guidance: 'Official land title searches and transaction tracking should happen on UgNLIS. makaug can guide buyers and listers, store evidence, and show whether a search letter or title reference has been supplied.'
  };
}

function buildUgNlisAssistantReply({ language = 'en', baseUrl = 'https://makaug.com' } = {}) {
  const code = ['lg', 'sw'].includes(language) ? language : 'en';
  const lines = {
    en: [
      'makaug land verification help',
      '',
      'Official land title searches should be done on Uganda’s National Land Information System (UgNLIS):',
      UGNLIS_PORTAL_URL,
      '',
      `User notice: online searches may be available for ${UGNLIS_SUPPORTED_ONLINE_SEARCH_DISTRICTS.join(', ')} at UGX ${UGNLIS_SEARCH_FEE_UGX.toLocaleString('en-UG')}.`,
      '',
      'Next step: reply with the area or district, plot or estate name, size, price, and any title/tenure details you already have.',
      'If you have a volume, folio, block, plot number, search letter, or UgNLIS transaction reference, send it here and makaug will keep the evidence trail against the listing.',
      'makaug can guide the preparation and safety checklist, but the official search and transaction tracking must remain on UgNLIS.',
      '',
      `Land safety guide: ${baseUrl}/safety`,
      '',
      `Start on makaug: ${baseUrl}/#page-land`
    ],
    lg: [
      'makaug okuyamba okukakasa ettaka',
      '',
      'Okunoonyereza ku title y’ettaka okukakasiddwa kukolebwa ku UgNLIS:',
      UGNLIS_PORTAL_URL,
      '',
      `Okusinziira ku bubaka bw'omukozesa, districts eziwerako zisobola okunoonyerezebwako online ku UGX ${UGNLIS_SEARCH_FEE_UGX.toLocaleString('en-UG')}.`,
      '',
      'Ekiddako: sindika ekitundu oba district, erinnya lya plot oba estate, obunene, ebbeeyi, n’ebikwata ku title/tenure by’olina.',
      'Bw’oba olina volume, folio, block, plot number, search letter, oba UgNLIS transaction reference, bisindike wano makaug etereke evidence ku listing.',
      'makaug ekuyamba okutegeka checklist n’obukuumi, naye official search ne transaction tracking bikolebwa ku UgNLIS.',
      '',
      `Ebiragiro by'obukuumi bw'ettaka: ${baseUrl}/safety`,
      '',
      `Tandikira ku makaug: ${baseUrl}/#page-land`
    ],
    sw: [
      'msaada wa makaug kwa uthibitishaji wa ardhi',
      '',
      'Utafutaji rasmi wa hati ya ardhi ufanyike kwenye UgNLIS:',
      UGNLIS_PORTAL_URL,
      '',
      `Taarifa ya mtumiaji: baadhi ya wilaya zinaweza kutafutwa online kwa UGX ${UGNLIS_SEARCH_FEE_UGX.toLocaleString('en-UG')}.`,
      '',
      'Hatua inayofuata: tuma eneo au wilaya, jina la plot/estate, ukubwa, bei, na maelezo yoyote ya title/tenure uliyonayo.',
      'Kama una volume, folio, block, plot number, search letter, au UgNLIS transaction reference, itume hapa na makaug itahifadhi evidence kwenye listing.',
      'makaug inaweza kusaidia maandalizi na safety checklist, lakini official search na transaction tracking lazima zibaki UgNLIS.',
      '',
      `Mwongozo wa usalama wa ardhi: ${baseUrl}/safety`,
      '',
      `Anza kwenye makaug: ${baseUrl}/#page-land`
    ]
  };
  return lines[code].join('\n');
}

module.exports = {
  UGNLIS_PORTAL_URL,
  UGNLIS_MINISTRY_PAGE_URL,
  UGNLIS_SEARCH_FEE_UGX,
  UGNLIS_SUPPORTED_ONLINE_SEARCH_DISTRICTS,
  buildUgNlisAssistantReply,
  buildUgNlisLandVerificationPack,
  sanitizeUgNlisLandVerificationFields
};
