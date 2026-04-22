# MakaUg WhatsApp Property Assistant Backend

Production-ready WhatsApp chatbot backend for [MakaUg.com](https://makaug.com) built with Node.js, TypeScript, Express, WhatsApp Business Cloud API, PostgreSQL, and a pluggable LLM provider layer (self-hosted OpenAI-compatible, OpenAI, or disabled mode).

This backend is **MakaUg-specific** and supports the core journeys:

- Property search (sale, rent, students, commercial, land)
- Property listing submissions (draft -> verification -> pending review)
- Broker/agent search
- Agent registration (registered vs not registered track)
- Mortgage guidance
- Account/saved properties help
- Listing reporting/fraud support
- Human support fallback

It drives users back to MakaUg using direct listing, area, broker, mortgage, and account links.

## Architecture Summary

- **Routes**: webhook + health
- **Controllers**: webhook verification/ingestion + health
- **Services**:
  - `intentClassifier`
  - `conversationStateMachine`
  - `languageService`
  - `propertySearchService`
  - `listingDraftService`
  - `mediaUploadService`
  - `voiceTranscriptionService`
  - `locationService`
  - `reverseGeocodingAdapter`
  - `otpService`
  - `validationService`
  - `mortgageCalculatorService` + `mortgageService`
  - `agentService`
  - `accountHelpService`
  - `supportEscalationService`
  - `urlBuilderService`
  - `auditLogger`
  - `aiFoundationService` (ingest auth/session/raw+normalized events)
  - `aiFoundationExportService` (training export pipeline)
- **Repositories**:
  - Postgres repositories for sessions/messages/search/drafts/media/submissions/otp/leads/reports/transcriptions/audit
  - Adapter pattern for property + agent data
  - Mock adapters for local fallback and tests
- **Tests**:
  - Journey tests covering greeting/language/search/listing/OTP/voice/agent/mortgage/report/support
- **Hardening**:
  - WhatsApp signed webhook validation (`X-Hub-Signature-256`)
  - Outbound retry queue + worker (`outbound_message_queue`)
  - Media storage adapters (`local`, `supabase`, `s3_presigned`)
  - Automatic typed reply localization for all outgoing messages

## Folder Structure

```text
src/
  app.ts
  server.ts
  config/
  controllers/
  routes/
  services/
  adapters/
  repositories/
    interfaces.ts
    postgres/
    mock/
  data/
  types/
  utils/
  tests/

db/migrations/
  001_init.sql
  ...
  007_whatsapp_assistant.sql
  008_outbound_message_queue.sql
  ...
  014_llm_foundation_phase1.sql

examples/
  payloads/
  conversations/
```

## Setup Steps

1. Install dependencies

```bash
npm install
```

2. Create env file

```bash
cp .env.example .env
```

3. Fill required env values in `.env`
- `DATABASE_URL`
- `WHATSAPP_VERIFY_TOKEN`
- `WHATSAPP_APP_SECRET`
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- LLM provider values (recommended for your own model stack):
  - `LLM_PROVIDER=openai_compat`
  - `LLM_API_BASE_URL=<your LLM endpoint, e.g. http://localhost:8000/v1 or https://llm.yourdomain.com/v1>`
  - `LLM_API_KEY` (if your endpoint requires auth)
  - `LLM_NO_AUTH=true` only when your endpoint does not require auth headers

4. Run migrations

```bash
npm run migrate
```

5. Run backend in development

```bash
npm run dev:bot
```

6. Run tests

```bash
npm run test:bot
```

7. Build for production

```bash
npm run build:bot
npm run start:bot
```

8. Export LLM foundation dataset (Phase 1)

```bash
npm run ai:export-foundation -- --site=makaug-main --days=30 --minConfidence=0.55 --limit=20000
```

## Webhook Endpoints

- Verify webhook: `GET /api/whatsapp/webhook`
- Receive messages: `POST /api/whatsapp/webhook`
- Health check: `GET /api/health`

## Connect WhatsApp Business Number (Meta Cloud API)

This backend now supports Meta Cloud API directly on the live `server.js` service.

1. In Render, set these env vars on the `makaug` web service:
   - `WHATSAPP_VERIFY_TOKEN` (any strong secret string)
   - `WHATSAPP_ACCESS_TOKEN` (Meta permanent/system-user token)
   - `WHATSAPP_PHONE_NUMBER_ID` (from WhatsApp Manager)
   - `WHATSAPP_API_VERSION` (example: `v20.0`)
2. Save + redeploy.
3. In Meta App Dashboard > WhatsApp > Configuration:
   - Webhook URL: `https://makaug.com/api/whatsapp/webhook`
   - Verify token: exactly the same value as `WHATSAPP_VERIFY_TOKEN`
4. Subscribe to `messages` webhook field.
5. Send a WhatsApp test message to your connected business number.
6. Check Render logs for inbound processing and outbound reply.

Notes:
- The same route still accepts Twilio webhook payloads as fallback.
- Voice note transcription uses the configured provider via the same LLM abstraction layer.

## AI Endpoints (MakaUg AI Brain)

- `GET /api/ai/model-card`
- `POST /api/ai/listing-intelligence`
- `POST /api/ai/rewrite-description`
- `POST /api/ai/assistant-reply`
- `POST /api/ai/feedback` (requires `x-api-key: ADMIN_API_KEY`)

## LLM Foundation Phase 1 (New)

These endpoints power your data foundation for training and improving MakaUg AI models.

- `GET /api/ai-core/event-schema`
- `POST /api/ai-core/ingest/events`
  - Auth: `x-site-key` (preferred) or `x-api-key: ADMIN_API_KEY`
  - Supports single `event` or batched `events[]`
  - Stores raw events + normalized events + session links
- `POST /api/ai-core/sites/:siteCode/rotate-key` (admin only)
  - Rotates site ingest key and returns it once
- `GET /api/ai-core/sites` (admin only)
- `POST /api/ai-core/exports/run` (admin only)
  - Creates `ai_export_runs` record and writes JSONL/CSV to `exports/llm-foundation/`
- `GET /api/ai-core/exports/runs` (admin only)

### Quick cURL Examples

Rotate site key (run once, store returned key):

```bash
curl -X POST "https://makaug.com/api/ai-core/sites/makaug-main/rotate-key" \
  -H "x-api-key: $ADMIN_API_KEY"
```

Ingest events:

```bash
curl -X POST "https://makaug.com/api/ai-core/ingest/events" \
  -H "Content-Type: application/json" \
  -H "x-site-key: $SITE_INGEST_KEY" \
  --data @examples/payloads/ai-foundation-ingest.json
```

Run export:

```bash
curl -X POST "https://makaug.com/api/ai-core/exports/run" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $ADMIN_API_KEY" \
  -d '{"site_code":"makaug-main","days":30,"min_confidence":0.55,"limit":20000}'
```

## AI Agent Motherboard Endpoints

All endpoints below require `x-api-key: ADMIN_API_KEY`.

- `GET /api/admin/ai-agents/agents`
- `PATCH /api/admin/ai-agents/agents/:id`
- `POST /api/admin/ai-agents/run` (`agent_code` or `all`)
- `GET /api/admin/ai-agents/runs`
- `GET /api/admin/ai-agents/findings`
- `POST /api/admin/ai-agents/findings/:id/decision`
- `GET /api/admin/ai-agents/actions`
- `POST /api/admin/ai-agents/actions/:id/approve`

Execution endpoint (extra protection):

- `POST /api/admin/ai-agents/actions/:id/execute`
  - requires both:
    - `x-api-key: ADMIN_API_KEY`
    - `x-super-admin-key: SUPER_ADMIN_KEY`

## Supported Languages

Exact language support:

- English (`en`)
- Luganda (`lg`)
- Kiswahili (`sw`)
- Acholi (`ac`)
- Runyankole (`ny`)
- Rukiga (`rn`)
- Lusoga (`sm`)

Language is captured first and stored per session.
Voice notes are transcribed and replied to in typed text.

## Input Types Supported

- Text
- Button/list interactive replies
- WhatsApp location pin
- Images
- PDFs/documents
- Voice notes (provider-backed transcription)

## Database Overview

Migration `007_whatsapp_assistant.sql` adds/ensures:

- `users`
- `whatsapp_sessions`
- `whatsapp_messages`
- `property_search_requests`
- `search_results_cache`
- `listing_drafts`
- `listing_media`
- `listing_submissions`
- `otp_verifications`
- `agent_applications`
- `mortgage_enquiries`
- `property_leads`
- `listing_reports`
- `transcriptions`
- `audit_logs`

Migration `008_outbound_message_queue.sql` adds:

- `outbound_message_queue`

Migration `014_llm_foundation_phase1.sql` adds:

- `ai_tenants`
- `ai_sites`
- `ai_sessions`
- `ai_events_raw`
- `ai_events_normalized`
- `ai_event_labels`
- `ai_export_runs`

### Listing Lifecycle

- Listing collected in `listing_drafts`
- Media tracked in `listing_media`
- Final submission stored in `listing_submissions` with status `pending_review`
- No auto publishing

### LLM Data Lifecycle (Phase 1)

1. Client or connector calls `/api/ai-core/ingest/events`.
2. Event is written to `ai_events_raw`.
3. Server normalizes intent/language/text/entities and writes `ai_events_normalized`.
4. Training candidates are marked with `is_training_candidate=true`.
5. Team can label quality in `ai_event_labels`.
6. Export job writes JSONL/CSV and tracks run in `ai_export_runs`.

## Environment Variables (Key List)

See full `.env.example`.

Critical:

- `DATABASE_URL`
- `WHATSAPP_VERIFY_TOKEN`
- `WHATSAPP_APP_SECRET`
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `LLM_PROVIDER`
- `LLM_API_BASE_URL`
- `LLM_API_KEY` (or `LLM_NO_AUTH=true` for trusted internal endpoints)
- `LLM_INTENT_MODEL`
- `LLM_LISTING_MODEL`
- `LLM_REPLY_MODEL`
- `LLM_TRANSCRIBE_MODEL`
- `AI_MODEL_VERSION`
- `AI_TRAINING_MIN_CONFIDENCE`
- `SUPER_ADMIN_KEY`
- `PUBLIC_BASE_URL`
- `OTP_ENABLED`
- `QUEUE_POLL_SECONDS`
- Site key management: rotate key per site via `/api/ai-core/sites/:siteCode/rotate-key`
- `MEDIA_STORAGE_PROVIDER`
- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_STORAGE_BUCKET` (if using Supabase storage)
- `S3_PRESIGN_ENDPOINT` / `S3_PRESIGN_TOKEN` (if using S3 presigned flow)
- Email OTP delivery (choose at least one):
  - Microsoft Graph: `MS_GRAPH_TENANT_ID`, `MS_GRAPH_CLIENT_ID`, `MS_GRAPH_CLIENT_SECRET`, `MS_GRAPH_SENDER_EMAIL`
  - SMTP: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`
  - Resend: `RESEND_API_KEY`
  - Webhook relay: `MAIL_WEBHOOK_URL`

Admin QA listing override:

- Preferred for production QA: call `POST /api/admin/listing-submit-otp-override` with `ADMIN_API_KEY` to generate a one-time listing submission token for a known test phone/email.
- Optional public OTP override: set `ADMIN_OTP_OVERRIDE_ENABLED=true`, `ADMIN_OTP_OVERRIDE_CODE=<private code>`, `ADMIN_OTP_OVERRIDE_ALLOWLIST_STRICT=true`, and `ADMIN_OTP_OVERRIDE_ALLOWLIST=<your email or phone>`.
- To create the 25 labelled dummy listings, run `ADMIN_API_KEY=<key> npm run qa:create-listings`. Add `QA_APPROVE=1` only when you intentionally want the dummy listings approved and visible.

## Email OTP Setup (GoDaddy + Microsoft 365)

If you see this error in OTP requests:

- `Email OTP delivery provider is not configured`
- or SMTP log with `5.7.139 SmtpClientAuthentication is disabled for the Tenant`

Use one of these paths:

1. **Recommended**: Microsoft Graph sender (does not require SMTP AUTH)
2. SMTP AUTH (only if your tenant allows authenticated SMTP)
3. Resend/Webhook fallback

### Path A: Microsoft Graph (recommended)

1. Register an app in Azure/Microsoft Entra.
2. Add **Application permission**: `Mail.Send`.
3. Grant admin consent.
4. Create client secret.
5. In Render env vars set:
   - `MS_GRAPH_TENANT_ID`
   - `MS_GRAPH_CLIENT_ID`
   - `MS_GRAPH_CLIENT_SECRET`
   - `MS_GRAPH_SENDER_EMAIL=info@makaug.com`
   - `EMAIL_FROM=MakaUg <info@makaug.com>`
6. Redeploy service.
7. Test OTP from UI:
   - choose `Receive OTP via = Email`
   - click **Send OTP**

### Path B: SMTP AUTH (only if enabled in tenant)

1. Ensure mailbox has Authenticated SMTP enabled.
2. Ensure tenant-level SMTP AUTH is enabled.
3. Set Render env vars:
   - `SMTP_HOST=smtp.office365.com`
   - `SMTP_PORT=587`
   - `SMTP_SECURE=false`
   - `SMTP_USER=info@makaug.com`
   - `SMTP_PASS=<mailbox or app password>`
   - `SMTP_REQUIRE_AUTH=true`
   - `SMTP_TLS_REJECT_UNAUTHORIZED=false` (optional if cert chain issues)
4. Redeploy and test again.

## Running Fully Without ChatGPT/OpenAI (Your Own LLM)

Use this when you want MakaUg AI to run only on your own model infrastructure.

1. Host an OpenAI-compatible endpoint (examples: vLLM, LM Studio server mode, Ollama OpenAI bridge, custom gateway).
2. Set:
   - `LLM_PROVIDER=openai_compat`
   - `LLM_API_BASE_URL=<your endpoint>/v1`
   - `LLM_API_KEY=<key>` (or `LLM_NO_AUTH=true` for private trusted network)
3. Set task models:
   - `LLM_INTENT_MODEL`
   - `LLM_TRANSCRIBE_MODEL`
   - `LLM_LISTING_MODEL`
   - `LLM_REPLY_MODEL`
   - `LLM_CAMPAIGN_MODEL`
4. Redeploy.
5. Test:
   - send WhatsApp text intent prompts
   - send voice note transcription sample
   - verify classification/replies are returned in supported languages

If you need a hard stop fallback mode (no model calls), set:

- `LLM_PROVIDER=none`

The bot will continue with heuristics and deterministic flows.

## Very Simple Team Workflow (Child-Simple)

1. Customer sends a WhatsApp message.
2. Backend receives it on `/api/whatsapp/webhook`.
3. Session + message are saved in PostgreSQL.
4. AI (your configured provider) detects intent (search, listing, agent, mortgage, support).
5. Bot asks the next question in the selected language.
6. If user is listing property, details go to draft tables first.
7. OTP must pass before final submission.
8. Submission is saved as `pending_review` (not auto-live).
9. Team reviews and approves/rejects.
10. Approved records are shown on MakaUg.
11. AI events + feedback are logged for continuous improvement and model training data exports.

## Daily AI Agent Run

Run all enabled AI agents:

```bash
npm run ai:run-agents
```

Use Render Cron (recommended every 15–30 mins) to run:

```bash
npm run ai:run-agents -- 40 scheduled_job system_scheduler
```

## Sample WhatsApp Payloads

- `/Users/arthurseruga/Documents/New project/examples/payloads/text-message.json`
- `/Users/arthurseruga/Documents/New project/examples/payloads/location-message.json`
- `/Users/arthurseruga/Documents/New project/examples/payloads/audio-message.json`
- `/Users/arthurseruga/Documents/New project/examples/payloads/image-message.json`

## Sample Conversation Journeys

- `/Users/arthurseruga/Documents/New project/examples/conversations/property-search.md`
- `/Users/arthurseruga/Documents/New project/examples/conversations/property-listing.md`
- `/Users/arthurseruga/Documents/New project/examples/conversations/agent-and-mortgage.md`
- `/Users/arthurseruga/Documents/New project/examples/conversations/report-and-support.md`

AI operations guide:

- `/Users/arthurseruga/Documents/New project/docs/whatsapp/AI_MODEL_GUIDE.md`
- `/Users/arthurseruga/Documents/New project/docs/LAUNCH_COMMAND_PACK.md`

## Connecting Live MakaUg Data Later

The bot already uses an adapter pattern:

- `PropertyDataAdapter`
- `AgentDataAdapter`

To plug live data:

1. Implement new adapter classes in `src/repositories/postgres/` or `src/repositories/external/`
2. Map live response fields to `SearchResult`/`BrokerResult`
3. Switch adapter selection in `src/repositories/index.ts`
4. Keep `Mock*Adapter` as fallback for degraded mode

## Production Notes

- Keep webhook route behind HTTPS only
- Rotate WhatsApp and LLM provider tokens regularly
- Use managed PostgreSQL backups
- Do not expose NIN/ID docs publicly
- Keep manual moderation before listing approval
- Enable centralized logs/metrics and alerting

## Support

- Phone: 0760112587
- Email: info@makaug.com
