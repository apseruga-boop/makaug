const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const service = read('services/aiCeoControlService.js');
const orchestratorService = read('services/aiAgentOrchestratorService.js');
const whatsappRoute = read('routes/whatsapp.js');
const adminAgentsRoute = read('routes/admin-agents.js');
const aiCeoRoute = read('routes/ai-ceo.js');
const server = read('server.js');
const migration = read('db/migrations/035_ai_ceo_phone_control.sql');
const ownerColumnMigration = read('db/migrations/039_ai_ceo_command_owner_columns.sql');
const html = read('index.html');
const app = read('assets/makaug-app.js');
const scheduleScript = read('scripts/send-ai-ceo-morning-report.js');
const phoneTestScript = read('scripts/test-ai-ceo-phone-control.js');
const smsService = read('models/smsService.js');
const whatsappNotificationService = read('services/whatsappNotificationService.js');
const envExample = read('.env.example');
const pkg = JSON.parse(read('package.json'));

assert(service.includes('AI_CEO_OWNER_PHONES'), 'AI CEO service must require configured owner phone numbers');
assert(service.includes('AI_CEO_REPORT_WHATSAPP_RECIPIENTS'), 'AI CEO service must support report-only WhatsApp recipients');
assert(service.includes('getConfiguredReportWhatsappRecipients'), 'AI CEO service must expose report recipient parsing');
assert(service.includes('isAiCeoReportRecipientPhone'), 'AI CEO service must recognise report-only WhatsApp recipients');
assert(service.includes('REPORT_RECIPIENT_READ_ONLY_INTENTS'), 'Report-only WhatsApp recipients must be limited to read-only CEO report intents');
assert(service.includes('dryrun:'), 'AI CEO owner phone matching must work for WhatsApp web-bridge dry-run tests');
assert(service.includes('isAiCeoOwnerPhone'), 'AI CEO service must verify owner phone before WhatsApp control');
assert(service.includes('handleOwnerWhatsappCommand'), 'AI CEO service must expose WhatsApp owner command handling');
assert(service.includes('AI_CEO_EMAIL_SEND_MODE'), 'AI CEO email sending must have a direct/draft mode kill switch');
assert(!service.includes("reportType = channel === 'whatsapp_owner'"), 'Owner phone commands must use an ai_ceo_reports report_type accepted by the live schema');
assert(service.includes('queueFounderApprovalAction'), 'AI CEO must queue risky actions for founder approval');
assert(service.includes('sendSupportEmail'), 'AI CEO must be able to send outgoing email through the existing email service');
assert(service.includes('sendTelegramMessage'), 'AI CEO service must support Telegram owner replies');
assert(service.includes('collectCeoMetrics'), 'AI CEO must collect platform metrics for reports');
assert(service.includes('ceoPendingReviewWhere') && service.includes("lead_status = 'open'"), 'AI CEO metrics must match Command Centre pending/listing/lead definitions');
assert(orchestratorService.includes('ceoPendingReviewWhere') && orchestratorService.includes('ceoPublicLiveWhere'), 'AI CEO orchestrator must use the same listing status definitions as Command Centre');
assert(orchestratorService.includes("lead_status = 'open'"), 'AI CEO orchestrator must count only live open leads like Command Centre');

assert(whatsappRoute.includes('handleOwnerWhatsappCommand'), 'WhatsApp runtime must intercept founder owner commands');
assert(whatsappRoute.includes('ai_ceo_control_service'), 'WhatsApp command handling must be logged as AI CEO control');
assert(adminAgentsRoute.includes("'/ceo/status'"), 'Admin AI route must expose CEO status');
assert(adminAgentsRoute.includes("'/ceo/morning-report'"), 'Admin AI route must expose CEO morning report');
assert(adminAgentsRoute.includes("'/ceo/command'"), 'Admin AI route must expose CEO command endpoint');
assert(aiCeoRoute.includes('/telegram/webhook'), 'AI CEO Telegram webhook route must exist');
assert(aiCeoRoute.includes('/email/inbound'), 'AI CEO inbound email route must exist');
assert(server.includes("app.use('/api/ai-ceo'"), 'Server must mount AI CEO public integration routes');

assert(migration.includes('ai_ceo_reports'), 'Migration must create AI CEO reports table');
assert(migration.includes('ai_ceo_commands'), 'Migration must create AI CEO commands table');
assert(migration.includes('managing_director_ceo'), 'Migration must seed the AI CEO agent');
assert(migration.includes('requires_founder_approval'), 'Migration must add founder approval metadata');
assert(ownerColumnMigration.includes('requester_phone'), 'Migration must add requester_phone for live AI CEO phone command logging');
assert(ownerColumnMigration.includes('requester_chat_id'), 'Migration must add requester_chat_id for owner Telegram command logging');

assert(html.includes('Founder-controlled AI CEO'), 'Admin dashboard must show the AI CEO panel');
assert(app.includes('askAiCeoCommand'), 'Frontend must allow founder dashboard commands');
assert(app.includes('runAiCeoMorningReport'), 'Frontend must allow morning report generation');
assert(app.includes('/api/admin/ai-agents/ceo/command'), 'Frontend must call the CEO command API');
assert(scheduleScript.includes('sendReportToFounderWhatsapp'), 'Scheduled AI CEO report must support WhatsApp delivery');
assert(scheduleScript.includes('AI_CEO_OWNER_EMAIL'), 'Scheduled AI CEO report must support owner email delivery');
assert(pkg.scripts['ai:ceo-morning-report'], 'Package script must expose AI CEO morning report scheduler');
assert(pkg.scripts['test:ai-ceo-phone'], 'Package script must expose CEO phone control test');
assert(phoneTestScript.includes('AI_CEO_PHONE_TEST_OWNER'), 'CEO phone test must allow an explicit owner test phone');
assert(phoneTestScript.includes('handleOwnerWhatsappCommand'), 'CEO phone test must verify direct owner command handling');
assert(phoneTestScript.includes('processInboundRuntime'), 'CEO phone test must verify WhatsApp runtime interception');
assert(phoneTestScript.includes('non_owner_blocked'), 'CEO phone test must prove non-owner phones are blocked');
assert(envExample.includes('AI_CEO_OWNER_PHONES='), 'Example env must document AI CEO owner phones');
assert(envExample.includes('AI_CEO_REPORT_WHATSAPP_RECIPIENTS='), 'Example env must document report-only WhatsApp recipients');
assert(envExample.includes('AI_CEO_PHONE_TEST_OWNER='), 'Example env must document CEO phone test owner override');
assert(!smsService.includes("const twilio = require('twilio')"), 'SMS service must lazy-load Twilio so CEO phone tests do not hang when SMS is unused');
assert(!whatsappNotificationService.includes("const twilio = require('twilio')"), 'WhatsApp notification service must lazy-load Twilio so CEO phone tests do not hang when Twilio is unused');

console.log('AI CEO phone-control wiring tests passed');
