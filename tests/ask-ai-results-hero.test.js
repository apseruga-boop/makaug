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

includes(indexHtml, 'ask-ai-results-hero-20260717', 'original Ask AI results release marker must be present in HTML');
includes(indexHtml, 'ask-ai-blue-categoryrouting-20260718', 'Ask AI blue/category-routing marker must be present in HTML');
includes(indexHtml, 'data-ask-ai-results-hero="1"', 'homepage Ask AI hero marker missing');
includes(indexHtml, 'data-ask-ai-blue-categoryrouting="1"', 'Ask AI blue/category-routing UI marker missing');
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
includes(aiRoute, "router.post('/property-need'", 'assistant route must expose zero-result property-need capture');
includes(aiRoute, 'inferAssistantSearchType', 'assistant route must infer category from user text');
includes(aiRoute, "params.set('student_portal', '1')", 'student searches must route to the student portal query');
includes(aiRoute, "params.set('commercial_type', propertyType)", 'commercial subtype should be passed through for office/shop/warehouse');
includes(aiRoute, "match_quality: 'needs_input'", 'greetings/no-signal prompts must not dump the catalogue');
includes(aiRoute, "matchQuality = 'nearby_not_exact'", 'relaxed or nearby results must be labelled');
includes(aiRoute, 'capture_available', 'zero/relaxed search responses must advertise capture availability');

includes(appJs, 'AI_ASSISTANT_PROMPT_I18N', 'frontend must include language-aware Ask AI prompt copy');
includes(appJs, 'updateHomeAskAiLanguageCopy', 'frontend must update prompt/chips when language changes');
includes(appJs, 'startAiAssistantPlaceholderRotation', 'frontend must rotate localized Ask AI placeholder examples');
includes(appJs, 'renderAiAssistantResponse', 'frontend must render assistant responses');
includes(appJs, 'aiAssistantListingCardsHtml', 'frontend must render listing cards inline');
includes(appJs, 'aiAssistantNeedCaptureHtml', 'frontend must render zero-result capture UI');
includes(appJs, 'submitAiAssistantNeedCapture', 'frontend must submit zero-result capture lead');
includes(appJs, '"/api/ai/property-need"', 'frontend must call the property-need capture endpoint');
includes(appJs, 'propCard(property', 'frontend must reuse property card rendering');
includes(appJs, 'data-ai-assistant-inline-results="1"', 'frontend must mark inline AI results');
includes(appJs, 'window.submitHomeAskAiPrompt', 'homepage submit handler must be exposed');
includes(appJs, 'data?.listings', 'frontend must read listings from API response');
includes(appJs, 'total_matches', 'frontend must read total_matches from API response');
includes(appJs, 'nearbyNote', 'frontend must include relaxed-match copy');
includes(appJs, 'captureCta', 'frontend must include capture CTA copy');

excludes(aiService, '🟨', 'AI service must not emit yellow square emoji');
excludes(aiService, '🟩', 'AI service must not emit green square emoji');
excludes(aiService, 'green/yellow brand cue', 'AI prompt must not instruct green/yellow emoji branding');

console.log('ask-ai-results-hero test passed');
