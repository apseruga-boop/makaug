const fs = require('fs');
const path = require('path');

const db = require('../config/database');

function cleanText(value, max = 4000) {
  return String(value == null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function toJsonLine(value) {
  return JSON.stringify(value).replace(/\u2028|\u2029/g, '');
}

function csvEscape(value) {
  const text = String(value == null ? '' : value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function isoStamp() {
  const now = new Date();
  return `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}-${String(now.getUTCHours()).padStart(2, '0')}${String(now.getUTCMinutes()).padStart(2, '0')}${String(now.getUTCSeconds()).padStart(2, '0')}`;
}

async function findTenantSite({ tenantCode, siteCode }) {
  const params = [];
  const where = [`t.status = 'active'`, `s.status = 'active'`];

  if (tenantCode) {
    params.push(tenantCode);
    where.push(`t.code = $${params.length}`);
  }
  if (siteCode) {
    params.push(siteCode);
    where.push(`s.code = $${params.length}`);
  }

  const sql = `
    SELECT
      t.id AS tenant_id,
      t.code AS tenant_code,
      t.name AS tenant_name,
      s.id AS site_id,
      s.code AS site_code,
      s.name AS site_name
    FROM ai_tenants t
    JOIN ai_sites s ON s.tenant_id = t.id
    WHERE ${where.join(' AND ')}
    ORDER BY t.code, s.code
    LIMIT 1
  `;

  const { rows } = await db.query(sql, params);
  return rows[0] || null;
}

function buildTrainingSample(row) {
  const input = cleanText(row.input_text, 3000);
  const response = cleanText(row.response_text, 3000);
  if (!input || !response) return null;

  return {
    messages: [
      {
        role: 'system',
        content:
          'You are MakaUg multilingual property assistant. Respond with accurate Uganda property guidance and include useful MakaUg links when relevant.'
      },
      {
        role: 'user',
        content: input
      },
      {
        role: 'assistant',
        content: response
      }
    ],
    metadata: {
      normalized_event_id: row.normalized_event_id,
      raw_event_id: row.raw_event_id,
      tenant_code: row.tenant_code,
      site_code: row.site_code,
      language: row.language || 'en',
      intent: row.intent || 'unknown',
      intent_confidence: row.intent_confidence == null ? null : Number(row.intent_confidence),
      event_type: row.event_type,
      source: row.source || 'unknown',
      outcome: row.outcome || null,
      label: row.label || null,
      user_rating: row.user_rating == null ? null : Number(row.user_rating),
      event_ts: row.event_ts instanceof Date ? row.event_ts.toISOString() : String(row.event_ts || '')
    }
  };
}

async function runFoundationExport({
  tenantCode = null,
  siteCode = null,
  days = 30,
  minConfidence = 0.55,
  limit = 20000,
  createdBy = 'api',
  format = 'jsonl'
}) {
  const tenantSite = await findTenantSite({
    tenantCode: cleanText(tenantCode, 80) || null,
    siteCode: cleanText(siteCode, 80) || null
  });

  if (!tenantSite) {
    throw new Error('No active tenant/site found for provided filters');
  }

  const { rows: runRows } = await db.query(
    `
      INSERT INTO ai_export_runs (
        tenant_id, site_id, format, days, min_confidence, created_by, status
      )
      VALUES ($1,$2,$3,$4,$5,$6,'started')
      RETURNING id, created_at
    `,
    [
      tenantSite.tenant_id,
      tenantSite.site_id,
      cleanText(format, 20) || 'jsonl',
      Math.max(1, Number(days) || 30),
      Number(minConfidence) || 0,
      cleanText(createdBy, 120) || 'api'
    ]
  );

  const runId = runRows[0].id;

  try {
    const { rows } = await db.query(
      `
        SELECT
          n.id AS normalized_event_id,
          n.raw_event_id,
          n.event_ts,
          n.event_type,
          n.intent,
          n.intent_confidence,
          n.language,
          n.input_text,
          n.response_text,
          n.entities,
          n.attributes,
          n.outcome,
          n.label,
          r.source,
          t.code AS tenant_code,
          s.code AS site_code,
          (
            SELECT l.rating
            FROM ai_event_labels l
            WHERE l.normalized_event_id = n.id
            ORDER BY l.created_at DESC
            LIMIT 1
          ) AS user_rating
        FROM ai_events_normalized n
        JOIN ai_events_raw r ON r.id = n.raw_event_id
        JOIN ai_tenants t ON t.id = n.tenant_id
        JOIN ai_sites s ON s.id = n.site_id
        WHERE n.tenant_id = $1
          AND n.site_id = $2
          AND n.event_ts >= NOW() - ($3::text || ' days')::interval
          AND n.is_training_candidate = TRUE
          AND (n.intent_confidence IS NULL OR n.intent_confidence >= $4)
        ORDER BY n.event_ts DESC
        LIMIT $5
      `,
      [
        tenantSite.tenant_id,
        tenantSite.site_id,
        String(Math.max(1, Number(days) || 30)),
        Number(minConfidence) || 0,
        Math.max(1, Number(limit) || 20000)
      ]
    );

    const exportDir = path.join(__dirname, '..', 'exports', 'llm-foundation');
    ensureDir(exportDir);

    const stamp = isoStamp();
    const baseName = `makaug-llm-${tenantSite.site_code}-${stamp}`;
    const jsonlPath = path.join(exportDir, `${baseName}.jsonl`);
    const csvPath = path.join(exportDir, `${baseName}.csv`);

    const samples = rows.map((row) => buildTrainingSample(row)).filter(Boolean);
    fs.writeFileSync(
      jsonlPath,
      samples.map(toJsonLine).join('\n') + (samples.length ? '\n' : ''),
      'utf8'
    );

    const csvHeader = [
      'normalized_event_id',
      'raw_event_id',
      'event_ts',
      'event_type',
      'intent',
      'intent_confidence',
      'language',
      'input_text',
      'response_text',
      'source',
      'outcome',
      'label',
      'user_rating',
      'tenant_code',
      'site_code'
    ];

    const csvRows = [csvHeader];
    for (const row of rows) {
      csvRows.push([
        row.normalized_event_id,
        row.raw_event_id,
        row.event_ts instanceof Date ? row.event_ts.toISOString() : String(row.event_ts || ''),
        row.event_type,
        row.intent || '',
        row.intent_confidence == null ? '' : String(row.intent_confidence),
        row.language || '',
        cleanText(row.input_text, 2000),
        cleanText(row.response_text, 2000),
        row.source || '',
        row.outcome || '',
        row.label || '',
        row.user_rating == null ? '' : String(row.user_rating),
        row.tenant_code || '',
        row.site_code || ''
      ]);
    }

    fs.writeFileSync(
      csvPath,
      csvRows.map((line) => line.map(csvEscape).join(',')).join('\n') + '\n',
      'utf8'
    );

    await db.query(
      `
        UPDATE ai_export_runs
        SET status = 'completed',
            total_exported = $2,
            output_path = $3,
            error_message = NULL,
            finished_at = NOW()
        WHERE id = $1
      `,
      [runId, samples.length, jsonlPath]
    );

    return {
      runId,
      tenantCode: tenantSite.tenant_code,
      siteCode: tenantSite.site_code,
      totalExported: samples.length,
      jsonlPath,
      csvPath
    };
  } catch (error) {
    await db.query(
      `
        UPDATE ai_export_runs
        SET status = 'failed',
            error_message = $2,
            finished_at = NOW()
        WHERE id = $1
      `,
      [runId, cleanText(error.message, 1000)]
    );
    throw error;
  }
}

module.exports = {
  runFoundationExport
};
