'use strict';

const logger = require('../config/logger');

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

async function observeJob(name, fn) {
  const before = memoryFields();
  logMemory('job_before', { job: name, ...before });
  try {
    return await fn();
  } finally {
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
