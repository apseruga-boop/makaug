'use strict';

const { normalizeSourceUrl, uniqueNormalizedSourceUrls } = require('../utils/sourceUrlNormalization');

let ensuredSuppressedSourcesTable = false;

async function ensureSuppressedSourcesTable(executor) {
  if (ensuredSuppressedSourcesTable) return;
  await executor.query(`
    CREATE TABLE IF NOT EXISTS suppressed_sources (
      id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text))::uuid,
      source_url TEXT NOT NULL,
      reason TEXT NOT NULL,
      rejected_property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    )
  `);
  await executor.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_suppressed_sources_source_url_unique
    ON suppressed_sources (source_url)
  `);
  await executor.query(`
    CREATE INDEX IF NOT EXISTS idx_suppressed_sources_reason_created
    ON suppressed_sources (reason, created_at DESC)
  `);
  await executor.query(`
    CREATE INDEX IF NOT EXISTS idx_suppressed_sources_rejected_property
    ON suppressed_sources (rejected_property_id)
  `);
  ensuredSuppressedSourcesTable = true;
}

async function suppressedSourceRowsForUrls(executor, urls = []) {
  const normalized = uniqueNormalizedSourceUrls(urls);
  if (!normalized.length) return new Map();
  await ensureSuppressedSourcesTable(executor);
  const result = await executor.query(
    `SELECT source_url, reason, rejected_property_id::text AS rejected_property_id, created_at
     FROM suppressed_sources
     WHERE source_url = ANY($1::text[])`,
    [normalized]
  );
  return new Map(result.rows.map((row) => [row.source_url, row]));
}

async function upsertSuppressedSourceRows(executor, rows = []) {
  await ensureSuppressedSourcesTable(executor);
  let inserted = 0;
  for (const row of rows) {
    const sourceUrl = normalizeSourceUrl(row.source_url);
    if (!sourceUrl) continue;
    await executor.query(
      `INSERT INTO suppressed_sources (
         source_url, reason, rejected_property_id, created_by, metadata
       ) VALUES ($1, $2, $3::uuid, $4::uuid, $5::jsonb)
       ON CONFLICT (source_url) DO UPDATE
       SET reason = EXCLUDED.reason,
           rejected_property_id = COALESCE(suppressed_sources.rejected_property_id, EXCLUDED.rejected_property_id),
           created_by = COALESCE(suppressed_sources.created_by, EXCLUDED.created_by),
           metadata = COALESCE(suppressed_sources.metadata, '{}'::jsonb) || EXCLUDED.metadata`,
      [
        sourceUrl,
        row.reason || 'rejected_source',
        row.rejected_property_id || null,
        row.created_by || null,
        JSON.stringify(row.metadata && typeof row.metadata === 'object' ? row.metadata : {}),
      ]
    );
    inserted += 1;
  }
  return inserted;
}

module.exports = {
  ensureSuppressedSourcesTable,
  normalizeSourceUrl,
  suppressedSourceRowsForUrls,
  uniqueNormalizedSourceUrls,
  upsertSuppressedSourceRows,
};
