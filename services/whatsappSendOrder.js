'use strict';

/**
 * One phone's messages are handled in the order the phone sent them.
 *
 * 22 Nov 2026, 09:47 in Kampala. Twenty of an agent's adverts were forwarded
 * to Agent 007 in three seconds. Among them: a captioned photo of a 12-decimal
 * plot in Kira Nakwero, then a video captioned "One acre NAJEERA UGX1
 * billion", then that advert's two photos. All four reached makaug in that
 * order, inside one millisecond. But a message only joins its phone's line
 * once the checks in front of the line are done, and a caption has more of
 * those than a photo with no words (the short-stay and booking replies read
 * the words first). The two photos got into the line ahead of the video, were
 * handled while the Nakwero plot was the property being built, and went onto
 * it. The Najjera acre was created ten seconds later with no photos at all.
 *
 * So the line is ordered by when WhatsApp delivered each message (WAHA stamps
 * that time into its event id, to the millisecond), not by when each message
 * happened to be ready. One message still runs at a time; while it runs the
 * others wait, and the next to run is the earliest sent. A message that finds
 * the line empty waits a moment first when it carries media, or when the phone
 * is in the middle of a burst, so that a message sent just before it can catch
 * up. Ties, and messages with no send time, keep their order of arrival.
 */

const DEFAULT_SETTLE_MS = 1200;
const MAX_SETTLE_MS = 5000;
// Another message from the same phone this recently means a burst.
const BURST_WINDOW_MS = 5000;

/** How long a message that finds the line empty waits for one sent just before it. */
function settleMs(env = process.env) {
  const raw = env.WHATSAPP_SEND_ORDER_SETTLE_MS;
  if (raw !== undefined && String(raw).trim() !== '') {
    const value = Number(raw);
    if (Number.isFinite(value) && value >= 0) return Math.min(MAX_SETTLE_MS, Math.round(value));
  }
  // Tests drive the runtime one message at a time; waiting would only slow them.
  if (env.NODE_TEST_CONTEXT || String(env.NODE_ENV || '').toLowerCase() === 'test') return 0;
  return DEFAULT_SETTLE_MS;
}

let arrivals = 0;

/** A number for each message as it arrives, taken before anything is awaited. */
function nextArrivalSeq() {
  arrivals += 1;
  return arrivals;
}

const lines = new Map();
const lastArrival = new Map();

function sentBefore(a, b) {
  if (a.senderMs > 0 && b.senderMs > 0 && a.senderMs !== b.senderMs) return a.senderMs < b.senderMs;
  return a.seq < b.seq;
}

function forgetQuietPhones(now) {
  if (lastArrival.size < 2000) return;
  for (const [key, at] of lastArrival) {
    if (now - at > BURST_WINDOW_MS && !lines.has(key)) lastArrival.delete(key);
  }
}

async function pump(key, line, { now, sleep, settle }) {
  if (line.running) return;
  line.running = true;
  try {
    let first = true;
    while (line.waiting.length) {
      if (first && settle > 0 && line.waiting.some((entry) => entry.settle)) {
        const from = Math.min(...line.waiting.map((entry) => entry.arrivedAt));
        const wait = from + settle - now();
        if (wait > 0) await sleep(wait);
      }
      first = false;
      let next = 0;
      for (let index = 1; index < line.waiting.length; index += 1) {
        if (sentBefore(line.waiting[index], line.waiting[next])) next = index;
      }
      const [entry] = line.waiting.splice(next, 1);
      try {
        entry.resolve(await entry.task());
      } catch (error) {
        entry.reject(error);
      }
    }
  } finally {
    line.running = false;
    if (!line.waiting.length && lines.get(key) === line) lines.delete(key);
  }
}

/**
 * Run `task` for this phone once every message it sent earlier has run.
 * `senderMs`: when WhatsApp delivered it (0 when not known). `media`: it
 * carries a photo, video or document. `seq`: its arrival number, from
 * nextArrivalSeq, when it was taken earlier on the way in. `describes`: its
 * words describe a property (see describedWaiting). Resolves or rejects with
 * what `task` resolves or rejects with.
 */
function runInSendOrder(key, { senderMs = 0, media = false, seq = 0, describes = false } = {}, task, options = {}) {
  const now = options.now || Date.now;
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const settle = options.settleMs === undefined ? settleMs() : Math.max(0, Number(options.settleMs) || 0);
  const lineKey = String(key || 'unknown');
  const arrivedAt = now();
  const previous = lastArrival.get(lineKey) || 0;
  const burst = previous > 0 && arrivedAt - previous <= BURST_WINDOW_MS;
  lastArrival.set(lineKey, arrivedAt);
  forgetQuietPhones(arrivedAt);
  let line = lines.get(lineKey);
  if (!line) {
    line = { waiting: [], running: false };
    lines.set(lineKey, line);
  }
  return new Promise((resolve, reject) => {
    line.waiting.push({
      senderMs: Number(senderMs) > 0 ? Number(senderMs) : 0,
      seq: Number(seq) > 0 ? Number(seq) : nextArrivalSeq(),
      arrivedAt,
      settle: Boolean(media) || burst,
      describes: Boolean(describes),
      task,
      resolve,
      reject
    });
    pump(lineKey, line, { now, sleep, settle });
  });
}

/**
 * How many messages from this phone that describe a property are waiting in
 * line behind the one being handled now.
 *
 * 22 Nov 2026, looked at photo by photo: in a forwarded batch WhatsApp's
 * delivery order is not the order of the adverts. A Kira house's caption was
 * on its second photo, so its first photo came straight after the Kasangati
 * plot; three more of its photos came after two other adverts. A photo with no
 * description, handled while another description is still waiting, is part of
 * a batch of several adverts, and whose it is cannot be told from the order.
 */
function describedWaiting(key) {
  const line = lines.get(String(key || 'unknown'));
  if (!line) return 0;
  return line.waiting.filter((entry) => entry.describes).length;
}

function resetSendOrderForTests() {
  lines.clear();
  lastArrival.clear();
}

module.exports = {
  DEFAULT_SETTLE_MS,
  BURST_WINDOW_MS,
  settleMs,
  nextArrivalSeq,
  runInSendOrder,
  describedWaiting,
  resetSendOrderForTests
};
