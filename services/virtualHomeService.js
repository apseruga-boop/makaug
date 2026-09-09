'use strict';

const { createHash, randomUUID } = require('crypto');
const JSZip = require('jszip');

const PROJECT_STATUSES = Object.freeze([
  'DRAFT', 'INPUT_RECEIVED', 'PREPROCESSING', 'PLAN_PARSED', 'NEEDS_REVIEW',
  'PLAN_APPROVED', 'SCENE_BUILDING', 'SCENE_READY', 'QA', 'APPROVED',
  'PUBLISHED', 'DELIVERED', 'ARCHIVED', 'INPUT_UNREADABLE', 'SCALE_UNKNOWN',
  'GEOMETRY_INVALID', 'MODEL_GENERATION_FAILED', 'RENDER_FAILED', 'VIDEO_FAILED',
  'EXPORT_FAILED'
]);
const ERROR_STATUSES = Object.freeze(PROJECT_STATUSES.filter((status) => /_(?:FAILED|INVALID|UNREADABLE|UNKNOWN)$/.test(status)));
const SOURCE_KINDS = Object.freeze(['off_plan_development', 'existing_property', 'standalone_customer']);
const ACCURACY_LEVELS = Object.freeze(['DEVELOPER_VERIFIED', 'AI_RECONSTRUCTED', 'CONCEPT_VISUALISATION']);
const ASSET_VERSION_TYPES = Object.freeze(['ORIGINAL', 'CLEANED', 'STAFF_CORRECTED', 'APPROVED_MASTER', 'SCENE', 'RENDER', 'VIDEO', 'EXPORT', 'AUDIT']);
const ASSET_KINDS = Object.freeze(['floor_plan', 'plan_image', 'property_model', 'scene_manifest', 'svg', 'json', 'glb', 'render', 'video', 'document', 'archive']);

const STATUS_TRANSITIONS = Object.freeze({
  DRAFT: ['INPUT_RECEIVED', 'ARCHIVED'],
  INPUT_RECEIVED: ['PREPROCESSING', 'NEEDS_REVIEW', 'INPUT_UNREADABLE', 'ARCHIVED'],
  PREPROCESSING: ['PLAN_PARSED', 'NEEDS_REVIEW', 'INPUT_UNREADABLE', 'MODEL_GENERATION_FAILED'],
  PLAN_PARSED: ['NEEDS_REVIEW', 'GEOMETRY_INVALID'],
  NEEDS_REVIEW: ['PLAN_APPROVED', 'PREPROCESSING', 'SCALE_UNKNOWN', 'GEOMETRY_INVALID', 'ARCHIVED'],
  PLAN_APPROVED: ['SCENE_BUILDING', 'NEEDS_REVIEW', 'ARCHIVED'],
  SCENE_BUILDING: ['SCENE_READY', 'MODEL_GENERATION_FAILED', 'GEOMETRY_INVALID'],
  SCENE_READY: ['QA', 'NEEDS_REVIEW', 'SCENE_BUILDING', 'ARCHIVED'],
  QA: ['APPROVED', 'SCENE_BUILDING', 'NEEDS_REVIEW', 'RENDER_FAILED', 'VIDEO_FAILED', 'EXPORT_FAILED'],
  APPROVED: ['PUBLISHED', 'QA', 'ARCHIVED'],
  PUBLISHED: ['DELIVERED', 'APPROVED', 'ARCHIVED'],
  DELIVERED: ['PUBLISHED', 'ARCHIVED'],
  ARCHIVED: ['DRAFT'],
  INPUT_UNREADABLE: ['INPUT_RECEIVED', 'ARCHIVED'],
  SCALE_UNKNOWN: ['NEEDS_REVIEW', 'ARCHIVED'],
  GEOMETRY_INVALID: ['NEEDS_REVIEW', 'ARCHIVED'],
  MODEL_GENERATION_FAILED: ['PLAN_APPROVED', 'SCENE_BUILDING', 'ARCHIVED'],
  RENDER_FAILED: ['QA', 'ARCHIVED'],
  VIDEO_FAILED: ['QA', 'ARCHIVED'],
  EXPORT_FAILED: ['QA', 'ARCHIVED']
});

function cleanText(value, max = 4000) {
  return String(value == null ? '' : value).trim().replace(/\s+/g, ' ').slice(0, max);
}

function nullableText(value, max = 4000) {
  const result = cleanText(value, max);
  return result || null;
}

function validationError(message, details = []) {
  const error = new Error(message);
  error.status = 400;
  error.details = details;
  return error;
}

function conflictError(message, details = []) {
  const error = new Error(message);
  error.status = 409;
  error.details = details;
  return error;
}

function jsonObject(value, fallback = {}) {
  if (value == null || value === '') return { ...fallback };
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : { ...fallback };
  } catch (_) {
    return { ...fallback };
  }
}

function jsonArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === '') return [];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function jsonValue(value, fallback = null) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object' || typeof value === 'boolean' || typeof value === 'number') return value;
  try {
    return JSON.parse(String(value));
  } catch (_) {
    return String(value);
  }
}

function finiteNumber(value, fallback = null) {
  if (value === '' || value == null) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function nullableInteger(value) {
  const number = finiteNumber(value, null);
  return number == null ? null : Math.max(0, Math.round(number));
}

function nullableUuid(value, label = 'Identifier') {
  const text = nullableText(value, 80);
  if (!text) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    throw validationError(`${label} must be a valid UUID`);
  }
  return text;
}

function slugify(value) {
  return cleanText(value, 180)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 180);
}

function uniqueSlug(value) {
  const base = slugify(value) || 'virtual-home';
  return `${base}-${randomUUID().slice(0, 8)}`;
}

function booleanValue(value) {
  return value === true || ['true', '1', 'yes', 'on'].includes(cleanText(value, 12).toLowerCase());
}

function normalizeProjectRow(row = {}, { publicView = false } = {}) {
  if (!row) return null;
  const normalized = {
    ...row,
    requested_outputs: jsonArray(row.requested_outputs),
    commercial_details: jsonObject(row.commercial_details),
    property_model: jsonObject(row.property_model),
    scene_manifest: jsonObject(row.scene_manifest),
    viewer_settings: jsonObject(row.viewer_settings, {
      default_mode: 'dollhouse', default_furniture: 'furnished', default_environment: 'day', lite_fallback: true
    }),
    assets: jsonArray(row.assets),
    confidence_items: jsonArray(row.confidence_items),
    listing_links: jsonArray(row.listing_links),
    versions: jsonArray(row.versions),
    bedrooms: nullableInteger(row.bedrooms),
    bathrooms: finiteNumber(row.bathrooms, null),
    floors: nullableInteger(row.floors),
    floor_area_sqm: finiteNumber(row.floor_area_sqm, null),
    ceiling_height_m: finiteNumber(row.ceiling_height_m, null),
    property_model_version: nullableInteger(row.property_model_version) || 0,
    unresolved_count: nullableInteger(row.unresolved_count) || 0
  };
  if (publicView) {
    const publicProject = {};
    for (const key of [
      'id', 'name', 'public_slug', 'country_code', 'location', 'property_category',
      'bedrooms', 'bathrooms', 'floors', 'floor_area_sqm', 'ceiling_height_m',
      'specification_notes', 'finish_notes', 'accuracy_level', 'accuracy_disclosure',
      'property_model', 'property_model_version', 'scene_manifest', 'viewer_settings',
      'published_at', 'delivered_at'
    ]) publicProject[key] = normalized[key] ?? null;
    publicProject.assets = normalized.assets
      .filter((asset) => asset && asset.is_private === false)
      .map((asset) => ({
        id: asset.id,
        version_type: asset.version_type,
        asset_kind: asset.asset_kind,
        version_number: asset.version_number,
        original_filename: asset.original_filename,
        mime_type: asset.mime_type,
        storage_url: asset.storage_url,
        byte_size: asset.byte_size,
        metadata: jsonObject(asset.metadata),
        created_at: asset.created_at
      }));
    publicProject.listing_links = normalized.listing_links.map((link) => ({
      off_plan_development_id: link.off_plan_development_id || null,
      property_id: link.property_id || null,
      unit_type_key: link.unit_type_key || null
    }));
    return publicProject;
  }
  return normalized;
}

function modelFloors(model = {}) {
  return jsonArray(model.floors);
}

function allRooms(model = {}) {
  return modelFloors(model).flatMap((floor) => jsonArray(floor.rooms).map((room) => ({ ...room, floor_key: floor.key || floor.id || 'ground' })));
}

function allWalls(model = {}) {
  return modelFloors(model).flatMap((floor) => jsonArray(floor.walls).map((wall) => ({ ...wall, floor_key: floor.key || floor.id || 'ground' })));
}

function coordinate(value) {
  const result = finiteNumber(value, null);
  return result == null ? null : Math.round(result * 10000) / 10000;
}

function normalizeRoom(room = {}, index = 0) {
  const x = coordinate(room.x);
  const z = coordinate(room.z);
  const width = coordinate(room.width);
  const depth = coordinate(room.depth);
  if ([x, z, width, depth].some((value) => value == null) || width <= 0 || depth <= 0) return null;
  return {
    key: slugify(room.key || room.id || room.label || `room-${index + 1}`) || `room-${index + 1}`,
    label: cleanText(room.label || room.name || `Room ${index + 1}`, 120),
    type: cleanText(room.type || 'room', 80).toLowerCase(),
    x, z, width, depth,
    height: Math.max(2, coordinate(room.height) || 2.7),
    material: cleanText(room.material || 'neutral', 80),
    furniture: jsonArray(room.furniture).map((item, itemIndex) => ({
      key: slugify(item.key || item.id || `${room.key || index}-furniture-${itemIndex + 1}`),
      type: cleanText(item.type || 'generic', 80),
      label: cleanText(item.label || item.type || 'Furniture', 120),
      x: coordinate(item.x) ?? (x + width / 2),
      z: coordinate(item.z) ?? (z + depth / 2),
      width: Math.max(0.2, coordinate(item.width) || Math.min(1.8, width * 0.35)),
      depth: Math.max(0.2, coordinate(item.depth) || Math.min(0.9, depth * 0.25)),
      height: Math.max(0.2, coordinate(item.height) || 0.75),
      product_key: nullableText(item.product_key, 120)
    }))
  };
}

function roomWalls(room, thickness = 0.14) {
  const half = thickness / 2;
  return [
    { key: `${room.key}-north`, x1: room.x - half, z1: room.z, x2: room.x + room.width + half, z2: room.z, thickness, height: room.height },
    { key: `${room.key}-south`, x1: room.x - half, z1: room.z + room.depth, x2: room.x + room.width + half, z2: room.z + room.depth, thickness, height: room.height },
    { key: `${room.key}-west`, x1: room.x, z1: room.z, x2: room.x, z2: room.z + room.depth, thickness, height: room.height },
    { key: `${room.key}-east`, x1: room.x + room.width, z1: room.z, x2: room.x + room.width, z2: room.z + room.depth, thickness, height: room.height }
  ];
}

function normalizeWall(wall = {}, index = 0, ceilingHeight = 2.7) {
  const x1 = coordinate(wall.x1);
  const z1 = coordinate(wall.z1);
  const x2 = coordinate(wall.x2);
  const z2 = coordinate(wall.z2);
  if ([x1, z1, x2, z2].some((value) => value == null) || (x1 === x2 && z1 === z2)) return null;
  return {
    key: slugify(wall.key || wall.id || `wall-${index + 1}`),
    x1, z1, x2, z2,
    thickness: Math.max(0.08, coordinate(wall.thickness) || 0.14),
    height: Math.max(2, coordinate(wall.height) || ceilingHeight),
    material: cleanText(wall.material || 'painted-wall', 80),
    openings: jsonArray(wall.openings)
  };
}

function normalizePropertyModel(input = {}) {
  const model = jsonObject(input);
  const scale = jsonObject(model.scale);
  const normalizedFloors = modelFloors(model).map((floor, floorIndex) => {
    const ceilingHeight = Math.max(2, coordinate(floor.ceiling_height_m) || coordinate(model.ceiling_height_m) || 2.7);
    const rooms = jsonArray(floor.rooms).map(normalizeRoom).filter(Boolean);
    let walls = jsonArray(floor.walls).map((wall, wallIndex) => normalizeWall(wall, wallIndex, ceilingHeight)).filter(Boolean);
    if (!walls.length) walls = rooms.flatMap((room) => roomWalls(room));
    return {
      key: slugify(floor.key || floor.id || floor.label || `floor-${floorIndex + 1}`) || `floor-${floorIndex + 1}`,
      label: cleanText(floor.label || floor.name || (floorIndex ? `Floor ${floorIndex + 1}` : 'Ground floor'), 120),
      elevation_m: coordinate(floor.elevation_m) || floorIndex * ceilingHeight,
      ceiling_height_m: ceilingHeight,
      rooms,
      walls,
      doors: jsonArray(floor.doors),
      windows: jsonArray(floor.windows),
      stairs: jsonArray(floor.stairs)
    };
  });
  return {
    schema: 'makaug.property-model.v1',
    units: 'metres',
    scale: {
      state: ['KNOWN', 'ESTIMATED', 'UNKNOWN'].includes(cleanText(scale.state).toUpperCase()) ? cleanText(scale.state).toUpperCase() : 'UNKNOWN',
      metres_per_source_unit: finiteNumber(scale.metres_per_source_unit, null),
      known_measurement: nullableText(scale.known_measurement, 220),
      source: cleanText(scale.source || 'staff', 80)
    },
    floors: normalizedFloors,
    materials: jsonObject(model.materials),
    metadata: jsonObject(model.metadata)
  };
}

function propertyModelErrors(input = {}) {
  const model = normalizePropertyModel(input);
  const errors = [];
  if (!model.floors.length) errors.push('At least one floor is required.');
  model.floors.forEach((floor) => {
    if (!floor.rooms.length) errors.push(`${floor.label} needs at least one room.`);
    if (!floor.walls.length) errors.push(`${floor.label} needs wall geometry.`);
  });
  const keys = allRooms(model).map((room) => room.key);
  if (new Set(keys).size !== keys.length) errors.push('Room keys must be unique across the property model.');
  return Array.from(new Set(errors));
}

function sceneFromPropertyModel(input = {}, options = {}) {
  const model = normalizePropertyModel(input);
  const errors = propertyModelErrors(model);
  if (errors.length) throw validationError('Property geometry is incomplete', errors);
  const floors = model.floors.map((floor) => ({
    key: floor.key,
    label: floor.label,
    elevation_m: floor.elevation_m,
    ceiling_height_m: floor.ceiling_height_m,
    rooms: floor.rooms,
    walls: floor.walls.map((wall) => ({ ...wall, openings: jsonArray(wall.openings) })),
    doors: floor.doors,
    windows: floor.windows,
    stairs: floor.stairs
  }));
  const rooms = floors.flatMap((floor) => floor.rooms);
  const minX = Math.min(...rooms.map((room) => room.x), 0);
  const minZ = Math.min(...rooms.map((room) => room.z), 0);
  const maxX = Math.max(...rooms.map((room) => room.x + room.width), 6);
  const maxZ = Math.max(...rooms.map((room) => room.z + room.depth), 6);
  return {
    schema: 'makaug.virtual-home-scene.v1',
    generated_at: new Date().toISOString(),
    source_model_schema: model.schema,
    model_version: nullableInteger(options.modelVersion) || 1,
    accuracy_level: ACCURACY_LEVELS.includes(options.accuracyLevel) ? options.accuracyLevel : 'CONCEPT_VISUALISATION',
    floors,
    bounds: { min_x: minX, min_z: minZ, max_x: maxX, max_z: maxZ },
    modes: ['walk', 'dollhouse', 'floor_plan'],
    environments: ['day', 'night'],
    furnishing: ['furnished', 'unfurnished'],
    fallback: { type: 'floor_plan', enabled: true },
    camera: { target: [(minX + maxX) / 2, 1, (minZ + maxZ) / 2], position: [maxX + 5, Math.max(8, maxZ), maxZ + 5] }
  };
}

function confidenceBand(value) {
  const number = finiteNumber(value, null);
  if (number == null) return 'UNKNOWN';
  if (number >= 0.85) return 'GREEN';
  if (number >= 0.6) return 'AMBER';
  return 'RED';
}

function normalizeConfidenceItems(items = []) {
  return jsonArray(items).slice(0, 1000).map((item, index) => ({
    element_key: slugify(item.element_key || item.key || `${item.element_type || 'element'}-${index + 1}`),
    element_type: cleanText(item.element_type || item.type || 'unknown', 80),
    label: nullableText(item.label, 220),
    value: jsonValue(item.value),
    confidence: Math.max(0, Math.min(1, finiteNumber(item.confidence, 0))),
    confidence_band: confidenceBand(item.confidence),
    source: cleanText(item.source || 'unknown', 80),
    review_state: ['UNREVIEWED', 'CONFIRMED', 'CORRECTED', 'REJECTED'].includes(cleanText(item.review_state).toUpperCase()) ? cleanText(item.review_state).toUpperCase() : 'UNREVIEWED'
  })).filter((item) => item.element_key);
}

function managerSelect() {
  return `SELECT p.*,
    COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.created_at DESC) FROM virtual_home_assets a WHERE a.project_id = p.id), '[]'::jsonb) AS assets,
    COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.created_at) FROM virtual_home_confidence_items c WHERE c.project_id = p.id), '[]'::jsonb) AS confidence_items,
    COALESCE((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.created_at) FROM virtual_home_listing_links l WHERE l.project_id = p.id), '[]'::jsonb) AS listing_links,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('version_number',r.version_number,'correction_summary',r.correction_summary,'source',r.source,'created_at',r.created_at) ORDER BY r.version_number DESC) FROM virtual_home_revisions r WHERE r.project_id = p.id), '[]'::jsonb) AS versions,
    (SELECT COUNT(*)::int FROM virtual_home_confidence_items c WHERE c.project_id = p.id AND c.review_state = 'UNREVIEWED') AS unresolved_count
    FROM virtual_home_projects p`;
}

function publicSelect() {
  return `SELECT p.*,
    COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.created_at DESC) FROM virtual_home_assets a WHERE a.project_id = p.id AND a.is_private = FALSE), '[]'::jsonb) AS assets,
    COALESCE((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.created_at) FROM virtual_home_listing_links l WHERE l.project_id = p.id), '[]'::jsonb) AS listing_links
    FROM virtual_home_projects p`;
}

async function listManagedProjects(db, query = {}) {
  const values = [];
  const filters = [];
  const status = cleanText(query.status, 50).toUpperCase();
  if (PROJECT_STATUSES.includes(status)) { values.push(status); filters.push(`p.status = $${values.length}`); }
  const search = cleanText(query.q || query.search, 160);
  if (search) { values.push(`%${search}%`); filters.push(`CONCAT_WS(' ',p.name,p.client_name,p.company_name,p.location,p.property_category) ILIKE $${values.length}`); }
  const result = await db.query(`${managerSelect()} ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''} ORDER BY p.updated_at DESC LIMIT 200`, values);
  return result.rows.map((row) => normalizeProjectRow(row));
}

async function getManagedProject(db, id) {
  const result = await db.query(`${managerSelect()} WHERE p.id = $1 LIMIT 1`, [id]);
  return normalizeProjectRow(result.rows[0]);
}

async function listPublicProjects(db, query = {}) {
  const values = [];
  const filters = [`p.is_public = TRUE`, `p.status IN ('PUBLISHED','DELIVERED')`];
  if (query.off_plan_development_id) { values.push(nullableUuid(query.off_plan_development_id, 'Development ID')); filters.push(`p.off_plan_development_id = $${values.length}`); }
  if (query.property_id) { values.push(nullableUuid(query.property_id, 'Property ID')); filters.push(`p.property_id = $${values.length}`); }
  const result = await db.query(`${publicSelect()} WHERE ${filters.join(' AND ')} ORDER BY p.published_at DESC LIMIT 100`, values);
  return result.rows.map((row) => normalizeProjectRow(row, { publicView: true }));
}

async function getPublicProject(db, slug) {
  const result = await db.query(`${publicSelect()} WHERE p.public_slug = $1 AND p.is_public = TRUE AND p.status IN ('PUBLISHED','DELIVERED') LIMIT 1`, [slugify(slug)]);
  return normalizeProjectRow(result.rows[0], { publicView: true });
}

function normalizeProjectWrite(input = {}, { partial = false } = {}) {
  const value = input && typeof input === 'object' ? input : {};
  const payload = {};
  const assign = (key, transform) => {
    if (partial && !Object.prototype.hasOwnProperty.call(value, key)) return;
    payload[key] = transform(value[key]);
  };
  assign('name', (item) => cleanText(item, 220));
  assign('source_kind', (item) => SOURCE_KINDS.includes(cleanText(item).toLowerCase()) ? cleanText(item).toLowerCase() : 'standalone_customer');
  assign('off_plan_development_id', (item) => nullableUuid(item, 'Off-plan development ID'));
  assign('property_id', (item) => nullableUuid(item, 'Property ID'));
  assign('unit_type_key', (item) => nullableText(item, 180));
  assign('client_name', (item) => nullableText(item, 220));
  assign('company_name', (item) => nullableText(item, 220));
  assign('country_code', (item) => cleanText(item || 'UG', 2).toUpperCase() || 'UG');
  assign('location', (item) => nullableText(item, 800));
  assign('property_category', (item) => nullableText(item, 100));
  assign('bedrooms', nullableInteger);
  assign('bathrooms', (item) => finiteNumber(item, null));
  assign('floors', nullableInteger);
  assign('floor_area_sqm', (item) => finiteNumber(item, null));
  assign('ceiling_height_m', (item) => finiteNumber(item, null));
  assign('specification_notes', (item) => nullableText(item, 10000));
  assign('finish_notes', (item) => nullableText(item, 10000));
  assign('furniture_preference', (item) => nullableText(item, 80));
  assign('customer_notes', (item) => nullableText(item, 10000));
  assign('internal_notes', (item) => nullableText(item, 20000));
  assign('requested_outputs', jsonArray);
  assign('commercial_details', jsonObject);
  assign('viewer_settings', jsonObject);
  assign('assigned_staff_id', (item) => nullableUuid(item, 'Assigned staff ID'));
  assign('accuracy_level', (item) => ACCURACY_LEVELS.includes(cleanText(item).toUpperCase()) ? cleanText(item).toUpperCase() : 'CONCEPT_VISUALISATION');
  assign('accuracy_disclosure', (item) => cleanText(item || 'Concept visualisation. Dimensions, finishes and furnishings require approval before reliance.', 1000));
  return payload;
}

async function recordEvent(db, { projectId = null, action, actorId = null, actorRole = null, payload = {} }) {
  return db.query(
    `INSERT INTO virtual_home_events (project_id, action, actor_id, actor_role, payload) VALUES ($1,$2,$3,$4,$5::jsonb) RETURNING *`,
    [projectId, cleanText(action, 120), actorId, nullableText(actorRole, 80), JSON.stringify(jsonObject(payload))]
  );
}

async function createProject(db, input = {}, actor = {}) {
  const payload = normalizeProjectWrite(input);
  if (!payload.name) throw validationError('Virtual Home name is required');
  if (payload.source_kind === 'off_plan_development' && !payload.off_plan_development_id) throw validationError('Choose an off-plan development');
  if (payload.source_kind === 'existing_property' && !payload.property_id) throw validationError('Choose an existing property');
  const slug = uniqueSlug(input.slug || payload.name);
  const publicSlug = slugify(input.public_slug || slug);
  const columns = [...Object.keys(payload), 'slug', 'public_slug', 'status', 'created_by', 'updated_by'];
  const values = [...Object.values(payload), slug, publicSlug, 'DRAFT', actor.actorId || null, actor.actorId || null];
  const jsonFields = new Set(['requested_outputs', 'commercial_details', 'viewer_settings']);
  const placeholders = columns.map((column, index) => `$${index + 1}${jsonFields.has(column) ? '::jsonb' : ''}`);
  const serialized = values.map((item, index) => jsonFields.has(columns[index]) ? JSON.stringify(item) : item);
  const result = await db.query(`INSERT INTO virtual_home_projects (${columns.join(',')}) VALUES (${placeholders.join(',')}) RETURNING *`, serialized);
  const project = result.rows[0];
  await recordEvent(db, { projectId: project.id, action: 'virtual_home_created', ...actor, payload: { source_kind: project.source_kind } });
  return getManagedProject(db, project.id);
}

async function updateProject(db, id, input = {}, actor = {}) {
  const payload = normalizeProjectWrite(input, { partial: true });
  if (!Object.keys(payload).length) return getManagedProject(db, id);
  const jsonFields = new Set(['requested_outputs', 'commercial_details', 'viewer_settings']);
  const values = [id];
  const fields = [];
  Object.entries(payload).forEach(([key, value]) => {
    values.push(jsonFields.has(key) ? JSON.stringify(value) : value);
    fields.push(`${key} = $${values.length}${jsonFields.has(key) ? '::jsonb' : ''}`);
  });
  values.push(actor.actorId || null);
  fields.push(`updated_by = $${values.length}`, 'updated_at = NOW()');
  const result = await db.query(`UPDATE virtual_home_projects SET ${fields.join(',')} WHERE id = $1 RETURNING id`, values);
  if (!result.rows[0]) return null;
  await recordEvent(db, { projectId: id, action: 'virtual_home_updated', ...actor, payload: { fields: Object.keys(payload) } });
  return getManagedProject(db, id);
}

async function addAsset(db, projectId, input = {}, actor = {}) {
  const versionType = cleanText(input.version_type || 'ORIGINAL', 40).toUpperCase();
  const assetKind = cleanText(input.asset_kind || 'floor_plan', 40).toLowerCase();
  if (!ASSET_VERSION_TYPES.includes(versionType)) throw validationError('Invalid asset version type');
  if (!ASSET_KINDS.includes(assetKind)) throw validationError('Invalid asset kind');
  const project = await getManagedProject(db, projectId);
  if (!project) return null;
  const count = await db.query('SELECT COALESCE(MAX(version_number),0)::int + 1 AS version_number FROM virtual_home_assets WHERE project_id = $1 AND version_type = $2', [projectId, versionType]);
  const result = await db.query(
    `INSERT INTO virtual_home_assets (project_id,parent_asset_id,version_type,asset_kind,version_number,original_filename,mime_type,storage_url,internal_ref,byte_size,sha256,is_private,metadata,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14) RETURNING *`,
    [projectId, nullableUuid(input.parent_asset_id, 'Parent asset ID'), versionType, assetKind, count.rows[0]?.version_number || 1, nullableText(input.original_filename, 260), nullableText(input.mime_type, 120), nullableText(input.storage_url, 24000000), nullableText(input.internal_ref, 4000), nullableInteger(input.byte_size), nullableText(input.sha256, 64), booleanValue(input.is_private !== false), JSON.stringify(jsonObject(input.metadata)), actor.actorId || null]
  );
  if (versionType === 'ORIGINAL' && project.status === 'DRAFT') {
    await db.query(`UPDATE virtual_home_projects SET status = 'INPUT_RECEIVED', updated_by = $2, updated_at = NOW() WHERE id = $1`, [projectId, actor.actorId || null]);
  }
  await recordEvent(db, { projectId, action: `asset_${versionType.toLowerCase()}_created`, ...actor, payload: { asset_id: result.rows[0].id, asset_kind: assetKind, byte_size: result.rows[0].byte_size } });
  return result.rows[0];
}

async function savePropertyModel(db, projectId, input = {}, actor = {}) {
  const project = await getManagedProject(db, projectId);
  if (!project) return null;
  const model = normalizePropertyModel(input.property_model || input.model || input);
  const errors = propertyModelErrors(model);
  const confidenceItems = normalizeConfidenceItems(input.confidence_items);
  const nextVersion = project.property_model_version + 1;
  const status = errors.length ? 'GEOMETRY_INVALID' : 'NEEDS_REVIEW';
  const client = typeof db.getClient === 'function' ? await db.getClient() : db;
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE virtual_home_projects SET property_model = $2::jsonb, property_model_version = $3, status = $4, error_code = $5, error_message = $6, updated_by = $7, updated_at = NOW() WHERE id = $1`,
      [projectId, JSON.stringify(model), nextVersion, status, errors.length ? 'GEOMETRY_INVALID' : null, errors.join(' ') || null, actor.actorId || null]
    );
    await client.query(
      `INSERT INTO virtual_home_revisions (project_id,version_number,property_model,correction_summary,source,created_by) VALUES ($1,$2,$3::jsonb,$4,$5,$6)`,
      [projectId, nextVersion, JSON.stringify(model), nullableText(input.correction_summary, 4000), cleanText(input.source || 'staff', 40), actor.actorId || null]
    );
    for (const item of confidenceItems) {
      await client.query(
        `INSERT INTO virtual_home_confidence_items (project_id,element_key,element_type,label,value,confidence,confidence_band,source,review_state,reviewed_by,reviewed_at)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,CASE WHEN $9 = 'UNREVIEWED' THEN NULL ELSE $10 END,CASE WHEN $9 = 'UNREVIEWED' THEN NULL ELSE NOW() END)
         ON CONFLICT (project_id,element_key) DO UPDATE SET element_type=EXCLUDED.element_type,label=EXCLUDED.label,value=EXCLUDED.value,confidence=EXCLUDED.confidence,confidence_band=EXCLUDED.confidence_band,source=EXCLUDED.source,review_state=EXCLUDED.review_state,reviewed_by=EXCLUDED.reviewed_by,reviewed_at=EXCLUDED.reviewed_at,updated_at=NOW()`,
        [projectId, item.element_key, item.element_type, item.label, JSON.stringify(item.value), item.confidence, item.confidence_band, item.source, item.review_state, actor.actorId || null]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    if (client !== db && typeof client.release === 'function') client.release();
  }
  await recordEvent(db, { projectId, action: errors.length ? 'property_model_rejected' : 'property_model_saved_for_review', ...actor, payload: { version: nextVersion, errors, confidence_items: confidenceItems.length } });
  return getManagedProject(db, projectId);
}

async function reviewConfidenceItem(db, projectId, elementKey, input = {}, actor = {}) {
  const state = cleanText(input.review_state, 30).toUpperCase();
  if (!['CONFIRMED', 'CORRECTED', 'REJECTED'].includes(state)) throw validationError('Choose confirmed, corrected, or rejected');
  const result = await db.query(
    `UPDATE virtual_home_confidence_items SET review_state=$3,value=COALESCE($4::jsonb,value),reviewed_by=$5,reviewed_at=NOW(),updated_at=NOW() WHERE project_id=$1 AND element_key=$2 RETURNING *`,
    [projectId, slugify(elementKey), state, input.value == null ? null : JSON.stringify(jsonValue(input.value)), actor.actorId || null]
  );
  if (result.rows[0]) await recordEvent(db, { projectId, action: 'confidence_item_reviewed', ...actor, payload: { element_key: elementKey, review_state: state } });
  return result.rows[0] || null;
}

function transitionAllowed(from, to) {
  return from === to || (STATUS_TRANSITIONS[from] || []).includes(to);
}

async function setProjectStatus(db, id, requestedStatus, actor = {}, options = {}) {
  const status = cleanText(requestedStatus, 50).toUpperCase();
  if (!PROJECT_STATUSES.includes(status)) throw validationError('Invalid Virtual Home status');
  const project = await getManagedProject(db, id);
  if (!project) return null;
  if (!transitionAllowed(project.status, status)) throw conflictError(`Cannot move Virtual Home from ${project.status} to ${status}`);
  if (status === 'PLAN_APPROVED') {
    const errors = propertyModelErrors(project.property_model);
    if (errors.length) throw conflictError('Approve the property model only after geometry checks pass', errors);
    if (project.unresolved_count) throw conflictError('Review every unresolved confidence item before approval', [`${project.unresolved_count} item(s) remain unreviewed.`]);
  }
  if (status === 'APPROVED') {
    if (!options.allowFinalApproval) throw validationError('King/admin approval is required for final approval');
    if (!project.scene_manifest?.floors?.length || !project.plan_approved_at) {
      throw conflictError('The approved plan and generated scene are required before final approval');
    }
  }
  if (status === 'PUBLISHED' && !options.allowPublish) throw validationError('King/admin approval is required to publish');
  const nextIsPublic = status === 'PUBLISHED' || (status === 'DELIVERED' && project.is_public);
  const result = await db.query(
    `UPDATE virtual_home_projects SET status=$2,is_public=$3,error_code=$4,error_message=$5,
       plan_approved_by=CASE WHEN $2='PLAN_APPROVED' THEN $6 ELSE plan_approved_by END,
       plan_approved_at=CASE WHEN $2='PLAN_APPROVED' THEN NOW() ELSE plan_approved_at END,
       published_by=CASE WHEN $2='PUBLISHED' THEN $6 ELSE published_by END,
       published_at=CASE WHEN $2='PUBLISHED' THEN COALESCE(published_at,NOW()) ELSE published_at END,
       delivered_at=CASE WHEN $2='DELIVERED' THEN COALESCE(delivered_at,NOW()) ELSE delivered_at END,
       updated_by=$6,updated_at=NOW() WHERE id=$1 RETURNING id`,
    [id, status, nextIsPublic, ERROR_STATUSES.includes(status) ? status : null, ERROR_STATUSES.includes(status) ? nullableText(options.errorMessage, 4000) : null, actor.actorId || null]
  );
  if (!result.rows[0]) return null;
  await recordEvent(db, { projectId: id, action: `status_${status.toLowerCase()}`, ...actor, payload: { previous_status: project.status } });
  return getManagedProject(db, id);
}

async function buildScene(db, id, actor = {}) {
  const project = await getManagedProject(db, id);
  if (!project) return null;
  if (!['PLAN_APPROVED', 'SCENE_BUILDING', 'MODEL_GENERATION_FAILED'].includes(project.status)) {
    throw conflictError('Approve the floor plan before building the 3D scene');
  }
  await db.query(`UPDATE virtual_home_projects SET status='SCENE_BUILDING',error_code=NULL,error_message=NULL,updated_by=$2,updated_at=NOW() WHERE id=$1`, [id, actor.actorId || null]);
  try {
    const scene = sceneFromPropertyModel(project.property_model, { modelVersion: project.property_model_version, accuracyLevel: project.accuracy_level });
    await db.query(`UPDATE virtual_home_projects SET scene_manifest=$2::jsonb,status='SCENE_READY',updated_by=$3,updated_at=NOW() WHERE id=$1`, [id, JSON.stringify(scene), actor.actorId || null]);
    await recordEvent(db, { projectId: id, action: 'scene_built', ...actor, payload: { model_version: project.property_model_version, floor_count: scene.floors.length } });
  } catch (error) {
    await db.query(`UPDATE virtual_home_projects SET status='MODEL_GENERATION_FAILED',error_code='MODEL_GENERATION_FAILED',error_message=$2,updated_by=$3,updated_at=NOW() WHERE id=$1`, [id, cleanText(error.message, 4000), actor.actorId || null]);
    throw error;
  }
  return getManagedProject(db, id);
}

async function linkProject(db, id, input = {}, actor = {}) {
  const developmentId = nullableUuid(input.off_plan_development_id, 'Off-plan development ID');
  const propertyId = nullableUuid(input.property_id, 'Property ID');
  if (!developmentId && !propertyId) throw validationError('Choose a development or property to attach');
  const result = await db.query(
    `INSERT INTO virtual_home_listing_links (project_id,off_plan_development_id,property_id,unit_type_key,created_by)
     VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING *`,
    [id, developmentId, propertyId, nullableText(input.unit_type_key, 180), actor.actorId || null]
  );
  await recordEvent(db, { projectId: id, action: 'listing_link_created', ...actor, payload: { off_plan_development_id: developmentId, property_id: propertyId, unit_type_key: input.unit_type_key || null } });
  return result.rows[0] || null;
}

function svgForModel(project = {}) {
  const model = normalizePropertyModel(project.property_model);
  const rooms = allRooms(model);
  if (!rooms.length) throw validationError('No approved rooms are available for SVG export');
  const minX = Math.min(...rooms.map((room) => room.x));
  const minZ = Math.min(...rooms.map((room) => room.z));
  const maxX = Math.max(...rooms.map((room) => room.x + room.width));
  const maxZ = Math.max(...rooms.map((room) => room.z + room.depth));
  const padding = 36;
  const scale = 60;
  const width = Math.ceil((maxX - minX) * scale + padding * 2);
  const height = Math.ceil((maxZ - minZ) * scale + padding * 2);
  const escapeXml = (value) => cleanText(value, 200).replace(/[<>&'"]/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[character]));
  const content = rooms.map((room) => {
    const x = padding + (room.x - minX) * scale;
    const y = padding + (room.z - minZ) * scale;
    return `<g><rect x="${x}" y="${y}" width="${room.width * scale}" height="${room.depth * scale}" fill="#eef7f0" stroke="#166534" stroke-width="4"/><text x="${x + 10}" y="${y + 24}" font-family="Arial,sans-serif" font-size="16" font-weight="700" fill="#0f172a">${escapeXml(room.label)}</text></g>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(project.name)} approved floor plan"><rect width="100%" height="100%" fill="#ffffff"/>${content}<text x="${padding}" y="${height - 10}" font-family="Arial,sans-serif" font-size="12" fill="#475569">${escapeXml(project.accuracy_disclosure)}</text></svg>`;
}

function appendBoxGeometry(target, center, size) {
  const [cx, cy, cz] = center;
  const [sx, sy, sz] = size;
  const x0 = cx - sx / 2; const x1 = cx + sx / 2;
  const y0 = cy - sy / 2; const y1 = cy + sy / 2;
  const z0 = cz - sz / 2; const z1 = cz + sz / 2;
  const faces = [
    [[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1],[0,0,1]],
    [[x1,y0,z0],[x0,y0,z0],[x0,y1,z0],[x1,y1,z0],[0,0,-1]],
    [[x1,y0,z1],[x1,y0,z0],[x1,y1,z0],[x1,y1,z1],[1,0,0]],
    [[x0,y0,z0],[x0,y0,z1],[x0,y1,z1],[x0,y1,z0],[-1,0,0]],
    [[x0,y1,z1],[x1,y1,z1],[x1,y1,z0],[x0,y1,z0],[0,1,0]],
    [[x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1],[0,-1,0]]
  ];
  faces.forEach((face) => {
    const base = target.positions.length / 3;
    face.slice(0, 4).forEach((position) => { target.positions.push(...position); target.normals.push(...face[4]); });
    target.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
}

function glbForScene(project = {}) {
  const scene = project.scene_manifest?.floors?.length ? project.scene_manifest : sceneFromPropertyModel(project.property_model, { modelVersion: project.property_model_version, accuracyLevel: project.accuracy_level });
  const geometry = { positions: [], normals: [], indices: [] };
  scene.floors.forEach((floor) => {
    floor.rooms.forEach((room) => appendBoxGeometry(geometry, [room.x + room.width / 2, floor.elevation_m - 0.06, room.z + room.depth / 2], [room.width, 0.12, room.depth]));
    floor.walls.forEach((wall) => {
      const dx = wall.x2 - wall.x1; const dz = wall.z2 - wall.z1;
      const length = Math.hypot(dx, dz);
      const center = [(wall.x1 + wall.x2) / 2, floor.elevation_m + wall.height / 2, (wall.z1 + wall.z2) / 2];
      appendBoxGeometry(geometry, center, Math.abs(dx) >= Math.abs(dz) ? [length, wall.height, wall.thickness] : [wall.thickness, wall.height, length]);
    });
  });
  const positionBuffer = Buffer.from(new Float32Array(geometry.positions).buffer);
  const normalBuffer = Buffer.from(new Float32Array(geometry.normals).buffer);
  const indexBuffer = Buffer.from(new Uint32Array(geometry.indices).buffer);
  const bin = Buffer.concat([positionBuffer, normalBuffer, indexBuffer]);
  const positions = geometry.positions.filter((_, index) => index % 3 === 0).map((_, i) => geometry.positions.slice(i * 3, i * 3 + 3));
  const min = [0,1,2].map((axis) => Math.min(...positions.map((position) => position[axis])));
  const max = [0,1,2].map((axis) => Math.max(...positions.map((position) => position[axis])));
  const gltf = {
    asset: { version: '2.0', generator: 'Maka Virtual Homes' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: cleanText(project.name, 220) }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
    materials: [{ name: 'Maka neutral', pbrMetallicRoughness: { baseColorFactor: [0.83,0.88,0.84,1], metallicFactor: 0, roughnessFactor: 0.86 } }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positionBuffer.length, target: 34962 },
      { buffer: 0, byteOffset: positionBuffer.length, byteLength: normalBuffer.length, target: 34962 },
      { buffer: 0, byteOffset: positionBuffer.length + normalBuffer.length, byteLength: indexBuffer.length, target: 34963 }
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: geometry.positions.length / 3, type: 'VEC3', min, max },
      { bufferView: 1, componentType: 5126, count: geometry.normals.length / 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5125, count: geometry.indices.length, type: 'SCALAR' }
    ],
    extras: { accuracy_disclosure: project.accuracy_disclosure, source_model_version: project.property_model_version }
  };
  const jsonRaw = Buffer.from(JSON.stringify(gltf));
  const jsonPadding = (4 - (jsonRaw.length % 4)) % 4;
  const binPadding = (4 - (bin.length % 4)) % 4;
  const jsonChunk = Buffer.concat([jsonRaw, Buffer.alloc(jsonPadding, 0x20)]);
  const binChunk = Buffer.concat([bin, Buffer.alloc(binPadding)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);
  const jsonHeader = Buffer.alloc(8); jsonHeader.writeUInt32LE(jsonChunk.length, 0); jsonHeader.writeUInt32LE(0x4E4F534A, 4);
  const binHeader = Buffer.alloc(8); binHeader.writeUInt32LE(binChunk.length, 0); binHeader.writeUInt32LE(0x004E4942, 4);
  return Buffer.concat([header, jsonHeader, jsonChunk, binHeader, binChunk]);
}

async function exportProject(db, project, format) {
  const type = cleanText(format, 20).toLowerCase();
  if (type === 'json') return { buffer: Buffer.from(JSON.stringify(project.property_model, null, 2)), contentType: 'application/json', filename: `${project.slug}-property-model.json` };
  if (type === 'svg') return { buffer: Buffer.from(svgForModel(project)), contentType: 'image/svg+xml', filename: `${project.slug}-approved-plan.svg` };
  if (type === 'glb') return { buffer: glbForScene(project), contentType: 'model/gltf-binary', filename: `${project.slug}-virtual-home.glb` };
  if (type !== 'zip') throw validationError('Choose json, svg, glb, or zip');
  const [events, products] = await Promise.all([
    db.query('SELECT action,actor_role,payload,created_at FROM virtual_home_events WHERE project_id=$1 ORDER BY created_at', [project.id]),
    db.query('SELECT product_key,name,price_ugx,is_active FROM virtual_home_commercial_products ORDER BY price_ugx')
  ]);
  const zip = new JSZip();
  zip.file('original/README.txt', 'Original customer files are retained privately in MakaUG storage and are not duplicated into portable exports unless explicitly authorised.\n');
  zip.file('floor-plans/approved-plan.svg', svgForModel(project));
  zip.file('property-model/property.json', JSON.stringify(project.property_model, null, 2));
  zip.file('models/virtual-home.glb', glbForScene(project));
  zip.file('renders/README.txt', 'Approved still renders appear here when generated.\n');
  zip.file('videos/README.txt', 'Approved master and branded or white-label exports appear here when generated.\n');
  zip.file('metadata/project.json', JSON.stringify({ id: project.id, name: project.name, accuracy_level: project.accuracy_level, accuracy_disclosure: project.accuracy_disclosure, property_model_version: project.property_model_version, viewer_settings: project.viewer_settings, requested_outputs: project.requested_outputs }, null, 2));
  zip.file('metadata/audit.json', JSON.stringify(events.rows, null, 2));
  zip.file('metadata/products.json', JSON.stringify(products.rows, null, 2));
  zip.file('metadata/assets.json', JSON.stringify(project.assets.map((asset) => ({ id: asset.id, version_type: asset.version_type, asset_kind: asset.asset_kind, version_number: asset.version_number, original_filename: asset.original_filename, byte_size: asset.byte_size, sha256: asset.sha256, is_private: asset.is_private })), null, 2));
  return { buffer: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } }), contentType: 'application/zip', filename: `${project.slug}-complete-project.zip` };
}

async function storageSummary(db) {
  const result = await db.query(`SELECT COALESCE(SUM(byte_size),0)::bigint AS used_bytes,COUNT(*)::int AS asset_count,COUNT(DISTINCT project_id)::int AS project_count FROM virtual_home_assets`);
  const row = result.rows[0] || {};
  const usedBytes = Number(row.used_bytes || 0);
  const allowance = Math.max(0, Number(process.env.VIRTUAL_HOME_STORAGE_ALLOWANCE_BYTES || 0));
  const ratio = allowance ? usedBytes / allowance : null;
  return {
    used_bytes: usedBytes,
    asset_count: Number(row.asset_count || 0),
    project_count: Number(row.project_count || 0),
    allowance_bytes: allowance || null,
    status: ratio == null ? 'UNKNOWN' : ratio >= 0.9 ? 'RED' : ratio >= 0.7 ? 'AMBER' : 'GREEN',
    message: ratio == null ? 'Storage allowance is not configured. No upgrade will be started automatically.' : ratio >= 0.9 ? 'Additional capacity or paid service required. Owner approval needed.' : 'Storage is within the configured allowance.'
  };
}

async function listProducts(db) {
  const result = await db.query('SELECT * FROM virtual_home_commercial_products ORDER BY price_ugx,name');
  return result.rows;
}

async function upsertProduct(db, input = {}, actor = {}) {
  const key = cleanText(input.product_key, 100).toUpperCase();
  const name = cleanText(input.name, 180);
  const price = nullableInteger(input.price_ugx);
  if (!key || !name || price == null) throw validationError('Product key, name, and UGX price are required');
  const result = await db.query(
    `INSERT INTO virtual_home_commercial_products (product_key,name,description,price_ugx,is_active,settings,updated_by) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)
     ON CONFLICT (product_key) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,price_ugx=EXCLUDED.price_ugx,is_active=EXCLUDED.is_active,settings=EXCLUDED.settings,updated_by=EXCLUDED.updated_by,updated_at=NOW() RETURNING *`,
    [key, name, nullableText(input.description, 4000), price, input.is_active !== false, JSON.stringify(jsonObject(input.settings)), actor.actorId || null]
  );
  await recordEvent(db, { action: 'commercial_product_saved', ...actor, payload: { product_key: key, price_ugx: price } });
  return result.rows[0];
}

async function createOrder(db, input = {}) {
  const output = jsonArray(input.requested_outputs);
  const customerName = nullableText(input.customer_name, 220);
  const customerPhone = nullableText(input.customer_phone, 80);
  const customerEmail = nullableText(input.customer_email, 260);
  if (!customerName) throw validationError('Your name is required');
  if (!customerPhone && !customerEmail) throw validationError('Add a phone number or email address');
  if (customerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) throw validationError('Enter a valid email address');
  const result = await db.query(
    `INSERT INTO virtual_home_orders (project_id,customer_name,customer_phone,customer_email,product_key,amount_ugx,requested_outputs,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb) RETURNING *`,
    [nullableUuid(input.project_id, 'Project ID'), customerName, customerPhone, customerEmail, nullableText(input.product_key, 100), nullableInteger(input.amount_ugx), JSON.stringify(output), JSON.stringify(jsonObject(input.metadata))]
  );
  await recordEvent(db, { projectId: result.rows[0]?.project_id || null, action: 'commercial_enquiry_received', actorRole: 'customer', payload: { order_id: result.rows[0]?.id, product_key: result.rows[0]?.product_key } });
  return result.rows[0];
}

async function listOrders(db, query = {}) {
  const values = [];
  const filters = [];
  const status = cleanText(query.status, 40).toUpperCase();
  if (status) { values.push(status); filters.push(`o.order_status = $${values.length}`); }
  const result = await db.query(
    `SELECT o.*,p.name AS project_name,p.public_slug AS project_slug
     FROM virtual_home_orders o LEFT JOIN virtual_home_projects p ON p.id=o.project_id
     ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
     ORDER BY o.created_at DESC LIMIT 200`,
    values
  );
  return result.rows;
}

async function listFurnitureProducts(db, { publicOnly = false } = {}) {
  const result = await db.query(
    `SELECT ${publicOnly
      ? 'product_key,name,category,merchant_name,currency,price,model_url,image_url,commission_disclosure'
      : '*'} FROM virtual_home_furniture_products ${publicOnly ? "WHERE status='ACTIVE'" : ''} ORDER BY category,name`
  );
  return result.rows;
}

async function upsertFurnitureProduct(db, input = {}, actor = {}) {
  const key = cleanText(input.product_key, 120).toUpperCase();
  const name = cleanText(input.name, 220);
  const category = cleanText(input.category, 100);
  const status = cleanText(input.status || 'DRAFT', 30).toUpperCase();
  if (!key || !name || !category) throw validationError('Product key, name, and category are required');
  if (!['DRAFT', 'REVIEW', 'ACTIVE', 'ARCHIVED'].includes(status)) throw validationError('Invalid furniture status');
  const secureUrl = (value, label) => {
    const text = nullableText(value, 4000);
    if (text && !/^https:\/\//i.test(text)) throw validationError(`${label} must use HTTPS`);
    return text;
  };
  const result = await db.query(
    `INSERT INTO virtual_home_furniture_products
      (product_key,name,category,merchant_name,merchant_url,affiliate_url,currency,price,model_url,image_url,license_name,license_url,commission_disclosure,status,metadata,created_by,updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$16)
     ON CONFLICT (product_key) DO UPDATE SET name=EXCLUDED.name,category=EXCLUDED.category,merchant_name=EXCLUDED.merchant_name,
       merchant_url=EXCLUDED.merchant_url,affiliate_url=EXCLUDED.affiliate_url,currency=EXCLUDED.currency,price=EXCLUDED.price,
       model_url=EXCLUDED.model_url,image_url=EXCLUDED.image_url,license_name=EXCLUDED.license_name,license_url=EXCLUDED.license_url,
       commission_disclosure=EXCLUDED.commission_disclosure,status=EXCLUDED.status,metadata=EXCLUDED.metadata,updated_by=EXCLUDED.updated_by,updated_at=NOW()
     RETURNING *`,
    [key, name, category, nullableText(input.merchant_name, 220), secureUrl(input.merchant_url, 'Merchant URL'), secureUrl(input.affiliate_url, 'Affiliate URL'), nullableText(input.currency, 3)?.toUpperCase() || null, finiteNumber(input.price, null), secureUrl(input.model_url, 'Model URL'), secureUrl(input.image_url, 'Image URL'), nullableText(input.license_name, 120), secureUrl(input.license_url, 'License URL'), nullableText(input.commission_disclosure, 1000), status, JSON.stringify(jsonObject(input.metadata)), actor.actorId || null]
  );
  await recordEvent(db, { action: 'furniture_product_saved', ...actor, payload: { product_key: key, status } });
  return result.rows[0];
}

async function furnitureRedirect(db, productKey, context = {}) {
  const result = await db.query(`SELECT * FROM virtual_home_furniture_products WHERE product_key=$1 AND status='ACTIVE' LIMIT 1`, [cleanText(productKey, 120)]);
  const product = result.rows[0];
  if (!product) return null;
  const target = product.affiliate_url || product.merchant_url;
  if (!target || !/^https:\/\//i.test(target)) return null;
  const sessionHash = context.sessionId ? createHash('sha256').update(String(context.sessionId)).digest('hex') : null;
  await db.query(
    `INSERT INTO virtual_home_furniture_clicks (product_id,project_id,room_key,anonymous_session_hash,referrer_path,user_agent) VALUES ($1,$2,$3,$4,$5,$6)`,
    [product.id, context.projectId || null, nullableText(context.roomKey, 180), sessionHash, nullableText(context.referrerPath, 2000), nullableText(context.userAgent, 1000)]
  );
  return { target, product };
}

module.exports = {
  ACCURACY_LEVELS,
  ASSET_KINDS,
  ASSET_VERSION_TYPES,
  ERROR_STATUSES,
  PROJECT_STATUSES,
  SOURCE_KINDS,
  STATUS_TRANSITIONS,
  addAsset,
  buildScene,
  confidenceBand,
  createOrder,
  createProject,
  exportProject,
  furnitureRedirect,
  getManagedProject,
  getPublicProject,
  glbForScene,
  linkProject,
  listFurnitureProducts,
  listManagedProjects,
  listOrders,
  listProducts,
  listPublicProjects,
  normalizeConfidenceItems,
  normalizeProjectRow,
  normalizePropertyModel,
  propertyModelErrors,
  recordEvent,
  reviewConfidenceItem,
  savePropertyModel,
  sceneFromPropertyModel,
  setProjectStatus,
  slugify,
  storageSummary,
  svgForModel,
  transitionAllowed,
  updateProject,
  upsertFurnitureProduct,
  upsertProduct
};
