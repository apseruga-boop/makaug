const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const service = read('services/outlookAiEmailAgentService.js');
const adminRoutes = read('routes/admin.js');
const migration = read('db/migrations/040_outlook_ai_email_agent.sql');
const html = read('index.html');
const app = read('assets/makaug-app.js');
const envExample = read('.env.example');
const pkg = JSON.parse(read('package.json'));
const probe = read('scripts/probe-backend-connections.js');
const docs = read('docs/outlook-ai-email-agent.md');

assert(service.includes('getOutlookAgentConfig'), 'Outlook agent service must expose safe config/status');
assert(service.includes('OUTLOOK_AI_DRAFT_ONLY'), 'Outlook agent must have a draft-only kill switch');
assert(service.includes('OUTLOOK_AI_REQUIRE_APPROVAL'), 'Outlook agent must have an approval guardrail');
assert(service.includes('OUTLOOK_AI_AUTO_SEND_CATEGORIES'), 'Outlook direct-send categories must be allowlisted');
assert(service.includes('Mail.Read') && service.includes('Mail.ReadWrite') && service.includes('Mail.Send'), 'Outlook agent must declare required Graph permissions');
assert(service.includes('fetchOutlookInboxMessages'), 'Outlook agent must read from Microsoft Graph inbox');
assert(service.includes('createOutlookGraphDraft'), 'Outlook agent must create Outlook drafts');
assert(service.includes('classifyOutlookEmail'), 'Outlook agent must classify inbound email risk');
assert(service.includes('fraud_safety'), 'Outlook agent must force risky fraud/safety emails through review');
assert(service.includes('logEmailEvent'), 'Outlook agent must write email audit events');
assert(service.includes('createLead'), 'Outlook agent must create CRM leads from inbound email queries');
assert(!service.includes('OUTLOOK_PASSWORD'), 'Outlook agent must not accept raw mailbox password env vars');

for (const expected of [
  "router.get('/outlook-agent/status'",
  "router.get('/outlook-agent/actions'",
  "router.post('/outlook-agent/sync'",
  "router.post('/outlook-agent/draft'",
  "router.post('/outlook-agent/actions/:id/approve'",
  "router.post('/outlook-agent/actions/:id/reject'",
  "router.post('/outlook-agent/actions/:id/send'"
]) {
  assert(adminRoutes.includes(expected), `Admin Outlook route missing: ${expected}`);
}
assert(adminRoutes.includes('router.use(requireAdminApiKey)'), 'Outlook routes must inherit admin API protection');
assert(adminRoutes.includes('writeAudit') && adminRoutes.includes('outlook_agent_send_attempt'), 'Outlook send attempts must be audited');

assert(migration.includes('CREATE TABLE IF NOT EXISTS outlook_email_threads'), 'Migration must create Outlook thread inventory');
assert(migration.includes('CREATE TABLE IF NOT EXISTS outlook_email_actions'), 'Migration must create Outlook action queue');
assert(migration.includes('outlook_ai_email_agent'), 'Migration must seed/register the Outlook AI agent');

assert(html.includes('Outlook AI Email Agent'), 'King dashboard must show Outlook AI Email Agent controls');
assert(html.includes('outlook-email-agent-20260515'), 'Frontend cache version must be bumped for Outlook agent rollout');
assert(html.includes('admin-outlook-agent-status'), 'King dashboard must include Outlook status container');
assert(html.includes('admin-outlook-agent-actions'), 'King dashboard must include Outlook action queue');
assert(app.includes('/api/admin/outlook-agent/status'), 'Frontend must fetch Outlook agent status');
assert(app.includes('/api/admin/outlook-agent/actions'), 'Frontend must fetch Outlook agent actions');
assert(app.includes('adminDraftOutlookReply'), 'Frontend must support manual Outlook AI draft creation');
assert(app.includes('adminApproveOutlookDraft'), 'Frontend must support Outlook draft approval');
assert(app.includes('adminRejectOutlookDraft'), 'Frontend must support Outlook draft rejection');
assert(app.includes('adminSendOutlookDraft'), 'Frontend must support guarded Outlook send action');

assert(envExample.includes('OUTLOOK_AI_AGENT_ENABLED='), 'Example env must document Outlook agent enable flag');
assert(envExample.includes('OUTLOOK_AI_DRAFT_ONLY=true'), 'Example env must default Outlook agent to draft-only');
assert(envExample.includes('OUTLOOK_AI_REQUIRE_APPROVAL=true'), 'Example env must default Outlook agent to approval-required');
assert(pkg.scripts['ai:outlook-email-agent'], 'Package scripts must expose Outlook email agent scheduler');
assert(probe.includes("router.get('/outlook-agent/status'"), 'Backend connection probe must check Outlook agent status route');
assert(docs.includes('Microsoft Graph') && docs.includes('npm run ai:outlook-email-agent'), 'Outlook agent docs must explain Graph setup and scheduler');

console.log('Outlook AI email agent wiring tests passed');
