'use strict';

// 26 Oct 2026: a moderator's internal note vanished when Save was refused
// (save target mismatch, Save used to reject, approve with no photo or video)
// or failed with a server error. The note is now written first and the
// response says note_saved, so the editor can show "Note saved".

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../config/database');
const router = require('../routes/staff');

const ID = '11111111-2222-4333-8444-555555555555';
const OTHER = '99999999-2222-4333-8444-555555555555';

function reviewHandler() {
  const layer = router.stack.find((entry) => entry.route
    && entry.route.path === '/properties/:id/review'
    && entry.route.methods.patch);
  assert.ok(layer, 'PATCH /properties/:id/review is registered');
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function withDb(handler) {
  const original = db.query;
  const writes = [];
  db.query = async (sql, params = []) => {
    const text = String(sql);
    if (/^\s*UPDATE properties SET moderation_notes/.test(text)) { writes.push({ notes: params[1], id: params[0] }); return { rows: [] }; }
    if (/staff_listing_note_saved/.test(text)) return { rows: [] };
    return handler(text, params);
  };
  return { writes, restore: () => { db.query = original; } };
}

async function call(body, id = ID) {
  const handle = reviewHandler();
  const req = { params: { id }, body, userAuth: { id: '00000000-0000-4000-8000-000000000001', first_name: 'Mod', role: 'moderator' } };
  let nextError = null;
  const res = {
    statusCode: 200, payload: null, headers: {},
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
    set(key, value) { this.headers[key] = value; return this; }
  };
  await handle(req, res, (error) => { nextError = error; });
  return { res, nextError };
}

const noteRow = (text, params) => (/SELECT id, moderation_notes FROM properties/.test(text)
  ? { rows: [{ id: params[0], moderation_notes: '' }] }
  : null);

test('a save-target mismatch keeps the note on the open listing', async () => {
  const stub = withDb((text, params) => noteRow(text, params) || { rows: [] });
  try {
    const { res } = await call({ listing: { id: OTHER }, notes: 'Called the owner, price confirmed.' });
    assert.equal(res.statusCode, 409);
    assert.equal(res.payload.note_saved, true);
    assert.equal(stub.writes.length, 1);
    assert.equal(stub.writes[0].id, ID);
    assert.match(stub.writes[0].notes, /Called the owner, price confirmed\./);
  } finally { stub.restore(); }
});

test('Save used to reject keeps the note', async () => {
  const stub = withDb((text, params) => noteRow(text, params) || { rows: [] });
  try {
    const { res } = await call({ listing: {}, stage: 'rejected', notes: 'Looks like a duplicate of FA7807.' });
    assert.equal(res.statusCode, 400);
    assert.equal(res.payload.code, 'reject_via_decision_panel');
    assert.equal(res.payload.note_saved, true);
    assert.equal(stub.writes.length, 1);
  } finally { stub.restore(); }
});

test('approving with no photo or video keeps the note', async () => {
  // The media summary queries return no rows: no photo, no video.
  const stub = withDb((text, params) => noteRow(text, params) || { rows: [] });
  try {
    const { res } = await call({ listing: {}, stage: 'approved', notes: 'Waiting for the agent to send photos.' });
    assert.equal(res.statusCode, 422);
    assert.equal(res.payload.note_saved, true);
    assert.equal(stub.writes.length, 1);
  } finally { stub.restore(); }
});

test('a server error keeps the note and answers note_saved', async () => {
  let selects = 0;
  const stub = withDb((text, params) => {
    const row = noteRow(text, params);
    if (row) return row;
    if (/SELECT \* FROM properties WHERE id = \$1/.test(text)) { selects += 1; throw new Error('connection reset'); }
    return { rows: [] };
  });
  try {
    const { res, nextError } = await call({ listing: { title: 'New title' }, notes: 'Agent says it is still available.' });
    assert.equal(nextError, null);
    assert.equal(selects, 1);
    assert.equal(res.statusCode, 500);
    assert.equal(res.payload.note_saved, true);
    assert.equal(stub.writes.length, 1);
  } finally { stub.restore(); }
});

test('no note typed: nothing extra is written', async () => {
  const stub = withDb((text, params) => noteRow(text, params) || { rows: [] });
  try {
    const { res } = await call({ listing: {}, stage: 'rejected' });
    assert.equal(res.statusCode, 400);
    assert.equal(res.payload.note_saved, false);
    assert.equal(stub.writes.length, 0);
  } finally { stub.restore(); }
});

test('the same note sent twice is written once', async () => {
  const existing = { notes: '' };
  const stub = withDb((text, params) => (/SELECT id, moderation_notes FROM properties/.test(text)
    ? { rows: [{ id: params[0], moderation_notes: existing.notes }] }
    : { rows: [] }));
  try {
    await call({ listing: {}, stage: 'rejected', notes: 'Duplicate of FA7807.' });
    existing.notes = stub.writes[0].notes;
    const { res } = await call({ listing: {}, stage: 'rejected', notes: 'Duplicate of FA7807.' });
    assert.equal(res.payload.note_saved, true);
    assert.equal(stub.writes.length, 1);
  } finally { stub.restore(); }
});
