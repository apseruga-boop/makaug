require('dotenv').config();

const fs = require('fs');
const path = require('path');

const db = require('../config/database');
const logger = require('../config/logger');

function parseArgInt(value, fallback) {
  const n = parseInt(String(value || ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

function toJsonLine(value) {
  return JSON.stringify(value).replace(/\u2028|\u2029/g, '');
}

function clean(value, max = 4000) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function isoStamp() {
  const now = new Date();
  return `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}`;
}

function buildAssistantSample(row) {
  const input = row.input_payload || {};
  const output = row.output_payload || {};

  const userMessage = clean(input.userMessage || input.message, 1600);
  const assistantText = clean(output.text, 2000);

  if (!userMessage || !assistantText) return null;

  return {
    messages: [
      {
        role: 'system',
        content:
          'You are MakaUg WhatsApp assistant for Uganda property. Reply in the selected language and include one useful MakaUg link when relevant.'
      },
      {
        role: 'user',
        content: userMessage
      },
      {
        role: 'assistant',
        content: assistantText
      }
    ],
    metadata: {
      event_id: row.id,
      event_type: row.event_type,
      language: row.language || 'en',
      source: row.source || 'unknown',
      rating: row.rating || null,
      label: row.label || null
    }
  };
}

function buildListingSample(row) {
  const input = row.input_payload || {};
  const output = row.output_payload || {};

  const listing = input.listing || {};
  const rewritten =
    output?.canonical?.rewritten_description ||
    output?.data?.rewritten_description ||
    '';
  const highlights =
    output?.canonical?.area_highlights ||
    output?.data?.area_highlights ||
    '';

  const title = clean(listing.title, 200);
  const district = clean(listing.district, 120);
  const area = clean(listing.area, 120);

  if (!title || !district || !area || !clean(rewritten, 4000)) return null;

  return {
    messages: [
      {
        role: 'system',
        content:
          'You are MakaUg listing copy model. Write premium Uganda property listing text with practical and accurate local context.'
      },
      {
        role: 'user',
        content: `Rewrite listing copy for Uganda.\nTitle: ${title}\nDistrict: ${district}\nArea: ${area}\nRaw description: ${clean(
          listing.description,
          2500
        )}`
      },
      {
        role: 'assistant',
        content: `Description: ${clean(rewritten, 3500)}\nArea highlights: ${clean(highlights, 1500)}`
      }
    ],
    metadata: {
      event_id: row.id,
      event_type: row.event_type,
      language: row.language || 'en',
      source: row.source || 'unknown',
      rating: row.rating || null,
      label: row.label || null
    }
  };
}

function csvEscape(value) {
  const text = String(value == null ? '' : value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

async function run() {
  const days = parseArgInt(process.argv[2], 30);
  const minRating = parseArgInt(process.argv[3], 3);
  const limit = parseArgInt(process.argv[4], 5000);

  const query = `
    SELECT
      e.id,
      e.event_type,
      e.source,
      e.input_payload,
      e.output_payload,
      e.language,
      e.model_name,
      e.created_at,
      f.rating,
      f.label
    FROM ai_model_events e
    LEFT JOIN LATERAL (
      SELECT rating, label
      FROM ai_model_feedback
      WHERE event_id = e.id
      ORDER BY created_at DESC
      LIMIT 1
    ) f ON TRUE
    WHERE e.created_at >= NOW() - ($1::text || ' days')::interval
    ORDER BY e.created_at DESC
    LIMIT $2
  `;

  const { rows } = await db.query(query, [String(days), limit]);

  const samples = [];
  const csvRows = [['id', 'event_type', 'source', 'language', 'model_name', 'rating', 'label', 'created_at']];

  for (const row of rows) {
    const rating = row.rating == null ? null : Number(row.rating);
    if (rating != null && rating < minRating) continue;

    let sample = null;
    if (row.event_type === 'assistant_reply' || row.event_type === 'assistant_reply_error') {
      sample = buildAssistantSample(row);
    } else if (row.event_type === 'listing_intelligence' || row.event_type === 'listing_intelligence_error') {
      sample = buildListingSample(row);
    }

    if (sample) {
      samples.push(sample);
    }

    csvRows.push([
      row.id,
      row.event_type,
      row.source || '',
      row.language || '',
      row.model_name || '',
      row.rating == null ? '' : String(row.rating),
      row.label || '',
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at || '')
    ]);
  }

  const outDir = path.join(__dirname, '..', 'exports', 'ai-training');
  ensureDir(outDir);

  const stamp = isoStamp();
  const jsonlPath = path.join(outDir, `makaug-ai-training-${stamp}.jsonl`);
  const csvPath = path.join(outDir, `makaug-ai-events-${stamp}.csv`);

  fs.writeFileSync(jsonlPath, samples.map(toJsonLine).join('\n') + (samples.length ? '\n' : ''), 'utf8');
  fs.writeFileSync(csvPath, csvRows.map((cols) => cols.map(csvEscape).join(',')).join('\n') + '\n', 'utf8');

  logger.info(`AI training export complete: ${samples.length} samples`);
  logger.info(`JSONL: ${jsonlPath}`);
  logger.info(`CSV: ${csvPath}`);

  await db.pool.end();
}

run().catch(async (error) => {
  logger.error('AI training export failed', error);
  try {
    await db.pool.end();
  } catch (_error) {
    // ignore
  }
  process.exit(1);
});
