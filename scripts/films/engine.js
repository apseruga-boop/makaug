/*
 * The makaug films: a timeline you can seek.
 *
 * A film file sets window.FILM = { name, label, scenes: [...] } using the
 * builders on window.K (chat, page, phone, wa ...). Each scene is HTML whose
 * elements say when they come in (data-in, seconds from the start of their
 * scene) and how. renderAt(T) draws the film at second T, so render.js can
 * photograph it frame by frame and the same second always looks the same.
 *
 * A video in a scene is its frames (render.js cuts them from the film file
 * into .build/clips): <img data-seq='{"src":".build/clips/x/%04d.jpg","n":180,"at":1.2}'>
 * shows frame n of the clip at second `at` + n/30, and renderAt waits for the
 * picture before the frame is photographed.
 */
(function () {
  const clamp = (x) => Math.min(1, Math.max(0, x));
  const easeOut = (x) => 1 - Math.pow(1 - clamp(x), 3);
  const easeInOut = (x) => { const v = clamp(x); return v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2; };
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const MARK = '../../assets/icons/makaug-mark.svg';
  const PHONE_INNER = 626; // the phone is 648 wide with an 11px bezel
  const PAGE_SCALE = PHONE_INNER / 720; // page screenshots are 720 wide

  /** WhatsApp's *bold*, _italic_, ```mono``` and links, as HTML. marks: [[phrase, second]] to highlight. */
  function wa(text, marks) {
    let h = esc(text);
    h = h.replace(/```([^`]+)```/g, '<code>$1</code>');
    h = h.replace(/(https?:\/\/[^\s<]+)/g, '<span class="lnk">$1</span>');
    h = h.replace(/(^|[\s(>])\*([^*\n]+)\*(?=$|[\s.,!?:;)<—-])/gm, '$1<b>$2</b>');
    h = h.replace(/(^|[\s(>])_([^_\n]+)_(?=$|[\s.,!?:;)<])/gm, '$1<i>$2</i>');
    for (const [phrase, at] of marks || []) {
      const e = esc(phrase);
      const i = h.indexOf(e);
      if (i >= 0) h = `${h.slice(0, i)}<mark data-hl="${at}">${e}</mark>${h.slice(i + e.length)}`;
    }
    return h.replace(/\n/g, '<br>');
  }

  const attrs = (o) => Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== false)
    .map(([k, v]) => (v === true ? ` ${k}` : ` ${k}="${String(v).replace(/"/g, '&quot;')}"`)).join('');

  /** A phone. o: { top, height, at, body } */
  function phone(o) {
    return `<div class="phone" style="top:${o.top || 300}px;height:${o.height || 908}px"${attrs({ 'data-in': o.at == null ? 0.25 : o.at, 'data-fx': 'rise', 'data-d': 0.75, 'data-out': o.out })}><div class="screen">${o.body}</div></div>`;
  }

  /**
   * A chat with the makaug assistant, in a phone.
   * o.msgs: { me, text, at, photo, photos, cls, marks, tick } | { typing, at, until } | { day, at }
   * o.type: { text, at, send }  what is typed in the box before it is sent
   */
  function chat(o) {
    let minutes = o.clock || 602;
    const rows = (o.msgs || []).map((m) => {
      if (m.day) return `<div class="row day" data-in="${m.at}" data-collapse><div class="in"><div class="pad"><span class="daychip">${esc(m.day)}</span></div></div></div>`;
      if (m.typing) return `<div class="row bot" data-in="${m.at}" data-out="${m.until}" data-collapse><div class="in"><div class="pad"><div class="b typing" data-dots><s></s><s></s><s></s></div></div></div></div>`;
      minutes += m.tick || 0;
      const time = `${Math.floor(minutes / 60) % 24}:${String(minutes % 60).padStart(2, '0')}`;
      let media = '';
      if (m.photos) media = `<span class="pics">${m.photos.map((p) => `<img src="${p}">`).join('')}</span>`;
      else if (m.photo) media = `<span class="pic ${m.cls || ''}"><img src="${m.photo}"></span>`;
      const body = m.html || wa(m.text || '', m.marks);
      return `<div class="row ${m.me ? 'me' : 'bot'}" data-in="${m.at}"${m.out != null ? ` data-out="${m.out}"` : ''} data-collapse><div class="in"><div class="pad"><div class="b"${m.w ? ` style="max-width:${m.w}"` : ''}>${media}${body}<small>${time}${m.me ? '<u>✓✓</u>' : ''}</small></div></div></div></div>`;
    }).join('');
    const typed = (Array.isArray(o.type) ? o.type : (o.type ? [o.type] : []))
      .map((ty) => `<span class="ty" data-type="${ty.at}" data-cps="${ty.cps || 13}" data-clear="${ty.send}">${esc(ty.text)}</span>`).join('');
    const body = `<div class="wa-head"><span class="back">‹</span><div class="av"><img src="${MARK}"></div><div class="who"><b>${esc(o.who || 'makaug.com')}</b><span>${esc(o.sub || 'online')}</span></div><div class="tools"><span>⋮</span></div></div>`
      + `<div class="wa-body"><div class="wa-col">${rows}</div></div>`
      + `<div class="wa-input"><div class="field"><span class="ph">Message</span>${typed}</div><div class="send">➤</div></div>`;
    return phone({ top: o.top, height: o.height, at: o.at, out: o.out, body });
  }

  /**
   * A real page of makaug.com in a phone, moving the way a thumb moves it.
   * o: { url, shot, keys: [[second, y]] in screenshot pixels, rings: [{x,y,w,h,in,out}], pins: [{src, bottom|top, in}] }
   */
  function page(o) {
    const rings = (o.rings || []).map((r) => `<div class="ring" style="left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px"${attrs({ 'data-in': r.in, 'data-out': r.out, 'data-fx': 'pop', 'data-d': 0.4 })}></div>`).join('');
    const pins = (o.pins || []).map((p) => `<img class="pin" src="${p.src}" style="${p.top != null ? `top:${p.top}px` : `bottom:${p.bottom || 0}px`};width:720px;transform-origin:0 ${p.top != null ? '0' : '100%'}"${attrs({ 'data-in': p.in, 'data-fx': 'fade', 'data-d': 0.2, 'data-base': `scale(${PAGE_SCALE})` })}>`).join('');
    const body = `<div class="bar"><div class="url"><i>🔒</i><span>${o.url}</span></div></div>`
      + `<div class="view"><div class="pagewrap" data-prop="pagey" data-keys='${JSON.stringify(o.keys || [[0, 0]])}'><img src="${o.shot}">${rings}</div>${pins}</div>`;
    return phone({ top: o.top, height: o.height, at: o.at, body });
  }

  /** The headline block above a phone: beats that replace each other. beats: [{ kick, kickClass, h, lead, at, out }] */
  function head(beats, top) {
    return `<div class="head stack"${top ? ` style="top:${top}px"` : ''}>${beats.map((b) => `<div${attrs({ 'data-in': b.at == null ? 0.15 : b.at, 'data-out': b.out })}>`
      + `${b.kick ? `<span class="kick ${b.kickClass || ''}">${b.kick}</span>` : ''}<h2>${b.h}</h2>${b.lead ? `<p class="lead">${b.lead}</p>` : ''}</div>`).join('')}</div>`;
  }

  const proof = (text, at) => `<div class="proof"${attrs({ 'data-in': at == null ? 1 : at, 'data-fx': 'fade' })}><span><i>✓</i>${text}</span></div>`;

  /** A dark note pinned over a phone, pointing something out. o: { x, y, w, in, out, html, cls, fx } */
  const callout = (o) => `<div class="callout ${o.cls || ''}" style="left:${o.x}px;top:${o.y}px;${o.w ? `max-width:${o.w}px;` : ''}"${attrs({ 'data-in': o.in, 'data-out': o.out, 'data-fx': o.fx || 'left' })}>${o.html}</div>`;

  /** A word to reply with, and what it does. */
  const word = (w, what, small, at) => `<div class="word" data-in="${at}" data-fx="right"><b>${w}</b><span>${what}${small ? `<small>${small}</small>` : ''}</span></div>`;

  /**
   * A conversation laid out in time, so a film file reads like the chat does.
   * items, in order:
   *   { me: 'text', photo, cls, typed, hold }   what the lister sends (typed: shown being typed first)
   *   { bot: 'text', marks: [[phrase, secondsAfter]], hold, think }   the assistant's reply (think: seconds of "typing")
   *   { day: 'text', hold }                     a chip between messages
   *   { beat: { kick, kickClass, h } }          the headline changes here
   * hold is how long the message is left on screen before the next thing.
   * Returns { msgs, type, beats, end } for chat() and head().
   */
  function convo(start, items) {
    let t = start;
    let said = 0;
    // The clock moves on a minute every few messages, as it would.
    const tick = (item) => { said += 1; return item.tick == null ? (said % 5 === 0 ? 1 : 0) : item.tick; };
    const msgs = []; const type = []; const beats = [];
    for (const item of items) {
      if (item.beat) {
        if (beats.length) beats[beats.length - 1].out = t - 0.15;
        beats.push({ ...item.beat, at: beats.length ? t + 0.1 : 0.15 });
        if (beats.length > 1) t += 0.5;
      } else if (item.day) {
        msgs.push({ day: item.day, at: t });
        t += item.hold == null ? 0.7 : item.hold;
      } else if (item.me !== undefined) {
        if (item.typed) {
          const cps = item.cps || 11;
          const send = t + String(item.me).length / cps + 0.35;
          type.push({ text: item.me, at: t, send, cps });
          t = send;
        }
        msgs.push({ me: true, text: item.me, photo: item.photo, photos: item.photos, cls: item.cls, html: item.html, at: t, tick: tick(item) });
        t += item.hold == null ? 0.7 : item.hold;
      } else if (item.bot !== undefined) {
        const think = item.think == null ? 0.7 : item.think;
        if (think > 0) { msgs.push({ typing: true, at: t, until: t + think }); t += think; }
        msgs.push({ text: item.bot, photo: item.photo, cls: item.cls, at: t, tick: tick(item), marks: (item.marks || []).map(([phrase, after]) => [phrase, t + after]) });
        t += item.hold == null ? 2.2 : item.hold;
      }
    }
    return { msgs, type, beats, end: t };
  }

  window.K = { wa, esc, phone, chat, page, head, proof, attrs, callout, word, convo, MARK, PAGE_SCALE };

  // ---------------------------------------------------------------------------
  // The timeline
  // ---------------------------------------------------------------------------
  let scenes = [];
  let total = 0;
  let chromeDay; let chromeNight;

  function chromeHtml(night) {
    const segs = window.FILM.scenes.map(() => '<div class="seg"><i></i></div>').join('');
    return `<div class="chrome${night ? ' night' : ''}"><div class="segs">${segs}</div>`
      + `<div class="brand"><img src="${MARK}"><span>makaug<em>.com</em></span></div><div class="label">${esc(window.FILM.label || '')}</div></div>`;
  }

  function build() {
    const film = window.FILM;
    document.title = film.name;
    document.body.innerHTML = film.scenes.map((s, i) => `<section class="scene${s.dark ? ' dark' : ''}" data-i="${i}">${s.dark ? `<div class="bg${s.photo ? ' photo' : ''}">${s.photo ? `<img src="${s.photo}"${s.kb ? ` data-kb="${s.kb}"` : ''}>` : ''}</div>` : ''}<div class="sc">${s.html}</div></section>`).join('')
      + chromeHtml(false) + chromeHtml(true);
    [chromeDay, chromeNight] = document.querySelectorAll('.chrome');
    translate();
    let at = 0;
    scenes = film.scenes.map((s, i) => {
      const el = document.querySelector(`.scene[data-i="${i}"]`);
      const scene = { el, sc: el.querySelector('.sc'), bg: el.querySelector('.bg'), dur: s.dur, start: at, dark: Boolean(s.dark), hold: Boolean(s.hold) };
      at += s.dur;
      scene.anim = [...el.querySelectorAll('[data-in]')].map((node) => ({
        node,
        at: Number(node.dataset.in),
        out: node.dataset.out === undefined ? null : Number(node.dataset.out),
        d: Number(node.dataset.d || 0.5),
        fx: node.dataset.fx || 'up',
        collapse: node.hasAttribute('data-collapse'),
        inner: node.hasAttribute('data-collapse') ? node.querySelector('.in') : null,
        count: node.dataset.count === undefined ? null : Number(node.dataset.count),
        suffix: node.dataset.suffix || '',
        prefix: node.dataset.prefix || ''
      }));
      scene.keys = [...el.querySelectorAll('[data-keys]')].map((node) => ({ node, prop: node.dataset.prop || 'y', keys: JSON.parse(node.dataset.keys) }));
      scene.marks = [...el.querySelectorAll('mark[data-hl]')].map((node) => ({ node, at: Number(node.dataset.hl) }));
      scene.dots = [...el.querySelectorAll('[data-dots]')].map((node) => [...node.children]);
      scene.kb = [...el.querySelectorAll('[data-kb]')].map((node) => ({ node, v: node.dataset.kb.split(',').map(Number) }));
      scene.seqs = [...el.querySelectorAll('[data-seq]')].map((node) => {
        const o = JSON.parse(node.dataset.seq);
        const seq = { node, src: o.src, n: Number(o.n) || 1, fps: Number(o.fps) || 30, at: Number(o.at) || 0, cur: 1 };
        node.src = seqFrame(seq, 1);
        return seq;
      });
      scene.typed = [...el.querySelectorAll('[data-type]')].map((node) => ({ node, text: node.textContent, at: Number(node.dataset.type), cps: Number(node.dataset.cps || 13), clear: node.dataset.clear === undefined ? Infinity : Number(node.dataset.clear), field: node.closest('.field') }));
      for (const item of scene.typed) item.node.textContent = '';
      return scene;
    });
    total = at;
    window.DURATION = total;
    window.SCENES = scenes.map((s) => ({ start: s.start, dur: s.dur }));
  }

  /**
   * Another language. Every block of on-screen words (not the chat, which is
   * the assistant's own) is looked up in window.L by its English, and replaced
   * when the language file has it. window.TEXTS lists the English blocks in
   * order, which is what render.js --texts writes out for a translator.
   */
  const translated = [];
  function translate() {
    const words = window.L || {};
    const seen = new Set();
    const blocks = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    for (let el = walker.nextNode(); el; el = walker.nextNode()) {
      if (el.closest('.b, .wa-head, .wa-input, .bar, .pagewrap, .brand, .typed, script')) continue;
      if (el.closest('.phone') && !el.closest('.daychip')) continue;
      if ([...blocks].some((b) => b.contains(el))) continue;
      const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!hasText) continue;
      blocks.push(el);
    }
    window.TEXTS = [];
    for (const el of blocks) {
      const key = el.innerHTML.replace(/\s+/g, ' ').trim();
      if (!seen.has(key)) { seen.add(key); window.TEXTS.push(key); }
      if (!words[key]) continue;
      translated.push({ el, en: el.innerHTML, to: words[key] });
      el.innerHTML = words[key];
    }
  }

  /**
   * Once the font is in, the other language is made to sit where the English did.
   * A headline that no longer fits its two lines is set smaller until it does, and
   * a block that has grown pushes down whatever sat just under it, so nothing
   * ends up on top of anything else. The English film is never touched by this.
   */
  function fit() {
    if (!window.L) return;
    const sceneEls = [...document.querySelectorAll('.scene')];
    const stacks = sceneEls.map((sceneEl) => [...sceneEl.querySelectorAll(':scope > .sc > *')]
      .filter((n) => getComputedStyle(n).position === 'absolute' && !n.classList.contains('proof') && !n.style.bottom));
    const measure = () => stacks.map((items, s) => {
      sceneEls[s].style.display = 'block';
      const boxes = items.map((n) => ({ top: n.offsetTop, bottom: n.offsetTop + n.offsetHeight, left: n.offsetLeft, right: n.offsetLeft + n.offsetWidth }));
      sceneEls[s].style.display = '';
      return boxes;
    });
    // Where everything sat in English: the English words go back in for a moment.
    const plain = translated.filter((t) => !t.el.querySelector('[data-in], [data-hl], [data-type], [data-keys], [data-kb], [data-dots], [data-count]'));
    for (const t of plain) t.el.innerHTML = t.en;
    const english = measure();
    for (const t of plain) t.el.innerHTML = t.to;

    for (const sceneEl of sceneEls) {
      sceneEl.style.display = 'block';
      for (const h of sceneEl.querySelectorAll('.head h2')) {
        let size = 46;
        while (h.scrollHeight > 108 && size > 30) { size -= 2; h.style.fontSize = `${size}px`; }
      }
      for (const h of sceneEl.querySelectorAll('.head .lead')) {
        let size = 25;
        const box = h.parentElement;
        while (box.scrollHeight > 186 && size > 19) { size -= 1; h.style.fontSize = `${size}px`; }
      }
      sceneEl.style.display = '';
    }

    const now = measure();
    stacks.forEach((items, s) => {
      const order = items.map((n, i) => i).sort((a, b) => english[s][a].top - english[s][b].top);
      const shift = items.map(() => 0);
      for (const i of order) {
        const under = english[s][i];
        for (const j of order) {
          const over = english[s][j];
          if (j === i || items[j].classList.contains('head') || over.bottom > under.top) continue;
          if (Math.min(over.right, under.right) - Math.max(over.left, under.left) <= 0) continue;
          const need = now[s][j].bottom + shift[j] + Math.min(under.top - over.bottom, 12) - under.top;
          if (need > shift[i]) shift[i] = need;
        }
        if (shift[i] > 0) items[i].style.top = `${under.top + shift[i]}px`;
      }
    });
  }

  function seqFrame(seq, i) {
    return seq.src.replace('%04d', String(i).padStart(4, '0'));
  }

  function keyed(keys, t) {
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i += 1) {
      if (t <= keys[i][0]) {
        const [t0, v0] = keys[i - 1]; const [t1, v1] = keys[i];
        return v0 + (v1 - v0) * easeInOut((t - t0) / (t1 - t0));
      }
    }
    return keys[keys.length - 1][1];
  }

  window.renderAt = (T) => {
    let idx = scenes.length - 1;
    for (let i = 0; i < scenes.length; i += 1) { if (T < scenes[i].start + scenes[i].dur) { idx = i; break; } }
    const scene = scenes[idx];
    const t = Math.min(Math.max(0, T - scene.start), scene.dur);
    const last = idx === scenes.length - 1;
    const enter = clamp(t / 0.36);
    const exit = last || scene.hold ? 0 : clamp((t - (scene.dur - 0.3)) / 0.3);
    for (const other of scenes) other.el.style.display = other === scene ? 'block' : 'none';
    scene.sc.style.opacity = String(1 - exit);
    scene.sc.style.transform = exit ? `translateY(${-22 * easeInOut(exit)}px)` : '';
    const night = scene.dark ? Math.min(enter, 1 - exit) : 0;
    if (scene.bg) scene.bg.style.opacity = String(night);
    chromeDay.style.opacity = String(1 - night);
    chromeNight.style.opacity = String(night);
    for (const chrome of [chromeDay, chromeNight]) {
      chrome.querySelectorAll('.seg i').forEach((bar, i) => { bar.style.width = i < idx ? '100%' : (i === idx ? `${(t / scene.dur) * 100}%` : '0'); });
    }

    for (const a of scene.anim) {
      let p = easeOut((t - a.at) / a.d);
      let gone = 0;
      if (a.out !== null && t >= a.out) { gone = clamp((t - a.out) / 0.25); p *= 1 - gone; }
      const node = a.node;
      if (a.collapse) {
        const open = easeOut((t - a.at) / 0.26) * (a.out !== null ? 1 - easeOut((t - a.out) / 0.2) : 1);
        node.style.display = open <= 0.001 ? 'none' : 'grid';
        node.style.gridTemplateRows = `${open}fr`;
        a.inner.style.opacity = String(p);
        a.inner.style.transform = `translateY(${(1 - p) * 10}px)`;
      } else {
        node.style.opacity = String(p);
        const q = 1 - p;
        const base = node.dataset.base || '';
        let tr = '';
        if (a.fx === 'up') tr = `translateY(${q * 26}px)`;
        else if (a.fx === 'down') tr = `translateY(${-q * 26}px)`;
        else if (a.fx === 'left') tr = `translateX(${q * 34}px)`;
        else if (a.fx === 'right') tr = `translateX(${-q * 34}px)`;
        else if (a.fx === 'rise') tr = `translateY(${q * 120}px)`;
        else if (a.fx === 'pop') tr = `scale(${0.86 + 0.14 * p})`;
        else if (a.fx === 'stamp') tr = `scale(${1 + q * 0.7})`;
        node.style.transform = `${base} ${tr}`.trim();
        node.style.visibility = p <= 0.001 ? 'hidden' : 'visible';
      }
      if (a.count !== null) {
        const n = Math.round(a.count * easeOut((t - a.at) / 1.4));
        node.textContent = `${a.prefix}${n.toLocaleString('en-US')}${a.suffix}`;
      }
    }
    for (const k of scene.keys) {
      const v = keyed(k.keys, t);
      if (k.prop === 'pagey') k.node.style.transform = `scale(${PAGE_SCALE}) translateY(${v}px)`;
      else if (k.prop === 'y') k.node.style.transform = `translateY(${v}px)`;
      else if (k.prop === 'x') k.node.style.transform = `translateX(${v}px)`;
      else if (k.prop === 'rot') k.node.style.transform = `${k.node.dataset.base || ''} rotate(${v}deg)`;
      else if (k.prop === 'opacity') k.node.style.opacity = String(v);
    }
    for (const m of scene.marks) m.node.style.backgroundSize = `${easeInOut((t - m.at) / 0.55) * 100}% 46%`;
    for (const dots of scene.dots) dots.forEach((dot, i) => { dot.style.opacity = String(0.3 + 0.7 * Math.max(0, Math.sin(2 * Math.PI * (t * 1.5 - i * 0.2)))); });
    for (const k of scene.kb) {
      const u = t / scene.dur; const [s0, x0, y0, s1, x1, y1] = k.v;
      k.node.style.transform = `scale(${s0 + (s1 - s0) * u}) translate(${x0 + (x1 - x0) * u}px, ${y0 + (y1 - y0) * u}px)`;
    }
    const waits = [];
    for (const seq of scene.seqs) {
      const i = Math.max(1, Math.min(seq.n, Math.floor((t - seq.at) * seq.fps) + 1));
      if (i !== seq.cur) {
        seq.cur = i;
        seq.node.src = seqFrame(seq, i);
        if (seq.node.decode) waits.push(seq.node.decode().catch(() => null));
      }
    }
    const fields = new Map();
    for (const ty of scene.typed) {
      const on = t >= ty.at && t < ty.clear;
      const n = on ? Math.min(ty.text.length, Math.floor((t - ty.at) * ty.cps) + 1) : 0;
      ty.node.innerHTML = on ? `${esc(ty.text.slice(0, n))}<i class="caret"></i>` : '';
      ty.node.style.display = on ? 'inline-flex' : 'none';
      if (ty.field) fields.set(ty.field, (fields.get(ty.field) || false) || on);
    }
    for (const [field, on] of fields) {
      field.classList.toggle('on', on);
      const ph = field.querySelector('.ph');
      if (ph) ph.style.display = on ? 'none' : '';
    }
    return waits.length ? Promise.all(waits).then(() => true) : true;
  };

  window.addEventListener('DOMContentLoaded', () => {
    build();
    const wanted = Number(new URLSearchParams(location.search).get('t') || 0);
    window.renderAt(wanted);
    window.READY = Promise.all([document.fonts.ready, ...[...document.images].map((img) => (img.complete ? img.decode().catch(() => null) : new Promise((resolve) => { img.onload = img.onerror = resolve; })))]).then(() => { fit(); window.renderAt(wanted); return true; });
  });
}());
