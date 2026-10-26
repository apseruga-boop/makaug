'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { inFlightSummary } = require('../utils/eventLoopLagMonitor');
const { observeJob } = require('../utils/memoryLog');

test('a scheduler job run through observeJob is named in the stall log while it runs', async () => {
  let seen = [];
  await observeJob('featured_rotation', async () => { seen = inFlightSummary(8); });
  assert.ok(seen.some((item) => item.startsWith('job featured_rotation (')), seen.join(' | '));
  assert.ok(!inFlightSummary(8).some((item) => item.startsWith('job featured_rotation')), 'cleared after the job');
});

test('a failing job is still cleared from in-flight work', async () => {
  await assert.rejects(observeJob('x_source_drip', async () => { throw new Error('boom'); }));
  assert.ok(!inFlightSummary(8).some((item) => item.startsWith('job x_source_drip')));
});
