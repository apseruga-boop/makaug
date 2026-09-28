'use strict';

/**
 * PostgreSQL has to be able to work out what type every parameter is, and a few
 * SQL constructs give it nothing to work from. CONCAT and CONCAT_WS are the
 * ones that keep catching us: they accept "any", so a bare `$5` inside one has
 * no type to inherit and PostgreSQL rejects the entire statement:
 *
 *   42P08  could not determine data type of parameter $5
 *
 * This has now bitten production twice, in the same shape, five days apart.
 *
 *   25 Sep 2026 — routes/admin.js, appending to an agent's verification_reason
 *                 while linking listings. Fixed by casting that one parameter.
 *   28 Sep 2026 — routes/whatsapp.js, appending to an agent's verification_reason
 *                 while attaching an ID that arrived later. Jonathan Wassajja
 *                 was registered without an ID, came back with one, and Agent
 *                 007 answered "I could not create the agent profile, so intake
 *                 has paused."
 *
 * The second one was avoidable. After the first, the right move was to sweep the
 * codebase for the same construct — instead the single instance in front of me
 * got fixed and its twin sat waiting. So this test checks the whole repository
 * rather than any one statement, and it fails on the next one somebody writes.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SEARCH_DIRS = ['routes', 'services', 'scripts', 'config'];

function jsFiles() {
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && !entry.name.startsWith('.')) walk(full);
      } else if (entry.name.endsWith('.js')) {
        found.push(full);
      }
    }
  };
  for (const dir of SEARCH_DIRS) {
    const full = path.join(ROOT, dir);
    if (fs.existsSync(full)) walk(full);
  }
  return found;
}

// Everything between CONCAT( or CONCAT_WS( and its closing bracket, allowing one
// level of nesting so NULLIF(col, '') inside does not end the match early.
const CONCAT_CALL = /CONCAT(?:_WS)?\s*\(((?:[^()]|\([^()]*\))*)\)/gi;
// A parameter with no cast immediately after it. Covers both literal $5 and the
// `$${idx}` form used where statements are assembled.
const UNCAST_PARAM = /\$\d+(?!\s*::)|\$\$\{[^}]*\}(?!\s*::)/g;

test('no bare SQL parameter sits inside CONCAT or CONCAT_WS', () => {
  const offences = [];
  for (const file of jsFiles()) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      CONCAT_CALL.lastIndex = 0;
      let call;
      while ((call = CONCAT_CALL.exec(line)) !== null) {
        const bare = call[1].match(UNCAST_PARAM);
        if (bare) {
          offences.push(`${path.relative(ROOT, file)}:${index + 1}  ${bare.join(', ')}  ${line.trim().slice(0, 100)}`);
        }
      }
    });
  }
  assert.deepStrictEqual(offences, [],
    'CONCAT_WS cannot type a bare parameter — add ::text (or the right type).\n'
    + 'Each of these would fail at runtime with 42P08:\n  ' + offences.join('\n  '));
});

test('the two statements this rule was written for are cast', () => {
  const whatsapp = fs.readFileSync(path.join(ROOT, 'routes', 'whatsapp.js'), 'utf8');
  assert.match(whatsapp, /CONCAT_WS\(' ', NULLIF\(verification_reason, ''\), \$5::text\)/,
    'attaching a late ID to an agent who was registered without one');

  const admin = fs.readFileSync(path.join(ROOT, 'routes', 'admin.js'), 'utf8');
  const adminCasts = admin.match(/CONCAT_WS\(' ', NULLIF\(verification_reason, ''\), \$\d+::text\)/g) || [];
  assert.ok(adminCasts.length >= 2, 'the two in admin.js that were fixed on 25 Sep must stay cast');

  const report = fs.readFileSync(path.join(ROOT, 'services', 'reportListingModerationService.js'), 'utf8');
  assert.match(report, /CONCAT_WS\(E'\\n', NULLIF\(moderation_notes, ''\), \$4::text\)/,
    'the third instance, found by sweeping rather than by an outage');
});

test('the scan would actually catch a new one', () => {
  // A rule nobody has seen fail is a rule nobody should trust. This is the
  // shape of the line that broke Agent 007, run through the same matcher.
  const broken = "verification_reason = CONCAT_WS(' ', NULLIF(verification_reason, ''), $5),";
  CONCAT_CALL.lastIndex = 0;
  const call = CONCAT_CALL.exec(broken);
  assert.ok(call, 'the matcher finds the CONCAT_WS call');
  assert.deepStrictEqual(call[1].match(UNCAST_PARAM), ['$5'], 'and flags the uncast parameter');

  const fixed = "verification_reason = CONCAT_WS(' ', NULLIF(verification_reason, ''), $5::text),";
  CONCAT_CALL.lastIndex = 0;
  const fixedCall = CONCAT_CALL.exec(fixed);
  assert.strictEqual(fixedCall[1].match(UNCAST_PARAM), null, 'and is satisfied once it is cast');
});
