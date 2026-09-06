#!/usr/bin/env node
'use strict';

require('dotenv').config();

const sharp = require('sharp');
const db = require('../config/database');
const { classifyWhatsappListingPhoto } = require('../services/aiService');

const AUDIT_MARKER = 'whatsapp-employee-media-quality-audit-20260906';
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function parseArgs(argv = process.argv.slice(2)) {
  const statuses = argv
    .filter((arg) => arg.startsWith('--status='))
    .flatMap((arg) => arg.slice('--status='.length).split(','))
    .map((value) => value.trim().toLowerCase())
    .filter((value) => ['pending', 'approved'].includes(value));
  return {
    agentIds: argv
      .filter((arg) => arg.startsWith('--agent-id='))
      .map((arg) => arg.slice('--agent-id='.length).trim())
      .filter(Boolean),
    propertyIds: argv
      .filter((arg) => arg.startsWith('--property-id='))
      .map((arg) => arg.slice('--property-id='.length).trim())
      .filter(Boolean),
    statuses: statuses.length ? [...new Set(statuses)] : ['pending', 'approved'],
    limit: Math.max(1, Math.min(1000, Number(argv.find((arg) => arg.startsWith('--limit='))?.slice('--limit='.length) || 500)))
  };
}

function selectionQueryFor(options = {}) {
  const values = [options.statuses || ['pending', 'approved']];
  const explicitlyScoped = options.agentIds?.length || options.propertyIds?.length;
  const filters = ['p.status = ANY($1::text[])'];
  if (!explicitlyScoped) filters.unshift("p.source = 'whatsapp_employee_intake'");
  if (options.agentIds?.length) {
    values.push(options.agentIds);
    filters.push(`p.agent_id = ANY($${values.length}::uuid[])`);
  }
  if (options.propertyIds?.length) {
    values.push(options.propertyIds);
    filters.push(`p.id = ANY($${values.length}::uuid[])`);
  }
  values.push(options.limit || 500);
  return {
    text: `
      SELECT p.id::text AS id, p.status, p.title, p.agent_id::text AS agent_id,
             p.lister_name, p.extra_fields, p.created_at,
             pi.url AS primary_image_url, pi.slot_key AS primary_slot_key
        FROM properties p
        LEFT JOIN LATERAL (
          SELECT url, slot_key
            FROM property_images
           WHERE property_id = p.id
           ORDER BY is_primary DESC, sort_order ASC, created_at ASC
           LIMIT 1
        ) pi ON TRUE
       WHERE ${filters.join('\n         AND ')}
       ORDER BY p.created_at DESC, p.id DESC
       LIMIT $${values.length}
    `,
    values
  };
}

async function downloadAuditPreview(url, fetchImpl = fetch) {
  if (!/^https:\/\//i.test(String(url || ''))) throw new Error('primary_image_missing');
  const response = await fetchImpl(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`image_download_http_${response.status}`);
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > MAX_IMAGE_BYTES) throw new Error('image_too_large');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('image_too_large_or_empty');
  const normalized = await sharp(bytes)
    .rotate()
    .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();
  return `data:image/jpeg;base64,${normalized.toString('base64')}`;
}

function metadataIssue(property = {}) {
  const extra = property.extra_fields && typeof property.extra_fields === 'object' ? property.extra_fields : {};
  const blockers = Array.isArray(extra.media_quality_blockers) ? extra.media_quality_blockers : [];
  if (extra.media_validation_status === 'blocked_no_usable_property_image') return 'blocked_no_usable_property_image';
  if (blockers.length) return 'stored_media_quality_blocker';
  if (['source_evidence_original', 'quarantined_source_evidence'].includes(String(property.primary_slot_key || ''))) {
    return 'source_evidence_used_as_primary';
  }
  return '';
}

async function auditProperty(property, options = {}) {
  const metadataReason = metadataIssue(property);
  if (!property.primary_image_url) {
    return { ...property, issue: true, verdict: 'missing_primary_image', reason: metadataReason || 'primary_image_missing' };
  }
  try {
    const imageDataUrl = await downloadAuditPreview(property.primary_image_url, options.fetchImpl || fetch);
    const validation = await (options.classify || classifyWhatsappListingPhoto)({
      imageDataUrl,
      expectedSlot: 'primary property photo',
      providerScope: 'whatsapp'
    });
    const failedImageGate = validation?.accepted !== true && validation?.verdict !== 'unavailable';
    return {
      ...property,
      issue: Boolean(metadataReason || failedImageGate),
      verdict: validation?.verdict || 'unavailable',
      confidence: Number(validation?.confidence || 0),
      reason: metadataReason || validation?.reason || 'validation_unavailable'
    };
  } catch (error) {
    return { ...property, issue: Boolean(metadataReason), verdict: 'unavailable', reason: metadataReason || error.message || String(error) };
  }
}

async function main() {
  const options = parseArgs();
  const selection = selectionQueryFor(options);
  const result = await db.query(selection.text, selection.values);
  const audited = [];
  for (const property of result.rows) audited.push(await auditProperty(property));
  const issues = audited.filter((item) => item.issue);
  const unavailable = audited.filter((item) => item.verdict === 'unavailable');
  process.stdout.write(`${JSON.stringify({
    marker: AUDIT_MARKER,
    mode: 'read_only',
    selected: audited.length,
    issues: issues.length,
    unavailable: unavailable.length,
    issue_properties: issues,
    unavailable_properties: unavailable
  }, null, 2)}\n`);
  if (unavailable.length) process.exitCode = 2;
}

if (require.main === module) {
  main()
    .catch((error) => {
      process.stderr.write(`${error.stack || error.message || error}\n`);
      process.exitCode = 1;
    })
    .finally(() => db.pool.end());
}

module.exports = {
  AUDIT_MARKER,
  auditProperty,
  downloadAuditPreview,
  metadataIssue,
  parseArgs,
  selectionQueryFor
};
