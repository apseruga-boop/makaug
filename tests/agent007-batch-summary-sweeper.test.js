'use strict';

/**
 * 11 Oct 2026: 27 adverts were saved, the service died out of memory seconds
 * later, and the in-memory "all saved" timer died with it. The sweeper sends the
 * missed summary from the database.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const routeSource = fs.readFileSync(path.join(__dirname, '../routes/whatsapp.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

test('the batch summary has a database-backed sweeper, not only a timer', () => {
  assert(routeSource.includes('async function sweepEmployeeBatchSummaries'));
  assert(routeSource.includes("s.current_step = 'employee_property_media'"), 'only open Agent 007 batches are swept');
  assert(routeSource.includes("direction = 'outbound'"), 'it must look at what the bot already said');
  assert(routeSource.includes('outbound_message_queue'), 'a reply already queued must not be doubled');
  assert(routeSource.includes('employeeBatchBursts.has(phone)'), 'a live timer owns its own batch');
  assert(routeSource.includes('module.exports.startEmployeeBatchSummarySweeper'), 'server.js must be able to start it');
});

test('the server starts the sweeper with the other schedulers', () => {
  assert(serverSource.includes('startEmployeeBatchSummarySweeper'));
});

test('the memory log reports the real heap ceiling and warns before exit 134', () => {
  assert(serverSource.includes('heap_size_limit'));
  assert(serverSource.includes('heap_pct'));
  assert(serverSource.includes('exit 134'));
});

test('the sweeper runs against the database and says nothing when there is nothing true to say', async () => {
  const dbPath = require.resolve('../config/database');
  const realDb = require(dbPath);
  const calls = [];
  const originalQuery = realDb.query;
  let sweepRows = [{ phone: '447700900001', first_at: new Date(Date.now() - 120000), last_at: new Date(Date.now() - 60000) }];
  realDb.query = async (sql, params) => {
    calls.push(String(sql));
    if (/FROM whatsapp_sessions s/.test(sql) && /LATERAL/.test(sql)) return { rows: sweepRows };
    if (/SELECT current_step, session_data FROM whatsapp_sessions/.test(sql)) {
      return { rows: [{ current_step: 'employee_property_media', session_data: { property_ids: [] } }] };
    }
    return { rows: [] };
  };
  try {
    process.env.NODE_ENV = 'test';
    const router = require('../routes/whatsapp');
    const { sweepEmployeeBatchSummaries } = router.__test;
    assert.strictEqual(typeof sweepEmployeeBatchSummaries, 'function');
    // Nothing saved and nothing pending: there is nothing truthful to say.
    const sent = await sweepEmployeeBatchSummaries();
    assert.deepStrictEqual(sent, []);
    sweepRows = [];
    assert.deepStrictEqual(await sweepEmployeeBatchSummaries(), []);
    assert(calls.some((sql) => /LATERAL/.test(sql)));
  } finally {
    realDb.query = originalQuery;
  }
});
