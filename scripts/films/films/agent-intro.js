/*
 * The agent film (Agent 007, option 3): why join, how posting works, what it costs.
 * Real pages, a real listing and the assistant's real replies. README.md says
 * where each claim comes from.
 */
(function () {
  const { chat, page, head, proof, callout, word } = window.K;
  const T = window.T;
  const A = 'assets/';
  const LISTING = '66446a14-b4c9-4c69-8a13-f786bbf39be7';
  const AGENT = '5aeed103-cda3-4d75-930c-4c43ee1659eb';
  const fill = (text) => String(text)
    .replace(/\{id\}/g, LISTING).replace(/\{agent\}/g, AGENT).replace(/MK-\{ref\}/g, 'MK-20261111-9C4A2E')
    // The title as it reads on the live page.
    .replace(/3-bed property for sale in Buwaate/g, '3-bed bungalow for sale in Buwaate');
  const scenes = [];

  // 1. The hook
  scenes.push({
    dur: 5.6, dark: true, photo: `${A}photo-buwaate.jpg`, kb: '1.10,0,0,1.20,-10,-6',
    html: `<div style="position:absolute;left:40px;right:40px;top:296px">
        <span class="kick" data-in="0.25">For property agents</span>
        <h1 data-in="0.5" style="margin-top:22px">Your properties are already on your phone.</h1>
        <h1 data-in="2.3" style="margin-top:30px"><span class="a">Put them in front of buyers.</span></h1>
        <p class="lead" data-in="3.3" style="font-size:29px;margin-top:22px">Straight from WhatsApp. This is how.</p>
      </div>${proof('A real listing on makaug.com: Buwaate, Wakiso', 1.2)}`
  });

  // 2. What makaug is
  scenes.push({
    dur: 7.4,
    html: head([{ kick: 'makaug.com', kickClass: 'g', h: 'Uganda&rsquo;s property portal.', lead: '4,700+ properties in one place. Search it in 9 languages.' }])
      + page({
        url: 'makaug.com', shot: `${A}page-home.jpg`,
        keys: [[0, -510], [3.2, -510], [4.5, -2320], [7.4, -2320]],
        rings: [{ x: 556, y: 1084, w: 140, h: 58, in: 1.5, out: 3.3 }, { x: 28, y: 2468, w: 664, h: 420, in: 4.9 }],
        pins: [{ src: `${A}pin-nav.jpg`, top: 0, in: 0 }]
      })
      + callout({ x: 392, y: 966, in: 1.8, out: 3.3, html: '4,708 on 14 Nov 2026', cls: 'a' })
      + callout({ x: 150, y: 930, in: 5.2, html: 'Buyers describe what they want<small>in any language, and the search finds it</small>', cls: 'g', w: 420, fx: 'up' })
      + proof('The makaug.com home page, 14 Nov 2026', 0.8)
  });

  // 3. Send it, we check it, it is live
  scenes.push({
    dur: 19,
    html: head([
      { kick: 'Step 1', h: 'Send it the way<br>you already do.', out: 9.5 },
      { kick: 'Step 2', kickClass: 'g', h: 'We check it.<br>Then it is <span class="g">live.</span>', at: 9.8 }
    ])
      + chat({
        clock: 14 * 60 + 12,
        msgs: [
          { me: true, at: 1.2, photo: `${A}photo-buwaate.jpg`, text: T.agent_post.said },
          { typing: true, at: 2.3, until: 3.4 },
          { at: 3.4, tick: 1, text: T.agent_post.reply, marks: [['Saved — your property in Buwaate is with our team for review.', 4.2], ['3 bedroom bungalow · for sale', 5.1], ['Buwaate, Wakiso', 5.5], ['UGX 290,000,000', 5.9]] },
          { day: 'Checked by the makaug team', at: 10.3 },
          { at: 11.0, tick: 96, text: fill(T.agent_live.reply), marks: [['Your property is live on makaug.com', 11.8], ['buyers see your name and number', 14.2]] }
        ]
      })
      + proof('A real listing and the assistant&rsquo;s real replies', 1.6)
  });

  // 4. The page it becomes
  scenes.push({
    dur: 10,
    html: head([{ kick: 'What buyers see', kickClass: 'g', h: 'A proper page<br>for every property.' }])
      + page({
        url: `makaug.com/property/66446a14…`, shot: `${A}page-listing.jpg`,
        keys: [[0, -540], [2.4, -540], [3.6, -1560], [6.0, -1560], [7.1, -2380], [10, -2380]],
        rings: [{ x: 44, y: 2050, w: 330, h: 100, in: 3.9, out: 6.0 }, { x: 52, y: 2530, w: 616, h: 500, in: 7.4 }],
        pins: [{ src: `${A}pin-nav.jpg`, top: 0, in: 0 }, { src: `${A}pin-contact.jpg`, bottom: 0, in: 0 }]
      })
      + callout({ x: 300, y: 980, in: 1.2, out: 3.4, html: 'Call and WhatsApp buttons<small>buyers reach you, not us</small>', cls: 'g' })
      + callout({ x: 388, y: 822, in: 4.2, out: 6.0, html: 'Title, price and details<small>written up from your caption</small>', w: 280 })
      + callout({ x: 250, y: 962, in: 7.6, html: 'Area highlights, nearby places and a map<small>added for you</small>', w: 400, fx: 'up' })
      + proof('A real listing page. The phone number is hidden in this film.', 0.8)
  });

  // 5. Leads
  scenes.push({
    dur: 8.6,
    html: head([{ kick: 'Leads', h: 'Enquiries land<br>in your WhatsApp.' }])
      + chat({
        clock: 9 * 60 + 41, height: 800,
        msgs: [
          { at: 1.2, text: fill(T.agent_enquiry.reply), marks: [['New enquiry from makaug.com', 1.9], ['Please contact them directly.', 4.4]] }
        ]
      })
      + callout({ x: 122, y: 1122, in: 5.2, html: 'No commission. makaug stays out of your deal.', cls: 'g', w: 560, fx: 'up' })
      + proof('The message an agent receives. This enquiry is an example.', 1.6)
  });

  // 6. Who is looking
  const flags = [['🇺🇬', 'Uganda'], ['🇬🇧', 'United Kingdom'], ['🇺🇸', 'United States'], ['🇦🇪', 'UAE'], ['🇨🇦', 'Canada'], ['🇿🇦', 'South Africa'], ['🇰🇪', 'Kenya'], ['🌍', 'and more']];
  scenes.push({
    dur: 7.6, dark: true,
    html: `<div style="position:absolute;left:40px;right:40px;top:176px">
        <span class="kick" data-in="0.2">Who is looking</span>
        <h2 data-in="0.4" style="font-size:56px">Opened in Uganda<br>and <span class="a">abroad.</span></h2>
        <p class="lead" data-in="0.9">Countries where makaug listings were opened in the last 30 days.</p>
        <div class="flags" style="margin-top:26px">${flags.map(([f, n], i) => `<div class="flag" data-in="${(1.3 + i * 0.16).toFixed(2)}" data-fx="pop"><i>${f}</i>${n}</div>`).join('')}</div>
        <div style="display:flex;align-items:center;gap:22px;margin-top:34px" data-in="3.4">
          <div class="big" style="color:var(--gold);font-size:120px">9</div>
          <div style="color:#fff;font-size:27px;font-weight:700;line-height:1.25;letter-spacing:-.01em">languages on the site and in the WhatsApp assistant<div style="font-size:19px;font-weight:500;opacity:.8;margin-top:6px">English, Luganda, Kiswahili, Runyankole, Acholi and four more</div></div>
        </div>
        <div style="margin-top:34px;background:rgba(255,255,255,.10);border:1px solid rgba(255,255,255,.16);border-radius:22px;padding:22px 24px;color:#fff;font-size:25px;font-weight:700;line-height:1.3;letter-spacing:-.012em" data-in="4.4">Ugandans abroad buy and rent back home.<div style="font-size:20px;font-weight:500;opacity:.84;margin-top:6px">Your listing is where they are looking.</div></div>
        <p class="src" data-in="4.9" data-fx="fade" style="margin-top:26px">Source: makaug.com&rsquo;s own visit records, 30 days to 14 Nov 2026</p>
      </div>`
  });

  // 7. Your own page
  scenes.push({
    dur: 9.6,
    html: head([{ kick: 'Your shop window', h: 'Your own page<br>on makaug.' }])
      + page({
        url: 'makaug.com/agents/kimuli-brian', shot: `${A}page-agent.jpg`,
        keys: [[0, -470], [2.6, -470], [3.8, -1610], [6.2, -1610], [7.3, -2690], [9.6, -2690]],
        rings: [{ x: 28, y: 1778, w: 326, h: 150, in: 4.1, out: 6.2 }],
        pins: [{ src: `${A}pin-nav.jpg`, top: 0, in: 0 }, { src: `${A}pin-agentbar.jpg`, bottom: 0, in: 0 }]
      })
      + callout({ x: 330, y: 742, in: 1.1, out: 2.7, html: 'Verified tick and your agent number', w: 300 })
      + callout({ x: 376, y: 552, in: 4.3, out: 6.2, html: '107 properties live<small>on this one agent&rsquo;s page</small>', cls: 'a' })
      + callout({ x: 200, y: 972, in: 7.5, html: 'One link for everything you have<small>reply SHARE and it is sent to you</small>', cls: 'g', w: 400, fx: 'up' })
      + proof('A real agent&rsquo;s page on makaug.com', 0.8)
  });

  // 8. It keeps working
  scenes.push({
    dur: 7.6,
    html: head([{ kick: 'Every week, every morning', kickClass: 'g', h: 'Things to share.<br>Things to know.' }])
      + `<div class="mini" style="left:44px;top:330px;width:296px" data-in="0.6" data-fx="rise" data-d="0.7"><div><img src="${A}still-showcase.jpg"></div></div>`
      + `<div class="mini" style="left:380px;top:330px;width:296px" data-in="0.9" data-fx="rise" data-d="0.7"><div><img src="${A}still-brief.jpg"></div></div>`
      + `<div class="cap" style="left:44px;width:296px;top:884px" data-in="1.6">Your weekly report<small>views, enquiries and a film of your listings to share</small></div>`
      + `<div class="cap" style="left:380px;width:296px;top:884px" data-in="1.9">The Morning Brief<small>5 property stories, every day at 7am</small></div>`
      + `<div class="card" style="position:absolute;left:44px;right:44px;top:1010px;padding:20px 24px" data-in="3.0"><div class="tick"><i>✓</i><div>You always know what your listings are doing.<small>How many people opened them, and who asked.</small></div></div></div>`
      + proof('Frames from films makaug has sent to agents', 2.2)
  });

  // 9. One word
  scenes.push({
    dur: 10.4,
    html: head([{ kick: 'Simple', h: 'Run it all<br>with one word.' }])
      + `<div style="position:absolute;left:36px;right:36px;top:318px;display:flex;flex-direction:column;gap:13px">`
      + word('SHARE', 'Your page link and your agent card', '', 0.8)
      + word('STATUS', 'Where each of your properties is', '', 1.5)
      + word('SOLD', 'A SOLD badge for 7 days, then it comes off', 'buyers see that you close deals', 2.2)
      + word('MY PHOTO', 'Change your profile picture or logo', '', 3.2)
      + word('SHORT STAY', 'List a place by the night', '', 3.9)
      + word('HELP', 'Ronald from our team gets back to you', '', 4.6)
      + `</div>`
      + `<div class="card" style="position:absolute;left:36px;right:36px;top:908px;padding:20px 24px" data-in="5.6"><div class="tick"><i>✓</i><div>Or just send the next property.<small>You never need a menu, an app or a password.</small></div></div></div>`
      + proof('Each word is answered by the assistant today', 1.4)
  });

  // 10. Off-plan
  const doc = (lang, label, x, rot, at) => `<div class="doc" style="left:${x}px;top:832px;width:192px" data-base="rotate(${rot}deg)" data-in="${at}" data-fx="rise" data-d="0.6"><img src="${A}brochure-${lang}.jpg"><span>${label}</span></div>`;
  scenes.push({
    dur: 7.2,
    html: head([{ kick: 'For developers', kickClass: 'g', h: 'Selling off-plan?<br>Project pages too.' }])
      + page({
        url: 'makaug.com/off-plan/vanta-house', shot: `${A}page-vanta.jpg`, height: 506,
        keys: [[0, -540], [2.4, -540], [3.8, -1010], [7.2, -1010]],
        pins: [{ src: `${A}pin-nav.jpg`, top: 0, in: 0 }]
      })
      + doc('en', 'ENGLISH', 60, -5, 2.6) + doc('lg', 'LUGANDA', 264, 0, 2.9) + doc('sw', 'KISWAHILI', 468, 5, 3.2)
      + `<div class="cap" style="left:36px;right:36px;top:1130px" data-in="3.8">A brochure buyers can read in their own language</div>`
      + proof('A real project page and its three brochures', 1.0)
  });

  // 11. The price
  scenes.push({
    dur: 8.2,
    html: head([{ kick: 'The price', h: 'UGX 50,000 a month.', lead: 'All your properties. No commission.' }])
      + `<div class="momo" style="left:44px;top:352px;width:338px" data-base="rotate(-3deg)" data-in="0.9" data-fx="rise" data-d="0.7"><img src="${A}momo-card.jpg"></div>`
      + `<div style="position:absolute;left:412px;right:36px;top:366px;display:flex;flex-direction:column;gap:13px">
          <div class="kick o" data-in="1.6" style="padding:0">Pay with MTN MoMo</div>
          <div class="stepc" data-in="1.9" data-fx="left"><i>1</i><div>Dial <b>*165*3#</b></div></div>
          <div class="stepc" data-in="2.3" data-fx="left"><i>2</i><div>Choose <b>1</b><small>Merchant code</small></div></div>
          <div class="stepc" data-in="2.7" data-fx="left"><i>3</i><div>Enter <b>27248497</b></div></div>
          <div class="stepc" data-in="3.1" data-fx="left"><i>4</i><div>UGX 50,000<small>and your PIN</small></div></div>
        </div>`
      + `<div class="card" style="position:absolute;left:36px;right:36px;top:852px;display:flex;flex-direction:column;gap:18px;padding:28px" data-in="4.0">
          <div class="tick"><i>✓</i><div>One flat fee, however many you post.</div></div>
          <div class="tick"><i>✓</i><div>makaug takes nothing from your deals.</div></div>
          <div class="tick"><i>✓</i><div>Nothing is charged automatically.<small>You pay by MoMo, then reply with your name and we confirm it.</small></div></div>
        </div>`
      + proof('makaug&rsquo;s own merchant card: MAKAUG ONLINE REAL ESTATE LTD', 1.4)
  });

  // 12. What to do now
  scenes.push({
    dur: 6.6, dark: true,
    html: `<div style="position:absolute;left:40px;right:40px;top:300px;text-align:center">
        <h1 data-in="0.3" style="font-size:74px">Ready to join?</h1>
        <p class="lead" data-in="0.8" style="font-size:30px;margin-top:18px">Reply to this chat with one word.</p>
        <div style="margin-top:60px" data-in="1.3" data-fx="pop"><div class="typed"><span><span class="ty" data-type="1.7" data-cps="6">AGENT</span></span><span class="go">➤</span></div></div>
        <p class="lead" data-in="3.2" style="font-size:27px;margin-top:54px;color:#fff">Ronald from makaug calls you<br>and sets you up.</p>
      </div>
      <div class="end" style="top:1010px" data-in="4.0"><div class="site">makaug<em>.com</em></div><div class="num">WhatsApp 0780 863 394</div></div>`
  });

  window.FILM = { name: 'makaug for agents', label: 'For agents', scenes };
}());
