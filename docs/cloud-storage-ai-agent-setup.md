# makaug Cloud Storage and AI Agent Setup

Date: 2026-06-04

## Cloudflare Plan Choice

Choose **Business** for `makaug.com` now, then enable the usage-based developer products needed for storage and AI operations:

- **Cloudflare Business** for the domain, CDN, WAF, stronger application security, and serious production defaults.
- **Workers Paid** for edge functions, durable queues, Vectorize access, Workers AI over the free daily allocation, and future AI gateway/agent routing.
- **R2** for object storage: media, backups, source evidence, AI training exports, and audit files.
- **Log Explorer/Logpush** when production traffic increases enough that security and performance investigations need retained logs.

Open an Enterprise/Contract conversation with Cloudflare sales in parallel if makaug needs contractual SLAs, advanced support response commitments, negotiated traffic pricing, custom compliance terms, or enterprise bot/security features. Do not block the storage migration on that sales process; Business plus Workers Paid plus R2 is the correct immediate setup.

The Cloudflare website plan does not replace Render/Postgres. It protects and accelerates `makaug.com`; R2 stores files; Workers can handle edge glue and AI routing. Keep the system split like this so the LLM can grow from clean stored data without turning the primary website server into a file warehouse.

## Decision

Use a hybrid cloud setup:

1. Keep the website/API on always-on Render compute.
2. Keep structured data in managed Postgres.
3. Move all large media, backups, exports, AI learning datasets, and source sweep archives to Cloudflare R2.
4. Keep the WhatsApp AI agent on a dedicated always-on worker/VM with a persistent browser profile while the current web-bridge path is used.
5. Move to Meta WhatsApp Cloud API when the business number is ready for official API delivery.

This gives makaug low storage cost, no object-storage egress surprises, encrypted file storage, and a clean path for AI learning data.

## Why This Stack

### Cloudflare R2 for files and backups

Use R2 for:

- Listing photos and ID evidence files.
- WhatsApp media placeholders or downloaded media if enabled.
- Source sweep evidence, video stills, and copied social-source screenshots.
- Daily Postgres dumps and local archive bundles.
- AI training/foundation exports.

R2 is S3-compatible, so the existing `scripts/run-production-data-backup.js` already fits it through:

- `S3_ENDPOINT`
- `S3_REGION=auto`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- `DATA_BACKUP_BUCKET`
- `DATA_BACKUP_PREFIX`

Recommended buckets:

- `makaug-prod-media` for public or signed listing media.
- `makaug-prod-private-evidence` for IDs, source evidence, and admin-only files.
- `makaug-prod-backups` for database dumps and archives.
- `makaug-ai-datasets` for AI training exports and model evaluation datasets.

Keep public media separate from private evidence and backups.

### Managed Postgres for structured data

Use Postgres for:

- Users, roles, OTP, accounts, listings, moderation, CRM, saved properties.
- WhatsApp sessions/messages and outbound queue state.
- AI learning events, feedback, and model audit logs.

Do not store large images or videos as database blobs. Store object keys/URLs in Postgres and store bytes in R2.

If staying on Render, use Render Postgres because the app is already Render-shaped and production responses show Render origin headers. Start with paid Postgres, then move to HA once traffic requires it.

### WhatsApp AI agent hosting

Current live mode is:

- `WHATSAPP_DELIVERY_MODE=web_bridge`
- `WHATSAPP_WEB_BRIDGE_ENABLED=true`
- `WHATSAPP_WEB_COPILOT_BASE_URL=https://makaug.com`

For the current browser bridge, host it as a dedicated always-on process with:

- One persistent Chrome profile directory.
- Auto-restart through platform process manager.
- Health heartbeat checking `whatsapp_web_bridge_clients.last_seen_at`.
- Alert if heartbeat is older than 2 minutes.
- Daily restart window only if needed, never during peak support hours.

For the long-term production target, migrate to Meta WhatsApp Cloud API because browser automation can fail when WhatsApp Web asks for re-login or changes its DOM.

### AI learning storage

Keep learning events in Postgres and export datasets to R2.

Existing scripts:

- `npm run ai:export-training`
- `npm run ai:export-foundation`

Recommended flow:

1. Capture conversation turns and feedback in Postgres.
2. Export approved/high-confidence samples daily to `exports/ai-training`.
3. Backup/export those files to `makaug-ai-datasets`.
4. Version each export with `AI_MODEL_VERSION`.
5. Train or fine-tune from exported JSONL only after human review.

## Migration Order

### Phase 0: Freeze and verify

1. Confirm the current production app works.
2. Run a safe WhatsApp dry-run.
3. Record current `DATABASE_URL` provider and region.
4. Record all current media/local-data folders:
   - `exports`
   - `reports`
   - `outputs`
   - `assets/sourced`
   - `assets/marketing`

### Phase 1: Create cloud storage

1. Create the R2 buckets listed above.
2. Create least-privilege R2 tokens:
   - Media token can write/read only media bucket.
   - Backup token can write/read only backup bucket.
   - AI dataset token can write/read only AI dataset bucket.
3. Keep buckets private by default.
4. Use signed URLs or a controlled CDN/custom domain for public listing photos.

### Phase 2: Configure production env

Set production:

```env
MEDIA_STORAGE_PROVIDER=s3
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=makaug-prod-media
S3_ACCESS_KEY_ID=<media-token-access-key>
S3_SECRET_ACCESS_KEY=<media-token-secret>
S3_PUBLIC_BASE_URL=https://media.makaug.com

DATA_BACKUP_BUCKET=makaug-prod-backups
DATA_BACKUP_PREFIX=makaug
DATA_BACKUP_LOCAL_PATHS=exports,reports,outputs,assets/sourced,assets/marketing
DATA_BACKUP_KEEP_LOCAL=false

WHATSAPP_DELIVERY_MODE=web_bridge
WHATSAPP_WEB_BRIDGE_ENABLED=true
WHATSAPP_WEB_COPILOT_BASE_URL=https://makaug.com
WHATSAPP_WEB_COPILOT_CLIENT_ID=makaug-whatsapp-web-prod

LLM_PROVIDER=openai_compat
LLM_API_BASE_URL=<model-endpoint>/v1
LLM_API_KEY=<model-key>
AI_MODEL_VERSION=2026.06.04
```

### Phase 3: Run readiness check

```bash
npm run cloud:readiness
```

Fix every blocker before migration.

### Phase 4: Backup before migration

```bash
npm run data:backup
```

Confirm the JSON manifest appears in the backup bucket.

### Phase 5: Switch media writes to R2

1. Set `MEDIA_STORAGE_PROVIDER=s3`.
2. Deploy.
3. Submit one test listing with 5 photos.
4. Confirm the listing record stores cloud media references.
5. Confirm public listing images render.
6. Confirm admin evidence remains private.

### Phase 6: AI learning export

```bash
npm run ai:export-training
npm run ai:export-foundation
npm run data:backup
```

Confirm AI JSONL/CSV exports are included in the backup/archive paths or uploaded to the AI dataset bucket.

### Phase 7: WhatsApp uptime

1. Run the WhatsApp agent as a dedicated process, not inside an interactive laptop session.
2. Keep the browser profile on persistent storage.
3. Add heartbeat alert:
   - OK: last heartbeat less than 2 minutes old.
   - Warning: 2 to 5 minutes.
   - Critical: over 5 minutes.
4. Keep `npm run test:whatsapp-conversations:live` as the production conversation test.

## Security Rules

- Never put R2 keys in frontend JavaScript.
- Do not reuse the same token for media and backups.
- Keep private evidence and backups in private buckets.
- Use HTTPS for `PUBLIC_BASE_URL` and media custom domains.
- Rotate `JWT_SECRET`, `ADMIN_API_KEY`, `SUPER_ADMIN_KEY`, `WHATSAPP_WEB_BRIDGE_TOKEN`, and R2 tokens on a set schedule.
- Keep backup manifests, hashes, and restore test logs.
- Encrypt at rest at the provider level, and use app-level encryption for ID images or other sensitive evidence if those files must be retained.

## Monthly Cost Shape

Starter production target:

- Render always-on web service.
- Render/managed Postgres paid database.
- Dedicated WhatsApp worker/VM.
- Cloudflare R2 for media, backups, and AI datasets.

Scale target:

- HA Postgres.
- Separate WhatsApp Cloud API provider path.
- Dedicated model endpoint.
- Observability alerts for app, DB, backup, and WhatsApp heartbeat.

The first cost spike to watch is not database storage. It is media bandwidth, uploaded photo volume, and chatbot/LLM calls. R2 controls media egress cost; model routing controls LLM cost.

Official references to check before purchase:

- Cloudflare R2 pricing: https://developers.cloudflare.com/r2/pricing/
- Render pricing: https://render.com/pricing
- Meta WhatsApp Cloud API docs: https://developers.facebook.com/docs/whatsapp/cloud-api

## Operational KPIs

- Website uptime: 99.9 percent target minimum.
- WhatsApp heartbeat: less than 2 minutes old.
- Backup success: daily, with manifest and restore test.
- Media write success: 99 percent plus.
- Database backup restore test: weekly until stable, then monthly.
- AI dataset export: daily or weekly depending on traffic.
- Security: no public bucket for private evidence, no placeholder secrets, no wildcard CORS.
