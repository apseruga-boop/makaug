#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const row of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = row.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.replace(/^export\s+/, '').match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    let parsed = rawValue.trim();
    const quote = parsed[0];
    if ((quote === '"' || quote === "'") && parsed.endsWith(quote)) parsed = parsed.slice(1, -1);
    process.env[key] = parsed;
  }
}

loadEnvFile(path.join(ROOT, '.env'));
loadEnvFile(path.join(ROOT, '.env.local'));

const { normalizeObjectKey, uploadBufferToS3 } = require('../services/s3ObjectStorageService');

function value(name) {
  return String(process.env[name] || '').trim();
}

function requireEnv(names) {
  const missing = names.filter((name) => !value(name));
  if (missing.length) {
    const error = new Error(`Missing required environment variables: ${missing.join(', ')}`);
    error.missing = missing;
    throw error;
  }
}

async function main() {
  const provider = value('MEDIA_STORAGE_PROVIDER') || 'local';
  if (provider !== 's3') {
    throw new Error(`MEDIA_STORAGE_PROVIDER must be s3 before cloud storage can be verified. Current value: ${provider}`);
  }

  requireEnv([
    'S3_ENDPOINT',
    'S3_BUCKET',
    'S3_ACCESS_KEY_ID',
    'S3_SECRET_ACCESS_KEY',
    'DATA_BACKUP_BUCKET',
    'DATA_BACKUP_PREFIX',
    'DATA_BACKUP_LOCAL_PATHS'
  ]);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const mediaKey = `cloud-proof/media/${stamp}-canary.txt`;
  const backupKey = `${normalizeObjectKey(value('DATA_BACKUP_PREFIX'))}/canary/${stamp}-backup-canary.json`;
  const mediaPayload = Buffer.from(`makaug cloud media canary ${stamp}\n`, 'utf8');
  const backupPayload = Buffer.from(`${JSON.stringify({
    app: 'makaug',
    kind: 'backup_canary',
    created_at: new Date().toISOString(),
    data_backup_local_paths: value('DATA_BACKUP_LOCAL_PATHS')
  }, null, 2)}\n`, 'utf8');

  const media = await uploadBufferToS3({
    bucket: value('S3_BUCKET'),
    key: mediaKey,
    bytes: mediaPayload,
    mimeType: 'text/plain; charset=utf-8',
    isPrivate: false
  });
  const backup = await uploadBufferToS3({
    bucket: value('DATA_BACKUP_BUCKET'),
    key: backupKey,
    bytes: backupPayload,
    mimeType: 'application/json',
    isPrivate: true
  });

  console.log(JSON.stringify({
    ok: true,
    provider: 's3',
    endpoint_host: new URL(value('S3_ENDPOINT')).host,
    media: {
      bucket: media.bucket,
      key: media.key,
      bytes: media.bytes,
      sha256: media.sha256,
      public_url: media.publicUrl
    },
    backups: {
      bucket: backup.bucket,
      key: backup.key,
      bytes: backup.bytes,
      sha256: backup.sha256
    }
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error.message || String(error),
    missing: error.missing || undefined
  }, null, 2));
  process.exit(1);
});
