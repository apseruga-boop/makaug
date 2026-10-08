'use strict';

/**
 * A query that passes N parameters but never mentions one of them ($k) fails
 * in PostgreSQL with "could not determine data type of parameter $k" — every
 * time. PATCH /api/properties/:id/status passed actorId as $6 and never used it
 * from 22 Apr to 8 Oct 2026, so every approval fell back to a compact update
 * that skipped approved_at, rejected_at, reviewed_by and the owner edit token.
 *
 * This scans every static `db.query(`...`, [ ... ])` / `client.query(...)` in
 * routes/ and services/ and fails when a passed parameter is never referenced.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function jsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== 'node_modules') out.push(...jsFiles(full)); } else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

// Count the top-level elements of the array literal starting at `start` ("[").
function arrayElementCount(source, start) {
  let depth = 0;
  let count = 0;
  let sawToken = false;
  let quote = null;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (ch === '\\') { i += 1; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '\'' || ch === '"' || ch === '`') { quote = ch; sawToken = true; continue; }
    if (ch === '/' && source[i + 1] === '/') { const nl = source.indexOf('\n', i); i = nl < 0 ? source.length : nl; continue; }
    if ('([{'.includes(ch)) {
      depth += 1;
      if (depth > 1) sawToken = true;
      continue;
    }
    if (')]}'.includes(ch)) {
      depth -= 1;
      if (depth === 0) return { count: sawToken ? count + 1 : count, end: i };
      continue;
    }
    if (depth === 1 && ch === ',') { count += 1; sawToken = false; continue; }
    if (depth === 1 && ch === '.' && source.slice(i, i + 3) === '...') return null; // spread: can't count
    if (!/\s/.test(ch)) sawToken = true;
  }
  return null;
}

function findUnusedParameters(source) {
  const problems = [];
  const call = /\b(?:db|client|pool|database|tx|trx)\.query\(\s*`([^`]*)`\s*,\s*\[/g;
  let match;
  while ((match = call.exec(source))) {
    const sql = match[1];
    if (sql.includes('${')) continue; // assembled at runtime
    const arrayStart = match.index + match[0].length - 1;
    const parsed = arrayElementCount(source, arrayStart);
    if (!parsed) continue;
    for (let k = 1; k <= parsed.count; k += 1) {
      if (!new RegExp(`\\$${k}(?!\\d)`).test(sql)) {
        const line = source.slice(0, match.index).split('\n').length;
        problems.push({ line, param: `$${k}`, passed: parsed.count });
      }
    }
  }
  return problems;
}

test('the listing status update uses every parameter it passes', () => {
  const source = fs.readFileSync(path.join(ROOT, 'routes', 'properties.js'), 'utf8');
  const start = source.indexOf("logger.error('Full listing status update failed");
  const before = source.slice(0, start);
  const queryStart = before.lastIndexOf('await db.query(');
  const problems = findUnusedParameters(source.slice(queryStart, start));
  assert.deepStrictEqual(problems, []);
});

test('no static query passes a parameter it never uses', () => {
  const failures = [];
  for (const file of [...jsFiles(path.join(ROOT, 'routes')), ...jsFiles(path.join(ROOT, 'services'))]) {
    for (const problem of findUnusedParameters(fs.readFileSync(file, 'utf8'))) {
      failures.push(`${path.relative(ROOT, file)}:${problem.line} passes ${problem.passed} params but never uses ${problem.param}`);
    }
  }
  assert.deepStrictEqual(failures, []);
});

test('the scanner catches the 8 Oct bug shape', () => {
  const sample = "await db.query(`UPDATE t SET a = $1, b = $2, c = $4 WHERE id = $3`, [a, b, c, d]);";
  assert.deepStrictEqual(findUnusedParameters(sample).map((p) => p.param), []);
  const broken = "await db.query(`UPDATE t SET a = $1, c = $3 WHERE id = $4`, [a, b, c, d]);";
  assert.deepStrictEqual(findUnusedParameters(broken).map((p) => p.param), ['$2']);
});
