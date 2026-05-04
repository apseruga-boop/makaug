const {
  LANGUAGE_REGISTRY,
  languageDisplayName,
  shouldUseEnglishFallback,
  toCanonicalLanguageCode
} = require('../config/languageRegistry');

function translationProviderStatus() {
  const languages = Object.values(LANGUAGE_REGISTRY).map((language) => ({
    code: language.code,
    displayName: language.displayName,
    translationStatus: language.translationStatus,
    providerSupport: language.providerSupport,
    humanReviewRequired: language.humanReviewRequired
  }));
  return {
    supportedLanguages: languages.map((language) => language.code),
    defaultLanguage: 'en',
    fallbackMode: 'human_table_then_provider_then_english',
    humanTable: true,
    llmConfigured: Boolean(process.env.OPENAI_API_KEY || process.env.LLM_API_KEY || process.env.OLLAMA_BASE_URL),
    externalApiConfigured: Boolean(process.env.TRANSLATION_API_KEY || process.env.GOOGLE_TRANSLATE_API_KEY),
    legalReviewRequired: true,
    languages
  };
}

function resolveTranslationFallback(languageCode, key = '') {
  const canonical = toCanonicalLanguageCode(languageCode);
  const language = LANGUAGE_REGISTRY[canonical] || LANGUAGE_REGISTRY.en;
  if (language.translationStatus === 'complete') {
    return {
      languageCode: canonical,
      fallbackUsed: false,
      fallbackLanguage: canonical,
      fallbackReason: null,
      key
    };
  }
  if (shouldUseEnglishFallback(canonical) || language.humanReviewRequired) {
    return {
      languageCode: canonical,
      fallbackUsed: true,
      fallbackLanguage: 'en',
      fallbackReason: `${languageDisplayName(canonical)} translation is not fully reviewed; using English fallback instead of guessing another language.`,
      key
    };
  }
  return {
    languageCode: canonical,
    fallbackUsed: true,
    fallbackLanguage: language.fallbackLanguage || 'en',
    fallbackReason: 'translation_missing',
    key
  };
}

module.exports = {
  translationProviderStatus,
  resolveTranslationFallback
};
