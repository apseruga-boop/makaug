#!/usr/bin/env node
'use strict';

require('dotenv').config();

const db = require('../config/database');
const { sourcePositiveListingGateForRecord } = require('../utils/sourceContentQuality');

const APPLY_CONFIRMATION = 'reject-reviewed-foreign-and-road-intake';
const PURGE_MARKER = 'foreign-country-gate-purge-20260724';
const INVALID_ROAD_VIDEO_IDS = new Set([
  'f9b35564-8d36-48ed-a3b9-49fbc20cab61',
  '2c181c70-7925-4db0-a560-42cada73e57c',
]);

function isApplyRun() {
  return process.argv.includes('--apply');
}

function isExplicitForeignGate(gate = {}) {
  return gate.reason === 'non_uganda_location'
    && (gate.details || []).some((detail) => /foreign location|outside uganda/i.test(String(detail || '')));
}

async function loadCandidates(client) {
  const result = await client.query(
    `SELECT
       p.id,
       p.title,
       p.description,
       p.listing_type,
       p.property_type,
       p.district,
       p.area,
       p.address,
       p.price,
       p.bedrooms,
       p.latitude,
       p.longitude,
       p.status,
       p.moderation_stage,
       p.source,
       p.listed_via,
       p.lister_name,
       p.lister_phone,
       p.extra_fields
     FROM properties p
     WHERE (
       (
         COALESCE(p.status, '') IN ('pending', 'submitted', 'in_review', 'review', 'draft')
         AND (
           p.source = 'found_online_property_source_v1'
           OR p.listed_via = 'found_online'
         )
       )
       OR p.id = ANY($1::uuid[])
     )
     ORDER BY p.created_at ASC, p.id ASC`,
    [Array.from(INVALID_ROAD_VIDEO_IDS)]
  );
  return result.rows || [];
}

function evaluateCandidate(row = {}) {
  if (INVALID_ROAD_VIDEO_IDS.has(String(row.id))) {
    return {
      reject: true,
      reason: 'not_a_listing',
      details: ['Verified road-construction video, not a property listing.'],
    };
  }
  const gate = sourcePositiveListingGateForRecord(row);
  return {
    reject: isExplicitForeignGate(gate),
    reason: gate.reason || '',
    details: gate.details || [],
  };
}

async function main() {
  const apply = isApplyRun();
  if (apply && process.env.MAKAUG_FOREIGN_PURGE_CONFIRM !== APPLY_CONFIRMATION) {
    throw new Error(`Apply blocked. Set MAKAUG_FOREIGN_PURGE_CONFIRM=${APPLY_CONFIRMATION} for this one-off run.`);
  }

  const client = await db.pool.connect();
  try {
    const rows = await loadCandidates(client);
    const decisions = rows
      .map((row) => ({ row, decision: evaluateCandidate(row) }))
      .filter(({ decision }) => decision.reject);

    const channelAudit = rows
      .filter((row) => /vibes\.?\s+with\.?\s+kayz/i.test(JSON.stringify(row.extra_fields || {})) || /vibes\.?\s+with\.?\s+kayz/i.test(String(row.lister_name || '')))
      .map((row) => ({
        id: row.id,
        title: row.title,
        status: row.status,
        source_url: row.extra_fields?.source_url || null,
        decision: evaluateCandidate(row),
      }));

    if (apply && decisions.length) {
      await client.query('BEGIN');
      for (const { row, decision } of decisions) {
        await client.query(
          `UPDATE properties
           SET status = 'rejected',
               moderation_stage = 'rejected',
               moderation_reason = $2,
               moderation_notes = $3,
               extra_fields = (
                 (COALESCE(extra_fields, '{}'::jsonb) - 'featured' - 'featured_at')
                 || jsonb_build_object(
                   'source_quality_suppressed', true,
                   'source_quality_review', jsonb_build_object(
                     'suppressed', true,
                     'reason', $2::text,
                     'details', $4::jsonb,
                     'reviewed_at', NOW()::text
                   ),
                   'purge_batch', $5::text,
                   'purged_at', NOW()::text
                 )
               ),
               updated_at = NOW()
           WHERE id = $1`,
          [
            row.id,
            decision.reason,
            `${PURGE_MARKER}: ${decision.details.join(' ')}`,
            JSON.stringify(decision.details),
            PURGE_MARKER,
          ]
        );
        await client.query(
          `INSERT INTO property_moderation_events
             (property_id, actor_id, action, status_from, status_to, reason, notes)
           VALUES ($1, $2, 'source_quality_purge_rejected', $3, 'rejected', $4, $5)`,
          [
            row.id,
            'system:foreign-country-gate-purge',
            row.status,
            decision.reason,
            `${PURGE_MARKER}: ${decision.details.join(' ')}`
          ]
        );
      }
      await client.query('COMMIT');
    }

    console.log(JSON.stringify({
      ok: true,
      marker: PURGE_MARKER,
      mode: apply ? 'apply' : 'dry_run',
      scanned: rows.length,
      rejected_count: decisions.length,
      rejected: decisions.map(({ row, decision }) => ({
        id: row.id,
        title: row.title,
        previous_status: row.status,
        reason: decision.reason,
        details: decision.details,
      })),
      source_channel_audit: channelAudit,
    }, null, 2));
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    throw error;
  } finally {
    client.release();
  }
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.pool.end().catch(() => {});
  });
