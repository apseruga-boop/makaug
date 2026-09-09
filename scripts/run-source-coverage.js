#!/usr/bin/env node
'use strict';

require('dotenv').config();

const db = require('../config/database');
const {
  createSourceCoverageRun,
  getSourceCoverageRun,
  listSourceCoverageRuns,
  processYouTubeCoverageBatch,
  requeueFalsePositiveSafetyBlocks,
} = require('../services/sourceCoverageService');

function argValue(name, fallback = '') {
  const prefix = `${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function usage() {
  console.log([
    'Exhaustive review-only source coverage',
    '',
    'Create/reuse a durable manifest:',
    '  node scripts/run-source-coverage.js --create --platforms=tiktok,youtube --lookback-days=30 --confirm',
    '',
    'Process one safe YouTube batch:',
    '  node scripts/run-source-coverage.js --run-id=<uuid> --platform=youtube --batch-size=5 --confirm',
    '  node scripts/run-source-coverage.js --latest --platform=youtube --batch-size=5 --confirm',
    '',
    'Inspect the newest runs:',
    '  node scripts/run-source-coverage.js --status',
    '',
    'Repair safety blocks caused only by pre-existing live duplicates:',
    '  node scripts/run-source-coverage.js --run-id=<uuid> --repair-safety-blocks --confirm',
    '',
    'TikTok public pages remain an assisted workflow in the staff dashboard unless an approved data-source adapter is configured.',
    'Every imported candidate remains pending for human review; this command never approves or publishes.',
  ].join('\n'));
}

async function main() {
  if (hasFlag('--help')) {
    usage();
    return;
  }
  if (hasFlag('--status')) {
    console.log(JSON.stringify({ ok: true, runs: await listSourceCoverageRuns(db, { limit: 10 }) }, null, 2));
    return;
  }
  if (hasFlag('--create')) {
    if (!hasFlag('--confirm')) throw new Error('Add --confirm to create the durable coverage manifest.');
    const run = await createSourceCoverageRun({
      db,
      platforms: argValue('--platforms', 'tiktok,youtube'),
      lookbackDays: argValue('--lookback-days', '30'),
      sectionSize: argValue('--section-size', '500'),
      createdBy: 'render_cli',
    });
    console.log(JSON.stringify({ ok: true, run }, null, 2));
    return;
  }
  let runId = argValue('--run-id');
  if (!runId && hasFlag('--latest')) {
    const runs = await listSourceCoverageRuns(db, { limit: 10, platform: argValue('--platform', 'youtube') });
    runId = runs.find((run) => ['queued', 'running', 'paused'].includes(run.status))?.id || '';
  }
  if (!runId) {
    usage();
    throw new Error('--run-id or an active --latest run is required unless --create or --status is used.');
  }
  if (hasFlag('--repair-safety-blocks')) {
    if (!hasFlag('--confirm')) throw new Error('Add --confirm to requeue verified false-positive safety blocks.');
    console.log(JSON.stringify({ ok: true, ...(await requeueFalsePositiveSafetyBlocks(db, runId)) }, null, 2));
    return;
  }
  if (!hasFlag('--confirm')) {
    console.log(JSON.stringify({ ok: true, dry_run: true, run: await getSourceCoverageRun(db, runId) }, null, 2));
    return;
  }
  const platform = argValue('--platform', 'youtube').toLowerCase();
  if (platform !== 'youtube') throw new Error('Automated batches currently support YouTube. Use the staff dashboard for assisted TikTok coverage.');
  const result = await processYouTubeCoverageBatch({
    db,
    runId,
    batchSize: argValue('--batch-size', '5'),
    lookbackDays: argValue('--lookback-days', '30'),
    dryRun: false,
  });
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.pool.end().catch(() => {});
  });
