/*
 * Off-plan walkthroughs, for agents (27 Nov 2026). A real project's
 * walkthroughs on makaug (Vanta House), how an agent sends their own off-plan
 * project, and the link to try one. README.md says where each picture is from.
 */
(function () {
  const { chat, page, head, proof, callout, convo } = window.K;
  const A = 'assets/';
  const V = '../../assets/off-plan/vanta-house/';
  // A walkthrough clip: its frames, cut by render.js into .build/clips.
  const clip = (name, frames, at) => `<img data-seq='${JSON.stringify({ src: `.build/clips/${name}/%04d.jpg`, n: frames, fps: 30, at })}' style="width:100%;height:100%;object-fit:cover">`;
  const scenes = [];

  // What the agent sends in the example, and the assistant's own replies to it
  // on 27 Nov 2026 (agentSelfIntakeSavedReply with the floor plan photo, then
  // walkthroughReadyMessage once the walkthrough is approved). The project is
  // an example; the words are the assistant's.
  const SENT = 'Off-plan project: Example Court, Kira\n2 and 3 bedroom apartments\n2 bedroom, 85 m², from UGX 280m\n3 bedroom, 120 m², from UGX 390m\nReady December 2027, pay over 24 months';
  const SAVED = '✅ *Saved — Example Court is with the off-plan desk for review.*\n\n🏗️ Off-plan project: Example Court · 2–3 bedroom homes · for sale\n📍 Kira, Wakiso\n💰 from UGX 280,000,000\n📸 *Still needed:* renders or site photos of the project — the page cannot go live without one.\n\n🎬 Floor plan received — we will make the walkthrough video and the 3D walk-around from it (included in your plan) and send you the link here.\n\nAnything wrong? Just reply with the correction — e.g. _price 1.5m_ or _area Najjera, Wakiso_.\n\nAs soon as it is approved it goes live under your name and I will send you the link to share.\n\nNext property? Send it the same way — one property per message.';
  const READY = '🎬 *Your walkthrough for Example Court is ready.*\n\nBuyers can watch it and walk around the home themselves on the project page:\nhttps://makaug.com/off-plan/example-court\n\n🚶 Walk around it yourself: https://makaug.com/off-plan/example-court/tour?home=2bhk\n\nShare the link with your buyers. Next off-plan project? Send it here with its floor plans and we will make its walkthrough too.\n\nPhillip, makaug.com';

  // 1. The hook
  scenes.push({
    dur: 4.8, dark: true, photo: `${V}hero-tower-sunset.jpg`, kb: '1.08,0,0,1.18,-10,-4',
    html: `<div style="position:absolute;left:40px;right:40px;top:316px">
        <span class="kick" data-in="0.2">New for makaug agents</span>
        <h1 data-in="0.45" style="margin-top:22px">Off-plan homes buyers can <span class="a">walk through.</span></h1>
        <p class="lead" data-in="1.9" style="font-size:30px;margin-top:24px">Before a single wall is built.</p>
      </div>${proof('Vanta House, Naguru: the developer&rsquo;s picture of the finished tower', 1.2)}`
  });

  // 2. A real one, live on makaug
  scenes.push({
    dur: 8.8,
    html: head([{ kick: 'A real one', kickClass: 'g', h: 'Vanta House, Naguru.<br>Live on makaug now.' }])
      + page({
        url: 'makaug.com/off-plan/vanta-house', shot: `${A}page-vanta-walk.jpg`,
        keys: [[0, -540], [1.8, -540], [3.3, -13110], [5.1, -13110], [5.9, -13560], [8.8, -13560]],
        rings: [{ x: 92, y: 13652, w: 536, h: 314, in: 6.1, out: 7.3 }, { x: 92, y: 13972, w: 380, h: 92, in: 7.4 }],
        pins: [{ src: `${A}pin-nav-vanta.jpg`, top: 0, in: 0 }]
      })
      + callout({ x: 300, y: 560, in: 3.6, out: 5.2, html: 'Walk through the homes<small>one walkthrough for each home type</small>', cls: 'g', w: 330 })
      + callout({ x: 392, y: 532, in: 6.2, out: 7.3, html: 'Play the walkthrough', w: 270 })
      + callout({ x: 474, y: 738, in: 7.5, html: 'Or walk around it<small>in 3D, on the phone</small>', cls: 'g', w: 216, fx: 'left' })
      + proof('The Vanta House page on makaug.com, 27 Nov 2026', 0.8)
  });

  // 3. The floor plan becomes the walkthrough
  scenes.push({
    dur: 10.0,
    html: head([
      { kick: 'How it works', h: 'From the developer&rsquo;s<br>floor plan&hellip;', out: 4.3 },
      { kick: 'How it works', kickClass: 'g', h: '&hellip;to a walkthrough<br>of the home.', at: 4.5 }
    ])
      + `<div class="card" style="position:absolute;left:36px;right:36px;top:318px;height:450px;padding:12px;display:flex;align-items:center;justify-content:center" data-in="0.5" data-fx="rise" data-d="0.7"><img src="${V}floor-plan-2bhk.jpg" style="height:424px;width:auto;border-radius:12px"></div>`
      + `<div class="callout" style="left:58px;top:336px" data-in="1.4" data-fx="left">The 2-bedroom plan<small>92 m², as the developer drew it</small></div>`
      + `<div style="position:absolute;left:0;right:0;top:770px;text-align:center;font-size:44px;line-height:1;font-weight:800;color:var(--green)" data-in="3.9" data-fx="down">&darr;</div>`
      + `<div style="position:absolute;left:36px;width:648px;top:826px;height:365px;border-radius:22px;overflow:hidden;background:#101418;box-shadow:0 22px 44px rgba(21,33,58,.26)" data-in="4.1" data-fx="rise" data-d="0.6">${clip('vanta-2bhk-above', 168, 4.4)}</div>`
      + callout({ x: 400, y: 1120, in: 5.6, html: 'Made by makaug<small>from that plan</small>', cls: 'a', w: 260, fx: 'up' })
      + proof('Vanta House: the developer&rsquo;s plan, and makaug&rsquo;s walkthrough of it', 1.0)
  });

  // 4. Inside, room by room, for every home type
  const homes = [['1bhk', '1 bed · 52 m²'], ['2bhk', '2 bed · 92 m²'], ['3bhk', '3 bed · 160 m²']];
  scenes.push({
    dur: 8.6,
    html: head([{ kick: 'Every home type', kickClass: 'g', h: 'Buyers see inside<br>before it is built.' }])
      + `<div style="position:absolute;left:36px;width:648px;top:330px;height:365px;border-radius:22px;overflow:hidden;background:#101418;box-shadow:0 22px 44px rgba(21,33,58,.26)" data-in="0.3" data-fx="rise" data-d="0.6">${clip('vanta-3bhk-walk', 246, 0.35)}</div>`
      + `<div style="position:absolute;left:36px;right:36px;top:724px;display:flex;gap:14px">${homes.map(([key, label], i) => `<div style="flex:1;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 10px 24px rgba(21,33,58,.10);${key === '3bhk' ? 'outline:4px solid var(--green);outline-offset:-4px;' : ''}" data-in="${(1.0 + i * 0.25).toFixed(2)}" data-fx="up"><img src="${V}tour-${key}-poster.jpg" style="width:100%;height:116px;object-fit:cover"><div style="padding:10px 12px 12px;font-size:19px;font-weight:800;letter-spacing:-.01em">${label}${key === '3bhk' ? '<small style="display:block;font-size:14.5px;font-weight:700;color:var(--green);margin-top:2px">&#9654; playing</small>' : '<small style="display:block;font-size:14.5px;font-weight:600;color:var(--soft);margin-top:2px">walkthrough</small>'}</div></div>`).join('')}</div>`
      + `<div class="card" style="position:absolute;left:36px;right:36px;top:948px;padding:22px 24px;display:flex;flex-direction:column;gap:16px" data-in="2.4">
          <div class="tick"><i>✓</i><div>Every room, one after the other<small>kitchen, living room, bedrooms, bathrooms, balcony</small></div></div>
          <div class="tick"><i>✓</i><div>On the project page, for anyone you send it to</div></div>
        </div>`
      + proof('makaug&rsquo;s walkthrough of the 3-bed home at Vanta House', 1.2)
  });

  // 5. Walk around it yourself
  scenes.push({
    dur: 7.4,
    html: head([{ kick: 'And then', h: 'They walk around<br>it themselves.' }])
      + page({
        url: 'makaug.com/off-plan/vanta-house/tour', shot: `${A}tour-start-2bhk.jpg`, top: 322, height: 900,
        keys: [[0, -236], [7.4, -236]],
        rings: [{ x: 66, y: 802, w: 588, h: 104, in: 1.3, out: 3.6 }, { x: 66, y: 918, w: 588, h: 104, in: 3.8 }]
      })
      + callout({ x: 150, y: 1104, in: 1.5, out: 3.6, html: 'The guided tour<small>every room, with its size</small>', cls: 'g', w: 420, fx: 'up' })
      + callout({ x: 150, y: 1104, in: 4.0, html: 'Or walk it yourself<small>drag to look around, tap to walk</small>', w: 420, fx: 'up' })
      + proof('The 3D tour on makaug.com', 0.9)
  });

  // 6. Now for your projects: send it, we make it, you get the link
  const said = convo(0.9, [
    { beat: { kick: 'Now for your projects', h: 'Send your off-plan<br>project on WhatsApp.' } },
    { me: SENT, photo: `${A}example-floor-plan.svg`, cls: 'card', hold: 0.6 },
    { bot: SAVED, think: 0.8, marks: [['Saved — Example Court is with the off-plan desk for review.', 0.4], ['🎬 Floor plan received', 1.5]], hold: 4.8 },
    { beat: { kick: 'We make it', kickClass: 'g', h: 'We make the walkthrough.<br>You get the link.' } },
    { day: 'A few days later', hold: 0.6 },
    { bot: READY, think: 0.6, marks: [['Your walkthrough for Example Court is ready.', 0.4], ['walk around the home themselves', 1.3]], hold: 3.8 }
  ]);
  scenes.push({
    dur: Number((said.end + 0.2).toFixed(1)),
    html: head(said.beats)
      // The assistant's replies are long: a little smaller, in a taller phone, so they fit.
      + `<style>.chat-small .b { font-size: 20.5px; } .chat-small .b small { font-size: 12px; }</style><div class="chat-small">${chat({ clock: 10 * 60 + 14, msgs: said.msgs, type: said.type, top: 282, height: 954 })}</div>`
      + proof('An example project. The assistant&rsquo;s replies are real.', 1.2)
  });

  // 7. Included, and try it
  scenes.push({
    dur: 9.0, dark: true,
    html: `<div style="position:absolute;left:40px;right:40px;top:150px">
        <span class="kick" data-in="0.2">Included in your subscription</span>
        <h2 data-in="0.4" style="font-size:54px;margin-top:18px">Share your off-plan projects. <span class="a">We make the walkthroughs.</span></h2>
        <div style="display:flex;flex-direction:column;gap:14px;margin-top:30px">
          <div class="tick lg" data-in="1.2" style="color:#fff"><i>✓</i><div>A walkthrough video of each home type</div></div>
          <div class="tick lg" data-in="1.5" style="color:#fff"><i>✓</i><div>A 3D walk-around buyers explore themselves</div></div>
          <div class="tick lg" data-in="1.8" style="color:#fff"><i>✓</i><div>Send the project and the floor plan of each home type<small style="color:rgba(255,255,255,.78)">a photo or a PDF of the drawing</small></div></div>
        </div>
        <div style="margin-top:38px;background:rgba(255,255,255,.10);border:1px solid rgba(255,255,255,.18);border-radius:24px;padding:22px 24px" data-in="3.0">
          <div style="color:var(--gold);font-size:15px;font-weight:800;letter-spacing:.16em;text-transform:uppercase">Try it yourself</div>
          <div style="color:#fff;font-size:27px;font-weight:800;letter-spacing:-.015em;margin-top:8px">Walk around a Vanta House home:</div>
          <div style="display:inline-block;margin-top:14px;background:#fff;color:var(--deep);font-size:25px;font-weight:800;letter-spacing:-.01em;padding:12px 18px;border-radius:14px">makaug.com/off-plan/vanta-house/tour</div>
        </div>
      </div>
      <div class="end" style="top:1110px" data-in="4.0"><div class="site">makaug<em>.com</em></div><div class="num">WhatsApp 0780 863 394</div></div>`
  });

  window.FILM = { name: 'Off-plan walkthroughs', label: 'For agents', scenes };
}());
