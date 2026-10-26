const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { firstSyncDays } = require('../services/leadDeskService');

const dbWithNewest = (at) => ({ query: async () => ({ rows: [{ at }] }) });

test('after a restart the first sync reads back from the newest lead, not a year', async () => {
  // Half-day offsets keep the rounding away from a whole-day edge.
  const twoDaysAgo = new Date(Date.now() - 2.5 * 86_400_000);
  assert.equal(await firstSyncDays(dbWithNewest(twoDaysAgo), 365), 6);
  const fortyDaysAgo = new Date(Date.now() - 40.5 * 86_400_000);
  assert.equal(await firstSyncDays(dbWithNewest(fortyDaysAgo), 365), 44);
  assert.equal(await firstSyncDays(dbWithNewest(new Date()), 365), 3);
});

test('an empty desk, an old desk or a failed read still uses the full window', async () => {
  assert.equal(await firstSyncDays(dbWithNewest(null), 365), 365);
  assert.equal(await firstSyncDays(dbWithNewest(new Date('2020-01-01')), 365), 365);
  assert.equal(await firstSyncDays({ query: async () => { throw new Error('down'); } }, 365), 365);
});

test('the scheduled tick runs the listing match at most hourly and leaves the alert poll alone', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'services/leadDeskService.js'), 'utf8');
  assert.match(src, /LEAD_DESK_MATCH_EVERY_MS \|\| 60 \* 60_000/);
  assert.match(src, /Date\.now\(\) - lastScheduledMatchAt >= MATCH_EVERY_MS/);
  // The tick's poll (which carries the WhatsApp alerts) is unchanged.
  assert.match(src, /LEAD_DESK_POLL_MS \|\| 5 \* 60_000/);
});
