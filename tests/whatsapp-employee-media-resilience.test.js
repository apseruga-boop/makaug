'use strict';

/**
 * 25 Sep 2026. Ronald registered Quick Auctioneers through Agent 007, then
 * forwarded two properties — the Queen Elizabeth Safari Lodge and a block of
 * residential units — followed by 72 photos and videos over eighty minutes.
 *
 * Nothing saved. Not one item. He typed COMPLETE four times and was refused
 * four times, and the review queue never received a thing.
 *
 * The server log says why:
 *
 *   [ERROR] WhatsApp employee pending property-media storage failed:
 *     TypeError: fetch failed
 *       at storeEmployeeMediaCandidate (routes/whatsapp.js:3723)
 *     [cause]: Error: Client network socket disconnected before secure TLS
 *              connection was established
 *
 *   [ERROR] WhatsApp employee pending property-media storage failed:
 *     Error: timeout exceeded when trying to connect   (pg-pool)
 *
 * Every photo has to be downloaded from the bridge's media proxy before it can
 * be stored. The bridge runs on half a CPU; under a 72-item burst it started
 * dropping TLS handshakes, and the database pool was drained behind it. Both
 * are transient. Both were treated as final: the media was discarded and he was
 * told to wait before resending.
 *
 * Worse, one failure discarded the whole message — photos that had already
 * uploaded went with it.
 *
 * These tests hold the three things that changed: a dropped connection is
 * retried, whatever stored is kept, and a count of zero is not reported as
 * "everything except".
 */

const test = require('node:test');
const assert = require('node:assert');

const {
  employeeBatchSummaryHeadline,
  fetchEmployeeMediaWithRetry,
  isTransientMediaFetchError,
  storeEmployeeMedia
} = require('../routes/whatsapp').__test;

const realFetch = global.fetch;
const restoreFetch = () => { global.fetch = realFetch; };

// The exact error undici raises when the bridge drops the handshake.
function droppedHandshake() {
  const cause = new Error('Client network socket disconnected before secure TLS connection was established');
  return Object.assign(new TypeError('fetch failed'), { cause });
}

test('the error that lost Ronald\'s 72 items is recognised as transient', () => {
  assert.strictEqual(isTransientMediaFetchError(droppedHandshake()), true);
  assert.strictEqual(isTransientMediaFetchError(new Error('timeout exceeded when trying to connect')), true);
  assert.strictEqual(isTransientMediaFetchError(Object.assign(new Error('x'), { cause: { code: 'ECONNRESET' } })), true);
  assert.strictEqual(isTransientMediaFetchError(Object.assign(new Error('x'), { cause: { code: 'UND_ERR_SOCKET' } })), true);
});

test('a decision about the file is not retried as though it were a network blip', () => {
  assert.strictEqual(isTransientMediaFetchError(new Error('Unsupported downloaded media type: text/html')), false);
  assert.strictEqual(isTransientMediaFetchError(new Error('WhatsApp image exceeds the 6MB intake limit')), false);
  assert.strictEqual(isTransientMediaFetchError(new Error('Private identity media rejected from property storage')), false);
});

test('a dropped handshake is retried until the photo comes through', async (t) => {
  t.after(restoreFetch);
  let attempts = 0;
  global.fetch = async () => {
    attempts += 1;
    if (attempts < 3) throw droppedHandshake();
    return { ok: true, status: 200, headers: new Map([['content-type', 'image/jpeg']]) };
  };
  const response = await fetchEmployeeMediaWithRetry('https://bridge.example/media/1.jpg');
  assert.strictEqual(response.ok, true, 'the third attempt succeeded, so the photo is not lost');
  assert.strictEqual(attempts, 3);
});

test('a proxy that is momentarily overloaded is retried too', async (t) => {
  t.after(restoreFetch);
  let attempts = 0;
  global.fetch = async () => {
    attempts += 1;
    return attempts < 2
      ? { ok: false, status: 503, headers: new Map() }
      : { ok: true, status: 200, headers: new Map([['content-type', 'image/jpeg']]) };
  };
  const response = await fetchEmployeeMediaWithRetry('https://bridge.example/media/2.jpg');
  assert.strictEqual(response.status, 200);
  assert.strictEqual(attempts, 2);
});

test('a 404 is an answer, not a blip — it comes straight back', async (t) => {
  t.after(restoreFetch);
  let attempts = 0;
  global.fetch = async () => {
    attempts += 1;
    return { ok: false, status: 404, headers: new Map() };
  };
  const response = await fetchEmployeeMediaWithRetry('https://bridge.example/gone.jpg');
  assert.strictEqual(response.status, 404);
  assert.strictEqual(attempts, 1, 'retrying a 404 only wastes the batch\'s time');
});

test('when every attempt drops, the failure still surfaces', async (t) => {
  t.after(restoreFetch);
  process.env.WHATSAPP_EMPLOYEE_MEDIA_FETCH_BACKOFF_MS = '1';
  let attempts = 0;
  global.fetch = async () => { attempts += 1; throw droppedHandshake(); };
  await assert.rejects(
    () => fetchEmployeeMediaWithRetry('https://bridge.example/never.jpg'),
    /fetch failed/
  );
  assert.ok(attempts > 1, 'it must have tried more than once before giving up');
});

test('one bad item no longer throws the whole message away', async () => {
  // A message can carry several photos. These all fail on their MIME type,
  // which is decided before any network call, so the loop is exercised without
  // touching storage.
  const bad = [{ remoteUrl: 'https://x/1.html', mimeType: 'text/html' }, { remoteUrl: 'https://x/2.html', mimeType: 'text/html' }];
  await assert.rejects(
    () => storeEmployeeMedia(bad, { phone: '256709402189', inboundMessageId: 'm1' }),
    (error) => {
      assert.strictEqual(error.employeeMediaFailures, 2,
        'the error must say how many were lost so the reply can be honest');
      return true;
    },
    'when nothing at all stored, the message does fail'
  );
});

test('an empty message stores nothing and complains about nothing', async () => {
  assert.deepStrictEqual(await storeEmployeeMedia([], { phone: '256709402189' }), []);
});

test('a count of zero is not reported as "everything except"', () => {
  // The literal line Ronald received eight times.
  const wrong = '📋 *Saved 0 of 2* — everything except the 2 below.';
  const headline = employeeBatchSummaryHeadline(0, 2);
  assert.notStrictEqual(headline, wrong);
  assert.ok(!/Saved 0 of/.test(headline), 'nothing saved must not be phrased as a saved count');
  assert.match(headline, /Nothing saved yet/);
  assert.match(headline, /all 2 properties below still need a detail/);
});

test('the other counts still read correctly', () => {
  assert.match(employeeBatchSummaryHeadline(0, 1), /the property below still needs a detail/);
  assert.match(employeeBatchSummaryHeadline(3, 2), /\*Saved 3 of 5\* — everything except the 2 below/);
  assert.match(employeeBatchSummaryHeadline(1, 1), /\*Saved 1 of 2\* — everything except the one below/);
  assert.match(employeeBatchSummaryHeadline(4, 0), /\*All 4 saved\* for staff review/);
});

test('a refused COMPLETE names the way out', () => {
  // Ronald typed COMPLETE four times over eighty minutes. The refusal never
  // mentioned that CANCEL existed, so there was no way to learn the batch could
  // be closed at all.
  const fs = require('fs');
  const path = require('path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'whatsapp.js'), 'utf8');
  const refusal = source.slice(source.indexOf('I have not completed this batch because one property'));
  assert.match(refusal.slice(0, 600), /reply \*CANCEL\*/,
    'the refusal must offer an exit, or COMPLETE is a locked door');
});
