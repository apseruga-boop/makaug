require('dotenv').config();

const db = require('../config/database');
const logger = require('../config/logger');
const { runFoundationExport } = require('../services/aiFoundationExportService');

function parseArgs(argv) {
  const args = {};
  for (const raw of argv) {
    if (!raw.startsWith('--')) continue;
    const eq = raw.indexOf('=');
    if (eq === -1) {
      args[raw.slice(2)] = 'true';
      continue;
    }
    const key = raw.slice(2, eq);
    const value = raw.slice(eq + 1);
    args[key] = value;
  }
  return args;
}

function toInt(value, fallback) {
  const n = parseInt(String(value || ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

function toFloat(value, fallback) {
  const n = parseFloat(String(value || ''));
  return Number.isFinite(n) ? n : fallback;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));

  const result = await runFoundationExport({
    tenantCode: args.tenant || null,
    siteCode: args.site || null,
    days: toInt(args.days, 30),
    minConfidence: toFloat(args.minConfidence, 0.55),
    limit: toInt(args.limit, 20000),
    createdBy: args.createdBy || 'cli_export',
    format: args.format || 'jsonl'
  });

  logger.info('LLM foundation export completed');
  logger.info(`Run ID: ${result.runId}`);
  logger.info(`Tenant/site: ${result.tenantCode}/${result.siteCode}`);
  logger.info(`Samples: ${result.totalExported}`);
  logger.info(`JSONL: ${result.jsonlPath}`);
  logger.info(`CSV: ${result.csvPath}`);

  await db.pool.end();
}

run().catch(async (error) => {
  logger.error('LLM foundation export failed', error);
  try {
    await db.pool.end();
  } catch (_error) {
    // ignore
  }
  process.exit(1);
});
