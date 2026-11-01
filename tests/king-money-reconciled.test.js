'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { Client } = require('pg');
const { moneyReconciliation } = require('../services/revenueService');

const PG_BIN = [process.env.LFM_PG_BIN, '/opt/homebrew/opt/postgresql@18/bin', '/usr/lib/postgresql/18/bin', '/usr/lib/postgresql/17/bin', '/usr/lib/postgresql/16/bin']
  .filter(Boolean).find((dir) => fs.existsSync(path.join(dir, 'initdb')));

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test('one ledger, split by source, flags paid links and confirmed claims with no entry', {
  skip: PG_BIN ? false : 'Set LFM_PG_BIN to an installed PostgreSQL bin directory', timeout: 120000
}, async () => {
  const cluster = fs.mkdtempSync(path.join(os.tmpdir(), 'makaug-money-'));
  const data = path.join(cluster, 'data');
  const socket = path.join(cluster, 'socket');
  fs.mkdirSync(socket);
  let client;
  let started = false;
  try {
    execFileSync(path.join(PG_BIN, 'initdb'), ['-D', data, '--username=money', '--auth=trust', '--encoding=UTF8', '--no-locale'], { stdio: 'pipe' });
    const port = await freePort();
    execFileSync(path.join(PG_BIN, 'pg_ctl'), ['-D', data, '-l', path.join(cluster, 'pg.log'), '-w', '-o', `-h 127.0.0.1 -p ${port} -k ${socket} -c fsync=off`, 'start'], { stdio: 'pipe' });
    started = true;
    client = new Client({ host: '127.0.0.1', port, user: 'money', database: 'postgres' });
    await client.connect();
    await client.query(`
      CREATE TABLE revenue_entries (id uuid PRIMARY KEY, direction text, kind text, amount_ugx bigint, paid_at timestamptz,
        verified_status text DEFAULT 'unverified', voided_at timestamptz, claim_id uuid);
      CREATE TABLE pay_links (id uuid PRIMARY KEY, code text, purpose text, amount_ugx bigint, status text, paid_at timestamptz, paid_method text, entry_id uuid);
      CREATE TABLE payment_claims (id uuid PRIMARY KEY, purpose text, amount_ugx bigint, status text, decided_at timestamptz, entry_id uuid);
      CREATE TABLE dashboard_payment_requests (request_id uuid PRIMARY KEY, entry_id uuid);
      INSERT INTO revenue_entries VALUES
        ('00000000-0000-0000-0000-000000000001','in','listing_fee',20000,'2026-11-01','verified',NULL,NULL),
        ('00000000-0000-0000-0000-000000000002','in','agent_subscription',50000,'2026-11-01','unverified',NULL,'00000000-0000-0000-0000-0000000000c1'),
        ('00000000-0000-0000-0000-000000000003','in','agent_subscription',50000,'2026-10-01','verified',NULL,NULL),
        ('00000000-0000-0000-0000-000000000004','in','listing_fee',20000,'2026-11-01','verified',NULL,NULL),
        ('00000000-0000-0000-0000-000000000005','in','other_income',7000,'2026-11-01','verified',NULL,NULL),
        ('00000000-0000-0000-0000-000000000006','in','other_income',9000,'2026-11-01','verified','2026-11-01',NULL),
        ('00000000-0000-0000-0000-000000000007','out','expense',3000,'2026-11-01','verified',NULL,NULL);
      INSERT INTO pay_links VALUES
        ('00000000-0000-0000-0000-0000000000a1','PL1','listing_fee',20000,'paid','2026-11-01','card','00000000-0000-0000-0000-000000000001'),
        ('00000000-0000-0000-0000-0000000000a2','PL2','listing_fee',20000,'paid','2026-11-01','card',NULL),
        ('00000000-0000-0000-0000-0000000000a3','PL3','listing_fee',20000,'paid','2026-11-01','card','00000000-0000-0000-0000-000000000006');
      INSERT INTO payment_claims VALUES
        ('00000000-0000-0000-0000-0000000000c1','agent_subscription',50000,'confirmed','2026-11-01','00000000-0000-0000-0000-000000000002'),
        ('00000000-0000-0000-0000-0000000000c2','agent_subscription',50000,'confirmed','2026-11-01',NULL),
        ('00000000-0000-0000-0000-0000000000c3','listing_fee',20000,'pending',NULL,NULL);
      INSERT INTO dashboard_payment_requests VALUES
        ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-000000000003'),
        ('00000000-0000-0000-0000-0000000000d2','00000000-0000-0000-0000-000000000004');
    `);
    const r = await moneyReconciliation(client, { monthStart: '2026-11-01' });
    const by = Object.fromEntries(r.sources.map((s) => [s.source, s]));
    assert.equal(by.pay_link.amount_ugx, 20000);
    assert.equal(by.payment_claim.unverified_ugx, 50000);
    assert.equal(by.agent_payment.month_ugx, 0);
    assert.equal(by.agent_payment.amount_ugx, 50000);
    assert.equal(by.public_payer.amount_ugx, 20000);
    assert.equal(by.manual.amount_ugx, 7000, 'voided and money-out rows are not income');
    assert.equal(r.ledger_total_ugx, 147000);
    assert.equal(r.ledger_month_ugx, 97000);
    assert.deepEqual(r.paid_links_without_entry.map((l) => l.code).sort(), ['PL2', 'PL3'], 'a link pointing at a voided entry is a gap');
    assert.equal(r.confirmed_claims_without_entry.length, 1);
    assert.deepEqual(r.pending_claims, { count: 1, amount_ugx: 20000 });
  } finally {
    if (client) await client.end().catch(() => {});
    if (started) execFileSync(path.join(PG_BIN, 'pg_ctl'), ['-D', data, '-m', 'immediate', 'stop'], { stdio: 'pipe' });
    fs.rmSync(cluster, { recursive: true, force: true });
  }
});

function loadBlock() {
  const src = fs.readFileSync(path.join(__dirname, '../assets/makaug-app.js'), 'utf8');
  const start = src.indexOf('function adminMoneyReconciledBlock(');
  const end = src.indexOf('\nfunction renderAdminRevenue()', start);
  const sandbox = {
    adminEscape: (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    adminFormatUgx: (v) => `UGX ${Number(v || 0).toLocaleString('en-US')}`
  };
  vm.createContext(sandbox);
  vm.runInContext(src.slice(start, end), sandbox);
  return sandbox.adminMoneyReconciledBlock;
}

test('reconciled view shows each source, the total and escaped gaps', () => {
  const block = loadBlock();
  assert.equal(block({}), '');
  const html = block({ reconciliation: {
    sources: [{ source: 'public_payer', count: 2, month_ugx: 40000, amount_ugx: 40000, unverified_ugx: 0 }],
    ledger_month_ugx: 40000, ledger_total_ugx: 40000, unverified_ugx: 0,
    paid_links_without_entry: [{ code: '<b>X', amount_ugx: 20000, paid_at: '2026-11-01T00:00:00Z' }],
    confirmed_claims_without_entry: [], pending_claims: { count: 0, amount_ugx: 0 }
  } });
  assert.match(html, /Paid Public listings/);
  assert.match(html, /Total/);
  assert.match(html, /1 payment\(s\) took money but are missing from the ledger/);
  assert.ok(html.includes('&lt;b&gt;X') && !html.includes('<b>X'));
  const clean = block({ reconciliation: { sources: [], paid_links_without_entry: [], confirmed_claims_without_entry: [] } });
  assert.match(clean, /Every paid link and confirmed claim has a ledger entry/);
});
