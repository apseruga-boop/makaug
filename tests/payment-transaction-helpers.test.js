'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { withPaymentTransaction, assertPaymentTransaction } = require('../services/paymentTransaction');
const revenue = require('../services/revenueService');
const billing = require('../services/billingOpsService');
const provider = require('../services/paymentProviderService');

function database(answer = async () => ({ rows: [] })) {
  const calls = [];
  let acquisitions = 0;
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
      return answer(sql, values);
    },
    release() { calls.push({ sql: 'RELEASE_CLIENT' }); }
  };
  return {
    calls,
    get acquisitions() { return acquisitions; },
    async getClient() { acquisitions += 1; return client; },
    async query() { throw new Error('A payment helper escaped its acquired client'); }
  };
}

const payment = { method: 'pesapal', amount_ugx: 50000, reference: 'receipt-1234' };

test('one query-only transaction is reused by nested work and expires after commit', async () => {
  const db = database(async () => ({ rows: [{ answer: 42 }] }));
  let captured;
  const answer = await withPaymentTransaction(db, async (tx) => {
    captured = tx;
    assert.deepEqual(Object.keys(tx), ['query']);
    assert.equal(Object.isFrozen(tx), true);
    assert.equal(tx.getClient, undefined);
    return withPaymentTransaction(tx, async (same) => {
      assert.equal(same, tx);
      return (await same.query('SELECT 42 AS answer')).rows[0].answer;
    });
  });
  assert.equal(answer, 42);
  assert.equal(db.acquisitions, 1);
  assert.deepEqual(db.calls.map((c) => c.sql), ['BEGIN', 'SELECT 42 AS answer', 'COMMIT', 'RELEASE_CLIENT']);
  assert.throws(() => assertPaymentTransaction(captured), { code: 'PAYMENT_TRANSACTION_CLOSED' });
  await assert.rejects(captured.query('SELECT 1'), { code: 'PAYMENT_TRANSACTION_CLOSED' });
});

test('a pool.query-only object cannot pretend to be an atomic connection', async () => {
  await assert.rejects(withPaymentTransaction({ query: async () => ({ rows: [] }) }, async () => 1), { code: 'PAYMENT_CLIENT_REQUIRED' });
  assert.throws(() => assertPaymentTransaction({ query: async () => ({ rows: [] }) }), { code: 'PAYMENT_TRANSACTION_REQUIRED' });
});

test('a swallowed query or nested-work failure still rolls the transaction back', async () => {
  const failure = Object.assign(new Error('injected database failure'), { code: 'XX001' });
  const db = database(async () => { throw failure; });
  await assert.rejects(withPaymentTransaction(db, async (tx) => {
    await tx.query('UPDATE example SET amount = 1').catch(() => {});
    return 'must not commit';
  }), (error) => error === failure);
  assert.deepEqual(db.calls.map((c) => c.sql), ['BEGIN', 'UPDATE example SET amount = 1', 'ROLLBACK', 'RELEASE_CLIENT']);

  const nestedDb = database();
  await assert.rejects(withPaymentTransaction(nestedDb, async (tx) => {
    await withPaymentTransaction(tx, async () => { throw failure; }).catch(() => {});
  }), (error) => error === failure);
  assert.equal(nestedDb.calls.some((c) => c.sql === 'COMMIT'), false);
});

test('a transaction helper cannot commit, upload a receipt or call an external wrapper', async () => {
  const db = database();
  await assert.rejects(withPaymentTransaction(db, (tx) => tx.query('COMMIT')), { code: 'PAYMENT_TRANSACTION_CONTROL' });
  await assert.rejects(withPaymentTransaction(database(), (tx) => tx.query('SELECT 1; /* no escape */ COMMIT')), { code: 'PAYMENT_TRANSACTION_CONTROL' });
  await assert.rejects(withPaymentTransaction(database(), (tx) => revenue.recordEntryTx(tx, {
    ...payment, receipt_url: 'data:image/png;base64,AAAA'
  }, 'test')), /Store the payment receipt/);
  await assert.rejects(withPaymentTransaction(database(), (tx) => provider.completeHostedPayment(tx, 'payment-1')), { code: 'PAYMENT_TRANSACTION_WRAPPER' });
  await assert.rejects(withPaymentTransaction(database(), (tx) => revenue.recordEntry(tx, {
    ...payment, receipt_url: 'data:image/png;base64,AAAA'
  }, 'test')), { code: 'PAYMENT_TRANSACTION_WRAPPER' });
});

test('agent payment rereads the locked period and keeps the Pesapal ledger account', async () => {
  const current = revenue.addMonths(revenue.kampalaDate(), 2);
  const db = database(async (sql, values) => {
    if (/SELECT \* FROM agents/.test(sql)) {
      assert.match(sql, /FOR UPDATE/);
      return { rows: [{ id: 'agent-1', full_name: 'Test Agent', paid_until: current }] };
    }
    if (/INSERT INTO revenue_entries/.test(sql)) return { rows: [{ id: 'entry-1', reference: values[6], amount_ugx: values[3], account_key: values[4] }] };
    if (/FROM money_sms_inbox/.test(sql)) return { rows: [] };
    return { rows: [] };
  });
  const result = await revenue.recordAgentPayment(db, { agent: { id: 'agent-1', paid_until: '2000-01-01' }, payment, actor: 'test' });
  assert.equal(result.period_start, revenue.addDays(current, 1));
  assert.equal(result.period_end, revenue.addDays(revenue.addMonths(result.period_start, 1), -1));
  assert.equal(result.entry.account_key, 'pesapal_ugx');
  assert.equal(db.acquisitions, 1);
  assert.equal(db.calls.at(-2).sql, 'COMMIT');
});

test('an error after inserting an agent receipt rolls back and releases the same client', async () => {
  const db = database(async (sql) => {
    if (/SELECT \* FROM agents/.test(sql)) return { rows: [{ id: 'agent-1', full_name: 'Test Agent' }] };
    if (/INSERT INTO revenue_entries/.test(sql)) return { rows: [{ id: 'entry-1', reference: payment.reference }] };
    if (/UPDATE agents/.test(sql)) throw new Error('injected paid-period failure');
    return { rows: [] };
  });
  await assert.rejects(revenue.recordAgentPayment(db, { agent: { id: 'agent-1' }, payment, actor: 'test' }), /paid-period failure/);
  assert.equal(db.calls.some((c) => c.sql === 'COMMIT'), false);
  assert.deepEqual(db.calls.slice(-2).map((c) => c.sql), ['ROLLBACK', 'RELEASE_CLIENT']);
});

test('private-listing payment locks its period and rejects an insufficient receipt', async () => {
  const db = database(async (sql) => {
    if (/FROM billing_settings/.test(sql)) return { rows: [{ key: 'lister_fee', value: { monthly_ugx: 20000 } }] };
    if (/FROM properties/.test(sql)) {
      assert.match(sql, /FOR UPDATE/);
      return { rows: [{ id: 'property-1' }] };
    }
    return { rows: [] };
  });
  await assert.rejects(billing.recordListingPayment(db, { propertyId: 'property-1', payment: { ...payment, amount_ugx: 1000 }, actor: 'test' }), /less than that/);
  assert.equal(db.calls.some((c) => /INSERT INTO revenue_entries/.test(c.sql)), false);
  assert.equal(db.calls.some((c) => c.sql === 'COMMIT'), false);
});

test('reinstatement preserves a later moderation decision without acquiring another client', async () => {
  const db = database(async (sql, values) => {
    if (/SELECT \* FROM agents/.test(sql)) return { rows: [{
      id: 'agent-1', status: 'rejected', billing_suspended_at: new Date(),
      billing_snapshot: { previous_status: 'approved', listings: [{ id: 'property-1', previous_status: 'approved' }] }
    }] };
    if (/UPDATE agents/.test(sql)) assert.equal(values[1], 'rejected');
    if (/UPDATE properties/.test(sql)) throw new Error('Moderation-hidden listings must stay hidden');
    return { rows: [] };
  });
  const result = await withPaymentTransaction(db, (tx) => billing.reinstateAgentAfterPaymentTx(tx, { agentId: 'agent-1', actor: 'test' }));
  assert.deepEqual(result, { reinstated: false, listings_restored: 0, moderation_preserved: true });
  assert.equal(db.acquisitions, 1);
});

function hostedDatabase({ existingStatus = 'created', missingProduct = false, missingInvoice = false } = {}) {
  const stored = {
    id: 'payment-1', status: existingStatus, purpose: missingProduct ? 'listing_boost' : 'advertising_campaign',
    checkout_reference: 'CHECKOUT-1', payer_id: 'account-1',
    metadata: missingProduct ? { listing_id: 'property-1', product_key: 'missing' } : { campaign_id: 'campaign-1', invoice_id: 'invoice-1' }
  };
  return database(async (sql) => {
    if (/SELECT \* FROM payments/.test(sql)) { assert.match(sql, /FOR UPDATE/); return { rows: [stored] }; }
    if (/UPDATE payments/.test(sql)) return { rows: [{ ...stored, status: 'paid' }] };
    if (/FROM products/.test(sql)) return { rows: [] };
    if (/UPDATE advertising_campaigns/.test(sql)) return { rows: [{ id: 'campaign-1' }] };
    if (/UPDATE invoices/.test(sql)) return { rows: missingInvoice ? [] : [{ id: 'invoice-1', campaign_id: 'campaign-1' }] };
    return { rows: [] };
  });
}

test('hosted product/invoice failures propagate and do not emit successful payment', async () => {
  let emitted = 0;
  const listener = () => { emitted += 1; };
  provider.paymentEvents.on('payment.succeeded', listener);
  try {
    for (const options of [{ missingProduct: true }, { missingInvoice: true }]) {
      const db = hostedDatabase(options);
      await assert.rejects(provider.completeHostedPayment(db, 'payment-1'), { code: 'payment_fulfillment_error' });
      assert.equal(db.calls.some((c) => c.sql === 'COMMIT'), false);
      assert.equal(db.calls.at(-2).sql, 'ROLLBACK');
    }
    assert.equal(emitted, 0);
  } finally {
    provider.paymentEvents.off('payment.succeeded', listener);
  }
});

test('hosted Tx returns its row without emitting; wrapper emits only after commit', async () => {
  const directDb = hostedDatabase();
  const wrappedDb = hostedDatabase();
  const events = [];
  const listener = (row) => {
    assert.equal(wrappedDb.calls.at(-2).sql, 'COMMIT');
    events.push(row.id);
  };
  provider.paymentEvents.on('payment.succeeded', listener);
  try {
    const direct = await withPaymentTransaction(directDb, (tx) => provider.completeHostedPaymentTx(tx, 'payment-1', { reference: 'receipt-1', method: 'pesapal' }));
    assert.equal(direct.status, 'paid');
    assert.deepEqual(events, []);
    const wrapped = await provider.completeHostedPayment(wrappedDb, 'payment-1');
    assert.equal(wrapped.status, 'paid');
    assert.deepEqual(events, ['payment-1']);
    assert.equal(await provider.completeHostedPayment(hostedDatabase({ existingStatus: 'paid' }), 'payment-1'), null);
    assert.deepEqual(events, ['payment-1']);
  } finally {
    provider.paymentEvents.off('payment.succeeded', listener);
  }
});
