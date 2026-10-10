#!/usr/bin/env node
'use strict';

/**
 * C7 report (10 Oct 2026): every live or pending listing whose price is
 * outside the plausibility bounds, with the source figures and a proposed
 * reading of the source text. Report only; it never writes. C17 absorbed C7:
 * this is scripts/fix-implausible-prices.js in dry-run mode, and --apply is
 * refused here (that run needs Arthur's approval and goes through the fix
 * script).
 *
 *   node scripts/report-impossible-live-prices.js [--json]
 */

require('dotenv').config();

const { run } = require('./fix-implausible-prices');

if (require.main === module) {
  if (process.argv.includes('--apply')) {
    console.error('This is a report. To change prices, run scripts/fix-implausible-prices.js --apply after approval.');
    process.exit(2);
  }
  const db = require('../config/database');
  run(db, { apply: false, json: process.argv.includes('--json') })
    .then(() => (db.pool ? db.pool.end() : undefined))
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = { run: (db, options = {}) => run(db, { ...options, apply: false }) };
