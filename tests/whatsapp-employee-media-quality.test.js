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
  assert(propertiesSource.includes("mediaValidationStatus.startsWith('blocked_')"), 'all blocked WhatsApp media states must prevent approval');
  assert(propertiesSource.includes("['whatsapp_employee_intake', 'whatsapp_forward_review'].includes"), 'legacy WhatsApp forwards must use the same non-bypassable media approval gate');
  assert(propertiesSource.includes("'original_whatsapp_video', 'validated_property_image'"), 'missing original videos must be named explicitly at the approval boundary');
  assert(propertiesSource.includes("NOT IN ('source_evidence_original', 'quarantined_source_evidence')"), 'source evidence must not count as usable public media');
  assert(staffRouteSource.includes("'media_validation_status', p.extra_fields->>'media_validation_status'"), 'moderators must receive the media validation state');
  assert(staffRouteSource.includes("'video_recovery_required', COALESCE(p.extra_fields->'video_recovery_required', 'false'::jsonb)"), 'moderators must receive a boolean original-video recovery flag');
  assert(staffRouteSource.includes("'public_image_count', COALESCE(p.extra_fields->'public_image_count'"), 'staff review cards must receive the stored count of attached property gallery images without a slow image join');
  assert(staffRouteSource.includes("'primary_image_url', p.extra_fields->>'primary_image_url'"), 'staff review cards must receive the stored primary property image without a slow image join');
  assert(appSource.includes('<strong>Media blocked:</strong>'), 'the review queue must explain why a quarantined listing cannot be approved');
  assert(appSource.includes('the playable original WhatsApp video is still being recovered'), 'staff must see the original-video recovery state in the queue');
  assert(appSource.includes('clear property photo${imageCount === 1 ? "" : "s"} attached'), 'staff must see a clear photo count and thumbnail once gallery media exists');
  console.log('WhatsApp employee media quality checks passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
