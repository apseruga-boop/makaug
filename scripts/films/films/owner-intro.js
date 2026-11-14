/*
 * The owner film (Agent 007, option 4): for someone selling or letting their
 * own property. Why list direct, how it is done, what happens when a buyer
 * calls, and the fee at the end. README.md says where each claim comes from.
 */
(function () {
  const { chat, page, head, proof, callout, word, convo } = window.K;
  const T = window.T;
  const A = 'assets/';
  const SEETA = 'ad8c5ba2-0d6d-4882-82d7-95cc361a1581';
  const fill = (text) => String(text)
    .replace(/\{id\}/g, SEETA).replace(/MK-\{ref\}/g, 'MK-20261112-7D31F0').replace(/\{code\}/g, 'MK7Q2XPA').replace(/\{number\}/g, '+256 7•• ••• 418');
  const live = T.owner_live.also.find((m) => /Great news/.test(m.text)).text;
  const tick = (title, small, at) => `<div class="tick lg" data-in="${at}"><i>✓</i><div>${title}${small ? `<small>${small}</small>` : ''}</div></div>`;
  const step = (n, title, small, at) => `<div class="stepc" data-in="${at}" data-fx="right"><i>${n}</i><div>${title}<small>${small}</small></div></div>`;

  const scenes = [];

  // 1. The hook
  scenes.push({
    dur: 5.6, dark: true, photo: `${A}photo-seeta.jpg`, kb: '1.12,10,0,1.22,-6,-6',
    html: `<div style="position:absolute;left:40px;right:40px;top:300px">
        <span class="kick" data-in="0.25">For property owners</span>
        <h1 data-in="0.5" style="margin-top:22px;font-size:62px">Selling or renting out your own property?</h1>
        <h1 data-in="2.3" style="margin-top:28px;font-size:62px"><span class="a">List it yourself. Buyers call you.</span></h1>
        <p class="lead" data-in="3.3" style="font-size:29px;margin-top:22px">On WhatsApp, in about 5 minutes.</p>
      </div>${proof('A real listing on makaug.com: Seeta, Mukono', 1.2)}`
  });

  // 2. Direct, said kindly
  scenes.push({
    dur: 8.2,
    html: head([{ kick: 'Your choice', kickClass: 'g', h: 'A good agent<br>earns their fee.', lead: 'If you would rather deal with buyers yourself, makaug lets you list direct.' }])
      + `<div class="card" style="position:absolute;left:36px;right:36px;top:352px;display:flex;flex-direction:column;gap:27px;padding:32px 28px">`
      + tick('Your name and number on the listing', 'Buyers and tenants call or WhatsApp you.', 1.5)
      + tick('No commission', 'makaug takes nothing from your sale or your rent.', 2.3)
      + tick('You stay in charge', 'Your price, your viewings, your decision.', 3.1)
      + tick('Seen in Uganda and abroad', 'The site works in 9 languages.', 3.9)
      + `</div>`
      + `<div class="card" style="position:absolute;left:36px;right:36px;top:872px;padding:24px 28px;background:#E7F2EA;box-shadow:none" data-in="5.0"><div style="font-size:25px;font-weight:700;line-height:1.3;letter-spacing:-.012em">Already working with an agent?<div style="font-size:20.5px;font-weight:500;color:var(--soft);margin-top:5px">That is fine too. Agents list on makaug as well.</div></div></div>`
  });

  // 3. Listing it, start to finish
  const talk = convo(0.9, [
    { beat: { kick: 'Step 1', h: 'Say LIST.<br>Answer a few questions.' } },
    { me: 'LIST', typed: true, cps: 7, hold: 0.5 },
    { bot: T.owner_list.reply, think: 0.4, hold: 1.5 },
    { me: '1', hold: 0.3 },
    { bot: T.owner_type.reply, think: 0.3, hold: 0.9 },
    { me: '1', hold: 0.3 },
    { bot: T.owner_ownership.reply, think: 0.3, hold: 0.8 },
    { beat: { kick: 'Step 2', h: 'A title, a price,<br>your photos.' } },
    { me: T.owner_title.said, hold: 0.4 },
    { bot: T.owner_title.reply, think: 0.3, hold: 1.0, marks: [['Seeta, Mukono | 2 bedrooms', 0.4]] },
    { me: T.owner_price.said, hold: 0.4 },
    { bot: T.owner_price.reply, think: 0.3, hold: 1.2, marks: [['USh 155,000,000', 0.3]] },
    { me: '', photo: `${A}photo-seeta.jpg`, hold: 0.5 },
    { bot: T.owner_photo1.reply, think: 0.3, hold: 0.7 },
    { me: '', photos: [`${A}thumb-seeta-3.jpg`, `${A}thumb-seeta-4.jpg`], hold: 0.5 },
    { bot: T.owner_photo3.reply, think: 0.3, hold: 0.9 },
    { beat: { kick: 'Step 3', kickClass: 'g', h: 'Confirm it is you.<br>Agree. Done.' } },
    { me: 'DONE', hold: 0.4 },
    { bot: T.owner_done.reply, think: 0.3, hold: 0.8 },
    { me: 'Sarah Nakato', hold: 0.4 },
    { bot: fill(T.owner_name.reply), think: 0.3, hold: 0.9 },
    { me: 'YES', hold: 0.4 },
    { bot: T.owner_contact.reply, think: 0.3, hold: 1.4, marks: [['Your ID is never shown on makaug or shared with anyone', 0.4]] },
    { day: 'ID sent · terms read · AGREE', hold: 0.8 },
    { bot: fill(T.owner_agree.reply), think: 0.4, hold: 3.3, marks: [['Sent for review, Sarah.', 0.5]] }
  ]);
  scenes.push({
    dur: Math.ceil((talk.end + 0.4) * 10) / 10,
    html: head(talk.beats) + chat({ clock: 11 * 60 + 4, msgs: talk.msgs, type: talk.type })
      + proof('The assistant&rsquo;s real questions and replies, shown faster than life', 1.4)
  });

  // 4. The ID
  scenes.push({
    dur: 6.4,
    html: head([{ kick: 'Why the ID', h: 'Your ID stays<br>private.' }])
      + `<div class="card" style="position:absolute;left:36px;right:36px;top:352px;display:flex;flex-direction:column;gap:32px;padding:36px 30px">`
      + `<div class="tick lg" data-in="0.9"><i>🔒</i><div>Only our review team sees it<small>It is never shown on makaug and never given to anyone who enquires.</small></div></div>`
      + `<div class="tick lg" data-in="1.9"><i>🛡</i><div>It keeps conmen off makaug<small>Buyers and tenants trust a listing whose owner has been checked.</small></div></div>`
      + `<div class="tick lg" data-in="2.9"><i>✓</i><div>A person checks every listing<small>Usually within 24 hours, before it goes live.</small></div></div>`
      + `</div>`
      + `<div style="position:absolute;left:36px;right:36px;top:846px" data-in="3.8"><div style="font-size:14px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:var(--soft);margin:0 0 10px 6px">What the assistant tells you</div><div class="b" style="max-width:100%;font-size:22px;border-radius:18px;border-top-left-radius:4px;padding:16px 18px;box-shadow:0 8px 22px rgba(21,33,58,.08)">${window.K.wa(T.owner_contact.reply.split('\n\n')[1])}</div></div>`
  });

  // 5. Live, and what it costs to keep it there
  const went = convo(0.9, [
    { day: 'Usually within 24 hours', hold: 0.6 },
    { bot: fill(live), think: 0.6, hold: 3.4, marks: [['your listing is *live* on makaug'.replace(/\*/g, ''), 0.5], ['UGX 20,000 a month', 1.4]] },
    { bot: '💳 How to pay: MoMo merchant code *27248497* — keep this card.', photo: `${A}momo-card.jpg`, cls: 'card', think: 0.3, hold: 2.4 }
  ]);
  scenes.push({
    dur: 8.4,
    html: head([{ kick: 'Then', kickClass: 'g', h: 'Our team checks it.<br>You get the link.' }])
      + chat({ clock: 9 * 60 + 15, msgs: went.msgs })
      + proof('The message an owner receives when a listing goes live', 1.4)
  });

  // 6. What buyers see
  scenes.push({
    dur: 8.4,
    html: head([{ kick: 'Live on makaug.com', h: 'Buyers see this.<br>Then they call you.' }])
      + page({
        url: 'makaug.com/property/ad8c5ba2…', shot: `${A}page-seeta.jpg`,
        keys: [[0, -470], [2.2, -470], [3.4, -1560], [5.0, -1560], [6.2, -3720], [8.4, -3720]],
        rings: [{ x: 44, y: 4190, w: 330, h: 100, in: 6.5 }],
        pins: [{ src: `${A}pin-nav.jpg`, top: 0, in: 0 }, { src: `${A}pin-contact-seeta.jpg`, bottom: 0, in: 0 }]
      })
      + callout({ x: 300, y: 980, in: 1.0, out: 3.2, html: 'Call and WhatsApp buttons<small>with the lister&rsquo;s own number</small>', cls: 'g' })
      + callout({ x: 250, y: 962, in: 3.7, out: 6.0, html: 'Every photo you sent', fx: 'up' })
      + callout({ x: 388, y: 866, in: 6.8, html: 'Your price, your words', w: 280 })
      + proof('A real listing page (this one is an agent&rsquo;s). Number hidden.', 0.8)
  });

  // 7. When a buyer calls
  scenes.push({
    dur: 13,
    html: head([{ kick: 'When a buyer calls', h: 'The sale is yours.<br>Do it safely.' }])
      + `<div class="steps lg" style="position:absolute;left:36px;right:36px;top:326px">`
      + step(1, 'They call or WhatsApp you', 'Meet at the property and show it yourself.', 0.9)
      + step(2, 'Let them check the title', 'A search at the land office shows it is yours to sell.', 2.3)
      + step(3, 'Put it in writing', 'A lawyer draws up the sale agreement. Both sides sign, with witnesses.', 3.9)
      + step(4, 'Take payment through the bank', 'Not cash in hand. Keep every receipt.', 5.7)
      + step(5, 'Hand over, then reply SOLD', 'Letting it out? A written tenancy agreement and a receipt for every payment.', 7.4)
      + `</div>`
      + `<div style="position:absolute;left:44px;right:44px;top:1072px;font-size:18px;line-height:1.4;font-weight:500;color:var(--soft);text-align:center" data-in="9.2" data-fx="fade">General guidance, not legal advice. makaug advertises your property; the deal is between you and the buyer or tenant.</div>`
  });

  // 8. One word
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
      + `<div class="card" style="position:absolute;left:36px;right:36px;top:840px;padding:22px 26px" data-in="4.8"><div class="tick"><i>✓</i><div>No app, no account, no password.<small>Everything happens in this WhatsApp chat.</small></div></div></div>`
      + proof('Each word is answered by the assistant today', 1.4)
  });

  // 9. The fee
  scenes.push({
    dur: 9.6,
    html: head([{ kick: 'The fee', h: 'UGX 20,000 a month.', lead: 'Per property, from the day it goes live. No commission.' }])
      + `<div class="momo" style="left:44px;top:372px;width:320px" data-base="rotate(-3deg)" data-in="0.9" data-fx="rise" data-d="0.7"><img src="${A}momo-card.jpg"></div>`
      + `<div style="position:absolute;left:400px;right:36px;top:384px;display:flex;flex-direction:column;gap:12px">
          <div class="kick o" data-in="1.6" style="padding:0">Pay with MTN MoMo</div>
          <div class="stepc" data-in="1.9" data-fx="left"><i>1</i><div>Dial <b>*165*3#</b></div></div>
          <div class="stepc" data-in="2.3" data-fx="left"><i>2</i><div>Choose <b>1</b><small>Merchant code</small></div></div>
          <div class="stepc" data-in="2.7" data-fx="left"><i>3</i><div>Enter <b>27248497</b></div></div>
          <div class="stepc" data-in="3.1" data-fx="left"><i>4</i><div>UGX 20,000<small>and your PIN</small></div></div>
        </div>`
      + `<div class="card" style="position:absolute;left:36px;right:36px;top:848px;display:flex;flex-direction:column;gap:17px;padding:26px" data-in="4.0">
          <div class="tick"><i>✓</i><div>Nothing is charged automatically.<small>The link and this card come with your &ldquo;it is live&rdquo; message.</small></div></div>
          <div class="tick"><i>✓</i><div>Paid? Reply with your name.<small>We match the payment and confirm it.</small></div></div>
          <div class="tick"><i>✓</i><div>Not paid? We remind you first.<small>An unpaid listing can be taken off until you pay.</small></div></div>
        </div>`
  });

  // 10. What to do now
  scenes.push({
    dur: 6.6, dark: true,
    html: `<div style="position:absolute;left:40px;right:40px;top:300px;text-align:center">
        <h1 data-in="0.3" style="font-size:74px">Ready to list?</h1>
        <p class="lead" data-in="0.8" style="font-size:30px;margin-top:18px">Reply to this chat with one word.</p>
        <div style="margin-top:60px" data-in="1.3" data-fx="pop"><div class="typed"><span><span class="ty" data-type="1.7" data-cps="5">LIST</span></span><span class="go">➤</span></div></div>
        <p class="lead" data-in="3.0" style="font-size:27px;margin-top:54px;color:#fff">I take you through it,<br>one question at a time.</p>
      </div>
      <div class="end" style="top:1010px" data-in="3.9"><div class="site">makaug<em>.com</em></div><div class="num">WhatsApp 0780 863 394</div></div>`
  });

  window.FILM = { name: 'makaug for owners', label: 'For owners', scenes };
}());
