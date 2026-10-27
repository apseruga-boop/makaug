'use strict';

// Agent ID documents (26 Oct 2026, Arthur): on King → Agents → Manage, staff
// upload an agent's ID (front, back, other) as a photo or PDF and view or
// download it later, for fraud checks and police requests. Files are private
// (Postgres, no URL, no-store/noindex), staff only, replace keeps the old one,
// and every upload/replace/view/download lands in the agent's history.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-id-documents-0123456789';
process.env.ADMIN_API_KEY = 'test-admin-key-id-docs';

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

// ── a tiny in-memory database for the routes and the auth middleware ──────
const USERS = {
  'aaaaaaaa-0000-4000-8000-000000000001': { id: 'aaaaaaaa-0000-4000-8000-000000000001', first_name: 'King', last_name: 'Owner', role: 'super_admin', status: 'active' },
  'aaaaaaaa-0000-4000-8000-000000000002': { id: 'aaaaaaaa-0000-4000-8000-000000000002', first_name: 'Ronald', last_name: 'Staff', role: 'admin', status: 'active' },
  'aaaaaaaa-0000-4000-8000-000000000003': { id: 'aaaaaaaa-0000-4000-8000-000000000003', first_name: 'Ann', last_name: 'Agent', role: 'agent_broker', status: 'active' },
  'aaaaaaaa-0000-4000-8000-000000000004': { id: 'aaaaaaaa-0000-4000-8000-000000000004', first_name: 'Pat', last_name: 'Public', role: 'buyer_renter', status: 'active' },
  'aaaaaaaa-0000-4000-8000-000000000005': { id: 'aaaaaaaa-0000-4000-8000-000000000005', first_name: 'Mo', last_name: 'Moderator', role: 'moderator', status: 'active' }
};
const AGENT_ID = 'bbbbbbbb-0000-4000-8000-000000000001';
const AGENTS = {
  [AGENT_ID]: { id: AGENT_ID, full_name: 'Test Agent', identity_document_url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', identity_document_name: 'signup.png' }
};
const FILES = [];
const AUDIT = [];

function fakeQuery(sql, params = []) {
  const q = String(sql).replace(/\s+/g, ' ');
  if (/FROM users WHERE id = \$1/.test(q)) return { rows: USERS[params[0]] ? [USERS[params[0]]] : [] };
  if (/FROM agents WHERE id = \$1/.test(q)) return { rows: AGENTS[params[0]] ? [AGENTS[params[0]]] : [] };
  if (/^SELECT id FROM agent_identity_files WHERE agent_id = \$1 AND kind = \$2 AND archived_at IS NULL/.test(q)) {
    return { rows: FILES.filter((f) => f.agent_id === params[0] && f.kind === params[1] && !f.archived_at).map((f) => ({ id: f.id })) };
  }
  if (/^UPDATE agent_identity_files SET archived_at = NOW\(\)/.test(q)) {
    const f = FILES.find((x) => x.id === params[0]); f.archived_at = new Date(); f.archived_by = params[1]; return { rows: [] };
  }
  if (/^UPDATE agent_identity_files SET replaced_by/.test(q)) { FILES.find((x) => x.id === params[0]).replaced_by = params[1]; return { rows: [] }; }
  if (/^INSERT INTO agent_identity_files/.test(q)) {
    const [agent_id, kind, label, original_name, mime_type, byte_size, sha256, content, metadata_stripped, uploaded_by, uploaded_by_label] = params;
    const row = { id: crypto.randomUUID(), agent_id, kind, label, original_name, mime_type, byte_size, sha256, content, metadata_stripped, uploaded_by, uploaded_by_label, uploaded_at: new Date(), archived_at: null };
    FILES.push(row);
    const { content: _c, ...meta } = row;
    return { rows: [meta] };
  }
  if (/FROM agent_identity_files f LEFT JOIN agents a/.test(q)) {
    const f = FILES.find((x) => x.id === params[0]);
    return { rows: f ? [{ ...f, full_name: AGENTS[f.agent_id]?.full_name }] : [] };
  }
  if (/^SELECT id, agent_id, kind, archived_at, sha256 FROM agent_identity_files/.test(q)) return { rows: FILES.filter((f) => f.id === params[0]) };
  if (/^DELETE FROM agent_identity_files/.test(q)) {
    const i = FILES.findIndex((f) => f.id === params[0] && f.archived_at); if (i >= 0) FILES.splice(i, 1); return { rows: [] };
  }
  if (/FROM agent_identity_files WHERE agent_id = \$1/.test(q)) {
    assert.doesNotMatch(q.split('FROM')[0], /content/, 'the metadata list never selects file bytes');
    return { rows: FILES.filter((f) => f.agent_id === params[0]).map(({ content, ...meta }) => meta) };
  }
  throw new Error(`unexpected SQL in test: ${q.slice(0, 120)}`);
}
const fakeDb = { query: async (sql, params) => fakeQuery(sql, params) };
require.cache[require.resolve('../config/database')] = { id: 'db', filename: 'db', loaded: true, exports: fakeDb };

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const sharp = require('sharp');
const { requireAdminApiKey } = require('../middleware/auth');
const { registerAgentIdFileRoutes } = require('../routes/adminAgentIdFiles');
const { prepareIdFileUpload, sniffIdFileMime, privateFileHeaders, ID_FILE_MAX_BYTES } = require('../services/agentIdFileService');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function buildApp() {
  const router = express.Router();
  router.use(requireAdminApiKey); // exactly as routes/admin.js does before any agent-manager route
  registerAgentIdFileRoutes(router, {
    db: fakeDb,
    UUID_RE,
    writeAudit: async (action, details, actorId) => { AUDIT.push({ action, details, actorId }); },
    actorOf: async (req) => {
      const u = USERS[req.adminAuth?.userId];
      return { id: req.adminAuth?.userId || 'admin_api_key', label: u ? `${u.first_name} ${u.last_name}` : 'admin key' };
    }
  });
  const app = express();
  app.use(express.json({ limit: '40mb' }));
  app.use('/api/admin', router);
  return app;
}
const bearer = (userId) => `Bearer ${jwt.sign({ sub: userId }, process.env.JWT_SECRET)}`;
const KING = bearer('aaaaaaaa-0000-4000-8000-000000000001');
const RONALD = bearer('aaaaaaaa-0000-4000-8000-000000000002');

async function fakeIdPhoto(text, { gps = false } = {}) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="#dbeafe"/><text x="30" y="200" font-size="40" fill="#b91c1c">${text}</text></svg>`;
  let img = sharp(Buffer.from(svg)).jpeg();
  if (gps) img = img.withExif({ IFD0: { Make: 'FakeCam', Model: 'GPS-TEST' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '0/1 20/1 0/1' } });
  return img.toBuffer();
}
const dataUrl = (buf, mime = 'image/jpeg') => `data:${mime};base64,${buf.toString('base64')}`;

test('anonymous, wrong key, agent, public and moderator users cannot touch ID files', async () => {
  const app = buildApp();
  const fileId = crypto.randomUUID();
  const probes = [
    ['get', `/api/admin/agent-manager/agents/${AGENT_ID}/id-files`],
    ['post', `/api/admin/agent-manager/agents/${AGENT_ID}/id-files`],
    ['get', `/api/admin/agent-manager/id-files/${fileId}`],
    ['get', `/api/admin/agent-manager/id-files/${fileId}?download=1`],
    ['get', `/api/admin/agent-manager/agents/${AGENT_ID}/signup-id`],
    ['delete', `/api/admin/agent-manager/id-files/${fileId}`]
  ];
  const callers = {
    anonymous: {},
    'wrong api key': { 'x-api-key': 'nope' },
    'agent user': { Authorization: bearer('aaaaaaaa-0000-4000-8000-000000000003') },
    'public user': { Authorization: bearer('aaaaaaaa-0000-4000-8000-000000000004') },
    moderator: { Authorization: bearer('aaaaaaaa-0000-4000-8000-000000000005') },
    'forged token': { Authorization: `Bearer ${jwt.sign({ sub: 'aaaaaaaa-0000-4000-8000-000000000001' }, 'not-the-secret')}` }
  };
  for (const [who, headers] of Object.entries(callers)) {
    for (const [method, url] of probes) {
      const res = await request(app)[method](url).set(headers).send(method === 'post' ? { kind: 'id_front', data_url: 'data:image/jpeg;base64,AAAA' } : undefined);
      assert.ok([401, 403].includes(res.status), `${who} ${method.toUpperCase()} ${url} → ${res.status}`);
      assert.ok(!res.headers['content-type'] || /json/.test(res.headers['content-type']), 'no file bytes leak');
    }
  }
  assert.equal(FILES.length, 0, 'nothing was stored by a refused caller');
  assert.equal(AUDIT.length, 0);
});

test('staff upload front and back, view and download with private headers, replace keeps the old file', async () => {
  const app = buildApp();
  const front = await fakeIdPhoto('SAMPLE - NOT A REAL ID', { gps: true });
  assert.ok((await sharp(front).metadata()).exif, 'the test photo really carries EXIF');

  const up = await request(app).post(`/api/admin/agent-manager/agents/${AGENT_ID}/id-files`).set('Authorization', RONALD)
    .send({ kind: 'id_front', data_url: dataUrl(front), name: 'front.jpg' });
  assert.equal(up.status, 201, JSON.stringify(up.body));
  const frontId = up.body.data.file.id;
  assert.equal(up.body.data.file.metadata_stripped, true);
  assert.equal(up.body.data.file.content, undefined, 'bytes are never sent back in JSON');
  assert.equal((await sharp(FILES[0].content).metadata()).exif, undefined, 'EXIF/GPS stripped before storing');

  const back = await request(app).post(`/api/admin/agent-manager/agents/${AGENT_ID}/id-files`).set('Authorization', KING)
    .send({ kind: 'id_back', data_url: dataUrl(await fakeIdPhoto('SAMPLE BACK')), name: 'back.jpg' });
  assert.equal(back.status, 201);

  const view = await request(app).get(`/api/admin/agent-manager/id-files/${frontId}`).set('Authorization', RONALD).buffer(true).parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
  assert.equal(view.status, 200);
  assert.equal(view.headers['content-type'], 'image/jpeg');
  assert.match(view.headers['cache-control'], /no-store/);
  assert.match(view.headers['x-robots-tag'], /noindex/);
  assert.equal(view.headers['x-content-type-options'], 'nosniff');
  assert.match(view.headers['content-disposition'], /^inline;/);
  assert.equal(sniffIdFileMime(view.body), 'image/jpeg');

  const dl = await request(app).get(`/api/admin/agent-manager/id-files/${frontId}?download=1`).set('x-api-key', process.env.ADMIN_API_KEY);
  assert.equal(dl.status, 200);
  assert.match(dl.headers['content-disposition'], /^attachment; filename="Test-Agent-id-front-\d{4}-\d{2}-\d{2}\.jpg"/);

  const replace = await request(app).post(`/api/admin/agent-manager/agents/${AGENT_ID}/id-files`).set('Authorization', RONALD)
    .send({ kind: 'id_front', data_url: dataUrl(await fakeIdPhoto('SAMPLE V2')), name: 'front2.jpg' });
  assert.equal(replace.status, 201);
  assert.equal(replace.body.data.replaced_file_id, frontId);
  const old = FILES.find((f) => f.id === frontId);
  assert.ok(old.archived_at, 'old front archived, not deleted');
  assert.equal(old.replaced_by, replace.body.data.file.id);
  assert.equal(FILES.filter((f) => f.kind === 'id_front' && !f.archived_at).length, 1);

  const list = await request(app).get(`/api/admin/agent-manager/agents/${AGENT_ID}/id-files`).set('Authorization', RONALD);
  assert.equal(list.status, 200);
  assert.match(list.headers['cache-control'], /no-store/);
  assert.equal(list.body.data.files.length, 3);
  assert.ok(list.body.data.signup, 'sign-up file listed');
  assert.ok(list.body.data.files.every((f) => f.content === undefined));

  const actions = AUDIT.map((a) => a.action);
  assert.deepEqual(actions, ['admin_agent_id_file_uploaded', 'admin_agent_id_file_uploaded', 'admin_agent_id_file_viewed', 'admin_agent_id_file_downloaded', 'admin_agent_id_file_replaced']);
  assert.ok(AUDIT.every((a) => a.details.agent_id === AGENT_ID && a.details.by), 'every entry names the agent and who did it');
  assert.equal(AUDIT[0].details.by, 'Ronald Staff');
  assert.equal(AUDIT[1].details.by, 'King Owner');
});

test('sign-up ID is readable read-only by staff and audited', async () => {
  const app = buildApp();
  const before = AUDIT.length;
  const res = await request(app).get(`/api/admin/agent-manager/agents/${AGENT_ID}/signup-id`).set('Authorization', RONALD);
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'image/png');
  assert.match(res.headers['cache-control'], /no-store/);
  assert.match(res.headers['x-robots-tag'], /noindex/);
  assert.equal(AUDIT[before].action, 'admin_agent_signup_id_viewed');
});

test('permanent delete is super_admin only, archived files only, with a reason', async () => {
  const app = buildApp();
  const archived = FILES.find((f) => f.archived_at);
  const live = FILES.find((f) => !f.archived_at);
  assert.equal((await request(app).delete(`/api/admin/agent-manager/id-files/${archived.id}`).set('Authorization', RONALD).send({ reason: 'mistake upload' })).status, 403);
  assert.equal((await request(app).delete(`/api/admin/agent-manager/id-files/${archived.id}`).set('x-api-key', process.env.ADMIN_API_KEY).send({ reason: 'mistake upload' })).status, 403);
  assert.equal((await request(app).delete(`/api/admin/agent-manager/id-files/${live.id}`).set('Authorization', KING).send({ reason: 'mistake upload' })).status, 409);
  assert.equal((await request(app).delete(`/api/admin/agent-manager/id-files/${archived.id}`).set('Authorization', KING).send({})).status, 400);
  const ok = await request(app).delete(`/api/admin/agent-manager/id-files/${archived.id}`).set('Authorization', KING).send({ reason: 'uploaded to the wrong agent' });
  assert.equal(ok.status, 200);
  assert.ok(!FILES.some((f) => f.id === archived.id));
  assert.equal(AUDIT.at(-1).action, 'admin_agent_id_file_deleted');
});

test('upload checks: type is sniffed from the bytes, 10 MB cap, kind required, PDF kept as is', async () => {
  await assert.rejects(prepareIdFileUpload({ kind: 'selfie', dataUrl: dataUrl(await fakeIdPhoto('x')) }), /ID front, ID back/);
  await assert.rejects(prepareIdFileUpload({ kind: 'id_front', dataUrl: 'https://example.com/id.jpg' }), /Choose a photo/);
  await assert.rejects(prepareIdFileUpload({ kind: 'id_front', dataUrl: dataUrl(Buffer.from('<html><script>alert(1)</script></html>'), 'image/jpeg') }), /Only JPG, PNG, WebP, HEIC/);
  await assert.rejects(prepareIdFileUpload({ kind: 'id_front', dataUrl: dataUrl(Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(ID_FILE_MAX_BYTES)]), 'application/pdf') }), /over 10 MB/);
  const pdfBytes = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
  const pdf = await prepareIdFileUpload({ kind: 'other', dataUrl: dataUrl(pdfBytes, 'application/pdf'), name: '../../licence.pdf' });
  assert.equal(pdf.mime_type, 'application/pdf');
  assert.equal(pdf.label, 'Other document');
  assert.equal(pdf.original_name, '.._.._licence.pdf');
  assert.ok(pdf.content.equals(pdfBytes));
  const png = await prepareIdFileUpload({ kind: 'id_back', dataUrl: dataUrl(await sharp({ create: { width: 40, height: 30, channels: 3, background: '#fff' } }).png().toBuffer(), 'image/png') });
  assert.equal(png.mime_type, 'image/jpeg');
  assert.equal(png.metadata_stripped, true);
  // An undecodable HEIC is kept as it came, download only.
  const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.alloc(64)]);
  const kept = await prepareIdFileUpload({ kind: 'id_front', dataUrl: dataUrl(heic, 'image/heic') });
  assert.equal(kept.mime_type, 'image/heic');
  assert.equal(kept.metadata_stripped, false);
  const h = privateFileHeaders({ mimeType: 'image/jpeg', filename: 'a"b.jpg', download: true });
  assert.equal(h['Content-Disposition'], 'attachment; filename="ab.jpg"');
});

test('wiring: private storage, staff gate, list chip and filter, NIN rule unchanged', () => {
  const migration = read('db', 'migrations', '190_agent_identity_files.sql');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS agent_identity_files/);
  assert.match(migration, /content BYTEA NOT NULL/);
  assert.match(migration, /WHERE archived_at IS NULL AND kind IN \('id_front', 'id_back'\)/);
  assert.doesNotMatch(migration, /\b(UPDATE|DELETE|DROP|INSERT)\b/i, 'migration changes no existing data');
  const rollback = read('scripts', 'rollback-190-agent-identity-files.sql');
  assert.match(rollback, /RENAME TO data_change_190_agent_identity_files_archive/);
  assert.doesNotMatch(rollback, /DROP TABLE/i, 'rollback keeps the uploaded files');

  const routes = read('routes', 'adminAgentIdFiles.js');
  assert.doesNotMatch(routes, /storeDataUrl|uploadBufferToS3|S3_PUBLIC_BASE_URL/, 'ID files never go to the media bucket');
  const admin = read('routes', 'admin.js');
  assert.ok(admin.indexOf('router.use(requireAdminApiKey)') < admin.indexOf('registerAgentManagerRoutes(router'), 'the admin gate runs before the agent manager (and its ID file routes)');
  const manager = read('routes', 'adminAgentManager.js');
  assert.match(manager, /registerAgentIdFileRoutes\(router/);
  assert.match(manager, /'id_doc_missing'/);
  assert.match(manager, /id_document_missing/);

  const { idStillNeeded } = require('../routes/adminAgentManager');
  assert.equal(idStillNeeded({ status: 'approved', nin: '', has_id_front_file: true, has_id_document: true }), true, 'a photo alone does not clear the NIN reminder');
  assert.equal(idStillNeeded({ status: 'approved', nin: 'CM900' }), false, 'the NIN still clears it');

  const app = read('assets', 'makaug-app.js');
  for (const text of ['ID document: on file', 'ID document: missing', 'ID document missing', '<h5 class="font-black text-gray-900">ID documents</h5>', 'Upload ${label}', 'Replace ${label}', 'Older versions', 'ID from sign-up', 'ID document viewed', 'ID document replaced (old one kept)']) {
    assert.ok(app.includes(text), `UI has “${text}”`);
  }
  assert.match(app, /adminAgentManagerIdBlob\(/);
  assert.doesNotMatch(app, /<img src="\$\{[^}]*\/api\/admin\/agent-manager\/id-files/, 'files are never linked directly');
});
