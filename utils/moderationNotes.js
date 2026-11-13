'use strict';

function cleanNote(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function kampalaNoteStamp(at = new Date()) {
  const date = at instanceof Date ? at : new Date(at);
  const when = Number.isNaN(date.getTime()) ? new Date() : date;
  try {
    const formatted = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Kampala',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).format(when);
    return `${formatted} EAT`;
  } catch (_) {
    return when.toISOString();
  }
}

function moderationActorLabel(user = {}) {
  const name = [user.first_name, user.last_name].map((part) => String(part || '').trim()).filter(Boolean).join(' ');
  return name || String(user.email || user.phone || user.name || '').trim() || 'staff';
}

// A new internal note is added under the notes already stored, with who wrote
// it and when. Saving the same text again does not duplicate it. A textarea
// that still starts with the old note only adds the new ending.
function appendModerationNote(existing, incoming, { author = 'staff', at = new Date() } = {}) {
  const prev = String(existing == null ? '' : existing).trim();
  const next = cleanNote(incoming);
  if (!next) return prev;
  if (prev && (next === cleanNote(prev) || cleanNote(prev).startsWith(next))) return prev;
  let addition = next;
  const prevFlat = cleanNote(prev);
  if (prev && next.startsWith(prevFlat)) {
    addition = next.slice(prevFlat.length).replace(/^[\s:;,-]+/, '').trim();
    if (!addition) return prev;
  }
  if (prev && prev.includes(addition)) return prev;
  const line = `[${kampalaNoteStamp(at)}] ${cleanNote(author) || 'staff'}: ${addition}`;
  return prev ? `${prev}\n${line}` : line;
}

const SYSTEM_APPROVAL_PREVIEW_NOTES = [
  'Staff preview completed before approval',
  'Identity verified and listing facts checked before approval',
];

function isSystemApprovalPreviewNote(value) {
  const text = cleanNote(value);
  if (!text) return false;
  return SYSTEM_APPROVAL_PREVIEW_NOTES.some((item) => text.toLowerCase() === item.toLowerCase());
}

function stripSystemApprovalPreviewNotes(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return '';
  const kept = raw.split(/\n+/).map((line) => cleanNote(line)).filter((line) => line && !isSystemApprovalPreviewNote(line));
  return kept.join('\n');
}

// Approval used to SET moderation_notes to "Staff preview completed before
// approval" whenever the preview form's notes box was empty, wiping a
// moderator's evidence note (7C1D37, 11 Nov 2026). Keep the stored note.
// A real typed note is appended. The preview boilerplate belongs on the
// moderation event, not as a replacement listing note.
function moderationNotesForApproval(existing, incoming, { author = 'staff', at = new Date() } = {}) {
  const prev = String(existing == null ? '' : existing).trim();
  const addition = stripSystemApprovalPreviewNotes(incoming);
  if (!addition) return prev || null;
  return appendModerationNote(prev, addition, { author, at }) || null;
}

const SYSTEM_REJECTION_PREVIEW_NOTES = [
  'Rejected from staff preview',
];

function isSystemRejectionPreviewNote(value) {
  const text = cleanNote(value);
  if (!text) return false;
  return SYSTEM_REJECTION_PREVIEW_NOTES.some((item) => text.toLowerCase() === item.toLowerCase());
}

function stripSystemRejectionPreviewNotes(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return '';
  const kept = raw.split(/\n+/).map((line) => cleanNote(line)).filter((line) => line && !isSystemRejectionPreviewNote(line));
  return kept.join('\n');
}

// Reject from staff preview used to SET moderation_notes to "Rejected from
// staff preview" whenever the notes box was empty, wiping a moderator's
// evidence note (0DD234, 13 Nov 2026). Keep the stored note. A real typed
// note is appended. The visible rejection reason stays on moderation_reason.
// The preview boilerplate belongs on the moderation event, not as a
// replacement listing note.
function moderationNotesForRejection(existing, incoming, { author = 'staff', at = new Date() } = {}) {
  const prev = String(existing == null ? '' : existing).trim();
  const addition = stripSystemRejectionPreviewNotes(incoming);
  if (!addition) return prev || null;
  return appendModerationNote(prev, addition, { author, at }) || null;
}

const APPROVAL_NOTE_BOILERPLATE = 'Staff preview completed before approval';
const REJECTION_NOTE_BOILERPLATE = 'Rejected from staff preview';
const DEFAULT_IMPORTER_STAFF_REVIEW_NOTE = 'Confirm the exact property pin and local amenities with the listing agent before approval.';

const SYSTEM_NOTE_LINES = new Set([
  ...SYSTEM_APPROVAL_PREVIEW_NOTES.map((item) => item.toLowerCase()),
  'staff approved after previewing listing facts',
  'listing facts were updated as part of the moderation status action.',
  'staff/admin confirmed location and overrode non-location checks for this found-online approval.',
  'bulk staff review approved found-online source; owner notification left manual.',
  'rejected from staff preview',
  'human override — verified manually',
  'staff-sourced: owner checklist waived',
  DEFAULT_IMPORTER_STAFF_REVIEW_NOTE.toLowerCase(),
]);

function isImportTemplateModerationNote(value) {
  const text = String(value == null ? '' : value).trim();
  if (!text) return false;
  return /^(FOUND-ONLINE SOURCE POST IMPORT|SOCIAL SEARCH LISTING)\./i.test(text)
    || /^(CARNELIAN AUTHORISED LISTING|BAKAIMA AUTHORISED LISTING)\./i.test(text);
}

function stripLeadingSystemNoteLines(value) {
  const lines = String(value == null ? '' : value).trim().split('\n');
  while (lines.length) {
    const line = lines[0].trim();
    if (!line) {
      lines.shift();
      continue;
    }
    if (SYSTEM_NOTE_LINES.has(cleanNote(line).toLowerCase())) {
      lines.shift();
      continue;
    }
    if (/^human override/i.test(line) || /^staff-sourced:/i.test(line)) {
      lines.shift();
      continue;
    }
    break;
  }
  return lines.join('\n').trim();
}

function isRecoverableStaffModerationNote(value) {
  const text = String(value == null ? '' : value).trim();
  if (!text) return false;
  if (SYSTEM_NOTE_LINES.has(cleanNote(text).toLowerCase())) return false;
  if (isImportTemplateModerationNote(text)) return false;
  if (/^human override/i.test(text) && !/\n/.test(text)) return false;
  if (/^staff-sourced:/i.test(text) && !/\n/.test(text)) return false;
  const stripped = stripLeadingSystemNoteLines(text);
  if (!stripped) return false;
  if (isImportTemplateModerationNote(stripped)) return false;
  if (SYSTEM_NOTE_LINES.has(cleanNote(stripped).toLowerCase())) return false;
  return true;
}

function stripApprovalBoilerplatePrefix(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return '';
  return raw.replace(/^Staff preview completed before approval\s*/i, '').trim();
}

// Plan a restore after approval replaced moderation_notes with the staff-preview
// boilerplate. If the current note starts with that boilerplate and then a
// real staff note, only the prefix is stripped. Otherwise the most recent
// recoverable prior note (newest first) is used. Import templates and system
// lines are not recoverable.
function planApprovalBoilerplateNoteRestore(currentNotes, priorNotesNewestFirst = []) {
  const current = String(currentNotes == null ? '' : currentNotes).trim();
  const remainder = stripApprovalBoilerplatePrefix(current);
  if (remainder && isRecoverableStaffModerationNote(remainder)) {
    const restored = stripLeadingSystemNoteLines(remainder) || remainder;
    if (restored && restored !== current) return { mode: 'strip_prefix', restored_notes: restored };
    return { mode: 'already_ok', restored_notes: null };
  }
  const priors = Array.isArray(priorNotesNewestFirst) ? priorNotesNewestFirst : [];
  for (const prior of priors) {
    if (!isRecoverableStaffModerationNote(prior)) continue;
    const restored = stripLeadingSystemNoteLines(String(prior == null ? '' : prior).trim()) || String(prior).trim();
    if (!restored) continue;
    if (restored === current) return { mode: 'already_ok', restored_notes: null };
    return { mode: 'restore_prior', restored_notes: restored };
  }
  return { mode: 'skip_no_recoverable_note', restored_notes: null };
}

module.exports = {
  APPROVAL_NOTE_BOILERPLATE,
  REJECTION_NOTE_BOILERPLATE,
  appendModerationNote,
  kampalaNoteStamp,
  moderationActorLabel,
  isSystemApprovalPreviewNote,
  stripSystemApprovalPreviewNotes,
  moderationNotesForApproval,
  isSystemRejectionPreviewNote,
  stripSystemRejectionPreviewNotes,
  moderationNotesForRejection,
  isImportTemplateModerationNote,
  isRecoverableStaffModerationNote,
  stripLeadingSystemNoteLines,
  stripApprovalBoilerplatePrefix,
  planApprovalBoilerplateNoteRestore
};
