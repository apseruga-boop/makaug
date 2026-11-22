'use strict';

/**
 * Migration 252 puts back what 251 took off descriptions that were not broken
 * (22 Nov 2026). A WhatsApp intake description opens with its own lead
 * ("Land for sale in Kissasi, Kampala, listed at UGX 900,000,000.") and then
 * the agent's caption, whose first words are often the listing's title; 251
 * took that lead and title off as if a save had added them.
 *
 * It was run against a scratch Postgres: 251 first, on one made-up listing for
 * each shape (the ones it repaired right, the ones it cut wrongly, one edited
 * by staff after it), then 252 twice. These checks keep the parts that make
 * it safe.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '252_description_repair_corrected.sql'), 'utf8');

test('252 starts again from the text 251 kept, and only where nobody on the team has edited since', () => {
  assert.match(sql, /WHERE e\.actor_id = 'system_migration_251'\s+AND e\.action = 'description_repeated_title_removed'/);
  assert.match(sql, /d := r\.before_251;/);
  assert.match(sql, /AND x\.created_at > e\.created_at\s+AND COALESCE\(x\.actor_id, ''\) ~\* '\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-'/, 'a later edit by a member of staff (a uuid) leaves the listing alone');
});

test("an intake's own lead, which has commas, is never taken off; a lead the save added has none", () => {
  assert.match(sql, /\(\?:for sale\|for rent\|to let\|to rent\|for lease\) in \[\^\.,\]\{2,60\}\$/);
  assert.match(sql, /COALESCE\(r\.source, ''\) <> 'whatsapp_employee_intake'\s+OR lower\(after_title\) LIKE tl \|\| '%'\s+OR lower\(after_title\) LIKE lower\(x\) \|\| '%'\s+OR after_title ~ '\^\(\?:Property for sale\|Rental property\|Land for sale\|Commercial property\|Student accommodation\|Property listing\)/);
});

test('a listing 251 had right is not written again; what 251 left is kept; nobody is sent anything', () => {
  assert.match(sql, /IF d IS DISTINCT FROM r\.description THEN/);
  assert.match(sql, /'description_before', r\.description, 'description_before_251', r\.before_251/);
  const writes = sql.match(/\b(?:INSERT INTO|UPDATE)\s+\w+/gi) || [];
  assert.deepStrictEqual([...new Set(writes.map((w) => w.split(/\s+/).pop()))].sort(), ['properties', 'property_moderation_events']);
  assert.doesNotMatch(sql, /outbound_message_queue|notifications/i);
});
