"use strict";
const test = require('node:test');
const assert = require('node:assert');
const billing = require('../services/billingOpsService');

function fakeDb(state) {
  return {
    async query(sql, params) {
      if (/FROM notifications/.test(sql)) return { rowCount: state.__logged ? 1 : 0, rows: [] };
      if (/INSERT INTO billing_settings/.test(sql)) {
        const [key, value] = params;
        if (state[key] === value) return { rowCount: 0, rows: [] };
        state[key] = value;
        return { rowCount: 1, rows: [{ key }] };
      }
      throw new Error('unexpected sql ' + sql);
    }
  };
}

test('the trial digest day is claimed once; a restart the same day does not win it again', async () => {
  const state = {};
  const db = fakeDb(state);
  assert.equal(await billing.claimTrialDigestDay(db, '2026-10-26'), true);
  assert.equal(await billing.claimTrialDigestDay(db, '2026-10-26'), false, 'second process, same day');
  assert.equal(await billing.claimTrialDigestDay(db, '2026-10-26'), false);
  assert.equal(await billing.claimTrialDigestDay(db, '2026-10-27'), true, 'next day sends again');
  assert.equal(state[billing.TRIAL_DIGEST_DAY_KEY], JSON.stringify('2026-10-27'));
});

test('a digest already in the notifications log today blocks the claim', async () => {
  const state = { __logged: true };
  assert.equal(await billing.claimTrialDigestDay(fakeDb(state), '2026-10-26'), false);
});
