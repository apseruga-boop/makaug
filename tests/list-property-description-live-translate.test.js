const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const html = read('index.html');
const app = read('assets/makaug-app.js');
const aiRoute = read('routes/ai.js');
const aiService = read('services/aiService.js');
const server = read('server.js');

const marker = 'list-property-desc-live-translate-20260713';

assert(html.includes(marker), 'public HTML must carry the live description translation marker');
assert(server.includes('listPropertyDescLiveTranslateVersion'), 'server public app suffixes must carry the live description translation marker');

assert(html.includes('Choose a language to see an auto-translated preview before review.'), 'preview helper copy must describe live auto-translation');
assert(!html.includes('Preview falls back to the original until a reviewed translation exists.'), 'form preview must not say it waits for reviewed translations');
assert(!html.includes('Source: original description. Translation review pending.'), 'form preview source copy must not say review is pending before preview can change');

assert(aiRoute.includes("router.post('/translate-text'"), 'AI route must expose a free-text translation endpoint');
assert(aiRoute.includes('translateFreeText({'), 'AI route must call the free-text translation service');
assert(aiService.includes('async function translateFreeText'), 'AI service must implement free-text translation');
assert(aiService.includes('This is a private on-form auto-translated preview'), 'translation prompt must distinguish private preview from reviewed public copy');
assert(aiService.includes('Do not add facts, promises, legal claims, or marketing exaggeration.'), 'translation prompt must not rewrite or invent listing facts');
assert(/do not substitute Kinyarwanda/i.test(aiService), 'translation prompt must protect Rukiga/Runyankole from wrong nearby-language substitution');
assert(aiService.includes('free_text_translation'), 'free-text translations should be logged separately');

assert(app.includes('const lpDescriptionTranslationCache = new Map()'), 'frontend must cache repeated preview translations');
assert(app.includes('lpDescriptionTranslationRequestId'), 'frontend must guard stale translation responses');
assert(app.includes('setTimeout(async () =>'), 'frontend must debounce translation requests');
assert(app.includes('}, 500);'), 'frontend debounce should be around 500ms');
assert(app.includes('"/api/ai/translate-text"'), 'frontend preview must call the free-text translation endpoint');
assert(app.includes('skipAuth: true'), 'on-form preview translation must work before login');
assert(app.includes('fallback_used'), 'frontend must read backend fallback state');
assert(app.includes("Couldn't translate into"), 'frontend must show graceful error fallback copy');
assert(app.includes('Auto-translated preview in'), 'frontend must label machine-translated previews');
assert(!app.includes('original shown until AI/manual translation is reviewed'), 'frontend must not keep the inert reviewed-translation fallback message');

console.log('List-property live description translation preview tests passed');
