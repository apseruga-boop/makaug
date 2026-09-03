'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const agentRouteSource = fs.readFileSync(path.join(root, 'routes', 'agents.js'), 'utf8');
const whatsappRouteSource = fs.readFileSync(path.join(root, 'routes', 'whatsapp.js'), 'utf8');
const eligibilitySource = fs.readFileSync(path.join(root, 'services', 'publicAgentEligibilityService.js'), 'utf8');
const {
  addPublicAgentEligibilityFilters
} = require('../services/publicAgentEligibilityService');

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `Expected ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `Expected ${endMarker}`);
  return source.slice(start, end);
}

const filters = ["a.status = 'approved'"];
const values = [];
addPublicAgentEligibilityFilters(filters, values, 'a');
const generatedFilterSql = filters.join('\n');

assert.match(eligibilitySource, /TRAINING[\s\S]*DEMO[\s\S]*SAMPLE[\s\S]*PLACEHOLDER/);
assert.match(generatedFilterSql, /a\.user_id IS NOT NULL/);
assert.match(generatedFilterSql, /public social source onboarding/);
assert.match(generatedFilterSql, /p\.agent_id = a\.id[\s\S]*p\.status = 'approved'/);
assert.match(generatedFilterSql, />= 2/);
assert.match(agentRouteSource, /addPublicAgentEligibilityFilters\(filters, values\)/);
assert.match(whatsappRouteSource, /addPublicAgentEligibilityFilters\(filters, values, 'a'\)/);

const agentQuerySource = sourceBetween(
  whatsappRouteSource,
  'async function queryPublicAgentsForWhatsapp(',
  '\nasync function findAllAgentsForWhatsapp('
);
assert.match(agentQuerySource, /FROM agents a/);
assert.match(agentQuerySource, /ORDER BY listings_count DESC, a\.created_at DESC/);
assert.doesNotMatch(agentQuerySource, /rating/);

const keywordSearchSource = sourceBetween(
  whatsappRouteSource,
  'async function findAgentsForWhatsappKeywords(',
  '\nfunction logPropertySearchRequest('
);
assert.match(keywordSearchSource, /return queryPublicAgentsForWhatsapp\(/);
assert.doesNotMatch(keywordSearchSource, /for \(const keyword/);
assert.doesNotMatch(keywordSearchSource, /await db\.query/);

const formatterSource = sourceBetween(
  whatsappRouteSource,
  'function formatAgentSearchMessage(',
  '\nfunction formatNoMatchReply('
);
assert.doesNotMatch(formatterSource, /ratingLabel|Rating:|⭐/);
assert.match(formatterSource, /\/agents\/\$\{r\.id\}/);

assert.match(whatsappRouteSource, /WHATSAPP_AGENT_CACHE_MS = 30 \* 1000/);
assert.match(whatsappRouteSource, /const \[session, conversationControl\] = await Promise\.all/);
assert.match(whatsappRouteSource, /WhatsApp reply ready in \$\{runtimeLatencyMs\}ms/);

console.log('WhatsApp public-agent parity and fast-reply tests passed');
