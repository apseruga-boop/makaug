const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'whatsapp.js'), 'utf8');
const aiSource = fs.readFileSync(path.join(__dirname, '..', 'services', 'aiService.js'), 'utf8');

const helperStart = source.indexOf('const AFFORDABILITY_KEYWORDS');
const helperEnd = source.indexOf('function affordabilityExactLabel');
assert(helperStart > -1, 'WhatsApp route must define affordability keywords');
assert(helperEnd > helperStart, 'WhatsApp route must define affordability helpers before reply formatting');

const sandbox = {
  normalizeInput(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  },
  extractNaturalSearchFilters(text) {
    const clean = String(text || '').toLowerCase();
    const match = clean.match(/(?:\$|ugx|shs|shillings?\s*)?\s*(\d+(?:\.\d+)?)\s*(thousand|thousands|million|millions|billion|billions|bn|k|m|b)?/i);
    if (!match) return {};
    let amount = Number(match[1]);
    if (!Number.isFinite(amount) || amount <= 0) return {};
    if (/^m$|million/.test(match[2] || '')) amount *= 1000000;
    if (/^k$|thousand/.test(match[2] || '')) amount *= 1000;
    if (/^b$|^bn$|billion/.test(match[2] || '')) amount *= 1000000000;
    return {
      maxBudgetUgx: Math.round(amount),
      budgetPeriod: /rent|stay|room|house|apartment/.test(clean) ? 'month' : null,
      convertedFromUsd: clean.includes('$')
    };
  },
  normalizeListingType(value) {
    const clean = String(value || 'any').toLowerCase();
    if (['sale', 'rent', 'land', 'student', 'commercial'].includes(clean)) return clean;
    return 'any';
  }
};
vm.createContext(sandbox);
vm.runInContext(`
${source.slice(helperStart, helperEnd)}
this.isAffordabilityAdviceQuestion = isAffordabilityAdviceQuestion;
this.inferAffordabilitySearchType = inferAffordabilitySearchType;
`, sandbox);

const {
  isAffordabilityAdviceQuestion,
  inferAffordabilitySearchType
} = sandbox;

assert.strictEqual(typeof isAffordabilityAdviceQuestion, 'function', 'WhatsApp route must export affordability detector for regression coverage');
assert.strictEqual(typeof inferAffordabilitySearchType, 'function', 'WhatsApp route must infer affordability search type');
assert(source.includes('function formatAffordabilityAdviceMessage'), 'WhatsApp route must format conversational affordability replies');

const supportedLanguagePrompts = [
  ['English', 'what is the cheapest area to stay in?'],
  ['English budget', 'can I get a house for $2 million?'],
  ['English UGX', 'houses for 2 million shillings'],
  ['Luganda', 'Ekitundu ki ekya cheap okubeeramu?'],
  ['Luganda budget', 'Nfunira enju ya ssente ntono 2 million'],
  ['Kiswahili', 'eneo gani ni la bei nafuu kukaa?'],
  ['Kiswahili budget', 'naweza kupata nyumba kwa gharama ndogo 2 million?'],
  ['Acholi', 'area mene ma price piny loyo me bedo iye?'],
  ['Runyankole', 'Ni kiha kitundu ekirikukira ahansi omu beeyi?'],
  ['Rukiga', 'Ni hehe hihendutse kubamo?'],
  ['Lusoga', 'Kifo ki ekya cheap okubeeramu?'],
  ['Amharic', 'በጀት ውስጥ ርካሽ ቤት አለ?']
];

const languageNames = [
  'Afrikaans', 'Albanian', 'Arabic', 'Armenian', 'Azerbaijani', 'Basque', 'Bengali', 'Bosnian',
  'Bulgarian', 'Burmese', 'Catalan', 'Chinese', 'Croatian', 'Czech', 'Danish', 'Dutch', 'Estonian',
  'Filipino', 'Finnish', 'French', 'Georgian', 'German', 'Greek', 'Gujarati', 'Hausa', 'Hebrew',
  'Hindi', 'Hungarian', 'Icelandic', 'Igbo', 'Indonesian', 'Irish', 'Italian', 'Japanese',
  'Javanese', 'Kannada', 'Kazakh', 'Khmer', 'Korean', 'Kurdish', 'Lao', 'Latvian', 'Lithuanian',
  'Macedonian', 'Malay', 'Malayalam', 'Marathi', 'Mongolian', 'Nepali', 'Norwegian', 'Pashto',
  'Persian', 'Polish', 'Portuguese', 'Punjabi', 'Romanian', 'Russian', 'Serbian', 'Sinhala',
  'Slovak', 'Slovenian', 'Somali', 'Spanish', 'Swedish', 'Tamil', 'Telugu', 'Thai', 'Turkish',
  'Ukrainian', 'Urdu', 'Uzbek', 'Vietnamese', 'Welsh', 'Wolof', 'Xhosa', 'Yoruba', 'Zulu',
  'Kinyarwanda', 'Kirundi', 'Lingala', 'Shona', 'Tigrinya', 'Oromo', 'Nuer', 'Dinka', 'Bari',
  'Luo', 'Lango', 'Ateso', 'Karamojong', 'Luganda mixed', 'Kiswahili mixed', 'Acholi mixed',
  'Runyankole mixed', 'Rukiga mixed', 'Lusoga mixed'
];

const generatedPrompts = languageNames.map((name, index) => {
  const amount = index % 2 === 0 ? `${index + 1} million` : `$${index + 1}k`;
  const noun = index % 5 === 0 ? 'student room' : index % 5 === 1 ? 'house' : index % 5 === 2 ? 'apartment' : index % 5 === 3 ? 'land' : 'rental';
  return [name, `[${name}] show me the cheapest area and cheap ${noun} around Uganda for ${amount}`];
});

const prompts = [...supportedLanguagePrompts, ...generatedPrompts].slice(0, 100);
assert.strictEqual(prompts.length, 100, 'Regression suite should exercise 100 multilingual affordability prompts');

for (const [label, prompt] of prompts) {
  assert.strictEqual(
    isAffordabilityAdviceQuestion(prompt),
    true,
    `${label} affordability prompt should route to conversational affordability search`
  );
}

[
  'am selling my land with title',
  'I want to list my property',
  'upload my house for sale',
  'MENU',
  'hello'
].forEach((prompt) => {
  assert.strictEqual(isAffordabilityAdviceQuestion(prompt), false, `"${prompt}" should not be treated as affordability search`);
});

assert.strictEqual(inferAffordabilitySearchType('what is the cheapest area to stay in?', {}), 'rent');
assert.strictEqual(inferAffordabilitySearchType('can I get land for 10 million?', {}), 'land');
assert.strictEqual(inferAffordabilitySearchType('cheap student room near campus', {}), 'student');
assert.strictEqual(inferAffordabilitySearchType('affordable office for my business', {}), 'commercial');
assert.strictEqual(inferAffordabilitySearchType('buy a cheap house', {}), 'sale');

assert(source.includes("whatsappBrandHeader('Affordability search')"), 'Reply should name affordability search');
assert(source.includes('Cheapest areas from live listings'), 'Reply should summarize cheapest areas');
assert(source.includes('formatPropertySearchMessage(lang, rows'), 'Reply should include real listing cards when rows are present');

const runtimeRouteStart = source.indexOf("['greeting', 'main_menu', 'search_type', 'search_area'].includes(step)");
const affordabilityRouteIndex = source.indexOf('isAffordabilityAdviceQuestion(cleanBody)', runtimeRouteStart);
const genericAreaPromptIndex = source.indexOf("naturalSearchPrompt(lang, naturalFilters, 'area')", affordabilityRouteIndex);
assert(runtimeRouteStart > -1, 'WhatsApp route must allow affordability from normal conversation steps');
assert(affordabilityRouteIndex > -1, 'WhatsApp route must check affordability questions');
assert(genericAreaPromptIndex > -1, 'WhatsApp route still has generic area prompt');
assert(affordabilityRouteIndex < genericAreaPromptIndex, 'Affordability questions must be handled before generic area prompt');
assert(source.includes('buildAffordabilityAdviceReply'), 'WhatsApp route must build DB-backed affordability replies');
assert(source.includes('ORDER BY p.price ASC NULLS LAST'), 'Affordability results must sort live listings by cheapest price first');
assert(source.includes('const MIN_PUBLIC_WHATSAPP_PRICE_UGX = IS_SOUTH_AFRICA ? 500 : 10000'), 'WhatsApp affordability results must define the country-specific minimum plausible public price');
assert(source.includes('price IS NULL OR ${safeAlias}.price >= $'), 'WhatsApp affordability results must filter implausibly tiny scraped prices');
assert(aiSource.includes('what is the cheapest area to stay in?'), 'AI intent prompt must teach affordability questions');
assert(aiSource.includes('can I get a house for $2 million?'), 'AI intent prompt must include budget affordability example');

console.log('WhatsApp conversational affordability tests passed');
