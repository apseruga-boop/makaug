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

// Every route is inbound-first: we ask them to say "Hi" on our WhatsApp ({wa}) and the team answers
// there. We never send WhatsApp messages or films from the calls (Arthur, 21 Nov 2026). A text by
// SMS (the Texts tab, sent from the company phone through Phone Link) is fine.

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

// Shared branches: angry / hung up, and switching to Luganda.
const angry = (back) => ({
  say: 'I am sorry to have disturbed you. I will note it so nobody calls you at a bad time. Have a good day.',
  replies: [['They hung up', 'angry_hungup'], ['Never call me again', 'dnc'], ['Calmed down, go on', back]]
});
const ANGRY_END = { end: { outcome: 'rejected', note: 'Angry / hung up', next: 'King to decide' } };

const NEW_AGENTS = {
  start: 'open',
  nodes: {
    open: {
      say: '{greeting} {name}? It is {caller} from makaug.com. {opener} I saw your property post online. Are you the agent, the owner, or the caretaker?',
      replies: [['I am an agent', 'pitch_agent'], ['I am the owner', 'pitch_owner'], ['I am the caretaker', 'caretaker'], ['Busy / call me later', 'later'], ['Wrong person / looking for a place?', 'wrong_person'], ['Speak Luganda, please', 'luganda']]
    },
    luganda: {
      lang: 'lg',
      say: '(Switch to Luganda.) Kale, twogere Luganda. Nze {caller} okuva ku makaug.com. Oli agent, oba ggwe nnannyini kifo, oba okilabirira?',
      replies: [['Agent', 'pitch_agent'], ['Owner', 'pitch_owner'], ['Caretaker', 'caretaker'], ['Busy / call me later', 'later']]
    },
    pitch_agent: {
      say: 'makaug.com shows your places to buyers and renters all over Uganda, with your name and number on every listing, and the enquiries come straight to you. Agents pay UGX 50,000 a month, no contract. How many places do you have right now?',
      replies: [['Sounds good, how do I join?', 'close_ask'], ['Price / fees too high', 'price'], ['How does it work?', 'how'], ['I already use another site (Jiji, Facebook…)', 'elsewhere'], ["I'm the owner, not an agent", 'pitch_owner'], ['Not interested', 'notint']]
    },
    pitch_owner: {
      say: 'makaug.com shows your place to buyers and renters all over Uganda, and they call you directly. For owners it is UGX 20,000 a month, no contract.',
      replies: [['OK, how do I start?', 'close_ask'], ['Price / fees too high', 'price'], ['How does it work?', 'how'], ['Has a place to list right now', 'list_now'], ['Send it on WhatsApp', 'send_wa'], ['Not interested', 'notint']]
    },
    caretaker: {
      say: 'Thank you! Who decides on renting or selling it: the owner, or an agent? Can you give me their number, or shall I tell you how it works so you can pass it on?',
      replies: [['Gives the owner / agent number', 'referral'], ['Caretaker can list it', 'pitch_owner'], ['Will pass the message on', 'caretaker_pass'], ['Not interested', 'notint']]
    },
    wrong_person: {
      say: 'Sorry about that! Who am I speaking to? I am {caller} from makaug.com, the property site.',
      replies: [['Looking for a place to rent or buy', 'seeker'], ['Wrong number', 'wrong'], ['Knows the owner / agent', 'referral'], ['Where did you get my number?', 'who'], ['Angry / hung up', 'angry']]
    },
    who: {
      say: 'It is {caller} from makaug.com, the property search site. I got your number from your own public post online. If you do not want calls I will mark it and nobody will call again.',
      replies: [['OK, go on', 'pitch_agent'], ['Do not call me again', 'dnc'], ['Not interested', 'notint'], ['Angry / hung up', 'angry']]
    },
    angry: angry('pitch_agent'),
    how: {
      say: 'Say "Hi" on WhatsApp to {wa} and send your places there (photos, price, area), or list them yourself on makaug.com. We put them up with your name and number, and buyers and renters call you directly. You pay monthly by MoMo and can stop any month.',
      replies: [['Sounds good, how do I join?', 'close_ask'], ['Price / fees too high', 'price'], ['Has a place to list right now', 'list_now'], ['Send it on WhatsApp', 'send_wa'], ['Wants to meet first', 'meet'], ['Let me think about it', 'think']]
    },
    // "Send it on WhatsApp" (Arthur, 22 Nov 2026): calls never send on WhatsApp; we text the link.
    send_wa: {
      say: 'We do not send from calls on WhatsApp, so I will text you the makaug.com link by SMS right now. It has everything: how it works and the price. Is this number OK for the text?',
      replies: [['OK, text me ✓', 'send_wa_ok'], ['Let me think about it', 'think'], ['Not interested', 'notint']]
    },
    send_wa_ok: { end: { outcome: 'interested', note: 'Asked for WhatsApp; agreed to get the link by text', next: 'Text them the makaug.com link (Texts tab), then call back', when: '24h' } },
    price: {
      say: 'One tenant or one sale pays it back many times. It is less than UGX 1,700 a day for a month of buyers and renters seeing your places, and you can stop any month. There is no free trial and no long contract.',
      replies: [['OK, let us do it', 'close_ask'], ['How does it work?', 'how'], ['Let me think about it', 'think'], ['Still too much', 'no_price']]
    },
    elsewhere: {
      say: 'Keep them! makaug brings listings together so people search in one place, and your places carry your name and number. Many agents list on both.',
      replies: [['OK, how do I join?', 'close_ask'], ['Price / fees too high', 'price'], ['Send it on WhatsApp', 'send_wa'], ['Let me think about it', 'think'], ['Not interested', 'no_other']]
    },
    meet: {
      say: 'We do everything by phone and WhatsApp, so you can start today. If you still want to meet, I will note it and the team will call you to agree a time.',
      replies: [['Fine, start by phone', 'close_ask'], ['Still wants to meet', 'meet_end'], ['Let me think about it', 'think']]
    },
    list_now: {
      say: 'Let us do it now. Say "Hi" on WhatsApp to {wa} and send the photos, price and area of the first place, or I can text you the link to list it yourself on makaug.com.',
      replies: [['Saying Hi now ✓', 'listnow_hello'], ['Text me the link', 'listnow_link'], ['Will do it later', 'think']]
    },
    think: {
      say: 'No problem. Have a look at makaug.com, and say "Hi" on WhatsApp to {wa} with any questions: the team answers there. When shall I call you back?',
      replies: [['Said Hi ✓, call in 2 days', 'think_hello'], ['Call me in 2 days', 'think_nohello'], ['Call me next week', 'think_mon']]
    },
    close_ask: {
      say: 'Great! To go live: UGX 50,000 a month (owners UGX 20,000), no free trial, by MoMo merchant code {momo}. Please say "Hi" on WhatsApp to {wa} now and send your first places (photos, price, area). We confirm your payment there.',
      replies: [['Paying today ✓', 'signed_today'], ['Will pay tomorrow', 'signed_tomorrow'], ['Needs help listing', 'list_now'], ['Changed their mind', 'notint']]
    },
    notint: {
      say: 'Thank you for your time. Can I ask why, so we can do better?',
      replies: [['Price', 'no_price'], ['Uses another site', 'no_other'], ['Not an agent / no property', 'no_agent'], ['Looking for a place, not listing', 'seeker'], ['Just not interested', 'no_plain'], ['Do not call again', 'dnc']]
    },
    // Looking for a property (Arthur, 22 Nov 2026): the caller fills in area, budget, type and
    // bedrooms; that logs a home-seeker lead and opens a friendly text with a makaug.com search
    // link for the area. The call then ends as "Seeker, text sent".
    seeker: {
      form: 'seeker',
      say: 'No problem, we can help! makaug.com has places to rent and buy all over Uganda. Which area, what budget, to rent or to buy, and how many bedrooms? I will text you a search link for that area now.',
      replies: [['Search link texted ✓', 'seeker_link'], ['Will search myself', 'seeker_self'], ['Has a place to list too', 'list_now']]
    },
    later: null,
    wrong: WRONG,
    dnc: DNC,
    angry_hungup: ANGRY_END,
    referral: { end: { outcome: 'wrong_number', note: 'Not the decision-maker; gave the owner / agent number', next: 'Add their number with ➕ Add number and call them' } },
    caretaker_pass: { end: { outcome: 'call_back', note: 'Caretaker will pass the message to the owner', next: 'Call back to reach the owner', when: '2d' } },
    meet_end: { end: { outcome: 'interested', note: 'Wants to meet before joining', next: 'King to arrange a meeting', when: '2d' } },
    listnow_hello: { end: { outcome: 'interested', note: 'Has a place to list now; said Hi on WhatsApp', next: 'Check WhatsApp for their Hi and first places, then call back', when: '24h', hello: true } },
    listnow_link: { end: { outcome: 'interested', note: 'Has a place to list now; wants the link by text', next: 'Text them the makaug.com link (Texts tab), then call back', when: '24h' } },
    think_hello: { end: { outcome: 'interested', note: 'Wants to think about it; said Hi on WhatsApp', next: 'Call back to sign them up', when: '2d', hello: true } },
    think_nohello: { end: { outcome: 'interested', note: 'Wants to think about it', next: 'Call back; ask them to say Hi on WhatsApp', when: '2d' } },
    think_mon: { end: { outcome: 'interested', note: 'Wants to think about it, call next week', next: 'Call back; ask them to say Hi on WhatsApp', when: 'mon' } },
    signed_today: { end: { outcome: 'signed_up', note: 'Signed up, paying by MoMo today', next: 'Confirm their first payment by MoMo', checks: true, hello: true } },
    signed_tomorrow: { end: { outcome: 'signed_up', note: 'Signed up, will pay tomorrow', next: 'Confirm their first payment by MoMo', when: '24h', checks: true, hello: true } },
    seeker_link: { end: { outcome: 'seeker_texted', note: 'Looking for a place: home-seeker lead logged, search link texted' } },
    seeker_self: { end: { outcome: 'rejected', note: 'Seeker looking for a place, not a lister' } },
    no_price: { end: { outcome: 'rejected', note: 'Not interested: price too high' } },
    no_other: { end: { outcome: 'rejected', note: 'Not interested: uses another site' } },
    no_agent: { end: { outcome: 'rejected', note: 'Not an agent / no property' } },
    no_plain: { end: { outcome: 'rejected', note: 'Not interested' } }
  }
};

const PAYMENTS = {
  start: 'open',
  nodes: {
    open: {
      say: '{greeting} {name}, it is {caller} from makaug.com. {opener} You signed up as an agent, and your places go live once the UGX 50,000 is paid. Can you pay today by MoMo merchant code {momo}?',
      replies: [['Yes, paying now', 'pay_now'], ['I paid already', 'paid_already'], ['Tomorrow / on a date', 'promise'], ['I have no money now', 'nomoney'], ['Busy / call me later', 'later'], ['Something else…', 'other']]
    },
    other: {
      say: 'Of course. What is it?',
      replies: [['I want to stop', 'stop'], ['Wrong number', 'wrong'], ['Speak Luganda, please', 'luganda'], ['Angry / hung up', 'angry']]
    },
    luganda: {
      lang: 'lg',
      say: '(Switch to Luganda.) Kale, twogere Luganda. Osobola okusasula leero ku MoMo merchant code {momo}?',
      replies: [['Yes, paying now', 'pay_now'], ['Paid already', 'paid_already'], ['Tomorrow / on a date', 'promise']]
    },
    angry: angry('open'),
    pay_now: {
      say: 'Thank you! Dial *165*3#, choose Merchant code {momo}, amount 50,000. When it goes through, send the MoMo reference on WhatsApp to {wa}. Your places stay live once it is confirmed.',
      replies: [['Paid on the call ✓', 'paid_now'], ['Will pay right after the call', 'promise_today'], ['MoMo is not working', 'promise']]
    },
    paid_already: {
      say: 'Thank you! Please send the MoMo reference on WhatsApp to {wa} so we can match it. The amount is UGX 50,000 to merchant code {momo}, and your places stay live once it is confirmed.',
      replies: [['Will send the reference ✓', 'paid_ref'], ['Cannot find the reference', 'paid_noref'], ['Paid to another number', 'paid_noref']]
    },
    promise: {
      say: 'No problem. Which day can you pay? I will note it and call you that day.',
      replies: [['Tomorrow', 'pr_24h'], ['In 2–3 days', 'pr_3d'], ['Next week', 'pr_mon']]
    },
    nomoney: {
      say: 'I understand. Which day can you pay? I will note it and call you that day, so your places are ready to go live.',
      replies: [['Gives a day', 'promise'], ['Can pay part now', 'pay_now'], ['Wants to stop', 'stop']]
    },
    stop: {
      say: 'Sorry to hear that. Can I ask why, so we can fix it?',
      replies: [['No clients calling', 'stop_clients'], ['Too expensive', 'stop_price'], ['Will think about it', 'stop_think']]
    },
    later: null,
    wrong: WRONG,
    dnc: DNC,
    angry_hungup: ANGRY_END,
    paid_now: { end: { outcome: 'paid', note: 'Paid by MoMo on the call, sending the reference on WhatsApp', next: 'Check MoMo for UGX 50,000 and confirm', checks: true, hello: true } },
    paid_ref: { end: { outcome: 'paid', note: 'Says already paid, sending the MoMo reference', next: 'Check MoMo for UGX 50,000 and confirm', checks: true, hello: true } },
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
      replies: [['Going well', 'good'], ['No clients calling', 'noclients'], ['I will renew later', 'renew_later'], ['Already renewed', 'renewed_ref'], ['Busy / call me later', 'later'], ['Something else…', 'other']]
    },
    other: {
      say: 'Of course. What is it?',
      replies: [['Not renewing', 'stop'], ['Wrong number', 'wrong'], ['Speak Luganda, please', 'luganda'], ['Angry / hung up', 'angry']]
    },
    luganda: {
      lang: 'lg',
      say: '(Switch to Luganda.) Kale, twogere Luganda. makaug ekukolera etya? Abantu bakukubira ku bifo byo?',
      replies: [['Going well', 'good'], ['No clients calling', 'noclients'], ['Will renew later', 'renew_later']]
    },
    angry: angry('open'),
    good: {
      say: 'Great to hear! Your renewal is UGX 50,000 by MoMo merchant code {momo}; send the reference on WhatsApp to {wa}. Any new places or photos I can put up for you?',
      replies: [['Renewing now ✓', 'renew_now'], ['Has new places to list', 'new_places'], ['Will renew later', 'renew_later']]
    },
    noclients: {
      say: 'Let me check your places with you. Good photos and a clear price get more calls. Send new photos on WhatsApp to {wa} (say "Hi" first) and the team will update them.',
      replies: [['Will send new photos', 'help_photos'], ['Has new places to list', 'new_places'], ['Wants to stop', 'stop']]
    },
    renew_later: {
      say: 'No problem. Which day? I will note it so your places do not go down.',
      replies: [['Tomorrow', 'rl_24h'], ['In 2 days', 'rl_2d'], ['Next week', 'rl_mon']]
    },
    renewed_ref: {
      say: 'Thank you! Please send the MoMo reference on WhatsApp to {wa} (UGX 50,000 to merchant code {momo}) so we can confirm it. Any new places or photos to put up?',
      replies: [['Will send the reference ✓', 'renew_now'], ['Cannot find the reference', 'rl_24h'], ['Has new places to list', 'new_places']]
    },
    stop: {
      say: 'Sorry to hear that. What would make it worth it for you? I will pass it on to the team.',
      replies: [['Too expensive', 'nr_price'], ['No time / stopped the business', 'nr_time'], ['Will think about it', 'nr_think']]
    },
    later: null,
    wrong: WRONG,
    dnc: DNC,
    angry_hungup: ANGRY_END,
    renew_now: { end: { outcome: 'renewed', note: 'Renewed by MoMo, sending the reference', next: 'Check MoMo and confirm the renewal', checks: true, hello: true } },
    new_places: { end: { outcome: 'will_list', note: 'Has new places to list', next: 'Help them list new places', when: '24h' } },
    help_photos: { end: { outcome: 'needs_help', note: 'No clients calling; will send new photos', next: 'Help them list new places', when: '24h' } },
    rl_24h: { end: { outcome: 'call_back', note: 'Will renew tomorrow', next: 'Chase the renewal payment', when: '24h' } },
    rl_2d: { end: { outcome: 'call_back', note: 'Will renew in 2 days', next: 'Chase the renewal payment', when: '2d' } },
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
const PICKUP = Object.freeze([['They answered', 'answered'], ['No answer', 'no_answer'], ['Voicemail', 'no_answer'], ['Phone off / unreachable', 'no_answer'], ['Busy tone / declined', 'no_answer']]);

module.exports = { ROUTES, PICKUP };
