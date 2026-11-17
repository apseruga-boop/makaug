'use strict';

// 17 Nov: a shared login (moderator1) on a laptop that had run practice picked "Arthur (test)" and
// 18 real working calls went to the practice account, so King saw Ronald at 0. The practice account
// is now only offered to King and to its own login, and a caller's own login only calls as them.
// Runs only against a scratch database (CALLING_SANDBOX_DB).
if (process.env.CALLING_SANDBOX_DB) process.env.DATABASE_URL = process.env.CALLING_SANDBOX_DB;
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

test('practice account cannot be picked by a shared login; own logins call as themselves', { skip: !process.env.CALLING_SANDBOX_DB }, async () => {
  const db = require('../config/database');
  const c = require('../services/callingScreen');
  const callers = await c.loadCallers();
  const practice = callers.find((p) => p.sandbox);
  const real = callers.find((p) => !p.sandbox && p.user_id);
  const other = callers.find((p) => !p.sandbox && p.key !== (real && real.key));
  assert.ok(practice && practice.user_id, 'practice login exists');
  const shared = crypto.randomUUID(); // a login that is not any caller (like moderator1)

  const bootShared = await c.bootstrap({ userId: shared, scope: 'staff' });
  assert.ok(!bootShared.callers.some((p) => p.key === practice.key), 'shared login is not offered the practice account');
  assert.ok((await c.bootstrap({ userId: '', isKing: true })).callers.some((p) => p.key === practice.key), 'King still sees it');
  assert.ok((await c.bootstrap({ userId: practice.user_id, scope: 'caller' })).callers.some((p) => p.key === practice.key), 'its own login sees it');

  await assert.rejects(c.startSession({ personKey: practice.key, taskKey: 'new_agents', actorUserId: shared, actorAccount: 'Moderator 1' }), (e) => e.status === 403 && /practice account/.test(e.message));
  if (real && other) await assert.rejects(c.startSession({ personKey: other.key, taskKey: 'new_agents', actorUserId: real.user_id, actorAccount: real.name }), (e) => e.status === 403 && /signed in as/.test(e.message));

  const own = await c.startSession({ personKey: practice.key, taskKey: 'new_agents', actorUserId: practice.user_id, actorAccount: 'Arthur (test)' });
  await c.endSession(own.session.id);
  const king = await c.startSession({ personKey: practice.key, taskKey: 'new_agents', isKing: true, actorAccount: 'King' });
  await c.endSession(king.session.id);
  if (other) { const s = await c.startSession({ personKey: other.key, taskKey: 'new_agents', actorUserId: shared, actorAccount: 'Moderator 1' }); await c.endSession(s.session.id); }
  await db.query('SELECT 1');
});

test.after(async () => { if (process.env.CALLING_SANDBOX_DB) await require('../config/database').pool.end().catch(() => null); });
