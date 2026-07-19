'use strict';

const MARKETPLACE_RELEVANCE_MARKER = 'marketplace-relevance-gate-20260719';

const GLOBAL_EXCLUDED_TYPES = Object.freeze(new Set([
  'school',
  'university',
  'primary_school',
  'secondary_school',
  'educational_institution',
  'research_institute',
  'local_government_office',
  'government_office',
  'city_hall',
  'courthouse',
  'police',
  'fire_station',
  'gas_station',
  'supermarket',
  'convenience_store',
  'general_store',
  'hardware_store',
  'church',
  'mosque',
  'hospital',
  'general_hospital',
  'medical_center',
  'medical_clinic',
  'doctor',
  'pharmacy',
  'lodging',
  'hotel',
  'restaurant',
  'bar',
  'bank',
  'atm'
]));

// Google sometimes adds these types to legitimate professional offices. Treat
// them as exclusions only when the business name also identifies a government
// entity; GLOBAL_NAME_EXCLUSIONS performs that corroborating check below.
const CONTEXTUAL_EXCLUDED_TYPES = Object.freeze(new Set([
  'local_government_office',
  'government_office'
]));

const GLOBAL_NAME_EXCLUSIONS = Object.freeze([
  { reason: 'education', pattern: /\b(?:institute|school|college|academy|vocational|university)\b/i },
  { reason: 'government', pattern: /\b(?:municipal council|district council|local government|government office|ministry|city hall|courthouse)\b/i },
  { reason: 'police_or_prison', pattern: /\b(?:police|prison|correctional)\b/i },
  { reason: 'fuel_station', pattern: /\b(?:(?:petrol|fuel|gas|service|filling)\s+station|station\s+(?:petrol|fuel|gas|service|filling))\b/i },
  { reason: 'retail_not_service', pattern: /\b(?:supermarket|general stores?|hardware(?:\s+(?:shop|store))?|convenience store)\b/i },
  { reason: 'religious', pattern: /\b(?:church|mosque|cathedral|parish)\b/i },
  { reason: 'medical', pattern: /\b(?:hospital|clinic|medical centre|medical center|pharmacy|doctor)\b/i },
  { reason: 'hospitality', pattern: /\b(?:hotel|lodge|restaurant|bar)\b/i },
  { reason: 'beauty', pattern: /\b(?:beauty salon|hair salon|nail salon|salon)\b/i },
  { reason: 'bank_branch_or_forex', pattern: /\b(?:bank branch|atm|forex|bureau de change)\b/i }
]);

const CATEGORY_RELEVANCE = Object.freeze({
  surveyors: {
    queryTerm: 'land surveyor',
    strong: [/\b(?:land|quantity|property|engineering)?\s*survey(?:or|ors|ing|s)?\b/i, /\b(?:cadastral|geomatics?)\b/i],
    weak: [/\b(?:boundary|mapping)\b/i]
  },
  brokers: {
    queryTerm: 'real estate agency',
    includedType: 'real_estate_agency',
    strong: [/\breal estate\b/i, /\bproperty\s+(?:broker|agent|agency|lettings?|sales)\b/i, /\b(?:realtor|estate agents?|broker|lettings?)\b/i],
    weak: [/\bproperty consultancy\b/i]
  },
  developers: {
    queryTerm: 'property developer',
    strong: [/\b(?:property|real estate|housing)\s+develop(?:er|ers|ment)\b/i, /\b(?:homes|estates)\s+(?:uganda|developers?|development)\b/i],
    weak: [/\bdevelop(?:er|ers|ment)\b/i],
    reject: [/\b(?:software|web|app|ngo|community|human|youth|skills?)\s+development\b/i, /\b(?:software|web|app)\s+developers?\b/i]
  },
  property_lawyers: {
    queryTerm: 'property lawyer',
    includedType: 'lawyer',
    strong: [/\b(?:property|land|real estate)\s+(?:lawyer|law|legal|advocate|conveyanc)\w*\b/i, /\b(?:conveyanc\w*|lawyers?|law firm|advocates?|legal|chambers)\b/i],
    weak: [/\bcommissioners? for oaths?\b/i]
  },
  valuers: {
    queryTerm: 'property valuer',
    strong: [/\b(?:property|land|real estate|asset)\s+valu(?:er|ers|ation)\b/i, /\b(?:valuation\s+surveyors?|valu(?:er|ers|ation))\b/i],
    weak: [/\bappraisal\b/i]
  },
  mortgage_providers: {
    queryTerm: 'mortgage lender',
    strong: [/\b(?:mortgage|home loan|housing finance|property finance|real estate finance)\b/i],
    weak: [/\b(?:lender|lending|credit|loans?)\b/i],
    reject: [/\b(?:bank branch|atm|forex|bureau de change)\b/i]
  },
  architects: {
    queryTerm: 'architect',
    strong: [/\barchitect(?:s|ure|ural)?\b/i],
    weak: [/\b(?:building design|design studio)\b/i]
  },
  builders: {
    queryTerm: 'building contractor',
    strong: [/\b(?:builder|builders|building contractor|construction|civil works?|general contractor|contractors?)\b/i],
    weak: [/\bengineering\b/i]
  },
  electricians: {
    queryTerm: 'electrician',
    includedType: 'electrician',
    strong: [/\b(?:electrician|electrical|wiring|electrical contractor)\w*\b/i],
    weak: [/\belectric\w*\b/i]
  },
  plumbers: {
    queryTerm: 'plumber',
    includedType: 'plumber',
    strong: [/\bplumb(?:er|ers|ing)\b/i, /\b(?:drainage|sanitary)\s+(?:services?|works?)\b/i],
    weak: [/\b(?:drainage|sanitary|pipework)\b/i]
  },
  painters: {
    queryTerm: 'painter',
    includedType: 'painter',
    strong: [/\b(?:painter|painters|painting|coating)\b/i],
    weak: [/\bdecorat(?:or|ors|ing)\b/i]
  },
  property_managers: {
    queryTerm: 'property management company',
    strong: [/\b(?:property|estate|facilit(?:y|ies))\s+management\b/i, /\bproperty managers?\b/i],
    weak: [/\bfacilit(?:y|ies)\s+services?\b/i]
  },
  insurance: {
    queryTerm: 'property insurance agency',
    includedType: 'insurance_agency',
    strong: [/\b(?:property|home|building|real estate)\s+insurance\b/i, /\b(?:insurance|insurer|assurance)\b/i],
    weak: [/\brisk management\b/i]
  },
  movers: {
    queryTerm: 'moving company',
    includedType: 'moving_company',
    strong: [/\b(?:movers?|moving company|moving|removals?|relocation)\b/i],
    weak: [/\btransport and storage\b/i]
  },
  interior_design: {
    queryTerm: 'interior design company',
    strong: [/\b(?:interior design|interiors?|home decor|office fit[- ]?out)\b/i],
    weak: [/\b(?:decor|furnishings?|fit[- ]?out)\b/i]
  },
  borehole_water: {
    queryTerm: 'borehole drilling company',
    strong: [/\b(?:borehole|water drilling|well drilling|water pump installation)\b/i],
    weak: [/\b(?:drilling|water systems?|pumps?)\b/i]
  },
  solar: {
    queryTerm: 'solar installation company',
    strong: [/\b(?:solar|photovoltaic|pv installation|renewable energy)\b/i],
    weak: [/\b(?:inverter|energy systems?)\b/i]
  },
  security: {
    queryTerm: 'private security company',
    strong: [/\b(?:private security|security (?:company|services?|systems?)|security guards?|cctv|guarding|surveillance|alarm systems?)\b/i],
    weak: [/\baccess control\b/i],
    reject: [/\b(?:police|prison|correctional|law enforcement)\b/i]
  },
  cleaning: {
    queryTerm: 'property cleaning company',
    strong: [/\b(?:cleaning (?:company|services?)|commercial cleaning|property cleaning|janitorial|cleaners?|fumigation)\b/i],
    weak: [/\bhousekeeping\b/i]
  },
  commercial_services: {
    queryTerm: 'commercial property services',
    strong: [/\b(?:commercial property|commercial real estate|office fit[- ]?out|industrial property|property services?)\b/i],
    weak: [/\b(?:facilities services?|office services?)\b/i]
  }
});

function clean(value = '') {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeGoogleTypes(input = {}) {
  const sourceTypes = input.google_types
    || input.googleTypes
    || input.types
    || input.source_metadata?.google_types
    || input.sourceMetadata?.google_types
    || [];
  return [...new Set((Array.isArray(sourceTypes) ? sourceTypes : []).map((value) => clean(value).toLowerCase()).filter(Boolean))];
}

function firstPatternMatch(patterns = [], text = '') {
  return patterns.find((pattern) => pattern.test(text)) || null;
}

function relevancePolicyForCategory(category = '') {
  return CATEGORY_RELEVANCE[clean(category).toLowerCase()] || null;
}

function googleSearchOptionsForCategory(category = '') {
  const policy = relevancePolicyForCategory(category);
  return {
    queryTerm: policy?.queryTerm || '',
    includedType: policy?.includedType || '',
    strictTypeFiltering: Boolean(policy?.includedType)
  };
}

function classifyMarketplaceRelevance(input = {}) {
  const category = clean(input.category).toLowerCase();
  const policy = relevancePolicyForCategory(category);
  const types = normalizeGoogleTypes(input);
  const text = [input.name, input.relevance_text, input.website]
    .map(clean)
    .filter(Boolean)
    .join(' ');
  if (!policy) {
    return { decision: 'reject', score: 0, reason: 'invalid_category', category, google_types: types };
  }
  const globalNameExclusion = GLOBAL_NAME_EXCLUSIONS.find((entry) => entry.pattern.test(text));
  if (globalNameExclusion) {
    return { decision: 'reject', score: 0, reason: `excluded_name:${globalNameExclusion.reason}`, category, google_types: types };
  }
  const categoryExclusion = firstPatternMatch(policy.reject, text);
  if (categoryExclusion) {
    return { decision: 'reject', score: 0, reason: 'category_sanity_failed', category, google_types: types };
  }
  const matchingType = policy.includedType && types.includes(policy.includedType) ? policy.includedType : '';
  const strongMatch = firstPatternMatch(policy.strong, text);
  const weakMatch = firstPatternMatch(policy.weak, text);
  const excludedType = types.find((type) => (
    GLOBAL_EXCLUDED_TYPES.has(type) && !CONTEXTUAL_EXCLUDED_TYPES.has(type)
  ));
  if (excludedType) {
    // Places can attach a stray unrelated type to an otherwise plausible
    // business. Conflicting signals are never public, but staff should review
    // them rather than losing a legitimate professional to a hard rejection.
    if (matchingType || strongMatch) {
      return {
        decision: 'pending_review',
        score: 30,
        reason: `conflicting_google_type:${excludedType}`,
        category,
        google_types: types
      };
    }
    return { decision: 'reject', score: 0, reason: `excluded_google_type:${excludedType}`, category, google_types: types };
  }
  if (matchingType || strongMatch) {
    return {
      decision: 'qualified',
      score: matchingType && strongMatch ? 100 : 80,
      reason: matchingType ? `matching_google_type:${matchingType}` : 'strong_category_keyword',
      category,
      google_types: types
    };
  }
  if (weakMatch) {
    return { decision: 'pending_review', score: 40, reason: 'weak_category_keyword', category, google_types: types };
  }
  return { decision: 'reject', score: 0, reason: 'no_category_evidence', category, google_types: types };
}

module.exports = {
  CATEGORY_RELEVANCE,
  CONTEXTUAL_EXCLUDED_TYPES,
  GLOBAL_EXCLUDED_TYPES,
  MARKETPLACE_RELEVANCE_MARKER,
  classifyMarketplaceRelevance,
  googleSearchOptionsForCategory,
  normalizeGoogleTypes,
  relevancePolicyForCategory
};
