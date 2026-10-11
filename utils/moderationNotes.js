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

module.exports = {
  appendModerationNote,
  kampalaNoteStamp,
  moderationActorLabel
};
