'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'assets/makaug-app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const aiService = fs.readFileSync(path.join(root, 'services/aiService.js'), 'utf8');
const aiRoute = fs.readFileSync(path.join(root, 'routes/ai.js'), 'utf8');

assert(app.includes('const MAKAUG_WHATSAPP_AI_WEB_FALLBACK = true;'), 'temporary web fallback must be enabled while WhatsApp device linking is blocked');
assert(app.includes('return MAKAUG_WEB_AI_FALLBACK_URL;'), 'MakaUG support links must open the website AI instead of the unavailable phone link');
assert(app.includes('return `/list-property?mode=online&type=${encodeURIComponent(getListChoiceType())}`;'), 'listing entry points must open the online form with their selected type');
assert(app.includes('logListPropertyIntent("online_fallback"'), 'temporary listing redirects must remain measurable');
assert(app.includes('chooseListPropertyOnline({ source: options.source || "whatsapp_cooldown_fallback" })'), 'mobile and modal WhatsApp choices must fall back to the online form without leaving the site');
assert(app.includes('function installTemporaryWebSupportFallback()'), 'late-rendered MakaUG support links must have a click-time website fallback');
assert(app.includes('a[href^="https://wa.me/256760112587"]'), 'the click-time fallback must cover the exact MakaUG support number');
assert(app.includes('event.stopImmediatePropagation();'), 'the fallback must stop stale inline WhatsApp handlers before they can open the phone link');
assert(app.includes('Your submission will remain in staff review until approved.'), 'fallback copy must preserve the staff-review publication boundary');
assert(app.includes('setTextById("lp-choice-whatsapp-title", "Continue Online")'), 'the listing choice must no longer advertise an unavailable WhatsApp path');
assert(app.includes('function syncTemporaryOnlineAiPageCopy()'), 'the AI page must explain the temporary online journey');
assert(html.includes('id="web-ai-chatbot"'), 'the website AI fallback must have a stable public anchor');
assert(aiService.includes("`${PUBLIC_BASE_URL}/list-property?mode=online`"), 'AI property-listing replies must link to the live online form');
assert(aiRoute.includes("normalizedEffectiveIntent === 'property_listing'"), 'the website AI must recognize listing requests instead of forcing them through property search');
assert(aiRoute.includes('Your submission goes to staff review and is not published automatically.'), 'the website AI must describe the review-only listing boundary');

console.log('WhatsApp temporary website fallback ok');
