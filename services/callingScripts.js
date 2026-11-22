'use strict';

/**
 * What the caller says, by script variant, in English and Luganda.
 * The Luganda is a first draft: every Luganda block carries `check: true`
 * and the screen labels it "Ronald to check" until he has read it.
 *
 * {greeting} is filled on the screen from the time in Kampala
 * (morning before 12:00, afternoon until 17:00, evening after).
 * {name} is the person's first name when we have it, {caller} the caller.
 */

const MOMO_CODE = '27248497';
const SITE = 'https://makaug.com';

const GREETINGS = Object.freeze({
  en: { morning: 'Good morning', afternoon: 'Good afternoon', evening: 'Good evening' },
  lg: { morning: 'Wasuze otya nno', afternoon: 'Osiibye otya nno', evening: 'Osiibye otya nno' }
});

function partOfDay(date = new Date(), timeZone = 'Africa/Kampala') {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone }).format(date)) % 24;
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

function greetingFor(lang = 'en', date = new Date()) {
  const set = GREETINGS[lang] || GREETINGS.en;
  return set[partOfDay(date)];
}

const PRICE_EN = 'Agents pay UGX 50,000 a month, owners UGX 20,000. There is no free trial. You pay by MoMo to merchant code 27248497.';
const PRICE_LG = 'Ba agenti basasula UGX 50,000 buli mwezi, bannannyini mayumba UGX 20,000. Tewali kugezesa kwa bwereere. Osasula ku MoMo merchant code 27248497.';

const VARIANTS = Object.freeze({
  lead_follow_up: {
    label: 'New enquiry / lead',
    en: [
      ['Greeting', '{greeting} {name}, my name is {caller} from makaug.com. You contacted us about a place. Is now a good time?'],
      ['Questions', 'What are you looking for? Which area, and what budget? When do you need it?'],
      ['Help', 'Please say "Hi" on WhatsApp to 0780 863 394 and our team will answer you there with places that match. I can also text you a search link now.'],
      ['Close', 'Thank you. Once you say Hi on WhatsApp, our team answers you there.']
    ],
    lg: [
      ['Okulamusa', '{greeting} {name}, nze {caller} okuva ku makaug.com. Watukubidde oba watuwandiikidde. Kati kiseera kirungi?'],
      ['Ebibuuzo', 'Onoonya ki? Kitundu ki, era ssente meka? Okyetaaga ddi?'],
      ['Okuyamba', 'Wandiika "Hi" ku WhatsApp ku 0780 863 394, ttiimu yaffe ejja kukuddamu eyo.'],
      ['Okumaliriza', 'Weebale. Nja kukukomawo.']
    ]
  },
  cold_call: {
    label: 'First-time cold call',
    en: [
      ['Greeting', '{greeting} {name}, my name is {caller} from makaug.com. Do you have two minutes?'],
      ['Why I am calling', 'makaug.com is where people in Uganda search for houses, land and rentals. We help agents get those enquiries straight to their phone.'],
      ['Questions', 'Are you an agent or do you own the places? Which areas do you cover? How many places do you have right now?'],
      ['Offer', PRICE_EN],
      ['Close', 'Shall I sign you up now? Please say "Hi" on WhatsApp to 0780 863 394, and I can text you the link right now.']
    ],
    lg: [
      ['Okulamusa', '{greeting} {name}, nze {caller} okuva ku makaug.com. Olina eddakiika bbiri?'],
      ['Lwaki nkubira', 'makaug.com abantu mu Uganda we banoonyeza amayumba, ettaka n\'ebisulo. Tuyamba ba agenti okufuna abaagala okugula oba okupangisa.'],
      ['Ebibuuzo', 'Oli agenti oba ggwe nnannyini? Okola mu bitundu ki? Olina ebifo bimeka kaakano?'],
      ['Ekiweebwayo', PRICE_LG],
      ['Okumaliriza', 'Nkuwandiise kaakano? Wandiika "Hi" ku WhatsApp ku 0780 863 394, era nsobola okukuweereza link mu SMS kaakano.']
    ]
  },
  found_online: {
    label: 'Found-online lister',
    en: [
      ['Greeting', '{greeting} {name}, my name is {caller} from makaug.com.'],
      ['Why I am calling', 'I saw your place posted online. People searching makaug.com can already see it, and I want to make sure the enquiries come to you, not someone else.'],
      ['Questions', 'Is it still available? Are you the agent or the owner? Do you have more places we can put up for you?'],
      ['Offer', PRICE_EN + ' With an agent account your places carry your name and your number.'],
      ['Close', 'Shall I set up your account now? I can text you the link right now, and please say "Hi" on WhatsApp to 0780 863 394.']
    ],
    lg: [
      ['Okulamusa', '{greeting} {name}, nze {caller} okuva ku makaug.com.'],
      ['Lwaki nkubira', 'Nalabye ekifo kyo ku mutimbagano. Abanoonya ku makaug.com bakiraba, era njagala abakyagala bakutuukeko ggwe.'],
      ['Ebibuuzo', 'Kikyaliwo? Oli agenti oba nnannyini? Olina ebifo ebirala bye tuyinza okuteekako?'],
      ['Ekiweebwayo', PRICE_LG],
      ['Okumaliriza', 'Nkuggulire akawunti kaakano? Nsobola okukuweereza link mu SMS, era wandiika "Hi" ku WhatsApp ku 0780 863 394.']
    ]
  },
  existing_contact: {
    label: 'Existing contact',
    en: [
      ['Greeting', '{greeting} {name}, it is {caller} from makaug.com again. We spoke before.'],
      ['Why I am calling', 'Last time: {history}. I wanted to follow up and see if you are ready to start.'],
      ['Questions', 'Did you have a look at makaug.com? Any questions about how it works or how clients reach you?'],
      ['Offer', PRICE_EN],
      ['Close', 'Shall we sign you up today? I can do it with you on this call.']
    ],
    lg: [
      ['Okulamusa', '{greeting} {name}, nze {caller} okuva ku makaug.com nate. Twayogerako.'],
      ['Lwaki nkubira', 'Omulundi oguwedde: {history}. Njagala okumanya oba weetegese okutandika.'],
      ['Ebibuuzo', 'Walabye ku makaug.com? Olina ekibuuzo kyonna?'],
      ['Ekiweebwayo', PRICE_LG],
      ['Okumaliriza', 'Tukuwandiise leero? Nsobola okukikola naawe ku ssimu eno.']
    ]
  },
  payment_follow_up: {
    label: 'Payment follow-up',
    en: [
      ['Greeting', '{greeting} {name}, it is {caller} from makaug.com.'],
      ['Why I am calling', 'Your agent account is set up. To keep your places live and the enquiries coming, the monthly fee needs to be paid.'],
      ['How to pay', 'Pay UGX 50,000 by MoMo to merchant code 27248497, then send me the reference so we can confirm it.'],
      ['Questions', 'Can you pay today? If not, which day? Is there anything stopping you?'],
      ['Close', 'Thank you. I will check for the payment and confirm on WhatsApp.']
    ],
    lg: [
      ['Okulamusa', '{greeting} {name}, nze {caller} okuva ku makaug.com.'],
      ['Lwaki nkubira', 'Akawunti yo eya agenti etegekeddwa. Okusobola ebifo byo okusigala nga birabika, ssente za buli mwezi zeetaaga okusasulwa.'],
      ['Engeri y\'okusasula', 'Sasula UGX 50,000 ku MoMo merchant code 27248497, oluvannyuma ompeereze reference.'],
      ['Ebibuuzo', 'Osobola okusasula leero? Bwe kitaba, lunaku ki?'],
      ['Okumaliriza', 'Webale. Nja kukebera ssente era nkukakase ku WhatsApp.']
    ]
  },
  retention: {
    label: 'Check-in and renewal',
    en: [
      ['Greeting', '{greeting} {name}, it is {caller} from makaug.com. Just checking in.'],
      ['Check in', 'How is makaug working for you? Are clients reaching you?'],
      ['Help them list', 'Do you have new places? Send me the photos and details on WhatsApp and I will help you put them up today.'],
      ['Renewal', 'Your renewal is UGX 50,000 by MoMo to merchant code 27248497. Paying on time keeps your places at the top.'],
      ['Close', 'Is there anything we can do better for you?']
    ],
    lg: [
      ['Okulamusa', '{greeting} {name}, nze {caller} okuva ku makaug.com. Nkukebera bukebezi.'],
      ['Okubuuza', 'makaug ekukolera etya? Abaguzi bakutuukako?'],
      ['Okuyamba okuteeka', 'Olina ebifo ebipya? Mpeereza ebifaananyi ku WhatsApp nkuyambe okubiteeka leero.'],
      ['Okuzza obuggya', 'Okuzza obuggya UGX 50,000 ku MoMo merchant code 27248497.'],
      ['Okumaliriza', 'Waliwo kye tuyinza okukola obulungi okusinga?']
    ]
  }
});

const OBJECTIONS = Object.freeze({
  new_agents: [
    ['It is too expensive', 'One tenant or one sale pays it back many times. It is less than UGX 1,700 a day for a month of buyers and renters seeing your places.'],
    ['Can I try it free first?', 'There is no free trial. You can stop any month; there is no long contract.'],
    ['Where did you get my number?', 'From your own public post online. If you do not want calls, I will mark you and nobody will call again.'],
    ['I already use another site (Jiji, Facebook…)', 'Keep them. makaug brings listings from everywhere so people search in one place, and your places carry your name.'],
    ["I'm the owner, not an agent", 'No problem: owners list too, UGX 20,000 a month per place, and buyers and renters call you directly.'],
    ['Send it on WhatsApp', "We don't send on WhatsApp from calls; I'll text you the makaug.com link by SMS now."],
    ['Who books the viewings?', 'Clients contact you directly. makaug is not responsible for bookings or payments between you and them.'],
    ['Call me later', 'Of course. What day and time is best? (pick Call back)']
  ],
  payments: [
    ['I have no money now', 'I understand. Which day can you pay? I will note it and call you that day.'],
    ['I paid already', 'Thank you. Please send me the MoMo reference so we can match it.'],
    ['What do I get for paying?', 'Your places stay live with your name and number, and the enquiries come straight to you.'],
    ['I want to stop', 'Sorry to hear that. Can I ask why, so we can fix it?']
  ],
  retention: [
    ['No clients are calling', 'Let me check your places with you. Good photos and a clear price get more calls. Send me new photos and I will update them.'],
    ['I have no new places', 'No problem. Any place you hear about, send it to me and we will put it up under your name.'],
    ['It is too expensive', 'Tell me what would make it worth it for you. I will pass it on to the team.'],
    ['I will renew later', 'Which day? I will note it so your places do not go down.']
  ]
});

// After-call texts. Sent by hand from the caller's phone (SMS or WhatsApp), free.
// Every template must carry: the caller's name, makaug.com, one link, the price
// and how to pay, and no promise of free time.
const TEMPLATE_RULES = 'Must have: your name, makaug.com, one link, the price, how to pay (MoMo merchant code 27248497). Never promise free time.';

const TEMPLATES = Object.freeze({
  interested: 'Hi {name}, it is {caller} from makaug.com, thank you for your time. Here is how it works: ' + SITE + '/agents . Agents pay UGX 50,000 a month (no free trial) by MoMo merchant code 27248497. Reply here when you are ready and I will set you up.',
  signed_up: 'Welcome to makaug.com, {name}! It is {caller}. To go live, pay UGX 50,000 by MoMo merchant code 27248497 and send me the reference. Your page: ' + SITE + '/agents',
  call_back: 'Hi {name}, it is {caller} from makaug.com. As agreed I will call you back on {callback}. makaug.com: ' + SITE + ' . Agents UGX 50,000 a month, MoMo merchant code 27248497.',
  promised: 'Hi {name}, it is {caller} from makaug.com. Thank you. As agreed, please pay UGX 50,000 by MoMo merchant code 27248497 by {callback} and send me the reference. ' + SITE,
  paid: 'Thank you {name}! It is {caller} from makaug.com. Please send the MoMo reference for your UGX 50,000 payment to merchant code 27248497 so we can confirm it. ' + SITE,
  renewed: 'Thank you {name} for renewing with makaug.com. It is {caller}. Send me the MoMo reference (merchant code 27248497, UGX 50,000). New places? Send photos here. ' + SITE,
  will_list: 'Hi {name}, it is {caller} from makaug.com. Send me the photos, price and area of your new places here and I will help you put them up. Renewal: UGX 50,000, MoMo merchant code 27248497. ' + SITE,
  no_answer: 'Hi {name}, it is {caller} from makaug.com. I tried to call you about getting buyers and renters for your places. Agents UGX 50,000 a month, MoMo merchant code 27248497. ' + SITE
});

const SALES_KIT = Object.freeze([
  { key: 'join_agent', title: 'Join as an agent (film)', kind: 'film', lang: 'English', path: '/assets/marketing/makaug-join-as-agent-v4.mp4' },
  { key: 'agent_intro_en', title: 'Agent intro (film)', kind: 'film', lang: 'English', path: '/assets/marketing/makaug-agent-intro-v5.mp4' },
  { key: 'agent_intro_lg', title: 'Agent intro (film)', kind: 'film', lang: 'Luganda', path: '/assets/marketing/makaug-agent-intro-v5-lg.mp4' },
  { key: 'agent_intro_sw', title: 'Agent intro (film)', kind: 'film', lang: 'Swahili', path: '/assets/marketing/makaug-agent-intro-v5-sw.mp4' },
  { key: 'how_to_post_en', title: 'How to post a listing (film)', kind: 'film', lang: 'English', path: '/assets/marketing/makaug-agent-how-to-post-v3.mp4' },
  { key: 'how_to_post_lg', title: 'How to post a listing (film)', kind: 'film', lang: 'Luganda', path: '/assets/marketing/makaug-agent-how-to-post-v3-lg.mp4' },
  { key: 'owner_how_to_list', title: 'Owners: how to list (film)', kind: 'film', lang: 'English', path: '/assets/marketing/makaug-owner-how-to-list-v5.mp4' },
  { key: 'welcome_card', title: 'Agent welcome card', kind: 'image', lang: 'English', path: '/assets/marketing/makaug-agent-welcome-card.png' },
  { key: 'prices', title: 'Prices and how to pay', kind: 'text', lang: 'English', text: 'makaug.com prices: agents UGX 50,000 a month, owners UGX 20,000. No free trial. Pay by MoMo merchant code 27248497 and send the reference. ' + SITE }
]);

// Our WhatsApp line (the number on the site header). WhatsApp limits us from
// messaging first, so the caller asks people to send "Hello" here before anything.
const WHATSAPP_NUMBER = '+256780863394';
const WHATSAPP_DISPLAY = '0780 863 394';

// Ready texts for the Texts tab. Sent by SMS from the company phone (an sms: link opens the
// texting app through Phone Link with the number and text filled in). Inbound-first: we ask
// them to say "Hi" on our WhatsApp; we never send WhatsApp messages or films from calls.
// First-contact texts (Arthur, 22 Nov 2026): warm, short (1–2 SMS), makaug.com in lowercase,
// English and Luganda. Sent by the caller right after the call. {link} and {area} are filled in
// for the seeker text by the seeker form; {callback} is the agreed call-back time.
const FIRST_TEXTS = Object.freeze([
  { key: 'first_agent', label: 'First text: interested agent', kind: 'agent',
    text: "Hi {name}, it's {caller} from makaug.com, I just called you. Thanks for your time! Reply Hi to this number (or WhatsApp Hi to " + WHATSAPP_DISPLAY + ") and we'll set up your agent account so you can load your properties. makaug.com/agents",
    text_lg: "Gyebale {name}, nze {caller} ow'e makaug.com, nkukubidde kati. Webale okumpa obudde! Weereza Hi ku nnamba eno (oba Hi ku WhatsApp " + WHATSAPP_DISPLAY + ") tukuteekere akawunti ya agent otandike okuteeka amayumba go. makaug.com/agents" },
  { key: 'first_owner', label: 'First text: owner', kind: 'owner',
    text: "Hi {name}, it's {caller} from makaug.com, I just called you. Thanks for your time! Reply Hi to this number (or WhatsApp Hi to " + WHATSAPP_DISPLAY + ") and we'll help you put your place on makaug.com.",
    text_lg: "Gyebale {name}, nze {caller} ow'e makaug.com, nkukubidde kati. Webale nnyo okumpa obudde! Weereza Hi ku nnamba eno (oba Hi ku WhatsApp " + WHATSAPP_DISPLAY + ") tukuyambe okuteeka ekifo kyo ku makaug.com." },
  { key: 'first_seeker', label: 'First text: looking for a place', kind: 'seeker',
    text: "Hi {name}, it's {caller} from makaug.com, I just called you. Thanks for your time! Here are places in {area} for you: {link} . Reply Hi to this number and we'll help you find one.",
    text_lg: "Gyebale {name}, nze {caller} ow'e makaug.com, nkukubidde kati. Webale nnyo! Laba ebifo mu {area} ebiyinza okukugasa: {link} . Weereza Hi ku nnamba eno tukuyambe okufuna ekifo." },
  { key: 'first_no_answer', label: 'First text: no answer', kind: 'no_answer',
    text: "Hi {name}, it's {caller} from makaug.com. I tried to call you just now, sorry I missed you! Reply Hi to this number and I'll call you back at a good time. makaug.com",
    text_lg: "Gyebale {name}, nze {caller} ow'e makaug.com. Ngezezzaako okukukubira kati naye sikufunye, nsonyiwa! Weereza Hi ku nnamba eno nkukubire mu kiseera ekikusaanidde. makaug.com" },
  { key: 'first_call_back', label: 'First text: call back', kind: 'call_back',
    text: "Hi {name}, it's {caller} from makaug.com. Thanks for picking up! As agreed, I'll call you back {callback}. Reply Hi to this number if another time suits you better. makaug.com",
    text_lg: "Gyebale {name}, nze {caller} ow'e makaug.com. Webale okukwata essimu! Nga bwe tukkiriziganyizza, nja kukukubira {callback}. Weereza Hi ku nnamba eno singa ekiseera ekirala kye kikusaanira. makaug.com" }
]);
// Which first-contact text the after-call box offers, by outcome.
const FIRST_TEXT_FOR = Object.freeze({ interested: 'first_agent', signed_up: 'first_agent', no_answer: 'first_no_answer', call_back: 'first_call_back', seeker_texted: 'first_seeker' });

const SMS_TEXTS = Object.freeze([
  ...FIRST_TEXTS,
  { key: 'say_hi', label: 'Say Hi on WhatsApp', text: 'Hi {name}, it is {caller} from makaug.com. Please say "Hi" on WhatsApp to ' + WHATSAPP_DISPLAY + ' and our team will answer you there.' },
  { key: 'site_link', label: 'The makaug.com link', text: 'Hi {name}, it is {caller} from makaug.com, where buyers and renters all over Uganda find places. See it here: ' + SITE + ' . Agents UGX 50,000 a month, owners UGX 20,000, by MoMo merchant code ' + MOMO_CODE + '. Questions? Say "Hi" on WhatsApp to ' + WHATSAPP_DISPLAY + '.' },
  { key: 'seeker_search', label: 'Seeker search link', text: 'Hi {name}, it is {caller} from makaug.com. Find places to rent here: ' + SITE + '/to-rent and to buy here: ' + SITE + '/for-sale . Say "Hi" on WhatsApp to ' + WHATSAPP_DISPLAY + ' and we will help you find one.' }
]);
const SMS_TEXT_KEYS = new Set(SMS_TEXTS.map((t) => t.key));

// Before a caller can mark a close, every one of these must be ticked.
// Mandatory in every mode: the caller asks them to WhatsApp "Hello" to makaug.
// That registers them as a client and makes their number known (WhatsApp only
// lets us message people who wrote to us first).
const HELLO_EN = 'One important thing: to be registered as a client and have your number known to us, please send "Hello" on WhatsApp to makaug on ' + WHATSAPP_DISPLAY + '. Can you do it now while we talk?';
const HELLO_LG = 'Ekintu ekikulu: okuwandiisibwa nga kasitoma n\'ennamba yo okumanyika gye tuli, wandiika "Hello" ku WhatsApp eri makaug ku ' + WHATSAPP_DISPLAY + '. Osobola okukikola kati nga twogera?';
const HELLO_CHECK = 'Asked them to WhatsApp "Hello" to makaug on ' + WHATSAPP_DISPLAY + ' (registers them as a client)';
for (const v of Object.values(VARIANTS)) {
  for (const [lang, line] of [['en', HELLO_EN], ['lg', HELLO_LG]]) {
    const steps = v[lang];
    if (!Array.isArray(steps) || steps.some((st) => st[2] === 'hello')) continue;
    steps.splice(Math.max(0, steps.length - 1), 0, [lang === 'en' ? 'Say "Hello" on WhatsApp (must)' : 'Hello ku WhatsApp (kyetaagisa)', line, 'hello']);
  }
}

const CLOSE_CHECKS = Object.freeze({
  new_agents: [
    'Told the price: UGX 50,000 a month (owners UGX 20,000), no free trial',
    'Gave the MoMo merchant code 27248497',
    HELLO_CHECK,
    'Agreed when they send their first places (photos, price, area)',
    'Told them we confirm their payment and account on WhatsApp'
  ],
  payments: [
    HELLO_CHECK,
    'Confirmed the amount: UGX 50,000',
    'Gave the MoMo merchant code 27248497',
    'Asked them to send the MoMo reference on WhatsApp to ' + WHATSAPP_DISPLAY,
    'Told them their places stay live once it is confirmed'
  ],
  retention: [
    HELLO_CHECK,
    'Confirmed the renewal: UGX 50,000 by MoMo merchant code 27248497',
    'Asked them to send the MoMo reference on WhatsApp to ' + WHATSAPP_DISPLAY,
    'Asked for new places or photos to put up',
    'Told them when their paid time runs to'
  ]
});

// The coach: the steps on screen for every call. en and lg (lg: Ronald to check).
const COACH = Object.freeze({
  en: {
    next: 'Next call: {name}', dial: 'Dial the number', answered: 'Did they answer?', yes: 'Yes, they answered', no: 'No answer',
    script: 'Follow the script: step {n} of {total}', next_step: 'Next step', hi: 'Did you ask them to WhatsApp "Hello" to makaug on {wa}?',
    hi_why: 'A must on every call: it registers them as a client and makes their number known, so our team can answer them on WhatsApp.', hi_done: 'Asked them to say Hello', hi_no: 'They refused',
    end: 'End call', confirm: 'Confirm what happened', save: 'Save and call next', must: 'You must finish this wrap-up before the next call.',
    close_title: 'Key things to remember to close', offline: 'Offline: saving locally', synced: 'Back online: saved', calls: 'Calls', closes: 'Paid', left: 'Left',
    brk: 'Break', exit: 'Exit', add: '+ Add number', report: 'My report', note: 'Note', what: 'What happened?', skip: 'Skip this number', call_next: 'Call next'
  },
  lg: {
    next: 'Essimu eddako: {name}', dial: 'Kuba ennamba', answered: 'Bakwatidde?', yes: 'Yee, bakwatidde', no: 'Tebakwatidde',
    script: 'Goberera ekiwandiiko: omutendera {n} ku {total}', next_step: 'Omutendera oguddako', hi: 'Obasabye okuwandiika "Hello" ku WhatsApp eri makaug ku {wa}?',
    hi_why: 'Bwe batuwandiikira "Hi" ku WhatsApp, ttiimu yaffe esobola okubaddamu.', hi_done: 'Mbasabye okugamba Hello', hi_no: 'Bagaanye',
    end: 'Malako essimu', confirm: 'Kakasa ekibaddewo', save: 'Tereka oyite essimu eddako', must: 'Olina okumaliriza kino nga tonnaba kukuba ssimu ndala.',
    close_title: 'By\'olina okujjukira okuggalawo', offline: 'Tewali yintaneeti: tuterekera wano', synced: 'Yintaneeti ezze: biterekeddwa', calls: 'Essimu', closes: 'Abakkirizza', left: 'Basigadde',
    brk: 'Wummula', exit: 'Fuluma', add: '+ Yongerako ennamba', report: 'Lipoota yange', note: 'Ebiwandiiko', what: 'Kiki ekibaddewo?', skip: 'Buuka ennamba eno', call_next: 'Kuba essimu eddako'
  }
});

// Suggested replies for the read-only WhatsApp feed: simple keyword rules, no
// paid AI. The caller copies one and sends it himself from the company phone.
const REPLY_RULES = Object.freeze([
  { match: /\b(price|cost|how much|fee|sente|meka)\b/i, reply: 'Hi, it is {caller} from makaug.com. Agents pay UGX 50,000 a month, owners UGX 20,000. No free trial. Pay by MoMo merchant code 27248497 and send me the reference. ' + SITE + '/agents' },
  { match: /\b(pay|paid|momo|mobile money|reference|sasudde|nsasudde)\b/i, reply: 'Thank you! Please send the MoMo reference for UGX 50,000 to merchant code 27248497 and I will confirm your account today. – {caller}, makaug.com' },
  { match: /\b(list|post|upload|photos?|house|land|rent|plot)\b/i, reply: 'Great, send me the photos, the price and the area of each place here and I will put them up for you. – {caller}, makaug.com ' + SITE },
  { match: /\b(agent|join|register|sign ?up|account)\b/i, reply: 'Welcome! To join makaug.com as an agent it is UGX 50,000 a month by MoMo merchant code 27248497. Send me your name and areas and I will set you up. – {caller}' },
  { match: /\b(call|phone|ring|kuba)\b/i, reply: 'Hi, it is {caller} from makaug.com. I will call you shortly from this number. What time suits you?' },
  { match: /^\s*(hi|hello|hey|hallo|gyebale|oli otya|ki kati)\b/i, reply: 'Hi! Thank you for messaging makaug.com. It is {caller}. Here is our link: ' + SITE + '/agents . Agents pay UGX 50,000 a month (MoMo merchant code 27248497).' }
]);
const DEFAULT_REPLY = 'Hi, it is {caller} from makaug.com, thank you for your message. I will get back to you shortly. ' + SITE;

function suggestReplies(text = '') {
  const out = REPLY_RULES.filter((r) => r.match.test(String(text || ''))).map((r) => r.reply);
  return (out.length ? out : [DEFAULT_REPLY]).slice(0, 3);
}

function salesKit(base = SITE) {
  return SALES_KIT.map((item) => ({ ...item, url: item.path ? base.replace(/\/+$/, '') + item.path : null }));
}

function fill(text = '', vars = {}) {
  return String(text).replace(/\{(\w+)\}/g, (_m, k) => (vars[k] == null || vars[k] === '' ? (k === 'name' ? '' : '…') : String(vars[k]))).replace(/\s+,/g, ',').replace(/\s{2,}/g, ' ').trim();
}

module.exports = {
  SMS_TEXTS,
  FIRST_TEXTS,
  FIRST_TEXT_FOR,
  SMS_TEXT_KEYS,
  MOMO_CODE,
  WHATSAPP_NUMBER,
  WHATSAPP_DISPLAY,
  CLOSE_CHECKS,
  HELLO_CHECK,
  COACH,
  suggestReplies,
  GREETINGS,
  VARIANTS,
  OBJECTIONS,
  TEMPLATES,
  TEMPLATE_RULES,
  partOfDay,
  greetingFor,
  salesKit,
  fill
};
