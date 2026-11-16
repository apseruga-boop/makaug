'use strict';

/**
 * Branching call scripts ("routing"). During a call the caller sees what to
 * say and the replies they are most likely to give. Tapping a reply shows what
 * to say next. Every branch ends in a suggested wrap-up (outcome, note, next
 * step, when to call back) that pre-fills the wrap-up, so he only confirms.
 *
 * Node: { say, replies: [[label, nodeId], ...] }
 * End:  { end: { outcome, note, next, when, checks, hello } }
 *   when:   '24h' | '2d' | '3d' | 'mon' | 'best' (always at least 24 hours away)
 *   checks: true when the path covered every close check (price, MoMo code, Hello...)
 *   hello:  true when they agreed to send "Hello" on WhatsApp
 * Placeholders: {greeting} {name} {caller} {opener} {momo} {wa}
 */

const WRONG = { end: { outcome: 'wrong_number', note: 'Wrong number' } };
const DNC = { end: { outcome: 'do_not_contact', note: 'Asked not to be called again' } };

const later = (outcome, next) => ({
  say: 'Of course, no problem. When is a good time for me to call you back?',
  replies: [
    ['Tomorrow, this time', `${outcome}_cb_24h`],
    ['In 2 days', `${outcome}_cb_2d`],
    ['Next week', `${outcome}_cb_mon`]
  ],
  _ends: {
    [`${outcome}_cb_24h`]: { end: { outcome, note: 'Busy, asked to call back tomorrow', next, when: '24h' } },
    [`${outcome}_cb_2d`]: { end: { outcome, note: 'Busy, asked to call back in 2 days', next, when: '2d' } },
    [`${outcome}_cb_mon`]: { end: { outcome, note: 'Busy, asked to call back next week', next, when: 'mon' } }
  }
});

const NEW_AGENTS = {
  start: 'open',
  nodes: {
    open: {
      say: '{greeting} {name}? It is {caller} from makaug.com. {opener} I saw your property post online. Are you an agent, or do you own the place?',
      replies: [['I am an agent', 'pitch_agent'], ['I am the owner', 'pitch_owner'], ['Busy / call me later', 'later'], ['Who is this? Where did you get my number?', 'who'], ['Not interested', 'notint'], ['Wrong number', 'wrong']]
    },
    pitch_agent: {
      say: 'makaug.com shows your places to buyers and renters all over Uganda, with your name and number on every listing, and the enquiries come straight to you. Agents pay UGX 50,000 a month, no contract. How many places do you have right now?',
      replies: [['Sounds good, how do I join?', 'close_ask'], ['It is too expensive', 'price'], ['Can I try it free?', 'free'], ['I already use Jiji / Facebook', 'jiji'], ['Send me the details first', 'send_info'], ['Not interested', 'notint']]
    },
    pitch_owner: {
      say: 'makaug.com shows your place to buyers and renters all over Uganda, and they call you directly. For owners it is UGX 20,000 a month, no contract.',
      replies: [['OK, how do I start?', 'close_ask'], ['It is too expensive', 'price'], ['Send me the details first', 'send_info'], ['Not interested', 'notint']]
    },
    who: {
      say: 'It is {caller} from makaug.com, the property search site. I got your number from your own public post online. If you do not want calls I will mark it and nobody will call again.',
      replies: [['OK, go on', 'pitch_agent'], ['Do not call me again', 'dnc'], ['Not interested', 'notint']]
    },
    price: {
      say: 'One tenant or one sale pays it back many times. It is less than UGX 1,700 a day for a month of buyers and renters seeing your places, and you can stop any month.',
      replies: [['OK, let us do it', 'close_ask'], ['Let me think about it', 'think'], ['Still too much', 'no_price']]
    },
    free: {
      say: 'There is no free trial, but there is no long contract either: you can stop any month. Most agents get their first enquiries in the first week.',
      replies: [['OK, let us do it', 'close_ask'], ['Let me think about it', 'think'], ['Not interested', 'notint']]
    },
    jiji: {
      say: 'Keep them! makaug brings listings from everywhere so people search in one place, and your places carry your name and number.',
      replies: [['OK, how do I join?', 'close_ask'], ['Send me the details first', 'send_info'], ['Not interested', 'notint']]
    },
    send_info: {
      say: 'I will send you the short film and the link on WhatsApp. Please send "Hello" to {wa} now so my message reaches you.',
      replies: [['Sent Hello ✓', 'info_hello'], ['Will do it later', 'info_nohello']]
    },
    think: {
      say: 'No problem. I will send you the details on WhatsApp. Please send "Hello" to {wa} so it reaches you, and I will call you in two days.',
      replies: [['Sent Hello ✓', 'think_hello'], ['Will do it later', 'think_nohello']]
    },
    close_ask: {
      say: 'Great! To go live: pay UGX 50,000 a month (owners UGX 20,000), no free trial, by MoMo merchant code {momo}. Please send "Hello" on WhatsApp to {wa} now, then send your first places (photos, price, area). We confirm your payment and account on WhatsApp.',
      replies: [['Paying today ✓', 'signed_today'], ['Will pay tomorrow', 'signed_tomorrow'], ['Changed their mind', 'notint']]
    },
    notint: {
      say: 'Thank you for your time. Can I ask why, so we can do better?',
      replies: [['Price', 'no_price'], ['Uses another site', 'no_other'], ['Not an agent', 'no_agent'], ['Just not interested', 'no_plain']]
    },
    later: null,
    wrong: WRONG,
    dnc: DNC,
    info_hello: { end: { outcome: 'interested', note: 'Wants the film and link first; said Hello on WhatsApp', next: 'Send the film and link on WhatsApp, then call back', when: '24h', hello: true } },
    info_nohello: { end: { outcome: 'interested', note: 'Wants the film and link first; Hello not sent yet', next: 'Wait for their Hello, then send the film and link', when: '24h' } },
    think_hello: { end: { outcome: 'interested', note: 'Wants to think about it; said Hello on WhatsApp', next: 'Send the details on WhatsApp, then call back', when: '2d', hello: true } },
    think_nohello: { end: { outcome: 'interested', note: 'Wants to think about it', next: 'Send the details on WhatsApp, then call back', when: '2d' } },
    signed_today: { end: { outcome: 'signed_up', note: 'Signed up, paying by MoMo today', next: 'Confirm their first payment by MoMo', checks: true, hello: true } },
    signed_tomorrow: { end: { outcome: 'signed_up', note: 'Signed up, will pay tomorrow', next: 'Confirm their first payment by MoMo', when: '24h', checks: true, hello: true } },
    no_price: { end: { outcome: 'rejected', note: 'Not interested: price too high' } },
    no_other: { end: { outcome: 'rejected', note: 'Not interested: uses another site' } },
    no_agent: { end: { outcome: 'rejected', note: 'Not an agent' } },
    no_plain: { end: { outcome: 'rejected', note: 'Not interested' } }
  }
};

const PAYMENTS = {
  start: 'open',
  nodes: {
    open: {
      say: '{greeting} {name}, it is {caller} from makaug.com. {opener} You signed up as an agent, and your places go live once the UGX 50,000 is paid. Can you pay today by MoMo merchant code {momo}?',
      replies: [['Yes, paying now', 'pay_now'], ['I paid already', 'paid_already'], ['Tomorrow / on a date', 'promise'], ['I have no money now', 'nomoney'], ['Busy / call me later', 'later'], ['I want to stop', 'stop'], ['Wrong number', 'wrong']]
    },
    pay_now: {
      say: 'Thank you! Dial *165*3#, choose Merchant code {momo}, amount 50,000. When it goes through, send the MoMo reference on WhatsApp to {wa}. Your places stay live once it is confirmed.',
      replies: [['Paid on the call ✓', 'paid_now'], ['Will pay right after the call', 'promise_today']]
    },
    paid_already: {
      say: 'Thank you! Please send the MoMo reference on WhatsApp to {wa} so we can match it. The amount is UGX 50,000 to merchant code {momo}, and your places stay live once it is confirmed.',
      replies: [['Will send the reference ✓', 'paid_ref'], ['Cannot find the reference', 'paid_noref']]
    },
    promise: {
      say: 'No problem. Which day can you pay? I will note it and call you that day.',
      replies: [['Tomorrow', 'pr_24h'], ['In 2–3 days', 'pr_3d'], ['Next week', 'pr_mon']]
    },
    nomoney: {
      say: 'I understand. Which day can you pay? I will note it and call you that day, so your places are ready to go live.',
      replies: [['Gives a day', 'promise'], ['Wants to stop', 'stop']]
    },
    stop: {
      say: 'Sorry to hear that. Can I ask why, so we can fix it?',
      replies: [['No clients calling', 'stop_clients'], ['Too expensive', 'stop_price'], ['Will think about it', 'stop_think']]
    },
    later: null,
    wrong: WRONG,
    paid_now: { end: { outcome: 'paid', note: 'Paid by MoMo on the call, sending the reference on WhatsApp', next: 'Check MoMo for UGX 50,000 and confirm on WhatsApp', checks: true, hello: true } },
    paid_ref: { end: { outcome: 'paid', note: 'Says already paid, sending the MoMo reference', next: 'Check MoMo for UGX 50,000 and confirm on WhatsApp', checks: true, hello: true } },
    paid_noref: { end: { outcome: 'promised', note: 'Says paid, no reference yet', next: 'Check MoMo for UGX 50,000', when: '24h' } },
    promise_today: { end: { outcome: 'promised', note: 'Will pay today after the call', next: 'Chase payment: check MoMo for UGX 50,000', when: '24h' } },
    pr_24h: { end: { outcome: 'promised', note: 'Will pay tomorrow', next: 'Chase payment: check MoMo for UGX 50,000', when: '24h' } },
    pr_3d: { end: { outcome: 'promised', note: 'Will pay in 2–3 days', next: 'Chase payment: check MoMo for UGX 50,000', when: '3d' } },
    pr_mon: { end: { outcome: 'promised', note: 'Will pay next week', next: 'Chase payment: check MoMo for UGX 50,000', when: 'mon' } },
    stop_clients: { end: { outcome: 'rejected', note: 'Wants to stop: no clients calling', next: 'King to decide' } },
    stop_price: { end: { outcome: 'rejected', note: 'Wants to stop: too expensive', next: 'King to decide' } },
    stop_think: { end: { outcome: 'call_back', note: 'Wants to think about paying', next: 'Call back', when: '2d' } }
  }
};

const RETENTION = {
  start: 'open',
  nodes: {
    open: {
      say: '{greeting} {name}, it is {caller} from makaug.com. {opener} Just checking in: how is makaug working for you? Are clients calling about your places?',
      replies: [['Going well', 'good'], ['No clients calling', 'noclients'], ['I will renew later', 'renew_later'], ['Already renewed', 'renewed_ref'], ['Busy / call me later', 'later'], ['Not renewing', 'stop'], ['Wrong number', 'wrong']]
    },
    good: {
      say: 'Great to hear! Your renewal is UGX 50,000 by MoMo merchant code {momo}; send the reference on WhatsApp to {wa}. Any new places or photos I can put up for you?',
      replies: [['Renewing now ✓', 'renew_now'], ['Has new places to list', 'new_places'], ['Will renew later', 'renew_later']]
    },
    noclients: {
      say: 'Let me check your places with you. Good photos and a clear price get more calls. Send me new photos on WhatsApp to {wa} and I will update them.',
      replies: [['Will send new photos', 'help_photos'], ['Wants to stop', 'stop']]
    },
    renew_later: {
      say: 'No problem. Which day? I will note it so your places do not go down.',
      replies: [['Tomorrow', 'rl_24h'], ['Next week', 'rl_mon']]
    },
    renewed_ref: {
      say: 'Thank you! Please send the MoMo reference on WhatsApp to {wa} (UGX 50,000 to merchant code {momo}) so we can confirm it. Any new places or photos to put up?',
      replies: [['Will send the reference ✓', 'renew_now']]
    },
    stop: {
      say: 'Sorry to hear that. What would make it worth it for you? I will pass it on to the team.',
      replies: [['Too expensive', 'nr_price'], ['No time / stopped the business', 'nr_time'], ['Will think about it', 'nr_think']]
    },
    later: null,
    wrong: WRONG,
    renew_now: { end: { outcome: 'renewed', note: 'Renewed by MoMo, sending the reference', next: 'Check MoMo and confirm the renewal', checks: true, hello: true } },
    new_places: { end: { outcome: 'will_list', note: 'Has new places to list', next: 'Help them list new places', when: '24h' } },
    help_photos: { end: { outcome: 'needs_help', note: 'No clients calling; will send new photos', next: 'Help them list new places', when: '24h' } },
    rl_24h: { end: { outcome: 'call_back', note: 'Will renew tomorrow', next: 'Chase the renewal payment', when: '24h' } },
    rl_mon: { end: { outcome: 'call_back', note: 'Will renew next week', next: 'Chase the renewal payment', when: 'mon' } },
    nr_price: { end: { outcome: 'not_renewing', note: 'Not renewing: too expensive', next: 'King to decide' } },
    nr_time: { end: { outcome: 'not_renewing', note: 'Not renewing: no time / stopped', next: 'King to decide' } },
    nr_think: { end: { outcome: 'call_back', note: 'Thinking about renewing', next: 'Chase the renewal payment', when: '2d' } }
  }
};

function build(tree, laterOutcome, laterNext) {
  const l = later(laterOutcome, laterNext);
  const nodes = { ...tree.nodes, later: { say: l.say, replies: l.replies }, ...l._ends };
  return Object.freeze({ start: tree.start, nodes });
}

const ROUTES = Object.freeze({
  new_agents: build(NEW_AGENTS, 'call_back', 'Call back'),
  payments: build(PAYMENTS, 'call_back', 'Chase payment: check MoMo for UGX 50,000'),
  retention: build(RETENTION, 'call_back', 'Call back')
});

// Before the script: did they pick up? "No answer" saves at once and brings the next number.
const PICKUP = Object.freeze([['They answered', 'answered'], ['No answer / voicemail', 'no_answer'], ['Phone off / unreachable', 'no_answer']]);

module.exports = { ROUTES, PICKUP };
