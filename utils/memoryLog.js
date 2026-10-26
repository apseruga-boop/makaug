'use strict';

const logger = require('../config/logger');
const { trackWork } = require('./eventLoopLagMonitor');

function mb(bytes) {
  return Math.round(Number(bytes || 0) / 1048576);
}

function memoryFields(usage = process.memoryUsage()) {
  return {
    rss_mb: mb(usage.rss),
    heap_used_mb: mb(usage.heapUsed),
    heap_total_mb: mb(usage.heapTotal),
    external_mb: mb(usage.external)
  };
}

function logMemory(event, fields = {}) {
  logger.info('memory', { event, ...memoryFields(), ...fields });
}

// Jobs are tracked as in-flight work too, so an event_loop_stall line names
// the scheduler job that was running instead of saying in_flight=none.
async function observeJob(name, fn) {
  const before = memoryFields();
  logMemory('job_before', { job: name, ...before });
  const done = trackWork(`job ${name}`);
  try {
    return await fn();
  } finally {
    done();
    const after = memoryFields();
    logMemory('job_after', {
      job: name,
      rss_delta_mb: after.rss_mb - before.rss_mb,
      heap_delta_mb: after.heap_used_mb - before.heap_used_mb,
      ...after
    });
  }
}

module.exports = { memoryFields, logMemory, observeJob };
