#!/usr/bin/env node
'use strict';

// Read-only comparison of properties.has_public_media with the pre-flag
// public listing expression (legacyPublicHasPhotoOrVideoSql).
//
// Do not run this against staging or production unless that read has been
// approved. The script refuses to open a connection without --approve-read.
// It then starts one READ ONLY transaction and only runs SELECT.
//
//   node scripts/check-has-public-media-flag.js --approve-read
//
// DATABASE_URL is read from the environment. Nothing is written. The media
// host must be media.makaug.com, which is the host baked into migration 180.

const { Client } = require('pg');

const APPROVED = process.argv.includes('--approve-read');

function fail(message, code = 2) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

if (!APPROVED) {
  fail(
    'Refusing to connect. This check is read-only and is for a later staging or production run, only with approval. Pass --approve-read to continue.'
  );
}

if (!process.env.DATABASE_URL) {
  fail('DATABASE_URL is not set. Pass it in the environment. This script does not load an env file.');
}

const { mediaHost, legacyPublicHasPhotoOrVideoSql } = require('../utils/realListingPhoto');
const { publicLivePropertyStatusSql } = require('../utils/publicInventoryStatus');
const {
  publicLaunchTestListingFastCondition,
  publicVisibleInventoryWhere
} = require('../services/publicInventoryMetricsService');

const host = mediaHost();
if (host !== 'media.makaug.com') {
  fail(
    `S3_PUBLIC_BASE_URL host is ${host}. Migration 180 stored the media.makaug.com rules. Refusing so a different host is not reported as a data mismatch.`
  );
}

const legacy = legacyPublicHasPhotoOrVideoSql('p');
const legacyTrue = `((${legacy}) IS TRUE)`;
const publicRow = `(${publicLivePropertyStatusSql('p')} AND NOT ${publicLaunchTestListingFastCondition('p')})`;
const newPublicWhere = publicVisibleInventoryWhere('p');

// One pass. The legacy expression is the expensive part, so it is not repeated.
const reportSql = `
  WITH judged AS MATERIALIZED (
    SELECT
      p.id::text AS id,
      p.status,
      p.listing_type,
      COALESCE(NULLIF(LOWER(TRIM(p.listing_type)), ''), '(blank)') AS type_key,
      p.has_public_media,
      ${legacyTrue} AS legacy_true,
      ${publicRow} AS public_row,
      (${newPublicWhere}) AS public_where
    FROM properties p
  )
  SELECT
    (SELECT COUNT(*)::int FROM judged) AS rows,
    (SELECT COUNT(*) FILTER (WHERE has_public_media)::int FROM judged) AS flag_true,
    (SELECT COUNT(*) FILTER (WHERE legacy_true)::int FROM judged) AS legacy_true,
    (SELECT COUNT(*) FILTER (WHERE public_row AND has_public_media)::int FROM judged) AS public_flag,
    (SELECT COUNT(*) FILTER (WHERE public_row AND legacy_true)::int FROM judged) AS public_legacy,
    (SELECT COUNT(*) FILTER (WHERE public_where)::int FROM judged) AS public_where_flag,
    (SELECT COUNT(*) FILTER (WHERE has_public_media IS DISTINCT FROM legacy_true)::int FROM judged) AS differing,
    (
      SELECT COALESCE(json_agg(row_to_json(types) ORDER BY types.listing_type), '[]'::json)
        FROM (
          SELECT
            type_key AS listing_type,
            COUNT(*) FILTER (WHERE public_row AND legacy_true)::int AS legacy_count,
            COUNT(*) FILTER (WHERE public_row AND has_public_media)::int AS flag_count
          FROM judged
          GROUP BY type_key
        ) AS types
    ) AS by_type,
    (
      SELECT COALESCE(json_agg(row_to_json(diffs) ORDER BY diffs.id), '[]'::json)
        FROM (
          SELECT id, status, listing_type, has_public_media, legacy_true
            FROM judged
           WHERE has_public_media IS DISTINCT FROM legacy_true
        ) AS diffs
    ) AS differing_ids
`;

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    statement_timeout: 300000
  });
  await client.connect();
  try {
    await client.query('BEGIN TRANSACTION READ ONLY');
    await client.query("SET LOCAL statement_timeout = '300s'");
    const column = await client.query(
      `SELECT 1
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'properties'
          AND column_name = 'has_public_media'`
    );
    if (!column.rows.length) {
      throw new Error('properties.has_public_media is missing. Migration 180 has not been applied.');
    }
    const summary = (await client.query(reportSql)).rows[0];
    const byType = summary.by_type || [];
    const differing = summary.differing_ids || [];
    await client.query('ROLLBACK');

    const lines = [
      'has_public_media check (read only)',
      `rows ${summary.rows}`,
      `flag_true ${summary.flag_true}`,
      `legacy_true ${summary.legacy_true}`,
      `public_flag ${summary.public_flag}`,
      `public_legacy ${summary.public_legacy}`,
      `public_where_flag ${summary.public_where_flag}`,
      `differing ${summary.differing}`
    ];
    for (const row of byType) {
      if (row.legacy_count === 0 && row.flag_count === 0) continue;
      lines.push(`listing_type ${row.listing_type} legacy ${row.legacy_count} flag ${row.flag_count}`);
    }
    for (const row of differing) {
      lines.push(
        `differ ${row.id} status=${row.status} listing_type=${row.listing_type} flag=${row.has_public_media} legacy=${row.legacy_true}`
      );
    }
    process.stdout.write(`${lines.join('\n')}\n`);

    const countsMatch = summary.flag_true === summary.legacy_true
      && summary.public_flag === summary.public_legacy
      && summary.public_where_flag === summary.public_flag
      && summary.differing === 0
      && byType.every((row) => row.legacy_count === row.flag_count);
    return countsMatch ? 0 : 1;
  } finally {
    await client.end().catch(() => {});
    const pool = require('../config/database').pool;
    if (pool && typeof pool.end === 'function') await pool.end().catch(() => {});
  }
}

main().then((code) => {
  process.exit(code);
}).catch((error) => {
  fail(error && error.message ? error.message : String(error));
});
