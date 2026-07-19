const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const html = read('index.html');
const app = read('assets/makaug-app.js');
const aiRoute = read('routes/ai.js');

assert(html.includes('ai-chatbot-response-text-20260713'), 'production shell must carry the AI chatbot response text marker');
assert((html.match(/ai-chatbot-response-text-20260713/g) || []).length >= 1, 'AI chatbot marker must remain available as release diagnostics');
assert(html.includes('ai-chatbot-submit-bootstrap-20260713'), 'production shell must carry the AI chatbot submit bootstrap marker');
assert((html.match(/ai-chatbot-submit-bootstrap-20260713/g) || []).length >= 1, 'AI chatbot submit bootstrap marker must remain available as release diagnostics');
assert(html.includes('onsubmit="submitAskAiSearchPrompt(event)"'), 'Ask AI forms must call the shared property-search handler');
assert(app.includes('window.submitAskAiSearchPrompt = submitAskAiSearchPrompt;'), 'the loaded app bundle must expose the shared property-search handler');
assert(app.includes('async function submitAiChatbotPrompt'), 'public app must expose the AI chatbot submit handler');
assert(app.includes('window.submitAiChatbotPrompt = submitAiChatbotPrompt;'), 'public app must replace the bootstrap submit handler when the bundle loads');
assert(app.includes('apiRequest("/api/ai/assistant-reply"'), 'AI chatbot submit handler must post to the assistant reply endpoint');
assert(app.includes('const text = data?.text || data?.reply || data?.message'), 'AI chatbot UI must render the endpoint data.text response before legacy reply/message fallbacks');
assert(aiRoute.includes('text:'), 'AI assistant reply endpoint must return data.text');
assert(aiRoute.includes('conversation_logged: true'), 'AI assistant reply endpoint must report conversation logging');

console.log('AI chatbot response text regression checks passed');
