'use strict';

const { createHash } = require('crypto');
const express = require('express');
const db = require('../config/database');
const { requireAdminApiKey, requireStaffAccess } = require('../middleware/auth');
const {
  addAsset,
  buildScene,
  createOrder,
  createProject,
  exportProject,
  furnitureRedirect,
  getManagedProject,
  getPublicProject,
  linkProject,
  listFurnitureProducts,
  listManagedProjects,
  listOrders,
  listProducts,
  listPublicProjects,
  normalizePropertyModel,
  recordEvent,
  reviewConfidenceItem,
  savePropertyModel,
  sceneFromPropertyModel,
  setProjectStatus,
  storageSummary,
  updateProject,
  upsertFurnitureProduct,
  upsertProduct
} = require('../services/virtualHomeService');
const {
  createSignedS3GetUrl,
  prepareMediaUrlForStorage
} = require('../services/cloudMediaStorageService');
const { interpretFloorPlan } = require('../services/virtualHomeAiService');
const { notifyVirtualHomeOrder } = require('../services/virtualHomeNotificationService');

const publicRouter = express.Router();
const staffRouter = express.Router();
const adminRouter = express.Router();

const INPUT_MIME_TYPES = new Set([
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/tiff'
]);
const DERIVED_MIME_TYPES = new Set([
  ...INPUT_MIME_TYPES, 'application/json', 'image/svg+xml', 'model/gltf-binary',
  'video/webm', 'video/mp4', 'application/zip'
]);
const PUBLIC_EVENTS = new Set([
  'viewer_opened', 'mode_changed', 'furniture_changed', 'environment_changed',
  'room_opened', 'furniture_opened', 'video_exported', 'lite_fallback_used',
  'service_enquiry_opened'
]);

const DEMO_PUBLIC_SLUG = 'demo';
const DEMO_PROPERTY_MODEL = normalizePropertyModel({
  scale: {
    state: 'KNOWN',
    metres_per_source_unit: 1,
    known_measurement: 'Demo dimensions in metres',
    source: 'Maka Virtual Homes preview'
  },
  floors: [{
    key: 'ground',
    label: 'Ground floor',
    elevation_m: 0,
    ceiling_height_m: 2.8,
    rooms: [
      {
        key: 'living-room', label: 'Living room', type: 'living', x: 0, z: 0, width: 5.6, depth: 4.2,
        furniture: [
          { key: 'living-sofa', label: 'Three-seat sofa', type: 'sofa', x: 1.25, z: 2.25, width: 2.2, depth: 0.9, height: 0.78, product_key: 'DEMO-SOFA' },
          { key: 'living-table', label: 'Coffee table', type: 'table', x: 3.1, z: 2.25, width: 1.15, depth: 0.7, height: 0.42, product_key: 'DEMO-TABLE' },
          { key: 'living-console', label: 'Media console', type: 'console', x: 5.05, z: 2.15, width: 0.45, depth: 1.6, height: 0.55 }
        ]
      },
      {
        key: 'kitchen-dining', label: 'Kitchen and dining', type: 'kitchen', x: 5.6, z: 0, width: 4.4, depth: 4.2,
        furniture: [
          { key: 'dining-table', label: 'Dining table', type: 'table', x: 7.05, z: 2.2, width: 1.65, depth: 0.95, height: 0.76, product_key: 'DEMO-DINING' },
          { key: 'kitchen-island', label: 'Kitchen island', type: 'counter', x: 9.15, z: 2.15, width: 0.75, depth: 2.25, height: 0.92 }
        ]
      },
      {
        key: 'primary-bedroom', label: 'Primary bedroom', type: 'bedroom', x: 0, z: 4.2, width: 5.2, depth: 4.3,
        furniture: [
          { key: 'primary-bed', label: 'King bed', type: 'bed', x: 2.55, z: 6.35, width: 2, depth: 2.15, height: 0.62, product_key: 'DEMO-BED' },
          { key: 'primary-wardrobe', label: 'Wardrobe', type: 'wardrobe', x: 4.85, z: 7.15, width: 0.55, depth: 2.1, height: 2.25 }
        ]
      },
      {
        key: 'second-bedroom', label: 'Second bedroom', type: 'bedroom', x: 5.2, z: 4.2, width: 4.8, depth: 4.3,
        furniture: [
          { key: 'second-bed', label: 'Double bed', type: 'bed', x: 7.2, z: 6.3, width: 1.55, depth: 2, height: 0.58, product_key: 'DEMO-BED' },
          { key: 'second-desk', label: 'Study desk', type: 'desk', x: 9.25, z: 5.2, width: 1.2, depth: 0.55, height: 0.74, product_key: 'DEMO-DESK' }
        ]
      },
      {
        key: 'bathroom', label: 'Bathroom', type: 'bathroom', x: 10, z: 0, width: 2.4, depth: 3.1,
        furniture: [
          { key: 'bath', label: 'Bath', type: 'bath', x: 11.2, z: 1.6, width: 1.65, depth: 0.75, height: 0.55 }
        ]
      },
      {
        key: 'entry', label: 'Entrance hall', type: 'hall', x: 10, z: 3.1, width: 2.4, depth: 5.4,
        furniture: [
          { key: 'entry-bench', label: 'Entry bench', type: 'bench', x: 11.7, z: 5.1, width: 1.1, depth: 0.45, height: 0.48 }
        ]
      }
    ]
  }]
});

const DEMO_PROJECT = Object.freeze({
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Maka Virtual Homes — Interactive Preview',
  public_slug: DEMO_PUBLIC_SLUG,
  country_code: 'UG',
  location: 'Fictional two-bedroom sample home',
  property_category: 'House',
  bedrooms: 2,
  bathrooms: 1,
  floors: 1,
  floor_area_sqm: 105.4,
  ceiling_height_m: 2.8,
  accuracy_level: 'CONCEPT_VISUALISATION',
  accuracy_disclosure: 'Interactive demonstration only. This fictional layout is not a property listing and must not be used for construction, valuation or purchase decisions.',
  property_model: DEMO_PROPERTY_MODEL,
  property_model_version: 1,
  scene_manifest: sceneFromPropertyModel(DEMO_PROPERTY_MODEL, { modelVersion: 1, accuracyLevel: 'CONCEPT_VISUALISATION' }),
  viewer_settings: { default_mode: 'dollhouse', default_furniture: 'furnished', default_environment: 'day', lite_fallback: true },
  assets: [],
  listing_links: [],
  published_at: null,
  delivered_at: null,
  is_demo: true
});

const DEMO_PRODUCTS = Object.freeze([
  { product_key: 'INTERACTIVE_3D', name: 'Interactive Virtual Home', description: 'Walk, dollhouse and floor-plan viewing modes.', price_ugx: null, settings: { quote_required: true } },
  { product_key: 'MAKA_BRANDED_VIDEO', name: 'Maka-branded walkthrough video', description: 'An eight-second browser preview is available from the managed workspace.', price_ugx: 50000, settings: {} }
]);

const DEMO_FURNITURE = Object.freeze([
  { product_key: 'DEMO-SOFA', name: 'Three-seat sofa', category: 'Living room', image_url: null, target_url: '/marketplace', price_ugx: null },
  { product_key: 'DEMO-TABLE', name: 'Coffee table', category: 'Living room', image_url: null, target_url: '/marketplace', price_ugx: null },
  { product_key: 'DEMO-DINING', name: 'Dining table', category: 'Dining', image_url: null, target_url: '/marketplace', price_ugx: null },
  { product_key: 'DEMO-BED', name: 'Bedroom collection', category: 'Bedroom', image_url: null, target_url: '/marketplace', price_ugx: null },
  { product_key: 'DEMO-DESK', name: 'Study desk', category: 'Home office', image_url: null, target_url: '/marketplace', price_ugx: null }
]);

function virtualHomeDemoEnabled(env = process.env) {
  if (String(env.NODE_ENV || '').toLowerCase() === 'production') return false;
  return ['1', 'true', 'yes', 'on'].includes(String(env.VIRTUAL_HOME_DEMO_ENABLED || '').trim().toLowerCase());
}

function cleanText(value, max = 2000) {
  return String(value == null ? '' : value).trim().replace(/\s+/g, ' ').slice(0, max);
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function actor(req) {
  return {
    actorId: req.userAuth?.id || req.staffAuth?.userId || req.adminAuth?.userId || null,
    actorRole: req.userAuth?.role || req.staffAuth?.role || req.adminAuth?.role || req.adminAuth?.type || null
  };
}

function dataUrlInfo(value) {
  const match = /^data:([^;,]+)(?:;charset=[^;,]+)?;base64,([A-Za-z0-9+/=\r\n]+)$/.exec(String(value || '').trim());
  if (!match) return null;
  const bytes = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
  return { mimeType: match[1].toLowerCase(), bytes };
}

function assetDownload(asset) {
  if (!asset) return null;
  const url = String(asset.internal_ref || asset.storage_url || '');
  if (url.startsWith('s3://')) return createSignedS3GetUrl(url).url;
  if (url.startsWith('data:') || url.startsWith('https://') || url.startsWith('/assets/')) return url;
  return null;
}

publicRouter.get('/', asyncRoute(async (req, res) => {
  if (virtualHomeDemoEnabled()) {
    res.set('Cache-Control', 'no-store');
    return res.json({ ok: true, projects: [DEMO_PROJECT], count: 1, demo: true });
  }
  const projects = await listPublicProjects(db, req.query);
  res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  return res.json({ ok: true, projects, count: projects.length });
}));

publicRouter.get('/products', asyncRoute(async (_req, res) => {
  if (virtualHomeDemoEnabled()) {
    res.set('Cache-Control', 'no-store');
    return res.json({ ok: true, products: DEMO_PRODUCTS, furniture: DEMO_FURNITURE, demo: true });
  }
  const [products, furniture] = await Promise.all([listProducts(db), listFurnitureProducts(db, { publicOnly: true })]);
  res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=900');
  return res.json({
    ok: true,
    products: products.filter((item) => item.is_active).map((item) => ({ product_key: item.product_key, name: item.name, description: item.description, price_ugx: item.price_ugx, settings: item.settings })),
    furniture
  });
}));

publicRouter.post('/orders', asyncRoute(async (req, res) => {
  if (virtualHomeDemoEnabled()) {
    return res.status(202).json({
      ok: true,
      demo: true,
      order_id: null,
      message: 'Preview received. Nothing was saved, emailed or charged in this local demo.'
    });
  }
  const order = await createOrder(db, {
    ...(req.body || {}),
    metadata: {
      ...(req.body?.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {}),
      source_path: cleanText(req.body?.source_path || req.get('referer') || '/services/virtual-homes', 1000),
      user_agent: cleanText(req.get('user-agent'), 500)
    }
  });
  const notification = await notifyVirtualHomeOrder(order).catch((error) => ({
    attempted_at: new Date().toISOString(),
    delivered: false,
    deliveries: [{ sent: false, reason: cleanText(error?.message || 'notification_failed', 300) }]
  }));
  await recordEvent(db, {
    projectId: order.project_id || null,
    action: 'commercial_enquiry_notification',
    actorRole: 'system',
    payload: {
      order_id: order.id,
      delivered: notification.delivered,
      recipients: notification.deliveries.map((item) => ({
        to: item.to || null,
        sent: item.sent,
        provider: item.provider || null,
        reason: item.reason || null
      }))
    }
  });
  return res.status(201).json({ ok: true, order_id: order.id, message: 'Your Virtual Home request is in the MakaUG production queue. The team will contact you before any charge is made.' });
}));

publicRouter.get('/:slug', asyncRoute(async (req, res) => {
  if (virtualHomeDemoEnabled() && req.params.slug === DEMO_PUBLIC_SLUG) {
    res.set('Cache-Control', 'no-store');
    return res.json({ ok: true, project: DEMO_PROJECT, demo: true });
  }
  const project = await getPublicProject(db, req.params.slug);
  if (!project) return res.status(404).json({ ok: false, error: 'Virtual Home not found' });
  res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  return res.json({ ok: true, project });
}));

publicRouter.post('/:slug/events', asyncRoute(async (req, res) => {
  if (virtualHomeDemoEnabled() && req.params.slug === DEMO_PUBLIC_SLUG) {
    const action = cleanText(req.body?.action, 120).toLowerCase();
    if (!PUBLIC_EVENTS.has(action)) return res.status(400).json({ ok: false, error: 'Unsupported viewer event' });
    return res.status(202).json({ ok: true, demo: true, persisted: false });
  }
  const project = await getPublicProject(db, req.params.slug);
  if (!project) return res.status(404).json({ ok: false, error: 'Virtual Home not found' });
  const action = cleanText(req.body?.action, 120).toLowerCase();
  if (!PUBLIC_EVENTS.has(action)) return res.status(400).json({ ok: false, error: 'Unsupported viewer event' });
  await recordEvent(db, { projectId: project.id, action, actorRole: 'public', payload: { value: cleanText(req.body?.value, 120) || null } });
  return res.status(202).json({ ok: true });
}));

function mountManagementRoutes(router, { allowPublish = false } = {}) {
  router.get('/projects', asyncRoute(async (req, res) => {
    const [projects, storage] = await Promise.all([listManagedProjects(db, req.query), storageSummary(db)]);
    return res.json({ ok: true, projects, count: projects.length, storage });
  }));

  router.get('/projects/:id', asyncRoute(async (req, res) => {
    const project = await getManagedProject(db, req.params.id);
    if (!project) return res.status(404).json({ ok: false, error: 'Virtual Home project not found' });
    return res.json({ ok: true, project });
  }));

  router.post('/projects', asyncRoute(async (req, res) => {
    const project = await createProject(db, req.body || {}, actor(req));
    return res.status(201).json({ ok: true, project });
  }));

  router.patch('/projects/:id', asyncRoute(async (req, res) => {
    const project = await updateProject(db, req.params.id, req.body || {}, actor(req));
    if (!project) return res.status(404).json({ ok: false, error: 'Virtual Home project not found' });
    return res.json({ ok: true, project });
  }));

  router.post('/projects/:id/assets', asyncRoute(async (req, res) => {
    const dataUrl = String(req.body?.data_url || '').trim();
    const parsed = dataUrlInfo(dataUrl);
    if (!parsed) return res.status(400).json({ ok: false, error: 'A base64 file upload is required' });
    const versionType = cleanText(req.body?.version_type || 'ORIGINAL', 40).toUpperCase();
    const allowed = versionType === 'ORIGINAL' ? INPUT_MIME_TYPES : DERIVED_MIME_TYPES;
    if (!allowed.has(parsed.mimeType)) return res.status(400).json({ ok: false, error: `Unsupported ${versionType.toLowerCase()} file type` });
    if (parsed.bytes.length > 15 * 1024 * 1024) return res.status(413).json({ ok: false, error: 'Virtual Home files must be 15MB or smaller' });
    const isPrivate = versionType === 'ORIGINAL' || req.body?.is_private !== false;
    const storedUrl = await prepareMediaUrlForStorage(dataUrl, {
      keyPrefix: `virtual-homes/${req.params.id}/${versionType.toLowerCase()}`,
      filename: cleanText(req.body?.original_filename || 'virtual-home-file', 260),
      allowedMimeTypes: Array.from(allowed),
      maxBytes: 15 * 1024 * 1024,
      isPrivate,
      label: 'Virtual Home file'
    });
    const asset = await addAsset(db, req.params.id, {
      ...(req.body || {}),
      mime_type: parsed.mimeType,
      storage_url: storedUrl && !String(storedUrl).startsWith('s3://') ? storedUrl : null,
      internal_ref: storedUrl && String(storedUrl).startsWith('s3://') ? storedUrl : null,
      byte_size: parsed.bytes.length,
      sha256: createHash('sha256').update(parsed.bytes).digest('hex'),
      is_private: isPrivate
    }, actor(req));
    if (!asset) return res.status(404).json({ ok: false, error: 'Virtual Home project not found' });
    return res.status(201).json({ ok: true, asset: { ...asset, storage_url: undefined, internal_ref: undefined } });
  }));

  router.post('/projects/:id/interpret', asyncRoute(async (req, res) => {
    const project = await getManagedProject(db, req.params.id);
    if (!project) return res.status(404).json({ ok: false, error: 'Virtual Home project not found' });
    const dataUrl = String(req.body?.data_url || '').trim();
    const parsed = dataUrlInfo(dataUrl);
    if (!parsed || !['image/jpeg', 'image/png', 'image/webp'].includes(parsed.mimeType)) {
      return res.status(400).json({ ok: false, error: 'Choose a JPG, PNG, or WebP plan for AI interpretation' });
    }
    if (parsed.bytes.length > 15 * 1024 * 1024) return res.status(413).json({ ok: false, error: 'Floor plan must be 15MB or smaller' });
    const draft = await interpretFloorPlan({ dataUrl, filename: req.body?.filename, notes: req.body?.notes });
    await recordEvent(db, { projectId: project.id, action: 'ai_plan_draft_created', ...actor(req), payload: { provider: draft.provider, model: draft.model, confidence_items: draft.confidence_items.length } });
    return res.json({ ok: true, draft });
  }));

  router.get('/projects/:id/assets/:assetId/download', asyncRoute(async (req, res) => {
    const project = await getManagedProject(db, req.params.id);
    const asset = project?.assets?.find((item) => item.id === req.params.assetId);
    if (!asset) return res.status(404).json({ ok: false, error: 'Virtual Home asset not found' });
    const url = assetDownload(asset);
    if (!url) return res.status(404).json({ ok: false, error: 'Stored file is unavailable' });
    if (url.startsWith('data:')) {
      const parsed = dataUrlInfo(url);
      res.set({ 'Content-Type': parsed.mimeType, 'Content-Disposition': `attachment; filename="${cleanText(asset.original_filename || 'virtual-home-file', 160)}"`, 'Cache-Control': 'private, no-store' });
      return res.send(parsed.bytes);
    }
    return res.redirect(302, url);
  }));

  router.post('/projects/:id/property-model', asyncRoute(async (req, res) => {
    const project = await savePropertyModel(db, req.params.id, req.body || {}, actor(req));
    if (!project) return res.status(404).json({ ok: false, error: 'Virtual Home project not found' });
    return res.json({ ok: true, project });
  }));

  router.patch('/projects/:id/confidence/:elementKey', asyncRoute(async (req, res) => {
    const confidence = await reviewConfidenceItem(db, req.params.id, req.params.elementKey, req.body || {}, actor(req));
    if (!confidence) return res.status(404).json({ ok: false, error: 'Confidence item not found' });
    return res.json({ ok: true, confidence });
  }));

  router.post('/projects/:id/status', asyncRoute(async (req, res) => {
    const project = await setProjectStatus(db, req.params.id, req.body?.status, actor(req), { allowPublish, allowFinalApproval: allowPublish, errorMessage: req.body?.error_message });
    if (!project) return res.status(404).json({ ok: false, error: 'Virtual Home project not found' });
    return res.json({ ok: true, project });
  }));

  router.post('/projects/:id/build-scene', asyncRoute(async (req, res) => {
    const project = await buildScene(db, req.params.id, actor(req));
    if (!project) return res.status(404).json({ ok: false, error: 'Virtual Home project not found' });
    return res.json({ ok: true, project });
  }));

  router.post('/projects/:id/listing-links', asyncRoute(async (req, res) => {
    const link = await linkProject(db, req.params.id, req.body || {}, actor(req));
    return res.status(201).json({ ok: true, link });
  }));

  router.get('/projects/:id/export/:format', asyncRoute(async (req, res) => {
    const project = await getManagedProject(db, req.params.id);
    if (!project) return res.status(404).json({ ok: false, error: 'Virtual Home project not found' });
    const output = await exportProject(db, project, req.params.format);
    await recordEvent(db, { projectId: project.id, action: `export_${cleanText(req.params.format, 20).toLowerCase()}`, ...actor(req), payload: { filename: output.filename } });
    res.set({ 'Content-Type': output.contentType, 'Content-Disposition': `attachment; filename="${output.filename}"`, 'Cache-Control': 'private, no-store' });
    return res.send(output.buffer);
  }));

  router.get('/orders', asyncRoute(async (req, res) => res.json({ ok: true, orders: await listOrders(db, req.query) })));
  router.get('/products', asyncRoute(async (_req, res) => res.json({ ok: true, products: await listProducts(db), furniture: await listFurnitureProducts(db) })));

  if (allowPublish) {
    router.put('/products/:key', asyncRoute(async (req, res) => res.json({ ok: true, product: await upsertProduct(db, { ...(req.body || {}), product_key: req.params.key }, actor(req)) })));
    router.put('/furniture/:key', asyncRoute(async (req, res) => res.json({ ok: true, furniture: await upsertFurnitureProduct(db, { ...(req.body || {}), product_key: req.params.key }, actor(req)) })));
  }
}

staffRouter.use(requireStaffAccess);
adminRouter.use(requireAdminApiKey);
mountManagementRoutes(staffRouter);
mountManagementRoutes(adminRouter, { allowPublish: true });

async function handleFurnitureRedirect(req, res, next) {
  try {
    const result = await furnitureRedirect(db, req.params.productKey, {
      projectId: req.query.project_id || req.query.project || null,
      roomKey: req.query.room_key || req.query.room || null,
      sessionId: req.get('x-virtual-home-session') || req.ip,
      referrerPath: req.get('referer'),
      userAgent: req.get('user-agent')
    });
    if (!result) return res.status(404).type('text/plain').send('Furniture product not found');
    return res.redirect(302, result.target);
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  DEMO_PROJECT,
  adminRouter,
  handleFurnitureRedirect,
  publicRouter,
  staffRouter,
  virtualHomeDemoEnabled
};
