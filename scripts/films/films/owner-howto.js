/*
 * How to list, for an owner (Agent 007, option 5, and sent the moment an owner
 * replies LIST to the owner film): every question the assistant asks, in
 * order, with its own words. README.md says where each line comes from.
 */
(function () {
  const { chat, head, proof, word, convo } = window.K;
  const T = window.T;
  const A = 'assets/';
  const SEETA = 'ad8c5ba2-0d6d-4882-82d7-95cc361a1581';
  const fill = (text) => String(text)
    .replace(/\{id\}/g, SEETA).replace(/MK-\{ref\}/g, 'MK-20261112-7D31F0').replace(/\{code\}/g, 'MK7Q2XPA').replace(/\{number\}/g, '+256 7•• ••• 418');
  const live = T.owner_live.also.find((m) => /Great news/.test(m.text)).text;

  const scenes = [];

  scenes.push({
    dur: 4.6, dark: true, photo: `${A}photo-seeta.jpg`, kb: '1.12,10,0,1.20,-4,-5',
    html: `<div style="position:absolute;left:40px;right:40px;top:320px">
        <span class="kick" data-in="0.25">How to list</span>
        <h1 data-in="0.5" style="margin-top:22px">List your property <span class="a">on WhatsApp.</span></h1>
        <p class="lead" data-in="1.5" style="font-size:29px;margin-top:22px">About 5 minutes. Every step, in order.</p>
      </div>`
  });

  const talk = convo(0.9, [
    { beat: { kick: 'Step 1', h: 'Say LIST.<br>Choose what it is.' } },
    { me: 'LIST', typed: true, cps: 7, hold: 0.5 },
    { bot: T.owner_list.reply, think: 0.5, hold: 2.6 },
    { me: '1', hold: 0.4 },
    { bot: T.owner_type.reply, think: 0.4, hold: 1.8 },
    { me: '1', hold: 0.4 },
    { bot: T.owner_ownership.reply, think: 0.4, hold: 1.5 },
    { beat: { kick: 'Step 2', h: 'A title<br>and your price.' } },
    { me: T.owner_title.said, hold: 0.5 },
    { bot: T.owner_title.reply, think: 0.4, hold: 2.2, marks: [['Seeta, Mukono | 2 bedrooms', 0.4]] },
    { me: T.owner_price.said, hold: 0.5 },
    { bot: T.owner_price.reply, think: 0.4, hold: 3.0, marks: [['USh 155,000,000', 0.3], ['at least 2 clear photos', 1.0]] },
    { beat: { kick: 'Step 3', h: 'At least 2<br>clear photos.' } },
    { me: '', photo: `${A}photo-seeta.jpg`, hold: 0.5 },
    { bot: T.owner_photo1.reply, think: 0.4, hold: 1.6 },
    { me: '', photo: `${A}thumb-seeta-3.jpg`, cls: 'sm', hold: 0.5 },
    { bot: T.owner_photo2.reply, think: 0.4, hold: 1.5, marks: [['that\'s enough to list it', 0.3]] },
    { me: 'DONE', hold: 0.4 },
    { bot: T.owner_done.reply.replace('3 photos received', '2 photos received'), think: 0.4, hold: 1.8 },
    { beat: { kick: 'Step 4', h: 'Your name and<br>number for buyers.' } },
    { me: 'Sarah Nakato', hold: 0.5 },
    { bot: fill(T.owner_name.reply), think: 0.4, hold: 2.0 },
    { me: 'YES', hold: 0.4 },
    { bot: T.owner_contact.reply, think: 0.4, hold: 3.0, marks: [['Your ID is never shown on makaug or shared with anyone', 0.5]] },
    { beat: { kick: 'Step 5', kickClass: 'g', h: 'Confirm<br>it is you.' } },
    { me: '', photo: `${A}id-standin.jpg`, cls: 'idc', hold: 0.5 },
    { bot: T.owner_id_photo.reply, think: 0.4, hold: 2.4, marks: [['never shown on makaug and never shared with anyone who enquires', 0.5]] },
    { me: 'CM•• •••• •••• ••', hold: 0.5 },
    { bot: T.owner_nin.reply, think: 0.5, hold: 4.2, marks: [['UGX 20,000 per listing, per month', 0.6], ['Nothing is charged automatically.', 1.5]] },
    { beat: { kick: 'Step 6', kickClass: 'g', h: 'Read the terms.<br>Reply AGREE.' } },
    { me: 'AGREE', typed: true, cps: 7, hold: 0.4 },
    { bot: fill(T.owner_agree.reply), think: 0.5, hold: 4.4, marks: [['Sent for review, Sarah.', 0.5], ['usually within 24 hours', 1.6]] },
    { beat: { kick: 'Then', kickClass: 'g', h: 'It goes live.<br>You get the link.' } },
    { day: 'Usually within 24 hours', hold: 0.7 },
    { bot: fill(live), think: 0.5, hold: 4.4, tick: 1310, marks: [['your listing is live on makaug', 0.5], ['UGX 20,000 a month', 1.5]] },
    { bot: '💳 How to pay: MoMo merchant code *27248497* — keep this card.', photo: `${A}momo-card.jpg`, cls: 'card', think: 0.3, hold: 3.2 }
  ]);
  scenes.push({
    dur: Math.ceil((talk.end + 0.4) * 10) / 10,
    html: head(talk.beats) + chat({ clock: 11 * 60 + 4, msgs: talk.msgs, type: talk.type })
      + proof('The assistant&rsquo;s real questions and replies. The ID is never shown.', 1.4)
  });

  scenes.push({
    dur: 8.6,
    html: head([{ kick: 'After that', kickClass: 'g', h: 'One word<br>does it.' }])
      + `<div style="position:absolute;left:36px;right:36px;top:322px;display:flex;flex-direction:column;gap:13px">`
      + word('STATUS', 'Check on your listing', '', 0.8)
      + word('SOLD', 'Shows SOLD, or LET, for 7 days', 'then it comes off the site and I tell you', 1.5)
      + word('REMOVE', 'Takes it off the site straight away', '', 2.4)
      + word('HELP', 'Ronald from our team gets back to you', '', 3.1)
      + word('LIST', 'Add another property', '', 3.8)
      + `</div>`
      + `<div class="card" style="position:absolute;left:36px;right:36px;top:840px;padding:22px 26px" data-in="4.8"><div class="tick"><i>✓</i><div>UGX 20,000 a month per property.<small>From the day it goes live. Nothing is charged automatically.</small></div></div></div>`
      + proof('Each word is answered by the assistant today', 1.4)
  });

  scenes.push({
    dur: 5.8, dark: true,
    html: `<div style="position:absolute;left:40px;right:40px;top:300px;text-align:center">
        <h1 data-in="0.3" style="font-size:74px">Ready to list?</h1>
        <p class="lead" data-in="0.8" style="font-size:30px;margin-top:18px">Reply to this chat with one word.</p>
        <div style="margin-top:60px" data-in="1.2" data-fx="pop"><div class="typed"><span><span class="ty" data-type="1.5" data-cps="5">LIST</span></span><span class="go">➤</span></div></div>
      </div>
      <div class="end" style="top:1010px" data-in="3.0"><div class="site">makaug<em>.com</em></div><div class="num">WhatsApp 0780 863 394</div></div>`
  });

  window.FILM = { name: 'How to list on makaug', label: 'How to list', scenes };
}());
