# makaug Production Data Setup

This setup keeps makaug data in one controlled place without making the app server carry files on its own disk.

## Recommended Architecture

1. Managed PostgreSQL is the system of record for listings, users, leads, AI learning events, WhatsApp logs, moderation, CRM, advertising, and audit trails.
2. Cloudflare R2, or another S3-compatible object store, is the system of record for uploaded files, evidence, WhatsApp media, exports, and database backups.
3. Render or the live app server runs code only. Its disk is treated as temporary.
4. A local NAS such as Synology is optional and should be a second backup copy, not the primary live storage.

Official references:
- Cloudflare R2 pricing: https://developers.cloudflare.com/r2/pricing/
- Cloudflare R2 S3 compatibility: https://developers.cloudflare.com/r2/api/s3/api/
- Backblaze B2 pricing comparison: https://www.backblaze.com/cloud-storage/pricing

## Bucket Plan

Create these buckets in the same R2 account:

| Bucket | Access | Purpose |
| --- | --- | --- |
| `makaug-prod-media` | Public/custom-domain where needed | Listing photos, public marketing assets, public source evidence that makaug is allowed to host. |
| `makaug-private-evidence` | Private | National ID images, broker/agent documents, field-agent documents, private review evidence. |
| `makaug-whatsapp-attachments` | Private | WhatsApp media pulled from inbound conversations before review. |
| `makaug-source-captures` | Private | Source sweep screenshots, social evidence, YouTube/TikTok/Twitter/Facebook source captures. |
| `makaug-db-backups` | Private | Nightly Postgres dumps, local archive tarballs, and backup manifests. |
| `makaug-admin-exports` | Private | AI learning exports, outreach sheets, admin reports, CRM exports. |

The current repo wiring uses one `S3_BUCKET` for app media and one `DATA_BACKUP_BUCKET` for backups. Start with:

```bash
MEDIA_STORAGE_PROVIDER=s3
S3_ENDPOINT=https://<cloudflare-account-id>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=makaug-prod-media
S3_ACCESS_KEY_ID=<r2-access-key>
S3_SECRET_ACCESS_KEY=<r2-secret-key>
S3_PUBLIC_BASE_URL=https://media.makaug.com

DATA_BACKUP_BUCKET=makaug-db-backups
DATA_BACKUP_PREFIX=makaug
DATA_BACKUP_LOCAL_PATHS=exports,reports,outputs,assets/sourced,assets/marketing
DATA_BACKUP_KEEP_LOCAL=false

AI_EXPORT_BUCKET=makaug-admin-exports
AI_EXPORT_PREFIX=makaug/ai-exports
REQUIRE_CLOUD_AI_EXPORTS=true
```

Use separate access keys for production app uploads and backups. The backup key should only write to `makaug-db-backups`.

## What To Configure

### 1. Database

- Use managed PostgreSQL for production.
- Keep `DATABASE_URL` in the deployment environment only.
- Enable provider-level automated backups.
- Keep `DB_SSL=true` if the database provider requires SSL.

### 2. Media Storage

- Set `MEDIA_STORAGE_PROVIDER=s3`.
- Set the `S3_*` variables above.
- Use a public custom domain only for media that is allowed to be public.
- Keep ID documents, WhatsApp evidence, and admin exports private.

### 3. Nightly Backups

Run:

```bash
npm run data:backup
```

The script creates:

- A custom-format Postgres dump.
- A tar archive of important local folders.
- A JSON manifest showing uploaded object keys, byte sizes, and SHA-256 hashes.

Schedule it nightly after low-traffic hours. On Render, create a cron job using the same environment variables as production plus `PG_DUMP_BIN` if `pg_dump` is not on the default path.

### 4. AI Learning Exports

Set `AI_EXPORT_BUCKET` and `AI_EXPORT_PREFIX` so `npm run ai:export-foundation` uploads JSONL and CSV training exports to private R2/S3 storage. Keep `REQUIRE_CLOUD_AI_EXPORTS=true` in production so an export fails instead of silently recording only a Render disk path.

Run:

```bash
npm run ai:export-foundation -- --site=makaug-web
```

The latest export in `/api/ai-core/stats` should show an `s3://...` `output_path`, not `/opt/render/...`.

### 5. Cloud Storage Proof

Run:

```bash
npm run cloud:verify-storage
```

This writes tiny canary objects to the media bucket and backup bucket. In the admin setup dashboard, the `backups` provider proof button writes the same kind of backup canary and records the cloud reference in audit/log payloads.

### 6. Local Second Copy

If you buy a NAS, use it for a second copy:

- Sync `makaug-db-backups`.
- Sync `makaug-admin-exports`.
- Do not host the live website from the NAS.
- Do not make the NAS the only place where production data lives.

## Restore Drill

Run this monthly:

1. Download the latest `manifest/*.json`.
2. Download the referenced `db/.../makaug-postgres.dump`.
3. Restore into a temporary database:

```bash
createdb makaug_restore_test
pg_restore --clean --if-exists --no-owner --dbname makaug_restore_test makaug-postgres.dump
```

4. Confirm `properties`, `property_images`, `users`, `leads`, `whatsapp_message_logs`, and `ai_events_normalized` have rows.
5. Delete the temporary restore database.

## Operating Rule

The app server should never be the long-term home for uploaded media or backups. If the server is rebuilt, restarted, or moved, makaug should still have:

- PostgreSQL data in managed database backups.
- Uploaded files in R2/S3-compatible buckets.
- Nightly backup manifests proving what was stored.
- Optional NAS copies for extra resilience.
