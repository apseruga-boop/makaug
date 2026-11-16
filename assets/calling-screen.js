/* makaug calling screen: staff "Start calling" work session + King's Calling view.
 *
 * A SEPARATE asset, loaded only where #staff-calling-card or
 * [data-calling-king-root] exist. Both live inside protected pages that the
 * public HTML sanitizer strips, so a public visitor never downloads it.
 *
 * Calls go out from the company phone (tel: link, or dial by hand on a laptop).
 * Nothing here records audio, messages anyone, or touches WhatsApp sending;
 * text templates and the sales kit only open the caller's own apps.
 */
(function () {
  'use strict';
  if (window.__makaugCallingLoaded) return;
  window.__makaugCallingLoaded = true;

  var API = '/api/admin/calling';
  var HEARTBEAT_MS = 30000;
  var boot = null;
  var bootPromise = null;
  var S = null; // the live work session
  var OUTBOX_KEY = 'makaug_calling_outbox';
  var BOOT_KEY = 'makaug_calling_boot';
  var net = { offline: false, syncing: false };

  // ---------------------------------------------------------------- utils --
  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function api(path, opts) {
    opts = opts || {};
    var headers = { Accept: 'application/json' };
    if (opts.body) headers['Content-Type'] = 'application/json';
    if (window.adminApiKey) headers['x-api-key'] = window.adminApiKey;
    return fetch(API + path, { method: opts.method || 'GET', credentials: 'same-origin', headers: headers, body: opts.body ? JSON.stringify(opts.body) : undefined, keepalive: !!opts.keepalive })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (p) {
          if (!res.ok || p.ok === false) { var e = new Error(p.error || 'Something went wrong. Try again.'); e.status = res.status; throw e; }
          return p.data;
        });
      });
  }
  function q(sel, root) { return (root || document).querySelector(sel); }
  function qa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function clock(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    var h = Math.floor(s / 3600); var m = Math.floor((s % 3600) / 60);
    return (h ? h + ':' + pad(m) : m) + ':' + pad(s % 60);
  }
  function hm(ms) { if (ms > 0 && ms < 60000) return Math.round(ms / 1000) + 's'; var m = Math.round((ms || 0) / 60000); return m >= 60 ? Math.floor(m / 60) + 'h ' + pad(m % 60) + 'm' : m + 'm'; }
  function kTime(at) {
    if (!at) return '';
    try { return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Kampala' }).format(new Date(at)); } catch (e) { return ''; }
  }
  function kDayTime(at) {
    if (!at) return '';
    try { return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Kampala' }).format(new Date(at)); } catch (e) { return ''; }
  }
  function partOfDay() {
    var h = 12;
    try { h = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Africa/Kampala' }).format(new Date())) % 24; } catch (e) { h = new Date().getHours(); }
    return h < 12 ? 'morning' : (h < 17 ? 'afternoon' : 'evening');
  }
  function prettyPhone(p) {
    var d = String(p || '').replace(/[^\d+]/g, '');
    var m = d.match(/^\+?256(\d{3})(\d{3})(\d{3})$/);
    return m ? '+256 ' + m[1] + ' ' + m[2] + ' ' + m[3] : d;
  }
  function firstName(n) { return String(n || '').replace(/\(.*?\)/g, '').trim().split(/\s+/)[0] || ''; }
  function isPhone() { return window.matchMedia && window.matchMedia('(pointer: coarse)').matches; }
  function toast(msg, kind) {
    var t = document.createElement('div');
    t.className = 'mkc-toast' + (kind === 'bad' ? ' bad' : '');
    t.textContent = msg;
    (q('#mkc-overlay') || document.body).appendChild(t);
    setTimeout(function () { t.remove(); }, 3600);
  }
  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).then(function () { toast('Copied'); }, function () { toast('Could not copy', 'bad'); });
    var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('Copied'); } catch (e) { toast('Could not copy', 'bad'); }
    ta.remove(); return Promise.resolve();
  }
  function taskOf(key) { return (boot.tasks || []).filter(function (t) { return t.key === key; })[0] || boot.tasks[0]; }
  function personName(key) { var p = (boot.callers || []).filter(function (c) { return c.key === key; })[0]; return p ? p.name : key; }
  function loadBoot(force) {
    if (!bootPromise || force) {
      bootPromise = api('/bootstrap').then(function (d) {
        boot = d;
        try { localStorage.setItem(BOOT_KEY, JSON.stringify(d)); } catch (e) { /* full */ }
        return d;
      }, function (e) {
        bootPromise = null;
        var cached = null;
        try { cached = JSON.parse(localStorage.getItem(BOOT_KEY) || 'null'); } catch (x) { cached = null; }
        if (isNetErr(e) && cached) { boot = cached; setNet(true); return cached; }
        throw e;
      });
    }
    return bootPromise;
  }

  // ------------------------------------------------- language + offline --
  function T(k, vars) {
    var c = (boot && boot.coach) || {};
    var lang = (S && S.lang) || uiLang();
    var t = (c[lang] && c[lang][k]) || (c.en && c.en[k]) || k;
    return String(t).replace(/\{(\w+)\}/g, function (m, x) { return vars && vars[x] != null ? vars[x] : m; });
  }
  function uiLang() { try { return localStorage.getItem('makaug_calling_lang') || 'en'; } catch (e) { return 'en'; } }
  function setLang(l) { try { localStorage.setItem('makaug_calling_lang', l); } catch (e) { /* private */ } if (S) { S.lang = l; renderAll(); } }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 12); }
  function outbox() { try { return JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]'); } catch (e) { return []; } }
  function saveOutbox(list) { try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(list)); } catch (e) { /* full */ } }
  function isNetErr(e) { return !e || !e.status || e.status >= 502; }
  // A call action that must never be lost: sent now, or kept on the phone with
  // its time and an op id and replayed in order when the connection is back.
  function op(path, body) {
    body = Object.assign({ op: uid(), at: new Date().toISOString() }, body);
    if (outbox().length) { var l = outbox(); l.push({ path: path, body: body }); saveOutbox(l); setNet(true); flush(); return Promise.resolve({ queued: true }); }
    return api(path, { method: 'POST', body: body }).catch(function (e) {
      if (!isNetErr(e)) throw e;
      var list = outbox(); list.push({ path: path, body: body }); saveOutbox(list); setNet(true);
      return { queued: true };
    });
  }
  function flush() {
    if (net.syncing) return;
    var list = outbox();
    if (!list.length) { if (net.offline && navigator.onLine !== false) setNet(false); return; }
    net.syncing = true;
    api(list[0].path, { method: 'POST', body: list[0].body }).then(function () { done(); }, function (e) {
      if (isNetErr(e)) { net.syncing = false; setNet(true); return; }
      if (e.status !== 409) toast('A saved call could not be synced: ' + e.message, 'bad');
      done();
    });
    function done() {
      var l = outbox(); l.shift(); saveOutbox(l); net.syncing = false;
      if (l.length) { flush(); return; }
      setNet(false); toast(T('synced'));
      if (S && S.phase === 'offline_wait') next();
      refreshSide();
    }
  }
  function setNet(off) {
    net.offline = off;
    var b = q('[data-mkc-net]'); if (b) b.style.display = off ? '' : 'none';
    var c = q('[data-mkc-netcard]'); if (c) c.style.display = off ? '' : 'none';
  }
  window.addEventListener('online', flush);
  window.addEventListener('offline', function () { setNet(true); });
  setInterval(flush, 15000);

  // ------------------------------------------------------------------ css --
  var CSS = [
    '.mkc-card{border:1px solid #d1fae5;background:linear-gradient(135deg,#ecfdf5,#fff);border-radius:16px;padding:20px}',
    '.mkc-card h3{font-size:20px;font-weight:900;color:#064e3b;margin:0}',
    '.mkc-muted{color:#6b7280;font-size:13px}',
    '.mkc-tasks{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;margin:14px 0}',
    '.mkc-task{border:2px solid #e5e7eb;border-radius:14px;padding:12px;background:#fff;cursor:pointer;text-align:left;font:inherit}',
    '.mkc-task.on{border-color:#047857;box-shadow:0 0 0 3px #a7f3d0}',
    '.mkc-task b{display:block;font-size:15px;color:#111827}.mkc-task span{font-size:12px;color:#6b7280}',
    '.mkc-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}',
    '.mkc-btn{border:0;border-radius:12px;padding:10px 16px;font-weight:800;font-size:14px;cursor:pointer;background:#f3f4f6;color:#111827;text-decoration:none;display:inline-flex;align-items:center;gap:6px;font-family:inherit}',
    '.mkc-btn.go{background:#047857;color:#fff}.mkc-btn.go:hover{background:#065f46}',
    '.mkc-btn.dark{background:#111827;color:#fff}.mkc-btn.red{background:#b91c1c;color:#fff}.mkc-btn.amber{background:#f59e0b;color:#111827}',
    '.mkc-btn.ghost{background:transparent;border:1px solid #d1d5db}.mkc-btn.sm{padding:6px 10px;font-size:12px;border-radius:9px}',
    '.mkc-btn[disabled]{opacity:.45;cursor:not-allowed}',
    '.mkc-select,.mkc-input,.mkc-ta{border:1px solid #d1d5db;border-radius:10px;padding:9px 11px;font:inherit;font-size:14px;background:#fff;color:#111827}',
    '.mkc-ta{width:100%;min-height:64px;box-sizing:border-box}',
    '#mkc-overlay{position:fixed;inset:0;z-index:2147483000;background:#f1f5f9;overflow:auto;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111827}',
    '.mkc-top{position:sticky;top:0;z-index:3;background:#0f172a;color:#fff;padding:10px 16px;display:flex;gap:14px;align-items:center;flex-wrap:wrap}',
    '.mkc-top .who{font-weight:900;font-size:15px}.mkc-top .who small{display:block;font-weight:600;color:#94a3b8;font-size:11px}',
    '.mkc-top select{background:#1e293b;color:#fff;border:1px solid #334155;border-radius:9px;padding:6px 8px;font:inherit;font-size:13px}',
    '.mkc-stat{background:#1e293b;border-radius:10px;padding:5px 10px;text-align:center;min-width:64px}',
    '.mkc-stat b{display:block;font-size:17px;line-height:1.1}.mkc-stat span{font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.04em}',
    '.mkc-stat.hit{background:#047857}.mkc-stat.hit span{color:#d1fae5}',
    '.mkc-top .sp{flex:1}',
    '.mkc-road{min-width:140px}.mkc-road .bar{height:6px;background:#334155;border-radius:9px;overflow:hidden;margin-top:4px}.mkc-road .bar i{display:block;height:100%;background:#34d399}',
    '.mkc-grid{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr) 290px;gap:14px;padding:14px;max-width:1500px;margin:0 auto}',
    '.mkc-panel{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:16px}',
    '.mkc-panel h4{margin:0 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b}',
    '.mkc-num .name{font-size:22px;font-weight:900}.mkc-num .src{font-size:13px;color:#475569;margin-top:2px}',
    '.mkc-reason{display:inline-block;margin-top:6px;background:#fef3c7;color:#92400e;border-radius:8px;padding:3px 8px;font-size:12px;font-weight:700}',
    '.mkc-cb{background:#dbeafe;color:#1e3a8a}',
    '.mkc-phone{font-size:40px;font-weight:900;letter-spacing:.02em;margin:14px 0 4px;font-variant-numeric:tabular-nums}',
    '.mkc-call{display:flex;justify-content:center;width:100%;box-sizing:border-box;font-size:22px;padding:18px;border-radius:16px}',
    '.mkc-timer{font-size:46px;font-weight:900;font-variant-numeric:tabular-nums;color:#047857;text-align:center}',
    '.mkc-hist{margin-top:10px;border-top:1px dashed #e2e8f0;padding-top:8px;font-size:12px;color:#475569}',
    '.mkc-hist div{padding:2px 0}',
    '.mkc-outs{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px;margin:10px 0}',
    '.mkc-out{border:2px solid #e2e8f0;background:#fff;border-radius:12px;padding:10px 8px;font-weight:800;font-size:13px;cursor:pointer;font-family:inherit}',
    '.mkc-out.on{border-color:#047857;background:#ecfdf5;color:#065f46}.mkc-out.close{border-color:#a7f3d0}',
    '.mkc-check{display:flex;gap:8px;align-items:flex-start;padding:5px 0;font-size:14px}.mkc-check input{width:18px;height:18px;margin-top:1px}',
    '.mkc-req{color:#b91c1c;font-weight:900}',
    '.mkc-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}',
    '.mkc-tab{border:1px solid #cbd5e1;background:#fff;border-radius:999px;padding:6px 12px;font-size:12px;font-weight:800;cursor:pointer;font-family:inherit}',
    '.mkc-tab.on{background:#0f172a;color:#fff;border-color:#0f172a}',
    '.mkc-step{border-left:4px solid #10b981;padding:6px 10px;margin:8px 0;background:#f8fafc;border-radius:0 10px 10px 0}',
    '.mkc-step b{display:block;font-size:11px;text-transform:uppercase;color:#047857;letter-spacing:.05em}.mkc-step p{margin:2px 0 0;font-size:15px;line-height:1.45}',
    '.mkc-check-lg{display:inline-block;background:#fde68a;color:#78350f;font-size:11px;font-weight:800;border-radius:6px;padding:2px 6px;margin-left:6px}',
    '.mkc-obj{border:1px solid #e2e8f0;border-radius:10px;padding:8px 10px;margin:6px 0;font-size:13px}.mkc-obj b{display:block}',
    '.mkc-feed div{font-size:13px;padding:6px 0;border-bottom:1px solid #f1f5f9}.mkc-feed .k{font-size:10px;font-weight:900;text-transform:uppercase;color:#64748b;margin-right:4px}',
    '.mkc-nudge{background:#ecfdf5;color:#065f46;border-radius:10px;padding:8px 10px;font-weight:800;font-size:13px;margin-bottom:8px}',
    '.mkc-lb div{display:flex;justify-content:space-between;font-size:13px;padding:4px 0}.mkc-lb .me{font-weight:900;color:#047857}',
    '.mkc-tpl{border:1px solid #e2e8f0;border-radius:12px;padding:10px;margin:8px 0;font-size:13px;line-height:1.45}',
    '.mkc-kit{display:flex;justify-content:space-between;gap:8px;align-items:center;border-bottom:1px solid #f1f5f9;padding:8px 0;font-size:13px}',
    '.mkc-break{position:fixed;inset:0;background:rgba(15,23,42,.92);color:#fff;z-index:5;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;text-align:center}',
    '.mkc-break b{font-size:30px}',
    '.mkc-modal{position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:6;display:flex;align-items:center;justify-content:center;padding:14px}',
    '.mkc-modal>div{background:#fff;border-radius:16px;padding:18px;max-width:560px;width:100%;max-height:90vh;overflow:auto;box-sizing:border-box}',
    '.mkc-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#0f172a;color:#fff;padding:10px 16px;border-radius:12px;z-index:2147483600;font-weight:700;font-size:14px;box-shadow:0 8px 30px rgba(0,0,0,.25)}',
    '.mkc-toast.bad{background:#b91c1c}',
    '.mkc-yay{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:7;pointer-events:none}',
    '.mkc-yay div{background:#047857;color:#fff;padding:22px 30px;border-radius:22px;font-size:26px;font-weight:900;animation:mkcpop 2.4s ease forwards;text-align:center}',
    '@keyframes mkcpop{0%{transform:scale(.6);opacity:0}15%{transform:scale(1.05);opacity:1}80%{opacity:1}100%{transform:scale(1);opacity:0}}',
    '.mkc-err{background:#fee2e2;color:#991b1b;border-radius:10px;padding:8px 10px;font-size:13px;font-weight:700;margin-top:8px}',
    '.mkc-table{width:100%;border-collapse:collapse;font-size:13px}.mkc-table th{text-align:left;font-size:11px;text-transform:uppercase;color:#64748b;padding:6px;border-bottom:1px solid #e2e8f0;white-space:nowrap}',
    '.mkc-table td{padding:7px 6px;border-bottom:1px solid #f1f5f9;vertical-align:top}.mkc-good{color:#047857;font-weight:900}.mkc-bad{color:#b91c1c;font-weight:800}',
    '.mkc-pill{display:inline-block;border-radius:999px;padding:2px 8px;font-size:11px;font-weight:800;background:#f1f5f9;color:#334155;margin:1px}',
    '.mkc-pill.live{background:#dcfce7;color:#166534}.mkc-pill.warn{background:#fef3c7;color:#92400e}.mkc-pill.flag{background:#fee2e2;color:#991b1b}',
    '.mkc-scroll{overflow-x:auto}',
    '.mkc-coach{display:flex;gap:4px;flex-wrap:wrap;margin:10px 0}.mkc-coach span{font-size:11px;font-weight:800;border-radius:999px;padding:3px 8px;background:#f1f5f9;color:#64748b}.mkc-coach .done{background:#dcfce7;color:#166534}.mkc-coach .now{background:#0f172a;color:#fff}',
    '.mkc-coach-q{border:2px solid #a7f3d0;background:#f0fdf4;border-radius:14px;padding:12px;margin-top:8px;text-align:center}',
    '.mkc-step.now{border-left-color:#f59e0b;background:#fffbeb;box-shadow:0 0 0 2px #fde68a}',
    '.mkc-closebox{border:2px solid #34d399;background:#ecfdf5;border-radius:12px;padding:10px;margin:10px 0}',
    '.mkc-must{font-size:12px;font-weight:800;color:#92400e;background:#fef3c7;border-radius:8px;padding:6px 8px;margin:6px 0}',
    '.mkc-offline-card{border:2px dashed #f59e0b;background:#fffbeb;border-radius:14px;padding:14px;margin-top:8px}',
    '.mkc-net{background:#f59e0b;color:#111827;border-radius:999px;padding:4px 10px;font-size:12px;font-weight:900}',
    '.mkc-wa{border-bottom:1px solid #f1f5f9;padding:7px 0;cursor:pointer;font-size:13px}.mkc-wa:hover{background:#f8fafc}.mkc-wa b{display:block}',
    '.mkc-bub{max-width:85%;border-radius:12px;padding:7px 10px;margin:4px 0;font-size:14px;line-height:1.4;white-space:pre-wrap;word-break:break-word}.mkc-bub.in{background:#f1f5f9}.mkc-bub.out{background:#dcfce7;margin-left:auto}',
    '.mkc-tree{border-left:3px solid #cbd5e1;margin-left:8px;padding-left:12px}.mkc-node{border:1px solid #e2e8f0;border-radius:10px;padding:8px 10px;margin:8px 0;font-size:13px;background:#fff}.mkc-node.fu{border-color:#93c5fd;background:#eff6ff}',
    '#staff-body.mkc-caller-only > :not(#staff-calling-card){display:none !important}',
    '.mkc-meet{position:fixed;inset:0;z-index:2147483000;background:#0f172a;color:#fff;overflow:auto;padding:16px;box-sizing:border-box;font-family:Inter,system-ui,sans-serif}',
    '.mkc-meet .mkc-panel{color:#111827}',
    '.mkc-people{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(330px,100%),1fr));gap:10px;margin-top:10px}',
    '.mkc-person{border:1px solid #e2e8f0;border-radius:14px;padding:12px;background:#fff}',
    '.mkc-kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:4px;margin:8px 0;font-size:11px;color:#64748b;text-align:center}.mkc-kpis b{display:block;font-size:16px;color:#111827}.mkc-kpis .mkc-good b{color:#047857}',
    '.mkc-targets{display:grid;grid-template-columns:1fr 90px 90px;gap:6px;align-items:center}.mkc-targets input{width:100%;box-sizing:border-box}',
    '.mkc-spark{display:inline-flex;gap:2px;align-items:flex-end;height:22px}.mkc-spark i{width:5px;background:#10b981;border-radius:2px;display:block}',
    '@media (max-width:1100px){.mkc-grid{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.mkc-side{grid-column:1/-1}}',
    '@media (max-width:720px){.mkc-grid{grid-template-columns:1fr;padding:10px;gap:10px}.mkc-phone{font-size:32px}.mkc-top{padding:8px 10px;gap:8px}.mkc-stat{min-width:52px;padding:4px 7px}.mkc-stat b{font-size:15px}.mkc-top .sp{display:none}.mkc-road{min-width:100%;order:9}.mkc-hide-sm{display:none}}'
  ].join('\n');
  function injectCss() {
    if (q('#mkc-css')) return;
    var st = document.createElement('style'); st.id = 'mkc-css'; st.textContent = CSS; document.head.appendChild(st);
  }

  // ---------------------------------------------------------- staff card --
  var pick = { task: null, person: null };
  function renderStaffCard(host) {
    host.innerHTML = '<div class="mkc-card"><p class="mkc-muted">Loading the calling screen…</p></div>';
    loadBoot().then(function () {
      var body = q('#staff-body');
      if (body) body.classList.toggle('mkc-caller-only', boot.scope === 'caller');
      registerWorker();
      var saved = {};
      try { saved = JSON.parse(localStorage.getItem('makaug_calling_pick') || '{}'); } catch (e) { saved = {}; }
      pick.task = pick.task || saved.task || (boot.tasks[0] && boot.tasks[0].key);
      pick.person = boot.locked_person || pick.person || saved.person || '';
      var tasks = boot.tasks.map(function (t) {
        return '<button type="button" class="mkc-task' + (t.key === pick.task ? ' on' : '') + '" data-mkc-task="' + esc(t.key) + '"><b>' + esc(t.name) + '</b><span>' + esc(t.description) + '</span></button>';
      }).join('');
      var people = boot.locked_person
        ? '<b>' + esc(personName(boot.locked_person)) + '</b>'
        : '<select class="mkc-select" data-mkc-person><option value="">Who is calling?</option>' + boot.callers.map(function (p) { return '<option value="' + esc(p.key) + '"' + (p.key === pick.person ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') + '</select>';
      host.innerHTML = '<div class="mkc-card">'
        + '<div class="mkc-row" style="justify-content:space-between"><div><h3><i class="fas fa-phone"></i> Calling</h3><p class="mkc-muted" style="margin:4px 0 0">Pick a task, then Start calling. The screen goes full-screen and keeps your work time.</p></div>'
        + '<button type="button" class="mkc-btn ghost sm" data-mkc-myreport>My report today</button></div>'
        + '<div class="mkc-tasks">' + tasks + '</div>'
        + '<div class="mkc-row">' + people + '<button type="button" class="mkc-btn go" data-mkc-start style="font-size:16px;padding:12px 22px"><i class="fas fa-play"></i> Start calling</button></div>'
        + '<div data-mkc-carderr></div></div>';
      qa('[data-mkc-task]', host).forEach(function (b) { b.onclick = function () { pick.task = b.getAttribute('data-mkc-task'); renderStaffCard(host); }; });
      var sel = q('[data-mkc-person]', host); if (sel) sel.onchange = function () { pick.person = sel.value; };
      q('[data-mkc-myreport]', host).onclick = function () {
        if (!pick.person) return showErr(host, 'Choose who is calling first.');
        openReport(pick.person);
      };
      q('[data-mkc-start]', host).onclick = function () {
        if (!pick.person) return showErr(host, 'Choose who is calling first.');
        try { localStorage.setItem('makaug_calling_pick', JSON.stringify(pick)); } catch (e) { /* private mode */ }
        startSession(pick.person, pick.task);
      };
    }, function (e) { host.innerHTML = '<div class="mkc-card"><h3>Calling</h3><div class="mkc-err">' + esc(e.message) + '</div></div>'; });
  }
  function registerWorker() {
    if (!('serviceWorker' in navigator) || !/^\/staff-dashboard/.test(location.pathname)) return;
    navigator.serviceWorker.register('/calling-sw.js', { scope: '/staff-dashboard' }).catch(function () { /* optional */ });
  }
  function showErr(host, msg) { var el = q('[data-mkc-carderr]', host) || host; el.innerHTML = '<div class="mkc-err">' + esc(msg) + '</div>'; }

  // ------------------------------------------------------------ session --
  function startSession(person, task) {
    var root = document.documentElement;
    if (root.requestFullscreen && !document.fullscreenElement) root.requestFullscreen().catch(function () { /* optional */ });
    api('/sessions', { method: 'POST', body: { person_key: person, task_key: task, device: isPhone() ? 'phone' : 'laptop' } }).then(function (d) {
      S = {
        id: d.session_id, person: d.person_key, task: d.task_key, started: Date.now(), last: Date.now(),
        totals: { open_ms: 0, focus_ms: 0, away_ms: 0, break_ms: 0, oncall_hidden_ms: 0 },
        events: [], onBreak: false, cur: null, phase: 'loading', wrap: {}, tab: 'script', lang: uiLang(), variant: null, side: 'live', coach: {},
        stats: null, feed: null, lastDone: null, tickT: null, beatT: null, refreshT: null, error: ''
      };
      document.body.style.overflow = 'hidden';
      buildOverlay();
      S.tickT = setInterval(tick, 1000);
      S.beatT = setInterval(beat, HEARTBEAT_MS);
      S.refreshT = setInterval(refreshSide, 60000);
      document.addEventListener('visibilitychange', onVis);
      document.addEventListener('fullscreenchange', onFs);
      window.addEventListener('pagehide', onHide);
      refreshSide();
      next();
    }, function (e) { toast(e.message, 'bad'); if (document.fullscreenElement) document.exitFullscreen().catch(function () {}); });
  }
  function ev(kind, detail) { if (S) S.events.push({ kind: kind, detail: detail || '', at: new Date().toISOString() }); }
  function onVis() { if (!S) return; ev(document.hidden ? 'hidden' : 'visible', S.phase === 'calling' ? 'on a call' : ''); if (!document.hidden) beat(); }
  function onFs() { if (!S) return; ev(document.fullscreenElement ? 'fs_enter' : 'fs_exit'); renderTop(); }
  function onHide() { if (S) beat(true); }
  function tick() {
    if (!S) return;
    var now = Date.now(); var d = Math.min(now - S.last, 5000); S.last = now;
    var t = S.totals; t.open_ms += d;
    var away = document.hidden || (document.hasFocus && !document.hasFocus());
    if (S.onBreak) t.break_ms += d;
    else if (away && S.phase === 'calling') t.oncall_hidden_ms += d;
    else if (away) t.away_ms += d;
    else t.focus_ms += d;
    var wt = q('[data-mkc-worktime]'); if (wt) wt.textContent = clock(t.open_ms);
    var ct = q('[data-mkc-calltimer]'); if (ct && S.callStart) ct.textContent = clock((S.callEnd || now) - S.callStart);
    var bt = q('[data-mkc-breaktimer]'); if (bt && S.breakStart) bt.textContent = clock(now - S.breakStart);
  }
  function beat(keepalive) {
    if (!S) return Promise.resolve();
    var events = S.events.splice(0, S.events.length);
    return api('/sessions/' + S.id + '/heartbeat', { method: 'POST', body: { totals: S.totals, events: events }, keepalive: keepalive === true })
      .catch(function (e) {
        if (e.status === 409) { toast('This screen was closed after a long gap. Start calling again.', 'bad'); teardown(); }
        else if (S) S.events = events.concat(S.events);
      });
  }
  function teardown() {
    if (!S) return;
    clearInterval(S.tickT); clearInterval(S.beatT); clearInterval(S.refreshT);
    document.removeEventListener('visibilitychange', onVis);
    document.removeEventListener('fullscreenchange', onFs);
    window.removeEventListener('pagehide', onHide);
    var o = q('#mkc-overlay'); if (o) o.remove();
    document.body.style.overflow = '';
    if (document.fullscreenElement) document.exitFullscreen().catch(function () {});
    S = null;
    var host = q('#staff-calling-card'); if (host) renderStaffCard(host);
  }
  function exitSession() {
    if (!S) return;
    if (S.phase === 'calling' || S.phase === 'wrapup') { toast('Finish the wrap-up for this call first, then exit.', 'bad'); return; }
    var person = S.person; var id = S.id;
    beat().then(function () { return api('/sessions/' + id + '/end', { method: 'POST', body: {} }); })
      .then(function () { teardown(); openReport(person); }, function (e) { toast(e.message, 'bad'); });
  }
  function toggleBreak() {
    if (!S) return;
    if (S.phase === 'calling') { toast('End the call before taking a break.', 'bad'); return; }
    S.onBreak = !S.onBreak;
    if (S.onBreak) { S.breakStart = Date.now(); ev('break_start'); } else { S.breakStart = null; ev('break_end'); }
    beat(); renderBreak();
  }

  // ------------------------------------------------------------- overlay --
  function buildOverlay() {
    var o = document.createElement('div');
    o.id = 'mkc-overlay';
    o.setAttribute('role', 'dialog'); o.setAttribute('aria-label', 'Calling screen');
    o.innerHTML = '<div class="mkc-top" data-mkc-top></div>'
      + '<div class="mkc-grid"><div class="mkc-panel mkc-num" data-mkc-num></div>'
      + '<div class="mkc-panel" data-mkc-script></div>'
      + '<div class="mkc-side" data-mkc-side></div></div><div data-mkc-break></div>';
    document.body.appendChild(o);
    renderAll();
  }
  function renderAll() { renderTop(); renderNum(); renderScript(); renderSide(); renderBreak(); }
  function renderTop() {
    var el = q('[data-mkc-top]'); if (!el || !S) return;
    var st = S.stats || {}; var tg = st.targets || { calls_per_day: 40, closes_per_day: 2 };
    var road = st.road_to_1000 || { paying_now: 0, goal: 1000, percent: 0 };
    var opts = boot.tasks.map(function (t) { return '<option value="' + esc(t.key) + '"' + (t.key === S.task ? ' selected' : '') + '>' + esc(t.name) + '</option>'; }).join('');
    var fsLink = (document.fullscreenElement || !document.documentElement.requestFullscreen) ? '' : ' · <a href="#" data-mkc-fs style="color:#fbbf24">full screen</a>';
    el.innerHTML = '<div class="who">' + esc(personName(S.person)) + '<small>Work time <span data-mkc-worktime>' + clock(S.totals.open_ms) + '</span>' + fsLink + '</small></div>'
      + '<select data-mkc-switch aria-label="Task">' + opts + '</select>'
      + '<select data-mkc-lang-ui aria-label="Language"><option value="en"' + (S.lang === 'en' ? ' selected' : '') + '>English</option><option value="lg"' + (S.lang === 'lg' ? ' selected' : '') + '>Luganda</option></select>'
      + '<span class="mkc-net" data-mkc-net style="' + (net.offline ? '' : 'display:none') + '">' + esc(T('offline')) + '</span>'
      + '<div class="mkc-stat' + (st.calls_hit ? ' hit' : '') + '"><b>' + (st.calls || 0) + '/' + tg.calls_per_day + '</b><span>' + esc(T('calls')) + '</span></div>'
      + '<div class="mkc-stat' + (st.closes_hit ? ' hit' : '') + '"><b>' + (st.closes || 0) + '/' + tg.closes_per_day + '</b><span>' + esc(T('closes')) + '</span></div>'
      + '<div class="mkc-stat"><b>' + (st.queue_left == null ? '–' : st.queue_left) + '</b><span>' + esc(T('left')) + '</span></div>'
      + '<div class="mkc-stat mkc-hide-sm"><b>' + (st.streak_days || 0) + '</b><span>Day streak</span></div>'
      + '<div class="mkc-road"><div style="font-size:11px;color:#94a3b8">Road to 1000 · <b style="color:#fff">' + road.paying_now + '</b> paying</div><div class="bar"><i style="width:' + Math.max(1, Math.min(100, road.percent || 0)) + '%"></i></div></div>'
      + '<div class="sp"></div>'
      + '<button type="button" class="mkc-btn sm ghost" style="color:#fff;border-color:#475569" data-mkc-add>' + esc(T('add')) + '</button>'
      + '<button type="button" class="mkc-btn sm ghost" style="color:#fff;border-color:#475569" data-mkc-rep>' + esc(T('report')) + '</button>'
      + '<button type="button" class="mkc-btn sm amber" data-mkc-brk>' + esc(T('brk')) + '</button>'
      + '<button type="button" class="mkc-btn sm red" data-mkc-exit>' + esc(T('exit')) + '</button>';
    q('[data-mkc-switch]', el).onchange = function (e) { switchTask(e.target.value); };
    q('[data-mkc-lang-ui]', el).onchange = function (e) { setLang(e.target.value); };
    q('[data-mkc-add]', el).onclick = openAddNumber;
    q('[data-mkc-rep]', el).onclick = function () { openReport(S.person); };
    q('[data-mkc-brk]', el).onclick = toggleBreak;
    q('[data-mkc-exit]', el).onclick = exitSession;
    var fs = q('[data-mkc-fs]', el); if (fs) fs.onclick = function (e) { e.preventDefault(); document.documentElement.requestFullscreen().catch(function () {}); };
  }
  function renderBreak() {
    var el = q('[data-mkc-break]'); if (!el || !S) return;
    el.innerHTML = S.onBreak ? '<div class="mkc-break"><b>On a break</b><div style="font-size:42px;font-weight:900" data-mkc-breaktimer>0:00</div><p class="mkc-muted" style="color:#cbd5e1">Breaks are logged as breaks, not as time away.</p><button type="button" class="mkc-btn go" data-mkc-back style="font-size:18px">Back to calling</button></div>' : '';
    var b = q('[data-mkc-back]', el); if (b) b.onclick = toggleBreak;
  }
  function switchTask(key) {
    if (S.phase === 'calling' || S.phase === 'wrapup') { toast('Finish the wrap-up for this call first.', 'bad'); renderTop(); return; }
    api('/sessions/' + S.id + '/task', { method: 'POST', body: { task_key: key } }).then(function () {
      S.task = key; S.variant = null; S.lastDone = null; next(); refreshSide();
    }, function (e) { toast(e.message, 'bad'); renderTop(); });
  }

  // ----------------------------------------------------------- the number --
  function next() {
    if (!S) return;
    S.phase = 'loading'; S.cur = null; S.wrap = { outcome: '', checklist: {}, note: '', callback: '' }; S.callStart = null; S.callEnd = null; S.error = '';
    S.coach = { answered: null, step: 0, hi: null };
    if (outbox().length) { S.phase = 'offline_wait'; renderNum(); flush(); return; }
    renderNum();
    api('/sessions/' + S.id + '/next', { method: 'POST', body: {} }).then(function (d) {
      if (!S) return;
      S.cur = d && d.attempt ? d : null;
      if (!S.cur) { S.phase = 'empty'; } else {
        var a = d.attempt;
        S.phase = a.status === 'calling' ? (a.ended_at ? 'wrapup' : 'calling') : 'shown';
        if (a.tapped_at) S.callStart = new Date(a.tapped_at).getTime();
        if (a.ended_at) S.callEnd = new Date(a.ended_at).getTime();
        S.variant = d.script_variant || S.variant;
      }
      renderNum(); renderScript();
    }, function (e) { if (S) { S.phase = isNetErr(e) ? 'offline_wait' : 'error'; S.error = e.message; if (S.phase === 'offline_wait') setNet(true); renderNum(); } });
  }
  function renderNum() {
    var el = q('[data-mkc-num]'); if (!el || !S) return;
    var task = taskOf(S.task);
    if (S.phase === 'loading') { el.innerHTML = '<p class="mkc-muted">Finding the next number…</p>'; return; }
    if (S.phase === 'offline_wait') {
      el.innerHTML = lastDoneHtml() + '<div class="mkc-offline-card"><b>' + esc(T('offline')) + '</b><p>Your last call is saved on this phone (' + outbox().length + ' to send). The next number comes as soon as the connection is back. Nothing is lost.</p><button class="mkc-btn" data-mkc-retry>Try now</button></div>';
      q('[data-mkc-retry]', el).onclick = function () { flush(); if (!outbox().length) next(); }; bindLastDone(el); return;
    }
    if (S.phase === 'error') { el.innerHTML = '<div class="mkc-err">' + esc(S.error) + '</div><button class="mkc-btn go" style="margin-top:10px" data-mkc-retry>Try again</button>'; q('[data-mkc-retry]', el).onclick = next; return; }
    if (S.phase === 'empty') {
      el.innerHTML = lastDoneHtml() + '<h4>' + esc(task.name) + '</h4><div style="font-size:20px;font-weight:900">Nobody left to call for this task right now.</div><p class="mkc-muted">Everyone on the list was called today, has a callback booked for later, or asked not to be called. Switch task above, or add a number you found.</p><button class="mkc-btn" data-mkc-retry>Check again</button>';
      q('[data-mkc-retry]', el).onclick = next; bindLastDone(el); return;
    }
    var d = S.cur; var a = d.attempt;
    var hist = (d.history || []).slice(0, 5).map(function (h) { return '<div>' + esc(kDayTime(h.at)) + ' · ' + esc(personName(h.by)) + ' · <b>' + esc(h.what) + '</b>' + (h.note ? ' – ' + esc(h.note) : '') + '</div>'; }).join('');
    var head = lastDoneHtml()
      + '<h4>' + esc(task.name) + (d.resumed ? ' · picked up where you left off' : '') + '</h4>'
      + (S.phase === 'shown' ? '<div class="mkc-muted" style="font-weight:800;color:#047857">' + esc(T('next', { name: a.name || prettyPhone(a.phone) })) + '</div>' : '')
      + '<div class="name">' + esc(a.name || 'Name not known') + '</div>'
      + '<div class="src">' + esc(a.reason && String(a.source_label || '').indexOf(a.reason) >= 0 ? String(a.source_label).replace(' · ' + a.reason, '') : (a.source_label || '')) + '</div>'
      + (a.reason ? '<span class="mkc-reason' + (a.source_kind === 'callback' ? ' mkc-cb' : '') + '">' + esc(a.reason) + '</span>' : '')
      + '<div class="mkc-phone">' + esc(prettyPhone(a.phone)) + '</div>';
    var body = coachBar();
    var steps = scriptSteps(task);
    if (S.phase === 'shown') {
      body += '<a class="mkc-btn go mkc-call" href="' + esc(d.tel) + '" data-mkc-tap><i class="fas fa-phone"></i>&nbsp;' + esc(T('call_next')) + '</a>'
        + '<p class="mkc-muted" style="margin:8px 0 0;text-align:center">' + (isPhone() ? 'Opens the phone app. Come back here when the call ends.' : 'On the laptop: dial this number on the company phone, and press the green button as you dial.') + '</p>'
        + '<div class="mkc-row" style="margin-top:10px;justify-content:center"><button type="button" class="mkc-btn ghost sm" data-mkc-skip>' + esc(T('skip')) + '</button><button type="button" class="mkc-btn ghost sm" data-mkc-tree>History tree</button></div>';
    } else if (S.phase === 'calling') {
      var c = S.coach;
      body += '<div class="mkc-timer" data-mkc-calltimer>' + clock(Date.now() - (S.callStart || Date.now())) + '</div>';
      if (c.answered === null) {
        body += '<div class="mkc-coach-q"><b>' + esc(T('answered')) + '</b><div class="mkc-row" style="justify-content:center;margin-top:8px"><button type="button" class="mkc-btn go" data-mkc-ans="yes">' + esc(T('yes')) + '</button><button type="button" class="mkc-btn" data-mkc-ans="no">' + esc(T('no')) + '</button></div></div>';
      } else if (c.step < steps.length) {
        var st = steps[c.step];
        body += '<div class="mkc-coach-q"><span class="mkc-muted">' + esc(T('script', { n: c.step + 1, total: steps.length })) + '</span><b style="display:block;margin:4px 0;color:#047857">' + esc(st[0]) + '</b><p style="margin:0;font-size:17px;line-height:1.45">' + esc(fillTemplate(st[1], scriptCtx())) + '</p>'
          + '<div class="mkc-row" style="justify-content:center;margin-top:10px">' + (c.step > 0 ? '<button type="button" class="mkc-btn sm" data-mkc-prev>‹</button>' : '') + '<button type="button" class="mkc-btn go" data-mkc-step>' + esc(T('next_step')) + ' ›</button></div></div>';
      } else if (c.hi === null) {
        body += '<div class="mkc-coach-q" style="background:#fef9c3;border-color:#fde047"><b>' + esc(T('hi', { wa: boot.whatsapp_display })) + '</b><p class="mkc-muted" style="margin:4px 0 0">' + esc(T('hi_why')) + '</p>'
          + '<div class="mkc-row" style="justify-content:center;margin-top:10px"><button type="button" class="mkc-btn go" data-mkc-hi="yes">' + esc(T('hi_done')) + '</button><button type="button" class="mkc-btn" data-mkc-hi="no">' + esc(T('hi_no')) + '</button></div></div>';
      }
      body += '<button type="button" class="mkc-btn red mkc-call" style="margin-top:10px" data-mkc-end>' + esc(T('end')) + '</button>';
    } else if (S.phase === 'wrapup') {
      body += '<div class="mkc-timer" style="font-size:28px;color:#334155">Call ' + clock((S.callEnd || Date.now()) - (S.callStart || Date.now())) + '</div><p class="mkc-must">' + esc(T('must')) + '</p>' + wrapHtml(task);
    }
    el.innerHTML = head + body + (hist ? '<div class="mkc-hist"><b>Before</b>' + hist + '</div>' : '<div class="mkc-hist">No earlier calls to this number.</div>');
    bindLastDone(el);
    var tapEl = q('[data-mkc-tap]', el);
    if (tapEl) tapEl.onclick = function () {
      // The tel: link opens the dialler by itself; we only log the time.
      S.callStart = Date.now(); S.phase = 'calling'; S.lastDone = null; renderNum(); renderScript();
      op('/attempts/' + a.id + '/tap', { session_id: S.id }).catch(function (e) { toast(e.message, 'bad'); });
    };
    var endIt = function () {
      S.callEnd = Date.now(); S.phase = 'wrapup'; renderNum(); renderScript();
      op('/attempts/' + a.id + '/end', { session_id: S.id }).catch(function (e) { toast(e.message, 'bad'); });
    };
    var endEl = q('[data-mkc-end]', el); if (endEl) endEl.onclick = endIt;
    qa('[data-mkc-ans]', el).forEach(function (b2) {
      b2.onclick = function () {
        var yes = b2.getAttribute('data-mkc-ans') === 'yes';
        S.coach.answered = yes; S.wrap.checklist.answered = yes;
        if (!yes) { S.wrap.outcome = 'no_answer'; endIt(); return; }
        renderNum(); renderScript();
      };
    });
    var stepEl = q('[data-mkc-step]', el); if (stepEl) stepEl.onclick = function () { S.coach.step += 1; renderNum(); renderScript(); };
    var prevEl = q('[data-mkc-prev]', el); if (prevEl) prevEl.onclick = function () { S.coach.step = Math.max(0, S.coach.step - 1); renderNum(); renderScript(); };
    qa('[data-mkc-hi]', el).forEach(function (b3) { b3.onclick = function () { S.coach.hi = b3.getAttribute('data-mkc-hi') === 'yes'; S.wrap.checklist.wa_hi = S.coach.hi; renderNum(); }; });
    var skipEl = q('[data-mkc-skip]', el);
    if (skipEl) skipEl.onclick = function () { openSkip(a); };
    var treeEl = q('[data-mkc-tree]', el);
    if (treeEl) treeEl.onclick = function () { openTimeline({ attempt_id: a.id }); };
    if (S.phase === 'wrapup') bindWrap(el, task, a);
  }
  // The coach strip: where he is in the call, one step at a time.
  function coachBar() {
    var c = S.coach || {};
    var at = S.phase === 'shown' ? 0 : S.phase === 'calling' ? (c.answered === null ? 1 : (c.hi === null ? 2 : 3)) : 4;
    var labels = [T('dial'), T('answered'), T('script', { n: '', total: '' }).replace(/[:：].*$/, ''), 'WhatsApp "hi"', T('confirm')];
    return '<div class="mkc-coach">' + labels.map(function (l, i) { return '<span class="' + (i < at ? 'done' : i === at ? 'now' : '') + '">' + (i + 1) + '. ' + esc(l) + '</span>'; }).join('') + '</div>';
  }
  function currentVariant(task) {
    var vars = (task.script_variants || []).slice();
    if (S.variant && vars.indexOf(S.variant) < 0 && boot.scripts.variants[S.variant]) vars.unshift(S.variant);
    return { list: vars, key: vars.indexOf(S.variant) >= 0 ? S.variant : vars[0] };
  }
  function scriptSteps(task) {
    var v = currentVariant(task).key;
    var V = boot.scripts.variants[v] || { en: [] };
    return (V[S.lang] || V.en || []).slice(1); // the greeting is said before "did they answer"
  }
  function wrapHtml(task) {
    var w = S.wrap;
    var outs = task.outcomes.map(function (o) { return '<button type="button" class="mkc-out' + (o.close ? ' close' : '') + (w.outcome === o.key ? ' on' : '') + '" data-mkc-out="' + esc(o.key) + '">' + esc(o.label) + '</button>'; }).join('');
    var o = task.outcomes.filter(function (x) { return x.key === w.outcome; })[0];
    var spoke = o && o.spoke;
    var checks = spoke ? '<h4 style="margin-top:12px">Steps (<span class="mkc-req">*</span> must be done)</h4>' + task.checklist.map(function (c) {
      return '<label class="mkc-check"><input type="checkbox" data-mkc-chk="' + esc(c.key) + '"' + (w.checklist[c.key] ? ' checked' : '') + '><span>' + esc(c.label) + (c.required ? ' <span class="mkc-req">*</span>' : '') + '</span></label>';
    }).join('') : '';
    var closes = o && o.close ? '<div class="mkc-closebox"><h4 style="margin:0 0 6px;color:#065f46">' + esc(T('close_title')) + ' <span class="mkc-req">*</span></h4>' + (boot.close_checks[task.key] || []).map(function (c, i) {
      return '<label class="mkc-check"><input type="checkbox" data-mkc-chk="close_' + i + '"' + (w.checklist['close_' + i] ? ' checked' : '') + '><span>' + esc(c) + '</span></label>';
    }).join('') + '</div>' : '';
    var date = o && o.date ? '<h4 style="margin-top:12px">' + (o.date === 'required' ? 'When to call back <span class="mkc-req">*</span>' : 'Follow-up date (recommended)') + '</h4>'
      + '<div class="mkc-row"><input type="datetime-local" class="mkc-input" data-mkc-when value="' + esc(w.callback) + '">'
      + '<button type="button" class="mkc-btn sm" data-mkc-quick="2h">In 2 hours</button><button type="button" class="mkc-btn sm" data-mkc-quick="tom">Tomorrow 10:00</button><button type="button" class="mkc-btn sm" data-mkc-quick="mon">Next Monday</button></div>' : '';
    return '<h4 style="margin-top:12px">' + esc(T('what')) + '</h4><div class="mkc-outs">' + outs + '</div>' + closes + checks + date
      + '<h4 style="margin-top:12px">' + esc(T('note')) + ' <span class="mkc-req">*</span></h4><textarea class="mkc-ta" data-mkc-note placeholder="What did they say? One line is enough.">' + esc(w.note) + '</textarea>'
      + '<div data-mkc-wraperr></div><button type="button" class="mkc-btn go mkc-call" style="margin-top:10px;font-size:18px" data-mkc-save>' + esc(T('save')) + '</button>';
  }
  function localInput(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function bindWrap(el, task, a) {
    var w = S.wrap;
    qa('[data-mkc-out]', el).forEach(function (b) {
      b.onclick = function () {
        saveWrapInputs(el); w.outcome = b.getAttribute('data-mkc-out');
        if (!w.note.trim() && (w.outcome === 'no_answer' || w.outcome === 'wrong_number')) w.note = w.outcome === 'no_answer' ? 'No answer' : 'Wrong number';
        renderNum();
      };
    });
    if (!w.note.trim() && w.outcome === 'no_answer') { w.note = 'No answer'; var nn = q('[data-mkc-note]', el); if (nn) nn.value = w.note; }
    qa('[data-mkc-quick]', el).forEach(function (b) {
      b.onclick = function () {
        var d = new Date(); var k = b.getAttribute('data-mkc-quick');
        if (k === '2h') d = new Date(Date.now() + 2 * 3600000);
        else if (k === 'tom') { d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0); }
        else { d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); d.setHours(10, 0, 0, 0); }
        saveWrapInputs(el); w.callback = localInput(d); renderNum();
      };
    });
    q('[data-mkc-save]', el).onclick = function () {
      saveWrapInputs(el);
      var o = task.outcomes.filter(function (x) { return x.key === w.outcome; })[0];
      var err = !o ? 'Pick what happened.' : (w.note.trim().length < 3 ? 'Write a short note.' : (o.date === 'required' && !w.callback ? 'Pick the date and time to call back.' : ''));
      if (!err && o.spoke) {
        var miss = task.checklist.filter(function (c) { return c.required && !w.checklist[c.key]; });
        if (miss.length) err = 'Tick the required steps: ' + miss.map(function (c) { return c.label; }).join('; ');
      }
      if (!err && o.close) {
        var missClose = (boot.close_checks[task.key] || []).filter(function (_c, i) { return !w.checklist['close_' + i]; });
        if (missClose.length) err = T('close_title') + ': ' + missClose.join('; ');
      }
      var box = q('[data-mkc-wraperr]', el);
      if (err) { box.innerHTML = '<div class="mkc-err">' + esc(err) + '</div>'; return; }
      var btn = q('[data-mkc-save]', el); btn.disabled = true; btn.textContent = 'Saving…';
      var cbIso = w.callback ? new Date(w.callback).toISOString() : null;
      op('/attempts/' + a.id + '/wrapup', { session_id: S.id, outcome: w.outcome, note: w.note, checklist: w.checklist, callback_at: cbIso })
        .then(function (done) {
          S.lastDone = { name: a.name, phone: a.phone, outcome: w.outcome, callback_at: cbIso, task: S.task };
          if (done.queued) toast(T('offline'));
          if (o.close) celebrate();
          next(); refreshSide();
        }, function (e) { btn.disabled = false; btn.textContent = 'Save and call next'; box.innerHTML = '<div class="mkc-err">' + esc(e.message) + '</div>'; });
    };
  }
  function saveWrapInputs(el) {
    var w = S.wrap;
    var n = q('[data-mkc-note]', el); if (n) w.note = n.value;
    var d = q('[data-mkc-when]', el); if (d) w.callback = d.value;
    qa('[data-mkc-chk]', el).forEach(function (c) { w.checklist[c.getAttribute('data-mkc-chk')] = c.checked; });
  }
  function openSkip(a) {
    var reasons = ['Not a Ugandan mobile', 'Already spoke today on another phone', 'Duplicate of someone I know', 'Bad time to call this area'];
    modal('<h3 style="margin:0 0 6px;font-weight:900">Skip this number?</h3><p class="mkc-muted">Skips are logged. Say why.</p>'
      + '<div class="mkc-row" style="margin:8px 0">' + reasons.map(function (r) { return '<button type="button" class="mkc-btn sm" data-r="' + esc(r) + '">' + esc(r) + '</button>'; }).join('') + '</div>'
      + '<input class="mkc-input" style="width:100%;box-sizing:border-box" data-reason placeholder="Reason"><div data-e></div><div class="mkc-row" style="margin-top:10px;justify-content:flex-end"><button class="mkc-btn" data-x>Cancel</button><button class="mkc-btn dark" data-ok>Skip</button></div>', function (m, close) {
      qa('[data-r]', m).forEach(function (b) { b.onclick = function () { q('[data-reason]', m).value = b.getAttribute('data-r'); }; });
      q('[data-x]', m).onclick = close;
      q('[data-ok]', m).onclick = function () {
        var r = q('[data-reason]', m).value.trim();
        if (r.length < 3) { q('[data-e]', m).innerHTML = '<div class="mkc-err">Say why you are skipping.</div>'; return; }
        op('/attempts/' + a.id + '/skip', { session_id: S.id, reason: r }).then(function () { close(); next(); refreshSide(); }, function (e) { q('[data-e]', m).innerHTML = '<div class="mkc-err">' + esc(e.message) + '</div>'; });
      };
    });
  }
  function celebrate() {
    var c = document.createElement('div'); c.className = 'mkc-yay';
    var n = ((S.stats && S.stats.closes) || 0) + 1;
    c.innerHTML = '<div>🎉 Closed!<br><span style="font-size:16px">' + n + ' today. Well done.</span></div>';
    (q('#mkc-overlay') || document.body).appendChild(c); setTimeout(function () { c.remove(); }, 2500);
  }

  // ------------------------------------------- after-call text templates --
  // The caller sends these himself from the company phone. Nothing is sent
  // from here: Copy, or open SMS / WhatsApp with the text filled in.
  function fillTemplate(text, ctx) {
    return String(text || '').replace(/\{(\w+)\}/g, function (m, k) { return ctx[k] != null && ctx[k] !== '' ? ctx[k] : (k === 'name' ? '' : m); }).replace(/\s+,/g, ',');
  }
  function lastCtx(L) { return { name: firstName(L.name), caller: personName(S.person), callback: L.callback_at ? kDayTime(L.callback_at) : '' }; }
  function sendLinks(phone, text) {
    var digits = String(phone || '').replace(/\D/g, '');
    if (!digits) return '';
    return '<a class="mkc-btn sm" href="sms:+' + esc(digits) + '?body=' + encodeURIComponent(text) + '">SMS</a>'
      + '<a class="mkc-btn sm" target="_blank" rel="noopener" href="https://wa.me/' + esc(digits) + '?text=' + encodeURIComponent(text) + '">WhatsApp</a>';
  }
  function lastDoneHtml() {
    var L = S && S.lastDone; if (!L) return '';
    var tpl = boot.templates[L.outcome];
    if (!tpl) return '<div class="mkc-nudge">Saved: ' + esc(String(L.outcome).replace(/_/g, ' ')) + '.</div>';
    var text = fillTemplate(tpl, lastCtx(L));
    return '<div class="mkc-tpl" style="background:#f0fdf4;border-color:#bbf7d0"><b>Saved. Text ' + esc(firstName(L.name) || 'them') + '? (you send it yourself)</b><div style="margin:6px 0">' + esc(text) + '</div>'
      + '<div class="mkc-row"><button type="button" class="mkc-btn sm" data-mkc-tcopy>Copy</button>' + sendLinks(L.phone, text)
      + '<button type="button" class="mkc-btn sm ghost" data-mkc-tclose>Done</button></div></div>';
  }
  function bindLastDone(el) {
    var c = q('[data-mkc-tcopy]', el); if (!c) return;
    var L = S.lastDone;
    c.onclick = function () { copy(fillTemplate(boot.templates[L.outcome], lastCtx(L))); };
    q('[data-mkc-tclose]', el).onclick = function () { S.lastDone = null; renderNum(); };
  }

  // ------------------------------------------------------------- script --
  function scriptCtx() {
    var a = S.cur && S.cur.attempt;
    var hist = S.cur && S.cur.history && S.cur.history[0];
    return {
      greeting: (boot.scripts.greetings[S.lang] || boot.scripts.greetings.en)[partOfDay()],
      name: a ? firstName(a.name) : '', caller: personName(S.person),
      source: a ? (a.source_label || 'online') : '', history: hist ? (hist.what + (hist.note ? ' (' + hist.note + ')' : '')) : 'we have not spoken before',
      reason: a ? (a.reason || '') : '', momo: boot.momo_code
    };
  }
  function renderScript() {
    var el = q('[data-mkc-script]'); if (!el || !S) return;
    var task = taskOf(S.task);
    var tabs = [['script', 'Script'], ['objections', 'Objections'], ['texts', 'Texts'], ['kit', 'Sales kit']];
    var html = '<div class="mkc-tabs">' + tabs.map(function (t) { return '<button type="button" class="mkc-tab' + (S.tab === t[0] ? ' on' : '') + '" data-mkc-tabk="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div>';
    var a = S.cur && S.cur.attempt;
    var ctx = scriptCtx();
    if (S.tab === 'script') {
      var cv = currentVariant(task);
      var vars = cv.list;
      var v = cv.key;
      var hiStep = S.phase === 'calling' && S.coach && S.coach.answered ? S.coach.step + 1 : (S.phase === 'shown' || (S.phase === 'calling' && S.coach && S.coach.answered === null) ? 0 : -1);
      var V = boot.scripts.variants[v] || { en: [], lg: [] };
      html += '<div class="mkc-tabs">' + vars.map(function (k) { return '<button type="button" class="mkc-tab' + (k === v ? ' on' : '') + '" data-mkc-var="' + esc(k) + '">' + esc((boot.scripts.variants[k] || {}).label || k) + '</button>'; }).join('') + '</div>'
        + '<div class="mkc-row" style="margin-bottom:6px"><button type="button" class="mkc-tab' + (S.lang === 'en' ? ' on' : '') + '" data-mkc-lang="en">English</button><button type="button" class="mkc-tab' + (S.lang === 'lg' ? ' on' : '') + '" data-mkc-lang="lg">Luganda</button>'
        + (S.lang === 'lg' ? '<span class="mkc-check-lg">Luganda: ' + esc(boot.scripts.luganda_status) + '</span>' : '') + '</div>'
        + (V[S.lang] || V.en).map(function (s, i) { return '<div class="mkc-step' + (i === hiStep ? ' now' : '') + '"><b>' + (i + 1) + '. ' + esc(s[0]) + '</b><p>' + esc(fillTemplate(s[1], ctx)) + '</p></div>'; }).join('')
        + (task.key === 'payments' || task.key === 'retention' ? '<div class="mkc-nudge" style="margin-top:10px">MoMo merchant code: <span style="font-size:18px">' + esc(boot.momo_code) + '</span></div>' : '');
    } else if (S.tab === 'objections') {
      html += ((boot.scripts.objections || {})[task.key] || []).map(function (o) { return '<div class="mkc-obj"><b>“' + esc(o[0]) + '”</b>' + esc(fillTemplate(o[1], ctx)) + '</div>'; }).join('') || '<p class="mkc-muted">No objections written for this task yet.</p>';
    } else if (S.tab === 'texts') {
      html += '<p class="mkc-muted">' + esc(boot.template_rules) + '</p>' + Object.keys(boot.templates).map(function (k) {
        var t = fillTemplate(boot.templates[k], ctx);
        return '<div class="mkc-tpl"><b>' + esc(k.replace(/_/g, ' ')) + '</b><div style="margin:4px 0 6px">' + esc(t) + '</div><div class="mkc-row"><button type="button" class="mkc-btn sm" data-mkc-copy="' + esc(k) + '">Copy</button>' + (a ? sendLinks(a.phone, t) : '') + '</div></div>';
      }).join('');
    } else {
      html += '<p class="mkc-muted">Send a film or link to yourself on WhatsApp, then forward it from the company phone.</p>' + boot.sales_kit.map(function (k) {
        return '<div class="mkc-kit"><div><b>' + esc(k.title) + '</b><div class="mkc-muted">' + esc(k.lang) + ' · ' + esc(k.kind) + '</div></div><div class="mkc-row" style="flex-wrap:nowrap">'
          + '<a class="mkc-btn sm go" target="_blank" rel="noopener" data-mkc-kit="' + esc(k.key) + '" href="https://wa.me/?text=' + encodeURIComponent(k.title + ' – ' + k.url) + '">Send to me</a>'
          + '<button type="button" class="mkc-btn sm" data-mkc-kitcopy="' + esc(k.key) + '">Copy link</button></div></div>';
      }).join('');
    }
    el.innerHTML = html;
    qa('[data-mkc-tabk]', el).forEach(function (b) { b.onclick = function () { S.tab = b.getAttribute('data-mkc-tabk'); renderScript(); }; });
    qa('[data-mkc-var]', el).forEach(function (b) { b.onclick = function () { S.variant = b.getAttribute('data-mkc-var'); renderScript(); }; });
    qa('[data-mkc-lang]', el).forEach(function (b) { b.onclick = function () { S.lang = b.getAttribute('data-mkc-lang'); renderScript(); }; });
    qa('[data-mkc-copy]', el).forEach(function (b) { b.onclick = function () { copy(fillTemplate(boot.templates[b.getAttribute('data-mkc-copy')], ctx)); }; });
    qa('[data-mkc-kit]', el).forEach(function (b) { b.addEventListener('click', function () { ev('kit_send', b.getAttribute('data-mkc-kit')); }); });
    qa('[data-mkc-kitcopy]', el).forEach(function (b) {
      b.onclick = function () {
        var k = boot.sales_kit.filter(function (x) { return x.key === b.getAttribute('data-mkc-kitcopy'); })[0];
        ev('kit_send', k.key + ' (copied)'); copy(k.url);
      };
    });
  }

  // --------------------------------------------------------------- side --
  function refreshSide() {
    if (!S) return;
    var p = S.person;
    Promise.all([
      api('/stats?person_key=' + encodeURIComponent(p) + '&session_id=' + encodeURIComponent(S.id)).catch(function () { return null; }),
      api('/feed?person_key=' + encodeURIComponent(p)).catch(function () { return null; }),
      api('/whatsapp').catch(function () { return null; }),
      api('/leads').catch(function () { return null; })
    ]).then(function (r) {
      if (!S) return;
      if (r[0]) S.stats = r[0];
      if (r[1]) S.feed = r[1];
      if (r[2]) { notifyNew('wa', r[2].items, 'New WhatsApp'); S.wa = r[2].items; }
      if (r[3]) { notifyNew('leads', r[3].items, 'New lead'); S.leads = r[3].items; }
      checkFive();
      renderTop(); renderSide();
    });
  }
  function renderSide() {
    var el = q('[data-mkc-side]'); if (!el || !S) return;
    var st = S.stats || {}; var feed = S.feed || { items: [] };
    var kinds = { signup: 'Sign-up', payment: 'Paid', reply: 'Reply', callback: 'Callback' };
    var tabs = [['live', 'Live'], ['wa', 'WhatsApp'], ['leads', 'Leads'], ['team', 'Team']];
    var html = '<div class="mkc-panel" style="margin-bottom:12px"><div class="mkc-nudge">' + esc(st.next_milestone || feed.nudge || 'Let\'s go.') + '</div>'
      + (st.callbacks_due_now ? '<div class="mkc-nudge" style="background:#dbeafe;color:#1e3a8a">' + st.callbacks_due_now + ' callback' + (st.callbacks_due_now > 1 ? 's' : '') + ' due now. They come first in the queue.</div>' : '')
      + '<div class="mkc-tabs">' + tabs.map(function (t) { return '<button type="button" class="mkc-tab' + (S.side === t[0] ? ' on' : '') + '" data-mkc-side-tab="' + t[0] + '">' + t[1] + (t[0] === 'wa' && S.wa && S.wa.length ? ' ' + S.wa.length : '') + (t[0] === 'leads' && S.leads && S.leads.length ? ' ' + S.leads.length : '') + '</button>'; }).join('') + '</div>';
    if (S.side === 'live') {
      var items = (feed.items || []).map(function (i) { return '<div><span class="k">' + esc(kinds[i.kind] || i.kind) + '</span>' + esc(i.text) + ' <span class="mkc-muted">' + esc(kTime(i.at)) + '</span></div>'; }).join('');
      html += '<div class="mkc-feed">' + (items || '<div class="mkc-muted">Nothing new in the last day.</div>') + '</div>';
    } else if (S.side === 'wa') {
      html += '<p class="mkc-muted" style="margin:0 0 6px">Read only. Reply from the company phone; copy a suggested reply from the conversation.</p>'
        + ((S.wa || []).map(function (m) { return '<div class="mkc-wa" data-mkc-wa="' + esc(m.ref) + '"><b>' + esc(m.name || m.phone) + ' <span class="mkc-muted" style="font-weight:600">' + esc(m.name ? m.phone : '') + ' · ' + esc(kDayTime(m.at)) + '</span></b>' + esc(m.text) + (m.called ? '<div class="mkc-muted" style="font-size:11px">Called by ' + esc(personName(m.called.by)) + ': ' + esc(String(m.called.outcome).replace(/_/g, ' ')) + '</div>' : '') + '</div>'; }).join('') || '<div class="mkc-muted">No WhatsApp messages in the last 14 days.</div>');
    } else if (S.side === 'leads') {
      html += ((S.leads || []).map(function (l) {
        return '<div class="mkc-wa" style="cursor:default"><b>' + esc(l.name || l.phone) + ' <span class="mkc-muted" style="font-weight:600">' + esc(l.phone) + ' · ' + esc(kDayTime(l.at)) + '</span></b><span class="mkc-muted">' + esc(l.source) + '</span> ' + esc(l.text)
          + (l.called ? '<div class="mkc-muted" style="font-size:11px">Already called by ' + esc(personName(l.called.by)) + ': ' + esc(String(l.called.outcome).replace(/_/g, ' ')) + '</div>' : '')
          + '<div style="margin-top:4px"><button type="button" class="mkc-btn sm go" data-mkc-claim="' + esc(l.kind) + '|' + esc(l.ref) + '">Call now</button></div></div>';
      }).join('') || '<div class="mkc-muted">No new leads in the last 7 days.</div>');
    } else {
      var lb = (st.leaderboard || []).map(function (r, i) { return '<div class="' + (r.person_key === S.person ? 'me' : '') + '"><span>' + (i + 1) + '. ' + esc(r.name) + '</span><span>' + r.calls + ' calls · ' + r.closes + ' closes</span></div>'; }).join('');
      var tasks = Object.keys(st.by_task || {}).map(function (k) { var t = st.by_task[k]; return '<div><span>' + esc(t.name) + '</span><span>' + t.calls + ' · ' + t.closes + ' closed</span></div>'; }).join('');
      html += '<h4>Team today</h4><div class="mkc-lb">' + (lb || '<div class="mkc-muted">No calls yet today.</div>') + '</div><h4 style="margin-top:10px">My calls by task</h4><div class="mkc-lb">' + tasks + '</div>';
    }
    el.innerHTML = html + '</div>';
    qa('[data-mkc-side-tab]', el).forEach(function (b) { b.onclick = function () { S.side = b.getAttribute('data-mkc-side-tab'); renderSide(); }; });
    qa('[data-mkc-wa]', el).forEach(function (b) { b.onclick = function () { openWhatsApp(b.getAttribute('data-mkc-wa')); }; });
    qa('[data-mkc-claim]', el).forEach(function (b) {
      b.onclick = function () {
        var parts = b.getAttribute('data-mkc-claim').split('|');
        claim(parts[0], parts[1]);
      };
    });
  }
  // Small toasts for anything new since the last refresh (never on the first load).
  function notifyNew(kind, items, label) {
    S.seen = S.seen || {};
    var ids = (items || []).map(function (i) { return i.ref + '@' + i.at; });
    if (S.seen[kind]) {
      var fresh = (items || []).filter(function (i) { return S.seen[kind].indexOf(i.ref + '@' + i.at) < 0; });
      if (fresh.length) toast(label + ': ' + (fresh[0].name || fresh[0].phone) + (fresh.length > 1 ? ' (+' + (fresh.length - 1) + ')' : ''));
    }
    S.seen[kind] = ids;
  }
  // 17:00 Kampala: the daily summary comes up once (it is also saved for King).
  function checkFive() {
    if (!S) return;
    var h = 0; try { h = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Africa/Kampala' }).format(new Date())) % 24; } catch (e) { h = 0; }
    // Pop up only when 17:00 passes during a session (the server saves the summary either way).
    if (h < 17) { S.fiveArmed = true; return; }
    if (!S.fiveArmed || S.phase === 'calling' || S.phase === 'wrapup') return;
    var flag = 'makaug_calling_summary_' + S.person + '_' + new Date().toISOString().slice(0, 10);
    try { if (localStorage.getItem(flag)) return; localStorage.setItem(flag, '1'); } catch (e) { return; }
    toast('It is 17:00: here is your day');
    openReport(S.person);
  }
  function claim(kind, ref) {
    if (S.phase === 'calling' || S.phase === 'wrapup') { toast(T('must'), 'bad'); return; }
    api('/sessions/' + S.id + '/claim', { method: 'POST', body: { kind: kind, ref: ref } }).then(function () {
      toast('On your screen now'); next(); refreshSide();
      var o = q('#mkc-overlay'); if (o) o.scrollTo(0, 0);
    }, function (e) { toast(e.message, 'bad'); });
  }
  function openWhatsApp(ref) {
    api('/whatsapp/' + encodeURIComponent(ref) + '?caller=' + encodeURIComponent(personName(S ? S.person : pick.person))).then(function (t) {
      var msgs = t.messages.map(function (m) { return '<div class="mkc-bub ' + (m.direction === 'inbound' ? 'in' : 'out') + '">' + esc(m.text) + '<div class="mkc-muted" style="font-size:10px">' + esc(kDayTime(m.at)) + '</div></div>'; }).join('');
      var sug = t.suggestions.map(function (x, i) { return '<div class="mkc-tpl"><div>' + esc(x) + '</div><button type="button" class="mkc-btn sm" data-sug="' + i + '" style="margin-top:6px">Copy</button></div>'; }).join('');
      modal('<div class="mkc-row" style="justify-content:space-between"><h3 style="margin:0;font-weight:900">' + esc(t.name || t.phone) + ' <span class="mkc-muted">' + esc(t.phone) + '</span></h3><button class="mkc-btn sm" data-x>Close</button></div>'
        + '<p class="mkc-muted">Read only: nothing is sent from here. Reply from the company phone.</p><div style="max-height:45vh;overflow:auto;border:1px solid #e2e8f0;border-radius:12px;padding:8px" data-thread>' + msgs + '</div>'
        + '<h4 style="margin:12px 0 4px">Suggested replies (copy, then send from the phone)</h4>' + sug
        + (S ? '<button type="button" class="mkc-btn go" data-callwa style="margin-top:8px">Call this person now</button>' : ''), function (m, close) {
        q('[data-x]', m).onclick = close;
        var th = q('[data-thread]', m); th.scrollTop = th.scrollHeight;
        qa('[data-sug]', m).forEach(function (b) { b.onclick = function () { copy(t.suggestions[Number(b.getAttribute('data-sug'))]); }; });
        var cw = q('[data-callwa]', m); if (cw) cw.onclick = function () { close(); claim('whatsapp', ref); };
      });
    }, function (e) { toast(e.message, 'bad'); });
  }
  function openTimeline(params) {
    var qs = Object.keys(params).map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');
    api('/timeline?' + qs).then(function (t) {
      var kids = {};
      t.nodes.forEach(function (n) { (kids[n.parent || 'root'] = kids[n.parent || 'root'] || []).push(n); });
      function draw(pid) {
        return (kids[pid] || []).map(function (n) {
          return '<div class="mkc-node' + (n.follow_up_of ? ' fu' : '') + '">' + (n.follow_up_of ? '<div class="mkc-muted" style="font-size:11px">↳ follow-up of the callback' + (n.on_time === false ? ' <span class="mkc-bad">(late)</span>' : '') + '</div>' : '')
            + '<b>' + esc(kDayTime(n.shown_at)) + ' · ' + esc(personName(n.by)) + ' · ' + esc(String(n.outcome).replace(/_/g, ' ')) + '</b>'
            + '<div class="mkc-muted">' + esc(n.task) + ' · shown ' + esc(kTime(n.shown_at)) + (n.tapped_at ? ' · tapped ' + esc(kTime(n.tapped_at)) : ' · not tapped') + (n.talk_s != null ? ' · ' + n.talk_s + ' s' : '') + (n.login ? ' · login ' + esc(n.login) : '') + ' · <i>' + esc(n.proof) + '</i></div>'
            + (n.note ? '<div>' + esc(n.note) + '</div>' : '') + (n.callback_at ? '<div class="mkc-muted">Callback set for ' + esc(kDayTime(n.callback_at)) + '</div>' : '')
            + ((n.flags || []).length ? '<div>' + n.flags.map(function (f) { return '<span class="mkc-pill flag">' + esc(f.replace(/_/g, ' ')) + '</span>'; }).join('') + '</div>' : '')
            + (kids[n.id] ? '<div class="mkc-tree">' + draw(n.id) + '</div>' : '') + '</div>';
        }).join('');
      }
      var wa = (t.whatsapp || []).map(function (w) { return w.n + ' WhatsApp ' + (w.direction === 'inbound' ? 'from them' : 'from us'); }).join(' · ');
      var outreach = (t.outreach || []).map(function (e) { return '<div class="mkc-muted">' + esc(kDayTime(e.at)) + ' · Outreach ' + esc(e.kind) + (e.outcome ? ': ' + esc(String(e.outcome).replace(/_/g, ' ')) : '') + (e.note ? ' – ' + esc(e.note) : '') + '</div>'; }).join('');
      modal('<div class="mkc-row" style="justify-content:space-between"><h3 style="margin:0;font-weight:900">History tree · ' + esc(t.name || '') + ' ' + esc(t.phone_key_masked) + '</h3><button class="mkc-btn sm" data-x>Close</button></div>'
        + '<div class="mkc-nudge" style="margin-top:8px">Pick up here: ' + esc(t.pick_up) + '</div>'
        + (t.decision && (t.decision.decision || t.decision.next_action) ? '<div class="mkc-tpl"><b>King\'s decision:</b> ' + esc(t.decision.decision || '') + (t.decision.next_action ? ' · next: ' + esc(t.decision.next_action) : '') + (t.decision.due ? ' by ' + esc(String(t.decision.due).slice(0, 10)) : '') + '</div>' : '')
        + (wa ? '<div class="mkc-muted">' + esc(wa) + '</div>' : '') + outreach
        + '<div class="mkc-tree" style="margin-top:8px">' + (draw('root') || '<p class="mkc-muted">No calls yet.</p>') + '</div>', function (m, close) { q('[data-x]', m).onclick = close; });
    }, function (e) { toast(e.message, 'bad'); });
  }

  // ------------------------------------------------------- modals/report --
  function modal(html, bind) {
    var m = document.createElement('div'); m.className = 'mkc-modal';
    m.innerHTML = '<div>' + html + '</div>';
    var parent = q('#mkc-overlay');
    if (!parent) m.style.zIndex = '2147483000';
    (parent || document.body).appendChild(m);
    var close = function () { m.remove(); };
    m.addEventListener('click', function (e) { if (e.target === m) close(); });
    bind(m, close);
  }
  function openAddNumber() {
    var field = function (attr, ph, extra) { return '<input class="mkc-input" style="width:100%;box-sizing:border-box;margin:6px 0" ' + attr + ' placeholder="' + esc(ph) + '"' + (extra || '') + '>'; };
    modal('<h3 style="margin:0 0 6px;font-weight:900">Add a number you found</h3><p class="mkc-muted">It goes to the King for a quick check, then into the queue. Numbers we already have are caught.</p>'
      + field('data-n', 'Name (you can change it)') + field('data-p', 'Phone, e.g. 0772 123 456', ' inputmode="tel"') + field('data-t', 'Where you found them (optional)')
      + '<div data-e></div><div class="mkc-row" style="margin-top:10px;justify-content:flex-end"><button class="mkc-btn" data-x>Close</button><button class="mkc-btn go" data-ok>Send for review</button></div>', function (m, close) {
      q('[data-x]', m).onclick = close;
      q('[data-ok]', m).onclick = function () {
        api('/numbers', { method: 'POST', body: { person_key: S ? S.person : pick.person, name: q('[data-n]', m).value, phone: q('[data-p]', m).value, note: q('[data-t]', m).value } }).then(function (d) {
          q('[data-e]', m).innerHTML = d.status === 'duplicate'
            ? '<div class="mkc-err" style="background:#fef3c7;color:#92400e">We already have this number (' + esc(d.duplicate_of || 'on a list') + '). Nobody will call it twice.</div>'
            : '<div class="mkc-nudge">Sent for review. Thank you.</div>';
          q('[data-p]', m).value = ''; q('[data-n]', m).value = '';
        }, function (e) { q('[data-e]', m).innerHTML = '<div class="mkc-err">' + esc(e.message) + '</div>'; });
      };
    });
  }
  function box(big, small, good) { return '<div class="mkc-panel" style="padding:10px;min-width:90px"><b class="' + (good ? 'mkc-good' : '') + '" style="font-size:22px">' + big + '</b><div class="mkc-muted">' + small + '</div></div>'; }
  function reportHtml(r) {
    var w = r.work || {}; var tg = r.targets || {};
    var flags = Object.keys(r.flags || {}).map(function (k) { return '<span class="mkc-pill flag">' + esc((r.flag_labels || {})[k] || k) + ': ' + r.flags[k] + '</span>'; }).join('') || '<span class="mkc-pill live">No flags</span>';
    var outs = Object.keys(r.outcomes || {}).map(function (k) { return '<span class="mkc-pill">' + esc(k.replace(/_/g, ' ')) + ' ' + r.outcomes[k] + '</span>'; }).join('');
    var tasks = Object.keys(r.by_task || {}).map(function (k) { var t = r.by_task[k]; return '<tr><td>' + esc(t.name) + '</td><td>' + t.calls + '</td><td>' + t.connected + '</td><td>' + t.closes + '</td></tr>'; }).join('');
    var calls = (r.calls_list || []).map(function (c) { return '<tr><td>' + esc(kTime(c.at)) + '</td><td>' + esc(c.name) + ' ' + esc(c.phone) + '</td><td>' + esc(String(c.outcome).replace(/_/g, ' ')) + '</td><td>' + (c.talk_s == null ? '–' : c.talk_s + ' s') + '</td><td>' + esc(c.note) + '</td></tr>'; }).join('');
    var due = (r.due_tomorrow || []).map(function (d) { return '<li>' + esc(kTime(d.at)) + ' · ' + esc(d.name) + ' ' + esc(d.phone) + ' (' + esc(String(d.outcome).replace(/_/g, ' ')) + ')</li>'; }).join('');
    return '<h3 style="margin:0;font-weight:900">Daily summary · ' + esc(r.name) + '</h3><p class="mkc-muted">' + esc(r.day) + ' · made automatically from the calling log, saved for King</p>'
      + '<div class="mkc-row" style="margin:10px 0">' + box(r.calls + '/' + tg.calls_per_day, 'calls', r.calls_hit) + box(r.closes + '/' + tg.closes_per_day, 'closes', r.closes_hit) + box(r.connected, 'spoke to') + box(r.payments_chased || 0, 'payments chased') + box(hm((r.talk_s || 0) * 1000), 'talk time') + '</div>'
      + '<p style="font-size:13px">Work time ' + hm(w.open_ms) + ' (focused ' + hm(w.focus_ms) + ', away ' + hm(w.away_ms) + ', breaks ' + hm(w.break_ms) + ' × ' + (w.breaks || 0) + ', left the screen ' + (w.exits || 0) + '×)'
      + (w.first_start ? ' · ' + esc(kTime(w.first_start)) + '–' + esc(w.last_end && !w.open_now ? kTime(w.last_end) : 'now') + ' Kampala' : '') + '</p>'
      + '<p style="font-size:13px">Payments promised ' + (r.payments_promised || 0) + ' · paid or renewed ' + (r.payments_paid || 0) + ' · callbacks booked ' + (r.callbacks_booked || 0) + ' · skipped ' + (r.skipped || 0) + ' · average call ' + (r.avg_talk_s || 0) + ' s</p>'
      + '<div style="margin:6px 0">' + outs + '</div><div style="margin:6px 0">' + flags + '</div>'
      + '<h4 style="margin:10px 0 4px">Due tomorrow (' + esc(r.tomorrow || '') + ')</h4>' + (due ? '<ul style="margin:0;padding-left:18px;font-size:13px">' + due + '</ul>' : '<p class="mkc-muted">Nothing booked for tomorrow yet.</p>')
      + '<table class="mkc-table" style="margin-top:8px"><tr><th>Task</th><th>Calls</th><th>Spoke</th><th>Closed</th></tr>' + tasks + '</table>'
      + (calls ? '<h4 style="margin:10px 0 4px">Every call</h4><div class="mkc-scroll"><table class="mkc-table"><tr><th>Time</th><th>Who</th><th>Outcome</th><th>Talk</th><th>Note</th></tr>' + calls + '</table></div>' : '');
  }
  function openReport(person) {
    api('/summary?person_key=' + encodeURIComponent(person)).then(function (r) {
      modal(reportHtml(r) + '<div class="mkc-row" style="margin-top:12px;justify-content:flex-end"><button class="mkc-btn dark" data-x>Close</button></div>', function (m, close) { q('[data-x]', m).onclick = close; });
    }, function (e) { toast(e.message, 'bad'); });
  }

  // ---------------------------------------------------------------- King --
  var K = { data: null, open: null, nums: null };
  var LIVE_CLASS = { on_call: 'live', wrap_up: 'live', ready: 'live', break: 'warn', away: 'warn', dropped: 'flag' };
  function renderKing(host) {
    host.innerHTML = '<div class="mkc-panel" style="margin-top:16px"><p class="mkc-muted">Loading Calling…</p></div>';
    Promise.all([loadBoot(), api('/performance'), api('/numbers?status=pending'), api('/logins').catch(function () { return []; }), api('/summaries').catch(function () { return []; })]).then(function (r) {
      K.data = r[1]; K.nums = r[2]; K.logins = r[3]; K.sums = r[4]; drawKing(host);
    }, function (e) { host.innerHTML = '<div class="mkc-panel" style="margin-top:16px"><h3 style="margin:0">Calling</h3><div class="mkc-err">' + esc(e.message) + '</div></div>'; });
  }
  function personRow(d, p) {
    var w = p.work || {}; var tg = p.targets || {}; var live = p.live || {};
    var flags = Object.keys(p.flags || {}).map(function (k) { return '<span class="mkc-pill flag" title="' + esc(d.flag_labels[k] || k) + '">' + esc((d.flag_labels[k] || k)) + ': ' + p.flags[k] + '</span>'; }).join('');
    var days = p.last_7_days || [];
    var max = Math.max.apply(null, days.map(function (x) { return x.calls; }).concat([1]));
    var spark = '<span class="mkc-spark" title="Calls, last 7 days">' + days.map(function (x) { return '<i style="height:' + Math.max(2, Math.round(22 * x.calls / max)) + 'px" title="' + esc(x.day) + ': ' + x.calls + '"></i>'; }).join('') + '</span>';
    var tasks = d.tasks.map(function (t) { var x = (p.by_task || {})[t.key] || { calls: 0, closes: 0 }; return '<span class="mkc-pill">' + esc(t.name) + ' ' + x.calls + (x.closes ? ' · ' + x.closes + ' closed' : '') + '</span>'; }).join('');
    return '<div class="mkc-person">'
      + '<div class="mkc-row" style="justify-content:space-between;gap:6px"><div><b style="font-size:16px">' + esc(p.name) + '</b> <span class="mkc-muted" style="font-size:11px">' + esc(String(p.role || '').replace(/_/g, ' ')) + '</span></div>'
      + '<span class="mkc-pill ' + (LIVE_CLASS[live.state] || '') + '">' + esc(live.label || '') + '</span></div>'
      + '<div class="mkc-kpis"><div class="' + (p.calls_hit ? 'mkc-good' : '') + '"><b>' + p.calls + '/' + tg.calls_per_day + '</b>calls</div><div class="' + (p.closes_hit ? 'mkc-good' : '') + '"><b>' + p.closes + '/' + tg.closes_per_day + '</b>closes</div><div><b>' + p.connected + '</b>spoke</div><div><b>' + (p.avg_talk_s || 0) + ' s</b>avg call</div><div><b>' + (p.callbacks_due || 0) + (p.callbacks_overdue ? '<span class="mkc-bad"> +' + p.callbacks_overdue + ' late</span>' : '') + '</b>callbacks</div></div>'
      + '<div style="margin:4px 0">' + tasks + '</div>'
      + '<div class="mkc-muted" style="font-size:12px">Work ' + hm(w.open_ms) + ' · focused ' + hm(w.focus_ms) + ' · away ' + hm(w.away_ms) + ' · ' + (w.exits || 0) + ' exits · ' + (w.breaks || 0) + ' breaks</div>'
      + '<div style="margin:4px 0">' + (flags || '<span class="mkc-pill live">No flags</span>') + '</div>'
      + '<div class="mkc-row" style="justify-content:space-between">' + spark + '<span><button type="button" class="mkc-btn sm" data-k-ev="' + esc(p.person_key) + '">Evidence</button> <button type="button" class="mkc-btn sm ghost" data-k-rep="' + esc(p.person_key) + '">Report</button></span></div></div>';
  }
  function drawKing(host) {
    var d = K.data; var team = d.team || {}; var road = d.road_to_1000 || {};
    var teamTasks = d.tasks.map(function (t) { var x = (team.by_task || {})[t.key] || { calls: 0, closes: 0 }; return '<span class="mkc-pill">' + esc(t.name) + ': ' + x.calls + ' calls, ' + x.closes + ' closed</span>'; }).join('');
    var nums = (K.nums || []).map(function (n) {
      return '<div class="mkc-kit"><div><b>' + esc(n.name || 'No name') + '</b> ' + esc(n.phone) + '<div class="mkc-muted">by ' + esc(personName(n.person_key)) + ' · ' + esc(kDayTime(n.added_at)) + (n.note ? ' · ' + esc(n.note) : '') + '</div></div>'
        + '<div class="mkc-row" style="flex-wrap:nowrap"><button type="button" class="mkc-btn sm go" data-k-ok="' + esc(n.id) + '">Add to queue</button><button type="button" class="mkc-btn sm" data-k-no="' + esc(n.id) + '">Reject</button></div></div>';
    }).join('');
    var cbs = (d.callbacks || []).slice(0, 12).map(function (c) {
      var t = (d.tasks.filter(function (x) { return x.key === c.task_key; })[0] || {}).name || c.task_key;
      return '<tr><td>' + esc(kDayTime(c.at)) + '</td><td>' + esc(c.name || '') + ' ' + esc(c.phone) + '</td><td>' + esc(personName(c.person_key)) + '</td><td>' + esc(t) + '</td><td>' + (c.overdue_days ? '<span class="mkc-bad">' + c.overdue_days + ' day(s) late</span>' : (c.due_now ? '<span class="mkc-good">due now</span>' : '')) + '</td></tr>';
    }).join('');
    var targets = '<div class="mkc-targets"><span></span><span class="mkc-muted">calls</span><span class="mkc-muted">closes</span>' + d.people.map(function (p) {
      return '<b>' + esc(p.name) + '</b><input class="mkc-input" type="number" min="0" max="1000" data-t-calls="' + esc(p.person_key) + '" value="' + p.targets.calls_per_day + '" aria-label="Calls a day for ' + esc(p.name) + '"><input class="mkc-input" type="number" min="0" max="200" data-t-closes="' + esc(p.person_key) + '" value="' + p.targets.closes_per_day + '" aria-label="Closes a day for ' + esc(p.name) + '">';
    }).join('') + '</div>';
    host.innerHTML = '<div class="mkc-panel" style="margin-top:16px">'
      + '<div class="mkc-row" style="justify-content:space-between"><div><h3 style="margin:0;font-size:20px;font-weight:900"><i class="fas fa-phone"></i> Calling · ' + esc(d.day) + '</h3><p class="mkc-muted" style="margin:2px 0 0">Everyone who calls shows here automatically. Times are Kampala. Phones show the last 3 digits.</p></div>'
      + '<div class="mkc-row"><button type="button" class="mkc-btn sm go" data-k-meet>Meeting review (pipeline)</button><span class="mkc-pill">Team: ' + (team.calls || 0) + ' calls · ' + (team.closes || 0) + ' closes · ' + (team.flagged_calls || 0) + ' flagged</span><span class="mkc-pill live">Road to 1000: ' + (road.paying_now || 0) + ' paying</span><button type="button" class="mkc-btn sm" data-k-refresh>Refresh</button></div></div>'
      + '<div style="margin-top:6px">' + teamTasks + '</div>'
      + '<div class="mkc-people">' + d.people.map(function (p) { return personRow(d, p); }).join('') + '</div>'
      + '<div data-k-evbox></div>'
      + '<div class="mkc-grid" style="padding:0;margin-top:14px;grid-template-columns:repeat(auto-fit,minmax(300px,1fr))">'
      + '<div class="mkc-panel"><h4>Numbers staff added (' + (K.nums || []).length + ' to check)</h4>' + (nums || '<p class="mkc-muted">Nothing waiting.</p>') + '</div>'
      + '<div class="mkc-panel"><h4>Callbacks booked</h4>' + (cbs ? '<div class="mkc-scroll"><table class="mkc-table">' + cbs + '</table></div>' : '<p class="mkc-muted">None booked.</p>') + '</div>'
      + '<div class="mkc-panel"><h4>Logins (own login per person)</h4>' + loginsHtml() + '<div data-k-link></div></div>'
      + '<div class="mkc-panel"><h4>Daily summaries saved today</h4>' + ((K.sums || []).map(function (x, i) { var f = x.figures || {}; return '<div class="mkc-kit"><div><b>' + esc(f.name || x.person_key) + '</b><div class="mkc-muted">' + (f.calls || 0) + ' calls · ' + (f.closes || 0) + ' closes · saved ' + esc(kTime(x.made_at)) + (f.saved_because ? ' (' + esc(f.saved_because === '17:00' ? 'at 17:00' : 'session end') + ')' : '') + '</div></div><button type="button" class="mkc-btn sm" data-k-sum="' + i + '">Open</button></div>'; }).join('') || '<p class="mkc-muted">Saved at 17:00 Kampala and when a session ends.</p>') + '</div>'
      + '<div class="mkc-panel"><h4>Daily targets (per person)</h4>' + targets + '<div data-t-err></div><button type="button" class="mkc-btn dark sm" style="margin-top:8px" data-t-save>Save targets</button></div>'
      + '</div></div>';
    q('[data-k-refresh]', host).onclick = function () { renderKing(host); };
    q('[data-k-meet]', host).onclick = openMeeting;
    qa('[data-k-sum]', host).forEach(function (b) { b.onclick = function () { var f = (K.sums[Number(b.getAttribute('data-k-sum'))] || {}).figures || {}; modal(reportHtml(f) + '<div class="mkc-row" style="margin-top:12px;justify-content:flex-end"><button class="mkc-btn dark" data-x>Close</button></div>', function (m, close) { q('[data-x]', m).onclick = close; }); }; });
    qa('[data-k-mklink]', host).forEach(function (b) {
      b.onclick = function () {
        var who = b.getAttribute('data-k-name');
        if (!window.confirm('Make a new one-time setup link for ' + who + '? Any older unused link stops working.')) return;
        api('/logins/' + encodeURIComponent(b.getAttribute('data-k-mklink')) + '/link', { method: 'POST', body: {} }).then(function (d) {
          q('[data-k-link]', host).innerHTML = '<div class="mkc-tpl" style="background:#f0fdf4"><b>Setup link for ' + esc(d.name) + '</b> (login: ' + esc(d.login) + ')<input class="mkc-input" style="width:100%;box-sizing:border-box;margin:6px 0;font-size:12px" readonly value="' + esc(d.url) + '" data-k-url>'
            + '<div class="mkc-row"><button type="button" class="mkc-btn sm go" data-k-copyurl>Copy link</button><span class="mkc-muted">Works once, until ' + esc(kDayTime(d.expires_at)) + ' Kampala. Send it to ' + esc(d.name) + ' privately. It is not shown again.</span></div></div>';
          q('[data-k-copyurl]', host).onclick = function () { copy(d.url); };
        }, function (e) { toast(e.message, 'bad'); });
      };
    });
    qa('[data-k-rep]', host).forEach(function (b) { b.onclick = function () { openReport(b.getAttribute('data-k-rep')); }; });
    qa('[data-k-ev]', host).forEach(function (b) { b.onclick = function () { openEvidence(host, b.getAttribute('data-k-ev')); }; });
    qa('[data-k-ok],[data-k-no]', host).forEach(function (b) {
      b.onclick = function () {
        var ok = b.hasAttribute('data-k-ok');
        api('/numbers/' + (b.getAttribute('data-k-ok') || b.getAttribute('data-k-no')) + '/review', { method: 'POST', body: { decision: ok ? 'approve' : 'reject' } })
          .then(function () { toast(ok ? 'Added to the queue' : 'Rejected'); renderKing(host); }, function (e) { toast(e.message, 'bad'); });
      };
    });
    q('[data-t-save]', host).onclick = function () {
      var list = qa('[data-t-calls]', host).map(function (i) { var k = i.getAttribute('data-t-calls'); return { person_key: k, calls_per_day: i.value, closes_per_day: q('[data-t-closes="' + k + '"]', host).value }; });
      api('/targets', { method: 'PUT', body: { targets: list } }).then(function () { toast('Targets saved'); renderKing(host); }, function (e) { q('[data-t-err]', host).innerHTML = '<div class="mkc-err">' + esc(e.message) + '</div>'; });
    };
    if (K.open) openEvidence(host, K.open, true);
  }
  function loginsHtml() {
    var list = K.logins || [];
    if (!list.length) return '<p class="mkc-muted">No staff logins yet.</p>';
    var state = { none: 'No link yet', waiting: 'Link sent, not used yet', used: 'Link used', expired: 'Link expired', revoked: 'Link replaced' };
    return list.map(function (l) {
      return '<div class="mkc-kit"><div><b>' + esc(l.name) + '</b> <span class="mkc-pill">' + esc(l.scope === 'caller' ? 'calling screen only' : 'staff') + '</span><div class="mkc-muted">' + esc(l.login) + '</div>'
        + '<div class="mkc-muted">' + (l.password_set ? '<span class="mkc-good">Password set</span>' : 'No password yet') + ' · ' + esc(state[l.link.state] || l.link.state) + (l.link.state === 'waiting' ? ' (until ' + esc(kDayTime(l.link.expires_at)) + ')' : '') + (l.last_login_at ? ' · last sign-in ' + esc(kDayTime(l.last_login_at)) : '') + '</div></div>'
        + '<button type="button" class="mkc-btn sm dark" data-k-mklink="' + esc(l.user_id) + '" data-k-name="' + esc(l.name) + '">' + (l.password_set ? 'Reset link' : 'Make setup link') + '</button></div>';
    }).join('');
  }

  // Meeting review: every agent and prospect, one at a time, until they pay or are archived with a reason.
  var M = { items: [], i: 0, overdueOnly: false };
  function openMeeting() {
    api('/pipeline').then(function (d) {
      M.items = d.items; M.i = 0; M.day = d.day;
      var o = document.createElement('div'); o.className = 'mkc-meet'; o.id = 'mkc-meet'; document.body.appendChild(o);
      drawMeeting();
    }, function (e) { toast(e.message, 'bad'); });
  }
  function drawMeeting() {
    var o = q('#mkc-meet'); if (!o) return;
    var list = M.overdueOnly ? M.items.filter(function (x) { return x.overdue; }) : M.items;
    if (M.i >= list.length) M.i = Math.max(0, list.length - 1);
    var it = list[M.i];
    var owners = (boot.callers || []).map(function (c) { return '<option value="' + esc(c.key) + '"' + (it && it.owner === c.key ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('');
    o.innerHTML = '<div style="max-width:820px;margin:0 auto">'
      + '<div class="mkc-row" style="justify-content:space-between"><div><b style="font-size:20px">Meeting review</b><div style="color:#94a3b8;font-size:13px">' + list.length + ' on the list · ' + M.items.filter(function (x) { return x.overdue; }).length + ' overdue · they stay until they pay or you archive them</div></div>'
      + '<div class="mkc-row"><label style="font-size:13px"><input type="checkbox" data-m-over' + (M.overdueOnly ? ' checked' : '') + '> Overdue only</label><button class="mkc-btn sm red" data-m-x>Close</button></div></div>'
      + (it ? '<div class="mkc-panel" style="margin-top:12px">'
        + '<div class="mkc-row" style="justify-content:space-between"><span class="mkc-muted">' + (M.i + 1) + ' of ' + list.length + '</span><span class="mkc-pill' + (it.overdue ? ' flag' : '') + '">' + (it.due ? (it.overdue ? 'Overdue since ' : 'Due ') + esc(it.due) : 'No date') + '</span></div>'
        + '<div style="font-size:24px;font-weight:900;margin-top:4px">' + esc(it.name || 'No name') + ' <span class="mkc-muted" style="font-size:15px">' + esc(it.phone) + '</span></div>'
        + '<div class="mkc-row" style="margin:6px 0"><span class="mkc-pill">' + esc(it.stage) + '</span><span class="mkc-pill warn">' + esc(it.payment) + '</span><span class="mkc-pill">' + it.calls + ' calls</span>' + (it.owner ? '<span class="mkc-pill">Owner: ' + esc(personName(it.owner)) + '</span>' : '') + '</div>'
        + '<div class="mkc-tpl"><b>Last thing they said</b><div>' + (it.last_said ? esc(kDayTime(it.last_said.at)) + ' · ' + esc(personName(it.last_said.by)) + ': ' + esc(it.last_said.text) : 'Nothing recorded yet.') + '</div></div>'
        + '<div class="mkc-tpl"><b>Next action</b><div>' + esc(it.next_action) + (it.due ? ' · by ' + esc(it.due) : '') + '</div>' + (it.decision ? '<div class="mkc-muted">Decision: ' + esc(it.decision) + '</div>' : '') + '</div>'
        + ((it.history || []).length ? '<details><summary class="mkc-muted">Earlier decisions (' + it.history.length + ')</summary>' + it.history.map(function (h) { return '<div class="mkc-muted" style="font-size:12px">' + esc(kDayTime(h.at)) + ' · ' + esc(h.by) + ': ' + esc([h.decision, h.next_action && ('next: ' + h.next_action), h.due && ('by ' + h.due), h.archived && ('archived: ' + h.archived)].filter(Boolean).join(' · ')) + '</div>'; }).join('') + '</details>' : '')
        + '<h4 style="margin-top:12px">Decision / action point</h4><textarea class="mkc-ta" data-m-dec placeholder="What did we decide?"></textarea>'
        + '<div class="mkc-row" style="margin-top:6px"><input class="mkc-input" data-m-act placeholder="Next action, e.g. Ronald calls to collect payment" style="flex:1;min-width:200px"><input class="mkc-input" type="date" data-m-due value="' + esc(it.due && !it.overdue ? it.due : '') + '"><select class="mkc-select" data-m-owner><option value="">Owner</option>' + owners + '</select></div>'
        + '<div data-m-err></div>'
        + '<div class="mkc-row" style="margin-top:10px;justify-content:space-between"><div class="mkc-row"><button class="mkc-btn" data-m-prev>‹ Back</button><button class="mkc-btn ghost" data-m-tree>History tree</button><button class="mkc-btn ghost" data-m-arch>Close out (archive)…</button></div>'
        + '<div class="mkc-row"><button class="mkc-btn" data-m-next>Skip ›</button><button class="mkc-btn go" data-m-save>Save and next ›</button></div></div></div>'
        : '<div class="mkc-panel" style="margin-top:12px">Nobody on the list. Everyone has paid or been archived.</div>')
      + '</div>';
    q('[data-m-x]', o).onclick = function () { o.remove(); var k = q('[data-calling-king-root]'); if (k) renderKing(k); };
    q('[data-m-over]', o).onchange = function (e) { M.overdueOnly = e.target.checked; M.i = 0; drawMeeting(); };
    if (!it) return;
    var err = function (m) { q('[data-m-err]', o).innerHTML = '<div class="mkc-err">' + esc(m) + '</div>'; };
    q('[data-m-prev]', o).onclick = function () { M.i = Math.max(0, M.i - 1); drawMeeting(); };
    q('[data-m-next]', o).onclick = function () { M.i = Math.min(list.length - 1, M.i + 1); drawMeeting(); };
    q('[data-m-tree]', o).onclick = function () { openTimeline({ phone_key: it.phone_key }); };
    q('[data-m-save]', o).onclick = function () {
      var body = { decision: q('[data-m-dec]', o).value.trim() || undefined, next_action: q('[data-m-act]', o).value.trim() || undefined, due: q('[data-m-due]', o).value || undefined, owner: q('[data-m-owner]', o).value || undefined };
      if (!body.decision && !body.next_action && !body.due && !body.owner) { M.i = Math.min(list.length - 1, M.i + 1); drawMeeting(); return; }
      api('/pipeline/' + it.phone_key, { method: 'POST', body: body }).then(function () {
        if (body.decision) it.decision = body.decision;
        if (body.next_action) it.next_action = body.next_action;
        if (body.due) { it.due = body.due; it.overdue = body.due < M.day; }
        if (body.owner) it.owner = body.owner;
        it.history = (it.history || []).concat([{ at: new Date().toISOString(), by: 'you', decision: body.decision, next_action: body.next_action, due: body.due }]);
        toast('Saved'); M.i = Math.min(list.length - 1, M.i + 1); drawMeeting();
      }, function (e) { err(e.message); });
    };
    q('[data-m-arch]', o).onclick = function () {
      var reason = window.prompt('Why close out ' + (it.name || 'this one') + '? (kept in the archive, never deleted)');
      if (reason == null) return;
      api('/pipeline/' + it.phone_key, { method: 'POST', body: { archive: true, reason: reason } }).then(function () {
        M.items = M.items.filter(function (x) { return x.phone_key !== it.phone_key; }); toast('Archived'); drawMeeting();
      }, function (e) { err(e.message); });
    };
  }

  var EV_LABELS = { fs_exit: 'left full screen', fs_enter: 'back to full screen', hidden: 'switched away', visible: 'came back', break_start: 'break', break_end: 'break over', kit_send: 'sent sales kit', task_switch: 'switched task', started: 'started', ended: 'ended' };
  function openEvidence(host, person, keep) {
    var el = q('[data-k-evbox]', host);
    if (!keep && K.open === person && el.innerHTML) { K.open = null; el.innerHTML = ''; return; }
    K.open = person;
    el.innerHTML = '<p class="mkc-muted">Loading evidence…</p>';
    api('/evidence?person_key=' + encodeURIComponent(person)).then(function (e) {
      var sess = (e.sessions || []).map(function (s) { return '<span class="mkc-pill">' + esc(kTime(s.started_at)) + '–' + esc(s.ended_at ? kTime(s.ended_at) : 'now') + ' · ' + esc(s.device || '') + ' · login: ' + esc(s.actor_account || '') + ' · focus ' + hm(s.focus_ms) + ' · away ' + hm(s.away_ms) + ' · ' + s.exit_count + ' exits' + (s.end_reason ? ' · ' + esc(s.end_reason) : '') + '</span>'; }).join(' ');
      var evs = (e.events || []).slice(-40).map(function (x) { return '<span class="mkc-pill' + (x.kind === 'hidden' || x.kind === 'fs_exit' ? ' warn' : '') + '">' + esc(kTime(x.at)) + ' ' + esc(EV_LABELS[x.kind] || x.kind) + (x.detail ? ' (' + esc(x.detail) + ')' : '') + '</span>'; }).join(' ');
      var rowsHtml = (e.attempts || []).map(function (a) {
        var what = a.status === 'skipped' ? 'skipped: ' + (a.skip_reason || '') : String(a.outcome || a.status).replace(/_/g, ' ');
        return '<tr><td>' + esc(kTime(a.shown_at)) + '</td><td>' + esc(a.task_key) + '</td><td>' + esc(a.name || '') + ' ' + esc(a.phone) + '</td><td>' + esc(a.tapped_at ? kTime(a.tapped_at) : '–') + '</td><td>' + (a.talk_s == null ? '–' : a.talk_s + ' s') + '</td><td>' + (a.gap_s == null ? '–' : a.gap_s + ' s') + '</td><td>' + esc(what) + '</td><td>' + esc(a.note || '') + '</td><td>' + (a.flags || []).map(function (f) { return '<span class="mkc-pill flag">' + esc(f.replace(/_/g, ' ')) + '</span>'; }).join('') + '</td><td><button type="button" class="mkc-btn sm" data-k-tree="' + esc(a.id) + '">Tree</button></td></tr>';
      }).join('');
      el.innerHTML = '<div class="mkc-panel" style="margin-top:12px;background:#f8fafc"><div class="mkc-row" style="justify-content:space-between"><h4 style="margin:0">Evidence trail · ' + esc(personName(person)) + ' · ' + esc(e.day || '') + '</h4><button type="button" class="mkc-btn sm ghost" data-k-evx>Close</button></div>'
        + '<p class="mkc-muted">Check these against the company phone\'s call log: every tap has a time.</p>'
        + '<div style="margin:6px 0">' + (sess || '<span class="mkc-muted">No sessions today.</span>') + '</div><div style="margin:6px 0">' + evs + '</div>'
        + '<div class="mkc-scroll"><table class="mkc-table"><tr><th>Shown</th><th>Task</th><th>Who</th><th>Tapped</th><th>Talk</th><th>Gap</th><th>Outcome</th><th>Note</th><th>Flags</th></tr>' + (rowsHtml || '<tr><td colspan="9" class="mkc-muted">No calls.</td></tr>') + '</table></div></div>';
      q('[data-k-evx]', el).onclick = function () { K.open = null; el.innerHTML = ''; };
      qa('[data-k-tree]', el).forEach(function (b) { b.onclick = function () { openTimeline({ attempt_id: b.getAttribute('data-k-tree') }); }; });
    }, function (err) { el.innerHTML = '<div class="mkc-err">' + esc(err.message) + '</div>'; });
  }

  // ---------------------------------------------------------------- mount --
  var mounted = typeof WeakSet === 'function' ? new WeakSet() : { has: function (el) { return el.__mkc; }, add: function (el) { el.__mkc = true; } };
  function visible(el) { return !!(el && el.offsetParent !== null); }
  function scan() {
    var staff = q('#staff-calling-card');
    if (staff && visible(staff) && !mounted.has(staff)) { mounted.add(staff); renderStaffCard(staff); }
    var king = q('[data-calling-king-root]');
    if (king && visible(king) && !mounted.has(king)) { mounted.add(king); renderKing(king); }
  }
  injectCss();
  scan();
  // The SPA shows pages and tabs by toggling classes; look again when it does.
  var pending = false;
  new MutationObserver(function () {
    if (pending) return;
    pending = true;
    setTimeout(function () { pending = false; scan(); }, 250);
  }).observe(document.body, { attributes: true, attributeFilter: ['class'], subtree: true });
  window.makaugCalling = { rescan: scan, refreshKing: function () { var k = q('[data-calling-king-root]'); if (k) renderKing(k); } };
})();
