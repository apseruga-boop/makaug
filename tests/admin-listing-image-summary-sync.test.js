'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const admin = fs.readFileSync(path.join(__dirname, '../routes/admin.js'), 'utf8');
const svc = require('../services/staffPropertyMediaService');

test('admin photo add and delete rewrite the summary the review card reads', () => {
  assert.strictEqual(typeof svc.syncListingImageSummary, 'function');
  const del = admin.slice(admin.indexOf("router.delete('/properties/:id/images/:imageId'"));
  assert(del.slice(0, del.indexOf('COMMIT')).includes('syncListingImageSummary'), 'delete path syncs');
  const add = admin.slice(admin.indexOf("router.post('/properties/:id/images'"));
  assert(add.slice(0, add.indexOf('COMMIT')).includes('syncListingImageSummary'), 'add path syncs');
  assert(admin.includes("router.post('/properties/resync-image-summaries'"));
  const patch = admin.slice(admin.indexOf("router.patch('/properties/:id/images/:imageId'"));
  assert(patch.slice(0, patch.indexOf('COMMIT')).includes('syncListingImageSummary'), 'primary/replace path syncs');
});

test('the summary ignores evidence slots and names the first public photo as primary', async () => {
  const calls = [];
  const client = {
    query: async (sql, params) => {
      calls.push([sql, params]);
      if (/SELECT id, url, slot_key/.test(sql)) {
        return { rows: [
          { id: 'e', url: 'https://x/evidence.jpg', slot_key: 'source_evidence_original', is_primary: true },
          { id: 'a', url: 'https://x/a.jpg', slot_key: null, is_primary: false },
          { id: 'b', url: 'https://x/b.jpg', slot_key: 'gallery', is_primary: false }
        ] };
      }
      return { rows: [] };
    }
  };
  const summary = await svc.syncListingImageSummary(client, '00000000-0000-0000-0000-000000000001');
  assert.deepStrictEqual(summary, { public_image_count: 2, image_count: 2, primary_image_url: 'https://x/a.jpg' });
  const update = calls.find(([sql]) => /UPDATE properties/.test(sql));
  assert(update && JSON.parse(update[1][1]).primary_image_url === 'https://x/a.jpg');
});
