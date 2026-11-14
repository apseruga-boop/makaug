/*
 * How to post, for an approved agent (Agent 007, option 5): one conversation
 * from the photo to the link, then the words that run everything else.
 * README.md says where each line comes from.
 */
(function () {
  const { chat, head, proof, callout, word, convo } = window.K;
  const T = window.T;
  const A = 'assets/';
  const LISTING = '66446a14-b4c9-4c69-8a13-f786bbf39be7';
  const AGENT = '5aeed103-cda3-4d75-930c-4c43ee1659eb';
  const fill = (text) => String(text)
    .replace(/\{id\}/g, LISTING).replace(/\{agent\}/g, AGENT).replace(/MK-\{ref\}/g, 'MK-20261111-9C4A2E')
    // The title as it reads on the live page.
    .replace(/3-bed property for sale in Buwaate/g, '3-bed bungalow for sale in Buwaate');
  // In this film the agent corrects the price to 285m, so the messages after it say 285.
  const after = (text) => fill(text).replace(/290,000,000/g, '285,000,000').replace(/USh 290M/g, 'USh 285M');

  const scenes = [];

  scenes.push({
    dur: 4.6, dark: true, photo: `${A}photo-buwaate.jpg`, kb: '1.10,0,0,1.18,-8,-5',
    html: `<div style="position:absolute;left:40px;right:40px;top:330px">
        <span class="kick" data-in="0.25">How to post</span>
        <h1 data-in="0.5" style="margin-top:22px">Post a property in <span class="a">one message.</span></h1>
        <p class="lead" data-in="1.5" style="font-size:29px;margin-top:22px">For makaug agents. On WhatsApp.</p>
      </div>`
  });

  const talk = convo(0.9, [
    { beat: { kick: 'Step 1', h: 'Photos and a caption.<br>One message.' } },
    { me: T.agent_post.said, photo: `${A}photo-buwaate.jpg`, hold: 0.7 },
    { bot: T.agent_post.reply, think: 0.9, hold: 6.4, marks: [['Saved — your property in Buwaate is with our team for review.', 0.7], ['3 bedroom bungalow · for sale', 1.5], ['Buwaate, Wakiso', 1.9], ['UGX 290,000,000', 2.3], ['send more and I will add them to this one', 3.6]] },
    { beat: { kick: 'Step 2', h: 'Something wrong?<br>Reply with the fix.' } },
    { me: 'price 285m', typed: true, cps: 9, hold: 0.4 },
    { bot: T.agent_fix_buwaate.reply, think: 0.6, hold: 3.2, marks: [['price is now UGX 285,000,000', 0.4]] },
    { beat: { kick: 'Step 3', kickClass: 'g', h: 'We check it.<br>You get the link.' } },
    { day: 'Checked by the makaug team', hold: 0.7 },
    { bot: after(T.agent_live.reply), think: 0.5, hold: 5.0, tick: 96, marks: [['Your property is live on makaug.com', 0.5], ['buyers see your name and number', 2.6]] },
    { beat: { kick: 'Step 4', kickClass: 'g', h: 'Share it.<br>Buyers call you.' } },
    { me: 'SHARE', typed: true, cps: 7, hold: 0.4 },
    { bot: fill(T.agent_share.reply), think: 0.6, hold: 5.4, marks: [['Everything you have live sits on that one page', 0.6], ['Your agent card', 2.6]] }
  ]);
  const saved = talk.msgs.find((m) => m.text === T.agent_post.reply).at;
  scenes.push({
    dur: Math.ceil((talk.end + 0.4) * 10) / 10,
    html: head(talk.beats) + chat({ clock: 14 * 60 + 12, msgs: talk.msgs, type: talk.type })
      + callout({ x: 150, y: 1010, in: saved + 2.8, out: saved + 6.2, html: 'Say what it is, where it is and the price<small>more photos or a video? send them next</small>', cls: 'a', w: 480, fx: 'up' })
      + proof('The assistant&rsquo;s real replies, to a real listing&rsquo;s caption', 1.4)
  });

  scenes.push({
    dur: 9.4,
    html: head([{ kick: 'Handy words', h: 'Reply with<br>one word.' }])
      + `<div style="position:absolute;left:36px;right:36px;top:322px;display:flex;flex-direction:column;gap:13px">`
      + word('STATUS', 'Where each of your properties is', '', 0.8)
      + word('SOLD', 'A SOLD badge for 7 days, then it comes off', 'a rental shows LET', 1.5)
      + word('MY PHOTO', 'Change your profile picture or logo', '', 2.4)
      + word('SHORT STAY', 'List a place by the night', '', 3.1)
      + word('HELP', 'Ronald from our team gets back to you', '', 3.8)
      + `</div>`
      + `<div class="card" style="position:absolute;left:36px;right:36px;top:840px;padding:22px 26px" data-in="4.8"><div class="tick"><i>✓</i><div>One property per message.<small>Send as many messages as you have properties.</small></div></div></div>`
      + proof('Each word is answered by the assistant today', 1.4)
  });

  const sold = convo(0.9, [
    { me: T.agent_sold.said, hold: 0.5 },
    { bot: after(T.agent_sold.reply), photo: `${A}photo-buwaate.jpg`, think: 0.7, hold: 2.6, marks: [['Yes, mark it SOLD', 0.8]] },
    { me: '1', hold: 0.4 },
    { bot: after(T.agent_sold_yes.reply), think: 0.6, hold: 4.0, marks: [['Marked as SOLD', 0.4], ['SOLD badge for 7 days', 1.4]] }
  ]);
  scenes.push({
    dur: Math.ceil((sold.end + 0.3) * 10) / 10,
    html: head([{ kick: 'When it goes', kickClass: 'g', h: 'Say it is sold.<br>We mark it.' }])
      + chat({ clock: 16 * 60 + 40, msgs: sold.msgs })
      + proof('The assistant&rsquo;s real replies', 1.4)
  });

  scenes.push({
    dur: 5.4, dark: true,
    html: `<div style="position:absolute;left:40px;right:40px;top:340px;text-align:center">
        <h1 data-in="0.3" style="font-size:70px">Got one to post?</h1>
        <p class="lead" data-in="0.9" style="font-size:31px;margin-top:22px;color:#fff">Send it now.<br>Photos and a caption.</p>
      </div>
      <div class="end" style="top:1010px" data-in="2.2"><div class="site">makaug<em>.com</em></div><div class="num">WhatsApp 0780 863 394</div></div>`
  });

  window.FILM = { name: 'How to post on makaug', label: 'How to post', scenes };
}());
