'use strict';

const { appendModerationNote } = require('./moderationNotes');

// Generic button labels are not hold reasons.
const GENERIC_PENDING_REASONS = /^(?:staff moderation update|staff approved after moderation review)$/i;

function clean(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

// "Keep pending" must not lose why a listing is held. A typed reason wins;
// otherwise the row's current reason stays. A typed internal note is added
// under the notes already stored, with who wrote it and when.
function keepPendingModerationFields(current = {}, { reason = null, notes = null, author = 'staff', at = new Date() } = {}) {
  const typedReason = clean(reason);
  const storedReason = clean(current.moderation_reason);
  const nextReason = typedReason && !GENERIC_PENDING_REASONS.test(typedReason)
    ? typedReason
    : (storedReason || typedReason || null);
  const typedNote = clean(notes);
  const nextNotes = typedNote
    ? appendModerationNote(current.moderation_notes, typedNote, { author, at })
    : null;
  return { reason: nextReason, notes: nextNotes || null };
}

module.exports = { keepPendingModerationFields };
