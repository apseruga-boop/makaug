const LANGUAGE_REGISTRY = {
  en: {
    code: 'en',
    legacyCode: 'en',
    displayName: 'English',
    nativeName: 'English',
    aliases: ['1', 'en', 'eng', 'english'],
    direction: 'ltr',
    supportedInWeb: true,
    supportedInWhatsApp: true,
    supportedInAI: true,
    fallbackLanguage: 'en',
    translationStatus: 'complete',
    providerSupport: { humanTable: true, llm: true, externalApi: false },
    humanReviewRequired: false
  },
  lg: {
    code: 'lg',
    legacyCode: 'lg',
    displayName: 'Luganda',
    nativeName: 'Luganda',
    aliases: ['2', 'lg', 'luganda', 'ganda'],
    direction: 'ltr',
    supportedInWeb: true,
    supportedInWhatsApp: true,
    supportedInAI: true,
    fallbackLanguage: 'en',
    translationStatus: 'partial',
    providerSupport: { humanTable: true, llm: true, externalApi: false },
    humanReviewRequired: true
  },
  sw: {
    code: 'sw',
    legacyCode: 'sw',
    displayName: 'Kiswahili',
    nativeName: 'Kiswahili',
    aliases: ['3', 'sw', 'swa', 'kiswahili', 'swahili'],
    direction: 'ltr',
    supportedInWeb: true,
    supportedInWhatsApp: true,
    supportedInAI: true,
    fallbackLanguage: 'en',
    translationStatus: 'partial',
    providerSupport: { humanTable: true, llm: true, externalApi: false },
    humanReviewRequired: true
  },
  ach: {
    code: 'ach',
    legacyCode: 'ac',
    displayName: 'Acholi',
    nativeName: 'Acholi',
    aliases: ['4', 'ach', 'ac', 'acholi'],
    direction: 'ltr',
    supportedInWeb: true,
    supportedInWhatsApp: true,
    supportedInAI: true,
    fallbackLanguage: 'en',
    translationStatus: 'partial',
    providerSupport: { humanTable: false, llm: true, externalApi: false },
    humanReviewRequired: true
  },
  rnynk: {
    code: 'rnynk',
    legacyCode: 'ny',
    displayName: 'Runyankole',
    nativeName: 'Runyankore / Runyankole',
    aliases: ['5', 'rnynk', 'ny', 'nyn', 'runyankole', 'runyankore', 'runyankole-rukiga'],
    direction: 'ltr',
    supportedInWeb: true,
    supportedInWhatsApp: true,
    supportedInAI: true,
    fallbackLanguage: 'en',
    translationStatus: 'partial',
    providerSupport: { humanTable: false, llm: true, externalApi: false },
    humanReviewRequired: true
  },
  rkg: {
    code: 'rkg',
    legacyCode: 'rn',
    displayName: 'Rukiga',
    nativeName: 'Rukiga',
    aliases: ['6', 'rkg', 'rn', 'rukiga', 'kiga'],
    direction: 'ltr',
    supportedInWeb: true,
    supportedInWhatsApp: true,
    supportedInAI: true,
    fallbackLanguage: 'en',
    translationStatus: 'english_fallback_until_reviewed',
    providerSupport: { humanTable: false, llm: false, externalApi: false },
    humanReviewRequired: true
  },
  lus: {
    code: 'lus',
    legacyCode: 'sm',
    displayName: 'Lusoga',
    nativeName: 'Lusoga',
    aliases: ['7', 'lus', 'sm', 'xog', 'lusoga', 'soga'],
    direction: 'ltr',
    supportedInWeb: true,
    supportedInWhatsApp: true,
    supportedInAI: true,
    fallbackLanguage: 'en',
    translationStatus: 'partial',
    providerSupport: { humanTable: false, llm: true, externalApi: false },
    humanReviewRequired: true
  }
};

const LEGACY_TO_CANONICAL = Object.values(LANGUAGE_REGISTRY).reduce((acc, language) => {
  acc[language.legacyCode] = language.code;
  return acc;
}, {});

const ALIAS_TO_CANONICAL = Object.values(LANGUAGE_REGISTRY).reduce((acc, language) => {
  language.aliases.forEach((alias) => {
    acc[String(alias).toLowerCase()] = language.code;
  });
  acc[language.code] = language.code;
  acc[language.legacyCode] = language.code;
  return acc;
}, {});

function toCanonicalLanguageCode(value = '') {
  const raw = String(value || '').trim().toLowerCase().replace(/_/g, '-');
  if (!raw) return 'en';
  if (LANGUAGE_REGISTRY[raw]) return raw;
  if (LEGACY_TO_CANONICAL[raw]) return LEGACY_TO_CANONICAL[raw];
  if (ALIAS_TO_CANONICAL[raw]) return ALIAS_TO_CANONICAL[raw];
  const base = raw.split('-')[0];
  return ALIAS_TO_CANONICAL[base] || 'en';
}

function toLegacyLanguageCode(value = '') {
  const canonical = toCanonicalLanguageCode(value);
  return LANGUAGE_REGISTRY[canonical]?.legacyCode || 'en';
}

function normalizeLanguageCode(value = '', { legacy = true } = {}) {
  return legacy ? toLegacyLanguageCode(value) : toCanonicalLanguageCode(value);
}

function languageDisplayName(value = '') {
  const canonical = toCanonicalLanguageCode(value);
  return LANGUAGE_REGISTRY[canonical]?.displayName || LANGUAGE_REGISTRY.en.displayName;
}

function shouldUseEnglishFallback(value = '') {
  const canonical = toCanonicalLanguageCode(value);
  const language = LANGUAGE_REGISTRY[canonical] || LANGUAGE_REGISTRY.en;
  return language.fallbackLanguage === 'en' && language.translationStatus !== 'complete' && canonical === 'rkg';
}

function languageGuardrail(value = '') {
  const name = languageDisplayName(value);
  const canonical = toCanonicalLanguageCode(value);
  const fallback = shouldUseEnglishFallback(value)
    ? `If you cannot confidently write ${name}, use English and say ${name} translation is not fully available yet.`
    : `If you cannot confidently write ${name}, use English fallback instead of guessing.`;
  const nearby = canonical === 'rkg' || canonical === 'rnynk'
    ? 'Do not use Kinyarwanda for Rukiga or Runyankole. They must not be treated as Kinyarwanda.'
    : 'Do not substitute a different nearby language.';
  return `Respond only in ${name}. ${nearby} ${fallback}`;
}

const SUPPORTED_AI_LANGUAGES = Object.values(LANGUAGE_REGISTRY).reduce((acc, language) => {
  acc[language.legacyCode] = language.displayName;
  return acc;
}, {});

module.exports = {
  LANGUAGE_REGISTRY,
  LEGACY_TO_CANONICAL,
  ALIAS_TO_CANONICAL,
  SUPPORTED_AI_LANGUAGES,
  normalizeLanguageCode,
  toCanonicalLanguageCode,
  toLegacyLanguageCode,
  languageDisplayName,
  languageGuardrail,
  shouldUseEnglishFallback
};
