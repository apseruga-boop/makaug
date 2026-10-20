'use strict';

/**
 * 20 Oct 2026: when shared media fails to load on our side the agent must not be
 * asked to resend. The failure is parked and retried by us on a backoff.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

process.env.NODE_ENV = 'test';
const realDb = require('../config/database');
const router = require('../routes/whatsapp');
const { parkEmployeeMediaForRetry, sweepEmployeeMediaRetries, EMPLOYEE_MEDIA_FAILURE_RE } = router.__test;

test('every "could not load your media" reply is recognised as a failure to retry', () => {
  assert(EMPLOYEE_MEDIA_FAILURE_RE.test('I could not store that media permanently, so it was not added to review. Please wait before resending'));
  assert(EMPLOYEE_MEDIA_FAILURE_RE.test('No usable media bytes reached makaug. Please resend the photo, video or document.'));
  assert(!EMPLOYEE_MEDIA_FAILURE_RE.test('Got it — I have your photo safe.'));
});

test('failed media is parked with its original message and a retry time', async () => {
  const writes = [];
  const original = realDb.query;
  realDb.query = async (sql, params) => {
    if (/SELECT session_data->'media_retry_queue'/.test(sql)) return { rows: [{ queue: [] }] };
    if (/jsonb_set/.test(sql)) { writes.push(JSON.parse(params[1])); return { rows: [] }; }
    return { rows: [] };
  };
  try {
    const ok = await parkEmployeeMediaForRetry({
      phone: '256774505232', body: 'Plot in Mukono', inboundMessageId: 'MSG1',
      runtime: { provider: 'web_bridge', photoCandidates: [{ url: 'https://bridge.example/media?id=1', mime_type: 'image/jpeg' }] }
    });
    assert.strictEqual(ok, true);
    assert.strictEqual(writes[0][0].inboundMessageId, 'MSG1');
    assert.strictEqual(writes[0][0].runtime.photoCandidates[0].mimeType, 'image/jpeg');
    assert(new Date(writes[0][0].nextAt).getTime() > Date.now());
    // Nothing fetchable means nothing to retry.
    assert.strictEqual(await parkEmployeeMediaForRetry({ phone: '1', body: 'x', inboundMessageId: 'M2', runtime: { photoCandidates: [{ data_url: 'data:image/png;base64,AA' }] } }), false);
    // After the last retry it stops, so the agent is finally asked once.
    assert.strictEqual(await parkEmployeeMediaForRetry({ phone: '1', body: 'x', inboundMessageId: 'M3', attempt: 5, runtime: { photoCandidates: [{ url: 'https://a.example/x' }] } }), false);
  } finally { realDb.query = original; }
});

test('the sweeper ignores entries that are not due yet', async () => {
  const original = realDb.query;
  const sqls = [];
  realDb.query = async (sql) => {
    sqls.push(String(sql));
    if (/media_retry_queue' AS queue/.test(sql)) return { rows: [{ phone: '1', queue: [{ inboundMessageId: 'A', nextAt: new Date(Date.now() + 600000).toISOString() }] }] };
    return { rows: [] };
  };
  try {
    assert.strictEqual(await sweepEmployeeMediaRetries(), 0);
    assert(!sqls.some((q) => /jsonb_set/.test(q)));
  } finally { realDb.query = original; }
});

test('the server starts the media retry sweeper and the wrapper hands failures to it', () => {
  assert(fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8').includes('startEmployeeMediaRetrySweeper'));
  assert(fs.readFileSync(path.join(__dirname, '../routes/whatsapp.js'), 'utf8').includes('employeeIntake.message = EMPLOYEE_MEDIA_RETRY_ACK'));
});
