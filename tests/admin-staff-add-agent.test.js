'use strict';

// Staff "Add agent": the form must save a real row, show it at once, clear a
// missing ID when a NIN is given, grant the verified tick when the standing
// rule is met, and refuse a duplicate phone or NIN with a link — not a crash.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { execFileSync } = require('child_process');
const { Pool } = require('pg');
const express = require('express');
const request = require('supertest');
const { registerAgentManagerRoutes, maskPhone } = require('../routes/adminAgentManager');
const { onAgentAdded } = require('../services/agentAddedHook');
const { cleanText, isValidEmail } = require('../middleware/validation');
const { normalizeUgPhone } = require('../utils/adminOtpOverride');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

// Built from pieces so the source never contains a full phone number.
function phone(last3) {
  return `+256${'700'}${'000'}${last3}`;
}

const PG_BIN = [process.env.LFM_PG_BIN, '/usr/lib/postgresql/16/bin', '/usr/lib/postgresql/17/bin', '/usr/lib/postgresql/18/bin']
  .filter(Boolean)
  .find((dir) => fs.existsSync(path.join(dir, 'initdb')) && fs.existsSync(path.join(dir, 'pg_ctl')));

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

test('phone numbers in this feature are masked as +256•••123', () => {
  assert.equal(maskPhone(phone('123')), '+256•••123');
  assert.equal(maskPhone(''), '');
  const hook = read('services', 'agentAddedHook.js');
  const route = read('routes', 'adminAgentManager.js');
  assert.match(hook, /queueAgentWelcomePack\(\{ agentId \}\)/);
  assert.match(hook, /Nothing is sent from the Add agent form/);
  assert.doesNotMatch(hook, /require\(['"]\.\.\/routes\/whatsapp/);
  assert.doesNotMatch(route, /require\(['"]\.\.\/routes\/whatsapp/);
  const ui = read('assets', 'makaug-app.js');
  assert.match(ui, /This form does not send them a WhatsApp message/);
  assert.match(ui, /function adminAgentManagerReadAddForm/);
  assert.match(ui, /Added by staff · /);
  assert.match(ui, /data-agent-add-duplicate/);
  assert.match(ui, /ID number \(NIN\) — add or replace/);
});

test('a staff-added agent is saved, listed, ticked and deduped', {
  skip: PG_BIN ? false : 'Install PostgreSQL or set LFM_PG_BIN for the isolated database test.'
}, async (t) => {
  const port = await freePort();
  const cluster = fs.mkdtempSync(path.join(os.tmpdir(), 'staff-add-agent-'));
  const data = path.join(cluster, 'data');
  const socket = path.join(cluster, 'sock');
  fs.mkdirSync(socket);
  let pool;
  const stopPg = () => {
    try {
      execFileSync(path.join(PG_BIN, 'pg_ctl'), ['-D', data, '-w', '-t', '20', 'stop'], { stdio: 'pipe' });
    } catch (_) { /* already stopped */ }
  };
  try {
    execFileSync(path.join(PG_BIN, 'initdb'), ['-D', data, '--username=staffadd', '--auth=trust', '--encoding=UTF8', '--no-locale'], { stdio: 'pipe' });
    execFileSync(path.join(PG_BIN, 'pg_ctl'), ['-D', data, '-l', path.join(cluster, 'postgres.log'), '-w', '-t', '20',
      '-o', `-h 127.0.0.1 -p ${port} -k '${socket}' -c fsync=off -c synchronous_commit=off`, 'start'], { stdio: 'pipe' });
    pool = new Pool({ host: '127.0.0.1', port, user: 'staffadd', database: 'postgres', ssl: false });
    const db = { query: (...args) => pool.query(...args), getClient: () => pool.connect() };
    await db.query(`
      CREATE TABLE users (
        id uuid PRIMARY KEY, first_name text, last_name text, email text, phone text, role text, status text
      );
      CREATE TABLE agents (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        full_name text NOT NULL,
        company_name text,
        licence_number text NOT NULL UNIQUE,
        phone text UNIQUE,
        whatsapp text,
        email text UNIQUE,
        districts_covered text[] NOT NULL DEFAULT '{}',
        specializations text[] NOT NULL DEFAULT '{}',
        nin text,
        bio text,
        status text NOT NULL DEFAULT 'pending',
        registration_status text NOT NULL DEFAULT 'registered',
        id_expiry_date date,
        agent_application_channel text NOT NULL DEFAULT 'web',
        registered_by_name text,
        verification_reason text,
        paid_until date,
        fee_exempt boolean NOT NULL DEFAULT false,
        fee_exempt_reason text,
        monthly_fee_ugx integer,
        billing_plan text,
        approved_at timestamptz,
        pay_link_on_approval boolean NOT NULL DEFAULT true,
        removed_at timestamptz,
        removed_reason text,
        contact_phone_verified_at timestamptz,
        identity_document_url text,
        licence_check text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        user_id uuid,
        makaug_agent_number text,
        paid_awaiting_approval_at timestamptz,
        fee_offer_mode text,
        fee_offer_at timestamptz,
        fee_offer_until date,
        plan_started_on date,
        last_payment_on date,
        last_payment_ugx integer,
        experience_years integer,
        greeting_name text
      );
      CREATE TABLE properties (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_id uuid,
        status text,
        has_public_media boolean DEFAULT false,
        created_at timestamptz DEFAULT now()
      );
      CREATE TABLE revenue_entries (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_id uuid, kind text, direction text, voided_at timestamptz,
        amount_ugx bigint, paid_at timestamptz, recorded_at timestamptz DEFAULT now(),
        period_start date, period_end date
      );
      CREATE TABLE agent_identity_files (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_id uuid, kind text, archived_at timestamptz
      );
      CREATE TABLE agent_number_aliases (
        alias text PRIMARY KEY, agent_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    const staffId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    await db.query(
      `INSERT INTO users (id, first_name, last_name, email, role, status) VALUES ($1, 'Amina', 'Okello', 'amina@example.com', 'admin', 'active')`,
      [staffId]
    );
    const audits = [];
    const hooks = [];
    const stopHook = onAgentAdded((event) => { hooks.push(event); });
    t.after(stopHook);
    const app = express();
    app.use(express.json());
    const router = express.Router();
    registerAgentManagerRoutes(router, {
      db,
      writeAudit: async (action, details, actorId) => { audits.push({ action, details, actorId }); },
      adminActorId: (req) => req.adminAuth?.userId || req.adminAuth?.type || 'admin_api_key',
      cleanText,
      isValidEmail,
      normalizePhone: (value) => normalizeUgPhone(value),
      actorLabel: (user) => [user.first_name, user.last_name].filter(Boolean).join(' ') || 'staff',
      onListingsChanged: () => {},
      loadRequestUser: async () => ({ id: staffId, first_name: 'Amina', last_name: 'Okello', role: 'admin', email: 'amina@example.com' })
    });
    app.use((req, _res, next) => {
      req.adminAuth = req.get('x-test-auth') === 'key'
        ? { type: 'api_key' }
        : { type: 'bearer', userId: staffId, role: 'admin' };
      next();
    });
    app.use('/api/admin', router);
    app.use((error, _req, res, next) => {
      if (res.headersSent) return next(error);
      res.status(error.status || 500).json({ ok: false, error: error.message, code: error.code || '' });
    });

    const post = (body, headers = {}) => request(app).post('/api/admin/agent-manager/agents').set(headers).send(body);
    const listed = async () => (await request(app).get('/api/admin/agent-manager/agents').expect(200)).body.data;

    await t.test('an empty body is refused instead of saving a blank agent', async () => {
      const res = await post({}).expect(400);
      assert.match(res.body.error, /did not reach the server/);
      assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM agents')).rows[0].n, 0);
    });

    let unpaidId;
    await t.test('unpaid pending agent appears in the list as added by the staff member', async () => {
      hooks.length = 0;
      const res = await post({
        full_name: 'Pending Agent',
        phone: `0${'700'}${'000'}${'202'}`,
        company_name: 'Pending Co',
        districts_covered: 'Wakiso, Kampala',
        status: 'pending',
        payment_status: 'unpaid'
      }).expect(201);
      const data = res.body.data;
      unpaidId = data.id;
      assert.equal(data.status, 'pending');
      assert.equal(data.agent_application_channel, 'staff_added');
      assert.equal(data.registered_by_name, 'Amina Okello');
      assert.equal(data.payment.key, 'unpaid');
      assert.equal(data.has_nin, false);
      assert.equal(data.verified_by_makaug, false);
      assert.equal(data.welcome.sent, false);
      const row = (await listed()).find((item) => item.id === unpaidId);
      assert.ok(row, 'the new agent is in the Agents list');
      assert.equal(row.agent_application_channel, 'staff_added');
      assert.equal(row.registered_by_name, 'Amina Okello');
      assert.equal(row.payment.key, 'unpaid');
      assert.equal(row.status, 'pending');
      assert.equal(hooks.at(-1).agent_id, unpaidId);
      assert.equal(hooks.at(-1).payment_status, 'unpaid');
      assert.equal(hooks.at(-1).added_by_name, 'Amina Okello');
      assert.equal('phone' in hooks.at(-1), false);
      const added = audits.filter((entry) => entry.action === 'agent_added' && entry.details.agent_id === unpaidId);
      assert.equal(added.length, 1);
      const dumped = JSON.stringify(added[0]);
      assert.equal(dumped.includes(phone('202').replace(/\D/g, '')), false);
      assert.equal(dumped.includes('+256'), false);
    });

    await t.test('the API key still records the signed-in staff name', async () => {
      const res = await post({
        full_name: 'Key Bound Agent',
        phone: phone('203'),
        status: 'pending',
        payment_status: 'free',
        fee_exempt_reason: 'Staff training'
      }, { 'x-test-auth': 'key' }).expect(201);
      assert.equal(res.body.data.registered_by_name, 'Amina Okello');
      assert.equal(res.body.data.payment.key, 'free');
      const row = (await listed()).find((item) => item.id === res.body.data.id);
      assert.equal(row.registered_by_name, 'Amina Okello');
      assert.equal(row.payment.key, 'free');
    });

    let approvedId;
    await t.test('a NIN clears missing ID and an approved complete agent gets the verified tick', async () => {
      const res = await post({
        full_name: 'Verified Agent',
        phone: phone('204'),
        nin: 'cm 1234 5678 abcd',
        districts_covered: 'Kampala',
        status: 'approved',
        payment_status: 'paid',
        paid_until: '2099-01-01'
      }).expect(201);
      approvedId = res.body.data.id;
      assert.equal(res.body.data.has_nin, true);
      assert.equal(res.body.data.id_still_needed, false);
      assert.equal(res.body.data.verified_by_makaug, true);
      assert.equal(res.body.data.status, 'approved');
      assert.equal(res.body.data.payment.key, 'paid');
      const row = (await listed()).find((item) => item.id === approvedId);
      assert.equal(row.has_nin, true);
      assert.equal(row.id_still_needed, false);
      assert.equal(row.verified_by_makaug, true);
      assert.equal(row.payment.key, 'paid');
      const reason = (await db.query('SELECT verification_reason FROM agents WHERE id = $1', [approvedId])).rows[0].verification_reason;
      assert.match(reason, /\[STAFF_REVIEWED_PRIVATE_ID_PROFILE\]/);
      assert.match(reason, /\[AUTO_VERIFIED_COMPLETE_DETAILS\]/);
    });

    await t.test('adding the ID later from the agent panel clears missing ID and grants the tick', async () => {
      const created = await post({
        full_name: 'ID Later Agent',
        phone: phone('205'),
        status: 'approved',
        payment_status: 'unpaid'
      }).expect(201);
      assert.equal(created.body.data.has_nin, false);
      assert.equal(created.body.data.id_still_needed, true);
      assert.equal(created.body.data.verified_by_makaug, false);
      const patched = await request(app)
        .patch(`/api/admin/agent-manager/agents/${created.body.data.id}`)
        .send({ nin: 'CF9876543210XY' })
        .expect(200);
      assert.ok(patched.body.data.changed.includes('nin'));
      const row = (await listed()).find((item) => item.id === created.body.data.id);
      assert.equal(row.has_nin, true);
      assert.equal(row.id_still_needed, false);
      assert.equal(row.verified_by_makaug, true);
    });

    await t.test('a duplicate phone or NIN returns the existing agent and does not crash', async () => {
      const before = (await db.query('SELECT COUNT(*)::int AS n FROM agents')).rows[0].n;
      const phoneDup = await post({
        full_name: 'Phone Duplicate',
        phone: `256${'700'}${'000'}${'204'}`,
        status: 'pending',
        payment_status: 'unpaid'
      }).expect(409);
      assert.equal(phoneDup.body.existing_agent_id, approvedId);
      assert.equal(phoneDup.body.duplicate_field, 'phone');
      assert.match(phoneDup.body.error, /Open that agent instead/);
      assert.equal(JSON.stringify(phoneDup.body).includes(phone('204').replace(/\D/g, '')), false);
      const ninDup = await post({
        full_name: 'NIN Duplicate',
        phone: phone('206'),
        nin: 'CM12345678ABCD',
        status: 'pending',
        payment_status: 'unpaid'
      }).expect(409);
      assert.equal(ninDup.body.existing_agent_id, approvedId);
      assert.equal(ninDup.body.duplicate_field, 'nin');
      assert.match(ninDup.body.error, /ID number/);
      const after = (await db.query('SELECT COUNT(*)::int AS n FROM agents')).rows[0].n;
      assert.equal(after, before);
      const replace = await request(app)
        .patch(`/api/admin/agent-manager/agents/${unpaidId}`)
        .send({ nin: 'CM12345678ABCD' })
        .expect(409);
      assert.equal(replace.body.existing_agent_id, approvedId);
      assert.equal(replace.body.duplicate_field, 'nin');
    });
  } finally {
    if (pool) await pool.end().catch(() => {});
    stopPg();
    fs.rmSync(cluster, { recursive: true, force: true });
  }
});
