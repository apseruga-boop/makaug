#!/usr/bin/env node
'use strict';

require('dotenv').config();

const {
  iterateSouthAfricaRegistryRows,
  summarizeSouthAfricaScaleCorpus,
} = require('../services/southAfricaScaleCorpusService');
const { envFlagEnabled } = require('../utils/harvestFeatureFlags');

const args = process.argv.slice(2);
const confirm = args.includes('--confirm');
const includeCorpus = args.includes('--include-corpus');
const BATCH_SIZE = 200;
let db = null;

function serializeRow(row) {
  return {
    ...row,
    first_seen_at: row.first_seen_at?.toISOString?.() || row.first_seen_at,
    last_seen_at: row.last_seen_at?.toISOString?.() || row.last_seen_at,
    last_checked_at: row.last_checked_at?.toISOString?.() || row.last_checked_at,
  };
}

async function upsertBatch(client, rows) {
  if (!rows.length) return 0;
  const result = await client.query(
    `INSERT INTO property_source_registry (
       source_key, source_name, platform, source_type, source_url, handle,
       contact_phone, contact_phone_alt, contact_email, website_url,
       districts, listing_types, languages, hashtags, status, trust_level,
       consent_status, scrape_policy, can_contact_directly, first_seen_at,
       last_seen_at, last_checked_at, notes, metadata
     )
     SELECT seed.source_key, seed.source_name, seed.platform, seed.source_type,
            seed.source_url, seed.handle, seed.contact_phone, seed.contact_phone_alt,
            seed.contact_email, seed.website_url, seed.districts, seed.listing_types,
            seed.languages, seed.hashtags, seed.status, seed.trust_level,
            seed.consent_status, seed.scrape_policy, seed.can_contact_directly,
            seed.first_seen_at, seed.last_seen_at, seed.last_checked_at,
            seed.notes, seed.metadata
     FROM jsonb_to_recordset($1::jsonb) AS seed(
       source_key text, source_name text, platform text, source_type text, source_url text,
       handle text, contact_phone text, contact_phone_alt text, contact_email text,
       website_url text, districts text[], listing_types text[], languages text[],
       hashtags text[], status text, trust_level text, consent_status text,
       scrape_policy text, can_contact_directly boolean, first_seen_at timestamptz,
       last_seen_at timestamptz, last_checked_at timestamptz, notes text, metadata jsonb
     )
     ON CONFLICT (source_key) DO UPDATE SET
       source_name = EXCLUDED.source_name,
       platform = EXCLUDED.platform,
       source_type = EXCLUDED.source_type,
       source_url = EXCLUDED.source_url,
       districts = EXCLUDED.districts,
       listing_types = EXCLUDED.listing_types,
       languages = EXCLUDED.languages,
       status = EXCLUDED.status,
       trust_level = EXCLUDED.trust_level,
       consent_status = EXCLUDED.consent_status,
       scrape_policy = EXCLUDED.scrape_policy,
       notes = EXCLUDED.notes,
       metadata = COALESCE(property_source_registry.metadata, '{}'::jsonb) || EXCLUDED.metadata,
       updated_at = NOW()`,
    [JSON.stringify(rows.map(serializeRow))]
  );
  return result.rowCount;
}

async function run() {
  if (String(process.env.COUNTRY_CODE || '').toUpperCase() !== 'ZA') {
    throw new Error('Refusing the SA registry build without COUNTRY_CODE=ZA.');
  }
  const summary = summarizeSouthAfricaScaleCorpus();
  const iterator = iterateSouthAfricaRegistryRows({ includeCorpus });
  const sample = [];
  let plannedRows = 0;

  if (!confirm) {
    for (const row of iterator) {
      plannedRows += 1;
      if (sample.length < 8) sample.push(serializeRow(row));
    }
    process.stdout.write(`${JSON.stringify({
      ok: true,
      dry_run: true,
      include_corpus: includeCorpus,
      planned_registry_rows: plannedRows,
      summary,
      sample,
      next_step: 'Use --confirm with ZA_SCALE_REGISTRY_WRITE_ENABLED=true after review. This does not start harvesting.',
    }, null, 2)}\n`);
    return;
  }

  if (!envFlagEnabled(process.env.ZA_SCALE_REGISTRY_WRITE_ENABLED)) {
    throw new Error('Registry writes are disabled. Set ZA_SCALE_REGISTRY_WRITE_ENABLED=true only after reviewing the dry run.');
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for --confirm.');

  db = require('../config/database');
  const client = await db.pool.connect();
  let writtenRows = 0;
  let batch = [];
  try {
    await client.query('BEGIN');
    for (const row of iterator) {
      plannedRows += 1;
      batch.push(row);
      if (batch.length < BATCH_SIZE) continue;
      writtenRows += await upsertBatch(client, batch);
      batch = [];
    }
    writtenRows += await upsertBatch(client, batch);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  process.stdout.write(`${JSON.stringify({
    ok: true,
    dry_run: false,
    include_corpus: includeCorpus,
    planned_registry_rows: plannedRows,
    written_registry_rows: writtenRows,
    auto_publish: false,
    harvest_started: false,
    summary,
  })}\n`);
}

run().catch(async (error) => {
  console.error(error.message);
  try { await db?.pool?.end(); } catch (_) {}
  process.exitCode = 1;
}).finally(async () => {
  if (confirm) {
    try { await db?.pool?.end(); } catch (_) {}
  }
});
