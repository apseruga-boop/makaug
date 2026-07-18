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
includes(indexHtml, 'ask-ai-no-intent-routing-20260718', 'Ask AI no-intent routing marker must be present in HTML');
includes(indexHtml, 'ask-ai-fast-mobile-20260718', 'Ask AI fast/mobile marker must be present in HTML');
includes(indexHtml, 'ask-ai-similar-closeout-20260718', 'Ask AI/similar closeout marker must be present in HTML');
includes(indexHtml, 'ask-ai-card-sql-fast-20260718', 'Ask AI card SQL fast-path marker must be present in HTML');
includes(indexHtml, 'ask-ai-placeholder-i18n-live-20260718', 'Ask AI visible placeholder/i18n marker must be present in HTML');
includes(indexHtml, 'ask-ai-search-prewarm-20260718', 'Ask AI search prewarm marker must be present in HTML');
includes(indexHtml, 'ask-ai-prewarm-broad-20260718', 'Ask AI broad prewarm marker must be present in HTML');
includes(indexHtml, 'data-ask-ai-results-hero="1"', 'homepage Ask AI hero marker missing');
includes(indexHtml, 'data-ask-ai-blue-categoryrouting="1"', 'Ask AI blue/category-routing UI marker missing');
includes(indexHtml, 'data-ask-ai-fast-mobile="1"', 'Ask AI fast/mobile UI marker missing');
includes(indexHtml, 'data-ask-ai-similar-closeout="1"', 'Ask AI closeout UI marker missing');
includes(indexHtml, 'data-ask-ai-placeholder-i18n-live="1"', 'Ask AI visible placeholder UI marker missing');
includes(indexHtml, 'id="home-ai-search-form"', 'homepage Ask AI form missing');
includes(indexHtml, 'id="home-ai-example-chips"', 'homepage localized example chips missing');
includes(indexHtml, 'id="home-ai-response"', 'homepage Ask AI response region missing');
includes(indexHtml, 'id="home-ai-placeholder-rotator"', 'homepage Ask AI must render a visible rotating placeholder overlay');
includes(indexHtml, 'id="ai-chatbot-placeholder-rotator"', 'test Ask AI panel must render a visible rotating placeholder overlay');
includes(indexHtml, 'submitHomeAskAiPrompt(event)', 'homepage form must call Ask AI submit handler');
includes(indexHtml, 'text-[clamp(16px,3.8vw,21px)] font-semibold', 'Ask AI heading must use compact mobile-first type');
includes(indexHtml, 'text-[#0b1220]', 'Ask AI heading and shell should use the darker true-black text tone');
includes(indexHtml, '✨ Ask AI', 'Ask AI button must include the AI star');
includes(indexHtml, 'pl-10 pr-4 text-sm', 'Ask AI input must reserve room for star and avoid mobile overflow');
includes(indexHtml, 'placeholder:text-transparent', 'Ask AI native placeholder should be hidden behind the animated overlay');
includes(indexHtml, 'transition-opacity', 'Ask AI placeholder overlay must visibly fade between localized examples');

includes(aiRoute, 'extractNaturalPropertyQuery', 'assistant route must parse natural property queries');
includes(aiRoute, 'heuristicNaturalPropertyQuery', 'assistant route must expose the deterministic fast parser');
includes(aiRoute, 'model: \'heuristic-fast\'', 'assistant search route must support non-LLM fast parsing');
includes(aiRoute, 'if (!assistantIsSearch)', 'assistant route must keep LLM chat off the search critical path');
includes(aiRoute, '/api/properties/search?', 'assistant route must call properties search');
includes(aiRoute, "include_summary: '0'", 'assistant search must request a lightweight card payload');
includes(aiRoute, "card_fields: '1'", 'assistant search must request card-only public fields');
includes(aiRoute, 'ASSISTANT_SEARCH_RESULT_CACHE_TTL_MS', 'assistant route must cache repeated common search results briefly');
includes(aiRoute, "ASSISTANT_SEARCH_PREWARM_MARKER = 'ask-ai-search-prewarm-20260718'", 'assistant route must carry the search prewarm marker');
includes(aiRoute, "ASSISTANT_SEARCH_PREWARM_BROAD_MARKER = 'ask-ai-prewarm-broad-20260718'", 'assistant route must carry the broad search prewarm marker');
includes(aiRoute, 'ASSISTANT_SEARCH_PREWARM_BROAD_AREAS', 'assistant route must define high-volume broad areas to prewarm');
includes(aiRoute, 'ASSISTANT_SEARCH_PREWARM_BROAD_QUERIES', 'assistant route must generate high-volume area/category prewarm queries');
includes(aiRoute, "'Kira'", 'assistant broad prewarm set must include Kira');
includes(aiRoute, "{ searchType: 'sale', parsed: { area } }", 'assistant broad prewarm set must include sale area cache keys');
includes(aiRoute, "{ searchType: 'commercial', parsed: { area } }", 'assistant broad prewarm set must include commercial area cache keys');
includes(aiRoute, 'subtype URL filters are the expensive search path', 'assistant prewarm must avoid hammering slow subtype filter URLs');
includes(aiRoute, 'ASSISTANT_SEARCH_RESULT_CACHE_MAX_ENTRIES', 'assistant cache must have room for broad prewarm entries');
includes(aiRoute, 'ASSISTANT_SEARCH_PREWARM_REFRESH_MS', 'assistant prewarm must refresh cache entries before TTL expiry');
includes(aiRoute, 'ASSISTANT_SEARCH_PREWARM_DELAY_MS', 'assistant prewarm must pace broad refreshes to avoid user-facing contention');
includes(aiRoute, 'assistantSearchCacheKeyForUrl', 'assistant search cache must normalize keys across internal and public origins');
includes(aiRoute, "`${parsed.pathname}?${parsed.searchParams.toString()}`", 'assistant search cache key must ignore origin so prewarm and live requests share entries');
includes(aiRoute, 'getAssistantSearchResultCacheAgeMs', 'assistant prewarm must inspect cache age before deciding to skip');
includes(aiRoute, 'forceRefresh: true', 'assistant prewarm must refresh stale broad cache entries instead of waiting for expiry');
includes(aiRoute, 'search_prewarm_broad_marker: ASSISTANT_SEARCH_PREWARM_BROAD_MARKER', 'assistant responses must expose the broad prewarm marker for live verification');
includes(aiRoute, 'ASSISTANT_SEARCH_PREWARM_QUERIES', 'assistant route must define common broad searches to prewarm');
includes(aiRoute, 'prewarmAssistantSearchCacheOnce', 'assistant route must prewarm common search result cards');
includes(aiRoute, 'startAssistantSearchPrewarmLoop', 'assistant route must start a bounded prewarm loop');
includes(aiRoute, 'ASSISTANT_SEARCH_PREWARM_ENABLED', 'assistant search prewarm must be env-toggleable');
includes(aiRoute, 'ASSISTANT_SEARCH_CACHE_TTL_MS', 'assistant cache TTL must be configurable for short freshness windows');
includes(aiRoute, 'search_prewarm_marker: ASSISTANT_SEARCH_PREWARM_MARKER', 'assistant responses must expose the prewarm marker for live verification');
includes(aiRoute, 'ASSISTANT_SEARCH_TIMEOUT_MS', 'assistant search timeout must be configurable');
includes(aiRoute, 'hasRelaxablePropertyType', 'assistant route should detect scarce subtype filters');
includes(aiRoute, "relaxedFilters = ['property_type']", 'assistant route should relax scarce subtype filters before the first search');
includes(aiRoute, 'assistantSearchOriginFromRequest', 'assistant search should use an internal origin where available');
includes(aiRoute, 'ASSISTANT_SEARCH_BASE_URL', 'assistant search should allow an internal search base URL override');
includes(aiRoute, 'listings: result.listings', 'assistant route must return listings array');
includes(aiRoute, 'results: result.listings', 'assistant route must return results alias');
includes(aiRoute, 'total_matches: result.total', 'assistant route must return total_matches');
includes(aiRoute, 'see_all_url: seeAllUrl', 'assistant route must return see_all_url');
includes(aiRoute, 'sanitizeAssistantText', 'assistant route must sanitize old brand emoji from replies');
includes(aiRoute, "router.post('/property-need'", 'assistant route must expose zero-result property-need capture');
includes(aiRoute, 'inferAssistantSearchType', 'assistant route must infer category from user text');
includes(aiRoute, 'inferAssistantIntentFromMessage', 'assistant route must infer search intent when the client sends no intent');
includes(aiRoute, 'const effectiveIntent = inferAssistantIntentFromMessage(userMessage, requestedIntent);', 'assistant route must derive effective intent from the user message');
includes(aiRoute, 'isAssistantSearchIntent(effectiveIntent)', 'assistant search branch must use the inferred effective intent');
includes(aiRoute, 'tracePromise.catch(logAssistantTraceFailure)', 'search replies must not wait on analytics trace writes before responding');
includes(aiRoute, 'rent(?:al|als|ing)?', 'assistant route must treat plural rentals as a property search signal');
includes(aiRoute, "property_search: 'search_property'", 'assistant intent aliases must include property_search');
includes(aiRoute, "search_near_me: 'search_property'", 'assistant intent aliases must include search_near_me');
includes(aiRoute, "params.set('student_portal', '1')", 'student searches must route to the student portal query');
includes(aiRoute, "params.set('commercial_type', propertyType)", 'commercial subtype should be passed through for office/shop/warehouse');
includes(aiRoute, "match_quality: 'needs_input'", 'greetings/no-signal prompts must not dump the catalogue');
includes(aiRoute, "matchQuality = 'nearby_not_exact'", 'relaxed or nearby results must be labelled');
includes(aiRoute, 'capture_available', 'zero/relaxed search responses must advertise capture availability');

includes(appJs, 'AI_ASSISTANT_PROMPT_I18N', 'frontend must include language-aware Ask AI prompt copy');
includes(appJs, 'aiAssistantStarLabel', 'frontend must keep AI star through language refreshes');
includes(appJs, 'updateHomeAskAiLanguageCopy', 'frontend must update prompt/chips when language changes');
includes(appJs, 'startAiAssistantPlaceholderRotation', 'frontend must rotate localized Ask AI placeholder examples');
includes(appJs, 'aiAssistantPlaceholderTargets', 'frontend must target both Ask AI inputs for visible placeholder rotation');
includes(appJs, 'setAiAssistantPlaceholderOverlay', 'frontend must animate the visible placeholder overlay');
includes(appJs, 'dataset.aiPlaceholderWired', 'frontend must wire placeholder overlay sync only once per input');
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
includes(aiService, 'rentals?', 'natural query parser must classify plural rentals as rent searches');

const propertyRoute = read('routes/properties.js');
includes(propertyRoute, 'cardFieldsOnly', 'properties route must parse the card_fields fast-path flag');
includes(propertyRoute, 'compactPublicCardRow', 'properties route must expose a compact public card mapper');
includes(propertyRoute, 'if (cardFieldsOnly && !adminAccess)', 'card_fields fast path must be public-only and avoid admin payloads');
includes(propertyRoute, 'addPublicCardLocationSearchFilter(filters, values, area)', 'card_fields AI searches must use the narrow exact-location filter');
includes(propertyRoute, "p.extra_fields->>'resolved_location_label' = ?", 'card_fields location filter should include resolved labels without scanning long text columns');

console.log('ask-ai-results-hero test passed');
