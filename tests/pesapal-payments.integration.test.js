'use strict';

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { assertDisposableDatabase, fakePesapal, deferred, checkoutInSeparateProcess } = require('./helpers/pesapalFixture');

describe('Pesapal receipts and fulfillment on disposable PostgreSQL', {
  skip: !process.env.PESAPAL_TEST_SENTINEL && 'Run node scripts/test-pesapal-payments.js to create an owned PostgreSQL cluster',
  concurrency: false
}, () => {
  let pool;
  let db;
  let fake;
  let payLinks;
  let app;
  let request;
  let noticeService;
  let transportCalls = 0;
  let nativeFetch;
  let applicationDb;
  const originalTransports = [];

  before(async () => {
    pool = new Pool({ connectionString: process.env.PESAPAL_TEST_DATABASE_URL, max: 16 });
    await assertDisposableDatabase(pool);
    db = { query: pool.query.bind(pool), getClient: pool.connect.bind(pool) };
    fake = await fakePesapal();
    Object.assign(process.env, {
      NODE_ENV: 'test', COUNTRY_CODE: 'UG', PESAPAL_ENABLED: 'true', PESAPAL_ENV: 'sandbox',
      PESAPAL_CONSUMER_KEY: 'local-test-key', PESAPAL_CONSUMER_SECRET: 'local-test-secret',
      PESAPAL_IPN_ID: '11111111-1111-4111-8111-111111111111', PESAPAL_MERCHANT_PROFILE: 'local-proof',
      PESAPAL_TEST_BASE_URL: fake.baseUrl, PUBLIC_BASE_URL: 'https://makaug.test',
      PAYMENT_NOTICE_DISPATCH_ENABLED: 'false', PAY_LINK_SWEEP_ENABLED: 'false',
      MAKAUG_LISTING_BOOSTS_ENABLED: 'true',
      REVOLUT_MERCHANT_SECRET_KEY: 'local-revolut-key', REVOLUT_MERCHANT_BASE_URL: fake.origin,
      WHATSAPP_DELIVERY_MODE: 'test'
    });
    nativeFetch = global.fetch;
    global.fetch = (input, options) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
      assert.ok(['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname), `Network outside loopback refused: ${url.origin}`);
      return nativeFetch(input, options);
    };
    // These guards fail if a settlement reaches any existing real delivery path.
    for (const [moduleName, method] of [
      ['../services/leadHandoffService', 'deliverWhatsapp'],
      ['../services/leadDeskService', 'sendToTeam']
    ]) {
      const service = require(moduleName);
      originalTransports.push([service, method, service[method]]);
      service[method] = async () => { transportCalls += 1; throw new Error('Real delivery path forbidden in payment proof'); };
    }
    payLinks = require('../services/payLinkService');
    noticeService = require('../services/paymentNoticeService');
    applicationDb = require('../config/database');
    const express = require('express');
    request = require('supertest');
    const routes = require('../routes/pay');
    app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));
    app.use('/pay', routes.pages);
    app.use('/api/pay', routes.api);
    app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message }));
  });

  after(async () => {
    for (const [service, method, original] of originalTransports) service[method] = original;
    if (nativeFetch) global.fetch = nativeFetch;
    if (applicationDb) await Promise.all([applicationDb.pool.end(), applicationDb.backgroundPool.end()]);
    if (pool) await pool.end();
    if (fake) await fake.close();
    assert.equal(transportCalls, 0, 'No real transport may run during integration proof');
  });

  async function link(extra = {}) {
    const id = crypto.randomUUID();
    const code = `MK${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
    return (await pool.query(`INSERT INTO pay_links
      (id,code,purpose,description,amount_ugx,card_currency,card_amount_minor,fx_rate_ugx,payer_name,payer_phone,
       agent_id,property_id,payment_id,st_listing_id)
      VALUES ($1,$2,$3,'Local payment proof',$4,'USD',1352,3700,'Local Payer','256700000001',$5,$6,$7,$8) RETURNING *`,
    [id, code, extra.purpose || 'other', extra.amount || 50000, extra.agentId || null, extra.propertyId || null,
      extra.paymentId || null, extra.stListingId || null])).rows[0];
  }

  async function agent(status = 'approved') {
    const marker = crypto.randomBytes(6).toString('hex');
    return (await pool.query(`INSERT INTO agents(full_name,phone,whatsapp,licence_number,status,fee_exempt,monthly_fee_ugx,paid_until)
      VALUES ('Local Proof Agent',$1,$1,$2,$3,false,50000,(CURRENT_DATE+30)) RETURNING *, paid_until::text AS initial_paid_until`,
    [`2567${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 10)}`, `LOCAL-${marker}`, status])).rows[0];
  }

  async function property() {
    return (await pool.query(`INSERT INTO properties(listing_type,title,description,district,area,status,lister_name,lister_phone)
      VALUES ('rent','Local proof listing','Fixture','Kampala','Ntinda','approved','Local Payer','256700000001') RETURNING *`)).rows[0];
  }

  async function attempt(debt) {
    return (await pool.query('SELECT * FROM pesapal_payment_attempts WHERE pay_link_id=$1 ORDER BY created_at DESC LIMIT 1', [debt.id])).rows[0];
  }
  async function checkout(debt) {
    await payLinks.startPesapalCheckout(db, { code: debt.code });
    const row = await attempt(debt);
    assert.ok(row?.tracking_id, 'A successful checkout persists its provider tracking identity');
    return row;
  }
  async function observe(row, extra = {}) {
    return payLinks.observePesapalPayment(db, { trackingId: row.tracking_id, reference: row.merchant_reference, source: 'ipn', expectedCode: null, ...extra });
  }
  async function receiptRows(debt) {
    return (await pool.query('SELECT * FROM revenue_entries WHERE pay_link_id=$1 ORDER BY recorded_at,id', [debt.id])).rows;
  }
  async function debtState(debt) {
    return (await pool.query('SELECT * FROM pay_links WHERE id=$1', [debt.id])).rows[0];
  }
  async function assertUnpaid(debt) {
    assert.equal((await debtState(debt)).status, 'open');
    assert.equal((await receiptRows(debt)).length, 0);
  }
  async function reachedProvider(hold, operation) {
    return Promise.race([hold.entered, operation.then(() => { throw new Error('Operation ended before reaching the local provider gate'); })]);
  }

  test('concurrent checkout creates and submits one durable attempt', async () => {
    const debt = await link();
    const submissions = fake.counters.submit;
    await Promise.all(Array.from({ length: 8 }, () => payLinks.startPesapalCheckout(db, {
      code: debt.code, phone: '256700000099', email: 'untrusted@example.test'
    })));
    assert.equal(fake.counters.submit - submissions, 1);
    const rows = (await pool.query('SELECT * FROM pesapal_payment_attempts WHERE pay_link_id=$1', [debt.id])).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].creation_state, 'tracked');
    assert.equal(rows[0].amount_ugx, '50000');
    assert.match(rows[0].redirect_url, /^http:\/\/127\.0\.0\.1:/);
    const providerOrder = fake.orders.get(rows[0].tracking_id);
    assert.equal(providerOrder.request.billing_address.phone_number, debt.payer_phone);
    assert.equal(providerOrder.request.billing_address.email_address, undefined, 'Supplied contact cannot replace a known stored payer');
    assert.equal((await debtState(debt)).provider_order_id, null, 'Revolut order identity is untouched');
  });

  test('HTTP return and concurrent duplicate IPNs apply one receipt and one period', async () => {
    const target = await agent();
    const debt = await link({ purpose: 'agent_subscription', agentId: target.id });
    const checkoutPage = await request(app).get(`/pay/${debt.code}`);
    assert.equal(checkoutPage.status, 200);
    assert.match(checkoutPage.text, new RegExp(`action="/pay/${debt.code}/pesapal"`));
    const row = await checkout(debt);
    fake.complete(row.tracking_id);
    const fields = { OrderTrackingId: row.tracking_id, OrderMerchantReference: row.merchant_reference, OrderNotificationType: 'IPNCHANGE' };
    const replies = await Promise.all([
      request(app).get(`/pay/${debt.code}/pesapal-return`).query({ ...fields, OrderNotificationType: 'CALLBACKURL' }),
      ...Array.from({ length: 6 }, () => request(app).post('/api/pay/webhooks/pesapal').send(fields))
    ]);
    assert.equal(replies[0].status, 303);
    for (const response of replies.slice(1)) { assert.equal(response.status, 200); assert.equal(response.body.status, 200); }
    const receipts = await receiptRows(debt);
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0].payment_application, 'applied');
    assert.equal(receipts[0].verified_status, 'verified');
    const state = await debtState(debt);
    assert.equal(state.status, 'paid');
    assert.equal(state.entry_id, receipts[0].id);
    const paid = (await pool.query("SELECT paid_until::text, ($2::date+interval '1 month')::date::text AS expected FROM agents WHERE id=$1", [target.id, target.initial_paid_until])).rows[0];
    assert.equal(paid.paid_until, paid.expected);
    const notices = (await pool.query('SELECT event_key,count(*)::int FROM payment_notice_retries WHERE pay_link_id=$1 GROUP BY event_key', [debt.id])).rows;
    assert.ok(notices.length > 0);
    assert.ok(notices.every((notice) => notice.count === 1));
    const page = await request(app).get(`/pay/${debt.code}`);
    assert.equal(page.status, 200);
    assert.match(page.text, /Paid/);
    assert.doesNotMatch(page.text, /local-test-secret|Admin Dashboard|Current Password/);
    if (process.env.PESAPAL_PROOF_DIR) {
      const directory = path.resolve(process.env.PESAPAL_PROOF_DIR);
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, 'pesapal-checkout.html'), checkoutPage.text);
      fs.writeFileSync(path.join(directory, 'pesapal-paid.html'), page.text);
      fs.writeFileSync(path.join(directory, 'pesapal-proof.json'), JSON.stringify({
        source: 'Actual routes/pay.js responses from the passing HTTP settlement test',
        environment: 'Disposable local PostgreSQL, local fake Pesapal, synthetic payer and debt',
        createdAt: new Date().toISOString(), code: debt.code,
        pages: ['pesapal-checkout.html', 'pesapal-paid.html'], realPayment: false
      }, null, 2));
    }
  });

  test('browser return remains pending and notification type cannot assert payment', async () => {
    const debt = await link();
    const row = await checkout(debt);
    const callback = await request(app).get(`/pay/${debt.code}/pesapal-return`).query({
      OrderTrackingId: row.tracking_id, OrderMerchantReference: row.merchant_reference, OrderNotificationType: 'CALLBACKURL'
    });
    assert.equal(callback.status, 303);
    await assertUnpaid(debt);
    const page = await request(app).get(`/pay/${debt.code}`);
    assert.doesNotMatch(page.text, /<h1>Paid/);
    const bad = await request(app).post('/api/pay/webhooks/pesapal').send({
      OrderTrackingId: row.tracking_id, OrderMerchantReference: row.merchant_reference, OrderNotificationType: 'CALLBACKURL', status: 1
    });
    assert.ok(bad.status >= 400);
    await assertUnpaid(debt);
  });

  test('wrong provider amount, currency, reference or tracking never applies money', async () => {
    for (const wrong of [{ amount: 49999 }, { amount: '50000.01' }, { currency: 'USD' }, { reference: 'WRONG-REFERENCE' }]) {
      const debt = await link();
      const row = await checkout(debt);
      fake.complete(row.tracking_id, wrong);
      await observe(row).catch(() => {});
      await assertUnpaid(debt);
    }
    const debt = await link();
    const row = await checkout(debt);
    fake.complete(row.tracking_id);
    const calls = fake.counters.status;
    await observe(row, { trackingId: crypto.randomUUID() }).catch(() => {});
    await assertUnpaid(debt);
    assert.equal(fake.counters.status, calls, 'Known mismatched tracking is rejected before provider lookup');
    const anotherDebt = await link();
    await observe(row, { source: 'return', expectedCode: anotherDebt.code }).catch(() => {});
    await assertUnpaid(debt);
  });

  test('lost submission response survives application process restart and authenticated callback recovery', async () => {
    const debt = await link();
    const count = fake.counters.submit;
    fake.loseNextSubmit();
    await checkoutInSeparateProcess(debt.code);
    let row = await attempt(debt);
    assert.equal(row.creation_state, 'unknown');
    assert.equal(row.tracking_id, null);
    const order = [...fake.orders.values()].find((item) => item.reference === row.merchant_reference);
    assert.ok(order, 'The provider retained the order after the application lost its response');
    delete require.cache[require.resolve('../services/payLinkService')];
    payLinks = require('../services/payLinkService');
    await payLinks.startPesapalCheckout(db, { code: debt.code }).catch(() => {});
    assert.equal(fake.counters.submit - count, 1, 'Unknown submission is never blindly replayed');
    fake.complete(order.trackingId);
    await observe(row, { trackingId: order.trackingId });
    row = await attempt(debt);
    assert.equal(row.tracking_id, order.trackingId);
    assert.equal(row.application, 'applied');
    assert.equal((await receiptRows(debt)).length, 1);
  });

  test('a reserved checkout remains resumable after definite token failure without duplicating submission', async () => {
    const debt = await link();
    const submits = fake.counters.submit;
    delete require.cache[require.resolve('../services/payLinkService')];
    payLinks = require('../services/payLinkService');
    fake.failNextToken();
    await payLinks.startPesapalCheckout(db, { code: debt.code }).catch(() => {});
    const reserved = await attempt(debt);
    assert.ok(reserved);
    assert.equal(reserved.creation_state, 'reserved');
    assert.equal(reserved.tracking_id, null);
    assert.equal(fake.counters.submit, submits);
    const view = await payLinks.pageData(db, debt.code);
    assert.equal(view.pesapal_can_resume, true);
    const page = await request(app).get(`/pay/${debt.code}`);
    assert.equal(page.status, 200);
    assert.match(page.text, new RegExp(`action="/pay/${debt.code}/pesapal"`));
    await payLinks.startPesapalCheckout(db, { code: debt.code });
    assert.equal((await attempt(debt)).id, reserved.id);
    assert.equal((await attempt(debt)).creation_state, 'tracked');
    assert.equal(fake.counters.submit - submits, 1);
  });

  test('IPN arriving before submit response persistence binds the original order', async () => {
    const debt = await link();
    const hold = fake.holdNextSubmit();
    const started = payLinks.startPesapalCheckout(db, { code: debt.code });
    const order = await reachedProvider(hold, started);
    try {
      const row = await attempt(debt);
      fake.complete(order.trackingId);
      await observe(row, { trackingId: order.trackingId });
    } finally { hold.release(); }
    await started;
    const row = await attempt(debt);
    assert.equal(row.tracking_id, order.trackingId);
    assert.equal(row.application, 'applied');
    assert.equal((await receiptRows(debt)).length, 1);
  });

  test('provider status HTTP holds no debt or target SQL locks', async () => {
    const target = await agent();
    const debt = await link({ purpose: 'agent_subscription', agentId: target.id });
    const row = await checkout(debt);
    fake.complete(row.tracking_id);
    const hold = fake.holdNextStatus();
    const observing = observe(row);
    await reachedProvider(hold, observing);
    const other = await pool.connect();
    try {
      await other.query('BEGIN');
      await other.query("SET LOCAL lock_timeout='250ms'");
      await other.query('SELECT id FROM pay_links WHERE id=$1 FOR UPDATE', [debt.id]);
      await other.query('SELECT id FROM agents WHERE id=$1 FOR UPDATE', [target.id]);
      await other.query('COMMIT');
    } finally { await other.query('ROLLBACK').catch(() => {}); other.release(); hold.release(); }
    await observing;
    assert.equal((await debtState(debt)).status, 'paid');
  });

  test('fulfillment failure after receipt insertion rolls everything back and retry succeeds', async () => {
    for (const kind of ['agent', 'listing']) {
      const target = kind === 'agent' ? await agent() : await property();
      const table = kind === 'agent' ? 'agents' : 'properties';
      const debt = await link(kind === 'agent' ? { purpose: 'agent_subscription', agentId: target.id } : { purpose: 'listing_fee', propertyId: target.id });
      const row = await checkout(debt);
      fake.complete(row.tracking_id);
      await pool.query('INSERT INTO pesapal_test_faults VALUES ($1,$2)', [table, target.id]);
      try {
        await observe(row).catch(() => {});
        await assertUnpaid(debt);
        assert.equal((await pool.query('SELECT count(*)::int AS n FROM payment_notice_retries WHERE pay_link_id=$1', [debt.id])).rows[0].n, 0);
        const afterFailure = (await pool.query(`SELECT * FROM ${table} WHERE id=$1`, [target.id])).rows[0];
        if (kind === 'agent') assert.deepEqual(afterFailure.paid_until, target.paid_until);
        else assert.equal(afterFailure.lister_paid_until, target.lister_paid_until);
      } finally { await pool.query('DELETE FROM pesapal_test_faults WHERE table_name=$1 AND target_id=$2', [table, target.id]); }
      await observe(row);
      assert.equal((await receiptRows(debt)).length, 1);
      assert.equal((await debtState(debt)).status, 'paid');
    }
  });

  test('different debts for one agent extend both periods without a lost update', async () => {
    const target = await agent();
    const debts = await Promise.all([link({ purpose: 'agent_subscription', agentId: target.id }), link({ purpose: 'agent_subscription', agentId: target.id })]);
    const attempts = await Promise.all(debts.map(checkout));
    for (const row of attempts) fake.complete(row.tracking_id);
    await Promise.all(attempts.map((row) => observe(row)));
    const result = (await pool.query("SELECT paid_until::text, ($2::date+interval '2 months')::date::text AS expected FROM agents WHERE id=$1", [target.id, target.initial_paid_until])).rows[0];
    assert.equal(result.paid_until, result.expected);
    for (const debt of debts) assert.equal((await receiptRows(debt)).length, 1);
  });

  test('hosted entitlement, campaign and invoice failures rollback their receipts and product state', async () => {
    await pool.query("UPDATE products SET active=true WHERE key='listing_boost_basic'");
    const user = (await pool.query(`INSERT INTO users(first_name,last_name,phone,password_hash)
      VALUES ('Local','Proof',$1,'local-no-login-password') RETURNING id`, [`local-${crypto.randomUUID()}`])).rows[0];
    for (const stage of ['entitlement', 'campaign', 'invoice']) {
      const listing = await property();
      const campaign = (await pool.query(`INSERT INTO advertising_campaigns(advertiser_name,campaign_name,quoted_amount_ugx)
        VALUES ('Local Proof','Local rollback proof',50000) RETURNING *`)).rows[0];
      const invoice = (await pool.query(`INSERT INTO invoices(advertiser_id,campaign_id,invoice_number,amount)
        VALUES ($1,$2,$3,50000) RETURNING *`, [user.id, campaign.id, `LOCAL-${crypto.randomUUID()}`])).rows[0];
      const metadata = { product_key: 'listing_boost_basic', listing_id: listing.id, campaign_id: campaign.id, invoice_id: invoice.id };
      const payment = (await pool.query(`INSERT INTO payments(purpose,gateway,checkout_reference,amount,currency,payer_id,payer_phone,metadata)
        VALUES ('listing_boost','pay_link',$1,50000,'UGX',$2,'256700000001',$3::jsonb) RETURNING *`,
      [`LOCAL-${crypto.randomUUID()}`, user.id, JSON.stringify(metadata)])).rows[0];
      const debt = await link({ purpose: 'hosted_payment', paymentId: payment.id });
      const row = await checkout(debt);
      fake.complete(row.tracking_id);
      const fault = stage === 'entitlement' ? ['account_entitlements', payment.id]
        : stage === 'campaign' ? ['advertising_campaigns', campaign.id] : ['invoices', invoice.id];
      await pool.query('INSERT INTO pesapal_test_faults VALUES ($1,$2)', fault);
      try {
        await observe(row).catch(() => {});
        await assertUnpaid(debt);
        assert.equal((await pool.query('SELECT status FROM payments WHERE id=$1', [payment.id])).rows[0].status, 'pending');
        assert.equal((await pool.query('SELECT count(*)::int AS n FROM account_entitlements WHERE payment_id=$1', [payment.id])).rows[0].n, 0);
        assert.equal((await pool.query('SELECT featured_until FROM properties WHERE id=$1', [listing.id])).rows[0].featured_until, null);
        assert.equal((await pool.query('SELECT status FROM invoices WHERE id=$1', [invoice.id])).rows[0].status, invoice.status);
        assert.equal((await pool.query('SELECT payment_status FROM advertising_campaigns WHERE id=$1', [campaign.id])).rows[0].payment_status, campaign.payment_status);
      } finally { await pool.query('DELETE FROM pesapal_test_faults WHERE table_name=$1 AND target_id=$2', fault); }
      await observe(row);
      assert.equal((await receiptRows(debt)).length, 1);
      assert.equal((await pool.query('SELECT status FROM payments WHERE id=$1', [payment.id])).rows[0].status, 'paid');
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM account_entitlements WHERE payment_id=$1', [payment.id])).rows[0].n, 1);
      assert.equal((await pool.query('SELECT status FROM invoices WHERE id=$1', [invoice.id])).rows[0].status, 'paid');
      assert.equal((await pool.query('SELECT payment_status FROM advertising_campaigns WHERE id=$1', [campaign.id])).rows[0].payment_status, 'paid');
    }
  });

  test('short-stay rollback and renewal retain the prior receipt and use the exact new reference', async () => {
    const marker = crypto.randomUUID();
    const listing = (await pool.query(`INSERT INTO st_listing(reference,slug,title,description,district,area,base_nightly_ugx,host_name,host_phone)
      VALUES ($1,$2,'Local short stay','Fixture','Kampala','Ntinda',100000,'Local Host','256700000001') RETURNING *`,
    [`LOCAL-${marker}`, `local-${marker}`])).rows[0];
    const prior = (await pool.query(`INSERT INTO st_listing_payment(listing_id,amount_ugx,method,provider_reference,status)
      VALUES ($1,50000,'cash',$2,'paid') RETURNING *`, [listing.id, `PRIOR-${marker}`])).rows[0];
    const debt = await link({ purpose: 'short_term_fee', stListingId: listing.id });
    const row = await checkout(debt);
    fake.complete(row.tracking_id);
    await pool.query("INSERT INTO pesapal_test_faults VALUES ('st_listing',$1)", [listing.id]);
    try { await observe(row).catch(() => {}); await assertUnpaid(debt); }
    finally { await pool.query("DELETE FROM pesapal_test_faults WHERE table_name='st_listing' AND target_id=$1", [listing.id]); }
    await observe(row);
    const entries = await receiptRows(debt);
    assert.equal(entries.length, 1);
    const payments = (await pool.query('SELECT * FROM st_listing_payment WHERE listing_id=$1 ORDER BY created_at,id', [listing.id])).rows;
    assert.equal(payments.length, 2);
    assert.deepEqual(payments.find((payment) => payment.id === prior.id), prior);
    const current = payments.find((payment) => payment.id !== prior.id);
    assert.equal(current.revenue_entry_id, entries[0].id);
    assert.equal(current.provider_reference, entries[0].reference);
    assert.equal(current.method, 'other');
    assert.equal(current.status, 'paid');
    await observe(row);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM st_listing_payment WHERE listing_id=$1', [listing.id])).rows[0].n, 2);
  });

  test('an unpaid hosted purchase with a preexisting entitlement requires review rather than a false new success', async () => {
    const user = (await pool.query(`INSERT INTO users(first_name,last_name,phone,password_hash)
      VALUES ('Local','Legacy Proof',$1,'local-no-login-password') RETURNING id`, [`local-${crypto.randomUUID()}`])).rows[0];
    const listing = await property();
    const payment = (await pool.query(`INSERT INTO payments(purpose,gateway,checkout_reference,amount,currency,payer_id,payer_phone,metadata)
      VALUES ('listing_boost','pay_link',$1,50000,'UGX',$2,'256700000001',$3::jsonb) RETURNING *`,
    [`LOCAL-${crypto.randomUUID()}`, user.id, JSON.stringify({ product_key: 'listing_boost_basic', listing_id: listing.id })])).rows[0];
    await pool.query(`INSERT INTO account_entitlements(account_id,product_key,status,payment_id,quantity)
      VALUES ($1,'listing_boost_basic','active',$2,1)`, [user.id, payment.id]);
    const debt = await link({ purpose: 'hosted_payment', paymentId: payment.id });
    const row = await checkout(debt);
    fake.complete(row.tracking_id);
    await observe(row).catch(() => {});
    await assertUnpaid(debt);
    assert.equal((await pool.query('SELECT status FROM payments WHERE id=$1', [payment.id])).rows[0].status, 'pending');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM account_entitlements WHERE payment_id=$1', [payment.id])).rows[0].n, 1);
    assert.equal((await pool.query('SELECT featured_until FROM properties WHERE id=$1', [listing.id])).rows[0].featured_until, null);
    const failed = await attempt(debt);
    assert.ok(failed.review_reason || failed.last_error_code, 'The existing partial fulfillment is visible for staff review');
  });

  test('Pesapal, Revolut and staff-confirmed MoMo race to apply one debt only', async () => {
    const target = await agent();
    const debt = await link({ purpose: 'agent_subscription', agentId: target.id });
    const row = await checkout(debt);
    fake.complete(row.tracking_id);
    const orderId = crypto.randomUUID();
    await pool.query('UPDATE pay_links SET provider_order_id=$2,provider_state=$3 WHERE id=$1', [debt.id, orderId, 'pending']);
    const claim = (await pool.query(`INSERT INTO payment_claims(source,payer_phone,payer_name,agent_id,purpose,reference,amount_ugx,method,pay_link_id)
      VALUES ('pay_link','256700000001','Local Payer',$1,'agent_subscription',$2,50000,'mtn_momo',$3) RETURNING *`,
    [target.id, `LOCALMOMO-${crypto.randomUUID()}`, debt.id])).rows[0];
    const savedLink = await debtState(debt);
    const revolutOrder = { id: orderId, state: 'COMPLETED', amount: savedLink.card_amount_minor,
      currency: 'USD', merchant_order_ext_ref: debt.code, completed_at: new Date().toISOString() };
    await Promise.all([
      observe(row), payLinks.settleFromOrder(db, savedLink, revolutOrder),
      payLinks.settleConfirmedClaim(db, { claimId: claim.id, actor: 'local-test', method: 'mtn_momo', amountUgx: 50000 })
    ]);
    const receipts = await receiptRows(debt);
    assert.equal(receipts.length, 3, 'All independently received money is retained');
    assert.equal(receipts.filter((entry) => entry.payment_application === 'applied').length, 1);
    assert.equal(receipts.filter((entry) => entry.payment_application === 'excess').length, 2);
    const paid = (await pool.query("SELECT paid_until::text, ($2::date+interval '1 month')::date::text AS expected FROM agents WHERE id=$1", [target.id, target.initial_paid_until])).rows[0];
    assert.equal(paid.paid_until, paid.expected);
    assert.equal((await debtState(debt)).provider_order_id, orderId);
    assert.equal((await pool.query('SELECT status FROM payment_claims WHERE id=$1', [claim.id])).rows[0].status, 'confirmed');
  });

  test('missed IPN is recovered by scheduled reconciliation and expired token read retries safely', async () => {
    const debt = await link();
    const row = await checkout(debt);
    fake.complete(row.tracking_id);
    fake.expireNextStatusToken();
    const submits = fake.counters.submit;
    await pool.query('UPDATE pesapal_payment_attempts SET next_check_at=now()-interval \'1 minute\' WHERE id=$1', [row.id]);
    await payLinks.reconcilePesapalPayments(db, { limit: 100 });
    assert.equal((await debtState(debt)).status, 'paid');
    assert.equal(fake.counters.submit, submits);
    assert.equal((await receiptRows(debt)).length, 1);
  });

  test('late reversal is sticky and preserves receipt and paid period without another grant', async () => {
    const target = await agent();
    const debt = await link({ purpose: 'agent_subscription', agentId: target.id });
    const row = await checkout(debt);
    fake.complete(row.tracking_id);
    await observe(row);
    const applied = (await receiptRows(debt))[0];
    const paidUntil = (await pool.query('SELECT paid_until FROM agents WHERE id=$1', [target.id])).rows[0].paid_until;
    fake.reverse(row.tracking_id);
    await observe(row);
    const reversed = await attempt(debt);
    assert.ok(reversed.reversed_at);
    assert.ok(reversed.review_reason);
    fake.complete(row.tracking_id);
    await observe(row);
    assert.equal((await receiptRows(debt))[0].id, applied.id);
    assert.equal((await receiptRows(debt))[0].voided_at, null);
    assert.deepEqual((await pool.query('SELECT paid_until FROM agents WHERE id=$1', [target.id])).rows[0].paid_until, paidUntil);
    assert.deepEqual((await attempt(debt)).reversed_at, reversed.reversed_at);
  });

  test('a stale completed response finishing after an initial reversal cannot grant', async () => {
    const debt = await link();
    const row = await checkout(debt);
    fake.complete(row.tracking_id);
    const hold = fake.holdNextStatus();
    const stale = observe(row);
    await reachedProvider(hold, stale);
    try { fake.reverse(row.tracking_id); await observe(row); }
    finally { hold.release(); }
    await stale;
    await assertUnpaid(debt);
    assert.ok((await attempt(debt)).reversed_at);
  });

  test('retargeting a debt after checkout cannot apply the captured purchase to a different agent', async () => {
    const original = await agent();
    const replacement = await agent();
    const debt = await link({ purpose: 'agent_subscription', agentId: original.id });
    const row = await checkout(debt);
    await pool.query('UPDATE pay_links SET agent_id=$2 WHERE id=$1', [debt.id, replacement.id]);
    fake.complete(row.tracking_id);
    await observe(row).catch(() => {});
    assert.equal((await receiptRows(debt)).filter((entry) => entry.payment_application === 'applied').length, 0);
    for (const target of [original, replacement]) {
      assert.deepEqual((await pool.query('SELECT paid_until FROM agents WHERE id=$1', [target.id])).rows[0].paid_until, target.paid_until);
    }
  });

  test('a paid pending agent stays pending and fee exemptions remain unchanged', async () => {
    const target = await agent('pending');
    const debt = await link({ purpose: 'agent_subscription', agentId: target.id });
    const row = await checkout(debt);
    fake.complete(row.tracking_id);
    await observe(row);
    const result = (await pool.query('SELECT status,paid_awaiting_approval_at,fee_exempt FROM agents WHERE id=$1', [target.id])).rows[0];
    assert.equal(result.status, 'pending');
    assert.ok(result.paid_awaiting_approval_at);
    assert.equal(result.fee_exempt, false);
    const exempt = await agent();
    await pool.query('UPDATE agents SET fee_exempt=true WHERE id=$1', [exempt.id]);
    const exemptLink = await link({ purpose: 'agent_subscription', agentId: exempt.id });
    const count = fake.counters.submit;
    await payLinks.startPesapalCheckout(db, { code: exemptLink.code }).catch(() => {});
    assert.equal(fake.counters.submit, count);
    assert.equal((await pool.query('SELECT fee_exempt FROM agents WHERE id=$1', [exempt.id])).rows[0].fee_exempt, true);
    const voluntary = await payLinks.createPayLink(db, { purpose: 'agent_subscription', agent_id: exempt.id, allow_exempt: true }, 'local-test');
    assert.equal(voluntary.link.voluntary_payment, true, 'Explicit voluntary intent survives creation or link reuse');
    const permitted = await checkout(voluntary.link);
    fake.complete(permitted.tracking_id);
    await observe(permitted);
    assert.equal((await receiptRows(voluntary.link))[0].payment_application, 'applied');
    assert.equal((await pool.query('SELECT fee_exempt FROM agents WHERE id=$1', [exempt.id])).rows[0].fee_exempt, true);
  });

  test('voiding cannot release a provider receipt identity or its applied-debt allocation', async () => {
    const debt = await link();
    const row = await checkout(debt);
    fake.complete(row.tracking_id);
    await observe(row);
    const entry = (await receiptRows(debt))[0];
    await pool.query("UPDATE revenue_entries SET voided_at=now(),void_reason='Local test annotation' WHERE id=$1", [entry.id]);
    await assert.rejects(pool.query('UPDATE revenue_entries SET payment_application=NULL WHERE id=$1', [entry.id]), { code: '23514' });
    await assert.rejects(pool.query('UPDATE revenue_entries SET reference=$2 WHERE id=$1', [entry.id, 'REWRITTEN']), { code: '23514' });
    await assert.rejects(pool.query('UPDATE revenue_entries SET amount_ugx=amount_ugx+1 WHERE id=$1', [entry.id]), { code: '23514' });
    await assert.rejects(pool.query(`INSERT INTO revenue_entries(direction,kind,amount_ugx,account_key,method,reference)
      VALUES ('in','other_income',50000,'pesapal_ugx','pesapal',$1)`, [entry.reference]), { code: '23505' });
    await assert.rejects(pool.query(`INSERT INTO revenue_entries(direction,kind,amount_ugx,account_key,method,reference,pay_link_id,payment_application)
      VALUES ('in','other_income',50000,'cash','cash',$1,$2,'applied')`, [`LOCAL-${crypto.randomUUID()}`, debt.id]), { code: '23505' });
    await observe(row);
    assert.equal((await receiptRows(debt)).length, 1);
    await assert.rejects(pool.query('UPDATE pesapal_payment_attempts SET amount_ugx=1 WHERE id=$1', [row.id]), { code: '23514' });
    await assert.rejects(pool.query('UPDATE pesapal_payment_attempts SET tracking_id=$2 WHERE id=$1', [row.id, crypto.randomUUID()]), { code: '23514' });
  });

  test('committed notices survive retry/restart and queued acknowledgements are not marked sent', async () => {
    const debt = await link();
    const row = await checkout(debt);
    fake.complete(row.tracking_id);
    await observe(row);
    const beforeRows = (await pool.query('SELECT * FROM payment_notice_retries WHERE pay_link_id=$1', [debt.id])).rows;
    assert.ok(beforeRows.length > 0);
    assert.ok(beforeRows.every((job) => job.status === 'pending'));
    await noticeService.drainPaymentNotices(db, { limit: 1000, deliver: async () => { throw new Error('Local simulated transport outage'); } });
    assert.ok((await pool.query('SELECT status FROM payment_notice_retries WHERE pay_link_id=$1', [debt.id])).rows.every((job) => job.status === 'retry'));
    await pool.query("UPDATE payment_notice_retries SET next_attempt_at=now()-interval '1 minute' WHERE status='retry'");
    delete require.cache[require.resolve('../services/paymentNoticeService')];
    noticeService = require('../services/paymentNoticeService');
    const deliveries = [];
    await noticeService.drainPaymentNotices(db, { limit: 1000, deliver: async (job) => {
      deliveries.push(job);
      return { status: 'queued', id: `LOCAL-QUEUE-${job.id}` };
    } });
    const queued = (await pool.query('SELECT * FROM payment_notice_retries WHERE pay_link_id=$1', [debt.id])).rows;
    assert.ok(queued.every((job) => job.status === 'queued' && job.delivered_at === null));
    assert.ok(queued.every((job) => job.transport_reference));
    const sentCount = deliveries.length;
    await noticeService.drainPaymentNotices(db, { limit: 1000, deliver: async (job) => { deliveries.push(job); return { status: 'sent' }; } });
    assert.equal(deliveries.length, sentCount, 'Queued acknowledgements are not blindly resent');
  });

  test('an expired notice worker cannot overwrite the new owner delivery result', async () => {
    const debt = await link();
    const job = (await pool.query(`INSERT INTO payment_notice_retries(event_key,pay_link_id,notice_kind,recipient,body,next_attempt_at)
      VALUES ($1,$2,'local_lease_proof','256700000001','Local lease proof','2000-01-01') RETURNING *`,
    [`LEASE-${crypto.randomUUID()}`, debt.id])).rows[0];
    const entered = deferred();
    const release = deferred();
    const first = noticeService.drainPaymentNotices(db, { limit: 1, deliver: async (claimed) => {
      assert.equal(claimed.id, job.id);
      entered.resolve();
      await release.promise;
      return { status: 'queued', id: 'OLD-WORKER' };
    } });
    await entered.promise;
    try {
      await pool.query("UPDATE payment_notice_retries SET claimed_until=now()-interval '1 minute' WHERE id=$1", [job.id]);
      await noticeService.drainPaymentNotices(db, { limit: 1, deliver: async (claimed) => {
        assert.equal(claimed.id, job.id);
        return { status: 'sent', id: 'NEW-WORKER' };
      } });
    } finally { release.resolve(); }
    await first;
    const stored = (await pool.query('SELECT * FROM payment_notice_retries WHERE id=$1', [job.id])).rows[0];
    assert.equal(stored.status, 'sent');
    assert.equal(stored.transport_reference, 'NEW-WORKER');
    assert.equal(stored.attempts, 2);
    assert.ok(stored.delivered_at);
    await assert.rejects(pool.query("UPDATE payment_notice_retries SET body='Altered intent' WHERE id=$1", [job.id]), { code: '23514' });
  });

  test('disabled, wrong-tenant, unapproved live and production-sandbox gates prevent provider submission', async () => {
    const debt = await link();
    for (const [key, value] of [['PESAPAL_ENABLED', 'false'], ['COUNTRY_CODE', 'RW'], ['PESAPAL_ENV', 'live'], ['NODE_ENV', 'production']]) {
      const old = process.env[key];
      const count = fake.counters.submit;
      process.env[key] = value;
      try {
        await payLinks.startPesapalCheckout(db, { code: debt.code }).catch(() => {});
        const page = await request(app).get(`/pay/${debt.code}`);
        assert.equal(page.status, 200);
        assert.doesNotMatch(page.text, new RegExp(`action="/pay/${debt.code}/pesapal"`));
      }
      finally { process.env[key] = old; }
      assert.equal(fake.counters.submit, count, `${key} gate blocks the provider`);
    }
    await assertUnpaid(debt);
    assert.equal(await attempt(debt), undefined);
  });
});
