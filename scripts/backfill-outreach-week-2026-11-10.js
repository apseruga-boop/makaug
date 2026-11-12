#!/usr/bin/env node
'use strict';

/**
 * Post-boot repair: copy this week's already-sent joining films
 * (Europe/London, 10–16 Nov 2026) from audit_logs into agent_prospects.
 *
 * Does not run at boot. Take a backup first. Batches of 20.
 * lock_timeout 3s, statement_timeout 30s. Rollback:
 *   scripts/rollback-outreach-week-2026-11-10.js
 *
 * Usage (after backup):
 *   node scripts/backfill-outreach-week-2026-11-10.js
 *   node scripts/backfill-outreach-week-2026-11-10.js --apply
 */

const fs = require('fs');
const path = require('path');
const db = require('../config/database');
const { prospectPhoneKey, normalizeProspectPhone, maskPhoneLast3 } = require('../services/agentProspectService');

const WEEK_START = '2026-11-10T00:00:00+00:00'; // 00:00 London (GMT)
const WEEK_END = '2026-11-17T00:00:00+00:00';
const BATCH = 20;
const apply = process.argv.includes('--apply');

function details(row) {
  const raw = row.details || row.payload || {};
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

async function main() {
  await db.query("SELECT set_config('lock_timeout', '3s', false), set_config('statement_timeout', '30s', false)");
  const logs = await db.query(
    `SELECT id, actor_id, action, details, created_at
       FROM audit_logs
      WHERE action = 'explainer_video_sent'
        AND created_at >= $1::timestamptz
        AND created_at < $2::timestamptz
      ORDER BY created_at ASC`,
    [WEEK_START, WEEK_END]
  );
  const missing = [];
  for (const row of logs.rows) {
    const info = details(row);
    if (info.employee_pitch !== true && info.kind !== 'agent') continue;
    const phone = info.phone || info.recipient || '';
    const key = prospectPhoneKey(phone);
    if (!key || key.length < 9) continue;
    const exists = await db.query('SELECT id FROM agent_prospects WHERE phone_key = $1 LIMIT 1', [key]);
    if (exists.rows[0]) continue;
    missing.push({
      audit_id: row.id,
      full_name: String(info.name || '').trim() || 'Unnamed prospect',
      phone: normalizeProspectPhone(phone),
      phone_key: key,
      phone_masked: maskPhoneLast3(phone),
      pitched_by: String(info.sent_by || row.actor_id || '').replace(/\D/g, ''),
      pitched_at: row.created_at
    });
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join('/tmp', `outreach-week-backfill-plan-${stamp}.json`);
  fs.writeFileSync(backupPath, JSON.stringify({ week: '2026-11-10/16', count: missing.length, rows: missing }, null, 2));

  console.log(`Found ${logs.rows.length} explainer_video_sent rows this week.`);
  console.log(`${missing.length} are not yet in the outreach tracker.`);
  console.log(`Plan written to ${backupPath} (phones masked in stdout only):`);
  for (const row of missing) {
    console.log(`  ${row.full_name} ${row.phone_masked} at ${row.pitched_at}`);
  }
  if (!missing.length) {
    console.log('Nothing to backfill. If videos were sent outside Agent 007, log them by hand in Outreach.');
    return;
  }
  if (!apply) {
    console.log('Dry run. Re-run with --apply after taking a database backup.');
    return;
  }

  let done = 0;
  for (let i = 0; i < missing.length; i += BATCH) {
    const batch = missing.slice(i, i + BATCH);
    for (const row of batch) {
      await db.query("SELECT set_config('lock_timeout', '3s', true), set_config('statement_timeout', '30s', true)");
      await db.query(
        `INSERT INTO agent_prospects (
            full_name, phone, phone_key, video_kind, pitched_by, pitched_at, logged_manually, metadata
         ) VALUES ($1,$2,$3,'agent',NULLIF($4,''),$5,TRUE,$6::jsonb)
         ON CONFLICT (phone_key) DO NOTHING`,
        [
          row.full_name,
          row.phone,
          row.phone_key,
          row.pitched_by,
          row.pitched_at,
          JSON.stringify({ source: 'backfill_week_2026_11_10', audit_id: row.audit_id })
        ]
      );
      done += 1;
    }
  }
  console.log(`Backfilled ${done} rows. Keep ${backupPath} for rollback.`);
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(() => {
    if (typeof db.close === 'function') db.close();
    if (typeof db.end === 'function') db.end();
    setTimeout(() => process.exit(process.exitCode || 0), 300).unref?.();
  });
