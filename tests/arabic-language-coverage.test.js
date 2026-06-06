'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const {
  LANGUAGE_REGISTRY,
  SUPPORTED_AI_LANGUAGES,
  languageDisplayName,
  toLegacyLanguageCode
} = require('../config/languageRegistry');

const indexHtml = read('index.html');
const appSource = read('assets/makaug-app.js');
const whatsappRoutes = read('routes/whatsapp.js');
const aiService = read('services/aiService.js');
const languageService = read('src/services/languageService.ts');
const domainTypes = read('src/types/domain.ts');
const constants = read('src/utils/constants.ts');
const outreachTemplate = read('services/outreachTemplateService.js');
const welcomeHtml = read('assets/marketing/makaug-agent-welcome.html');
const welcomeCard = read('assets/marketing/makaug-agent-welcome-card.svg');

assert.strictEqual(Object.keys(LANGUAGE_REGISTRY).length, 9, 'registry should expose nine languages after Arabic rollout');
assert.strictEqual(LANGUAGE_REGISTRY.ar.displayName, 'Arabic', 'registry should define Arabic');
assert.strictEqual(LANGUAGE_REGISTRY.ar.nativeName, 'العربية', 'registry should keep Arabic native label');
assert.strictEqual(LANGUAGE_REGISTRY.ar.direction, 'rtl', 'registry should mark Arabic as RTL');
assert.strictEqual(toLegacyLanguageCode('9'), 'ar', 'WhatsApp option 9 should resolve to Arabic');
assert.strictEqual(toLegacyLanguageCode('arabic'), 'ar', 'Arabic alias should resolve');
assert.strictEqual(toLegacyLanguageCode('العربية'), 'ar', 'Arabic native alias should resolve');
assert.strictEqual(languageDisplayName('ar'), 'Arabic', 'Arabic display name should be available');
assert.strictEqual(SUPPORTED_AI_LANGUAGES.ar, 'Arabic', 'AI supported languages should include Arabic');

assert(domainTypes.includes("'ar'"), 'bot domain type should include Arabic language code');
assert(constants.includes("{ code: 'ar', label: 'Arabic' }"), 'bot supported language list should include Arabic');
assert(languageService.includes("9. Arabic"), 'bot language menu should show Arabic as option 9');
assert(languageService.includes("'9': 'ar'"), 'bot language parser should map option 9 to Arabic');
assert(languageService.includes('Preserve right-to-left Arabic readability'), 'bot translation prompt should preserve RTL readability');

assert(indexHtml.includes('value="ar">Arabic</option>'), 'public HTML language selectors should include Arabic');
assert(indexHtml.includes('Use makaug in 9 languages'), 'public language spotlight should show nine languages');
assert(indexHtml.includes('arabic-i18n-20260606'), 'public bundle cache marker should include Arabic rollout');
assert(appSource.includes('I18N_UI.ar'), 'frontend global UI pack should include Arabic');
assert(appSource.includes('CONTENT_I18N.ar'), 'content page pack should include Arabic');
assert(appSource.includes('HOME_ASSISTANT_I18N') && appSource.includes('مساعد إدراج AI'), 'homepage AI assistant should include Arabic copy');
assert(appSource.includes('FOOTER_I18N') && appSource.includes('بيوت للبيع'), 'footer should include Arabic copy');
assert(appSource.includes('MORTGAGE_I18N.ar'), 'mortgage UI pack should include Arabic');
assert(appSource.includes('AI_CHATBOT_I18N.ar'), 'AI chatbot page pack should include Arabic');
assert(appSource.includes('LISTING_LABEL_I18N_SUPPLEMENTAL.ar'), 'listing label layer should include Arabic');
assert(appSource.includes('PROPERTY_UI_I18N.ar'), 'property detail UI layer should include Arabic');
assert(appSource.includes('document.documentElement.dir = currentLang === "ar" ? "rtl" : "ltr"'), 'frontend should switch document direction for Arabic');
assert(appSource.includes('"Arabic", "Other"'), 'account screening language choices should include Arabic');

assert(whatsappRoutes.includes('9. Arabic / العربية'), 'WhatsApp language menu should show Arabic as option 9');
assert(whatsappRoutes.includes("'9': 'ar'"), 'WhatsApp language handler should map option 9 to Arabic');
assert(whatsappRoutes.includes('T.ar = Object.assign'), 'WhatsApp copy pack should include Arabic');
assert(whatsappRoutes.includes("ar: {") && whatsappRoutes.includes("filter: 'تصفية'"), 'WhatsApp result cards should include Arabic labels');
assert(whatsappRoutes.includes('يمكنك الكتابة'), 'WhatsApp language comfort line should include Arabic');
assert(whatsappRoutes.includes('/^[1-9]$/'), 'WhatsApp language replies should accept option 9');

assert(aiService.includes('en|lg|sw|ac|ny|rn|sm|am|ar'), 'AI language schemas should include Arabic');
assert(aiService.includes('English/Luganda/Kiswahili/Amharic/Arabic'), 'AI explicit language prompt should include Arabic');
assert(aiService.includes('{"ar": {"title":"string","description":"string","area_highlights":"string"}}') || aiService.includes('"ar": {"title":"string","description":"string","area_highlights":"string"}'), 'AI listing translation schema should include Arabic');
assert(aiService.includes('ar: [') && aiService.includes('مساعدة العقارات'), 'AI fallback copy should handle Arabic');

assert(outreachTemplate.includes('Amharic, or Arabic'), 'outreach WhatsApp template should advertise Arabic');
assert(welcomeHtml.includes('value="ar">Arabic</option>'), 'agent welcome page should include Arabic selector option');
assert(welcomeHtml.includes('ar: {'), 'agent welcome page should include Arabic translation copy');
assert(welcomeHtml.includes("document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'"), 'agent welcome page should switch to RTL for Arabic');
assert(welcomeHtml.includes('nine makaug.com languages'), 'agent welcome page should show nine-language copy');
assert(welcomeCard.includes('9 languages'), 'agent welcome card should show nine-language callout');
assert(welcomeCard.includes('Nine language flows'), 'agent welcome card should show nine-language flow copy');

console.log('Arabic language coverage tests passed');
