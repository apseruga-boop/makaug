#!/usr/bin/env node
'use strict';

require('dotenv').config();

const { assertPilotCanRun, buildPilotPlan } = require('../services/southAfricaScalePilotService');

const args = process.argv.slice(2);
const confirm = args.includes('--confirm');
const dryRun = args.includes('--dry-run') || !confirm;

if (String(process.env.COUNTRY_CODE || '').trim().toUpperCase() !== 'ZA') {
  console.error('This pilot runner is South Africa only. COUNTRY_CODE must be ZA.');
  process.exit(2);
}

const plan = buildPilotPlan(process.env);
if (dryRun) {
  console.log(JSON.stringify({ ...plan, selected_queries: plan.selected_queries.slice(0, 20), selected_queries_truncated: true }, null, 2));
  process.exit(0);
}

try {
  assertPilotCanRun(process.env);
  throw Object.assign(new Error('Access gates passed, but network execution remains intentionally disabled until Dave passes PR #195 staging and authorises the pilot wave.'), {
    code: 'ZA_SCALE_PILOT_DAVE_PASS_REQUIRED',
  });
} catch (error) {
  console.error(JSON.stringify({ ok: false, code: error.code || 'ZA_SCALE_PILOT_BLOCKED', error: error.message, plan: error.plan || plan }, null, 2));
  process.exit(1);
}
