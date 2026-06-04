#!/usr/bin/env node

require('dotenv').config();

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SERVICE = 's3';

function required(name, fallback) {
  const value = process.env[name] || fallback;
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function optionalBool(name, fallback = false) {
  const value = process.env[name];
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function stamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
}

function amzDateParts(now = new Date()) {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { dateStamp: iso.slice(0, 8), amzDate: iso };
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hmac(key, value) {
  return crypto.createHmac('sha256', key).update(value).digest();
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function encodePathSegment(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function normalizeKey(value) {
  return String(value || '')
    .replace(/^\/+/, '')
    .replace(/\/{2,}/g, '/');
}

function canonicalUri(endpoint, bucket, key) {
  const prefix = endpoint.pathname && endpoint.pathname !== '/' ? endpoint.pathname.replace(/\/+$/, '') : '';
  return `${prefix}/${encodePathSegment(bucket)}/${normalizeKey(key).split('/').map(encodePathSegment).join('/')}`;
}

function signingKey(secret, dateStamp, region) {
  const dateKey = hmac(`AWS4${secret}`, dateStamp);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, SERVICE);
  return hmac(serviceKey, 'aws4_request');
}

function canonicalHeaders(headers) {
  const entries = Object.entries(headers)
    .map(([name, value]) => [name.toLowerCase(), String(value).trim().replace(/\s+/g, ' ')])
    .sort(([a], [b]) => a.localeCompare(b));
  return {
    text: entries.map(([name, value]) => `${name}:${value}\n`).join(''),
    names: entries.map(([name]) => name).join(';')
  };
}

async function uploadFile({ filePath, key, contentType }) {
  const endpoint = new URL(required('S3_ENDPOINT'));
  const region = process.env.S3_REGION || 'auto';
  const bucket = required('DATA_BACKUP_BUCKET', process.env.S3_BUCKET);
  const accessKey = required('S3_ACCESS_KEY_ID');
  const secret = required('S3_SECRET_ACCESS_KEY');
  const payloadHash = await hashFile(filePath);
  const stat = fs.statSync(filePath);
  const { dateStamp, amzDate } = amzDateParts();
  const uri = canonicalUri(endpoint, bucket, key);
  const uploadUrl = `${endpoint.origin}${uri}`;
  const headers = {
    host: endpoint.host,
    'content-length': String(stat.size),
    'content-type': contentType,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate
  };
  const canonical = canonicalHeaders(headers);
  const canonicalRequest = ['PUT', uri, '', canonical.text, canonical.names, payloadHash].join('\n');
  const credentialScope = `${dateStamp}/${region}/${SERVICE}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256Hex(canonicalRequest)].join('\n');
  const signature = crypto.createHmac('sha256', signingKey(secret, dateStamp, region)).update(stringToSign).digest('hex');

  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Length': String(stat.size),
      'Content-Type': contentType,
      'X-Amz-Content-Sha256': payloadHash,
      'X-Amz-Date': amzDate,
      Authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${canonical.names}, Signature=${signature}`
    },
    body: fs.createReadStream(filePath),
    duplex: 'half'
  });

  if (!response.ok) {
    throw new Error(`Upload failed for ${key}: ${response.status} ${await response.text()}`);
  }

  return { key, bytes: stat.size, sha256: payloadHash };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
}

function localArchivePaths() {
  const raw = (process.env.DATA_BACKUP_LOCAL_PATHS || 'exports,reports,outputs,assets/sourced,assets/marketing')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const paths = [];
  for (const item of raw) {
    const resolved = path.resolve(ROOT, item);
    if (!resolved.startsWith(ROOT)) continue;
    if (!fs.existsSync(resolved)) continue;
    paths.push(path.relative(ROOT, resolved));
  }
  return paths;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

  const backupId = stamp();
  const prefix = normalizeKey(process.env.DATA_BACKUP_PREFIX || 'makaug');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `makaug-backup-${backupId}-`));
  const uploaded = [];
  const manifest = {
    backup_id: backupId,
    created_at: new Date().toISOString(),
    app: 'makaug',
    database_dump: null,
    local_archive: null,
    local_archive_paths: [],
    uploaded: []
  };

  try {
    const dbDumpPath = path.join(tmpDir, `makaug-postgres-${backupId}.dump`);
    const pgDumpBin = process.env.PG_DUMP_BIN || 'pg_dump';
    run(pgDumpBin, [
      '--format=custom',
      '--no-owner',
      '--no-privileges',
      '--file',
      dbDumpPath,
      process.env.DATABASE_URL
    ]);
    manifest.database_dump = await uploadFile({
      filePath: dbDumpPath,
      key: `${prefix}/db/${backupId}/makaug-postgres.dump`,
      contentType: 'application/octet-stream'
    });
    uploaded.push(manifest.database_dump);

    const archivePaths = localArchivePaths();
    manifest.local_archive_paths = archivePaths;
    if (archivePaths.length) {
      const archivePath = path.join(tmpDir, `makaug-local-data-${backupId}.tgz`);
      run('tar', ['-czf', archivePath, ...archivePaths], { cwd: ROOT });
      manifest.local_archive = await uploadFile({
        filePath: archivePath,
        key: `${prefix}/local/${backupId}/makaug-local-data.tgz`,
        contentType: 'application/gzip'
      });
      uploaded.push(manifest.local_archive);
    }

    manifest.uploaded = uploaded;
    const manifestPath = path.join(tmpDir, `manifest-${backupId}.json`);
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const manifestUpload = await uploadFile({
      filePath: manifestPath,
      key: `${prefix}/manifest/${backupId}.json`,
      contentType: 'application/json'
    });

    console.log(JSON.stringify({ ok: true, backup_id: backupId, uploaded: [...uploaded, manifestUpload] }, null, 2));
  } finally {
    if (optionalBool('DATA_BACKUP_KEEP_LOCAL', false)) {
      console.log(`Backup workspace kept at ${tmpDir}`);
    } else {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
