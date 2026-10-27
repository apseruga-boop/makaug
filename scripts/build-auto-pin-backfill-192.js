'use strict';

// Builds db/migrations/192_auto_pin_unpinned_listings.sql from the dry-run
// plan (planned-writes.json, made on 27 Oct 2026 from production reads).
// Usage: node scripts/build-auto-pin-backfill-192.js /path/to/planned-writes.json

const fs = require('fs');
const path = require('path');

const input = process.argv[2];
if (!input) throw new Error('usage: build-auto-pin-backfill-192.js planned-writes.json');
const planned = JSON.parse(fs.readFileSync(input, 'utf8'));
const rows = planned.map((row) => ({
  id: row.id,
  lat: Number(row.lat),
  lng: Number(row.lng),
  to: row.patch.coords_fix.to,
  to_key: row.patch.coords_fix.to_key
}));
const payload = JSON.stringify(rows).replace(/\},\{/g, '},\n{');
const template = fs.readFileSync(path.join(__dirname, 'auto-pin-backfill-192.sql.template'), 'utf8');
const sql = template
  .replace('__EXPECTED__', String(rows.length))
  .replace('__EXPECTED_HEADER__', String(rows.length))
  .replace('__PAYLOAD__', payload);
fs.writeFileSync(path.join(__dirname, '../db/migrations/192_auto_pin_unpinned_listings.sql'), sql);
console.log(`wrote ${rows.length} rows`);
