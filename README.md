# MakaUg WhatsApp Property Assistant Backend

Production-ready WhatsApp chatbot backend for [MakaUg.com](https://makaug.com) built with Node.js, TypeScript, Express, WhatsApp Business Cloud API, OpenAI, and PostgreSQL.

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
- `OPENAI_API_KEY`

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

## Webhook Endpoints

- Verify webhook: `GET /api/whatsapp/webhook`
- Receive messages: `POST /api/whatsapp/webhook`
- Health check: `GET /api/health`

## AI Endpoints (MakaUg AI Brain)

- `GET /api/ai/model-card`
- `POST /api/ai/listing-intelligence`
- `POST /api/ai/rewrite-description`
- `POST /api/ai/assistant-reply`
- `POST /api/ai/feedback` (requires `x-api-key: ADMIN_API_KEY`)

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
- Voice notes (OpenAI transcription)

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

### Listing Lifecycle

- Listing collected in `listing_drafts`
- Media tracked in `listing_media`
- Final submission stored in `listing_submissions` with status `pending_review`
- No auto publishing

## Environment Variables (Key List)

See full `.env.example`.

Critical:

- `DATABASE_URL`
- `WHATSAPP_VERIFY_TOKEN`
- `WHATSAPP_APP_SECRET`
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `OPENAI_API_KEY`
- `OPENAI_LISTING_MODEL`
- `OPENAI_REPLY_MODEL`
- `AI_MODEL_VERSION`
- `SUPER_ADMIN_KEY`
- `PUBLIC_BASE_URL`
- `OTP_ENABLED`
- `QUEUE_POLL_SECONDS`
- `MEDIA_STORAGE_PROVIDER`
- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_STORAGE_BUCKET` (if using Supabase storage)
- `S3_PRESIGN_ENDPOINT` / `S3_PRESIGN_TOKEN` (if using S3 presigned flow)

## Very Simple Team Workflow (Child-Simple)

1. Customer sends a WhatsApp message.
2. Backend receives it on `/api/whatsapp/webhook`.
3. Session + message are saved in PostgreSQL.
4. AI detects intent (search, listing, agent, mortgage, support).
5. Bot asks the next question in the selected language.
6. If user is listing property, details go to draft tables first.
7. OTP must pass before final submission.
8. Submission is saved as `pending_review` (not auto-live).
9. Team reviews and approves/rejects.
10. Approved records are shown on MakaUg.
11. AI events + feedback are logged for continuous improvement.

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
- Rotate WhatsApp and OpenAI tokens regularly
- Use managed PostgreSQL backups
- Do not expose NIN/ID docs publicly
- Keep manual moderation before listing approval
- Enable centralized logs/metrics and alerting

## Support

- Phone: +256 770 646 879
- Email: info@makaug.com
