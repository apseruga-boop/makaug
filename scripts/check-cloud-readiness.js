#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PLACEHOLDER_RE = /^(|change-me|change-me-.+|replace-with-.+|owner@example\.com)$/i;

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const rows = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const row of rows) {
    const line = row.trim();
    if (!line || line.startsWith('#')) continue;

    const match = line.replace(/^export\s+/, '').match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;

    let parsedValue = rawValue.trim();
    const quote = parsedValue[0];
    if ((quote === '"' || quote === "'") && parsedValue.endsWith(quote)) {
      parsedValue = parsedValue.slice(1, -1);
    }
    process.env[key] = parsedValue;
  }
}

loadEnvFile(path.join(ROOT, '.env'));
loadEnvFile(path.join(ROOT, '.env.local'));

function value(name) {
  return String(process.env[name] || '').trim();
}

function isSet(name) {
  return Boolean(value(name)) && !PLACEHOLDER_RE.test(value(name));
}

function isTruthy(name) {
  return ['1', 'true', 'yes', 'on'].includes(value(name).toLowerCase());
}

function publicStatus(name) {
  const raw = value(name);
  if (!raw) return 'missing';
  if (PLACEHOLDER_RE.test(raw)) return 'placeholder';
  return 'set';
}

const checks = [];

function add(area, status, message, details = {}) {
  checks.push({ area, status, message, details });
}

function requireNames(area, names) {
  const missing = names.filter((name) => !isSet(name));
  if (missing.length) {
    add(area, 'blocker', `Missing required environment variables: ${missing.join(', ')}`, {
      missing
    });
    return false;
  }
  return true;
}

function validateUrl(area, name) {
  if (!isSet(name)) return false;
  try {
    const parsed = new URL(value(name));
    if (!/^https?:$/.test(parsed.protocol) || !parsed.host) {
      throw new Error('invalid protocol or host');
    }
    return true;
  } catch {
    add(area, 'blocker', `${name} must be a full URL, for example https://<account-id>.r2.cloudflarestorage.com`, {
      current_status: publicStatus(name)
    });
    return false;
  }
}

function warnIfPlaceholder(area, names) {
  const placeholders = names.filter((name) => publicStatus(name) === 'placeholder');
  if (placeholders.length) {
    add(area, 'warning', `Replace placeholder secrets before production: ${placeholders.join(', ')}`, {
      placeholders
    });
  }
}

function checkDatabase() {
  if (!requireNames('database', ['DATABASE_URL'])) return;
  const databaseUrl = value('DATABASE_URL');
  const isLocal = /localhost|127\.0\.0\.1/i.test(databaseUrl);
  const ssl = value('DB_SSL').toLowerCase();
  if (!isLocal && ssl !== 'true') {
    add('database', 'warning', 'DB_SSL should be true for managed cloud Postgres unless the provider explicitly requires otherwise.');
  } else {
    add('database', 'ok', 'DATABASE_URL is configured.');
  }
}

function checkMediaStorage() {
  const provider = value('MEDIA_STORAGE_PROVIDER') || 'local';
  if (provider !== 's3') {
    add('media_storage', 'blocker', 'MEDIA_STORAGE_PROVIDER must be s3 for durable cloud media storage.', {
      current: provider
    });
    return;
  }
  if (requireNames('media_storage', ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'])) {
    if (validateUrl('media_storage', 'S3_ENDPOINT')) {
      add('media_storage', 'ok', 'S3-compatible media storage is configured.');
    }
  }
  if (!isSet('S3_PUBLIC_BASE_URL')) {
    add('media_storage', 'warning', 'S3_PUBLIC_BASE_URL is not set. Public listing images may need signed/proxied URLs instead of direct CDN URLs.');
  }
}

function checkBackups() {
  const hasBackupScript = fs.existsSync(path.join(ROOT, 'scripts', 'run-production-data-backup.js'));
  if (!hasBackupScript) {
    add('backups', 'blocker', 'Production backup script is missing.');
    return;
  }
  if (requireNames('backups', ['DATA_BACKUP_BUCKET', 'DATA_BACKUP_PREFIX', 'DATA_BACKUP_LOCAL_PATHS', 'S3_ENDPOINT', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'])) {
    if (validateUrl('backups', 'S3_ENDPOINT')) {
      add('backups', 'ok', 'Production backup target is configured.');
    }
  }
  if (value('DATA_BACKUP_BUCKET') && value('S3_BUCKET') && value('DATA_BACKUP_BUCKET') === value('S3_BUCKET')) {
    add('backups', 'warning', 'Use a separate private bucket for backups instead of the public media bucket.');
  }
}

function checkWhatsapp() {
  const mode = value('WHATSAPP_DELIVERY_MODE') || 'auto';
  const usesBridge = mode === 'web_bridge' || (mode === 'auto' && isTruthy('WHATSAPP_WEB_BRIDGE_ENABLED'));
  const usesProvider = mode === 'provider' || mode === 'auto';

  if (usesBridge) {
    const required = [
      'WHATSAPP_WEB_BRIDGE_TOKEN',
      'WHATSAPP_WEB_COPILOT_BASE_URL',
      'WHATSAPP_WEB_COPILOT_CLIENT_ID'
    ];
    if (requireNames('whatsapp', required)) {
      add('whatsapp', 'ok', 'WhatsApp Web bridge configuration is present.');
    }
    if (!isTruthy('WHATSAPP_WEB_BRIDGE_ENABLED') && mode === 'web_bridge') {
      add('whatsapp', 'blocker', 'WHATSAPP_WEB_BRIDGE_ENABLED must be true when WHATSAPP_DELIVERY_MODE=web_bridge.');
    }
  }

  if (usesProvider && mode === 'provider') {
    requireNames('whatsapp', ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_VERIFY_TOKEN']);
  }

  if (!usesBridge && mode !== 'provider') {
    add('whatsapp', 'warning', 'No explicit WhatsApp delivery path is enabled. Use web_bridge now, then provider when Meta Cloud API is ready.');
  }
}

function checkLlm() {
  const provider = value('LLM_PROVIDER') || 'none';
  if (provider === 'none') {
    add('llm', 'warning', 'LLM_PROVIDER is none or missing. The chatbot will rely on deterministic fallback logic only.');
    return;
  }

  if (provider === 'openai_compat' && !isSet('LLM_API_BASE_URL')) {
    add('llm', 'blocker', 'LLM_API_BASE_URL is required for openai_compat providers.');
  }

  const hasKey = isSet('LLM_API_KEY') || isSet('OPENAI_API_KEY');
  if (!hasKey && !isTruthy('LLM_NO_AUTH')) {
    add('llm', 'blocker', 'Set LLM_API_KEY/OPENAI_API_KEY, or set LLM_NO_AUTH=true only for a private trusted model endpoint.');
  } else {
    add('llm', 'ok', `LLM provider is configured as ${provider}.`);
  }

  if (!isSet('AI_MODEL_VERSION')) {
    add('llm', 'warning', 'AI_MODEL_VERSION is not set; set it so learning exports can be tied to model versions.');
  }
}

function checkSecurity() {
  warnIfPlaceholder('security', ['JWT_SECRET', 'ADMIN_API_KEY', 'SUPER_ADMIN_KEY', 'WHATSAPP_WEB_BRIDGE_TOKEN']);
  requireNames('security', ['JWT_SECRET', 'ADMIN_API_KEY', 'SUPER_ADMIN_KEY']);

  const publicBaseUrl = value('PUBLIC_BASE_URL');
  if (!/^https:\/\//i.test(publicBaseUrl)) {
    add('security', 'warning', 'PUBLIC_BASE_URL should be an HTTPS URL in production.');
  }

  const cors = value('CORS_ORIGINS');
  if (cors.includes('*')) {
    add('security', 'blocker', 'CORS_ORIGINS must not use wildcard origins in production.');
  }
}

function checkAiDataExports() {
  const requiredFiles = [
    'scripts/export-ai-training-data.js',
    'scripts/export-llm-foundation-data.js'
  ];
  const missing = requiredFiles.filter((file) => !fs.existsSync(path.join(ROOT, file)));
  if (missing.length) {
    add('ai_learning_storage', 'blocker', `Missing AI export scripts: ${missing.join(', ')}`);
  } else {
    add('ai_learning_storage', 'ok', 'AI learning export scripts are present.');
  }
  if (isTruthy('REQUIRE_CLOUD_AI_EXPORTS')) {
    const hasExportBucket = isSet('AI_EXPORT_BUCKET') || isSet('DATA_BACKUP_BUCKET') || isSet('S3_BUCKET');
    if (!hasExportBucket) {
      add('ai_learning_storage', 'blocker', 'Missing AI export bucket. Set AI_EXPORT_BUCKET, DATA_BACKUP_BUCKET, or S3_BUCKET.', {
        missing: ['AI_EXPORT_BUCKET']
      });
    }
    if (hasExportBucket && requireNames('ai_learning_storage', ['AI_EXPORT_PREFIX', 'S3_ENDPOINT', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'])) {
      add('ai_learning_storage', 'ok', 'AI learning exports are configured to write to S3/R2.');
    }
  } else {
    add('ai_learning_storage', 'warning', 'REQUIRE_CLOUD_AI_EXPORTS is not enabled; AI exports can fall back to Render disk paths.');
  }
}

checkDatabase();
checkMediaStorage();
checkBackups();
checkWhatsapp();
checkLlm();
checkSecurity();
checkAiDataExports();

const blockers = checks.filter((check) => check.status === 'blocker');
const warnings = checks.filter((check) => check.status === 'warning');
const summary = {
  ok: blockers.length === 0,
  blockers: blockers.length,
  warnings: warnings.length,
  checks
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(`Cloud readiness: ${summary.ok ? 'PASS' : 'BLOCKED'} (${blockers.length} blockers, ${warnings.length} warnings)`);
  for (const check of checks) {
    const label = check.status.toUpperCase().padEnd(7);
    console.log(`${label} ${check.area}: ${check.message}`);
  }
}

process.exit(summary.ok ? 0 : 1);
