'use strict';

// The web process shares a 512 MB instance with image work. sharp's default
// cache and thread pool are sized for a machine with more RAM than that.
// One thread and a small cache keep a resize from holding a second heap.
function applySharpMemoryLimits() {
  try {
    const sharp = require('sharp');
    if (typeof sharp.concurrency === 'function') sharp.concurrency(1);
    if (typeof sharp.cache === 'function') sharp.cache({ memory: 16, files: 0, items: 20 });
    return true;
  } catch (_error) {
    return false;
  }
}

module.exports = { applySharpMemoryLimits };
