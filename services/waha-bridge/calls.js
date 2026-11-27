'use strict';

/**
 * WhatsApp calls to the number, told to makaug once each call is over.
 *
 * 27 Nov 2026. Arthur sent a photo of the phone's Calls tab: six people had
 * rung the number since 4 Nov, two of them twice, and makaug knew of none of
 * them. Two had never written, so to makaug they did not exist. Since the move
 * to WAHA in September no call had reached makaug: this service passed on
 * messages only, and the session's webhook carries messages only. The session
 * is not to be touched, so calls are read from WAHA's websocket, which needs
 * no change to it, and from the webhook too should it ever carry them.
 *
 * WAHA (GOWS) says three things about a call: call.received when it starts
 * ringing, call.accepted when it is answered on another device (the phone),
 * and call.rejected when it is declined or ends. makaug is told once, when the
 * call is over: answered, or missed. A call that is never said to have ended
 * is counted missed two minutes after it started ringing, so a lost event
 * cannot hide a caller.
 */

const CALL_EVENTS = Object.freeze(['call.received', 'call.accepted', 'call.rejected']);
// WhatsApp stops ringing after about a minute; this is the backstop.
const RING_LIMIT_MS = 2 * 60 * 1000;
// Long enough for a late or repeated event about the same call to be recognised.
const FORGET_AFTER_MS = 15 * 60 * 1000;

function isCallEvent(name) {
  return CALL_EVENTS.includes(String(name || ''));
}

function startOf(payload, now) {
  const ts = Number(payload?.timestamp);
  if (!Number.isFinite(ts) || ts <= 0) return now;
  // WAHA gives seconds; a value already in milliseconds is taken as it is.
  return ts > 1e12 ? ts : ts * 1000;
}

/**
 * Follows each call from its first event to its end and calls `settle` once
 * per call: { id, from, isVideo, data, startedAt, endedAt, status, endedBy }.
 * status is 'answered' or 'missed'; endedBy is 'answered_on_phone', 'ended'
 * (declined, or the caller gave up) or 'no_end_event' (the backstop).
 */
function createCallTracker({
  settle,
  now = () => Date.now(),
  timers = { set: setTimeout, clear: clearTimeout },
  ringLimitMs = RING_LIMIT_MS,
  forgetAfterMs = FORGET_AFTER_MS,
} = {}) {
  if (typeof settle !== 'function') throw new Error('createCallTracker needs settle()');
  const calls = new Map();
  const stats = { received: 0, answered: 0, missed: 0, group_calls_ignored: 0, repeats_ignored: 0, last_call_at: 0 };

  function later(fn, ms) {
    const t = timers.set(fn, ms);
    if (t && typeof t.unref === 'function') t.unref();
    return t;
  }

  function finish(call, status, endedBy) {
    if (call.done) return false;
    call.done = true;
    if (call.timer) timers.clear(call.timer);
    call.timer = null;
    stats[status === 'answered' ? 'answered' : 'missed'] += 1;
    later(() => calls.delete(call.id), forgetAfterMs);
    settle({
      id: call.id,
      from: call.from,
      isVideo: call.isVideo,
      data: call.data,
      startedAt: call.startedAt,
      endedAt: now(),
      status,
      endedBy,
    });
    return true;
  }

  function track(id, payload) {
    const call = {
      id,
      from: String(payload?.from || ''),
      isVideo: payload?.isVideo === true,
      data: payload?._data && typeof payload._data === 'object' ? payload._data : null,
      startedAt: startOf(payload, now()),
      done: false,
      timer: null,
    };
    calls.set(id, call);
    stats.received += 1;
    stats.last_call_at = now();
    return call;
  }

  function onEvent(event, payload = {}) {
    const name = String(event || '');
    if (!isCallEvent(name)) return { handled: false, reason: 'not_a_call_event' };
    const id = String(payload?.id || '').trim();
    if (!id) return { handled: false, reason: 'no_call_id' };
    const from = String(payload?.from || '');
    // A group call is not somebody asking for us.
    if (payload?.isGroup === true || from.endsWith('@g.us')) {
      if (name === 'call.received') stats.group_calls_ignored += 1;
      return { handled: false, reason: 'group_call' };
    }

    let call = calls.get(id);
    if (name === 'call.received') {
      if (call) {
        stats.repeats_ignored += 1;
        return { handled: true, repeat: true };
      }
      call = track(id, payload);
      call.timer = later(() => finish(call, 'missed', 'no_end_event'), ringLimitMs);
      return { handled: true, ringing: true };
    }

    if (call && call.done) {
      // The end of a call already told (a hang-up after it was answered), or a repeat.
      return { handled: true, repeat: true };
    }
    // Its start was not seen (this service restarted while it rang): what is known now is told.
    if (!call) call = track(id, payload);
    if (!call.from && from) call.from = from;
    if (name === 'call.accepted') finish(call, 'answered', 'answered_on_phone');
    else finish(call, 'missed', 'ended');
    return { handled: true };
  }

  return { onEvent, stats, ringing: () => [...calls.values()].filter((c) => !c.done).length };
}

/**
 * The caller's number as WhatsApp wrote it inside the event, when the call
 * came from a LID address. GOWS passes whatsmeow's own fields under _data and
 * their spelling has changed between versions, so the known names are tried
 * at a few depths. Only a phone address counts, never a LID's digits, and
 * never our own number.
 */
const CALLER_KEYS = ['CallCreatorAlt', 'CallerPN', 'callerPn', 'caller_pn', 'FromAlt', 'SenderAlt', 'CallCreator', 'From', 'from'];
const PHONE_JID = /^\d{6,15}(?::\d+)?@(?:c\.us|s\.whatsapp\.net)$/;

function callerJidIn(data, ownNumber = '', depth = 0) {
  if (!data || typeof data !== 'object' || depth > 3) return '';
  const own = String(ownNumber || '').replace(/\D+/g, '');
  const isOwn = (jid) => Boolean(own) && String(jid).replace(/@.*$/, '').replace(/:.*$/, '').replace(/\D+/g, '') === own;
  for (const key of CALLER_KEYS) {
    const value = data[key];
    const text = typeof value === 'string' ? value : (value && typeof value === 'object' && typeof value.String === 'string' ? value.String : '');
    if (PHONE_JID.test(text) && !isOwn(text)) return text;
  }
  for (const value of Object.values(data)) {
    if (value && typeof value === 'object') {
      const found = callerJidIn(value, ownNumber, depth + 1);
      if (found) return found;
    }
  }
  return '';
}

module.exports = { CALL_EVENTS, RING_LIMIT_MS, isCallEvent, createCallTracker, callerJidIn };
