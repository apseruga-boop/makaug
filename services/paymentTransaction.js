'use strict';

const transactions = new WeakMap();

function transactionError(code, message) {
  return Object.assign(new Error(message), { code });
}

function assertPaymentTransaction(tx) {
  const state = tx && (typeof tx === 'object' || typeof tx === 'function') ? transactions.get(tx) : null;
  if (!state) throw transactionError('PAYMENT_TRANSACTION_REQUIRED', 'A payment transaction is required.');
  if (!state.active) throw transactionError('PAYMENT_TRANSACTION_CLOSED', 'This payment transaction has ended.');
  if (state.failure) throw state.failure;
  return tx;
}

function assertOutsidePaymentTransaction(db) {
  if (db && (typeof db === 'object' || typeof db === 'function') && transactions.has(db)) {
    throw transactionError('PAYMENT_TRANSACTION_WRAPPER', 'Use the transaction-specific payment function inside a payment transaction.');
  }
}

async function withPaymentTransaction(db, work) {
  if (typeof work !== 'function') throw new TypeError('Payment transaction work must be a function.');
  const nested = db && (typeof db === 'object' || typeof db === 'function') ? transactions.get(db) : null;
  if (nested) {
    assertPaymentTransaction(db);
    try {
      return await work(db);
    } catch (error) {
      nested.failure ||= error;
      throw error;
    }
  }
  const acquire = db && (typeof db.getClient === 'function' ? db.getClient : db.connect);
  if (typeof acquire !== 'function') {
    throw transactionError('PAYMENT_CLIENT_REQUIRED', 'Payment transactions require an acquired database client.');
  }
  const client = await acquire.call(db);
  if (!client || typeof client.query !== 'function' || typeof client.release !== 'function') {
    if (client && typeof client.release === 'function') client.release();
    throw transactionError('PAYMENT_CLIENT_REQUIRED', 'The payment database must provide a releasable query client.');
  }
  const state = { active: true, failure: null };
  const tx = Object.freeze({
    async query(statement, values) {
      assertPaymentTransaction(tx);
      const text = typeof statement === 'string' ? statement : statement?.text;
      if (typeof text !== 'string') throw new TypeError('A payment query must contain SQL text.');
      const commands = text.replace(/'(?:[^']|'')*'|"(?:[^"]|"")*"|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\//g, ' ');
      if (/(?:^|;)\s*(?:BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|END|START\s+TRANSACTION|PREPARE\s+TRANSACTION)\b/i.test(commands)) {
        const error = transactionError('PAYMENT_TRANSACTION_CONTROL', 'Payment helpers cannot control their transaction.');
        state.failure ||= error;
        throw error;
      }
      try {
        return await client.query(statement, values);
      } catch (error) {
        state.failure ||= error;
        throw error;
      }
    }
  });
  transactions.set(tx, state);
  try {
    await client.query('BEGIN');
    const result = await work(tx);
    if (state.failure) throw state.failure;
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    state.active = false;
    client.release();
  }
}

module.exports = { withPaymentTransaction, assertPaymentTransaction, assertOutsidePaymentTransaction };
