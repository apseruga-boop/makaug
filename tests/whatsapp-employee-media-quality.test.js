'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const {
  AUDIT_MARKER,
  auditProperty,
  metadataIssue,
  parseArgs,
  selectionQueryFor
} = require('../scripts/audit-whatsapp-employee-media');

const root = path.join(__dirname, '..');
const propertiesSource = fs.readFileSync(path.join(root, 'routes', 'properties.js'), 'utf8');
const staffRouteSource = fs.readFileSync(path.join(root, 'routes', 'staff.js'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'assets', 'makaug-app.js'), 'utf8');

assert.equal(AUDIT_MARKER, 'whatsapp-employee-media-quality-audit-20260906');
assert.deepEqual(parseArgs([]), {
  agentIds: [],
  propertyIds: [],
  statuses: ['pending', 'approved'],
  limit: 500
});
assert.deepEqual(parseArgs([
  '--agent-id=5674f6cb-37a0-4e1e-904f-06e03ec401ab',
  '--property-id=2c678a04-2aab-4a34-ae5b-1c831c2315c2',
  '--status=approved,pending',
  '--limit=25'
]), {
  agentIds: ['5674f6cb-37a0-4e1e-904f-06e03ec401ab'],
  propertyIds: ['2c678a04-2aab-4a34-ae5b-1c831c2315c2'],
  statuses: ['approved', 'pending'],
  limit: 25
});

const selection = selectionQueryFor(parseArgs(['--agent-id=5674f6cb-37a0-4e1e-904f-06e03ec401ab']));
assert(!selection.text.includes("p.source = 'whatsapp_employee_intake'"), 'agent-scoped audits must include legacy/manual imports');
assert(selection.text.includes('p.status = ANY($1::text[])'));
assert(selection.text.includes('p.agent_id = ANY($2::uuid[])'));
assert.deepEqual(selection.values[1], ['5674f6cb-37a0-4e1e-904f-06e03ec401ab']);
const defaultSelection = selectionQueryFor(parseArgs([]));
assert(defaultSelection.text.includes("p.source = 'whatsapp_employee_intake'"), 'unscoped audits must remain limited to employee WhatsApp intake');

assert.equal(metadataIssue({ extra_fields: { media_validation_status: 'blocked_no_usable_property_image' } }), 'blocked_no_usable_property_image');
assert.equal(metadataIssue({ primary_slot_key: 'source_evidence_original', extra_fields: {} }), 'source_evidence_used_as_primary');
assert.equal(metadataIssue({ primary_slot_key: 'primary', extra_fields: {} }), '');

(async () => {
  const validImage = await sharp({
    create: { width: 320, height: 240, channels: 3, background: '#d8e8d2' }
  }).jpeg().toBuffer();
  const screenshot = await auditProperty({
    id: 'broken',
    primary_image_url: 'https://media.makaug.com/example.jpg',
    extra_fields: {}
  }, {
    fetchImpl: async () => ({
      ok: true,
      headers: { get: () => String(validImage.length) },
      arrayBuffer: async () => validImage
    }),
    classify: async () => ({ verdict: 'screenshot_or_document', confidence: 0.99, reason: 'chat screenshot' })
  });
  assert.equal(screenshot.issue, true);
  assert.equal(screenshot.verdict, 'screenshot_or_document');

  const unrelated = await auditProperty({
    id: 'unrelated',
    primary_image_url: 'https://media.makaug.com/example.jpg',
    extra_fields: {}
  }, {
    fetchImpl: async () => ({
      ok: true,
      headers: { get: () => String(validImage.length) },
      arrayBuffer: async () => validImage
    }),
    classify: async () => ({ accepted: false, verdict: 'non_property', confidence: 0.97, reason: 'product image' })
  });
  assert.equal(unrelated.issue, true, 'unrelated or product imagery must also be held for review');

  assert(propertiesSource.includes("approval_blocker: 'employee_media_quality'"), 'employee image quality must be a hard approval blocker');
  assert(propertiesSource.includes('human_approval_override_available: false'), 'the screenshot publication guard must not be bypassable');
  assert(propertiesSource.includes("NOT IN ('source_evidence_original', 'quarantined_source_evidence')"), 'source evidence must not count as usable public media');
  assert(staffRouteSource.includes("'media_validation_status', p.extra_fields->>'media_validation_status'"), 'moderators must receive the media validation state');
  assert(appSource.includes('<strong>Media blocked:</strong>'), 'the review queue must explain why a quarantined listing cannot be approved');
  console.log('WhatsApp employee media quality checks passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
