'use strict';

/**
 * Who sent an outreach film: a person's name, never a raw phone number.
 *
 * WhatsApp records the sender as the employee's number (Arthur •••202,
 * Ronald •••189 on the live list). The desk should show "Arthur" or
 * "Ronald" — or another staff account name — and only fall back to the
 * last three digits when we genuinely do not know who it was.
 */

function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

function prospectPhoneKey(value) {
  return digitsOnly(value).slice(-9);
}

function maskPhoneLast3(value) {
  const digits = digitsOnly(value);
  if (!digits) return '';
  return `•••${digits.slice(-3)}`;
}

function looksLikePhoneLabel(value) {
  const text = String(value || '').trim();
  if (!text) return true;
  if (text.startsWith('•••')) return true;
  const digits = digitsOnly(text);
  if (digits.length < 9) return false;
  const stripped = text.replace(/[\s+()-]/g, '');
  return digits.length >= stripped.length - 1;
}

function canonicalSenderName(name) {
  const text = String(name || '').trim();
  if (!text || looksLikePhoneLabel(text)) return '';
  if (/^arthur$/i.test(text)) return 'Arthur';
  if (/^ronald$/i.test(text)) return 'Ronald';
  if (/^arthur\b/i.test(text)) return text.replace(/^arthur/i, 'Arthur');
  if (/^ronald\b/i.test(text)) return text.replace(/^ronald/i, 'Ronald');
  return text;
}

function senderBucket(name) {
  const text = String(name || '').trim().toLowerCase();
  if (text === 'arthur' || text.startsWith('arthur ')) return 'arthur';
  if (text === 'ronald' || text.startsWith('ronald ')) return 'ronald';
  return 'other';
}

function knownOutreachSenders(env = process.env, extras = {}) {
  const map = { ...(extras && typeof extras === 'object' ? extras : {}) };
  const add = (phone, name) => {
    const key = prospectPhoneKey(phone);
    const label = canonicalSenderName(name);
    if (key.length === 9 && label) map[key] = label;
  };
  add(env.AGENT_HELP_CONTACT_PHONE, env.AGENT_HELP_CONTACT_NAME || 'Ronald');
  try {
    const film = require('./agentFilmReplyService');
    add(film.ARTHUR_WHATSAPP, 'Arthur');
    if (!prospectPhoneKey(env.AGENT_HELP_CONTACT_PHONE)) {
      const fallback = film.agentJoinAlertRecipients(env).find(
        (phone) => prospectPhoneKey(phone) !== prospectPhoneKey(film.ARTHUR_WHATSAPP)
      );
      if (fallback) add(fallback, env.AGENT_HELP_CONTACT_NAME || 'Ronald');
    }
  } catch (_) { /* optional in tests that stub this module */ }
  return map;
}

function knownOutreachSenderName(phone, known) {
  const key = prospectPhoneKey(phone);
  if (!key) return '';
  const map = known && typeof known === 'object' && !Array.isArray(known)
    ? known
    : knownOutreachSenders();
  return map[key] || '';
}

/**
 * A display name for the person who sent the film.
 * Preference: stored name, then a known staff number, then a staff
 * account name, then the last three digits of the number we have.
 */
function resolveOutreachSenderName(row = {}, known) {
  const fromName = canonicalSenderName(row.pitched_by_name);
  if (fromName) return fromName;
  const fromNumber = knownOutreachSenderName(row.pitched_by, known);
  if (fromNumber) return fromNumber;
  const fromAccount = canonicalSenderName(row.sender_account_name);
  if (fromAccount) return fromAccount;
  return maskPhoneLast3(row.pitched_by) || 'Staff';
}

function nameForStorage({ pitchedBy = '', pitchedByName = '', prospectName = '' } = {}, known) {
  const provided = canonicalSenderName(pitchedByName);
  const prospect = String(prospectName || '').trim().toLowerCase();
  if (provided && provided.toLowerCase() !== prospect) return provided;
  return knownOutreachSenderName(pitchedBy, known) || '';
}

module.exports = {
  digitsOnly,
  prospectPhoneKey,
  maskPhoneLast3,
  looksLikePhoneLabel,
  canonicalSenderName,
  senderBucket,
  knownOutreachSenders,
  knownOutreachSenderName,
  resolveOutreachSenderName,
  nameForStorage
};
