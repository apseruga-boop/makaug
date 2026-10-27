'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { Pool } = require('pg');
const express = require('express');
const request = require('supertest');
const { paymentHistory, validatedPayment, recordManagerPayment } = require('../services/adminManagerPaymentService');
const { registerAgentManagerRoutes } = require('../routes/adminAgentManager');

const PG_BIN = [process.env.LFM_PG_BIN, '/opt/homebrew/opt/postgresql@16/bin', '/usr/lib/postgresql/16/bin',
  '/usr/lib/postgresql/17/bin', '/usr/lib/postgresql/18/bin'].filter(Boolean)
  .find((dir) => fs.existsSync(path.join(dir, 'initdb')) && fs.existsSync(path.join(dir, 'pg_ctl')));

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); });
  });
}

test('manager payment validation rejects malformed amount, date and negative values', () => {
  for (const amount_ugx of [-50000, '50,000oops', 1.5, 0, '']) {
    assert.throws(() => validatedPayment({ amount_ugx, method: 'cash', note: 'Ronald received cash' }), /positive whole amount/);
  }
  for (const paid_at of ['not-a-date', '2026-02-30', '2099-01-01']) {
    assert.throws(() => validatedPayment({ amount_ugx: 50000, method: 'cash', note: 'Ronald received cash', paid_at }), /valid payment date/);
  }
  assert.throws(() => validatedPayment({ method: 'revolut_card', amount_usd: '-15', reference: 'CARD-RECEIPT' }), /positive amount in US dollars/);
  for (const method of ['ABSA_USD', ' ABSA_USD ', ' REVOLUT_CARD ']) {
    assert.throws(() => validatedPayment({ method, amount_ugx: 50000, amount_original: '-15', reference: 'CARD-RECEIPT' }), /positive amount in US dollars/);
  }
  assert.equal(validatedPayment({ method: ' ABSA_USD ', amount_original: '15', reference: 'CARD-RECEIPT' }).method, 'absa_usd');
  for (const payment of [
    { amount_original: '10000000000000000', fx_rate_ugx: 3700 },
    { amount_original: '15000', fx_rate_ugx: 9000 }
  ]) {
    assert.throws(() => validatedPayment({ method: 'absa_usd', reference: 'USD-RECEIPT', ...payment }), /must convert.*100,000,000/);
  }
  assert.equal(validatedPayment({ method: 'absa_usd', amount_original: '15', fx_rate_ugx: 3700, reference: 'USD-RECEIPT' }).amount_original, '15');
});

test('date-only payments use the Kampala calendar day while timestamps must already have happened', () => {
  const body = { amount_ugx: 50000, method: 'cash', note: 'Ronald received cash' };
  const beforeMidnight = new Date('2026-10-27T20:59:00Z');
  const afterMidnight = new Date('2026-10-27T21:01:00Z');
  assert.throws(() => validatedPayment({ ...body, paid_at: '2026-10-28' }, { now: beforeMidnight }), /valid payment date/);
  assert.equal(validatedPayment({ ...body, paid_at: '2026-10-28' }, { now: afterMidnight }).paid_at, '2026-10-28');
  assert.throws(() => validatedPayment({ ...body, paid_at: '2026-10-29' }, { now: afterMidnight }), /valid payment date/);
  assert.throws(() => validatedPayment({ ...body, paid_at: '2026-10-28T00:00:00Z' }, { now: afterMidnight }), /valid payment date/);
  assert.throws(() => validatedPayment({ ...body, paid_at: '2026-10-27T21:02:00Z' }, { now: afterMidnight }), /valid payment date/);
  assert.equal(validatedPayment({ ...body, paid_at: '2026-10-28T00:00:00+03:00' }, { now: afterMidnight }).paid_at,
    '2026-10-28T00:00:00+03:00', 'valid past timestamp with a Kampala timezone offset');
});

test('real PostgreSQL and protected HTTP: history, paid direct Public roster and atomic retry-safe payments', {
  skip: PG_BIN ? false : 'Install PostgreSQL or set LFM_PG_BIN for the isolated database test.'
}, async (t) => {
  const port = await freePort();
  const cluster = fs.mkdtempSync(path.join(os.tmpdir(), 'manager-payments-'));
  const data = path.join(cluster, 'data');
  const socket = path.join(cluster, 'sock');
  fs.mkdirSync(socket);
  let pool;
  try {
    execFileSync(path.join(PG_BIN, 'initdb'), ['-D', data, '--username=payments', '--auth=trust', '--encoding=UTF8', '--no-locale'], { stdio: 'pipe' });
    execFileSync(path.join(PG_BIN, 'pg_ctl'), ['-D', data, '-l', path.join(cluster, 'postgres.log'), '-w', '-t', '20',
      '-o', `-h 127.0.0.1 -p ${port} -k '${socket}' -c fsync=off -c synchronous_commit=off`, 'start'], { stdio: 'pipe' });
    pool = new Pool({ host: '127.0.0.1', port, user: 'payments', database: 'postgres', ssl: false });
    const db = { query: (...args) => pool.query(...args), getClient: () => pool.connect() };
    await db.query(`CREATE TABLE agents (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), full_name text, greeting_name text, phone text, whatsapp text,
      status text DEFAULT 'approved', paid_until date, fee_exempt boolean DEFAULT false, monthly_fee_ugx integer,
      billing_plan text, billing_reminder_log jsonb, billing_suspended_at timestamptz, billing_snapshot jsonb,
      removed_at timestamptz, fee_offer_mode text, fee_offer_until date, fee_offer_at timestamptz, updated_at timestamptz DEFAULT now()
    );
    CREATE TABLE properties (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), agent_id uuid REFERENCES agents(id), title text, inquiry_reference text,
      lister_name text, lister_phone text, status text DEFAULT 'approved', availability_status text DEFAULT 'available',
      source text, listed_via text, extra_fields jsonb DEFAULT '{}', district text, area text,
      created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
      lister_paid_until date, lister_billing_suspended_at timestamptz
    );
    CREATE TABLE revenue_entries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), direction text, kind text, agent_id uuid REFERENCES agents(id),
      property_id uuid REFERENCES properties(id), amount_ugx bigint CHECK (amount_ugx > 0), account_key text, method text,
      reference text, paid_at timestamptz DEFAULT now(), recorded_at timestamptz DEFAULT now(), period_start date, period_end date,
      payer_name text, payer_phone text, note text, receipt_url text, recorded_by text, currency text, amount_original numeric,
      fx_rate_ugx numeric, verified_status text DEFAULT 'unverified', verified_by text, verified_at timestamptz,
      verification_source text, sms_id uuid, voided_at timestamptz
    );
    CREATE UNIQUE INDEX ux_revenue_entries_account_reference ON revenue_entries(account_key, lower(reference))
      WHERE reference IS NOT NULL AND voided_at IS NULL;
    CREATE TABLE money_sms_inbox (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), reference text, matched_entry_id uuid,
      received_at timestamptz DEFAULT now(), amount_ugx bigint);
    CREATE TABLE billing_settings (key text PRIMARY KEY, value jsonb);
    CREATE TABLE audit_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id text, action text, details jsonb, created_at timestamptz DEFAULT now());
    CREATE TABLE users(id uuid PRIMARY KEY, last_login_at timestamptz, email text, role text);
    CREATE TABLE property_moderation_events(id uuid DEFAULT gen_random_uuid(), property_id uuid, status_to text,
      reason text, notes text, created_at timestamptz DEFAULT now());
    CREATE TABLE analytics_events(event_name text, payload jsonb);
    CREATE TABLE leads(listing_id uuid);
    ALTER TABLE agents ADD COLUMN company_name text, ADD COLUMN licence_number text, ADD COLUMN email text,
      ADD COLUMN districts_covered text[], ADD COLUMN specializations text[], ADD COLUMN nin text, ADD COLUMN bio text,
      ADD COLUMN registration_status text, ADD COLUMN created_at timestamptz DEFAULT now(), ADD COLUMN user_id uuid,
      ADD COLUMN identity_document_name text, ADD COLUMN identity_document_type text,
      ADD COLUMN identity_document_uploaded_at timestamptz, ADD COLUMN identity_document_url text,
      ADD COLUMN profile_photo_url text, ADD COLUMN verification_reason text, ADD COLUMN privacy_consent_accepted boolean,
      ADD COLUMN privacy_consent_at timestamptz, ADD COLUMN approved_at timestamptz, ADD COLUMN makaug_agent_number text,
      ADD COLUMN id_expiry_date date, ADD COLUMN experience_years integer, ADD COLUMN contact_phone_verified_at timestamptz,
      ADD COLUMN agent_application_channel text, ADD COLUMN plan text, ADD COLUMN verified_badge boolean,
      ADD COLUMN fee_exempt_reason text, ADD COLUMN removed_reason text, ADD COLUMN plan_started_on date,
      ADD COLUMN last_payment_on date, ADD COLUMN last_payment_ugx bigint, ADD COLUMN removed_by text,
      ADD COLUMN welcome_sent_at timestamptz, ADD COLUMN paid_awaiting_approval_at timestamptz,
      ADD COLUMN registered_by_phone text, ADD COLUMN registered_by_name text, ADD COLUMN pay_link_sent_at timestamptz,
      ADD COLUMN fee_offer_reason text, ADD COLUMN listing_limit integer, ADD COLUMN featured_homepage boolean;
    ALTER TABLE properties ADD COLUMN listing_type text, ADD COLUMN price bigint, ADD COLUMN price_period text,
      ADD COLUMN approved_at timestamptz, ADD COLUMN sold_at timestamptz, ADD COLUMN expires_at timestamptz;
    CREATE TABLE agent_identity_files(id uuid, agent_id uuid, kind text, label text, original_name text, mime_type text,
      byte_size integer, metadata_stripped boolean, uploaded_by text, uploaded_by_label text, uploaded_at timestamptz,
      archived_at timestamptz, archived_by text, archived_reason text, replaced_by uuid);`);
    await db.query(fs.readFileSync(path.join(__dirname, '../db/migrations/194_dashboard_payment_requests.sql'), 'utf8').replace("SET LOCAL lock_timeout = '8s';", ''));
    const agent = (await db.query(`INSERT INTO agents(full_name, phone, whatsapp) VALUES ('Charles test', '256700000001', '256700000001') RETURNING *`)).rows[0];
    const direct = (await db.query(`INSERT INTO properties(title, inquiry_reference, lister_name, lister_phone)
      VALUES ('Direct owner property', 'MK-PUBLIC-TEST', 'Jane owner', '256700000002') RETURNING *`)).rows[0];
    const sourced = (await db.query(`INSERT INTO properties(title, source, lister_name, lister_phone)
      VALUES ('Harvested property', 'found_online_property_source_v1', 'Harvest contact', '256700000003') RETURNING *`)).rows[0];
    const agentProperty = (await db.query(`INSERT INTO properties(title, agent_id) VALUES ('Agent property', $1) RETURNING *`, [agent.id])).rows[0];
    const cash = { amount_ugx: 50000, method: 'cash', note: 'Ronald received and holds cash', request_id: crypto.randomUUID() };
    const actor = 'test-owner';
    const app = express();
    app.use(express.json());
    app.use('/api/admin', (req, res, next) => req.get('x-test-owner') === 'yes' ? next() : res.status(401).json({ ok: false }));
    const router = express.Router();
    const deps = { db, cleanText: (v) => String(v || '').trim(), adminActorId: () => actor, onListingsChanged: () => {},
      writeAudit: async () => {}, isValidEmail: () => true, normalizePhone: (v) => v, actorLabel: () => 'Owner' };
    registerAgentManagerRoutes(router, deps);
    app.use('/api/admin', router);
    app.use((error, req, res, next) => res.status(error.status || 500).json({ ok: false, error: error.message }));
    const auth = (req) => req.set('x-test-owner', 'yes');

    await t.test('unauthorized Public and agent payment paths reject before any query/write', async () => {
      await request(app).get('/api/admin/agent-manager/public').expect(401);
      await request(app).post(`/api/admin/agent-manager/agents/${agent.id}/payments`).send(cash).expect(401);
      await request(app).post(`/api/admin/agent-manager/public/${direct.id}/payments`).send(cash).expect(401);
      assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM revenue_entries')).rows[0].n, 0);
    });

    await t.test('Public roster starts empty and candidate search excludes agent and harvested listings', async () => {
      assert.deepEqual((await auth(request(app).get('/api/admin/agent-manager/public')).expect(200)).body.data, []);
      const found = (await auth(request(app).get('/api/admin/agent-manager/public/candidates?search=property')).expect(200)).body.data;
      assert.deepEqual(found.map((r) => r.id), [direct.id]);
    });

    await t.test('concurrent retries of cash receipt write one ledger row and extend one month', async () => {
      const results = await Promise.all([1, 2].map(() => auth(request(app).post(`/api/admin/agent-manager/agents/${agent.id}/payments`)).send(cash).expect(200)));
      assert.equal(results[0].body.data.entry.id, results[1].body.data.entry.id);
      assert.equal(results.filter((r) => r.body.data.replayed).length, 1);
      assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM revenue_entries WHERE agent_id = $1', [agent.id])).rows[0].n, 1);
      await auth(request(app).post(`/api/admin/agent-manager/agents/${agent.id}/payments`)).send({ ...cash, amount_ugx: 100000 }).expect(409);
      assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM revenue_entries WHERE agent_id = $1', [agent.id])).rows[0].n, 1);
    });

    await t.test('new unique agent receipts extend sequentially, duplicate transaction rolls back', async () => {
      const before = (await db.query('SELECT paid_until::text FROM agents WHERE id=$1', [agent.id])).rows[0].paid_until;
      const receipt = { amount_ugx: 50000, method: 'mtn_momo', reference: 'REAL-RECEIPT-001', request_id: crypto.randomUUID() };
      await auth(request(app).post(`/api/admin/agent-manager/agents/${agent.id}/payments`)).send(receipt).expect(200);
      const after = (await db.query('SELECT paid_until::text FROM agents WHERE id=$1', [agent.id])).rows[0].paid_until;
      assert.ok(after > before);
      await auth(request(app).post(`/api/admin/agent-manager/agents/${agent.id}/payments`)).send({ ...receipt, request_id: crypto.randomUUID() }).expect(409);
      assert.equal((await db.query('SELECT paid_until::text FROM agents WHERE id=$1', [agent.id])).rows[0].paid_until, after);
    });

    await t.test('lifetime total includes all pages and excludes voided payments', async () => {
      await db.query(`INSERT INTO revenue_entries(direction, kind, agent_id, amount_ugx, method, account_key, paid_at)
        SELECT 'in', 'agent_subscription', $1, 1000, 'cash', 'cash', now() - interval '1 year' - n * interval '1 day' FROM generate_series(1,27) n`, [agent.id]);
      await db.query(`INSERT INTO revenue_entries(direction, kind, agent_id, amount_ugx, method, account_key, voided_at)
        VALUES ('in', 'agent_subscription', $1, 999999, 'cash', 'cash', now())`, [agent.id]);
      const first = await paymentHistory(db, { kind: 'agent_subscription', id: agent.id, page: 1, limit: 25 });
      const second = await paymentHistory(db, { kind: 'agent_subscription', id: agent.id, page: 2, limit: 25 });
      assert.equal(first.payment_summary.lifetime_paid_ugx, 127000);
      assert.deepEqual(first.payment_pagination, { page: 1, limit: 25, total: 29, pages: 2 });
      assert.equal(first.payments.length, 25);
      assert.equal(second.payments.length, 4);
      assert.equal(second.payment_summary.lifetime_paid_ugx, 127000);
      assert.equal(new Set([...first.payments, ...second.payments].map((r) => r.id)).size, 29);
    });

    await t.test('agent detail returns full payment summary and reasons for rejected and removed listings', async () => {
      const rejected = (await db.query(`INSERT INTO properties(title, agent_id, status) VALUES ('Rejected listing', $1, 'rejected') RETURNING id`, [agent.id])).rows[0];
      const deleted = (await db.query(`INSERT INTO properties(title, agent_id, status) VALUES ('Removed listing', $1, 'deleted') RETURNING id`, [agent.id])).rows[0];
      await db.query(`INSERT INTO property_moderation_events(property_id, status_to, reason)
        VALUES ($1, 'rejected', 'Duplicate footage'), ($2, 'deleted', 'Owner requested removal')`, [rejected.id, deleted.id]);
      const response = await auth(request(app).get(`/api/admin/agent-manager/agents/${agent.id}?payments_page=2&payments_limit=25`)).expect(200);
      const detail = response.body.data;
      assert.equal(detail.payment_summary.lifetime_paid_ugx, 127000);
      assert.equal(detail.payments.length, 4);
      assert.equal(detail.payment_pagination.total, 29);
      assert.equal(detail.agent.tracker.last_payment_ugx, 50000, 'tracker uses latest payment, even when history page 2 is open');
      assert.equal(detail.listings.find((r) => r.id === agentProperty.id).public_url, `/property/${agentProperty.id}`);
      for (const [id, reason] of [[rejected.id, 'Duplicate footage'], [deleted.id, 'Owner requested removal']]) {
        const listing = detail.listings.find((r) => r.id === id);
        assert.equal(listing.public_url, null);
        assert.equal(listing.moderation_reason, reason);
        assert.ok(listing.moderation_at);
      }
    });

    await t.test('Public payments reject harvested/agent inventory and show only paid direct record', async () => {
      for (const id of [sourced.id, agentProperty.id]) {
        await auth(request(app).post(`/api/admin/agent-manager/public/${id}/payments`)).send({ ...cash, request_id: crypto.randomUUID() }).expect(404);
      }
      const paid = await auth(request(app).post(`/api/admin/agent-manager/public/${direct.id}/payments`)).send({ ...cash, request_id: crypto.randomUUID() }).expect(200);
      await db.query(`INSERT INTO revenue_entries(direction, kind, property_id, amount_ugx, method, account_key)
        VALUES ('in', 'listing_fee', $1, 50000, 'cash', 'cash'), ('in', 'listing_fee', $2, 50000, 'cash', 'cash')`, [sourced.id, agentProperty.id]);
      const result = (await auth(request(app).get('/api/admin/agent-manager/public')).expect(200)).body;
      assert.equal(result.pagination.total, 1);
      assert.equal(result.data[0].id, direct.id);
      assert.equal(result.data[0].lifetime_paid_ugx, 50000);
      assert.equal(result.data[0].public_url, `/property/${direct.id}`);
      const detail = (await auth(request(app).get(`/api/admin/agent-manager/public/${direct.id}?payments_limit=1`)).expect(200)).body.data;
      assert.equal(detail.payments[0].id, paid.body.data.entry.id);
      assert.equal(detail.payment_summary.lifetime_paid_ugx, 50000);
      await db.query("UPDATE properties SET status = 'hidden' WHERE id=$1", [direct.id]);
      assert.equal((await auth(request(app).get(`/api/admin/agent-manager/public/${direct.id}`)).expect(200)).body.data.listing.public_url, null);
    });

    await t.test('agent reinstatement shares payment transaction and suppresses WhatsApp notification', async () => {
      await db.query("UPDATE properties SET status='hidden' WHERE id=$1", [agentProperty.id]);
      await db.query(`UPDATE agents SET status='suspended', billing_suspended_at=now(), billing_snapshot=$2::jsonb WHERE id=$1`,
        [agent.id, JSON.stringify({ previous_status: 'approved', listings: [{ id: agentProperty.id, previous_status: 'approved' }] })]);
      const result = await recordManagerPayment(db, { kind: 'agent_subscription', id: agent.id, body: { ...cash, request_id: crypto.randomUUID() }, actor });
      assert.deepEqual(result.reinstatement, { reinstated: true, listings_restored: 1, notice: null });
      assert.equal((await db.query('SELECT status FROM agents WHERE id=$1', [agent.id])).rows[0].status, 'approved');
      assert.equal((await db.query('SELECT status FROM properties WHERE id=$1', [agentProperty.id])).rows[0].status, 'approved');
    });

    await t.test('audit failure rolls back money, entitlement and idempotency record together', async () => {
      const before = (await db.query('SELECT paid_until::text FROM agents WHERE id=$1', [agent.id])).rows[0].paid_until;
      const id = crypto.randomUUID();
      await db.query(`ALTER TABLE audit_logs ADD CONSTRAINT test_reject_audit CHECK (actor_id <> 'reject-this')`);
      await assert.rejects(() => recordManagerPayment(db, { kind: 'agent_subscription', id: agent.id, body: { ...cash, request_id: id }, actor: 'reject-this' }), /test_reject_audit/);
      assert.equal((await db.query('SELECT paid_until::text FROM agents WHERE id=$1', [agent.id])).rows[0].paid_until, before);
      assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM dashboard_payment_requests WHERE request_id=$1', [id])).rows[0].n, 0);
      await db.query('ALTER TABLE audit_logs DROP CONSTRAINT test_reject_audit');
      assert.ok((await recordManagerPayment(db, { kind: 'agent_subscription', id: agent.id, body: { ...cash, request_id: id }, actor })).entry.id);
    });

    await t.test('different concurrent payments each advance the locked agent period once', async () => {
      const renewals = await Promise.all([1, 2].map(() => recordManagerPayment(db, {
        kind: 'agent_subscription', id: agent.id, body: { ...cash, request_id: crypto.randomUUID() }, actor
      })));
      renewals.sort((a, b) => a.period_start.localeCompare(b.period_start));
      const firstEnd = new Date(`${renewals[0].period_end}T00:00:00Z`);
      firstEnd.setUTCDate(firstEnd.getUTCDate() + 1);
      assert.equal(renewals[1].period_start, firstEnd.toISOString().slice(0, 10));
      assert.equal((await db.query('SELECT paid_until::text FROM agents WHERE id=$1', [agent.id])).rows[0].paid_until, renewals[1].period_end);
    });

    await t.test('voided receipt retry cannot report stale success or write replacement money', async () => {
      const body = { amount_ugx: 50000, method: 'mtn_momo', reference: 'VOID-RECEIPT-001', request_id: crypto.randomUUID() };
      const paid = await recordManagerPayment(db, { kind: 'agent_subscription', id: agent.id, body, actor });
      await db.query('UPDATE revenue_entries SET voided_at=now() WHERE id=$1', [paid.entry.id]);
      const before = await paymentHistory(db, { kind: 'agent_subscription', id: agent.id });
      await assert.rejects(() => recordManagerPayment(db, { kind: 'agent_subscription', id: agent.id, body, actor }),
        (error) => error.status === 409 && /was voided/.test(error.message));
      const after = await paymentHistory(db, { kind: 'agent_subscription', id: agent.id });
      assert.equal(after.payment_summary.lifetime_paid_ugx, before.payment_summary.lifetime_paid_ugx);
      assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM revenue_entries WHERE reference=$1', [body.reference])).rows[0].n, 1);
      const replacement = await recordManagerPayment(db, { kind: 'agent_subscription', id: agent.id, body: { ...body, request_id: crypto.randomUUID() }, actor });
      assert.notEqual(replacement.entry.id, paid.entry.id);
      assert.equal((await paymentHistory(db, { kind: 'agent_subscription', id: agent.id })).payment_summary.lifetime_paid_ugx,
        before.payment_summary.lifetime_paid_ugx + 50000);
    });
  } finally {
    if (pool) await pool.end();
    try { execFileSync(path.join(PG_BIN, 'pg_ctl'), ['-D', data, '-w', '-t', '20', '-m', 'immediate', 'stop'], { stdio: 'pipe' }); } catch (_) {}
    fs.rmSync(cluster, { recursive: true, force: true });
  }
});
