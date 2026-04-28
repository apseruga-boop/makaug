# WhatsApp Bot Architecture (MakaUg)

## Request Flow

1. Meta WhatsApp Cloud API sends webhook payload to `POST /api/whatsapp/webhook`
2. Payload is parsed into normalized `MessageInput`
3. Message is logged into `whatsapp_messages`
4. Session loaded from `whatsapp_sessions`
5. `ConversationStateMachine` processes step + intent
6. Domain services/repositories persist side effects
7. Reply sent via WhatsApp Cloud API (with retry queue fallback)
8. Outbound message stored in `whatsapp_messages`
9. Session persisted

## Session State

Stored per phone in `whatsapp_sessions`:

- language
- current step
- current intent
- listing/search/report draft fields
- OTP state
- pause state

## Data Stores

- Search telemetry: `property_search_requests`, `search_results_cache`
- Listing pipeline: `listing_drafts`, `listing_media`, `listing_submissions`
- Trust/safety: `otp_verifications`, `listing_reports`, `audit_logs`
- Delivery reliability: `outbound_message_queue`
- Commercial flows: `agent_applications`, `mortgage_enquiries`, `property_leads`
- Voice: `transcriptions`

## Integrations

- WhatsApp Business Cloud API (send/receive/media)
- OpenAI (intent + translation fallback + voice transcription)
- PostgreSQL (system of record)

## Security & Reliability

- Signed webhook verification via `X-Hub-Signature-256` and `WHATSAPP_APP_SECRET`
- Outbound retry worker with exponential backoff and max attempts
- Media adapter abstraction:
  - `local` passthrough
  - `supabase` object storage upload
  - `s3_presigned` upload via presigned endpoint

## Production Recommendations

- Add queue (BullMQ/SQS) for media + transcription heavy workloads
- Add object storage (S3/Supabase) for media files
- Add moderation dashboard for pending listings/agent applications/reports
- Add retries + dead letter queue for outbound failures
- Add observability (Sentry + structured logs + dashboards)

## Agent Runtime Improvements

The SSD download `claw-code-rust-main` is an MIT-licensed Rust agent runtime,
not a WhatsApp integration. The useful parts for MakaUg are runtime patterns,
so we adapted the ideas instead of copying Rust into Node:

- Fast message loop: deterministic WhatsApp flow steps now use heuristic intent
  routing first, avoiding slow LLM calls for simple replies and media uploads.
- Language lock: voice transcripts and detected text language are resolved
  before intent classification, so the classifier and reply flow stay in the
  user's current language unless they explicitly switch.
- Error/retry posture: the existing LLM wrapper already retries rate-limit and
  server errors; the runtime now records the model used and latency per turn so
  slow or failing paths can be found in admin telemetry.
- Session memory: conversation state stores last intent, step, language source,
  and runtime latency, keeping the admin view aligned with where the user left
  off.
- Media continuity: WhatsApp Web media messages now receive a placeholder media
  URL whenever a media type is reported, even if WhatsApp sends no text body or
  album count. This keeps the photo listing flow moving to the next required
  image.
