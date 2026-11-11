'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  isSystemApprovalPreviewNote,
  moderationNotesForApproval,
} = require('../utils/moderationNotes');

const EVIDENCE = 'Re-verified original YouTube post: 2 bedrooms + half apartment for rent in Makindye Kizungu at UGX 2,000,000; property imagery present and contact matches.';
const PREVIEW = 'Staff preview completed before approval';
const IDENTITY = 'Identity verified and listing facts checked before approval';

test('the approval boilerplate is recognised and does not replace a staff evidence note', () => {
  assert.equal(isSystemApprovalPreviewNote(PREVIEW), true);
  assert.equal(isSystemApprovalPreviewNote(IDENTITY), true);
  assert.equal(isSystemApprovalPreviewNote(EVIDENCE), false);

  const kept = moderationNotesForApproval(EVIDENCE, PREVIEW, { author: 'Moderator', at: new Date('2026-11-11T06:40:21Z') });
  assert.equal(kept, EVIDENCE);

  const emptyForm = moderationNotesForApproval(EVIDENCE, '', { author: 'Moderator', at: new Date('2026-11-11T06:40:21Z') });
  assert.equal(emptyForm, EVIDENCE);

  const identityDefault = moderationNotesForApproval(EVIDENCE, IDENTITY, { author: 'Moderator', at: new Date('2026-11-11T06:40:21Z') });
  assert.equal(identityDefault, EVIDENCE);
});

test('a typed approval note is appended under the existing evidence note', () => {
  const next = moderationNotesForApproval(EVIDENCE, 'Pin confirmed at Kizungu Secondary School.', {
    author: 'Moderator',
    at: new Date('2026-11-11T06:40:21Z'),
  });
  assert.match(next, /Makindye Kizungu/);
  assert.match(next, /Pin confirmed at Kizungu Secondary School/);
  assert.ok(next.startsWith(EVIDENCE));
});

test('the status approval path keeps the listing note and records the preview text on the event', () => {
  const source = fs.readFileSync(path.join(__dirname, '../routes/properties.js'), 'utf8');
  const start = source.indexOf("router.patch('/:id/status'");
  const end = source.indexOf('const writeModerationAuditEvents');
  assert.ok(start >= 0 && end > start, 'status handler not found');
  const block = source.slice(start, end);
  assert.match(block, /moderationNotesForApproval\(/);
  assert.match(block, /listingModerationNotes/);
  assert.match(block, /eventNotes/);
  assert.match(block, /moderation_notes = COALESCE\(\$5::text, moderation_notes\)/);
  // The UPDATE must use the preserved listing notes, not the raw request body.
  assert.match(block, /JSON\.stringify\(checklist\),\s*listingModerationNotes,/);
});
