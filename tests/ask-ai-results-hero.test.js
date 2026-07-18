const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const indexHtml = read('index.html');
const appJs = read('assets/makaug-app.js');
const aiRoute = read('routes/ai.js');
const aiService = read('services/aiService.js');

function includes(haystack, needle, message) {
  assert(haystack.includes(needle), message || `Expected to find ${needle}`);
}

function excludes(haystack, needle, message) {
  assert(!haystack.includes(needle), message || `Expected not to find ${needle}`);
}

includes(indexHtml, 'ask-ai-results-hero-20260717', 'release marker must be present in HTML');
includes(indexHtml, 'data-ask-ai-results-hero="1"', 'homepage Ask AI hero marker missing');
includes(indexHtml, 'id="home-ai-search-form"', 'homepage Ask AI form missing');
includes(indexHtml, 'id="home-ai-example-chips"', 'homepage localized example chips missing');
includes(indexHtml, 'id="home-ai-response"', 'homepage Ask AI response region missing');
includes(indexHtml, 'submitHomeAskAiPrompt(event)', 'homepage form must call Ask AI submit handler');

includes(aiRoute, 'extractNaturalPropertyQuery', 'assistant route must parse natural property queries');
includes(aiRoute, '/api/properties/search?', 'assistant route must call properties search');
includes(aiRoute, 'listings: result.listings', 'assistant route must return listings array');
includes(aiRoute, 'results: result.listings', 'assistant route must return results alias');
includes(aiRoute, 'total_matches: result.total', 'assistant route must return total_matches');
includes(aiRoute, 'see_all_url: seeAllUrl', 'assistant route must return see_all_url');
includes(aiRoute, 'sanitizeAssistantText', 'assistant route must sanitize old brand emoji from replies');

includes(appJs, 'AI_ASSISTANT_PROMPT_I18N', 'frontend must include language-aware Ask AI prompt copy');
includes(appJs, 'updateHomeAskAiLanguageCopy', 'frontend must update prompt/chips when language changes');
includes(appJs, 'renderAiAssistantResponse', 'frontend must render assistant responses');
includes(appJs, 'aiAssistantListingCardsHtml', 'frontend must render listing cards inline');
includes(appJs, 'propCard(property', 'frontend must reuse property card rendering');
includes(appJs, 'data-ai-assistant-inline-results="1"', 'frontend must mark inline AI results');
includes(appJs, 'window.submitHomeAskAiPrompt', 'homepage submit handler must be exposed');
includes(appJs, 'data?.listings', 'frontend must read listings from API response');
includes(appJs, 'total_matches', 'frontend must read total_matches from API response');

excludes(aiService, '🟨', 'AI service must not emit yellow square emoji');
excludes(aiService, '🟩', 'AI service must not emit green square emoji');
excludes(aiService, 'green/yellow brand cue', 'AI prompt must not instruct green/yellow emoji branding');

console.log('ask-ai-results-hero test passed');
