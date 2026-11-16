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
          if (!res.ok || p.ok === false) { var e = new Error(p.error || 'Something went wrong. Try again.'); e.status = res.status; e.code = p.code || ''; throw e; }
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
    '.mkc-in{background:#2563eb;color:#fff;font-size:17px;font-weight:900;padding:10px 18px;border-radius:12px;box-shadow:0 0 0 3px #bfdbfe}.mkc-pill.in{background:#dbeafe;color:#1e40af}.mkc-hit{border:1px solid #e2e8f0;border-radius:10px;padding:6px 8px;margin:4px 0;cursor:pointer}.mkc-hit mark{background:#fef08a}',
    '.mkc-learn{border:1px solid #e2e8f0;border-radius:10px;padding:6px 10px;margin:6px 0;font-size:13px;line-height:1.45}.mkc-learn p,.mkc-learn ul,.mkc-learn ol{margin:4px 0;padding-left:16px}.mkc-learn summary{cursor:pointer}.mkc-learn a{color:#047857;font-weight:700}.mkc-lg{background:#fefce8;border-radius:8px;padding:4px 8px;margin:4px 0;font-size:13px}',
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
    '.mkc-work{display:flex;align-items:center;gap:8px;border:0;border-radius:999px;padding:6px 14px 6px 6px;background:#7f1d1d;color:#fff;cursor:pointer;font:inherit}.mkc-work .knob{width:30px;height:30px;border-radius:50%;background:#fca5a5;box-shadow:0 0 0 3px rgba(255,255,255,.2)}.mkc-work.on{background:#047857}.mkc-work.on .knob{background:#6ee7b7}.mkc-work b{font-size:15px;letter-spacing:.04em}.mkc-work small{display:block;font-size:11px;opacity:.85}.mkc-downbar{grid-column:1/-1;background:#fee2e2;border:2px solid #fca5a5;color:#7f1d1d;border-radius:14px;padding:12px 14px;font-size:16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}.mkc-tl{position:relative;height:22px;background:#f1f5f9;border-radius:6px;overflow:hidden;margin:4px 0}.mkc-tl i{position:absolute;top:0;bottom:0}.mkc-tl .work{background:#10b981}.mkc-tl .break{background:#f59e0b}.mkc-tl .down{background:#ef4444}.mkc-tl .login{background:#0f172a;width:2px!important}.mkc-pay{border:2px solid #e2e8f0;border-radius:14px;padding:8px 10px;margin:8px 0;font-size:14px}.mkc-tpl{border:1px solid #e2e8f0;border-radius:12px;padding:10px;margin:8px 0;font-size:13px;line-height:1.45}',
    '.mkc-kit{display:flex;justify-content:space-between;gap:8px;align-items:center;border-bottom:1px solid #f1f5f9;padding:8px 0;font-size:13px}',
    '.mkc-break{position:fixed;inset:0;background:rgba(15,23,42,.92);color:#fff;z-index:5;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;text-align:center}',
    '.mkc-break b{font-size:30px}',
    '.mkc-modal{position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:6;display:flex;align-items:center;justify-content:center;padding:14px}',
    '.mkc-modal.wide>div{max-width:1280px;height:92vh;max-height:92vh;display:flex;flex-direction:column}.mkc-livegrid{display:grid;grid-template-columns:340px 1fr;gap:12px;flex:1;min-height:0}.mkc-livegrid>div{min-height:0;overflow:auto}.mkc-lc{display:grid;grid-template-columns:1fr 1fr;gap:6px}.mkc-lc div{background:#f1f5f9;border-radius:10px;padding:8px}.mkc-lc b{display:block;font-size:22px}.mkc-lc span{font-size:11px;color:#64748b}.mkc-frame{width:100%;height:100%;border:1px solid #e2e8f0;border-radius:10px;background:#fff}.mkc-lv{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px}.mkc-lv .c{border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;cursor:pointer}.mkc-lv img{width:100%;height:110px;object-fit:cover;background:#e2e8f0;display:block}.mkc-lv .c div{padding:6px 8px;font-size:12px}@media(max-width:800px){.mkc-livegrid{grid-template-columns:1fr}}',
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
    '.mkc-modes{display:flex;gap:6px;flex-wrap:wrap}.mkc-mode{border:2px solid #334155;background:#1e293b;color:#e2e8f0;border-radius:12px;padding:6px 12px;font:inherit;font-weight:900;font-size:14px;cursor:pointer;display:flex;gap:8px;align-items:center}',
    '.mkc-mode.on{background:#10b981;border-color:#34d399;color:#04241a}.mkc-mode i{font-style:normal;background:#0f172a;color:#fbbf24;border-radius:999px;padding:1px 8px;font-size:12px}.mkc-mode.on i{background:#064e3b;color:#fff}',
    '.mkc-dash{display:flex;gap:10px;align-items:stretch;padding:10px 14px 0;max-width:1500px;margin:0 auto;overflow-x:auto}',
    '.mkc-dcard{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:8px 12px;display:flex;gap:10px;align-items:center;min-width:max-content}',
    '.mkc-dcard b{font-size:20px;font-weight:900;display:block;line-height:1.1}.mkc-dcard span{font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.04em}',
    '.mkc-ring{position:relative;width:62px;height:62px}.mkc-ring svg{transform:rotate(-90deg)}.mkc-ring em{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-style:normal;font-weight:900;font-size:14px}',
    '.mkc-money b{color:#047857}.mkc-badges{display:flex;gap:4px;flex-wrap:wrap;max-width:260px}.mkc-badge{font-size:11px;font-weight:800;border-radius:999px;padding:2px 8px;background:#fef3c7;color:#92400e}.mkc-badge.off{background:#f1f5f9;color:#94a3b8}',
    '.mkc-hours{display:flex;gap:3px;align-items:flex-end;height:40px}.mkc-hours i{width:9px;background:#10b981;border-radius:3px 3px 0 0;display:block;position:relative}.mkc-hours i.now{background:#f59e0b}',
    '.mkc-ctx{background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:10px 12px;margin:8px 0}.mkc-ctx .tag{display:inline-block;font-weight:900;font-size:12px;border-radius:999px;padding:3px 10px;background:#1e293b;color:#fff;margin:0 4px 4px 0}',
    '.mkc-ctx .tag.hot{background:#b91c1c}.mkc-ctx .tag.warm{background:#d97706}.mkc-ctx .tag.hello{background:#047857}.mkc-ctx .tag.nohello{background:#e2e8f0;color:#475569}',
    '.mkc-ctx ol{margin:6px 0 0;padding-left:18px;max-height:180px;overflow:auto;font-size:13px}.mkc-ctx li{margin-bottom:4px}',
    '.mkc-calling{font-size:22px;font-weight:900;color:#047857;text-align:center;margin-top:6px}.mkc-calling .dot{display:inline-block;width:10px;height:10px;border-radius:50%;background:#ef4444;margin-right:6px;animation:mkcblink 1s infinite}',
    '@keyframes mkcblink{50%{opacity:.2}}',
    '.mkc-stages{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px}.mkc-stage{border:1px solid #cbd5e1;background:#fff;border-radius:999px;padding:4px 10px;font:inherit;font-size:12px;font-weight:800;cursor:pointer;color:#475569}.mkc-stage.on{background:#0f172a;color:#fff;border-color:#0f172a}.mkc-stage.auto{box-shadow:0 0 0 2px #10b981}',
    '.mkc-outs.big{grid-template-columns:1fr 1fr}.mkc-outs.big .mkc-out{min-height:58px;font-size:17px}',
    '.mkc-chips{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0}.mkc-chip{border:1px solid #cbd5e1;background:#fff;border-radius:999px;padding:6px 12px;font:inherit;font-size:13px;font-weight:700;cursor:pointer}.mkc-chip.on{background:#dcfce7;border-color:#22c55e;color:#065f46}',
    '.mkc-hello{display:flex;align-items:center;gap:10px;width:100%;border:2px dashed #f59e0b;background:#fffbeb;border-radius:12px;padding:10px 12px;font:inherit;font-weight:900;font-size:15px;cursor:pointer;margin-top:10px;text-align:left}.mkc-hello.on{border-style:solid;border-color:#10b981;background:#ecfdf5;color:#065f46}',
    '.mkc-rec{border:2px solid #ef4444;color:#b91c1c;background:#fff}.mkc-rec.on{background:#ef4444;color:#fff}',
    '.mkc-confetti{position:fixed;inset:0;pointer-events:none;z-index:8;overflow:hidden}.mkc-confetti i{position:absolute;top:-12px;width:9px;height:14px;border-radius:2px;animation:mkcfall 2.2s ease-in forwards}',
    '@keyframes mkcfall{to{transform:translateY(105vh) rotate(540deg);opacity:.8}}',
    '.mkc-skipgrid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:10px 0}.mkc-skipgrid button{min-height:52px;font-size:15px}',
    '@media (max-width:720px){.mkc-top{position:static}.mkc-mode{font-size:12px;padding:5px 8px}.mkc-dash{padding:8px 10px 0;gap:8px}.mkc-dcard{padding:6px 10px}.mkc-badges{max-width:200px}}',
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
      S.lastInput = Date.now();
      ev('screen_open', isPhone() ? 'phone' : 'laptop');
      S.work = true; S.workSince = Date.now(); ev('work_on', 'started calling');
      ['mousemove', 'keydown', 'touchstart', 'click', 'scroll'].forEach(function (k) { document.addEventListener(k, onInput, true); });
      q('#mkc-overlay').addEventListener('click', onAction, true);
      refreshSide();
      openPlan(true);
      next();
    }, function (e) { toast(e.message, 'bad'); if (document.fullscreenElement) document.exitFullscreen().catch(function () {}); });
  }
  function ev(kind, detail) { if (S) S.events.push({ kind: kind, detail: detail || '', at: new Date().toISOString() }); }
  function onVis() { if (!S) return; ev(document.hidden ? 'hidden' : 'visible', S.phase === 'calling' ? 'on a call' : ''); if (!document.hidden) { beat(); refreshPay(); } }
  function onFs() {
    if (!S) return; ev(document.fullscreenElement ? 'fs_enter' : 'fs_exit');
    // Leaving full screen ends work mode: downtime until he turns it back on.
    if (!document.fullscreenElement && S.work && fsAvailable()) { setWork(false, 'left full screen'); return; }
    renderTop();
  }
  function fsAvailable() { return !!(document.documentElement.requestFullscreen) && !isPhone(); }
  // Work mode: on = full screen and work time; off (or out of full screen) = downtime.
  function setWork(on, why) {
    if (!S || S.work === on) return;
    if (!on && (S.phase === 'calling')) { toast('End the call first.', 'bad'); return; }
    S.work = on; S.workSince = Date.now();
    ev(on ? 'work_on' : 'work_off', why || '');
    if (on && fsAvailable() && !document.fullscreenElement) document.documentElement.requestFullscreen().catch(function () { /* allowed to fail */ });
    if (!on && document.fullscreenElement && why !== 'left full screen') document.exitFullscreen().catch(function () {});
    if (on && S.idleSince) { ev('idle_end', String(Date.now() - S.idleSince)); S.idleSince = null; }
    beat(); renderTop(); renderDash();
    if (!on) toast('Work mode off: this counts as downtime until you turn it back on.', 'bad');
  }
  function onHide() { if (S) { ev('screen_close', 'page closed'); beat(true); } }
  // Idle: no mouse, key or touch for 3 minutes while not on a call or a break.
  var IDLE_MS = 3 * 60000;
  function onInput() {
    if (!S) return;
    var now = Date.now();
    if (S.idleSince) {
      var ms = now - S.idleSince; ev('idle_end', String(ms)); S.idleSince = null;
      if (ms >= 5 * 60000) toast('Welcome back: ' + hm(ms) + ' idle was logged.');
      beat();
    }
    S.lastInput = now;
  }
  function checkIdle(now) {
    if (!S || S.idleSince || S.onBreak || S.phase === 'calling') return;
    if (now - (S.lastInput || now) >= IDLE_MS) { S.idleSince = S.lastInput; ev('idle_start', ''); }
  }
  // Every button pressed on the screen is logged by name (no personal data).
  function onAction(e) {
    var b = e.target && e.target.closest ? e.target.closest('button,a,[data-mkc-mode]') : null; if (!b || !S) return;
    var name = ''; for (var i = 0; i < b.attributes.length; i++) { var at = b.attributes[i]; if (/^data-(mkc|k|pay|plan|cash)/.test(at.name)) { name = at.name.replace(/^data-/, '') + (at.value && at.value.length < 24 && !/\d{6}/.test(at.value) ? ':' + at.value : ''); break; } }
    ev('action', name || (b.textContent || '').trim().slice(0, 30));
  }
  function tick() {
    if (!S) return;
    var now = Date.now(); var d = Math.min(now - S.last, 5000); S.last = now;
    var t = S.totals; t.open_ms += d;
    var away = document.hidden || (document.hasFocus && !document.hasFocus());
    if (S.onBreak) t.break_ms += d;
    else if (!S.work) t.down_ms = (t.down_ms || 0) + d;
    else if (away && S.phase === 'calling') t.oncall_hidden_ms += d;
    else if (away) t.away_ms += d;
    else t.focus_ms += d;
    var wt = q('[data-mkc-worktime]'); if (wt) wt.textContent = clock(t.focus_ms + t.oncall_hidden_ms);
    qa('[data-mkc-down]').forEach(function (x) { x.textContent = clock(t.down_ms || 0); });
    var ct = q('[data-mkc-calltimer]'); if (ct && S.callStart) ct.textContent = clock((S.callEnd || now) - S.callStart);
    var bt = q('[data-mkc-breaktimer]');
    if (bt && S.breakStart) {
      var used = now - S.breakStart; var plan = (S.breakPlan || 0) * 60000;
      bt.textContent = plan ? (used <= plan ? clock(plan - used) + ' left' : '+' + clock(used - plan) + ' over') : clock(used);
      bt.style.color = plan && used > plan ? '#f87171' : '';
    }
    checkIdle(now);
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
    ['mousemove', 'keydown', 'touchstart', 'click', 'scroll'].forEach(function (k) { document.removeEventListener(k, onInput, true); });
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
    ev('screen_close', 'exit');
    beat().then(function () { return api('/sessions/' + id + '/end', { method: 'POST', body: {} }); })
      .then(function () { teardown(); openReport(person); }, function (e) {
        if (e.code === 'cash_check') { openCash(function () { exitSession(); }); return; }
        toast(e.message, 'bad');
      });
  }
  function toggleBreak() {
    if (!S) return;
    if (S.phase === 'calling') { toast('End the call before taking a break.', 'bad'); return; }
    if (S.onBreak) { S.onBreak = false; S.breakStart = null; ev('break_end', String(S.breakPlan || '')); S.breakPlan = 0; beat(); renderBreak(); return; }
    modal('<h3 style="margin:0 0 4px;font-weight:900">Take a break</h3><p class="mkc-muted" style="margin:0 0 10px">The clock runs while you are away. Over-running is shown to King.</p>'
      + '<div class="mkc-outs">' + [['lunch', 60], ['break', 10], ['break', 15]].map(function (b) { return '<button type="button" class="mkc-out" data-brkpick="' + b[0] + ':' + b[1] + '">' + (b[0] === 'lunch' ? '🍽 Lunch ' : '☕ Break ') + b[1] + ' min</button>'; }).join('') + '</div>'
      + '<button type="button" class="mkc-btn" style="margin-top:10px" data-x>Cancel</button>', function (m, close) {
      q('[data-x]', m).onclick = close;
      qa('[data-brkpick]', m).forEach(function (b) {
        b.onclick = function () {
          var v = b.getAttribute('data-brkpick'); close();
          S.onBreak = true; S.breakStart = Date.now(); S.breakPlan = Number(v.split(':')[1]); S.breakKind = v.split(':')[0];
          if (S.idleSince) { ev('idle_end', String(Date.now() - S.idleSince)); S.idleSince = null; }
          ev('break_start', v); beat(); renderBreak();
        };
      });
    });
  }

  // ------------------------------------------------------------- overlay --
  function buildOverlay() {
    var o = document.createElement('div');
    o.id = 'mkc-overlay';
    o.setAttribute('role', 'dialog'); o.setAttribute('aria-label', 'Calling screen');
    o.innerHTML = '<div class="mkc-top" data-mkc-top></div><div class="mkc-dash" data-mkc-dash></div>'
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
    el.innerHTML = '<button type="button" class="mkc-work' + (S.work ? ' on' : '') + '" data-mkc-work aria-pressed="' + (S.work ? 'true' : 'false') + '"><span class="knob"></span><b>' + (S.work ? 'WORK MODE ON' : 'WORK MODE OFF') + '</b><small>' + (S.work ? 'work time counting' : 'downtime <span data-mkc-down>' + clock(S.totals.down_ms || 0) + '</span>') + '</small></button>'
      + '<div class="who">' + esc(personName(S.person)) + '<small>Work time <span data-mkc-worktime>' + clock(S.totals.open_ms) + '</span>' + fsLink + '</small></div>'
      + '<div class="mkc-modes" role="tablist" aria-label="Mode">' + boot.tasks.map(function (t) { var n = S.counts && S.counts[t.key]; return '<button type="button" role="tab" class="mkc-mode' + (t.key === S.task ? ' on' : '') + '" data-mkc-mode="' + esc(t.key) + '">' + esc(MODE_LABEL[t.key] || t.name) + '<i title="numbers waiting">' + (n == null ? '…' : n) + '</i></button>'; }).join('') + '</div>'
      + '<select data-mkc-lang-ui aria-label="Language"><option value="en"' + (S.lang === 'en' ? ' selected' : '') + '>English</option><option value="lg"' + (S.lang === 'lg' ? ' selected' : '') + '>Luganda</option></select>'
      + '<span class="mkc-net" data-mkc-net style="' + (net.offline ? '' : 'display:none') + '">' + esc(T('offline')) + '</span>'
      + '<div class="mkc-road"><div style="font-size:11px;color:#94a3b8">Road to 1000 · <b style="color:#fff">' + road.paying_now + '</b> paying</div><div class="bar"><i style="width:' + Math.max(1, Math.min(100, road.percent || 0)) + '%"></i></div></div>'
      + '<div class="sp"></div>'
      + '<button type="button" class="mkc-btn mkc-in" data-mkc-in title="Someone rang the company phone and you answered in Phone Link">📲 Incoming call</button>'
      + '<button type="button" class="mkc-btn sm" style="background:#0ea5e9;color:#fff" data-mkc-live>🌐 Live site</button>'
      + '<button type="button" class="mkc-btn sm go" data-mkc-add>➕ Add number</button>'
      + '<button type="button" class="mkc-btn sm ghost" style="color:#fff;border-color:#475569" data-mkc-rep>' + esc(T('report')) + '</button>'
      + '<button type="button" class="mkc-btn sm ghost" style="color:#fff;border-color:#475569" data-mkc-plan>📋 Today\'s plan</button>'
      + '<button type="button" class="mkc-btn sm amber" data-mkc-brk>' + (S.lang === 'lg' ? esc(T('brk')) : 'Lunch / break') + '</button>'
      + '<button type="button" class="mkc-btn sm red" data-mkc-exit>' + esc(T('exit')) + '</button>';
    qa('[data-mkc-mode]', el).forEach(function (b) { b.onclick = function () { var k = b.getAttribute('data-mkc-mode'); if (k !== S.task) switchTask(k); }; });
    renderDash();
    q('[data-mkc-lang-ui]', el).onchange = function (e) { setLang(e.target.value); };
    q('[data-mkc-add]', el).onclick = openAddNumber;
    q('[data-mkc-in]', el).onclick = openInbound;
    q('[data-mkc-live]', el).onclick = openLive;
    q('[data-mkc-rep]', el).onclick = function () { openReport(S.person); };
    q('[data-mkc-brk]', el).onclick = toggleBreak;
    q('[data-mkc-plan]', el).onclick = function () { openPlan(false); };
    q('[data-mkc-work]', el).onclick = function () { setWork(!S.work); };
    q('[data-mkc-exit]', el).onclick = exitSession;
    var fs = q('[data-mkc-fs]', el); if (fs) fs.onclick = function (e) { e.preventDefault(); document.documentElement.requestFullscreen().catch(function () {}); };
  }
  var MODE_LABEL = { new_agents: 'Get new agents', payments: 'Get payments in', retention: 'Keep clients' };
  function ugx(n) { return 'UGX ' + Number(n || 0).toLocaleString('en-GB'); }
  function ring(v, max, color, label) {
    var r = 26, c = 2 * Math.PI * r, pct = Math.max(0, Math.min(1, max ? v / max : 0));
    return '<div class="mkc-ring" title="' + esc(label) + '"><svg width="62" height="62"><circle cx="31" cy="31" r="' + r + '" fill="none" stroke="#e2e8f0" stroke-width="7"/><circle cx="31" cy="31" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="7" stroke-linecap="round" stroke-dasharray="' + (c * pct).toFixed(1) + ' ' + c.toFixed(1) + '"/></svg><em>' + v + '/' + max + '</em></div>';
  }
  function badgesFor(st, tg) {
    var calls = st.calls || 0, closes = st.closes || 0;
    return [
      ['First call', calls >= 1], ['10 calls', calls >= 10], ['20 calls', calls >= 20], ['Target ' + tg.calls_per_day, calls >= tg.calls_per_day],
      ['First close', closes >= 1], [tg.closes_per_day + ' closes', closes >= tg.closes_per_day], ['Hot hour 8+', (st.this_hour || 0) >= 8], ['3-day streak', (st.streak_days || 0) >= 3]
    ];
  }
  function renderDash() {
    var el = q('[data-mkc-dash]'); if (!el || !S) return;
    if (!S.work && !S.onBreak) { el.innerHTML = '<div class="mkc-downbar"><b>⏸ Work mode is off</b> – this is downtime (<span data-mkc-down>' + clock(S.totals.down_ms || 0) + '</span> today). <button type="button" class="mkc-btn go" data-mkc-workon>Turn work mode on</button></div>'; q('[data-mkc-workon]', el).onclick = function () { setWork(true); }; return; }
    var st = S.stats || {}; var tg = st.targets || { calls_per_day: 40, closes_per_day: 2 };
    var money = st.money || {};
    var toGo = Math.max(0, tg.calls_per_day - (st.calls || 0));
    var hours = []; for (var h = 8; h <= 19; h++) hours.push(h);
    var byH = st.by_hour || {}; var maxH = Math.max.apply(null, hours.map(function (x) { return byH[x] || 0; }).concat([4]));
    var nowH = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Africa/Kampala' }).format(new Date())) % 24;
    var badges = badgesFor(st, tg);
    var got = badges.filter(function (b) { return b[1]; });
    var nextB = badges.filter(function (b) { return !b[1]; })[0];
    el.innerHTML = '<div class="mkc-dcard">' + ring(st.calls || 0, tg.calls_per_day, (st.calls_hit ? '#10b981' : '#0ea5e9'), 'Calls vs target') + '<div><b>' + (toGo ? toGo + ' to go' : 'Target hit!') + '</b><span>calls today</span></div></div>'
      + '<div class="mkc-dcard">' + ring(st.closes || 0, tg.closes_per_day, '#f59e0b', 'Closes vs target') + '<div><b>' + (st.closes || 0) + ' closed</b><span>target ' + tg.closes_per_day + '</span></div></div>'
      + '<div class="mkc-dcard mkc-money"><div><b>' + (money.on_commission ? ugx(money.earned_ugx) : ugx((money.payments_closed || 0) * 50000)) + '</b><span>' + (money.on_commission ? 'earned today (est. ' + money.rate_pct + '%)' : 'payments in today') + '</span></div><div><b style="color:#b45309">' + (money.on_commission ? ugx(money.at_stake_ugx) : (money.payments_pending || 0) + ' to pay') + '</b><span>at stake: sign-ups / promises</span></div></div>'
      + '<div class="mkc-dcard"><div><b>' + hm((st.talk_s || 0) * 1000) + '</b><span>time on calls</span></div><div><b>' + (st.streak_days || 0) + '🔥</b><span>day streak</span></div><div><b>' + (st.queue_left == null ? '–' : st.queue_left) + '</b><span>' + esc(T('left')) + '</span></div></div>'
      + '<div class="mkc-dcard"><div class="mkc-hours" title="Calls per hour today (Kampala)">' + hours.map(function (x) { return '<i class="' + (x === nowH ? 'now' : '') + '" style="height:' + Math.max(3, Math.round(40 * (byH[x] || 0) / maxH)) + 'px" title="' + x + ':00 · ' + (byH[x] || 0) + ' calls"></i>'; }).join('') + '</div><div><b>' + (st.this_hour || 0) + '</b><span>this hour</span></div></div>'
      + (S.plan ? '<div class="mkc-dcard" style="min-width:190px;cursor:pointer" data-mkc-planline><div style="flex:1"><b>📋 ' + (S.plan.plan.goal ? esc(String(S.plan.plan.goal).slice(0, 60)) : 'Plan: ' + S.plan.plan.calls_target + ' calls') + '</b><span>' + (S.plan.plan.agreed_by ? 'agreed with ' + esc(S.plan.plan.agreed_by) : 'not agreed with King yet') + '</span></div></div>' : '')
      + '<div class="mkc-dcard" style="min-width:190px"><div style="flex:1"><b>' + ((st.road_to_1000 || {}).paying_now || 0) + ' / 1,000</b><span>paid agents · company goal</span><div class="bar" style="height:8px;background:#e2e8f0;border-radius:99px;margin-top:4px;overflow:hidden"><i style="display:block;height:100%;background:linear-gradient(90deg,#10b981,#f59e0b);width:' + Math.max(1, Math.min(100, (st.road_to_1000 || {}).percent || 0)) + '%"></i></div></div></div>'
      + myMoneyCard()
      + '<div class="mkc-dcard"><div class="mkc-badges">' + got.map(function (b) { return '<span class="mkc-badge">🏅 ' + esc(b[0]) + '</span>'; }).join('') + (nextB ? '<span class="mkc-badge off">Next: ' + esc(nextB[0]) + '</span>' : '') + '</div></div>';
    var pl = q('[data-mkc-planline]', el); if (pl) pl.onclick = function () { openPlan(false); };
    var mm = q('[data-mkc-money]', el); if (mm) mm.onclick = openMoney;
  }
  function renderBreak() {
    var el = q('[data-mkc-break]'); if (!el || !S) return;
    el.innerHTML = S.onBreak ? '<div class="mkc-break"><b>' + (S.breakKind === 'lunch' ? '🍽 Lunch' : 'On a break') + (S.breakPlan ? ' · ' + S.breakPlan + ' min' : '') + '</b><div style="font-size:42px;font-weight:900" data-mkc-breaktimer>0:00</div><p class="mkc-muted" style="color:#cbd5e1">Breaks are logged as breaks, not as time away.</p><button type="button" class="mkc-btn go" data-mkc-back style="font-size:18px">Back to calling</button></div>' : '';
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
    S.coach = { answered: null, step: 0, hi: null }; S.stageManual = null; S.tx = null; TX = null; S.suggest = null;
    if (outbox().length) { S.phase = 'offline_wait'; renderNum(); flush(); return; }
    renderNum();
    api('/sessions/' + S.id + '/next', { method: 'POST', body: {} }).then(function (d) {
      if (!S) return;
      S.cur = d && d.attempt ? d : null;
      if (!S.cur) { S.phase = 'empty'; } else {
        var a = d.attempt;
        S.phase = a.status === 'calling' ? (a.ended_at ? 'wrapup' : 'calling') : 'shown';
        if (a.direction === 'inbound' && S.phase === 'calling' && S.coach.answered == null) { S.coach.answered = true; S.wrap.checklist.answered = true; S.tx = S.tx || 'ask'; }
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
    var head = lastDoneHtml()
      + '<h4>' + esc(MODE_LABEL[task.key] || task.name) + (d.resumed ? ' · picked up where you left off' : '') + '</h4>'
      + (S.phase === 'shown' ? '<div class="mkc-muted" style="font-weight:800;color:#047857">' + esc(T('next', { name: a.name || prettyPhone(a.phone) })) + '</div>' : '')
      + '<div class="name">' + esc(a.name || 'Name not known') + '</div>'
      + '<div class="src">' + esc(a.reason && String(a.source_label || '').indexOf(a.reason) >= 0 ? String(a.source_label).replace(' · ' + a.reason, '') : (a.source_label || '')) + '</div>'
      + (a.reason ? '<span class="mkc-reason' + (a.source_kind === 'callback' ? ' mkc-cb' : '') + '">' + esc(a.reason) + '</span>' : '')
      + '<div class="mkc-phone">' + esc(prettyPhone(a.phone)) + '</div>'
      + contextHtml(d, S.phase === 'shown');
    var body = coachBar();
    var steps = scriptSteps(task);
    if (S.phase === 'shown') {
      body += '<a class="mkc-btn go mkc-call" href="' + esc(d.tel) + '" data-mkc-tap><i class="fas fa-phone"></i>&nbsp;' + (isPhone() ? esc(T('call_next')) : 'Call from laptop (Phone Link)') + '</a>'
        + '<p class="mkc-muted" style="margin:8px 0 0;text-align:center">' + (isPhone() ? 'Opens the phone app. Come back here when the call ends.' : '<b>Calling from laptop via company phone</b> · Phone Link opens and rings out from the company Android. Use loudspeaker or the headset. Phone Link not set up? Dial on the company phone instead.') + '</p>'
        + '<div class="mkc-row" style="margin-top:10px;justify-content:center"><button type="button" class="mkc-btn ghost sm" data-mkc-skip>' + esc(T('skip')) + '</button><button type="button" class="mkc-btn ghost sm" data-mkc-tree>History tree</button></div>';
    } else if (S.phase === 'calling') {
      var c = S.coach;
      body += '<div class="mkc-calling"><span class="dot"></span>Calling… <span data-mkc-calltimer>' + clock(Date.now() - (S.callStart || Date.now())) + '</span></div>' + txHtml();
      if (c.answered === null) {
        var g0 = (boot.scripts.variants[currentVariant(task).key] || { en: [] }); g0 = (g0[S.lang] || g0.en || [])[0];
        if (g0) body += '<div class="mkc-coach-q" style="text-align:left"><span class="mkc-muted">When they pick up, say:</span><p style="margin:4px 0 0;font-size:17px;line-height:1.45">' + esc(stepText(g0, 0, scriptCtx())) + '</p></div>';
        body += '<div class="mkc-coach-q"><b>' + esc(T('answered')) + '</b><div class="mkc-row" style="justify-content:center;margin-top:8px"><button type="button" class="mkc-btn go" data-mkc-ans="yes">' + esc(T('yes')) + '</button><button type="button" class="mkc-btn" data-mkc-ans="no">' + esc(T('no')) + '</button></div></div>';
      } else if (c.step < steps.length) {
        var st = steps[c.step];
        body += '<div class="mkc-coach-q"><span class="mkc-muted">' + esc(T('script', { n: c.step + 1, total: steps.length })) + '</span><b style="display:block;margin:4px 0;color:#047857">' + esc(st[0]) + '</b><p style="margin:0;font-size:17px;line-height:1.45">' + esc(stepText(st, c.step + 1, scriptCtx())) + '</p>'
          + '<div class="mkc-row" style="justify-content:center;margin-top:10px">' + (c.step > 0 ? '<button type="button" class="mkc-btn sm" data-mkc-prev>‹</button>' : '') + '<button type="button" class="mkc-btn go" data-mkc-step>' + esc(T('next_step')) + ' ›</button></div></div>';
      } else if (c.hi === null) {
        body += '<div class="mkc-coach-q" style="background:#fef9c3;border-color:#fde047"><b>' + esc(T('hi', { wa: boot.whatsapp_display })) + '</b><p class="mkc-muted" style="margin:4px 0 0">' + esc(T('hi_why')) + '</p>'
          + '<div class="mkc-row" style="justify-content:center;margin-top:10px"><button type="button" class="mkc-btn go" data-mkc-hi="yes">' + esc(T('hi_done')) + '</button><button type="button" class="mkc-btn" data-mkc-hi="no">' + esc(T('hi_no')) + '</button></div></div>';
      }
      body += '<button type="button" class="mkc-btn red mkc-call" style="margin-top:10px" data-mkc-end>' + esc(T('end')) + '</button>';
    } else if (S.phase === 'wrapup') {
      body += '<div class="mkc-timer" style="font-size:28px;color:#334155">Call ' + clock((S.callEnd || Date.now()) - (S.callStart || Date.now())) + '</div><p class="mkc-must">' + esc(T('must')) + '</p>' + wrapHtml(task);
    }
    el.innerHTML = head + payHtml(a) + contactHtml(a) + body;
    bindPay(el, a); bindContact(el, a);
    bindTx(el);
    bindLastDone(el);
    var tapEl = q('[data-mkc-tap]', el);
    if (tapEl) tapEl.onclick = function (e) {
      if (!S.work) { e.preventDefault(); toast('Turn work mode on to call.', 'bad'); setWork(true, 'to call'); return; }
      // The tel: link opens the dialler by itself; we only log the time.
      S.callStart = Date.now(); S.phase = 'calling'; S.lastDone = null; renderNum(); renderScript();
      op('/attempts/' + a.id + '/tap', { session_id: S.id }).catch(function (e) { toast(e.message, 'bad'); });
    };
    var endIt = function () {
      stopTx();
      S.callEnd = Date.now(); S.phase = 'wrapup'; autoWrap(task); renderNum(); renderScript();
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
    qa('[data-mkc-hi]', el).forEach(function (b3) { b3.onclick = function () { S.coach.hi = b3.getAttribute('data-mkc-hi') === 'yes'; S.wrap.checklist.wa_hi = S.coach.hi; S.wrap.checklist.asked_hello = S.coach.hi; renderNum(); }; });
    var skipEl = q('[data-mkc-skip]', el);
    if (skipEl) skipEl.onclick = function () { openSkip(a); };
    var treeEl = q('[data-mkc-tree]', el);
    if (treeEl) treeEl.onclick = function () { openTimeline({ attempt_id: a.id }); };
    if (S.phase === 'wrapup') bindWrap(el, task, a);
  }
  // Everything we know about the number, shown BEFORE he dials.
  function contextHtml(d, full) {
    var c = d.context || {}; var h = d.history || [];
    var tags = '<span class="tag">' + esc(c.source_kind_label || 'Number') + '</span>'
      + (c.money ? '<span class="tag ' + (c.money === 'Likely to pay' ? 'hot' : c.money === 'Warm' ? 'warm' : '') + '">' + esc(c.money) + '</span>' : '')
      + (c.said_hello ? '<span class="tag hello">Said Hello ✓</span>' : '<span class="tag nohello">No Hello yet</span>')
      + '<span class="tag nohello">' + (c.calls_before ? 'Called ' + c.calls_before + '× before' : 'First call') + '</span>'
      + (c.skips_before ? '<span class="tag nohello">Skipped ' + c.skips_before + '×</span>' : '');
    if (!full) return '<div class="mkc-ctx" style="padding:6px 10px">' + tags + '</div>';
    var list = h.map(function (x) {
      return '<li><b>' + esc(kDayTime(x.at)) + '</b> · ' + esc(personName(x.by)) + ' · <b>' + esc(x.skipped ? 'skipped' : x.what) + '</b>' + (x.note ? ' – ' + esc(x.note) : '') + (x.next_step ? ' <span class="mkc-good">→ next: call ' + esc(kDayTime(x.next_step)) + '</span>' : '') + '</li>';
    }).join('');
    return '<div class="mkc-ctx">' + tags
      + '<div style="font-size:13px;margin-top:2px"><b>Where from:</b> ' + esc(c.source_label || '–') + (c.reason ? ' · <b>Why now:</b> ' + esc(c.reason) : '') + '</div>'
      + (c.last_call ? '<div style="font-size:14px;margin-top:4px;background:#fff7ed;border-radius:8px;padding:6px 8px"><b>Last call:</b> ' + esc(kDayTime(c.last_call.at)) + ' · ' + esc(c.last_call.by === S.person ? 'you' : personName(c.last_call.by)) + ' · <b>' + esc(String(c.last_call.outcome || '').replace(/_/g, ' ')) + '</b>' + (c.last_call.note ? ' – ' + esc(c.last_call.note) : '') + (c.last_call.next_text ? '<div><b>Next step set:</b> ' + esc(c.last_call.next_text) + '</div>' : '') + (c.last_call.summary ? '<div class="mkc-muted">Call notes: ' + esc(c.last_call.summary) + '</div>' : '') + '</div>' : '')
      + (c.best_time ? '<div style="font-size:13px;margin-top:4px">⏰ <b>Best time:</b> ' + (c.best_time.label ? esc(c.best_time.label) + ' · answered ' + c.best_time.answered + ' of ' + c.best_time.tries + ' calls' : 'no answer yet in ' + c.best_time.tries + ' tries (tried at ' + esc(c.best_time.missed_hours.map(function (h) { return pad(h) + ':00'; }).join(', ')) + ') – try another time of day') + '</div>' : '')
      + (c.said_hello ? '<div class="mkc-good" style="font-size:13px">Sent us Hello on WhatsApp ' + esc(kDayTime(c.said_hello.at)) + '</div>' : '')
      + (list ? '<div style="font-size:12px;font-weight:900;margin-top:6px;color:#334155">HISTORY (newest first)</div><ol>' + list + '</ol>' : '<div class="mkc-muted" style="font-size:13px;margin-top:4px">No earlier calls to this number. First time.</div>')
      + '</div>';
  }
  // Live call notes: phone on loudspeaker (or Phone Link through the laptop),
  // Chrome speech-to-text turns both voices into text. No audio is ever
  // recorded or kept: only the text, the summary and the next step are saved.
  var TX = null;
  function txSupported() { return !!(window.SpeechRecognition || window.webkitSpeechRecognition) && !isPhone(); }
  function txHtml() {
    if (!txSupported()) return '';
    if (S.tx === 'ask') return '<div class="mkc-coach-q" style="background:#eff6ff;border-color:#bfdbfe"><b>Say first: “I am taking notes of this call so we get your details right. Is that OK?”</b>'
      + '<div class="mkc-row" style="justify-content:center;margin-top:8px"><button type="button" class="mkc-btn go" data-mkc-tx="yes">They said OK – start notes</button><button type="button" class="mkc-btn" data-mkc-tx="no">No – no notes</button></div>'
      + '<p class="mkc-muted" style="margin:6px 0 0;font-size:12px">Put the phone on loudspeaker next to the laptop (or use Phone Link). Only text is saved, never audio.</p></div>';
    if (S.tx === 'on') return '<div class="mkc-tpl" style="background:#eff6ff;border-color:#bfdbfe;margin-top:6px"><b><span class="dot" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#2563eb;margin-right:6px"></span>Live notes on</b> <button type="button" class="mkc-btn sm" data-mkc-tx="stop">Stop</button><div class="mkc-muted" style="font-size:12px;max-height:60px;overflow:auto" data-mkc-txlive>' + esc(TX && TX.text ? TX.text.slice(-300) : 'Listening…') + '</div></div>';
    if (S.tx === 'declined') return '<p class="mkc-muted" style="text-align:center;margin:6px 0 0">No live notes (they said no).</p>';
    if (S.tx === 'done') return '';
    return '<div style="text-align:center;margin-top:6px"><button type="button" class="mkc-btn sm" style="border:2px solid #2563eb;color:#1d4ed8;background:#fff" data-mkc-tx="ask">🎙 Live notes (loudspeaker)</button></div>';
  }
  function bindTx(el) {
    qa('[data-mkc-tx]', el).forEach(function (b) {
      b.onclick = function () {
        var k = b.getAttribute('data-mkc-tx');
        if (k === 'ask') { S.tx = 'ask'; renderNum(); renderScript(); }
        else if (k === 'no') { S.tx = 'declined'; S.wrap.checklist.transcribed = 'declined'; ev('notes_declined'); renderNum(); renderScript(); }
        else if (k === 'yes') startTx();
        else if (k === 'stop') { stopTx(); renderNum(); }
      };
    });
  }
  function startTx() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    try {
      var r = new SR(); r.continuous = true; r.interimResults = true; r.lang = S.lang === 'lg' ? 'en-UG' : 'en-UG';
      TX = { text: '', start: Date.now(), sr: r, stopped: false };
      r.onresult = function (e) {
        var interim = '';
        for (var i = e.resultIndex; i < e.results.length; i++) { if (e.results[i].isFinal) TX.text += e.results[i][0].transcript.trim() + '. '; else interim += e.results[i][0].transcript; }
        var live = q('[data-mkc-txlive]'); if (live) live.textContent = (TX.text + interim).slice(-300);
      };
      r.onerror = function (e) { if (e && e.error === 'not-allowed') { toast('Microphone blocked: allow it for live notes.', 'bad'); S.tx = null; TX = null; renderNum(); } };
      r.onend = function () { if (TX && !TX.stopped) { try { r.start(); } catch (x) { /* ignore */ } } };
      r.start();
      S.tx = 'on'; S.wrap.checklist.transcribed = 'consented'; ev('notes_start', 'consent given'); renderNum(); renderScript();
    } catch (x) { toast('Live notes are not available in this browser.', 'bad'); }
  }
  function stopTx() {
    if (!TX || TX.stopped) return;
    TX.stopped = true; TX.secs = Math.round((Date.now() - TX.start) / 1000);
    try { TX.sr.stop(); } catch (x) { /* ignore */ }
    S.tx = 'done'; ev('notes_stop', TX.secs + 's');
  }
  // Free "AI" summary: rules over the live notes plus what the coach recorded. No paid API.
  var WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  function whenFrom(t) {
    var d = new Date();
    var at = function (h) { d.setHours(h, 0, 0, 0); return d; };
    var hm = t.match(/\b(\d{1,2})\s*(am|pm|o'?clock)\b/); var hour = hm ? (Number(hm[1]) % 12) + (hm[2] === 'pm' ? 12 : 0) : null;
    if (hm && hm[2] !== 'pm' && hour < 7) hour += 12;
    var wd = WEEKDAYS.filter(function (x) { return t.indexOf(x) >= 0; })[0];
    if (wd) { var diff = (WEEKDAYS.indexOf(wd) - d.getDay() + 7) % 7 || 7; d.setDate(d.getDate() + diff); return { quick: 'day', at: localInput(at(hour != null ? hour : 10)), label: wd.charAt(0).toUpperCase() + wd.slice(1) + ' ' + pad(hour != null ? hour : 10) + ':00' }; }
    if (/tomorrow/.test(t)) { d.setDate(d.getDate() + 1); return { quick: 'tom', at: localInput(at(hour != null ? hour : 10)), label: 'tomorrow ' + pad(hour != null ? hour : 10) + ':00' }; }
    if (/tonight|this evening|evening/.test(t)) return { quick: 'eve', at: localInput(at(18)), label: 'today 18:00' };
    if (/in an hour|one hour|later today|later/.test(t)) return { quick: '1h', at: quickDate('1h'), label: 'in 1 hour' };
    if (/next week/.test(t)) return { quick: 'mon', at: quickDate('mon'), label: 'next Monday 10:00' };
    if (hour != null) { if (hour <= d.getHours()) d.setDate(d.getDate() + 1); return { quick: 'day', at: localInput(at(hour)), label: pad(hour) + ':00' }; }
    return null;
  }
  function suggestWrap(task) {
    var t = String((TX && TX.text) || '').toLowerCase();
    var has = function (k) { return task.outcomes.some(function (o) { return o.key === k; }); };
    var c = S.coach || {}; var pts = []; var out = ''; var next = ''; var when = whenFrom(t);
    if (c.answered === false) return { outcome: 'no_answer', next: 'Try again next working day', summary: 'No answer.', auto: true };
    if (/how much|price|cost|expensive|50,?000/.test(t)) pts.push('asked about the price');
    if (/momo|merchant|pay|paid|money/.test(t)) pts.push('talked about payment');
    if (/video|film|link/.test(t)) pts.push('wants the film / link');
    if (/hello|whatsapp/.test(t) || c.hi) pts.push('agreed to say Hello on WhatsApp');
    var m = t.match(/(\d+)\s+(houses|places|plots|rentals|listings|properties|apartments)/); if (m) pts.push('has ' + m[1] + ' ' + m[2]);
    if (/wrong number|don'?t know (you|makaug)|who is this/.test(t) && has('wrong_number')) out = 'wrong_number';
    else if (/stop calling|don'?t call|never call/.test(t) && has('do_not_contact')) out = 'do_not_contact';
    else if (/not interested|no thank|don'?t (want|need)/.test(t)) out = has('rejected') ? 'rejected' : (has('not_renewing') ? 'not_renewing' : '');
    else if (task.key === 'payments' && /\bi('ve| have)? (already )?(paid|sent)\b/.test(t) && has('paid')) { out = 'paid'; next = 'Check MoMo for UGX 50,000 and confirm on WhatsApp'; }
    else if (task.key === 'retention' && /\b(renewed|i('ve| have) paid)\b/.test(t) && has('renewed')) { out = 'renewed'; next = 'Check MoMo and confirm the renewal'; }
    else if (/(will|i'?ll|going to|can) (pay|send the money|renew)|pay (today|tomorrow|tonight|on)/.test(t) && (has('promised') || has('call_back'))) { out = has('promised') ? 'promised' : 'call_back'; next = 'Chase payment: check MoMo for UGX 50,000'; when = when || { quick: 'tom', at: quickDate('tom'), label: 'tomorrow 10:00' }; }
    else if (/sign me up|register me|i will join|i'?ll join|let'?s do it|i('m| am) in\b/.test(t) && has('signed_up')) { out = 'signed_up'; next = 'Confirm their first payment by MoMo'; }
    else if (/call (me )?(back|later)|busy|driving|in a meeting|not a good time/.test(t) || (when && !out)) { out = 'call_back'; next = 'Call back'; when = when || { quick: 'tom', at: quickDate('tom'), label: 'tomorrow 10:00' }; }
    else if (/send|whatsapp me|video|film|link/.test(t)) { out = has('interested') ? 'interested' : (has('will_list') ? 'will_list' : 'call_back'); next = 'Send the film and link on WhatsApp, then call back'; when = when || { quick: 'tom', at: quickDate('tom'), label: 'tomorrow 10:00' }; }
    if (out && !has(out)) out = '';
    var summary = (t ? 'Spoke ' + clock((S.callEnd - S.callStart) || 0) + '. ' : '') + (pts.length ? 'They ' + pts.join(', ') + '. ' : '') + (when ? 'Next contact ' + when.label + '.' : '');
    if (when && next && next.indexOf(when.label) < 0) next += ' (' + when.label + ')';
    return { outcome: out, next: next, summary: summary.trim(), when: when, auto: Boolean(t) };
  }
  function autoWrap(task) {
    var sg = suggestWrap(task); var w = S.wrap;
    S.suggest = sg;
    if (sg.outcome) w.outcome = sg.outcome;
    if (sg.next) w.next = sg.next;
    if (sg.when) { w.callback = sg.when.at; w.quick = sg.when.quick; }
    if (sg.summary && !w.note) w.note = sg.summary;
  }
  function txPayload() {
    if (!TX || !TX.text) return null;
    var sg = S.suggest || {}; var w = S.wrap;
    return { text: TX.text, summary: sg.summary || '', suggested_outcome: sg.outcome || '', suggested_next_step: sg.next || '', confirmed: true, edited: (sg.outcome || '') !== w.outcome || (sg.next || '') !== (w.next || '') };
  }
  function txResultHtml() {
    var sg = S.suggest; if (!sg || (!sg.outcome && !sg.summary)) return '';
    return '<div class="mkc-tpl" style="background:#eff6ff;border-color:#bfdbfe;margin-top:8px"><b>✨ Filled in from the call' + (sg.auto && TX ? ' notes' : '') + '</b> – check it, then tap Save. Change anything that is wrong.'
      + (sg.summary ? '<div style="font-size:13px;margin-top:4px">' + esc(sg.summary) + '</div>' : '')
      + (TX && TX.text ? '<details><summary class="mkc-muted">Live notes (' + TX.text.split(/\s+/).length + ' words, no audio kept)</summary><div style="font-size:12px">' + esc(TX.text.slice(0, 2000)) + '</div></details>' : '')
      + '</div>';
  }

  // The coach strip: where he is in the call, one step at a time.
  function coachBar() {
    var c = S.coach || {};
    var at = S.phase === 'shown' ? 0 : S.phase === 'calling' ? (c.answered === null ? 1 : (c.hi === null ? 2 : 3)) : 4;
    var labels = [T('dial'), T('answered'), T('script', { n: '', total: '' }).replace(/[:：].*$/, ''), 'WhatsApp "Hello"', T('confirm')];
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
  var NEXT_CHIPS = {
    new_agents: ['Call back', 'Send the film and link on WhatsApp', 'Send the sign-up link', 'Wait for their Hello, then call', 'Confirm their first payment by MoMo', 'King to decide'],
    payments: ['Chase payment: check MoMo for UGX 50,000', 'Call back', 'Send the MoMo code on WhatsApp', 'King to decide'],
    retention: ['Call back', 'Help them list new places', 'Chase the renewal payment', 'King to decide']
  };
  var NOTE_CHIPS = {
    interested: ['Wants the film first', 'Will sign up this week', 'Sending places on WhatsApp', 'Asked about price'],
    call_back: ['Busy, call later', 'Driving', 'Asked to call tomorrow', 'In a meeting'],
    rejected: ['Not interested', 'Price too high', 'Uses another site', 'Not an agent'],
    signed_up: ['Signed up, paying by MoMo today', 'Signed up, will pay tomorrow'],
    promised: ['Will pay today', 'Will pay tomorrow', 'Waiting for money'],
    paid: ['Paid, sending the MoMo ref on WhatsApp'],
    renewed: ['Renewed by MoMo'],
    _: ['Spoke, will follow up', 'Asked for details on WhatsApp', 'Will send new places']
  };
  function wrapHtml(task) {
    var w = S.wrap;
    var outs = task.outcomes.map(function (o) { return '<button type="button" class="mkc-out' + (o.close ? ' close' : '') + (w.outcome === o.key ? ' on' : '') + '" data-mkc-out="' + esc(o.key) + '">' + esc(o.label) + '</button>'; }).join('');
    var o = task.outcomes.filter(function (x) { return x.key === w.outcome; })[0];
    var html = '<h4 style="margin-top:12px">' + esc(T('what')) + '</h4><div class="mkc-outs big">' + outs + '</div>';
    if (!o) return txResultHtml() + html + '<div data-mkc-wraperr></div>';
    html = txResultHtml() + html;
    if (o.spoke || o.close) {
      html += '<button type="button" class="mkc-hello' + (w.checklist.asked_hello ? ' on' : '') + '" data-mkc-hello>' + (w.checklist.asked_hello ? '✓' : '☐') + ' Asked them to say “Hello” on WhatsApp to ' + esc(boot.whatsapp_display) + '</button>';
    }
    if (o.close) {
      html += '<div class="mkc-closebox"><h4 style="margin:0 0 6px;color:#065f46">' + esc(T('close_title')) + ' <span class="mkc-req">*</span></h4>'
        + (boot.close_checks[task.key] || []).map(function (c, i) { return '<label class="mkc-check"><input type="checkbox" data-mkc-chk="close_' + i + '"' + (w.checklist['close_' + i] ? ' checked' : '') + '><span>' + esc(c) + '</span></label>'; }).join('')
        + task.checklist.filter(function (c) { return c.required; }).map(function (c) { return '<label class="mkc-check"><input type="checkbox" data-mkc-chk="' + esc(c.key) + '"' + (w.checklist[c.key] ? ' checked' : '') + '><span>' + esc(c.label) + '</span></label>'; }).join('')
        + '</div>';
    }
    if (o.date) {
      html += '<h4 style="margin-top:12px">' + (o.date === 'required' ? 'When to call back' : 'Follow-up') + '</h4><div class="mkc-chips">'
        + [['1h', 'In 1 hour'], ['eve', 'Today 18:00'], ['tom', 'Tomorrow 10:00'], ['mon', 'Next Monday']].concat(bestChip()).map(function (x) { return '<button type="button" class="mkc-chip' + (w.quick === x[0] ? ' on' : '') + '" data-mkc-quick="' + x[0] + '">' + x[1] + '</button>'; }).join('')
        + '<input type="datetime-local" class="mkc-input" data-mkc-when value="' + esc(w.callback) + '" style="font-size:13px"></div>';
    }
    if (o.spoke) {
      var chips = NOTE_CHIPS[o.key] || NOTE_CHIPS._;
      html += '<h4 style="margin-top:12px">Quick note <span class="mkc-req">*</span></h4><div class="mkc-chips">' + chips.map(function (c) { return '<button type="button" class="mkc-chip' + (w.note.indexOf(c) >= 0 ? ' on' : '') + '" data-mkc-chip="' + esc(c) + '">' + esc(c) + '</button>'; }).join('') + '</div>'
        + '<textarea class="mkc-ta" rows="2" data-mkc-note placeholder="Or one line: what did they say?">' + esc(w.note) + '</textarea>';
    } else {
      html += '<textarea class="mkc-ta" rows="1" data-mkc-note placeholder="Note (optional)" style="margin-top:10px">' + esc(w.note) + '</textarea>';
    }
    if (o.key !== 'no_answer' && (!(o.close || o.terminal) || o.key === 'signed_up' || o.key === 'paid' || o.key === 'renewed')) {
      var nx = NEXT_CHIPS[task.key] || NEXT_CHIPS.new_agents;
      html += '<h4 style="margin-top:12px">Next step' + (o.close || o.terminal ? ' (optional)' : ' <span class="mkc-req">*</span>') + '</h4><div class="mkc-chips">' + nx.map(function (c) { return '<button type="button" class="mkc-chip' + ((w.next || '').indexOf(c) === 0 ? ' on' : '') + '" data-mkc-nextchip="' + esc(c) + '">' + esc(c) + '</button>'; }).join('') + '</div>'
        + '<input class="mkc-input" style="width:100%;box-sizing:border-box" data-mkc-next placeholder="What happens next?" value="' + esc(w.next || '') + '">'
        + (w.callback ? '<div class="mkc-muted" style="font-size:12px;margin-top:4px">It comes back to your queue on ' + esc(kDayTime(new Date(w.callback).toISOString())) + ' with this summary.</div>' : '');
    }
    return html + '<div data-mkc-wraperr></div><button type="button" class="mkc-btn go mkc-call" style="margin-top:10px;font-size:20px" data-mkc-save>' + (S.suggest && S.suggest.outcome === w.outcome ? '✓ Confirm and call next ›' : esc(T('save')) + ' ›') + '</button>';
  }
  function localInput(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function quickDate(k) {
    var d = new Date();
    if (k === '1h') d = new Date(Date.now() + 3600000);
    else if (k === '2h') d = new Date(Date.now() + 2 * 3600000);
    else if (k === 'eve') { d.setHours(18, 0, 0, 0); if (d.getTime() < Date.now() + 15 * 60000) d.setDate(d.getDate() + 1); }
    else if (k === 'best') { var bt = S.cur && S.cur.context && S.cur.context.best_time; d.setDate(d.getDate() + 1); d.setHours(bt && bt.hour != null ? bt.hour : 10, 0, 0, 0); }
    else if (k === 'tom') { d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0); }
    else { d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); d.setHours(10, 0, 0, 0); }
    return localInput(d);
  }
  function bestChip() { var bt = S.cur && S.cur.context && S.cur.context.best_time; return bt && bt.hour != null ? [['best', 'Tomorrow ' + pad(bt.hour) + ':00 (best time)']] : []; }
  function bindWrap(el, task, a) {
    var w = S.wrap;
    var save;
    qa('[data-mkc-out]', el).forEach(function (b) {
      b.onclick = function () {
        saveWrapInputs(el); w.outcome = b.getAttribute('data-mkc-out');
        var o = task.outcomes.filter(function (x) { return x.key === w.outcome; })[0] || {};
        if (o.date === 'required' && !w.callback) { w.quick = 'tom'; w.callback = quickDate('tom'); }
        if (!w.next && !(o.close || o.terminal) && o.key !== 'no_answer') w.next = o.key === 'promised' ? 'Chase payment: check MoMo for UGX 50,000' : o.date ? 'Call back' : '';
        // No answer: one tap saves and brings the next number.
        if (!o.spoke && !o.close && !o.date && w.outcome === 'no_answer') { renderNum(); save(); return; }
        renderNum();
      };
    });
    qa('[data-mkc-quick]', el).forEach(function (b) { b.onclick = function () { saveWrapInputs(el); w.quick = b.getAttribute('data-mkc-quick'); w.callback = quickDate(w.quick); renderNum(); }; });
    qa('[data-mkc-chip]', el).forEach(function (b) {
      b.onclick = function () {
        saveWrapInputs(el); var c = b.getAttribute('data-mkc-chip');
        w.note = w.note.indexOf(c) >= 0 ? w.note.replace(c, '').replace(/^[\s.;]+|[\s.;]+$/g, '').replace(/\s*;\s*;/g, ';') : (w.note.trim() ? w.note.trim() + '; ' + c : c);
        renderNum();
      };
    });
    var hb = q('[data-mkc-hello]', el); if (hb) hb.onclick = function () { saveWrapInputs(el); w.checklist.asked_hello = !w.checklist.asked_hello; renderNum(); };
    qa('[data-mkc-nextchip]', el).forEach(function (b) { b.onclick = function () { saveWrapInputs(el); var c = b.getAttribute('data-mkc-nextchip'); w.next = c + (w.callback && /call back|chase/i.test(c) ? ' (' + kDayTime(new Date(w.callback).toISOString()) + ')' : ''); if (/call back|chase/i.test(c) && !w.callback) { w.quick = 'tom'; w.callback = quickDate('tom'); } renderNum(); }; });
    save = function () {
      saveWrapInputs(el);
      var o = task.outcomes.filter(function (x) { return x.key === w.outcome; })[0];
      var err = !o ? 'Tap what happened.' : (o.spoke && w.note.trim().length < 3 ? 'Tap a quick note or write one line.' : (o.date === 'required' && !w.callback ? 'Pick when to call back.' : ''));
      if (!err && !(o.close || o.terminal) && o.key !== 'no_answer' && !(w.next || '').trim() && !w.callback) err = 'Pick the next step, so no call is left open.';
      if (!err && o.close) {
        var miss = task.checklist.filter(function (c) { return c.required && !w.checklist[c.key]; }).map(function (c) { return c.label; })
          .concat((boot.close_checks[task.key] || []).filter(function (_c, i) { return !w.checklist['close_' + i]; }));
        if (miss.length) err = T('close_title') + ': ' + miss.join('; ');
      }
      var box = q('[data-mkc-wraperr]');
      if (err) { if (box) box.innerHTML = '<div class="mkc-err">' + esc(err) + '</div>'; return; }
      var btn = q('[data-mkc-save]'); if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
      var cbIso = w.callback ? new Date(w.callback).toISOString() : null;
      op('/attempts/' + a.id + '/wrapup', { session_id: S.id, outcome: w.outcome, note: w.note, checklist: w.checklist, callback_at: cbIso, next_step: w.next || '', transcript: txPayload() })
        .then(function (done) {
          S.lastDone = { name: a.name, phone: a.phone, outcome: w.outcome, callback_at: cbIso, task: S.task };
          if (done.queued) toast(T('offline'));
          if (o.close) celebrate();
          next(); refreshSide();
        }, function (e) { if (btn) { btn.disabled = false; btn.textContent = T('save'); } if (box) box.innerHTML = '<div class="mkc-err">' + esc(e.message) + '</div>'; });
    };
    var sb = q('[data-mkc-save]', el); if (sb) sb.onclick = save;
  }
  function saveWrapInputs(el) {
    var w = S.wrap;
    var n = q('[data-mkc-note]', el); if (n) w.note = n.value;
    var d = q('[data-mkc-when]', el); if (d) w.callback = d.value;
    var nxi = q('[data-mkc-next]', el); if (nxi) w.next = nxi.value;
    qa('[data-mkc-chk]', el).forEach(function (c) { w.checklist[c.getAttribute('data-mkc-chk')] = c.checked; });
  }
  var SKIP = [['wrong_number', 'Wrong number'], ['no_answer', 'No answer'], ['busy', 'Busy'], ['already_agent', 'Already an agent'], ['not_interested', 'Not interested'], ['do_not_contact', '⛔ Do not contact'], ['other', 'Other…']];
  function openSkip(a) {
    modal('<h3 style="margin:0 0 4px;font-weight:900">Why skip ' + esc(a.name || a.phone_masked || 'this number') + '?</h3><p class="mkc-muted" style="margin:0">One tap. It goes in the number\'s history tree and King sees every skip.</p>'
      + '<div class="mkc-skipgrid">' + SKIP.map(function (r) { return '<button type="button" class="mkc-btn' + (r[0] === 'wrong_number' || r[0] === 'do_not_contact' ? ' red' : '') + '" data-r="' + r[0] + '">' + esc(r[1]) + '</button>'; }).join('') + '</div>'
      + '<div data-other style="display:none"><input class="mkc-input" style="width:100%;box-sizing:border-box" data-reason placeholder="Why? (a few words)"><button class="mkc-btn dark" style="margin-top:8px" data-ok>Skip</button></div>'
      + '<div data-e></div><div class="mkc-row" style="margin-top:10px;justify-content:flex-end"><button class="mkc-btn ghost" data-x>Cancel – call them</button></div>', function (m, close) {
      var send = function (code, note) {
        op('/attempts/' + a.id + '/skip', { session_id: S.id, reason_code: code, note: note || '' }).then(function () { close(); toast('Skipped: ' + (SKIP.filter(function (x) { return x[0] === code; })[0] || [0, code])[1].replace('…', '')); next(); refreshSide(); }, function (e) { q('[data-e]', m).innerHTML = '<div class="mkc-err">' + esc(e.message) + '</div>'; });
      };
      qa('[data-r]', m).forEach(function (b) { b.onclick = function () { var c = b.getAttribute('data-r'); if (c === 'other') { q('[data-other]', m).style.display = ''; q('[data-reason]', m).focus(); return; } send(c); }; });
      q('[data-ok]', m).onclick = function () { var r = q('[data-reason]', m).value.trim(); if (r.length < 3) { q('[data-e]', m).innerHTML = '<div class="mkc-err">Write why you are skipping.</div>'; return; } send('other', r); };
      q('[data-x]', m).onclick = close;
    });
  }
  function celebrate(line) {
    var c = document.createElement('div'); c.className = 'mkc-yay';
    var n = ((S.stats && S.stats.closes) || 0) + 1;
    if (line) c.innerHTML = '<div>🎉 ' + esc(line) + '</div>'; else c.innerHTML = '<div>🎉 Well done, ' + esc(personName(S.person)) + '!<br><span style="font-size:16px">' + n + ' close' + (n === 1 ? '' : 's') + ' today' + (S.stats && S.stats.money && S.stats.money.on_commission ? ' · +' + esc(ugx(S.stats.money.per_payment_ugx)) + ' when they pay' : '') + '</span></div>';
    var cf = document.createElement('div'); cf.className = 'mkc-confetti';
    var colors = ['#10b981', '#f59e0b', '#ef4444', '#3b82f6', '#a855f7', '#fde047'];
    for (var i = 0; i < 70; i++) cf.innerHTML += '<i style="left:' + Math.round(Math.random() * 100) + '%;background:' + colors[i % colors.length] + ';animation-delay:' + (Math.random() * 0.6).toFixed(2) + 's"></i>';
    var host = q('#mkc-overlay') || document.body;
    host.appendChild(cf); host.appendChild(c); setTimeout(function () { c.remove(); cf.remove(); }, 2800);
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
      reason: a ? (a.reason || '') : '', momo: boot.momo_code,
      opener: openerLine()
    };
  }
  // History-aware opening line: who called last, when, about what.
  function openerLine() {
    var c = S && S.cur && S.cur.context; var L = c && c.last_call; if (!L) return '';
    var day = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Africa/Kampala' }).format(new Date(L.at));
    var topic = L.note && L.note.length < 80 ? L.note.replace(/[.]+$/, '') : String(L.outcome || '').replace(/_/g, ' ');
    var mine = L.by === S.person;
    if (S.lang === 'lg') return mine ? 'Nakukubira ku ' + day + ' ku nsonga ya: ' + topic + '.' : 'Munnange ' + personName(L.by) + ' yakukubira ku ' + day + ' ku nsonga ya: ' + topic + '.';
    return mine ? 'I called you on ' + day + ' about: ' + topic + '.' : 'My colleague ' + personName(L.by) + ' called you on ' + day + ' about: ' + topic + '.';
  }
  function stepText(st, i, ctx) {
    var t = fillTemplate(st[1], ctx);
    return i === 0 && ctx.opener ? t + ' ' + ctx.opener : t;
  }
  var GOAL = {
    new_agents: 'Goal: sign them up (UGX 50,000 a month) and get “Hello” on WhatsApp. Close = money.',
    payments: 'Goal: UGX 50,000 paid TODAY by MoMo 27248497, and the reference sent on WhatsApp.',
    retention: 'Goal: keep them paying: renewal by MoMo 27248497, plus new places to list.'
  };
  function autoStage(steps) {
    if (!S || S.phase === 'shown' || S.phase === 'loading') return 'before';
    if (S.phase === 'wrapup') return 'close';
    if (S.phase !== 'calling') return 'before';
    var c = S.coach || {};
    if (c.answered === null) return 'greeting';
    var idx = c.step + 1; var st = steps[idx]; // the coach starts after the greeting
    if (!st || idx >= steps.length - 1 || st[2] === 'hello' || /hello/i.test(st[0])) return 'close';
    return 'pitch';
  }
  function renderScript() {
    var el = q('[data-mkc-script]'); if (!el || !S) return;
    var task = taskOf(S.task);
    if (S.tab === 'objections') { S.tab = 'script'; S.stageManual = 'objections'; }
    var tabs = [['script', 'Script'], ['texts', 'Texts'], ['kit', 'Sales kit']];
    var html = '<div class="mkc-tabs">' + tabs.map(function (t) { return '<button type="button" class="mkc-tab' + (S.tab === t[0] ? ' on' : '') + '" data-mkc-tabk="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div>';
    var a = S.cur && S.cur.attempt;
    var ctx = scriptCtx();
    if (S.tab === 'script') {
      var cv = currentVariant(task);
      var vars = cv.list;
      var v = cv.key;
      var hiStep = S.phase === 'calling' && S.coach && S.coach.answered ? S.coach.step + 1 : (S.phase === 'shown' || (S.phase === 'calling' && S.coach && S.coach.answered === null) ? 0 : -1);
      var V = boot.scripts.variants[v] || { en: [], lg: [] };
      var steps = V[S.lang] || V.en;
      var auto = autoStage(steps);
      if (S.lastAuto !== auto) { S.lastAuto = auto; S.stageManual = null; }
      var stage = S.stageManual || auto;
      var STAGES = [['before', 'Before the call'], ['greeting', 'Greeting'], ['pitch', 'Pitch'], ['objections', 'Objections'], ['close', 'Close']];
      var stepHtml = function (st, i) { return '<div class="mkc-step' + (i === hiStep ? ' now' : '') + '"><b>' + (i + 1) + '. ' + esc(st[0]) + '</b><p>' + esc(stepText(st, i, ctx)) + '</p></div>'; };
      var objs = ((boot.scripts.objections || {})[task.key] || []);
      var objHtml = function (list) { return list.map(function (o) { return '<div class="mkc-obj"><b>“' + esc(o[0]) + '”</b>' + esc(fillTemplate(o[1], ctx)) + '</div>'; }).join(''); };
      var helloIdx = -1; steps.forEach(function (st, i) { if (st[2] === 'hello' || /hello/i.test(st[0])) helloIdx = i; });
      html += '<div class="mkc-stages">' + STAGES.map(function (x) { return '<button type="button" class="mkc-stage' + (x[0] === stage ? ' on' : '') + (x[0] === auto ? ' auto' : '') + '" data-mkc-stage="' + x[0] + '">' + esc(x[1]) + '</button>'; }).join('') + '</div>'
        + '<div class="mkc-tabs">' + vars.map(function (k2) { return '<button type="button" class="mkc-tab' + (k2 === v ? ' on' : '') + '" data-mkc-var="' + esc(k2) + '">' + esc((boot.scripts.variants[k2] || {}).label || k2) + '</button>'; }).join('')
        + '<button type="button" class="mkc-tab' + (S.lang === 'en' ? ' on' : '') + '" data-mkc-lang="en">English</button><button type="button" class="mkc-tab' + (S.lang === 'lg' ? ' on' : '') + '" data-mkc-lang="lg">Luganda</button></div>'
        + (S.lang === 'lg' ? '<span class="mkc-check-lg">Luganda: ' + esc(boot.scripts.luganda_status) + '</span>' : '');
      if (stage === 'before') {
        var c0 = (S.cur && S.cur.context) || {};
        html += '<div class="mkc-nudge" style="font-size:15px">' + esc(GOAL[task.key] || 'Goal: a close or a payment.') + '</div>'
          + '<div class="mkc-tpl"><b>Know before you dial</b><div>' + esc(c0.source_kind_label || '') + (c0.reason ? ' · ' + esc(c0.reason) : '') + '</div><div>' + (c0.last ? 'Last time: ' + esc(c0.last.what) + (c0.last.note ? ' – ' + esc(c0.last.note) : '') : 'First call to this number.') + '</div><div>' + (c0.said_hello ? '<span class="mkc-good">They already said Hello on WhatsApp ✓</span>' : 'Must ask them to WhatsApp “Hello” to ' + esc(boot.whatsapp_display) + '.') + '</div></div>'
          + '<div class="mkc-muted" style="font-size:12px;margin:6px 0 2px">THE CALL IN ' + steps.length + ' STEPS</div>' + steps.map(function (st, i) { return '<div class="mkc-muted" style="font-size:13px">' + (i + 1) + '. ' + esc(st[0]) + '</div>'; }).join('');
      } else if (stage === 'greeting') {
        html += (steps[0] ? stepHtml(steps[0], 0) : '') + '<div class="mkc-obj"><b>Live notes (optional)</b>“I am taking notes of this call so we get your details right. Is that OK?” Say this before you start live notes.</div>';
      } else if (stage === 'pitch') {
        html += steps.map(function (st, i) { return i > 0 && i !== helloIdx && i < steps.length - 1 ? stepHtml(st, i) : ''; }).join('')
          + (objs.length ? '<div class="mkc-muted" style="font-size:12px;margin:8px 0 2px">IF THEY SAY…</div>' + objHtml(objs.slice(0, 3)) : '');
      } else if (stage === 'objections') {
        html += objHtml(objs) || '<p class="mkc-muted">No objections written for this mode yet.</p>';
      } else {
        html += (helloIdx >= 0 ? stepHtml(steps[helloIdx], helloIdx) : '') + (steps.length ? stepHtml(steps[steps.length - 1], steps.length - 1) : '')
          + '<div class="mkc-closebox"><h4 style="margin:0 0 6px;color:#065f46">' + esc(T('close_title')) + '</h4>' + (boot.close_checks[task.key] || []).map(function (c) { return '<div style="font-size:13px">• ' + esc(c) + '</div>'; }).join('') + '</div>';
      }
      html += (task.key === 'payments' || task.key === 'retention' ? '<div class="mkc-nudge" style="margin-top:10px">MoMo merchant code: <span style="font-size:18px">' + esc(boot.momo_code) + '</span></div>' : '');
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
    qa('[data-mkc-stage]', el).forEach(function (b) { b.onclick = function () { S.stageManual = b.getAttribute('data-mkc-stage'); renderScript(); }; });
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
    refreshPay();
    var p = S.person;
    Promise.all([
      api('/stats?person_key=' + encodeURIComponent(p) + '&session_id=' + encodeURIComponent(S.id)).catch(function () { return null; }),
      api('/feed?person_key=' + encodeURIComponent(p)).catch(function () { return null; }),
      api('/whatsapp').catch(function () { return null; }),
      api('/leads').catch(function () { return null; }),
      api('/counts?person_key=' + encodeURIComponent(p)).catch(function () { return null; })
    ]).then(function (r) {
      if (!S) return;
      if (r[4]) S.counts = r[4];
      if (r[0]) S.stats = r[0];
      if (!S.myAt || Date.now() - S.myAt > 300000) { S.myAt = Date.now(); loadMoney(); }
      if (S.side === 'live') loadLive(function () { renderSide(); });
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
    var tabs = [['live', 'Live'], ['wa', 'WhatsApp'], ['leads', 'Leads'], ['search', '🔎 Search'], ['learn', '📚 Learn'], ['team', 'Team']];
    var html = '<div class="mkc-panel" style="margin-bottom:12px"><div class="mkc-nudge">' + esc(st.next_milestone || feed.nudge || 'Let\'s go.') + '</div>'
      + (st.callbacks_due_now ? '<div class="mkc-nudge" style="background:#dbeafe;color:#1e3a8a">' + st.callbacks_due_now + ' callback' + (st.callbacks_due_now > 1 ? 's' : '') + ' due now. They come first in the queue.</div>' : '')
      + '<div class="mkc-tabs">' + tabs.map(function (t) { return '<button type="button" class="mkc-tab' + (S.side === t[0] ? ' on' : '') + '" data-mkc-side-tab="' + t[0] + '">' + t[1] + (t[0] === 'wa' && S.wa && S.wa.length ? ' ' + S.wa.length : '') + (t[0] === 'leads' && S.leads && S.leads.length ? ' ' + S.leads.length : '') + '</button>'; }).join('') + '</div>';
    if (S.side === 'live') {
      if (!S.live && !S.liveLoading) { S.liveLoading = true; loadLive(function () { S.liveLoading = false; renderSide(); }); }
      html += '<div style="margin-bottom:8px">' + liveCountsHtml(S.live) + '<button type="button" class="mkc-btn sm ghost" style="margin-top:6px;width:100%" data-mkc-live2>🌐 Live site + preview</button></div>';
      var items = (feed.items || []).map(function (i) { return '<div><span class="k">' + esc(kinds[i.kind] || i.kind) + '</span>' + esc(i.text) + ' <span class="mkc-muted">' + esc(kTime(i.at)) + '</span></div>'; }).join('');
      html += '<div class="mkc-feed">' + (items || '<div class="mkc-muted">Nothing new in the last day.</div>') + '</div>';
    } else if (S.side === 'wa') {
      html += '<p class="mkc-muted" style="margin:0 0 6px">Read only. Reply from the company phone; copy a suggested reply from the conversation.</p>'
        + ((S.wa || []).map(function (m) { return '<div class="mkc-wa" data-mkc-wa="' + esc(m.ref) + '"><b>' + esc(m.name || m.phone) + ' <span class="mkc-muted" style="font-weight:600">' + esc(m.name ? m.phone : '') + ' · ' + esc(kDayTime(m.at)) + '</span></b>' + esc(m.text) + (m.called ? '<div class="mkc-muted" style="font-size:11px"><span class="mkc-good">Said Hello ✓</span> · called by ' + esc(personName(m.called.by)) + ': ' + esc(String(m.called.outcome).replace(/_/g, ' ')) + '</div>' : '') + '</div>'; }).join('') || '<div class="mkc-muted">No WhatsApp messages in the last 14 days.</div>');
    } else if (S.side === 'learn') {
      html += learnHtml();
    } else if (S.side === 'search') {
      html += searchBoxHtml('mine');
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
    bindSearch(el);
    var l2 = q('[data-mkc-live2]', el); if (l2) l2.onclick = openLive;
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
    toast('It is 17:00: cash check, then your day');
    openCash(function () { openReport(S ? S.person : ''); }); return;
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
            + '<b>' + esc(kDayTime(n.shown_at)) + ' · ' + esc(personName(n.by)) + ' · ' + esc(String(n.outcome).replace(/_/g, ' ')) + '</b>' + (n.direction === 'inbound' ? ' <span class="mkc-pill in">inbound</span>' : '')
            + '<div class="mkc-muted">' + esc(n.task) + ' · shown ' + esc(kTime(n.shown_at)) + (n.tapped_at ? ' · tapped ' + esc(kTime(n.tapped_at)) : ' · not tapped') + (n.talk_s != null ? ' · ' + n.talk_s + ' s' : '') + (n.login ? ' · login ' + esc(n.login) : '') + ' · <i>' + esc(n.proof) + '</i></div>'
            + (n.note ? '<div>' + esc(n.note) + '</div>' : '') + (n.next_step ? '<div><b>Next step:</b> ' + esc(n.next_step) + '</div>' : (n.type === 'call' && n.outcome !== 'skipped' && !/signed_up|paid|renewed|rejected|do_not_contact|wrong_number|no_answer|shown|calling/.test(n.outcome) && !n.callback_at ? '<div class="mkc-bad">No next step</div>' : ''))
            + (n.transcript ? '<div class="mkc-tpl" style="background:#eff6ff;border-color:#bfdbfe;margin:4px 0"><b>Call notes</b> ' + esc(n.transcript.summary || '') + (n.transcript.suggested_next_step ? ' · suggested: ' + esc(n.transcript.suggested_next_step) : '') + (n.transcript.edited ? ' <span class="mkc-muted">(caller changed it)</span>' : ' <span class="mkc-muted">(confirmed)</span>') + '<details><summary class="mkc-muted">Live notes · ' + (n.transcript.words || 0) + ' words · no audio kept</summary><div style="font-size:12px">' + esc(n.transcript.text || '') + '</div></details></div>' : '')
            + (n.callback_at ? '<div class="mkc-muted">Callback set for ' + esc(kDayTime(n.callback_at)) + '</div>' : '')
            + ((n.flags || []).length ? '<div>' + n.flags.map(function (f) { return '<span class="mkc-pill flag">' + esc(f.replace(/_/g, ' ')) + '</span>'; }).join('') + '</div>' : '')
            + (kids[n.id] ? '<div class="mkc-tree">' + draw(n.id) + '</div>' : '') + '</div>';
        }).join('');
      }
      var wa = (t.whatsapp || []).map(function (w) { return w.n + ' WhatsApp ' + (w.direction === 'inbound' ? 'from them' : 'from us'); }).join(' · ');
      var outreach = (t.outreach || []).map(function (e) { return '<div class="mkc-muted">' + esc(kDayTime(e.at)) + ' · Outreach ' + esc(e.kind) + (e.outcome ? ': ' + esc(String(e.outcome).replace(/_/g, ' ')) : '') + (e.note ? ' – ' + esc(e.note) : '') + '</div>'; }).join('');
      modal('<div class="mkc-row" style="justify-content:space-between"><h3 style="margin:0;font-weight:900">History tree · ' + esc(t.name || '') + ' ' + esc(t.phone_key_masked) + '</h3><button class="mkc-btn sm" data-x>Close</button></div>'
        + (t.blocked ? '<div class="mkc-bad" style="font-weight:900;margin-top:8px">⛔ Do not contact · since ' + esc(kDayTime(t.blocked.at)) + ' by ' + esc(personName(t.blocked.by)) + (t.blocked.reason ? ' – ' + esc(t.blocked.reason) : '') + ' (only King can remove)</div>' : '')
        + '<div class="mkc-nudge" style="margin-top:8px">Pick up here: ' + esc(t.pick_up) + '</div>'
        + (t.decision && (t.decision.decision || t.decision.next_action) ? '<div class="mkc-tpl"><b>King\'s decision:</b> ' + esc(t.decision.decision || '') + (t.decision.next_action ? ' · next: ' + esc(t.decision.next_action) : '') + (t.decision.due ? ' by ' + esc(String(t.decision.due).slice(0, 10)) : '') + '</div>' : '')
        + (t.said_hello ? '<div class="mkc-good" style="font-weight:900">Said Hello ✓ on WhatsApp ' + esc(kDayTime(t.said_hello.at)) + ' (registered as a client)</div>' : '<div class="mkc-muted">Has not said Hello on WhatsApp yet.</div>')
        + ((t.skips || []).length ? '<div class="mkc-muted">Skipped ' + t.skips.length + '×: ' + t.skips.map(function (k) { return esc(kDayTime(k.at)) + ' ' + esc(personName(k.by)) + ' – ' + esc(k.reason || ''); }).join(' · ') + '</div>' : '')
        + (wa ? '<div class="mkc-muted">' + esc(wa) + '</div>' : '') + outreach
        + (t.sms || []).map(function (x) { return '<div class="mkc-muted">' + esc(kDayTime(x.at)) + ' · ✉️ SMS sent (our WhatsApp number, ' + (x.lang === 'lg' ? 'Luganda' : 'English') + ') by ' + esc(personName(x.by)) + '</div>'; }).join('')
        + (t.videos || []).map(function (x) { return '<div class="mkc-muted">' + esc(kDayTime(x.at)) + ' · 🎬 Agent video ' + esc(x.status) + (x.sent_via ? ' (' + esc(x.sent_via.replace(/_/g, ' ')) + ')' : '') + ' · asked by ' + esc(personName(x.by)) + (x.decided_by ? ' · decided by ' + esc(x.decided_by) : '') + (x.opens ? ' · opened ' + x.opens + '×' : '') + '</div>'; }).join('')
        + '<div class="mkc-tree" style="margin-top:8px">' + (draw('root') || '<p class="mkc-muted">No calls yet.</p>') + '</div>', function (m, close) { q('[data-x]', m).onclick = close; });
    }, function (e) { toast(e.message, 'bad'); });
  }

  // ------------------------------------------------------- modals/report --
  // ------------------------------------------------ money on the number --
  function payHtml(a) {
    S.pay = S.pay || {};
    var p = S.pay[a.id];
    if (p === undefined) { S.pay[a.id] = null; loadPay(a); }
    if (!p) return '<div class="mkc-pay" data-mkc-paybox><span class="mkc-muted">💰 Checking payments…</span></div>';
    var col = { confirmed: '#dcfce7;border-color:#86efac', arrived: '#dcfce7;border-color:#86efac', claimed: '#fef9c3;border-color:#fde047', sent: '#eff6ff;border-color:#bfdbfe', none: '#f8fafc;border-color:#e2e8f0' }[p.state] || '#f8fafc';
    var done = p.state === 'confirmed';
    return '<div class="mkc-pay" data-mkc-paybox style="background:' + col + '"><div class="mkc-row" style="justify-content:space-between"><b>💰 ' + esc(p.label) + '</b><span class="mkc-muted">' + ugx(p.amount_ugx) + ' · MoMo ' + esc(p.momo_code) + '</span></div>'
      + (done ? '' : '<div class="mkc-row" style="margin-top:6px"><button type="button" class="mkc-btn sm go" data-pay="link">Send pay link</button><button type="button" class="mkc-btn sm" data-pay="momo">Send MoMo code</button>'
        + (p.state === 'claimed' || p.state === 'arrived' ? '' : '<button type="button" class="mkc-btn sm amber" data-pay="claim">They say they paid</button>') + '</div>')
      + (S.payOut && S.payOut.id === a.id ? S.payOut.html : '') + '</div>';
  }
  function loadPay(a) {
    api('/attempts/' + a.id + '/payment').then(function (p) {
      var before = S && S.pay && S.pay[a.id];
      if (!S) return; S.pay[a.id] = p;
      if (before && before.state !== p.state && (p.state === 'arrived' || p.state === 'confirmed')) { toast('💰 ' + p.label); celebrate(p.state === 'confirmed' ? 'Payment confirmed – well done, ' + personName(S.person) + '!' : 'Money in – well done, ' + personName(S.person) + '!'); }
      var box = q('[data-mkc-paybox]'); if (box && S.cur && S.cur.attempt.id === a.id) { var tmp = document.createElement('div'); tmp.innerHTML = payHtml(a); box.replaceWith(tmp.firstChild); bindPay(q('[data-mkc-num]'), a); }
    }, function () { if (S) S.pay[a.id] = { state: 'none', label: 'Payment status not available', amount_ugx: 50000, momo_code: '27248497' }; });
  }
  function bindPay(el, a) {
    qa('[data-pay]', el).forEach(function (b) {
      b.onclick = function () {
        var k = b.getAttribute('data-pay');
        if (k === 'claim') { openClaim(a); return; }
        b.disabled = true;
        api('/attempts/' + a.id + '/pay', { method: 'POST', body: { how: k, person_key: S.person } }).then(function (r) {
          S.pay[a.id] = r.state;
          S.payOut = { id: a.id, html: r.sent ? '<p style="margin:6px 0 0;color:#047857;font-weight:800">✓ Sent on makaug WhatsApp</p>'
            : '<div class="mkc-tpl" style="margin-top:6px"><b>Not sent automatically</b> <span class="mkc-muted">(' + esc(r.reason || '') + ')</span> – send it yourself:<div style="font-size:12px;white-space:pre-wrap;max-height:90px;overflow:auto">' + esc(r.text) + '</div>'
              + '<div class="mkc-row" style="margin-top:6px"><button type="button" class="mkc-btn sm" data-paycopy>Copy</button><a class="mkc-btn sm go" target="_blank" rel="noopener" href="' + esc(r.wa_url) + '">Open in WhatsApp</a></div></div>' };
          S.payText = r.text; toast(r.sent ? 'Sent' : 'Copy it or open WhatsApp', r.sent ? '' : 'bad');
          renderNum();
        }, function (e) { b.disabled = false; toast(e.message, 'bad'); });
      };
    });
    var pc = q('[data-paycopy]', el); if (pc) pc.onclick = function () { copy(S.payText || ''); };
  }
  function openClaim(a) {
    modal('<h3 style="margin:0 0 4px;font-weight:900">They say they paid</h3><p class="mkc-muted" style="margin:0 0 8px">Admin checks MoMo and confirms. When the money is matched it turns green on this number.</p>'
      + '<input class="mkc-input" style="width:100%;box-sizing:border-box" data-cl-tx placeholder="MoMo transaction ID (if they have it)"><input class="mkc-input" style="width:100%;box-sizing:border-box;margin-top:6px" data-cl-note placeholder="Note, e.g. paid at 3pm from their wife\'s number">'
      + '<div data-cl-err></div><div class="mkc-row" style="margin-top:10px;justify-content:flex-end"><button type="button" class="mkc-btn" data-x>Cancel</button><button type="button" class="mkc-btn go" data-cl-ok>Mark payment claimed</button></div>', function (m, close) {
      q('[data-x]', m).onclick = close;
      q('[data-cl-ok]', m).onclick = function () {
        api('/attempts/' + a.id + '/paid-claim', { method: 'POST', body: { person_key: S.person, txid: q('[data-cl-tx]', m).value, note: q('[data-cl-note]', m).value } }).then(function (r) {
          close(); S.pay[a.id] = r.state; toast(r.matched ? '💰 MoMo already shows it – admin to confirm' : 'Claimed – admin will check MoMo'); renderNum();
        }, function (e) { q('[data-cl-err]', m).innerHTML = '<div class="mkc-err">' + esc(e.message) + '</div>'; });
      };
    });
  }
  function refreshPay() { if (S && S.cur && S.cur.attempt && S.pay && S.pay[S.cur.attempt.id]) loadPay(S.cur.attempt); if (S && S.cur && S.cur.attempt && S.contact && S.contact[S.cur.attempt.id]) loadContact(S.cur.attempt); }

  // ------------------------------------------------- the morning plan --
  function planHtml(r, editable) {
    var p = r.plan; var x = r.result;
    var line = function (label, done, target, hit) { return '<div class="mkc-kit"><div><b>' + label + '</b></div><div><b style="color:' + (hit ? '#047857' : '#0f172a') + '">' + done + '</b> / ' + target + (hit ? ' ✓' : '') + '</div></div>'; };
    var num = function (k, v) { return editable ? '<input class="mkc-input" type="number" min="0" max="500" style="width:70px" data-pl-' + k + ' value="' + esc(v) + '">' : esc(v); };
    return '<div class="mkc-row" style="justify-content:space-between"><h3 style="margin:0;font-weight:900">📋 Today\'s plan · ' + esc(p.day) + '</h3>'
      + (p.agreed_by ? '<span class="mkc-pill live">Agreed with ' + esc(p.agreed_by) + '</span>' : '<span class="mkc-pill flag">Not agreed with King yet</span>') + '</div>'
      + '<div class="mkc-targets" style="grid-template-columns:auto auto auto;margin-top:8px"><span class="mkc-muted">Calls</span><span class="mkc-muted">Closes</span><span class="mkc-muted">Payments</span>'
      + '<b>' + num('calls', p.calls_target) + '</b><b>' + num('closes', p.closes_target) + '</b><b>' + num('pays', p.payments_target || 0) + '</b></div>'
      + '<h4 style="margin:10px 0 4px">Which numbers / what first</h4>' + (editable ? '<input class="mkc-input" style="width:100%;box-sizing:border-box" data-pl-focus value="' + esc(p.focus || '') + '">' : '<div>' + esc(p.focus || '–') + '</div>')
      + '<h4 style="margin:10px 0 4px">What I will achieve today</h4>' + (editable ? '<textarea class="mkc-input" style="width:100%;box-sizing:border-box" rows="2" data-pl-goal placeholder="e.g. 2 unpaid sign-ups pay, 5 new agents interested">' + esc(p.goal || '') + '</textarea>' : '<div>' + esc(p.goal || '–') + '</div>')
      + (editable ? '<h4 style="margin:10px 0 4px">Numbers agreed (optional)</h4><input class="mkc-input" style="width:100%;box-sizing:border-box" data-pl-nums placeholder="Paste numbers, comma separated">' + ((p.numbers || []).length ? '<div class="mkc-muted">Already: ' + esc(p.numbers.join(', ')) + '</div>' : '') : ((p.numbers || []).length ? '<div class="mkc-muted">Numbers: ' + esc(p.numbers.join(', ')) + '</div>' : ''))
      + '<h4 style="margin:12px 0 4px">So far</h4>' + line('Calls', x.calls, p.calls_target, x.calls_hit) + line('Closes', x.closes, p.closes_target, x.closes_hit) + line('Payments in', x.payments, p.payments_target || 0, x.payments_hit)
      + (x.numbers_planned ? line('Agreed numbers called', x.numbers_reached, x.numbers_planned, x.numbers_reached >= x.numbers_planned) : '');
  }
  function planBody(m) {
    var v = function (k) { var e = q('[data-pl-' + k + ']', m); return e ? e.value : undefined; };
    return { calls_target: v('calls'), closes_target: v('closes'), payments_target: v('pays'), focus: v('focus'), goal: v('goal'), numbers: v('nums') || undefined };
  }
  function openPlan(auto) {
    if (!S) return;
    api('/plan?person_key=' + encodeURIComponent(S.person)).then(function (r) {
      S.plan = r; renderDash();
      if (auto && r.plan.saved && r.plan.caller_initials) return;
      var sign = !r.plan.caller_initials;
      modal(planHtml(r, !r.plan.agreed_by) + (sign ? '<h4 style="margin:12px 0 4px">Type your initials to agree the plan</h4><input class="mkc-input" data-pl-ini maxlength="4" style="width:90px;text-transform:uppercase" placeholder="RO">' : '')
        + '<div data-pl-err></div><div class="mkc-row" style="margin-top:12px;justify-content:flex-end"><button type="button" class="mkc-btn" data-x>' + (sign ? 'Later' : 'Close') + '</button>' + (sign || !r.plan.agreed_by ? '<button type="button" class="mkc-btn go" data-pl-save>' + (sign ? 'Agree and start' : 'Save plan') + '</button>' : '') + '</div>', function (m, close) {
        q('[data-x]', m).onclick = close;
        var sv = q('[data-pl-save]', m); if (sv) sv.onclick = function () {
          var b = r.plan.agreed_by ? {} : planBody(m); var ini = q('[data-pl-ini]', m);
          if (sign && (!ini || ini.value.replace(/[^A-Za-z]/g, '').length < 2)) { q('[data-pl-err]', m).innerHTML = '<div class="mkc-err">Type your initials (2–4 letters).</div>'; return; }
          b.person_key = S.person; b.initials = ini ? ini.value : '';
          if (r.plan.agreed_by) { b.calls_target = r.plan.calls_target; b.closes_target = r.plan.closes_target; b.payments_target = r.plan.payments_target; b.focus = r.plan.focus; b.goal = r.plan.goal; }
          api('/plan', { method: 'POST', body: b }).then(function (r2) { S.plan = r2; close(); toast('Plan saved'); renderDash(); }, function (e) { q('[data-pl-err]', m).innerHTML = '<div class="mkc-err">' + esc(e.message) + '</div>'; });
        };
      });
    }, function () { /* plan is optional if the server can't load it */ });
  }

  // ------------------------------------------------- the 17:00 cash check --
  function openCash(after) {
    api('/cash').then(function (c) {
      if (c.done) { if (after) after(); return; }
      var today = c.day;
      var rowsH = c.accounts.map(function (a) {
        if (a.signed) return '<div class="mkc-kit"><div><b>' + esc(a.name) + '</b></div><div class="mkc-muted">Signed ' + esc(a.signed.initials) + ' ✓</div></div>';
        return '<div class="mkc-tpl" style="margin:6px 0"><b>' + esc(a.name) + (a.main ? ' <span class="mkc-pill live">main bank</span>' : '') + '</b>' + (a.last ? ' <span class="mkc-muted">last: ' + esc(a.currency) + ' ' + Number(a.last.balance_ugx).toLocaleString('en-GB') + ' on ' + esc(a.last.day) + '</span>' : '')
          + '<div class="mkc-row" style="margin-top:4px"><label class="mkc-muted">Balance (' + esc(a.currency) + ')<br><input class="mkc-input" inputmode="numeric" style="width:130px" data-cb="' + esc(a.key) + '"></label>'
          + '<label class="mkc-muted">Date<br><input class="mkc-input" type="date" data-cd="' + esc(a.key) + '" value="' + esc(today) + '"></label>'
          + (a.main ? '' : '<label class="mkc-muted">Moved out today (to the bank)<br><input class="mkc-input" inputmode="numeric" style="width:130px" data-ct="' + esc(a.key) + '" value="0"></label>') + '</div></div>';
      }).join('');
      var m0 = document.createElement('div');
      modal('<h3 style="margin:0 0 4px;font-weight:900">🔒 End-of-day cash check · ' + esc(today) + '</h3><p class="mkc-muted" style="margin:0 0 6px">Must be done before you close the day. Enter each company account\'s balance, then sign with your initials. It goes to King\'s daily log.</p>'
        + rowsH + '<div class="mkc-row" style="margin-top:8px"><label><b>Your initials</b><br><input class="mkc-input" data-cini maxlength="4" style="width:90px;text-transform:uppercase"></label><label style="flex:1"><b>Note (optional)</b><br><input class="mkc-input" style="width:100%;box-sizing:border-box" data-cnote></label></div>'
        + '<div data-cerr></div><div class="mkc-row" style="margin-top:12px;justify-content:flex-end"><button type="button" class="mkc-btn" data-x>Not now</button><button type="button" class="mkc-btn go" data-csave>Sign and confirm</button></div>', function (m, close) {
        q('[data-x]', m).onclick = function () { close(); toast('The cash check is still needed before you close the day.', 'bad'); };
        q('[data-csave]', m).onclick = function () {
          var note = q('[data-cnote]', m).value;
          var entries = c.accounts.filter(function (a) { return !a.signed; }).map(function (a) {
            var t = q('[data-ct="' + a.key + '"]', m);
            return { account_key: a.key, balance_ugx: q('[data-cb="' + a.key + '"]', m).value.replace(/[^\d.-]/g, ''), balance_date: q('[data-cd="' + a.key + '"]', m).value, transferred_ugx: t ? t.value.replace(/[^\d.]/g, '') : 0, note: note };
          });
          api('/cash', { method: 'POST', body: { person_key: S ? S.person : '', initials: q('[data-cini]', m).value, entries: entries } }).then(function (r) {
            if (!r.done) { q('[data-cerr]', m).innerHTML = '<div class="mkc-err">Some accounts are still missing.</div>'; return; }
            close(); toast('Cash check signed ✓'); if (S) ev('action', 'cash_check_signed'); if (after) after();
          }, function (e) { q('[data-cerr]', m).innerHTML = '<div class="mkc-err">' + esc(e.message) + '</div>'; });
        };
      });
      void m0;
    }, function (e) { toast(e.message, 'bad'); });
  }

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
  var HOW_KNOWN = ['Friend or referral', 'Saw their listing', 'Sign board', 'Social media', 'Met them', 'Other'];
  function openAddNumber() {
    var field = function (attr, ph, extra) { return '<input class="mkc-input" style="width:100%;box-sizing:border-box;margin:4px 0" ' + attr + ' placeholder="' + esc(ph) + '"' + (extra || '') + '>'; };
    var cur = S ? S.task : 'new_agents';
    modal('<h3 style="margin:0 0 4px;font-weight:900">➕ Add a number</h3><p class="mkc-muted" style="margin:0 0 6px">It goes straight into your queue as <b>your own number</b>. Numbers we already have are caught and their history is shown instead.</p>'
      + field('data-n', 'Name') + field('data-p', 'Phone, e.g. 0772 123 456', ' inputmode="tel"')
      + '<div class="mkc-row"><label class="mkc-muted" style="flex:1">How you know them<br><select class="mkc-input" style="width:100%" data-h>' + HOW_KNOWN.map(function (h) { return '<option>' + esc(h) + '</option>'; }).join('') + '</select></label>'
      + '<label class="mkc-muted" style="flex:1">Mode<br><select class="mkc-input" style="width:100%" data-md>' + ((boot && boot.tasks) || [{ key: 'new_agents', name: 'Get new agents' }]).map(function (t) { return '<option value="' + esc(t.key) + '"' + (t.key === cur ? ' selected' : '') + '>' + esc(MODE_LABEL[t.key] || t.name) + '</option>'; }).join('') + '</select></label></div>'
      + field('data-t', 'Note (optional), e.g. has 5 rentals in Kira')
      + '<div data-e></div><div class="mkc-row" style="margin-top:10px;justify-content:flex-end"><button type="button" class="mkc-btn" data-x>Close</button><button type="button" class="mkc-btn go" data-ok>Add to my queue</button></div>', function (m, close) {
      q('[data-x]', m).onclick = close;
      q('[data-ok]', m).onclick = function () {
        var mode = q('[data-md]', m).value;
        api('/numbers', { method: 'POST', body: { person_key: S ? S.person : pick.person, name: q('[data-n]', m).value, phone: q('[data-p]', m).value, note: q('[data-t]', m).value, how_known: q('[data-h]', m).value, mode: mode } }).then(function (d) {
          if (d.status === 'exists') {
            var hist = (d.history || []).map(function (h) { return '<li><b>' + esc(kDayTime(h.at)) + '</b> · ' + esc(personName(h.by)) + ' · ' + esc(String(h.outcome || '').replace(/_/g, ' ')) + (h.note ? ' – ' + esc(h.note) : '') + (h.callback_at ? ' · call back ' + esc(kDayTime(h.callback_at)) : '') + '</li>'; }).join('');
            q('[data-e]', m).innerHTML = '<div class="mkc-tpl" style="background:#fef3c7;border-color:#fde68a;margin-top:8px"><b>We already have ' + esc(d.phone) + '</b> – ' + esc(d.duplicate_of) + '. Not added again.'
              + (d.owner ? '<div>Own number of ' + esc(personName(d.owner.person_key)) + ' since ' + esc(kDayTime(d.owner.added_at)) + '.</div>' : '')
              + (hist ? '<div style="margin-top:4px"><b>History</b><ul style="margin:4px 0 0 18px;padding:0">' + hist + '</ul></div>' : '<div class="mkc-muted">Not called yet. It is already in a queue.</div>') + '</div>';
            return;
          }
          q('[data-e]', m).innerHTML = '<div class="mkc-nudge">✓ Added to your queue (' + esc(MODE_LABEL[d.mode] || d.mode) + ') as your own number.</div>';
          q('[data-p]', m).value = ''; q('[data-n]', m).value = ''; q('[data-t]', m).value = '';
          if (S) { if (S.phase === 'empty' && mode === S.task) next(); api('/counts?person_key=' + encodeURIComponent(S.person)).then(function (c) { S.counts = c; renderTop(); }, function () {}); }
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
  // ---- v4: my money, search, incoming calls, calls summary, do-not-contact
  function fmtCountdown(c) { return c ? (c.days > 0 ? c.days + 'd ' : '') + (c.hours || 0) + 'h' : ''; }
  function loadMoney() {
    if (!S) return;
    api('/my-money?person_key=' + encodeURIComponent(S.person)).then(function (m) { if (!S) return; S.my = m; renderDash(); }, function () {});
  }
  function myMoneyCard() {
    var m = S.my; if (!m) return '';
    return '<div class="mkc-dcard mkc-money" style="cursor:pointer;min-width:200px" data-mkc-money title="My money"><div style="flex:1"><b>' + ugx(m.due_next_payday_ugx) + '</b><span>due on the ' + esc(String(m.next_payday || '').slice(8, 10)) + 'th · in ' + esc(fmtCountdown(m.countdown)) + '</span>'
      + '<div class="mkc-muted" style="font-size:11px">Earned ' + ugx(m.earned_ugx) + ' · on hold ' + ugx(m.on_hold_ugx) + '</div></div></div>';
  }
  function openMoney() {
    var m = S.my || {};
    var rows = (m.agents || []).map(function (a) { return '<tr><td>' + esc(a.name) + ' <span class="mkc-muted">' + esc(a.phone || '') + '</span></td><td><span class="mkc-pill' + (a.status === 'eligible' ? ' live' : '') + '">' + esc(a.status_label || a.status) + '</span></td><td>' + ugx(a.amount_ugx) + '</td><td class="mkc-muted">' + esc(a.reason || '') + '</td></tr>'; }).join('');
    modal('<div class="mkc-row" style="justify-content:space-between"><h3 style="margin:0;font-weight:900">💰 My money</h3><button class="mkc-btn sm" data-x>Close</button></div>'
      + '<div class="mkc-grid" style="padding:0;margin-top:10px;grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">'
      + [['Earned (confirmed)', m.earned_ugx], ['On hold (' + (m.hold_days || 7) + ' days)', m.on_hold_ugx], ['Due on the ' + String(m.next_payday || '').slice(8, 10) + 'th', m.due_next_payday_ugx], ['Paid to you so far', m.paid_to_date_ugx]].map(function (x) { return '<div class="mkc-dcard"><div><b>' + ugx(x[1]) + '</b><span>' + esc(x[0]) + '</span></div></div>'; }).join('') + '</div>'
      + '<p class="mkc-muted">Next payday ' + esc(m.next_payday || '') + ' (in ' + esc(fmtCountdown(m.countdown)) + '). Agents count once their first payment is confirmed and has cleared the ' + (m.hold_days || 7) + '-day hold. Same numbers King sees.</p>'
      + '<h4>Agents counted (' + (m.agents || []).length + ')</h4>' + (rows ? '<div class="mkc-scroll"><table class="mkc-table"><tr><th>Agent</th><th>Status</th><th>Commission</th><th></th></tr>' + rows + '</table></div>' : '<p class="mkc-muted">None yet. Every confirmed paying agent you bring shows up here.</p>'), function (m, close) { q('[data-x]', m).onclick = close; });
  }
  function searchBoxHtml(scope) {
    return '<div data-mkc-search="' + scope + '"><input type="search" class="mkc-input" style="width:100%;box-sizing:border-box" placeholder="Search notes, names, outcomes, last digits…" data-mkc-q value="' + esc((S && S.q) || '') + '"><div data-mkc-hits class="mkc-scroll" style="max-height:420px"></div></div>';
  }
  function hitsHtml(r) {
    var w = String(r.q || '').toLowerCase().split(/\s+/).filter(function (x) { return x.length > 1; });
    var mark = function (s) { var h = esc(s); w.forEach(function (x) { h = h.replace(new RegExp('(' + x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig'), '<mark>$1</mark>'); }); return h; };
    return (r.results || []).map(function (h) {
      return '<div class="mkc-hit" data-mkc-hit="' + esc(h.id) + '"><b>' + esc(h.name || 'Unknown') + ' ' + esc(h.phone) + '</b> ' + (h.direction === 'inbound' ? '<span class="mkc-pill in">inbound</span> ' : '') + '<span class="mkc-pill">' + esc(String(h.outcome || '').replace(/_/g, ' ')) + '</span>'
        + '<div class="mkc-muted" style="font-size:11px">' + esc(kDayTime(h.at)) + ' · ' + esc(personName(h.by)) + '</div><div>' + mark(h.snippet || h.summary) + '</div>' + (h.next_step ? '<div class="mkc-muted"><b>Next:</b> ' + esc(h.next_step) + '</div>' : '') + '</div>';
    }).join('') || (r.q ? '<div class="mkc-muted">Nothing found for “' + esc(r.q) + '”.</div>' : '');
  }
  function bindSearch(root) {
    var box = q('[data-mkc-search]', root); if (!box) return;
    var inp = q('[data-mkc-q]', box); var out = q('[data-mkc-hits]', box); var tmr;
    var run = function () {
      var v = inp.value.trim(); if (S) S.q = v;
      if (v.length < 2) { out.innerHTML = '<div class="mkc-muted" style="margin-top:6px">Type 2+ letters, or the last 3+ digits of a number.</div>'; return; }
      api('/search?q=' + encodeURIComponent(v)).then(function (r) { out.innerHTML = hitsHtml(r); qa('[data-mkc-hit]', out).forEach(function (b) { b.onclick = function () { openTimeline({ attempt_id: b.getAttribute('data-mkc-hit') }); }; }); }, function (e) { out.innerHTML = '<div class="mkc-err">' + esc(e.message) + '</div>'; });
    };
    inp.oninput = function () { clearTimeout(tmr); tmr = setTimeout(run, 300); };
    run();
  }
  function openInbound() {
    if (!S) return;
    if (S.phase === 'calling' || S.phase === 'wrapup') { toast('Finish the wrap-up for this call first.'); return; }
    modal('<div class="mkc-row" style="justify-content:space-between"><h3 style="margin:0;font-weight:900">📲 Incoming call</h3><button class="mkc-btn sm" data-x>Close</button></div>'
      + '<p class="mkc-muted">You answered in Phone Link. Type the number shown in Phone Link, or a name / last digits to pick someone you spoke to before. The timer and notes start when you press Start.</p>'
      + '<input class="mkc-input" style="width:100%;box-sizing:border-box;font-size:20px" inputmode="tel" placeholder="0772 123 456" data-in-phone>'
      + '<div class="mkc-row" style="margin-top:6px" data-in-picks></div>'
      + '<input class="mkc-input" style="width:100%;box-sizing:border-box;margin-top:6px" placeholder="Their name (if new)" data-in-name>'
      + '<div data-in-who style="margin-top:8px"></div><div data-in-err></div>'
      + '<button type="button" class="mkc-btn go" style="width:100%;margin-top:10px;font-size:18px" data-in-go>▶ Start incoming call</button>', function (m, close) {
    q('[data-x]', m).onclick = close;
    var from = null;
    var ph = q('[data-in-phone]', m); var who = q('[data-in-who]', m); var tmr;
    var look = function () {
      var dg = ph.value.replace(/\D/g, ''); from = null;
      var pk = q('[data-in-picks]', m);
      if (dg.length < 9) {
        who.innerHTML = '';
        if (ph.value.trim().length < 2) { pk.innerHTML = ''; return; }
        api('/search?q=' + encodeURIComponent(ph.value.trim())).then(function (r) {
          var seen = {}; var list = (r.results || []).filter(function (h) { var k = h.name + h.phone; if (seen[k]) return false; seen[k] = 1; return true; }).slice(0, 6);
          pk.innerHTML = list.map(function (h) { return '<button type="button" class="mkc-btn sm ghost" data-in-pick="' + esc(h.id) + '">' + esc((h.name || 'Unknown') + ' ' + h.phone) + '</button>'; }).join('');
          qa('[data-in-pick]', pk).forEach(function (b) { b.onclick = function () { from = b.getAttribute('data-in-pick'); qa('[data-in-pick]', pk).forEach(function (x) { x.classList.toggle('dark', x === b); }); who.innerHTML = '<div class="mkc-tpl">Picked ' + esc(b.textContent) + ' · <button type="button" class="mkc-btn sm ghost" data-in-tree>Full history</button></div>'; q('[data-in-tree]', who).onclick = function () { openTimeline({ attempt_id: from }); }; }; });
        }, function () {});
        return;
      }
      api('/lookup?phone=' + encodeURIComponent(ph.value)).then(function (r) {
        if (!r.found) { who.innerHTML = '<div class="mkc-tpl">New caller – no history with us. Ask their name and how they heard of makaug.</div>'; return; }
        var n = q('[data-in-name]', m); if (r.name && !n.value) n.value = r.name;
        who.innerHTML = (r.blocked ? '<div class="mkc-bad" style="font-weight:900">⛔ On the do-not-contact list' + (r.blocked.reason ? ': ' + esc(r.blocked.reason) : '') + '. They rang us, so you can talk, but do not call them back.</div>' : '')
          + '<div class="mkc-tpl"><b>' + esc(r.name || 'Known number') + ' ' + esc(r.phone) + '</b> · ' + r.calls + ' call' + (r.calls === 1 ? '' : 's') + (r.inbound ? ' (' + r.inbound + ' inbound)' : '') + (r.said_hello ? ' · said Hello ✓' : '')
          + (r.last ? '<div>Last: ' + esc(kDayTime(r.last.at)) + ' · ' + esc(personName(r.last.by)) + ' · ' + esc(String(r.last.outcome || '').replace(/_/g, ' ')) + (r.last.summary || r.last.note ? ' – ' + esc(r.last.summary || r.last.note) : '') + '</div>' : '')
          + (r.last && r.last.next_step ? '<div><b>Next step was:</b> ' + esc(r.last.next_step) + '</div>' : '') + '<div class="mkc-muted">' + esc(r.pick_up || '') + '</div>'
          + (r.last_attempt_id ? '<button type="button" class="mkc-btn sm ghost" data-in-tree>Full history</button>' : '') + '</div>';
        var tb = q('[data-in-tree]', who); if (tb) tb.onclick = function () { openTimeline({ attempt_id: r.last_attempt_id }); };
      }, function () {});
    };
    ph.oninput = function () { clearTimeout(tmr); tmr = setTimeout(look, 250); };
    setTimeout(function () { ph.focus(); }, 30);
    q('[data-in-go]', m).onclick = function () {
      var err = q('[data-in-err]', m); err.innerHTML = '';
      api('/sessions/' + S.id + '/inbound', { method: 'POST', body: { phone: from ? '' : ph.value, from_attempt: from, name: q('[data-in-name]', m).value } }).then(function (r) {
        ev('inbound_start'); close(); if (r && r.blocked) toast('On the do-not-contact list: talk, but do not call back.'); next();
      }, function (e) { err.innerHTML = '<div class="mkc-err">' + esc(e.message) + '</div>'; });
    };
    });
  }
  function drawKCalls(host) {
    var box = q('[data-k-calls]', host); if (!box) return;
    api('/calls-summary?period=' + K.callsPeriod).then(function (r) {
      var line = function (i) { return '<div class="mkc-hit" style="cursor:default"><b>' + esc(i.name || 'Unknown') + ' ' + esc(i.phone) + '</b> ' + (i.direction === 'inbound' ? '<span class="mkc-pill in">inbound</span> ' : '') + '<span class="mkc-pill">' + esc(String(i.outcome || '').replace(/_/g, ' ')) + '</span> <span class="mkc-muted">' + esc(kDayTime(i.at)) + ' · ' + esc(personName(i.by)) + '</span>' + (i.summary ? '<div>' + esc(i.summary) + '</div>' : '') + (i.next_step ? '<div><b>Next:</b> ' + esc(i.next_step) + (i.callback_at ? ' · ' + esc(kDayTime(i.callback_at)) : '') + '</div>' : '') + '</div>'; };
      var col = function (title, list, empty) { return '<div><h4>' + title + ' (' + list.length + ')</h4><div class="mkc-scroll" style="max-height:320px">' + (list.map(line).join('') || '<p class="mkc-muted">' + empty + '</p>') + '</div></div>'; };
      var ppl = Object.keys(r.by_person).map(function (k) { var p = r.by_person[k]; return '<span class="mkc-pill">' + esc(personName(k)) + ': ' + p.outbound + ' out · ' + p.inbound + ' in · ' + p.closes + ' closed</span>'; }).join(' ');
      var outs = Object.keys(r.outcomes).map(function (k) { return esc(k.replace(/_/g, ' ')) + ' ' + r.outcomes[k]; }).join(' · ');
      box.innerHTML = '<div class="mkc-row" style="justify-content:space-between"><h4 style="margin:0">🗂 Calls summary · ' + esc(r.from) + (r.to !== r.from ? ' → ' + esc(r.to) : '') + '</h4>' + periodTabs('data-k-callsper', K.callsPeriod) + '</div>'
        + '<div style="margin:6px 0"><b>' + r.calls + ' calls</b> (' + r.outbound + ' outbound · ' + r.inbound + ' inbound) · ' + r.skipped + ' skipped · ' + r.closed.length + ' closed' + (r.no_next_step.length ? ' · <span class="mkc-bad">' + r.no_next_step.length + ' with no next step</span>' : '') + '</div>'
        + '<div class="mkc-muted">' + outs + '</div><div style="margin:4px 0">' + ppl + '</div>'
        + '<div class="mkc-grid" style="padding:0;grid-template-columns:repeat(auto-fit,minmax(260px,1fr))">' + col('✅ Closed', r.closed, 'Nothing closed.') + col('⏳ Open – next steps', r.open, 'No open loops.') + col('💬 What was discussed', r.discussed, 'No call notes.') + '</div>'
        + '<h4>🔎 Search all calls</h4>' + searchBoxHtml('all');
      qa('[data-k-callsper]', box).forEach(function (b) { b.onclick = function () { K.callsPeriod = b.getAttribute('data-k-callsper'); drawKCalls(host); }; });
      bindSearch(box);
    }, function (e) { box.innerHTML = '<div class="mkc-err">' + esc(e.message) + '</div>'; });
  }
  function drawKBlocks(host) {
    var box = q('[data-k-blocks]', host); if (!box) return;
    api('/blocks').then(function (list) {
      box.innerHTML = '<h4 style="margin:0 0 6px">⛔ Do not contact (' + list.length + ')</h4><p class="mkc-muted" style="margin:0 0 6px">Blocked everywhere: queues, callbacks, the Companion\'s list, leads, listings, Outreach and added numbers. Only you can remove one.</p>'
        + (list.length ? '<div class="mkc-scroll"><table class="mkc-table"><tr><th>Number</th><th>Why</th><th>By</th><th>Since</th><th></th></tr>' + list.map(function (b) { return '<tr><td><b>' + esc(b.name || '') + '</b> ' + esc(b.phone) + '</td><td>' + esc(b.reason || '') + '</td><td>' + esc(personName(b.by)) + '</td><td>' + esc(kDayTime(b.at)) + '</td><td><button type="button" class="mkc-btn sm ghost" data-k-unblock="' + esc(b.phone_key) + '">Remove block</button></td></tr>'; }).join('') + '</table></div>' : '<p class="mkc-muted">Nobody blocked.</p>');
      qa('[data-k-unblock]', box).forEach(function (b) { b.onclick = function () {
        if (!window.confirm('Remove the do-not-contact block? They can be called again.')) return;
        api('/blocks/' + b.getAttribute('data-k-unblock') + '/remove', { method: 'POST', body: { note: 'Removed by King' } }).then(function () { toast('Block removed'); drawKBlocks(host); }, function (e) { toast(e.message); });
      }; });
    }, function (e) { box.innerHTML = '<div class="mkc-err">' + esc(e.message) + '</div>'; });
  }
  // ---- SMS from the company SIM + agent video unlock
  function contactHtml(a) {
    S.contact = S.contact || {};
    var c = S.contact[a.id];
    if (c === undefined) { S.contact[a.id] = null; loadContact(a); }
    if (!c) return '<div class="mkc-pay" data-mkc-contact><span class="mkc-muted">✉️ …</span></div>';
    var sms = function (lang, label) { return '<a class="mkc-btn sm" style="text-decoration:none" href="sms:' + esc(String(a.phone || '').replace(/\s+/g, '')) + '?body=' + encodeURIComponent(c.sms_text[lang]) + '" data-sms="' + lang + '">' + label + '</a>'; };
    var v;
    if (c.locked) v = '<div class="mkc-muted" style="margin-top:6px">🔒 <b>Send agent video</b> – locked until they message our WhatsApp. Text them the number above and ask them to send "Hi".</div>';
    else if (c.open && c.open.status === 'requested') v = '<div style="margin-top:6px">⏳ <b>Video requested</b> – waiting for King to approve.</div>';
    else if (c.open && c.open.status === 'approved') v = '<div style="margin-top:6px">✅ Approved – being sent from makaug\'s WhatsApp.</div>';
    else v = '<div class="mkc-row" style="margin-top:6px"><span class="mkc-good" style="font-weight:800">🔓 They messaged us ' + esc(kDayTime(c.hello.at)) + '</span><select class="mkc-select" style="font-size:12px;padding:4px" data-vid>' + c.videos.map(function (x) { return '<option value="' + esc(x.key) + '">' + esc(x.title) + '</option>'; }).join('') + '</select><button type="button" class="mkc-btn sm dark" data-vreq>🎬 Request video send</button></div>'
      + (c.sent ? '<div class="mkc-muted">Video sent before (' + c.sent + '×).</div>' : '');
    return '<div class="mkc-pay" data-mkc-contact style="background:#f8fafc"><div class="mkc-row" style="justify-content:space-between"><b>✉️ Text them our WhatsApp number</b><span class="mkc-muted">' + (c.sms.length ? 'SMS sent ' + esc(kDayTime(c.sms[0].at)) : 'from the company SIM') + '</span></div>'
      + '<div class="mkc-row" style="margin-top:6px">' + sms('en', 'SMS in English') + sms('lg', 'SMS mu Luganda') + '<button type="button" class="mkc-btn sm ghost" data-smscopy>Copy text</button></div>' + v + '<div data-cerr></div></div>';
  }
  function loadContact(a) {
    api('/attempts/' + a.id + '/contact').then(function (c) {
      if (!S) return; S.contact[a.id] = c;
      var box = q('[data-mkc-contact]'); if (box && S.cur && S.cur.attempt.id === a.id) { var tmp = document.createElement('div'); tmp.innerHTML = contactHtml(a); box.replaceWith(tmp.firstChild); bindContact(q('[data-mkc-num]'), a); }
    }, function () {});
  }
  function bindContact(el, a) {
    var box = q('[data-mkc-contact]', el); if (!box) return;
    qa('[data-sms]', box).forEach(function (b) { b.addEventListener('click', function () {
      op('/attempts/' + a.id + '/sms', { person_key: S.person, lang: b.getAttribute('data-sms') }).then(function () { ev('action', 'sms_sent'); toast('SMS logged. Send it in Phone Link / on the phone.'); loadContact(a); }, function () {});
    }); });
    var cp = q('[data-smscopy]', box); if (cp) cp.onclick = function () { var c = S.contact[a.id]; copyText((S.lang === 'lg' ? c.sms_text.lg : c.sms_text.en)); };
    var vr = q('[data-vreq]', box); if (vr) vr.onclick = function () {
      op('/attempts/' + a.id + '/video-request', { person_key: S.person, video_key: q('[data-vid]', box).value }).then(function () { ev('action', 'video_requested'); toast('Sent to King for approval'); loadContact(a); }, function (e) { q('[data-cerr]', box).innerHTML = '<div class="mkc-err">' + esc(e.message) + '</div>'; });
    };
  }
  function copyText(t) {
    try { navigator.clipboard.writeText(t).then(function () { toast('Copied'); }, function () { window.prompt('Copy this:', t); }); } catch (_) { window.prompt('Copy this:', t); }
  }
  function drawKVideos(host) {
    var box = q('[data-k-videos]', host); if (!box) return;
    api('/videos').then(function (list) {
      var waiting = list.filter(function (r) { return r.status === 'requested' || r.status === 'approved'; });
      box.innerHTML = '<h4 style="margin:0 0 6px">🎬 Agent video requests (' + waiting.length + ' waiting)</h4><p class="mkc-muted" style="margin:0 0 6px">Only numbers that messaged our WhatsApp first can be requested. Approve sends a ref-tagged link from makaug\'s WhatsApp; if that sender is off, copy it or open WhatsApp and send by hand.</p>'
        + (list.length ? '<div class="mkc-scroll"><table class="mkc-table"><tr><th>Who</th><th>Video</th><th>Asked by</th><th>Status</th><th></th></tr>' + list.slice(0, 30).map(function (r) {
          var act = r.status === 'requested' ? '<button type="button" class="mkc-btn sm go" data-kv-ok="' + esc(r.id) + '">Approve & send</button> <button type="button" class="mkc-btn sm ghost" data-kv-no="' + esc(r.id) + '">Reject</button>'
            : r.status === 'approved' && r.fallback ? '<div class="mkc-muted">' + esc(r.send_reason || 'Not sent automatically') + '</div><a class="mkc-btn sm" target="_blank" rel="noopener" href="' + esc(r.fallback.wa_url) + '">Open WhatsApp</a> <button type="button" class="mkc-btn sm ghost" data-kv-copy="' + esc(r.id) + '">Copy</button> <button type="button" class="mkc-btn sm dark" data-kv-sent="' + esc(r.id) + '">Mark sent</button>' : '';
          return '<tr><td><b>' + esc(r.name || '') + '</b> ' + esc(r.phone) + '<div class="mkc-muted">messaged us ' + esc(kDayTime(r.hello_at)) + '</div></td><td>' + esc(r.video) + '<div class="mkc-muted">ref ' + esc(r.ref) + (r.opens ? ' · opened ' + r.opens + '×' : '') + '</div></td><td>' + esc(personName(r.by)) + '<div class="mkc-muted">' + esc(kDayTime(r.requested_at)) + '</div></td><td><span class="mkc-pill' + (r.status === 'sent' ? ' live' : r.status === 'rejected' ? ' flag' : ' warn') + '">' + esc(r.status) + '</span>' + (r.sent_via ? '<div class="mkc-muted">' + esc(r.sent_via.replace(/_/g, ' ')) + '</div>' : '') + '</td><td>' + act + '</td></tr>';
        }).join('') + '</table></div>' : '<p class="mkc-muted">No requests yet.</p>');
      var dec = function (id, ok) { api('/videos/' + id + '/decide', { method: 'POST', body: { approve: ok } }).then(function (r) { toast(r.status === 'sent' ? 'Sent from makaug WhatsApp' : r.status === 'approved' ? 'Approved – send it by hand (sender off)' : 'Rejected'); drawKVideos(host); }, function (e) { toast(e.message); }); };
      qa('[data-kv-ok]', box).forEach(function (b) { b.onclick = function () { dec(b.getAttribute('data-kv-ok'), true); }; });
      qa('[data-kv-no]', box).forEach(function (b) { b.onclick = function () { dec(b.getAttribute('data-kv-no'), false); }; });
      qa('[data-kv-copy]', box).forEach(function (b) { b.onclick = function () { var r = list.filter(function (x) { return x.id === b.getAttribute('data-kv-copy'); })[0]; if (r) copyText(r.fallback.text); }; });
      qa('[data-kv-sent]', box).forEach(function (b) { b.onclick = function () { api('/videos/' + b.getAttribute('data-kv-sent') + '/sent', { method: 'POST', body: {} }).then(function () { drawKVideos(host); }, function (e) { toast(e.message); }); }; });
    }, function (e) { box.innerHTML = '<div class="mkc-err">' + esc(e.message) + '</div>'; });
  }
  // ---- Learn: for every new employee
  function learnHtml() {
    var L = function (u, t) { return '<a href="' + u + '" target="_blank" rel="noopener">' + t + '</a>'; };
    var sec = function (title, body, open) { return '<details class="mkc-learn"' + (open ? ' open' : '') + '><summary><b>' + title + '</b></summary><div>' + body + '</div></details>'; };
    var lg = function (t) { return '<div class="mkc-lg">🗣 <i>' + t + '</i></div>'; };
    return '<div class="mkc-scroll" style="max-height:560px">'
      + sec('1. About makaug.com', '<p><b>makaug.com is Uganda\'s property search.</b> We gather every house, plot, rental and short stay we can find online into one search, check them before they go live, and people contact the owner or agent directly, for free.</p>'
        + '<p><b>Aggregator model:</b> many listings are "found online" (we show where they came from and send people to the original poster). Agents and owners who join get their own listings, their name and phone on them, and the enquiries.</p>'
        + '<p><b>Prices:</b> agents <b>UGX 50,000 a month</b> (all their listings, short stays included). Owners <b>UGX 20,000 a month</b> per listing. No free trial. Pay by <b>MoMo merchant code 27248497</b>, then send the confirmation on WhatsApp to <b>0780 863 394</b>.</p>'
        + lg('makaug.com gwe mukutu ogukuŋŋaanya amayumba, ettaka n\'ebisulo byonna mu Uganda mu kifo kimu.') + lg('Ba agent basasula UGX 50,000 buli mwezi; bannannyini mayumba UGX 20,000. Musasule ku MoMo merchant code 27248497.')
        + '<p>Read: ' + L('https://makaug.com/about', 'About & prices') + ' · ' + L('https://makaug.com/how-it-works', 'How it works') + '</p>', true)
      + sec('2. How the site works (real examples)', '<ul>'
        + '<li><b>Search by area:</b> ' + L('https://makaug.com/to-rent/ntinda-kampala', 'To rent in Ntinda') + ' · ' + L('https://makaug.com/for-sale/kololo-kampala', 'For sale in Kololo') + ' · ' + L('https://makaug.com/land', 'Land') + ' · ' + L('https://makaug.com/commercial', 'Commercial') + ' · ' + L('https://makaug.com/student-accommodation', 'Students') + '</li>'
        + '<li><b>A listing page:</b> ' + L('https://makaug.com/property/1db66e25-2ef4-47dd-9863-ff7ccbc4255f', 'Land for sale in Wakiso, UGX 45M/acre') + ' – photos, price, area, and the contact button.</li>'
        + '<li><b>An agent profile:</b> ' + L('https://makaug.com/agents/a93b28af-3562-4a36-8bb4-a773287eb045', 'Katamba Bonny') + ' – every listing of one agent in one place. ' + L('https://makaug.com/brokers', 'Find a broker') + ' lists the agents.</li>'
        + '<li><b>How listing works:</b> ' + L('https://makaug.com/list-property', 'List your property (from UGX 20,000 a month)') + ' – they sign up, add photos and price, pay by MoMo, we check it, it goes live.</li>'
        + '<li><b>Short stays:</b> ' + L('https://makaug.com/short-term', 'Short stays') + ', e.g. ' + L('https://makaug.com/short-term/bunga-one-bedroom-stay-st-000003', 'a one-bedroom stay in Bunga') + '. Hosts: ' + L('https://makaug.com/short-term/list-your-place', 'list your place') + '.</li></ul>'
        + lg('Buli kifo kirina olupapula lwakyo: ebifaananyi, ebbeeyi, ekitundu, n\'essimu y\'oyo akitunda.'))
      + sec('3. Using this calling screen, step by step', '<ol>'
        + '<li>Agree <b>Today\'s plan</b> with King in the morning and initial it.</li><li>Turn <b>Work mode</b> on. Pick a mode: new agents, payments or keep clients.</li>'
        + '<li>Read the card: where the number came from and its history. Press <b>Call from laptop (Phone Link)</b>.</li>'
        + '<li>Did they answer? Say the "I am taking notes" line, then follow the 6 steps in the script. Objections are under the script.</li>'
        + '<li>Ask them to WhatsApp "Hi" to 0780 863 394. Not on WhatsApp yet? Press <b>Text them our WhatsApp number</b>.</li>'
        + '<li>Once they have messaged us, <b>Request video send</b> – King approves and makaug\'s WhatsApp sends it.</li>'
        + '<li>Money: <b>Send pay link</b> or <b>Send MoMo code</b>; if they say they paid, press <b>They say they paid</b>. Admin confirms.</li>'
        + '<li>End the call, check the wrap-up, always write a <b>next step</b>. Asked not to be called? Pick <b>Don\'t contact again</b>.</li>'
        + '<li>Someone rang the company phone? Answer in Phone Link and press <b>📲 Incoming call</b>.</li>'
        + '<li>Breaks: one 60-minute lunch and short 10/15-minute breaks. At 17:00 do the <b>cash check</b> before you close.</li>'
        + '<li><b>My money</b> card: commission earned, on hold (7 days) and due on the 25th.</li></ol>')
      + sec('4. FAQs and objections', '<p><b>"It\'s too expensive."</b> One tenant or one sale pays it back many times. UGX 50,000 is less than UGX 1,700 a day.</p>' + lg('Omupangisa omu oba okutunda omulundi gumu kukomyawo ssente zino emirundi mingi.')
        + '<p><b>"Is there a free trial?"</b> No free trial. You see real listings and enquiries from day one.</p>'
        + '<p><b>"My listing is already on makaug – who put it there?"</b> We find listings online and show where they came from. Join and it becomes yours, with your name and phone.</p>'
        + '<p><b>"How do I pay?"</b> MoMo merchant code 27248497, then WhatsApp the confirmation to 0780 863 394.</p>' + lg('Sasula ku MoMo merchant code 27248497, oluvannyuma oweereze obubaka ku WhatsApp 0780 863 394.')
        + '<p><b>"Send me details."</b> Ask them to WhatsApp "Hi" to 0780 863 394 first (WhatsApp won\'t let us message first), then request the video.</p>'
        + '<p><b>"I\'m busy."</b> Book a callback with a time; it comes back to you.</p><p><b>"Don\'t call me again."</b> Say sorry and pick <b>Don\'t contact again</b> – the number is blocked everywhere.</p>')
      + '</div>';
  }
  // ---- Live site: today's numbers + a preview of makaug.com, without leaving the screen
  var LIVE_LINKS = [['/', 'Home'], ['/to-rent', 'To rent'], ['/for-sale', 'For sale'], ['/land', 'Land'], ['/short-term', 'Short stays'], ['/brokers', 'Agents'], ['/list-property', 'List property'], ['/about', 'About']];
  function liveCountsHtml(L) {
    var c = (L && L.counts) || {};
    var cell = function (n, label) { return '<div><b>' + (n == null ? '–' : Number(n).toLocaleString('en-GB')) + '</b><span>' + label + '</span></div>'; };
    return '<div class="mkc-lc">' + cell(c.visitors, 'visitors today') + cell(c.leads, 'new enquiries') + cell(c.signups, 'new agent sign-ups') + cell(c.listings_submitted, 'agent listings in') + cell(c.listings_approved, 'agent listings approved') + cell(c.agents_paid, 'agents paid') + '</div>';
  }
  function liveFeedHtml(L) {
    var icon = { signup: '🙋', lead: '📩', submitted: '📝', approved: '✅', paid: '💰' };
    return ((L && L.feed) || []).map(function (e) { return '<div class="mkc-hit"' + (e.listing_id ? ' data-live-open="/property/' + esc(e.listing_id) + '"' : ' style="cursor:default"') + '>' + (icon[e.kind] || '•') + ' ' + esc(e.text) + ' <span class="mkc-muted">' + esc(kTime(e.at)) + '</span></div>'; }).join('') || '<p class="mkc-muted">Nothing yet today.</p>';
  }
  function loadLive(cb) { api('/live').then(function (L) { if (!S) return; S.live = L; if (cb) cb(L); }, function () {}); }
  function openLive() {
    var tmr = null; var mode = 'frame';
    modal('<div class="mkc-row" style="justify-content:space-between"><h3 style="margin:0;font-weight:900">🌐 Live site · today</h3><span class="mkc-muted" data-live-at></span><button class="mkc-btn sm" data-x>Close</button></div>'
      + '<div class="mkc-livegrid" style="margin-top:8px"><div><div data-live-counts>' + liveCountsHtml(S.live) + '</div><h4 style="margin:10px 0 4px">Latest</h4><div data-live-feed>' + liveFeedHtml(S.live) + '</div></div>'
      + '<div style="display:flex;flex-direction:column"><div class="mkc-row" style="margin-bottom:6px">' + LIVE_LINKS.map(function (l) { return '<button type="button" class="mkc-btn sm ghost" data-live-open="' + l[0] + '">' + l[1] + '</button>'; }).join('')
      + '<button type="button" class="mkc-btn sm dark" data-live-viewer>Listing viewer</button><a class="mkc-btn sm ghost" target="_blank" rel="noopener" data-live-new href="/">Open in new tab ↗</a></div>'
      + '<div style="flex:1;min-height:420px" data-live-pane><iframe class="mkc-frame" data-live-frame src="/" title="makaug.com preview" referrerpolicy="same-origin"></iframe></div></div></div>', function (m, close) {
      m.classList.add('wide');
      var stop = function () { clearInterval(tmr); close(); };
      q('[data-x]', m).onclick = stop;
      var pane = q('[data-live-pane]', m);
      var paint = function (L) { var c = q('[data-live-counts]', m); if (!c) return; c.innerHTML = liveCountsHtml(L); q('[data-live-feed]', m).innerHTML = liveFeedHtml(L); q('[data-live-at]', m).textContent = 'updated ' + kTime(L.at) + ' · refreshes every 30 s'; bindOpen(); };
      var viewer = function () {
        mode = 'viewer';
        var list = (S.live && S.live.listings) || [];
        pane.innerHTML = '<p class="mkc-muted" style="margin:0 0 6px">Latest approved listings. Tap one to open its page here.</p><div class="mkc-lv">' + list.map(function (p) { return '<div class="c" data-live-open="' + esc(p.path) + '">' + (p.image ? '<img loading="lazy" src="' + esc(p.image) + '" alt="">' : '<img alt="">') + '<div><b>' + esc(p.title || 'Listing') + '</b><br>' + esc(p.area || '') + '<br>' + esc(p.price || '') + '</div></div>'; }).join('') + '</div>';
        bindOpen();
      };
      var frame = function (path) {
        mode = 'frame';
        pane.innerHTML = '<iframe class="mkc-frame" data-live-frame src="' + esc(path) + '" title="makaug.com preview"></iframe>';
        q('[data-live-new]', m).href = path;
        var f = q('[data-live-frame]', pane);
        f.onload = function () { var ok = true; try { var h = f.contentWindow.location.href; ok = h && h !== 'about:blank'; } catch (_) { ok = false; } if (!ok) { toast('The site can\'t be shown in a frame here – showing the listing viewer.'); viewer(); } };
      };
      function bindOpen() { qa('[data-live-open]', m).forEach(function (b) { b.onclick = function () { frame(b.getAttribute('data-live-open')); }; }); }
      q('[data-live-viewer]', m).onclick = viewer;
      frame('/');
      loadLive(paint);
      tmr = setInterval(function () { if (!document.body.contains(m)) { clearInterval(tmr); return; } loadLive(paint); }, 30000);
    });
  }
  function periodTabs(attr, cur) {
    return '<div class="mkc-modes" style="display:inline-flex">' + [['day', 'Day'], ['week', 'Week'], ['month', 'Month']].map(function (x) { return '<button type="button" class="mkc-mode' + (x[0] === cur ? ' on' : '') + '" ' + attr + '="' + x[0] + '" style="color:#0f172a;background:' + (x[0] === cur ? '#fbbf24' : '#e2e8f0') + '">' + x[1] + '</button>'; }).join('') + '</div>';
  }
  // King: agree each caller's plan for today, see plan vs results.
  function drawKPlans(host) {
    var box = q('[data-k-plans]', host); if (!box) return;
    var people = (K.data.people || []).filter(function (p) { return p.person_key !== 'arthur'; });
    Promise.all(people.map(function (p) { return api('/plan?person_key=' + encodeURIComponent(p.person_key)).catch(function () { return null; }); })).then(function (list) {
      box.innerHTML = '<h4 style="margin:0 0 6px">📋 Morning plans · today</h4><p class="mkc-muted" style="margin:0 0 8px">Agree the plan with each caller in the morning. At 17:00 (or when they close the day) it is compared with what happened.</p>'
        + '<div class="mkc-people">' + list.map(function (r, i) {
          if (!r) return ''; var p = r.plan; var x = r.result; var who = people[i];
          return '<div class="mkc-person"><div class="mkc-row" style="justify-content:space-between"><b>' + esc(who.name) + '</b>' + (p.agreed_by ? '<span class="mkc-pill live">Agreed' + (p.caller_initials ? ' · ' + esc(p.caller_initials) : ' · not signed') + '</span>' : '<span class="mkc-pill flag">Not agreed</span>') + '</div>'
            + '<div class="mkc-muted">' + esc(p.focus || '') + '</div>' + (p.goal ? '<div><b>Goal:</b> ' + esc(p.goal) + '</div>' : '')
            + '<div class="mkc-row" style="margin-top:4px"><span class="mkc-pill">Calls ' + x.calls + '/' + p.calls_target + (x.calls_hit ? ' ✓' : '') + '</span><span class="mkc-pill">Closes ' + x.closes + '/' + p.closes_target + (x.closes_hit ? ' ✓' : '') + '</span><span class="mkc-pill">Payments ' + x.payments + '/' + (p.payments_target || 0) + '</span>' + (x.numbers_planned ? '<span class="mkc-pill">Agreed numbers ' + x.numbers_reached + '/' + x.numbers_planned + '</span>' : '') + '</div>'
            + '<button type="button" class="mkc-btn sm go" style="margin-top:6px" data-k-plan="' + i + '">' + (p.agreed_by ? 'Change plan' : 'Agree plan') + '</button></div>';
        }).join('') + '</div>';
      qa('[data-k-plan]', box).forEach(function (b) {
        b.onclick = function () {
          var i = Number(b.getAttribute('data-k-plan')); var r = list[i]; var who = people[i];
          modal('<p class="mkc-muted" style="margin:0">Plan for <b>' + esc(who.name) + '</b></p>' + planHtml({ plan: Object.assign({}, r.plan, { agreed_by: '' }), result: r.result }, true)
            + '<div data-pl-err></div><div class="mkc-row" style="margin-top:12px;justify-content:flex-end"><button type="button" class="mkc-btn" data-x>Cancel</button><button type="button" class="mkc-btn go" data-pl-save>Agree plan</button></div>', function (m, close) {
            q('[data-x]', m).onclick = close;
            q('[data-pl-save]', m).onclick = function () {
              var body = planBody(m); body.person_key = who.person_key; body.agree = true;
              api('/plan', { method: 'POST', body: body }).then(function () { close(); toast('Plan agreed'); drawKPlans(host); }, function (e) { q('[data-pl-err]', m).innerHTML = '<div class="mkc-err">' + esc(e.message) + '</div>'; });
            };
          });
        };
      });
    });
  }
  // King: time on screen, breaks, leaving the screen, idle, calls, money – by day / week / month.
  function drawKAct(host) {
    var box = q('[data-k-act]', host); if (!box) return;
    box.innerHTML = '<p class="mkc-muted">Loading activity…</p>';
    api('/activity?period=' + K.period).then(function (r) {
      var people = r.people.map(function (p) {
        var t = p.totals;
        var days = p.days.slice().reverse().map(function (d) {
          return '<tr><td><b>' + esc(d.day) + '</b></td><td>' + (d.login_hm ? 'login ' + esc(d.login_hm) + '<br>' : '') + esc(d.first_open_hm || '–') + '–' + esc(d.last_close_hm || '') + '</td><td>' + hm(d.work_ms) + ' work<div class="mkc-muted">' + hm(d.down_ms) + ' down · ' + hm(d.on_screen_ms) + ' open</div></td><td>' + hm(d.break_ms) + (d.lunch.length ? '<div class="mkc-muted">' + d.lunch.map(function (l) { return esc(l.kind) + ' ' + l.minutes + 'm' + (l.planned_min ? '/' + l.planned_min : '') + (l.over_min ? ' <span class="mkc-bad">+' + l.over_min + '</span>' : ''); }).join(', ') + '</div>' : '') + '</td>'
            + '<td>' + d.left_screen + '× · ' + hm(d.away_ms) + '</td><td>' + hm(d.idle_ms) + '</td><td>' + d.calls + (d.inbound ? '<div class="mkc-muted">' + d.outbound + ' out · ' + d.inbound + ' in</div>' : '') + '</td><td>' + hm(d.talk_s * 1000) + '</td><td>' + d.closes + '</td><td>' + d.pay_sent + ' sent · ' + d.pay_claimed + ' claimed · ' + d.pay_confirmed + ' ✓</td><td>' + ugx(d.commission_ugx) + '</td><td>' + d.actions + '</td>'
            + '<td>' + d.flags.map(function (f) { return '<span class="mkc-pill flag">' + esc(f) + '</span>'; }).join(' ') + '</td></tr>'
            + '<tr><td colspan="13" style="padding-top:0">' + timelineBar(d) + '</td></tr>';
        }).join('');
        return '<div class="mkc-person" style="margin-top:8px"><div class="mkc-row" style="justify-content:space-between"><b style="font-size:16px">' + esc(p.name) + '</b>' + (p.flags ? '<span class="mkc-pill flag">⚠ ' + p.flags + ' flag(s)</span>' : '<span class="mkc-pill live">No flags</span>') + '</div>'
          + '<div class="mkc-row" style="margin:4px 0">' + [['Work mode', hm(t.work_ms)], ['Downtime', hm(t.down_ms)], ['On screen', hm(t.on_screen_ms)], ['Breaks', t.breaks + ' · ' + hm(t.break_ms)], ['Left screen', t.left_screen + '× · ' + hm(t.away_ms)], ['Idle', hm(t.idle_ms) + (t.long_idles ? ' · ' + t.long_idles + ' long' : '')], ['Calls', t.calls], ['Talk', hm(t.talk_s * 1000)], ['Closes', t.closes], ['Payments', t.pay_confirmed + ' confirmed · ' + t.pay_claimed + ' claimed'], ['Commission', ugx(t.commission_ugx)], ['Days', t.days_worked]].map(function (x) { return '<span class="mkc-pill"><span class="mkc-muted">' + x[0] + '</span> <b>' + esc(String(x[1])) + '</b></span>'; }).join('') + '</div>'
          + (p.missed_days.length ? '<div class="mkc-bad">Missed working days: ' + esc(p.missed_days.join(', ')) + '</div>' : '')
          + '<div class="mkc-scroll"><table class="mkc-table"><tr><th>Day</th><th>Open–close</th><th>Work mode</th><th>Breaks</th><th>Left screen</th><th>Idle</th><th>Calls</th><th>Talk</th><th>Closes</th><th>Payments</th><th>Commission</th><th>Actions</th><th>Flags</th></tr>' + days + '</table></div></div>';
      }).join('');
      box.innerHTML = '<div class="mkc-row" style="justify-content:space-between"><h4 style="margin:0">⏱ Staff activity · ' + esc(r.from) + (r.to !== r.from ? ' → ' + esc(r.to) : '') + '</h4>' + periodTabs('data-k-per', K.period) + '</div>'
        + '<p class="mkc-muted" style="margin:4px 0 0">Times are Kampala. Bar: <b style="color:#10b981">work mode</b>, <b style="color:#f59e0b">breaks</b>, <b style="color:#ef4444">downtime</b> (work mode off or out of full screen), black tick = login. Flags: late start (after 10:00), downtime 30+ min, leaving the screen 5+ min or 20+ min in total, idle 10+ min, breaks over their time, missed working days.</p>' + (people || '<p class="mkc-muted">No activity in this period.</p>');
      qa('[data-k-per]', box).forEach(function (b) { b.onclick = function () { K.period = b.getAttribute('data-k-per'); drawKAct(host); }; });
    }, function (e) { box.innerHTML = '<div class="mkc-err">' + esc(e.message) + '</div>'; });
  }
  // One day as a bar, 07:00–20:00 Kampala: green work, amber break, red downtime, black tick = login.
  function timelineBar(d) {
    var dayStart = new Date(d.day + 'T07:00:00+03:00').getTime(); var span = 13 * 3600000;
    var pos = function (at) { return Math.max(0, Math.min(100, (new Date(at).getTime() - dayStart) / span * 100)); };
    var segs = (d.segments || []).map(function (g) { var l = pos(g.from); var w = Math.max(0.3, pos(g.to) - l); return '<i class="' + g.kind + '" style="left:' + l.toFixed(2) + '%;width:' + w.toFixed(2) + '%" title="' + esc(g.kind + ' ' + g.from_hm + '–' + g.to_hm + ' (' + g.minutes + ' min)') + '"></i>'; }).join('');
    var login = d.login_at ? '<i class="login" style="left:' + pos(d.login_at).toFixed(2) + '%" title="logged in ' + esc(d.login_hm) + '"></i>' : '';
    var ticks = [7, 9, 11, 13, 15, 17, 19].map(function (h) { return '<span style="position:absolute;left:' + ((h - 7) / 13 * 100).toFixed(2) + '%">' + h + ':00</span>'; }).join('');
    var list = (d.segments || []).filter(function (g) { return g.kind !== 'work' && g.minutes >= 1; }).map(function (g) { return '<span class="mkc-pill' + (g.kind === 'down' ? ' flag' : '') + '">' + (g.kind === 'down' ? 'downtime' : 'break') + ' ' + esc(g.from_hm) + '–' + esc(g.to_hm) + ' · ' + g.minutes + 'm</span>'; }).join(' ');
    return '<div class="mkc-tl">' + segs + login + '</div><div class="mkc-muted" style="position:relative;height:14px;font-size:10px">' + ticks + '</div>'
      + '<div style="margin-top:2px"><span class="mkc-muted" style="font-size:11px">' + (d.work_switches || 0) + ' work-mode switches</span> ' + list + '</div>';
  }
  // King: the signed 17:00 cash checks, with missed days and odd balance changes flagged.
  function drawKCash(host) {
    var box = q('[data-k-cashlog]', host); if (!box) return;
    api('/cashlog?period=' + K.cashPeriod).then(function (r) {
      var cur = function (key) { var a = r.accounts.filter(function (x) { return x.key === key; })[0]; return a ? a.currency : 'UGX'; };
      var days = r.days.map(function (d) {
        if (d.missed) return '<tr><td><b>' + esc(d.day) + '</b></td><td colspan="6"><span class="mkc-pill flag">' + (d.day === r.days[0].day ? 'Not done yet' : 'MISSED – no cash check') + '</span></td></tr>';
        return d.items.map(function (i, n) {
          return '<tr>' + (n === 0 ? '<td rowspan="' + d.items.length + '"><b>' + esc(d.day) + '</b><div class="mkc-muted">signed ' + esc(d.signed_by || '') + '</div>' + (d.missing.length ? '<div class="mkc-bad">Missing: ' + esc(d.missing.join(', ')) + '</div>' : '') + '</td>' : '')
            + '<td>' + esc(i.name) + (i.main ? ' <span class="mkc-pill live">main</span>' : '') + '</td><td><b>' + esc(cur(i.account_key)) + ' ' + Number(i.balance_ugx).toLocaleString('en-GB') + '</b><div class="mkc-muted">dated ' + esc(i.balance_date) + '</div></td>'
            + '<td>' + (i.change_ugx == null ? '<span class="mkc-muted">first</span>' : (Number(i.change_ugx) >= 0 ? '+' : '') + Number(i.change_ugx).toLocaleString('en-GB')) + '</td><td>' + (i.main ? '' : Number(i.transferred_ugx || 0).toLocaleString('en-GB')) + '</td>'
            + '<td>' + i.flags.map(function (f) { return '<span class="mkc-pill flag">' + esc(f) + '</span>'; }).join(' ') + (i.flags.length ? '' : '<span class="mkc-pill live">OK</span>') + (i.note ? '<div class="mkc-muted">' + esc(i.note) + '</div>' : '') + '</td></tr>';
        }).join('');
      }).join('');
      box.innerHTML = '<div class="mkc-row" style="justify-content:space-between"><h4 style="margin:0">🔒 Daily cash check · ' + esc(r.from) + (r.to !== r.from ? ' → ' + esc(r.to) : '') + '</h4>' + periodTabs('data-k-cper', K.cashPeriod) + '</div>'
        + (r.missed_days.length ? '<div class="mkc-bad" style="margin:4px 0">Missed days: ' + esc(r.missed_days.join(', ')) + '</div>' : '')
        + '<div class="mkc-scroll"><table class="mkc-table"><tr><th>Day</th><th>Account</th><th>Balance</th><th>Change</th><th>Moved to bank</th><th>Flags</th></tr>' + days + '</table></div>';
      qa('[data-k-cper]', box).forEach(function (b) { b.onclick = function () { K.cashPeriod = b.getAttribute('data-k-cper'); drawKCash(host); }; });
    }, function (e) { box.innerHTML = '<div class="mkc-err">' + esc(e.message) + '</div>'; });
  }
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
      + '<div style="margin:4px 0">' + (flags || '<span class="mkc-pill live">No flags</span>') + (p.skipped ? '<span class="mkc-pill warn" title="Skips today by reason">Skipped ' + p.skipped + ': ' + esc(Object.keys(p.skip_reasons || {}).map(function (k) { return k.replace(/_/g, ' ') + ' ' + p.skip_reasons[k]; }).join(', ')) + '</span>' : '') + '</div>'
      + '<div class="mkc-row" style="justify-content:space-between">' + spark + '<span><button type="button" class="mkc-btn sm" data-k-ev="' + esc(p.person_key) + '">Evidence</button> <button type="button" class="mkc-btn sm ghost" data-k-rep="' + esc(p.person_key) + '">Report</button></span></div></div>';
  }
  function drawKing(host) {
    var d = K.data; var team = d.team || {}; var road = d.road_to_1000 || {};
    var teamTasks = d.tasks.map(function (t) { var x = (team.by_task || {})[t.key] || { calls: 0, closes: 0 }; return '<span class="mkc-pill">' + esc(t.name) + ': ' + x.calls + ' calls, ' + x.closes + ' closed</span>'; }).join('');
    var nums = (K.nums || []).map(function (n) {
      var own = n.status === 'own';
      return '<div class="mkc-kit"><div><b>' + esc(n.name || 'No name') + '</b> ' + esc(n.phone) + (own ? ' <span class="mkc-pill live">Own number · in ' + esc(personName(n.person_key)) + '\'s queue</span>' : '') + '<div class="mkc-muted">by ' + esc(personName(n.person_key)) + ' · ' + esc(kDayTime(n.added_at)) + (n.how_known ? ' · ' + esc(n.how_known) : '') + (n.mode && n.mode !== 'new_agents' ? ' · ' + esc(MODE_LABEL[n.mode] || n.mode) : '') + (n.note ? ' · ' + esc(n.note) : '') + '</div></div>'
        + '<div class="mkc-row" style="flex-wrap:nowrap"><button type="button" class="mkc-btn sm go" data-k-ok="' + esc(n.id) + '">' + (own ? 'OK' : 'Add to queue') + '</button><button type="button" class="mkc-btn sm" data-k-no="' + esc(n.id) + '">' + (own ? 'Remove' : 'Reject') + '</button></div></div>';
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
      + '<div class="mkc-row"><button type="button" class="mkc-btn sm go" data-k-meet>Meeting review (pipeline)</button><span class="mkc-pill">Team: ' + (team.calls || 0) + ' calls · ' + (team.closes || 0) + ' closes · ' + (team.flagged_calls || 0) + ' flagged</span><button type="button" class="mkc-btn sm" data-k-refresh>Refresh</button></div>'
      + '<div style="margin-top:8px;background:#0f172a;color:#fff;border-radius:12px;padding:8px 12px"><div class="mkc-row" style="justify-content:space-between"><b>Road to 1,000 paid agents</b><b style="color:#fbbf24">' + (road.paying_now || 0) + ' / 1,000 · ' + (road.percent || 0) + '%</b></div><div style="height:10px;background:#334155;border-radius:99px;margin-top:6px;overflow:hidden"><i style="display:block;height:100%;background:linear-gradient(90deg,#10b981,#f59e0b);width:' + Math.max(1, Math.min(100, road.percent || 0)) + '%"></i></div></div></div>'
      + '<div style="margin-top:6px">' + teamTasks + '</div>'
      + '<div class="mkc-people">' + d.people.map(function (p) { return personRow(d, p); }).join('') + '</div>'
      + '<div data-k-evbox></div>'
      + '<div class="mkc-panel" style="margin-top:14px" data-k-plans></div>'
      + '<div class="mkc-panel" style="margin-top:14px" data-k-act></div>'
      + '<div class="mkc-panel" style="margin-top:14px" data-k-cashlog></div>'
      + '<div class="mkc-panel" style="margin-top:14px" data-k-calls></div>'
      + '<div class="mkc-panel" style="margin-top:14px" data-k-videos></div>'
      + '<div class="mkc-panel" style="margin-top:14px" data-k-blocks></div>'
      + '<div class="mkc-grid" style="padding:0;margin-top:14px;grid-template-columns:repeat(auto-fit,minmax(300px,1fr))">'
      + '<div class="mkc-panel"><h4>Numbers staff added (' + (K.nums || []).length + ' to look at)</h4><p class="mkc-muted" style="margin:0 0 6px">Own numbers are already in the caller\'s queue. Tap OK, or Remove to take one out.</p>' + (nums || '<p class="mkc-muted">Nothing waiting.</p>') + '</div>'
      + '<div class="mkc-panel"><h4>Callbacks booked</h4>' + (cbs ? '<div class="mkc-scroll"><table class="mkc-table">' + cbs + '</table></div>' : '<p class="mkc-muted">None booked.</p>') + '</div>'
      + '<div class="mkc-panel"><h4>Logins (own login per person)</h4>' + loginsHtml() + '<div data-k-link></div></div>'
      + '<div class="mkc-panel"><h4>Daily summaries saved today</h4>' + ((K.sums || []).map(function (x, i) { var f = x.figures || {}; return '<div class="mkc-kit"><div><b>' + esc(f.name || x.person_key) + '</b><div class="mkc-muted">' + (f.calls || 0) + ' calls · ' + (f.closes || 0) + ' closes · saved ' + esc(kTime(x.made_at)) + (f.saved_because ? ' (' + esc(f.saved_because === '17:00' ? 'at 17:00' : 'session end') + ')' : '') + '</div></div><button type="button" class="mkc-btn sm" data-k-sum="' + i + '">Open</button></div>'; }).join('') || '<p class="mkc-muted">Saved at 17:00 Kampala and when a session ends.</p>') + '</div>'
      + '<div class="mkc-panel"><h4>Daily targets (per person)</h4>' + targets + '<div data-t-err></div><button type="button" class="mkc-btn dark sm" style="margin-top:8px" data-t-save>Save targets</button></div>'
      + '</div></div>';
    q('[data-k-refresh]', host).onclick = function () { renderKing(host); };
    q('[data-k-meet]', host).onclick = openMeeting;
    K.period = K.period || 'day'; K.cashPeriod = K.cashPeriod || 'week';
    K.callsPeriod = K.callsPeriod || 'day';
    drawKPlans(host); drawKAct(host); drawKCash(host); drawKCalls(host); drawKVideos(host); drawKBlocks(host);
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
        + '<div class="mkc-row" style="margin:6px 0"><span class="mkc-pill">' + esc(it.stage) + '</span><span class="mkc-pill warn">' + esc(it.payment) + '</span><span class="mkc-pill">' + it.calls + ' calls</span>' + (it.skips ? '<span class="mkc-pill flag" title="' + esc(it.last_skip || '') + '">Skipped ' + it.skips + '×</span>' : '') + (it.said_hello ? '<span class="mkc-pill live">Said Hello ✓</span>' : '<span class="mkc-pill">No Hello yet</span>') + (it.open_loop ? '<span class="mkc-pill flag">⚠ No next step after the last call</span>' : '') + (it.owner ? '<span class="mkc-pill">Owner: ' + esc(personName(it.owner)) + '</span>' : '') + '</div>'
        + '<div class="mkc-tpl"><b>Last thing they said</b><div>' + (it.last_said ? esc(kDayTime(it.last_said.at)) + ' · ' + esc(personName(it.last_said.by)) + ': ' + esc(it.last_said.text) : 'Nothing recorded yet.') + '</div></div>'
        + (it.last_transcript ? '<div class="mkc-tpl" style="background:#eff6ff;border-color:#bfdbfe"><b>Call notes (' + esc(kDayTime(it.last_transcript.at)) + ' · ' + esc(personName(it.last_transcript.by)) + ')</b><div>' + esc(it.last_transcript.summary || '') + '</div>' + (it.last_transcript.next_step ? '<div><b>Next step:</b> ' + esc(it.last_transcript.next_step) + '</div>' : '') + (it.last_transcript.text ? '<details><summary class="mkc-muted">What was said (live notes, no audio)</summary><div style="font-size:12px">' + esc(it.last_transcript.text) + '</div></details>' : '') + '</div>' : '')
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
