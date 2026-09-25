'use strict';

/**
 * Turning a WhatsApp address into something we can store and reply to.
 *
 * A JID is `user:device@server`. The device part only appears when the person
 * is messaging from a linked device — WhatsApp Web, Desktop, a second phone —
 * and it is not part of their number.
 *
 * Stripping the `@server` and then every non-digit used to glue the device
 * number onto the end of the phone number:
 *
 *   256709402189:2@s.whatsapp.net  ->  256709402189:2  ->  2567094021892
 *
 * On 24 Sep 2026 that opened a conversation for "2567094021892", a number
 * nobody owns. Eight messages arrived on it and not one reply could be
 * delivered, so the person sat typing "Hello" into silence while his real
 * conversation went untouched. The device is cut off before the digits are
 * read.
 */

/** Digits-only phone, no leading +. WhatsApp chat ids are `<digits>@c.us`. */
function toPhone(value) {
  return String(value || '')
    .replace(/@.*$/, '')
    .replace(/:.*$/, '')
    .replace(/\D+/g, '');
}

/**
 * Anything already carrying an `@` is an address WhatsApp gave us — a group, or
 * a LID chat we could not map to a number. Replying to it as-is is correct and
 * always beats inventing a number from its digits.
 */
function toChatId(recipient) {
  const raw = String(recipient || '').trim();
  if (raw.includes('@')) return raw;
  const phone = toPhone(raw);
  return phone ? `${phone}@c.us` : '';
}

/** True when a JID names a linked device rather than the person's main one. */
function hasDeviceSuffix(value) {
  return /^[^@]*:/.test(String(value || ''));
}

module.exports = { hasDeviceSuffix, toChatId, toPhone };
