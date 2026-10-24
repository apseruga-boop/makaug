'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const seo = require('../services/publicSeoService');

function row(id, listingType = 'sale') {
  return {
    id,
    listing_type: listingType,
    title: 'House',
    description: 'A house.',
    area: 'Kira',
    district: 'Wakiso',
    price: 200000000,
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-02T00:00:00.000Z',
    extra_fields: { canonical_location_id: 'wakiso:kira' },
    canonical_location_id: 'wakiso:kira'
  };
}

test('a snapshot without getClient pages and stops on a short page', async () => {
  seo.__seoSnapshotCache.clear();
  const calls = [];
  const db = {
    async query(_sql, params) {
      calls.push(params);
      const offset = params[1];
      if (offset === 0) {
        return { rows: Array.from({ length: seo.SEO_SNAPSHOT_PAGE_SIZE }, (_, index) => row(`p${index}`)) };
      }
      return { rows: [row('tail')] };
    }
  };
  const snapshot = await seo.loadPublicSeoInventorySnapshot(db, { force: true });
  assert.deepEqual(calls, [[seo.SEO_SNAPSHOT_PAGE_SIZE, 0], [seo.SEO_SNAPSHOT_PAGE_SIZE, seo.SEO_SNAPSHOT_PAGE_SIZE]]);
  assert.equal(snapshot.properties.length, seo.SEO_SNAPSHOT_PAGE_SIZE + 1);
  assert.equal(snapshot.properties.at(-1).id, 'tail');
  seo.__seoSnapshotCache.clear();
});

test('a snapshot with getClient streams a cursor and releases the client', async () => {
  seo.__seoSnapshotCache.clear();
  const queries = [];
  let released = false;
  const db = {
    async getClient() {
      return {
        async query(sql) {
          queries.push(sql);
          if (sql.startsWith('FETCH')) return { rows: [row('cursor-row')] };
          return { rows: [] };
        },
        release() {
          released = true;
        }
      };
    },
    async query() {
      throw new Error('paged query must not run when getClient exists');
    }
  };
  const snapshot = await seo.loadPublicSeoInventorySnapshot(db, { force: true });
  assert.equal(released, true);
  assert.ok(queries.some((sql) => sql.startsWith('BEGIN')));
  assert.ok(queries.some((sql) => sql.includes('DECLARE makaug_seo_snapshot NO SCROLL CURSOR FOR')));
  assert.ok(queries.some((sql) => sql.startsWith('FETCH 400')));
  assert.ok(queries.some((sql) => sql.startsWith('COMMIT')));
  assert.equal(snapshot.properties.length, 1);
  assert.equal(snapshot.properties[0].id, 'cursor-row');
  const empty = seo.buildPublicSeoSnapshot([]);
  assert.equal(empty.properties.length, 0);
  assert.equal(empty.categoryTotals.sale, 0);
  seo.__seoSnapshotCache.clear();
});
