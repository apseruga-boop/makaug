'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const JSZip = require('jszip');
const {
  confidenceBand,
  exportProject,
  glbForScene,
  normalizeProjectRow,
  normalizeConfidenceItems,
  normalizePropertyModel,
  propertyModelErrors,
  sceneFromPropertyModel,
  storageSummary,
  svgForModel,
  transitionAllowed
} = require('../services/virtualHomeService');
const virtualHomeNotifications = require('../services/virtualHomeNotificationService');

const propertyModel = {
  scale: { state: 'KNOWN', metres_per_source_unit: 1, known_measurement: 'Bedroom width 4m', source: 'staff measurement' },
  floors: [{
    key: 'ground', label: 'Ground floor', elevation_m: 0,
    rooms: [
      { key: 'living', label: 'Living room', type: 'living', x: 0, z: 0, width: 5, depth: 4, furniture: [{ label: 'Sofa', type: 'sofa', x: 2, z: 2, product_key: 'SOFA-01' }] },
      { key: 'bedroom', label: 'Bedroom', type: 'bedroom', x: 5, z: 0, width: 4, depth: 4 }
    ]
  }]
};

function project() {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    slug: 'qa-home', public_slug: 'qa-home', name: 'QA Home', accuracy_level: 'DEVELOPER_VERIFIED',
    accuracy_disclosure: 'Developer verified dimensions.', property_model: normalizePropertyModel(propertyModel),
    property_model_version: 2, scene_manifest: {}, viewer_settings: {}, requested_outputs: [], assets: []
  };
}

test('normalizes a measurable property model and creates real viewer modes', () => {
  const normalized = normalizePropertyModel(propertyModel);
  assert.equal(normalized.schema, 'makaug.property-model.v1');
  assert.equal(normalized.floors[0].rooms.length, 2);
  assert.equal(normalized.floors[0].walls.length, 8);
  assert.deepEqual(propertyModelErrors(normalized), []);
  const scene = sceneFromPropertyModel(normalized, { modelVersion: 2, accuracyLevel: 'DEVELOPER_VERIFIED' });
  assert.deepEqual(scene.modes, ['walk', 'dollhouse', 'floor_plan']);
  assert.deepEqual(scene.environments, ['day', 'night']);
  assert.deepEqual(scene.furnishing, ['furnished', 'unfurnished']);
});

test('rejects incomplete geometry and labels confidence bands at the requested thresholds', () => {
  assert.match(propertyModelErrors({ floors: [] })[0], /At least one floor/);
  assert.equal(confidenceBand(0.85), 'GREEN');
  assert.equal(confidenceBand(0.6), 'AMBER');
  assert.equal(confidenceBand(0.59), 'RED');
  assert.equal(confidenceBand(null), 'UNKNOWN');
});

test('workflow requires human review and reserves final approval and publishing transitions', () => {
  assert.equal(transitionAllowed('NEEDS_REVIEW', 'PLAN_APPROVED'), true);
  assert.equal(transitionAllowed('PLAN_PARSED', 'PUBLISHED'), false);
  assert.equal(transitionAllowed('QA', 'APPROVED'), true);
  assert.equal(transitionAllowed('APPROVED', 'PUBLISHED'), true);
});

test('public project normalization removes private operations data and private assets', () => {
  const normalized = normalizeProjectRow({
    ...project(), client_name: 'Private Customer', customer_notes: 'Private note', internal_notes: 'Internal note',
    commercial_details: { margin: 12 }, error_message: 'internal failure', assigned_staff_id: 'staff',
    assets: [{ id: 'private', is_private: true, storage_url: 's3://private' }, { id: 'public', is_private: false, storage_url: '/assets/public.png', metadata: {} }],
    listing_links: [{ property_id: 'p1', created_by: 'secret' }], confidence_items: [{ source: 'ai' }], versions: [{ version_number: 1 }]
  }, { publicView: true });
  for (const key of ['client_name', 'customer_notes', 'internal_notes', 'commercial_details', 'error_message', 'assigned_staff_id', 'confidence_items', 'versions']) assert.equal(key in normalized, false, key);
  assert.deepEqual(normalized.assets.map((asset) => asset.id), ['public']);
  assert.deepEqual(normalized.listing_links, [{ off_plan_development_id: null, property_id: 'p1', unit_type_key: null }]);
  assert.equal('company_name' in normalized, false);
  assert.equal('status' in normalized, false);
  assert.equal('is_public' in normalized, false);
});

test('confidence values preserve scalar and structured evidence for staff review', () => {
  const items = normalizeConfidenceItems([
    { key: 'door-count', value: 4, confidence: 0.9 },
    { key: 'label', value: 'Kitchen', confidence: 0.7 },
    { key: 'shape', value: { width: 3.2 }, confidence: 0.4 }
  ]);
  assert.equal(items[0].value, 4);
  assert.equal(items[1].value, 'Kitchen');
  assert.deepEqual(items[2].value, { width: 3.2 });
});

test('SVG, GLB and complete ZIP exports contain portable project outputs', async () => {
  const source = project();
  const svg = svgForModel(source);
  assert.match(svg, /<svg/);
  assert.match(svg, /Living room/);
  const glb = glbForScene(source);
  assert.equal(glb.subarray(0, 4).toString('utf8'), 'glTF');
  const db = { query: async (sql) => ({ rows: sql.includes('virtual_home_events') ? [{ action: 'qa' }] : [{ product_key: 'MAKA_BRANDED_VIDEO', price_ugx: 50000 }] }) };
  const output = await exportProject(db, source, 'zip');
  const zip = await JSZip.loadAsync(output.buffer);
  for (const filename of ['floor-plans/approved-plan.svg', 'property-model/property.json', 'models/virtual-home.glb', 'metadata/audit.json', 'metadata/products.json']) assert.ok(zip.file(filename), filename);
});

test('storage state never auto-upgrades and uses the exact owner approval warning', async () => {
  const before = process.env.VIRTUAL_HOME_STORAGE_ALLOWANCE_BYTES;
  process.env.VIRTUAL_HOME_STORAGE_ALLOWANCE_BYTES = '1000';
  try {
    const summary = await storageSummary({ query: async () => ({ rows: [{ used_bytes: 950, asset_count: 3, project_count: 1 }] }) });
    assert.equal(summary.status, 'RED');
    assert.equal(summary.message, 'Additional capacity or paid service required. Owner approval needed.');
  } finally {
    if (before == null) delete process.env.VIRTUAL_HOME_STORAGE_ALLOWANCE_BYTES;
    else process.env.VIRTUAL_HOME_STORAGE_ALLOWANCE_BYTES = before;
  }
});

test('Virtual Home order notifications default to the MakaUG operations inboxes', () => {
  const previous = process.env.VIRTUAL_HOME_NOTIFICATION_EMAILS;
  delete process.env.VIRTUAL_HOME_NOTIFICATION_EMAILS;
  assert.deepEqual(virtualHomeNotifications.notificationRecipients(), [
    'admin@makaug.com',
    'arthur@makaug.com',
    'ronald@makaug.com'
  ]);
  const email = virtualHomeNotifications.orderEmail({
    id: 'order-1',
    customer_name: 'Test Customer',
    customer_phone: '+256700000000',
    requested_outputs: ['INTERACTIVE_3D'],
    metadata: { company: 'Test Developer', language: 'lg' }
  });
  assert.match(email.subject, /Test Customer/);
  assert.match(email.text, /Test Developer/);
  assert.match(email.text, /Language: lg/);
  if (previous == null) delete process.env.VIRTUAL_HOME_NOTIFICATION_EMAILS;
  else process.env.VIRTUAL_HOME_NOTIFICATION_EMAILS = previous;
});
