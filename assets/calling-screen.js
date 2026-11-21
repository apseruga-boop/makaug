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
    // Reads give up after 30s with a clear message instead of leaving "Loading…" on screen.
    var method = opts.method || 'GET'; var ctl = (method === 'GET' && typeof AbortController === 'function') ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, opts.timeoutMs || 30000) : null;
    return fetch((path.indexOf('/api/') === 0 ? '' : API) + path, { method: method, credentials: 'same-origin', headers: headers, body: opts.body ? JSON.stringify(opts.body) : undefined, keepalive: !!opts.keepalive, signal: ctl ? ctl.signal : undefined })
      .then(function (res) { if (timer) clearTimeout(timer); return res; }, function (err) {
        if (timer) clearTimeout(timer);
        if (err && err.name === 'AbortError') { var t = new Error('This is taking too long. Tap Retry.'); t.status = 0; t.code = 'timeout'; throw t; }
        throw err;
      })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (p) {
          if (!res.ok || p.ok === false) { var e = new Error(p.error || 'Something went wrong. Try again.'); e.status = res.status; e.code = p.code || ''; throw e; }
          return p.data;
        });
      });
  }
  // A King panel never stays on "Loading…": a slow answer or a drawing error shows the reason and a Retry button.
  function panelFailed(box, e) {
    try { console.error('[calling panel]', e); } catch (x) { /* no console */ }
    if (!box) return;
    box.innerHTML = '<div class="mkc-err" data-k-panel-err>' + esc((e && e.message) || 'Could not load this part.') + ' <button type="button" class="mkc-btn ghost sm" data-k-retry>Retry</button></div>';
    var rb = q('[data-k-retry]', box); if (rb) rb.onclick = function () { var k = q('[data-calling-king-root]'); if (k) renderKing(k); };
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
  function sameText(a, b) { var k = function (t) { return String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }; return k(a) === k(b); }
  function firstName(n) { return String(n || '').replace(/\(.*?\)/g, '').replace(/^TEST\s*[–-]\s*/, '').trim().split(/\s+/)[0] || ''; }
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
  // Practice login (e.g. "Arthur (test)"): the TEST numbers never dial. Your own real test phone
  // (added with ➕ Add number) really rings through the phone; SMS and WhatsApp links never open.
  var practiceOn = false;
  function practiceMode() {
    if (!boot || !boot.sandbox || practiceOn) return;
    practiceOn = true;
    var b = document.createElement('div'); b.className = 'mkc-practice'; b.setAttribute('data-mkc-practice', '');
    b.textContent = '🧪 PRACTICE – TEST numbers can\'t dial; your own test phone really rings. Nothing is sent or counted.';
    document.body.appendChild(b);
    document.addEventListener('click', function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a[href^="tel:"],a[href^="sms:"],a[href*="wa.me/"],a[href*="whatsapp.com/"],a[href^="whatsapp:"]') : null;
      if (!a) return;
      var href = a.getAttribute('href') || '';
      var digits = href.replace(/^tel:/, '').replace(/\D/g, '');
      if (/^tel:/.test(href) && digits.length >= 9 && !/^7000001\d{2}$/.test(digits.slice(-9))) return; // a real test phone: let it ring
      e.preventDefault(); // the screen still logs the tap; only the dialler / SMS / WhatsApp app is not opened
      b.style.opacity = '0'; clearTimeout(b._t); b._t = setTimeout(function () { b.style.opacity = ''; }, 4500);
      toast('Practice: ' + (/^tel:/.test(href) ? 'TEST number, practice only – can\'t dial. Add your own phone with ➕ Add number to test a real call' : 'nothing is sent from the practice account') + '. In real calls this opens ' + (/^tel:/.test(a.getAttribute('href')) ? 'Phone Link to ring' : /^sms:/.test(a.getAttribute('href')) ? 'Messages with the text' : 'WhatsApp') + '.');
    }, true);
  }
  // Practice login: how to make the Call button ring through your own phone.
  function practiceCallHelp(a) {
    var test = /^7000001\d{2}$/.test(String((a && a.phone) || '').replace(/\D/g, '').slice(-9));
    return '<details class="mkc-callhelp" data-mkc-callhelp' + (test ? '' : ' open') + '><summary>📱 ' + (test ? 'This is a TEST number (practice only, can\'t dial). Test a real call with your iPhone' : 'Your real test phone: this call really rings') + '</summary>'
      + (isPhone() ? '<p><b>On this phone:</b> add your number or a friend\'s with <b>➕ Add number</b>, then tap <b>' + esc(T('call_next')) + '</b>: it opens the Phone app and rings for real.</p>' : '')
      + '<p><b>Mac + iPhone</b> (once):</p><ol>'
      + '<li>Turn <b>Bluetooth</b> on, on both the iPhone and the Mac.</li>'
      + '<li>Use the <b>same Apple ID</b> and the <b>same Wi-Fi</b> on both (Apple needs both for calls from the iPhone).</li>'
      + '<li>On the iPhone: <b>Settings › Phone › Calls on Other Devices</b>: turn it on, and turn on your Mac in the list.</li>'
      + '<li>On the Mac: open <b>FaceTime › Settings</b> and turn on <b>Calls from iPhone</b>.</li>'
      + '<li><b>Quick test:</b> tap <b>➕ Add number</b>, add your own number, then tap <b>Call now</b>. The Mac asks to call through your iPhone: say yes. Calling yourself usually goes to voicemail, and that is fine.</li></ol>'
      + '<p>Then add a friend\'s phone and do a full call: talk, end it, fill in the Wrap up and save. It shows in <b>My report</b>. Nothing is texted or sent, and it never counts towards money, commission or team totals.</p>'
      + '<p class="mkc-muted">Windows 11: open Phone Link, link the iPhone (Bluetooth) and allow calls; Call now then rings through the iPhone.</p></details>';
  }
  function loadBoot(force) {
    if (!bootPromise || force) {
      bootPromise = api('/bootstrap').then(function (d) {
        boot = d; practiceMode();
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
    '.mkc-gate.mkc-reconnect{position:fixed;top:84px;left:50%;transform:translateX(-50%);z-index:40;width:calc(100% - 24px);max-width:640px;max-height:calc(100vh - 100px);overflow:auto;box-shadow:0 0 0 100vmax rgba(15,23,42,.6),0 20px 60px rgba(0,0,0,.4)}',
    '#mkc-connect{position:fixed;inset:0;z-index:2147483100;background:rgba(15,23,42,.6);overflow:auto;padding:16px;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}',
    '.mkc-cx-box{max-width:980px;margin:0 auto;background:#fff;border-radius:20px;padding:18px;box-shadow:0 20px 60px rgba(0,0,0,.35)}',
    '.mkc-cx-head{display:flex;justify-content:space-between;align-items:center;gap:8px}.mkc-cx-head h2{font-size:26px;font-weight:900;margin:0;color:#0f172a}',
    '.mkc-cx-lights{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:14px}@media(max-width:700px){.mkc-cx-lights{grid-template-columns:repeat(2,1fr)}}',
    '.mkc-cx-light{display:flex;flex-direction:column;align-items:center;gap:4px;border:3px solid #e2e8f0;border-radius:16px;padding:12px 8px;background:#f8fafc;cursor:pointer;text-align:center}',
    '.mkc-cx-light b{font-size:15px;color:#0f172a}.mkc-cx-note{font-size:12px;color:#475569}.mkc-cx-ic{font-size:28px}',
    '.mkc-cx-dot{width:26px;height:26px;border-radius:50%;background:#94a3b8;box-shadow:0 0 0 5px #e2e8f0}',
    '.mkc-cx-light.ok{border-color:#86efac;background:#f0fdf4}.mkc-cx-light.ok .mkc-cx-dot{background:#16a34a;box-shadow:0 0 0 5px #bbf7d0}',
    '.mkc-cx-light.bad{border-color:#fca5a5;background:#fef2f2}.mkc-cx-light.bad .mkc-cx-dot{background:#dc2626;box-shadow:0 0 0 5px #fecaca}',
    '.mkc-cx-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.mkc-cx-tab{border:2px solid #e2e8f0;background:#fff;border-radius:999px;padding:8px 14px;font-weight:800;font-size:14px;cursor:pointer}.mkc-cx-tab.on{background:#15603f;border-color:#15603f;color:#fff}',
    '.mkc-cx-gt{font-size:20px;font-weight:900;margin:14px 0 8px;color:#0f172a}',
    '.mkc-cx-steps{list-style:none;padding:0;margin:0;display:grid;grid-template-columns:repeat(4,1fr);gap:10px}@media(max-width:900px){.mkc-cx-steps{grid-template-columns:repeat(2,1fr)}}@media(max-width:480px){.mkc-cx-steps{grid-template-columns:1fr}}',
    '.mkc-cx-steps li{position:relative;border:2px solid #e2e8f0;border-radius:16px;padding:10px;background:#f8fafc}.mkc-cx-steps p{font-size:15px;font-weight:700;margin:6px 0 0;color:#0f172a;line-height:1.3}',
    '.mkc-cx-n{position:absolute;top:8px;left:8px;width:30px;height:30px;border-radius:50%;background:#15603f;color:#fff;font-weight:900;display:grid;place-items:center;font-size:16px}',
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
    '.mkc-gate{border:2px solid #15603f;background:#f6fbf8;border-radius:16px;padding:16px;text-align:left;margin-top:8px}.mkc-gate p{margin:6px 0}.mkc-gate-t{font-size:20px;font-weight:900;color:#16241d}.mkc-gate-row{display:flex;gap:10px;align-items:center;padding:8px 10px;background:#fff;border:1px solid #e4ece8;border-radius:10px;margin:6px 0}.mkc-gate-row .mkc-muted{margin-left:auto;font-size:12px}.mkc-gate-heard{font-size:15px;font-style:italic;color:#15603f;margin:6px 0}.mkc-gate .mkc-call{margin-top:10px;width:100%}',
    '.mkc-reconnect{border-color:#b3134f;background:#fff1f4}.mkc-reconnect .mkc-gate-t{color:#b3134f;font-size:22px}.mkc-reconnect ol{margin:8px 0 8px 20px;font-size:15px;line-height:1.55}',
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
    // v5: focus during a call, routing script, compact wrap-up pop-out, commission chip, day split, housekeeping
    '#mkc-overlay.mkc-focus .mkc-dash,#mkc-overlay.mkc-focus .mkc-side,#mkc-overlay.mkc-focus .mkc-splitbar,#mkc-overlay.mkc-focus .mkc-meetbar{display:none!important}',
    '#mkc-overlay.mkc-focus .mkc-top>:not(.mkc-work):not(.who):not(.mkc-comm):not(.mkc-net):not(.sp){display:none!important}',
    '#mkc-overlay.mkc-focus .mkc-grid{grid-template-columns:minmax(0,.85fr) minmax(0,1.15fr);max-width:1400px}',
    '#mkc-overlay.mkc-noscript [data-mkc-script]{display:none}',
    '#mkc-overlay.mkc-noscript .mkc-grid{grid-template-columns:minmax(0,1.5fr) minmax(320px,1fr)}',
    '.mkc-comm{background:#14532d;color:#ecfdf5;border:1px solid #22c55e;border-radius:999px;padding:6px 12px;font:inherit;font-weight:700;font-size:12px;cursor:pointer;white-space:nowrap}.mkc-comm b{color:#fde047}.mkc-comm small{color:#bbf7d0;font-weight:600}',
    '.mkc-blockchip{background:#1e293b;border:1px solid #475569;color:#e2e8f0;border-radius:999px;padding:5px 10px;font-size:12px;font-weight:800}',
    '.mkc-splitbar{max-width:1500px;margin:0 auto;padding:10px 14px 0}.mkc-splitbar:empty{display:none}.mkc-splitt{display:flex;gap:10px;align-items:baseline;font-size:13px;color:#334155;margin-bottom:6px}.mkc-splitt span{color:#475569}',
    '.mkc-blocks{display:flex;gap:6px;overflow-x:auto}.mkc-blk{flex:1 1 0;min-width:120px;background:#fff;border:1px solid #e2e8f0;border-left:5px solid #94a3b8;border-radius:10px;padding:6px 8px;font-size:12px;color:#334155}.mkc-blk b{display:block;font-size:12px;color:#0f172a}.mkc-blk span{display:block}',
    '.mkc-blk .bar{height:6px;background:#e2e8f0;border-radius:99px;margin:4px 0 2px;overflow:hidden}.mkc-blk .bar i{display:block;height:100%;background:#10b981}.mkc-blk em{font-style:normal;font-weight:800;font-size:11px}',
    '.mkc-blk.k-existing{border-left-color:#7c3aed}.mkc-blk.k-new{border-left-color:#0ea5e9}.mkc-blk.k-housekeeping{border-left-color:#f59e0b}.mkc-blk.k-lunch{border-left-color:#cbd5e1;flex:0 0 90px;min-width:90px}.mkc-blk.now{box-shadow:0 0 0 2px #10b981;background:#f0fdf4}.mkc-blk.past{opacity:.7}',
    '.mkc-say{background:#ecfdf5;border:2px solid #10b981;border-radius:14px;padding:12px 14px;margin:6px 0 10px}.mkc-say span{font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:.06em;color:#047857}.mkc-say p{margin:4px 0 0;font-size:19px;line-height:1.45;color:#0f172a}',
    '.mkc-routehead{font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:.06em;color:#334155;margin:4px 0 6px}',
    '.mkc-replies{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px}.mkc-reply{border:2px solid #cbd5e1;background:#fff;color:#0f172a;border-radius:12px;padding:12px 12px;font:inherit;font-weight:800;font-size:15px;text-align:left;cursor:pointer;min-height:52px}.mkc-reply:hover{border-color:#0ea5e9;background:#f0f9ff}',
    '.mkc-reply.fin{border-color:#a7f3d0}.mkc-reply.go{background:#047857;border-color:#047857;color:#fff}.mkc-reply.grey{background:#f1f5f9}.mkc-reply.big{font-size:18px;text-align:center;grid-column:1/-1}',
    '.mkc-crumbs{display:flex;flex-wrap:wrap;gap:4px;align-items:center;font-size:12px;margin-bottom:4px}.mkc-crumbs span{background:#e0f2fe;color:#075985;border-radius:99px;padding:2px 8px;font-weight:700}.mkc-crumbs i{color:#64748b;font-style:normal}',
    '.mkc-routeend{background:#fffbeb;border:2px solid #f59e0b;border-radius:14px;padding:12px 14px;margin:6px 0 10px;color:#1f2937}.mkc-routeend span{font-size:11px;font-weight:900;text-transform:uppercase;color:#92400e}.mkc-routeend b{display:block;font-size:20px;margin:2px 0}',
    '.mkc-routetools{margin-top:10px}.mkc-extras{margin-top:10px;border:1px solid #e2e8f0;border-radius:12px;padding:6px 10px;background:#f8fafc}.mkc-extras summary{cursor:pointer;font-weight:800;font-size:13px;color:#334155}',
    '.mkc-wrapmodal{position:fixed;inset:0;z-index:20;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:12px}',
    '.mkc-wrapcard{background:#fff;border-radius:18px;box-shadow:0 20px 50px rgba(0,0,0,.35);width:min(860px,100%);max-height:calc(100vh - 24px);overflow:auto;padding:14px 16px;box-sizing:border-box;color:#0f172a}',
    '.mkc-wraphead{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}.mkc-wraphead b{font-size:20px}.mkc-wraphead span{color:#475569;font-size:14px}',
    '.mkc-wrappath{font-size:12px;color:#075985;background:#f0f9ff;border-radius:8px;padding:4px 8px;margin-top:6px}.mkc-wrapsug{font-size:12px;color:#1e3a8a;margin-top:6px;font-weight:700}',
    '.mkc-outs.wrap{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 8px}.mkc-outs.wrap .mkc-out{padding:8px 12px;font-size:14px;min-height:0}',
    '.mkc-wrapchecks{display:grid;grid-template-columns:1fr 1fr;gap:2px 12px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:12px;padding:8px 10px;margin-bottom:8px;font-size:12px}.mkc-wrapchecks b{grid-column:1/-1;color:#065f46;font-size:13px}.mkc-wrapchecks label{display:flex;gap:6px;align-items:flex-start}',
    '.mkc-wrapgrid{display:grid;grid-template-columns:1fr 1fr;gap:8px 12px}.mkc-wrapgrid .f{display:flex;flex-direction:column;gap:4px}.mkc-wrapgrid .f.wide{grid-column:1/-1}.mkc-wrapgrid label{font-size:12px;font-weight:900;color:#334155}.mkc-wrapgrid label small{font-weight:600;color:#475569}.mkc-wrapgrid .mkc-chips{display:flex;flex-wrap:wrap;gap:6px;align-items:center}.mkc-wrapgrid input.mkc-input{font-size:14px}',
    '.mkc-hello.sm{margin-top:8px;padding:6px 10px;font-size:13px}.mkc-wrapcard .mkc-save{margin-top:10px;font-size:19px}',
    '.mkc-sidehead{display:flex;gap:8px;align-items:center;margin-bottom:8px}',
    '.mkc-side.full{position:fixed;inset:16px;z-index:15;background:#f1f5f9;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.4);overflow:auto;padding:16px;max-width:1100px;margin:0 auto}',
    '.mkc-side.full .mkc-feed div{font-size:15px}.mkc-side.full .mkc-tabs{flex-wrap:wrap}',
    '.mkc-feed div{display:flex;gap:6px;align-items:baseline;flex-wrap:wrap;line-height:1.35}.mkc-feed .t{flex:1 1 160px;color:#1f2937;overflow-wrap:anywhere}.mkc-feed .w{color:#475569;font-size:12px}',
    '.mkc-feed .k{display:inline-block;background:#f1f5f9;border-radius:99px;padding:1px 7px;color:#334155!important}.mkc-feed .k-payment{background:#dcfce7;color:#166534!important}.mkc-feed .k-signup{background:#dbeafe;color:#1e3a8a!important}.mkc-feed .k-callback{background:#fef3c7;color:#92400e!important}',
    '.mkc-hk{display:flex;gap:10px;align-items:flex-start;border:1px solid #e2e8f0;border-radius:12px;padding:10px;margin-bottom:8px;background:#fff}.mkc-hk .ic{font-size:22px}.mkc-hk .tx{flex:1;font-size:14px}.mkc-hk .tx b{display:block}.mkc-hk .bt{display:flex;flex-direction:column;gap:6px}.mkc-hknote{gap:6px;margin-top:6px}.mkc-hknote input{flex:1}',
    '@media (max-width:1100px){#mkc-overlay.mkc-noscript .mkc-grid{grid-template-columns:minmax(0,1fr)}}',
    '@media (max-width:720px){#mkc-overlay.mkc-focus .mkc-grid{grid-template-columns:1fr}.mkc-wrapgrid,.mkc-wrapchecks{grid-template-columns:1fr}.mkc-comm small{display:none}.mkc-replies{grid-template-columns:1fr}}',
    '.mkc-splitsum{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}.mkc-splitrows{display:flex;flex-direction:column;gap:6px}.mkc-splitrow{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.mkc-splitrow input[type=time]{width:110px}.mkc-splitrow select{min-width:170px}',
    '.mkc-posted{font-size:14px;margin-top:4px;background:#f0f9ff;border:1px solid #bae6fd;color:#0c4a6e;border-radius:8px;padding:6px 8px;line-height:1.35}.mkc-wabtn{background:#16a34a!important;color:#fff!important;border-color:#16a34a!important;font-weight:800}.mkc-hitchip{background:#10b981;color:#fff;border-radius:99px;padding:4px 10px;font-weight:800;font-size:12px;white-space:nowrap}.mkc-intlchip{background:#334155;color:#e2e8f0;border-radius:99px;padding:4px 10px;font-size:11px;white-space:nowrap}.mkc-mode.dry i{background:#94a3b8!important}.mkc-fellback{background:#fef3c7;border:1px solid #fde68a;color:#78350f;border-radius:10px;padding:6px 10px;margin:0 0 6px;font-size:13px}.mkc-sugg{background:#eef2ff;color:#3730a3;border-radius:99px;padding:2px 4px 2px 10px;font-size:12px;margin-left:8px}.mkc-ev2 h5{margin:0 0 6px;font-size:13px}.mkc-evgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(340px,100%),1fr));gap:10px;margin-top:10px}.mkc-evcard{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:10px}.mkc-evsec{margin:6px 0;font-size:13px}.mkc-chart{width:100%;height:auto;display:block}.mkc-oncall{pointer-events:none}.mkc-hit{cursor:pointer}.mkc-evbarsbox{position:relative}.mkc-evtip{position:absolute;left:0;top:0;z-index:5;pointer-events:none;transition:none;will-change:transform;background:#0f172a;color:#fff;font-size:12px;font-weight:700;line-height:1.3;padding:6px 8px;border-radius:8px;max-width:300px;white-space:normal;box-shadow:0 4px 14px rgba(0,0,0,.25)}.mkc-evtip[hidden]{display:none}.mkc-evbarswrap{overflow-x:auto;-webkit-overflow-scrolling:touch}@media(max-width:640px){.mkc-evbars{min-width:560px}}.mkc-evkpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.mkc-evkpi{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:8px 10px}.mkc-evkpi .v{font-size:20px;font-weight:900}.mkc-evkpi .l{font-size:12px;color:#64748b}.mkc-evkpi .s{margin-top:2px}@media(max-width:640px){.mkc-evkpis{grid-template-columns:repeat(2,minmax(0,1fr))}}.mkc-trend{font-size:12px;font-weight:800;margin-left:4px}.mkc-trend.up{color:#16a34a}.mkc-trend.down{color:#dc2626}.mkc-trend.flat{color:#64748b}.mkc-legs{display:flex;flex-wrap:wrap;gap:8px;margin-top:4px;font-size:11px;color:#475569}.mkc-leg i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px;vertical-align:-1px}.mkc-evtl{list-style:none;margin:0;padding:0;font-size:13px;max-height:320px;overflow:auto}.mkc-evtl li{padding:4px 0;border-bottom:1px solid #f1f5f9}.mkc-evtl li.warn,.mkc-evtl li.bad{color:#b45309}.mkc-evtl li.bad{color:#b91c1c}.mkc-evtl ul{margin:4px 0 0 16px;padding:0;list-style:disc}.mkc-audit{list-style:none;margin:0;padding:0;font-size:13px}.mkc-audit li{padding:3px 0}.mkc-flag{background:#fee2e2;color:#991b1b;border-radius:6px;padding:1px 6px;font-size:12px;font-weight:700}.mkc-table tr.bad td{background:#fff1f2}.mkc-callhelp{margin-top:10px;text-align:left;background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:8px 12px;font-size:13px;color:#1e3a8a;line-height:1.4}.mkc-callhelp summary{cursor:pointer;font-weight:800}.mkc-callhelp ol{margin:4px 0 6px 22px;padding:0;list-style:decimal}.mkc-callhelp li{display:list-item}.mkc-callhelp li{margin:2px 0}.mkc-callhelp p{margin:6px 0 0}.mkc-meetcard{background:#f0fdf4;border:2px solid #16a34a;border-radius:16px;padding:16px;color:#14532d}',
    '.mkc-meetcard h3{margin:0;font-size:19px;font-weight:900;color:#14532d}',
    '.mkc-meetcard .mm-sub{margin:4px 0 14px;color:#166534;font-size:14px;line-height:1.4}',
    '.mkc-meetcard .mm-form{display:grid;grid-template-columns:minmax(150px,190px) minmax(220px,1fr) minmax(170px,240px) auto;gap:12px;align-items:end}',
    '.mkc-meetcard .mm-form label{display:block;font-size:13px;font-weight:800;color:#14532d;text-align:left;margin:0}',
    '.mkc-meetcard .mm-form input{display:block;width:100%;box-sizing:border-box;margin-top:5px;background:#fff;color:#0f172a;border:1px solid #86efac}',
    '.mkc-meetcard .mm-form input::placeholder{color:#6b7280}',
    '.mkc-meetcard .mm-save{min-height:44px;padding:0 24px;background:#15803d;color:#fff;border:0;border-radius:12px;font-weight:800;font-size:15px;cursor:pointer}',
    '.mkc-meetcard .mm-save:hover{background:#166534}',
    '.mkc-meetcard .mm-status{margin:14px 0;padding:10px 12px;border-radius:12px;background:#fff;border:1px solid #bbf7d0;color:#1f2937;font-size:14px;line-height:1.4}',
    '.mkc-meetcard .mm-status.unset{background:#fffbeb;border-color:#fcd34d;color:#78350f}',
    '.mkc-meetcard .mm-people{display:flex;flex-wrap:wrap;gap:8px;align-items:center}',
    '.mkc-meetcard .mm-people b{font-size:14px;color:#14532d;margin-right:2px}',
    '.mkc-meetcard .mm-person{background:#fff;color:#14532d;border:1.5px solid #16a34a;border-radius:999px;padding:7px 14px;font-weight:800;font-size:14px;cursor:pointer}',
    '.mkc-meetcard .mm-person:hover,.mkc-meetcard .mm-person.on{background:#15803d;color:#fff}',
    '.mkc-meetcard .mm-hist{margin-top:16px;padding-top:12px;border-top:1px solid #bbf7d0}',
    '.mkc-panel .mkc-meetcard .mm-hist h4,.mkc-meetcard .mm-hist h4{margin:0 0 6px;font-size:15px;font-weight:900;text-transform:none;letter-spacing:0;color:#14532d}',
    '.mkc-meetcard .mm-empty{margin:0;color:#374151;font-size:14px}',
    '.mkc-meetcard .mkc-table{background:#fff}',
    '@media (max-width:760px){.mkc-meetcard .mm-form{grid-template-columns:1fr}.mkc-meetcard .mm-save{width:100%}}',
    '.mkc-panel{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:16px}',
    '.mkc-panel h4{margin:0 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b}',
    '.mkc-num .name{font-size:22px;font-weight:900}.mkc-num .src{font-size:13px;color:#475569;margin-top:2px}',
    '.mkc-reason{display:inline-block;margin-top:6px;background:#fef3c7;color:#92400e;border-radius:8px;padding:3px 8px;font-size:12px;font-weight:700}',
    '.mkc-cb{background:#dbeafe;color:#1e3a8a}',
    '.mkc-phone{font-size:40px;font-weight:900;letter-spacing:.02em;margin:14px 0 4px;font-variant-numeric:tabular-nums}',
    '.mkc-in{background:#2563eb;color:#fff;font-size:17px;font-weight:900;padding:10px 18px;border-radius:12px;box-shadow:0 0 0 3px #bfdbfe}.mkc-pill.in{background:#dbeafe;color:#1e40af}.mkc-hit{border:1px solid #e2e8f0;border-radius:10px;padding:6px 8px;margin:4px 0;cursor:pointer}.mkc-hit mark{background:#fef08a}',
    '.mkc-learn{border:1px solid #e2e8f0;border-radius:10px;padding:6px 10px;margin:6px 0;font-size:13px;line-height:1.45}.mkc-learn p,.mkc-learn ul,.mkc-learn ol{margin:4px 0;padding-left:16px}.mkc-learn summary{cursor:pointer}.mkc-learn a{color:#047857;font-weight:700}.mkc-lg{background:#fefce8;border-radius:8px;padding:4px 8px;margin:4px 0;font-size:13px}',
    '.mkc-meetbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;background:#ede9fe;border:1px solid #c4b5fd;color:#4c1d95;border-radius:12px;padding:10px 12px;margin:0 0 10px}.mkc-rep{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}.mkc-rep>div{border:1px solid #e2e8f0;border-radius:12px;padding:10px;background:#fff}.mkc-rep h5{margin:0 0 6px;font-size:13px;color:#334155}.mkc-rep .big{font-size:22px;font-weight:900}.mkc-rep ul{margin:4px 0 0;padding-left:16px;font-size:12px}.mkc-act{display:grid;grid-template-columns:minmax(0,1fr) 140px 150px 34px;gap:6px;margin:4px 0}.mkc-act input{min-width:0;width:100%;box-sizing:border-box}@media(max-width:700px){.mkc-act{grid-template-columns:1fr 1fr}}',
    '.mkc-practice{position:fixed;left:50%;transform:translateX(-50%);bottom:10px;z-index:2147483600;background:#7c2d12;color:#fff;font:800 12px/1.35 system-ui,sans-serif;padding:7px 14px;border-radius:14px;box-shadow:0 4px 14px rgba(0,0,0,.3);width:max-content;max-width:calc(100vw - 20px);box-sizing:border-box;text-align:center;pointer-events:none;transition:opacity .2s}',
    '.mkc-proof{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px}.mkc-proof img{max-width:100%;max-height:360px;border:1px solid #e2e8f0;border-radius:10px;display:block}.mkc-drop{border:2px dashed #94a3b8;border-radius:12px;padding:18px;text-align:center;color:#475569;cursor:pointer}.mkc-drop.on{border-color:#047857;background:#ecfdf5}.mkc-fld{display:grid;grid-template-columns:120px 1fr;gap:6px;align-items:center;margin:4px 0}.mkc-fld input,.mkc-fld select{width:100%;box-sizing:border-box}.mkc-ocrbar{height:6px;background:#e2e8f0;border-radius:99px;overflow:hidden}.mkc-ocrbar i{display:block;height:100%;background:#0ea5e9;width:0}@media(max-width:700px){.mkc-proof{grid-template-columns:1fr}.mkc-fld{grid-template-columns:1fr}}',
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
      if (pick.person && !(boot.callers || []).some(function (p) { return p.key === pick.person; })) pick.person = ''; // e.g. a remembered practice account
      var tasks = boot.tasks.map(function (t) {
        return '<button type="button" class="mkc-task' + (t.key === pick.task ? ' on' : '') + '" data-mkc-task="' + esc(t.key) + '"><b>' + esc(t.name) + '</b><span>' + esc(t.description) + '</span></button>';
      }).join('');
      var people = boot.locked_person
        ? '<b>' + esc(personName(boot.locked_person)) + '</b>'
        : '<select class="mkc-select" data-mkc-person><option value="">Who is calling?</option>' + boot.callers.map(function (p) { return '<option value="' + esc(p.key) + '"' + (p.key === pick.person ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') + '</select>';
      host.innerHTML = '<div class="mkc-card">'
        + '<div class="mkc-row" style="justify-content:space-between"><div><h3><i class="fas fa-phone"></i> Calling</h3><p class="mkc-muted" style="margin:4px 0 0">Pick a task, then Start calling. The screen goes full-screen and keeps your work time.</p></div>'
        + '<div class="mkc-row"><button type="button" class="mkc-btn ghost sm" data-mkc-connect="bt">📱 Connect your phone</button><button type="button" class="mkc-btn ghost sm" data-mkc-myreport>My report today</button></div></div>'
        + '<div class="mkc-tasks">' + tasks + '</div>'
        + '<div class="mkc-row">' + people + '<button type="button" class="mkc-btn go" data-mkc-start style="font-size:16px;padding:12px 22px"><i class="fas fa-play"></i> Start calling</button></div>'
        + '<div data-mkc-carderr></div></div>';
      qa('[data-mkc-task]', host).forEach(function (b) { b.onclick = function () { pick.task = b.getAttribute('data-mkc-task'); renderStaffCard(host); }; });
      // The select's shown value is the truth: a browser can restore a select after a reload without a change event.
      var sel = q('[data-mkc-person]', host);
      var syncPerson = function () { if (sel) { pick.person = sel.value; var e0 = q('[data-mkc-carderr]', host); if (e0 && pick.person) e0.innerHTML = ''; } };
      if (sel) { sel.onchange = syncPerson; sel.oninput = syncPerson; setTimeout(syncPerson, 0); }
      q('[data-mkc-connect]', host).onclick = function () { openConnect('bt'); };
      q('[data-mkc-myreport]', host).onclick = function () {
        syncPerson();
        if (!pick.person) return showErr(host, 'Choose who is calling first.');
        openReport(pick.person);
      };
      q('[data-mkc-start]', host).onclick = function () {
        syncPerson();
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
      loadSplit(next);
    }, function (e) {
      if (document.fullscreenElement) document.exitFullscreen().catch(function () {});
      if (e.code === 'outcome_owed') { openOwed(function () { startSession(person, task); }); return; }
      toast(e.message, 'bad');
    });
  }
  // Every dialled call ends with an outcome (Arthur, 21 Nov 2026). Calls left without one
  // (screen closed, connection lost) are answered here before calling again. There is no "No outcome".
  function openOwed(done) {
    api('/api/admin/desk/owed').then(function (list) {
      list = list || [];
      if (!list.length) { if (done) done(); return; }
      var outsFor = function (tk) { var t = ((boot && boot.tasks) || []).filter(function (x) { return x.key === tk; })[0] || ((boot && boot.tasks) || [])[0] || { outcomes: [] }; return (t.outcomes || []).filter(function (o) { return !o.close; }); };
      var row = function (c, i) {
        return '<div class="mkc-panel" style="margin:8px 0;padding:10px" data-owed="' + esc(c.id) + '"><b>' + esc(c.name || 'This number') + ' ' + esc(c.phone) + '</b> <span class="mkc-muted">· dialled ' + esc(kDayTime(c.at)) + '</span>'
          + '<div class="mkc-outs wrap" style="margin-top:6px">' + outsFor(c.task_key).map(function (o) { return '<button type="button" class="mkc-out" data-owed-out="' + esc(o.key) + '" data-date="' + esc(o.date || '') + '" data-spoke="' + (o.spoke ? 1 : 0) + '">' + esc(o.label) + '</button>'; }).join('') + '</div>'
          + '<div class="mkc-row" style="margin-top:6px;gap:6px;flex-wrap:wrap"><input class="mkc-input" style="flex:2;min-width:160px" data-owed-note placeholder="What happened? (short note)"><input class="mkc-input" style="flex:1;min-width:140px" data-owed-next placeholder="Next step"><input type="datetime-local" class="mkc-input" data-owed-cb style="display:none" min="' + esc(localInput(new Date(Date.now() + 24 * 3600000))) + '"></div>'
          + '<div data-owed-err></div><button type="button" class="mkc-btn go sm" style="margin-top:6px" data-owed-save>Save outcome</button></div>';
      };
      modal('<h3 style="margin:0 0 4px;font-weight:900">' + (list.length === 1 ? 'One call needs' : list.length + ' calls need') + ' an outcome</h3><p class="mkc-muted" style="margin:0 0 6px">These calls were dialled but never wrapped up (screen closed or connection lost). Say what happened, then you can call again.</p>'
        + '<div data-owed-list>' + list.map(row).join('') + '</div><div class="mkc-row" style="justify-content:flex-end"><button type="button" class="mkc-btn" data-x>Later</button></div>', function (m, close) {
        q('[data-x]', m).onclick = close;
        qa('[data-owed]', m).forEach(function (card) {
          var pick = null;
          qa('[data-owed-out]', card).forEach(function (b) { b.onclick = function () {
            pick = b.getAttribute('data-owed-out');
            qa('[data-owed-out]', card).forEach(function (x) { x.classList.toggle('on', x === b); });
            q('[data-owed-cb]', card).style.display = b.getAttribute('data-date') ? '' : 'none';
          }; });
          q('[data-owed-save]', card).onclick = function () {
            var err = q('[data-owed-err]', card);
            if (!pick) { err.innerHTML = '<div class="mkc-err">Tap what happened.</div>'; return; }
            var cbv = q('[data-owed-cb]', card).value;
            api('/api/admin/desk/owed/' + encodeURIComponent(card.getAttribute('data-owed')), { method: 'POST', body: { outcome: pick, note: q('[data-owed-note]', card).value, next_step: q('[data-owed-next]', card).value, callback_at: cbv ? new Date(cbv).toISOString() : null } })
              .then(function () {
                card.remove(); toast('Outcome saved');
                if (!q('[data-owed]', m)) { close(); if (done) done(); }
              }, function (e) { err.innerHTML = '<div class="mkc-err">' + esc(e.message) + '</div>'; });
          };
        });
      });
    }, function (e) { toast(e.message, 'bad'); });
  }
  function ev(kind, detail) { if (S) S.events.push({ kind: kind, detail: detail || '', at: new Date().toISOString() }); }
  function inMeeting() { if (!S || !S.meeting) return false; var w = S.meeting.win; if (w && w.closed) { endMeeting(); return false; } return true; }
  function endMeeting() { if (!S || !S.meeting) return; ev('meeting_end', String(Math.round((Date.now() - S.meeting.since) / 1000)) + 's'); clearInterval(S.meeting.poll); S.meeting = null; renderTop(); }
  function onVis() { if (!S) return; ev(document.hidden ? 'hidden' : 'visible', inMeeting() ? 'in meeting' : (S.phase === 'calling' ? 'on a call' : '')); if (!document.hidden) { beat(); refreshPay(); } }
  function onFs() {
    if (!S) return; ev(document.fullscreenElement ? 'fs_enter' : 'fs_exit', inMeeting() ? 'in meeting' : '');
    // Leaving full screen ends work mode: downtime until he turns it back on (not while in the team meeting).
    if (!document.fullscreenElement && S.work && fsAvailable() && !inMeeting()) { setWork(false, 'left full screen'); return; }
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
    if (!S || S.idleSince || S.onBreak || S.phase === 'calling' || inMeeting()) return;
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
    else if (away && inMeeting()) { t.focus_ms += d; t.meeting_ms = (t.meeting_ms || 0) + d; }
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
    clearInterval(S.tickT); clearInterval(S.beatT); clearInterval(S.refreshT); stopLinkWatch(); CHK.notes = 'none'; CHK.link = 'up';
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
    o.innerHTML = '<div class="mkc-top" data-mkc-top></div><div class="mkc-splitbar" data-mkc-split></div><div class="mkc-dash" data-mkc-dash></div>'
      + '<div class="mkc-grid"><div class="mkc-panel mkc-num" data-mkc-num></div>'
      + '<div class="mkc-panel" data-mkc-script></div>'
      + '<div class="mkc-side" data-mkc-side></div></div><div data-mkc-wrapbox></div><div data-mkc-break></div>';
    document.body.appendChild(o);
    renderAll();
  }
  function renderAll() { renderTop(); renderSplit(); renderNum(); renderScript(); renderSide(); renderBreak(); }
  // v5 focus: once a call starts, only the call (script + their history) is on screen.
  // No call, no script.
  function setFocus() {
    var o = q('#mkc-overlay'); if (!o || !S) return;
    var inCall = S.phase === 'calling' || S.phase === 'wrapup';
    o.classList.toggle('mkc-focus', inCall);
    o.classList.toggle('mkc-noscript', !inCall);
    if (inCall && S.sideFull) { S.sideFull = false; renderSide(); }
  }
  // ---- commission chip (always on screen, also during a call)
  function commHtml() {
    var m = S.my;
    if (!m) return '<button type="button" class="mkc-comm" data-mkc-comm title="My money">💰 Commission…</button>';
    var pd = m.next_payday ? new Date(m.next_payday + 'T12:00:00+03:00') : null;
    var pdl = pd ? new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Africa/Kampala' }).format(pd) : '25th';
    return '<button type="button" class="mkc-comm" data-mkc-comm title="Commission: confirmed and pending (' + (m.hold_days || 7) + '-day hold). Payday is the 25th; payments confirmed by the 23rd count. Tap for details.">💰 <b data-mkc-earned>' + esc(ugx(m.earned_ugx)) + '</b> earned · <b>' + esc(ugx(m.on_hold_ugx)) + '</b> pending · payday <b data-mkc-payday>' + esc(pdl) + '</b><small> (cut-off 23rd · ' + (m.hold_days || 7) + '-day hold)</small></button>';
  }
  // ---- day split: blocks for existing customers, new agents and housekeeping
  function loadSplit(cb) {
    if (!S) return cb && cb();
    api('/day-split?person_key=' + encodeURIComponent(S.person)).then(function (d) { if (S) { S.split = d; renderSplit(); renderTop(); } }, function () {}).then(function () { if (cb) cb(); });
  }
  function blockPct(b) { return b.target ? Math.min(100, Math.round(100 * b.done / b.target)) : 0; }
  function renderSplit() {
    var el = q('[data-mkc-split]'); if (!el || !S) return;
    var P = S.split; if (!P || !P.blocks) { el.innerHTML = ''; return; }
    var sg = suggestedNow();
    el.innerHTML = '<div class="mkc-splitt"><b>Today\'s split</b><span>' + Object.keys(P.totals || {}).filter(function (k) { return k !== 'lunch'; }).map(function (k) { var t = P.totals[k]; return esc(t.label) + ' ' + t.done + '/' + t.target; }).join(' · ') + '</span>'
      + '<span class="mkc-muted" style="font-size:11px">A guide: switch tasks any time.</span>'
      + (sg ? '<span class="mkc-sugg" data-mkc-sugg-wrap>Suggested now: <b>' + esc(sg.label) + '</b> <button type="button" class="mkc-btn sm ghost" data-mkc-sugg="' + esc(sg.key) + '">Switch</button></span>' : '') + '</div><div class="mkc-blocks">'
      + P.blocks.map(function (b) {
        return '<div class="mkc-blk k-' + esc(b.kind) + (b.now ? ' now' : '') + (b.past ? ' past' : '') + '" title="' + esc(b.label) + ' ' + esc(b.start) + '–' + esc(b.end) + '"><b>' + esc(b.start) + '–' + esc(b.end) + (b.now ? ' · now' : '') + '</b><span>' + esc(b.label) + '</span>'
          + (b.kind === 'lunch' ? '<em>🍽</em>' : '<div class="bar"><i style="width:' + blockPct(b) + '%"></i></div><em>' + b.done + '/' + b.target + (b.kind === 'housekeeping' ? ' tasks' : ' calls') + '</em>') + '</div>';
      }).join('') + '</div>';
    var sb = q('[data-mkc-sugg]', el); if (sb) sb.onclick = function () { goTask(sb.getAttribute('data-mkc-sugg')); };
  }
  // The day split is a guide, not a lock: the caller picks the task. We only suggest the block's task.
  function balance() { return false; }
  function suggestedNow() {
    var b = S.split && S.split.current; if (!b) return null;
    if (b.kind === 'housekeeping') return S.phase === 'housekeeping' ? null : { key: 'housekeeping', label: 'Housekeeping', b: b };
    if (!b.tasks || !b.tasks.length) return null;
    if (S.phase !== 'housekeeping' && b.tasks.indexOf(S.task) >= 0) return null;
    var have = function (k) { return (boot.tasks || []).some(function (t) { return t.key === k; }); };
    var want = b.tasks.filter(function (k) { return have(k) && S.counts && S.counts[k] > 0; })[0] || b.tasks.filter(have)[0];
    return want ? { key: want, label: MODE_LABEL[want] || want, b: b } : null;
  }
  function goTask(k) {
    if (S.phase === 'calling' || S.phase === 'wrapup') { toast('Finish the wrap-up for this call first.', 'bad'); return; }
    S.fellBack = null;
    if (k === 'housekeeping') { openHousekeeping(); return; }
    if (S.phase === 'housekeeping') ev('housekeeping_off', k);
    if (k === S.task) { next(); renderTop(); return; }
    switchTask(k);
  }
  function openHousekeeping() {
    if (S.phase === 'calling' || S.phase === 'wrapup') { toast('Finish the wrap-up for this call first.', 'bad'); return; }
    if (S.phase === 'shown' && S.id) api('/sessions/' + S.id + '/task', { method: 'POST', body: { task_key: S.task } }).catch(function () {}); // let the shown number go back
    ev('housekeeping_on'); S.phase = 'housekeeping'; S.cur = null; S.hk = null; loadHk(); renderNum(); renderScript(); renderTop();
  }
  function oldBalance() {
    var P = S.split; var b = P && P.current;
    if (!b || S.manual === b.id) return false;
    if (b.kind === 'housekeeping') { S.phase = 'housekeeping'; S.cur = null; loadHk(); renderNum(); renderScript(); return true; }
    if (!b.tasks || !b.tasks.length || b.tasks.indexOf(S.task) >= 0) return false;
    var have = function (k) { return (boot.tasks || []).some(function (t) { return t.key === k; }); };
    var want = b.tasks.filter(function (k) { return have(k) && S.counts && S.counts[k] > 0; })[0] || b.tasks.filter(have)[0];
    if (!want || want === S.task) return false;
    toast('⏱ ' + b.start + '–' + b.end + ' is ' + b.label + ' time: switched to ' + (MODE_LABEL[want] || want) + '.');
    switchTask(want, true); return true;
  }
  // ---- housekeeping (read-only list; one tap done / note)
  function loadHk() {
    api('/housekeeping?person_key=' + encodeURIComponent(S.person)).then(function (d) { if (!S) return; S.hk = d; if (S.phase === 'housekeeping') renderNum(); }, function (e) { if (S) { S.hk = { items: [], error: e.message }; renderNum(); } });
  }
  var HK_ICON = { id: '🪪', listing: '🏠', promise: '💸' };
  function hkHtml() {
    var H = S.hk; var b = S.split && S.split.current;
    var head = '<h4>🧹 Housekeeping' + (b && b.kind === 'housekeeping' ? ' · ' + esc(b.start) + '–' + esc(b.end) + ' · ' + b.done + '/' + b.target + ' done' : '') + '</h4>';
    if (!H) return head + '<p class="mkc-muted">Loading the follow-ups…</p>';
    var list = (H.items || []).map(function (i) {
      return '<div class="mkc-hk" data-mkc-hkitem="' + esc(i.key) + '"><div class="ic">' + (HK_ICON[i.kind] || '•') + '</div><div class="tx"><b>' + esc(i.title) + '</b><div>' + esc(i.detail) + ' <span class="mkc-muted">' + esc(i.phone || '') + '</span></div>' + (i.last_note ? '<div class="mkc-muted">Note: ' + esc(i.last_note) + '</div>' : '') + '<div class="mkc-hknote" style="display:none"><input class="mkc-input" data-mkc-hknotein placeholder="Short note, e.g. asked on WhatsApp"><button type="button" class="mkc-btn sm dark" data-mkc-hknotesave>Save note</button></div></div>'
        + '<div class="bt"><button type="button" class="mkc-btn sm go" data-mkc-hkdone>✓ Done</button><button type="button" class="mkc-btn sm ghost" data-mkc-hknote>Note</button></div></div>';
    }).join('');
    return head + (H.practice ? '<p class="mkc-muted" style="margin:0 0 6px">Practice items (TEST).</p>' : '') + (list || '<div class="mkc-tpl"><b>All housekeeping done.</b> Nothing waiting.</div>')
      + '<div class="mkc-row" style="margin-top:10px"><button type="button" class="mkc-btn go" data-mkc-hkback>📞 Back to calls</button></div>';
  }
  function bindHk(el) {
    qa('[data-mkc-hkitem]', el).forEach(function (row) {
      var key = row.getAttribute('data-mkc-hkitem');
      var send = function (status, note) {
        api('/housekeeping/done', { method: 'POST', body: { person_key: S.person, key: key, status: status, note: note || '' } }).then(function () {
          toast(status === 'done' ? 'Done ✓' : 'Note saved');
          if (status === 'done') { S.hk.items = S.hk.items.filter(function (i) { return i.key !== key; }); }
          else S.hk.items.forEach(function (i) { if (i.key === key) i.last_note = note; });
          renderNum(); loadSplit();
        }, function (e) { toast(e.message, 'bad'); });
      };
      q('[data-mkc-hkdone]', row).onclick = function () { send('done'); };
      q('[data-mkc-hknote]', row).onclick = function () { var n = q('.mkc-hknote', row); n.style.display = n.style.display === 'none' ? 'flex' : 'none'; q('[data-mkc-hknotein]', row).focus(); };
      q('[data-mkc-hknotesave]', row).onclick = function () { send('note', q('[data-mkc-hknotein]', row).value.trim()); };
    });
    var back = q('[data-mkc-hkback]', el); if (back) back.onclick = function () { ev('housekeeping_off', S.task); next(); renderTop(); };
  }
  function renderTop() {
    var el = q('[data-mkc-top]'); if (!el || !S) return;
    var st = S.stats || {}; var tg = st.targets || { calls_per_day: 40, closes_per_day: 2 };
    var road = st.road_to_1000 || { paying_now: 0, goal: 1000, percent: 0 };
    var opts = boot.tasks.map(function (t) { return '<option value="' + esc(t.key) + '"' + (t.key === S.task ? ' selected' : '') + '>' + esc(t.name) + '</option>'; }).join('');
    var fsLink = (document.fullscreenElement || !document.documentElement.requestFullscreen) ? '' : ' · <a href="#" data-mkc-fs style="color:#fbbf24">full screen</a>';
    el.innerHTML = '<button type="button" class="mkc-work' + (S.work ? ' on' : '') + '" data-mkc-work aria-pressed="' + (S.work ? 'true' : 'false') + '"><span class="knob"></span><b>' + (S.work ? 'WORK MODE ON' : 'WORK MODE OFF') + '</b><small>' + (S.work ? 'work time counting' : 'downtime <span data-mkc-down>' + clock(S.totals.down_ms || 0) + '</span>') + '</small></button>'
      + '<div class="who">' + esc(personName(S.person)) + '<small>Work time <span data-mkc-worktime>' + clock(S.totals.open_ms) + '</span>' + fsLink + '</small></div>'
      + commHtml()
      + (st.calls_hit ? '<span class="mkc-hitchip" data-mkc-hit>🎯 Target hit – keep going</span>' : '')
      + '<div class="mkc-modes" role="tablist" aria-label="Task">' + boot.tasks.map(function (t) { var n = S.counts && S.counts[t.key]; return '<button type="button" role="tab" class="mkc-mode' + (t.key === S.task && S.phase !== 'housekeeping' ? ' on' : '') + (n === 0 ? ' dry' : '') + '" data-mkc-mode="' + esc(t.key) + '" title="' + (n == null ? '' : n + ' numbers left today') + '">' + esc(MODE_LABEL[t.key] || t.name) + '<i title="numbers left to call today">' + (n == null ? '…' : n + ' to call') + '</i></button>'; }).join('')
        + '<button type="button" role="tab" class="mkc-mode' + (S.phase === 'housekeeping' ? ' on' : '') + '" data-mkc-mode="housekeeping" title="Follow-ups: ID, photos, unpaid promises">🧹 Housekeeping<i>' + (S.counts && S.counts.housekeeping != null ? S.counts.housekeeping : '…') + '</i></button></div>'
      + (S.counts && S.counts.international ? '<span class="mkc-intlchip" title="Not Ugandan numbers: never offered to call. Follow up on WhatsApp.">🌍 ' + S.counts.international + ' international – WhatsApp only</span>' : '')
      + '<select data-mkc-lang-ui aria-label="Language"><option value="en"' + (S.lang === 'en' ? ' selected' : '') + '>English</option><option value="lg"' + (S.lang === 'lg' ? ' selected' : '') + '>Luganda</option></select>'
      + '<span class="mkc-net" data-mkc-net style="' + (net.offline ? '' : 'display:none') + '">' + esc(T('offline')) + '</span>'
      + '<div class="mkc-road"><div style="font-size:11px;color:#94a3b8">Road to 1000 · <b style="color:#fff">' + road.paying_now + '</b> paying</div><div class="bar"><i style="width:' + Math.max(1, Math.min(100, road.percent || 0)) + '%"></i></div></div>'
      + '<div class="sp"></div>'
      + '<button type="button" class="mkc-btn sm" style="background:#7c3aed;color:#fff" data-mkc-meet>🗓 Meeting</button>'
      + '<button type="button" class="mkc-btn mkc-in" data-mkc-in title="Someone rang the company phone and you answered in Phone Link">📲 Incoming call</button>'
      + '<button type="button" class="mkc-btn sm" style="background:#0ea5e9;color:#fff" data-mkc-live>🌐 Live site</button>'
      + '<button type="button" class="mkc-btn sm go" data-mkc-add>➕ Add number</button>'
      + '<button type="button" class="mkc-btn sm ghost" style="color:#fff;border-color:#475569" data-mkc-rep>' + esc(T('report')) + '</button>'
      + '<button type="button" class="mkc-btn sm ghost" style="color:#fff;border-color:#475569" data-mkc-plan>📋 Today\'s plan</button>'
      + '<button type="button" class="mkc-btn sm amber" data-mkc-brk>' + (S.lang === 'lg' ? esc(T('brk')) : 'Lunch / break') + '</button>'
      + '<button type="button" class="mkc-btn sm red" data-mkc-exit>' + esc(T('exit')) + '</button>';
    qa('[data-mkc-mode]', el).forEach(function (b) { b.onclick = function () { goTask(b.getAttribute('data-mkc-mode')); }; });
    renderDash();
    q('[data-mkc-lang-ui]', el).onchange = function (e) { setLang(e.target.value); };
    q('[data-mkc-add]', el).onclick = openAddNumber;
    q('[data-mkc-in]', el).onclick = openInbound;
    q('[data-mkc-meet]', el).onclick = function () { openTeamMeeting(); };
    checkMeeting(true);
    q('[data-mkc-live]', el).onclick = openLive;
    q('[data-mkc-rep]', el).onclick = function () { openReport(S.person); };
    q('[data-mkc-brk]', el).onclick = toggleBreak;
    q('[data-mkc-plan]', el).onclick = function () { openPlan(false); };
    q('[data-mkc-work]', el).onclick = function () { setWork(!S.work); };
    q('[data-mkc-comm]', el).onclick = function () { if (S.my) openMoney(); };
    q('[data-mkc-exit]', el).onclick = exitSession;
    var fs = q('[data-mkc-fs]', el); if (fs) fs.onclick = function (e) { e.preventDefault(); document.documentElement.requestFullscreen().catch(function () {}); };
  }
  var MODE_LABEL = { new_agents: 'Get new agents', payments: 'Get payments in', retention: 'Client retention' };
  function taskLabel(k) { return k === 'housekeeping' ? 'Housekeeping' : (MODE_LABEL[k] || k); }
  function taskTimeHtml(ms, cls) {
    var ks = Object.keys(ms || {}).filter(function (k) { return ms[k] >= 1000; }).sort(function (x, y) { return ms[y] - ms[x]; });
    if (!ks.length) return '<span class="mkc-muted">No task time yet</span>';
    return ks.map(function (k) { return '<span class="mkc-pill ' + (cls || '') + '" data-mkc-tasktime="' + esc(k) + '">⏱ ' + esc(taskLabel(k)) + ' ' + hm(ms[k]) + '</span>'; }).join(' ');
  }
  function ugx(n) { return 'UGX ' + Number(n || 0).toLocaleString('en-GB'); }
  function ring(v, max, color, label) {
    var r = 26, c = 2 * Math.PI * r, pct = Math.max(0, Math.min(1, max ? v / max : 0));
    return '<div class="mkc-ring" title="' + esc(label) + '"><svg width="62" height="62"><circle cx="31" cy="31" r="' + r + '" fill="none" stroke="#e2e8f0" stroke-width="7"/><circle cx="31" cy="31" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="7" stroke-linecap="round" stroke-dasharray="' + (c * pct).toFixed(1) + ' ' + c.toFixed(1) + '"/></svg><em>' + v + '/' + max + '</em></div>';
  }
  function badgesFor(st, tg) {
    var calls = st.calls || 0, closes = st.closes || 0;
    return [
      ['First call', calls >= 1], ['10 calls', calls >= 10], ['20 calls', calls >= 20], ['Target ' + tg.calls_per_day, calls >= tg.calls_per_day],
      ['First paid', closes >= 1], [tg.closes_per_day + ' paid', closes >= tg.closes_per_day], ['Hot hour 8+', (st.this_hour || 0) >= 8], ['3-day streak', (st.streak_days || 0) >= 3]
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
    el.innerHTML = '<div class="mkc-dcard">' + ring(st.calls || 0, tg.calls_per_day, (st.calls_hit ? '#10b981' : '#0ea5e9'), 'Calls vs target') + '<div><b>' + (toGo ? toGo + ' to go' : 'Target hit – keep going') + '</b><span>calls today' + (toGo ? '' : ' · numbers keep coming') + (st.not_answered ? '<br>Not answered: ' + st.not_answered + ' (not counted, back in 24h)' : '') + '</span></div></div>'
      + '<div class="mkc-dcard">' + ring(st.closes || 0, tg.closes_per_day, '#f59e0b', 'Paid vs target') + '<div><b>' + (st.closes || 0) + ' paid (closed)</b><span>target ' + tg.closes_per_day + '</span></div></div>'
      + '<div class="mkc-dcard mkc-money"><div><b>' + (money.on_commission ? ugx(money.earned_ugx) : ugx((money.payments_closed || 0) * 50000)) + '</b><span>' + (money.on_commission ? 'earned today (est. ' + money.rate_pct + '%)' : 'payments in today') + '</span></div><div><b style="color:#b45309">' + (money.on_commission ? ugx(money.at_stake_ugx) : (money.payments_pending || 0) + ' to pay') + '</b><span>at stake: sign-ups / promises</span></div></div>'
      + '<div class="mkc-dcard"><div><b>' + hm((st.talk_s || 0) * 1000) + '</b><span>time on calls</span></div><div><b>' + (st.streak_days || 0) + '🔥</b><span>day streak</span></div><div><b>' + (st.queue_left == null ? '–' : st.queue_left) + '</b><span>' + esc(T('left')) + '</span></div></div>'
      + '<div class="mkc-dcard"><div class="mkc-hours" title="Calls per hour today (Kampala)">' + hours.map(function (x) { return '<i class="' + (x === nowH ? 'now' : '') + '" style="height:' + Math.max(3, Math.round(40 * (byH[x] || 0) / maxH)) + 'px" title="' + x + ':00 · ' + (byH[x] || 0) + ' calls"></i>'; }).join('') + '</div><div><b>' + (st.this_hour || 0) + '</b><span>this hour</span></div></div>'
      + (S.plan ? '<div class="mkc-dcard" style="min-width:190px;cursor:pointer" data-mkc-planline><div style="flex:1"><b>📋 ' + (S.plan.plan.goal ? esc(String(S.plan.plan.goal).slice(0, 60)) : 'Plan: ' + S.plan.plan.calls_target + ' calls') + '</b><span>' + (S.plan.plan.agreed_by ? 'agreed with ' + esc(S.plan.plan.agreed_by) : 'not agreed with King yet') + '</span></div></div>' : '')
      + '<div class="mkc-dcard" style="min-width:190px"><div style="flex:1"><b>' + ((st.road_to_1000 || {}).paying_now || 0) + ' / 1,000</b><span>paid agents · company goal</span><div class="bar" style="height:8px;background:#e2e8f0;border-radius:99px;margin-top:4px;overflow:hidden"><i style="display:block;height:100%;background:linear-gradient(90deg,#10b981,#f59e0b);width:' + Math.max(1, Math.min(100, (st.road_to_1000 || {}).percent || 0)) + '%"></i></div></div></div>'
      + '<div class="mkc-dcard" style="min-width:220px" data-mkc-taskcard><div style="flex:1"><b>Time per task today</b><div style="margin-top:4px">' + taskTimeHtml(st.task_ms) + '</div></div></div>'
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
  function switchTask(key, auto) {
    if (S.phase === 'calling' || S.phase === 'wrapup') { toast('Finish the wrap-up for this call first.', 'bad'); renderTop(); return; }
    if (!auto) { var cb0 = S.split && S.split.current; S.manual = cb0 ? cb0.id : 'manual'; }
    api('/sessions/' + S.id + '/task', { method: 'POST', body: { task_key: key } }).then(function () {
      S.task = key; S.variant = null; S.lastDone = null; S.fellBack = null; next(); refreshSide(); renderTop();
    }, function (e) { toast(e.message, 'bad'); renderTop(); });
  }

  // ----------------------------------------------------------- the number --
  function next() {
    if (!S) return;
    S.phase = 'loading'; S.cur = null; S.wrap = { outcome: '', checklist: {}, note: '', callback: '' }; S.callStart = null; S.callEnd = null; S.error = '';
    S.coach = { answered: null, step: 0, hi: null }; S.stageManual = null; S.tx = null; TX = null; S.suggest = null;
    S.route = { node: null, path: [], end: null }; S.fullScript = false; S.endedAt = Date.now();
    var cbk = S.split && S.split.current; if (cbk && S.manual && S.manual !== cbk.id && S.manual !== 'manual') S.manual = null;
    if (balance()) { setFocus(); renderSplit(); return; }
    if (outbox().length) { S.phase = 'offline_wait'; renderNum(); flush(); return; }
    renderNum();
    var prefer = S.preferNext || ''; S.preferNext = null;
    if (prefer && S.preferTask && S.preferTask !== S.task) {
      var to = S.preferTask; S.preferTask = null; S.preferNext = prefer;
      api('/sessions/' + S.id + '/task', { method: 'POST', body: { task_key: to } }).then(function () { if (!S) return; S.task = to; S.fellBack = null; renderTop(); next(); }, function () { if (S) { S.preferTask = null; next(); } });
      return;
    }
    S.preferTask = null;
    api('/sessions/' + S.id + '/next', { method: 'POST', body: { prefer_submission: prefer } }).then(function (d) {
      if (!S) return;
      if (d && d.task_key && d.task_key !== S.task) {
        var from = d.fell_back_from ? d.fell_back_from.name : taskLabel(S.task);
        S.task = d.task_key; S.variant = null;
        if (d.fell_back_from) { S.fellBack = { from: from, to: taskLabel(d.task_key) }; toast('📭 ' + from + ' ran out: now ' + taskLabel(d.task_key) + '.'); }
        loadCounts(); renderTop(); refreshSide();
      }
      S.cur = d && d.attempt ? d : null;
      if (!S.cur) { S.phase = 'empty'; } else {
        var a = d.attempt;
        S.phase = a.status === 'calling' ? (a.ended_at ? 'wrapup' : 'calling') : 'shown';
        if (a.direction === 'inbound' && S.phase === 'calling' && S.coach.answered == null) { S.coach.answered = true; S.wrap.checklist.answered = true; if (txSupported() && !TX) startTx(true); var R0 = routeFor(); if (R0) S.route.node = R0.start; }
        if (a.tapped_at) S.callStart = new Date(a.tapped_at).getTime();
        if (a.ended_at) S.callEnd = new Date(a.ended_at).getTime();
        S.variant = d.script_variant || S.variant;
      }
      renderNum(); renderScript();
      if (S.loadT0) { S.lastGapMs = Date.now() - S.loadT0; S.loadT0 = null; }
    }, function (e) { if (S) { S.phase = isNetErr(e) ? 'offline_wait' : 'error'; S.error = e.message; if (S.phase === 'offline_wait') setNet(true); renderNum(); } });
  }
  function loadCounts() { if (!S) return; api('/counts?person_key=' + encodeURIComponent(S.person)).then(function (c) { if (S) { S.counts = c; renderTop(); } }, function () {}); }
  function renderNum() {
    var el = q('[data-mkc-num]'); if (!el || !S) return;
    var task = taskOf(S.task);
    setFocus();
    if (S.phase !== 'wrapup') { var wb0 = q('[data-mkc-wrapbox]'); if (wb0) wb0.innerHTML = ''; }
    if (S.phase === 'housekeeping') { el.innerHTML = hkHtml(); bindHk(el); return; }
    if (S.phase === 'loading') { el.innerHTML = '<p class="mkc-muted">Finding the next number…</p>'; return; }
    if (S.phase === 'offline_wait') {
      el.innerHTML = lastDoneHtml() + '<div class="mkc-offline-card"><b>' + esc(T('offline')) + '</b><p>Your last call is saved on this phone (' + outbox().length + ' to send). The next number comes as soon as the connection is back. Nothing is lost.</p><button class="mkc-btn" data-mkc-retry>Try now</button></div>';
      q('[data-mkc-retry]', el).onclick = function () { flush(); if (!outbox().length) next(); }; bindLastDone(el); return;
    }
    if (S.phase === 'error') { el.innerHTML = '<div class="mkc-err">' + esc(S.error) + '</div><button class="mkc-btn go" style="margin-top:10px" data-mkc-retry>Try again</button>'; q('[data-mkc-retry]', el).onclick = next; return; }
    if (S.phase === 'empty') {
      var intl = S.counts && S.counts.international;
      el.innerHTML = lastDoneHtml() + '<h4>' + esc(taskLabel(task.key)) + '</h4><div style="font-size:20px;font-weight:900" data-mkc-alldry>Every calling list is empty right now.</div><p class="mkc-muted">Everyone was called today, has a callback booked for later, or asked not to be called. New numbers come in through the day: Check again, add a number you found, or do housekeeping.</p>'
        + (intl ? '<p class="mkc-muted">🌍 ' + intl + ' international numbers are kept out of calls: WhatsApp only.</p>' : '')
        + '<div class="mkc-row"><button class="mkc-btn" data-mkc-retry>Check again</button><button class="mkc-btn go" data-mkc-hkgo>🧹 Housekeeping</button><button class="mkc-btn" data-mkc-addgo>➕ Add number</button></div>';
      q('[data-mkc-retry]', el).onclick = function () { loadCounts(); next(); }; q('[data-mkc-hkgo]', el).onclick = openHousekeeping; q('[data-mkc-addgo]', el).onclick = openAddNumber; bindLastDone(el); return;
    }
    var d = S.cur; var a = d.attempt;
    var head = (S.phase === 'shown' ? lastDoneHtml() : '')
      + (S.fellBack ? '<div class="mkc-fellback" data-mkc-fellback>📭 <b>' + esc(S.fellBack.from) + '</b> ran out, so these are <b>' + esc(S.fellBack.to) + '</b> numbers.</div>' : '')
      + '<h4>' + esc(MODE_LABEL[task.key] || task.name) + (d.resumed ? ' · picked up where you left off' : '') + '</h4>'
      + '<div class="name">' + esc(a.name || 'Name not known') + '</div>'
      + '<div class="src">' + esc(a.reason && String(a.source_label || '').indexOf(a.reason) >= 0 ? String(a.source_label).replace(' · ' + a.reason, '') : (a.source_label || '')) + '</div>'
      + (a.reason ? '<span class="mkc-reason' + (a.source_kind === 'callback' ? ' mkc-cb' : '') + '">' + esc(a.reason) + '</span>' : '')
      + '<div class="mkc-phone">' + esc(boot.sandbox && a.phone_masked && !/^7000001\d{2}$/.test(String(a.phone || '').replace(/\D/g, '').slice(-9)) ? a.phone_masked : prettyPhone(a.phone)) + '</div>';
    var body = '';
    if (S.phase === 'shown' && !checkPassed()) {
      body = gateHtml();
    } else if (S.phase === 'shown') {
      body = '<a class="mkc-btn go mkc-call" href="' + esc(d.tel) + '" data-mkc-tap title="' + (isPhone() ? 'Opens the phone app' : 'Rings out from the company phone through Phone Link (Bluetooth)') + '"><i class="fas fa-phone"></i>&nbsp;' + (isPhone() ? esc(T('call_next')) : 'Call now') + '</a>'
        + '<div class="mkc-row" style="margin-top:8px;justify-content:center"><button type="button" class="mkc-btn ghost sm" data-mkc-skip>' + esc(T('skip')) + '</button><button type="button" class="mkc-btn ghost sm" data-mkc-tree>History tree</button></div>'
        + (boot.sandbox ? practiceCallHelp(a) : '');
    } else if (S.phase === 'calling') {
      body = '<div class="mkc-calling"><span class="dot"></span>' + (S.coach.answered ? 'On the call' : 'Ringing…') + ' <span data-mkc-calltimer>' + clock(Date.now() - (S.callStart || Date.now())) + '</span></div>'
        + '<button type="button" class="mkc-btn red mkc-call" style="margin-top:8px" data-mkc-end>' + esc(T('end')) + '</button>'
        + txHtml();
    } else if (S.phase === 'wrapup') {
      body = '<div class="mkc-calling" style="background:#f1f5f9;color:#334155"><span class="dot" style="background:#64748b;animation:none"></span>Call ended · ' + clock((S.callEnd || Date.now()) - (S.callStart || Date.now())) + '</div>';
    }
    var tools = payHtml(a) + contactHtml(a);
    var inCall = S.phase === 'calling' || S.phase === 'wrapup';
    el.innerHTML = head + body + contextHtml(d, true) + (inCall ? (tools ? '<details class="mkc-extras"><summary>💰 Payment · texts</summary>' + tools + '</details>' : '') : tools);
    bindPay(el, a); bindContact(el, a);
    bindTx(el); bindGate(el);
    bindLastDone(el);
    var tapEl = q('[data-mkc-tap]', el);
    if (tapEl) tapEl.onclick = function (e) {
      if (!S.work) { e.preventDefault(); toast('Turn work mode on to call.', 'bad'); setWork(true, 'to call'); return; }
      if (!checkPassed()) { e.preventDefault(); toast('Do the mic check first.', 'bad'); renderNum(); return; }
      // The tel: link opens the dialler by itself; we only log the time.
      S.callStart = Date.now(); S.phase = 'calling'; S.lastDone = null;
      if (txSupported() && !TX) startTx(true); // live notes start with the call (your mic only)
      renderNum(); renderScript();
      op('/attempts/' + a.id + '/tap', { session_id: S.id, check: checkPayload() }).catch(function (e) { if (e.status === 428) { CHK.notes = 'none'; } toast(e.message, 'bad'); });
    };
    var endIt = endCallNow;
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
    if (S.phase === 'wrapup') renderWrap(task, a);
  }
  function endCallNow() {
    var a = S && S.cur && S.cur.attempt; if (!a || S.phase !== 'calling') return Promise.resolve();
    var task = taskOf(S.task);
    stopTx();
    S.callEnd = Date.now(); S.phase = 'wrapup'; autoWrap(task); renderNum(); renderScript();
    return op('/attempts/' + a.id + '/end', { session_id: S.id }).catch(function (e) { toast(e.message, 'bad'); });
  }
  function renderWrap(task, a) {
    var box = q('[data-mkc-wrapbox]'); if (!box) return;
    box.innerHTML = '<div class="mkc-wrapmodal">' + wrapHtml(task, a) + '</div>';
    bindWrap(box, task, a);
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
    var posted = /^What they posted: /.test(c.reason || '') ? String(c.reason).replace(/^What they posted: /, '') : '';
    var list = h.map(function (x) {
      return '<li><b>' + esc(kDayTime(x.at)) + '</b> · ' + esc(personName(x.by)) + ' · <b>' + esc(x.skipped ? 'skipped' : x.what) + '</b>' + (x.summary && x.summary !== x.note ? ' – ' + esc(x.summary) : (x.note ? ' – ' + esc(x.note) : '')) + (x.next_text ? ' <span class="mkc-good" data-mkc-histnext>→ ' + esc(x.next_text) + '</span>' : '') + (x.next_step ? ' <span class="mkc-good">→ call ' + esc(kDayTime(x.next_step)) + '</span>' : '') + '</li>';
    }).join('');
    return '<div class="mkc-ctx">' + tags
      + '<div style="font-size:13px;margin-top:2px"><b>Where from:</b> ' + esc(c.source_label || '–') + (c.reason && !posted ? ' · <b>Why now:</b> ' + esc(c.reason) : '') + '</div>'
      + (posted ? '<div class="mkc-posted" data-mkc-posted><b>What they posted:</b> ' + esc(posted) + '</div>' : '')
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
    if (!txSupported()) return '<p class="mkc-muted" style="text-align:center;margin:6px 0 0;font-size:12px">Live notes work in Chrome or Edge on the laptop' + (isPhone() ? ' (not on the phone while it is on a call)' : '') + '.</p>';
    if (S.tx === 'on') return '<div class="mkc-tpl" style="background:#eff6ff;border-color:#bfdbfe;margin-top:6px" data-mkc-txon><b><span class="dot" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#2563eb;margin-right:6px"></span>Live notes on · your mic only</b> <button type="button" class="mkc-btn sm" data-mkc-tx="stop">Stop</button>'
      + '<div class="mkc-muted" style="font-size:11px">Use a headset so only your voice is picked up. Only text is kept, never audio.</div><div class="mkc-muted" style="font-size:12px;max-height:60px;overflow:auto" data-mkc-txlive>' + esc(TX && TX.text ? TX.text.slice(-300) : 'Listening…') + '</div></div>';
    if (S.tx === 'error') return '<p class="mkc-muted" style="text-align:center;margin:6px 0 0">' + esc(S.txErr || 'Live notes stopped.') + ' <button type="button" class="mkc-btn sm" data-mkc-tx="yes">Try again</button></p>';
    if (S.tx === 'done') return '';
    return '<div style="text-align:center;margin-top:6px"><button type="button" class="mkc-btn sm" style="border:2px solid #2563eb;color:#1d4ed8;background:#fff" data-mkc-tx="yes">🎙 Start live notes</button></div>';
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
  function startTx(auto) {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR || !txSupported()) return;
    try {
      var r = new SR(); r.continuous = true; r.interimResults = true; r.lang = S.lang === 'lg' ? 'en-UG' : 'en-UG';
      TX = { text: '', start: Date.now(), sr: r, stopped: false };
      r.onresult = function (e) {
        var interim = '';
        for (var i = e.resultIndex; i < e.results.length; i++) { if (e.results[i].isFinal) TX.text += e.results[i][0].transcript.trim() + '. '; else interim += e.results[i][0].transcript; }
        var live = q('[data-mkc-txlive]'); if (live) live.textContent = (TX.text + interim).slice(-300);
      };
      r.onerror = function (e) {
        var code = e && e.error;
        if (code === 'no-speech' || code === 'aborted') return; // silence: it restarts on its own
        if (TX) TX.stopped = true;
        S.tx = 'error'; S.txErr = code === 'not-allowed' || code === 'service-not-allowed' ? 'Microphone blocked: click the 🎤 in the address bar and allow it.' : code === 'network' ? 'Live notes need the internet (Chrome/Edge send speech to their service).' : 'Live notes stopped (' + code + ').';
        ev('notes_error', code || '');
        if (code === 'audio-capture') linkDown('audio lost during a call'); else CHK.notes = 'none';
        if (S.phase === 'calling') renderNum();
      };
      r.onend = function () { if (TX && !TX.stopped) { try { r.start(); } catch (x) { /* ignore */ } } };
      r.start();
      S.tx = 'on'; S.wrap.checklist.transcribed = auto ? 'auto' : 'manual'; ev('notes_start', auto ? 'auto with call' : 'manual');
      if (!auto) { renderNum(); renderScript(); }
    } catch (x) { toast('Live notes are not available in this browser.', 'bad'); }
  }
  function stopTx() {
    if (!TX || TX.stopped) return;
    TX.stopped = true; TX.secs = Math.round((Date.now() - TX.start) / 1000);
    try { TX.sr.stop(); } catch (x) { /* ignore */ }
    S.tx = 'done'; ev('notes_stop', TX.secs + 's');
  }
  // ---- Mic + live-notes check and phone-link watch (Arthur, 21 Nov 2026).
  // Call now stays locked until the mic is allowed and live notes have heard a
  // test phrase. If the phone link / Bluetooth audio device disappears, or live
  // notes lose the mic, calls pause behind a reconnect card until the check
  // passes again. Every pass, fail and drop is logged for King.
  var BT_RE = /bluetooth|hands-?free|headset|phone link|airpods|buds|galaxy|iphone|pixel|tecno|infinix|itel|redmi|xiaomi|nokia|samsung|oppo|vivo|\bbt\b/i;
  var CHK = { notes: 'none', at: null, watch: [], bt: '', link: 'up', running: false, heard: '', why: '' };
  var LINKT = null;
  var CHECK_EVERY_MS = 2 * 3600 * 1000; // re-check every 2 hours of calling
  function checkPassed() {
    if (CHK.notes === 'ok' && CHK.at && Date.now() - Date.parse(CHK.at) > CHECK_EVERY_MS) { CHK.notes = 'none'; CHK.why = ''; }
    return CHK.notes === 'ok' && CHK.link !== 'down';
  }
  function checkPayload() { return { notes: CHK.notes, at: CHK.at, link: CHK.link, bt: CHK.bt ? 'yes' : 'no' }; }
  function audioInputs() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return Promise.resolve([]);
    return navigator.mediaDevices.enumerateDevices().then(function (l) { return l.filter(function (d) { return d.kind === 'audioinput' || d.kind === 'audiooutput'; }); }).catch(function () { return []; });
  }
  function checkFail(why, code) {
    CHK.running = false; CHK.notes = 'failed'; CHK.why = why; ev('notes_check_failed', code || why.slice(0, 60)); beat(); renderNum();
  }
  function runCheck() {
    if (CHK.running) return;
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR || !txSupported()) { checkFail('Live notes only work in Chrome or Edge on the laptop. Open makaug.com there to call.', 'unsupported'); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { checkFail('This browser cannot use the microphone.', 'no_media'); return; }
    CHK.running = true; CHK.heard = ''; CHK.why = ''; renderNum();
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      var track = stream.getAudioTracks()[0]; var micLabel = track ? track.label : '';
      stream.getTracks().forEach(function (t) { t.stop(); });
      return audioInputs().then(function (devs) {
        var bt = devs.filter(function (d) { return d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications' && BT_RE.test(d.label || ''); });
        var mics = devs.filter(function (d) { return d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications'; });
        var watch = (bt.length ? bt : mics).map(function (d) { return d.deviceId; });
        var r; var ended = false; var timer;
        var finish = function (ok, why, code) {
          if (ended) return; ended = true; clearTimeout(timer); try { r.abort(); } catch (x) { /* ignore */ }
          if (!ok) { checkFail(why, code); return; }
          var wasDown = CHK.link === 'down';
          CHK.running = false; CHK.notes = 'ok'; CHK.at = new Date().toISOString(); CHK.watch = watch; CHK.bt = bt.length ? (bt[0].label || 'Bluetooth device') : ''; CHK.link = 'up'; CHK.why = '';
          ev('notes_check_passed', (micLabel || 'mic') + (CHK.bt ? ' · phone link: ' + CHK.bt : ' · no Bluetooth device seen'));
          if (wasDown) ev('link_back', CHK.bt || micLabel || '');
          beat(); startLinkWatch(); renderNum();
        };
        try {
          r = new SR(); r.continuous = true; r.interimResults = true; r.lang = 'en-UG';
          r.onresult = function (e) {
            var t = ''; for (var i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
            CHK.heard = t; var live = q('[data-mkc-chkheard]'); if (live) live.textContent = '“' + t + '”';
            if (t.replace(/\s+/g, '').length >= 3) finish(true);
          };
          r.onerror = function (e) {
            var code = e && e.error;
            if (code === 'no-speech' || code === 'aborted') return;
            finish(false, code === 'not-allowed' || code === 'service-not-allowed' ? 'The microphone is blocked. Click the 🎤 or 🔒 at the left of the address bar, choose Allow for the microphone, then check again.' : code === 'audio-capture' ? 'No microphone found. Reconnect the headset or the phone link, then check again.' : code === 'network' ? 'Live notes need the internet. Check the Wi-Fi, then check again.' : 'Live notes did not start (' + code + '). Check again.', code);
          };
          r.start();
        } catch (x) { finish(false, 'Live notes could not start in this browser.', 'start_failed'); return; }
        timer = setTimeout(function () { finish(false, 'We didn’t hear you. Say “testing one two three” clearly, close to the mic, then check again.', 'not_heard'); }, 15000);
      });
    }, function (err) {
      var n = err && err.name;
      checkFail(n === 'NotAllowedError' ? 'The microphone is blocked. Click the 🎤 or 🔒 at the left of the address bar, choose Allow for the microphone, then check again.' : 'No microphone found. Plug in or reconnect the headset / phone link, then check again.', n || 'mic_error');
    });
  }
  function linkDown(detail) {
    if (CHK.link === 'down') return;
    CHK.link = 'down'; CHK.notes = 'none'; ev('link_drop', detail || ''); beat();
    if (S && S.phase === 'calling') toast('The phone link / audio dropped. Finish this call, then reconnect.', 'bad');
    renderNum();
  }
  function checkLink() {
    if (!S || CHK.notes !== 'ok' || !CHK.watch.length) return;
    audioInputs().then(function (devs) {
      var have = devs.map(function (d) { return d.deviceId; });
      var still = CHK.watch.some(function (id) { return have.indexOf(id) >= 0; });
      if (!still) linkDown(CHK.bt ? CHK.bt + ' disconnected' : 'microphone disconnected');
    });
  }
  function startLinkWatch() {
    if (LINKT) return;
    if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) navigator.mediaDevices.addEventListener('devicechange', checkLink);
    LINKT = setInterval(checkLink, 15000);
  }
  function stopLinkWatch() {
    if (navigator.mediaDevices && navigator.mediaDevices.removeEventListener) navigator.mediaDevices.removeEventListener('devicechange', checkLink);
    clearInterval(LINKT); LINKT = null;
  }
  function gateHtml() {
    if (CHK.link === 'down') {
      return '<div class="mkc-gate mkc-reconnect" data-mkc-reconnect><div class="mkc-gate-t">🔌 The phone link dropped. Calls are paused.</div>'
        + '<p>Nobody can hear the call, so live notes can’t work. Reconnect, then check again:</p><ol>'
        + '<li><b>On the company phone:</b> unlock it and make sure <b>Bluetooth is ON</b>.</li>'
        + '<li><b>On the laptop:</b> open <b>Phone Link</b> (Start ⊞ → type “Phone Link”). If it says Disconnected, click <b>Reconnect</b>.</li>'
        + '<li>Still not connected? <b>Settings → Bluetooth &amp; devices</b> → click the phone → <b>Connect</b>. Not listed? <b>Add device → Bluetooth</b> → pick the phone, then open Phone Link again.</li>'
        + '<li>Using a headset? Turn it off and on, then pick it in <b>Settings → System → Sound → Input</b>.</li></ol>'
        + '<button type="button" class="mkc-btn go mkc-call" data-mkc-mcheck>✅ I’ve reconnected – check again</button>'
        + '<button type="button" class="mkc-btn ghost" style="margin-top:8px;width:100%" data-mkc-connect="fix">📱 Show me with pictures</button></div>';
    }
    var row = function (ok, label, note) { return '<div class="mkc-gate-row"><span>' + (ok === true ? '✅' : ok === false ? '❌' : '⬜') + '</span><b>' + label + '</b>' + (note ? '<span class="mkc-muted">' + note + '</span>' : '') + '</div>'; };
    var failed = CHK.notes === 'failed';
    var body = '<div class="mkc-gate" data-mkc-gate><div class="mkc-gate-t">🎙 Mic check before you call</div>'
      + '<p>Calls stay locked until live notes can hear you. Put the phone on speaker near the laptop (or use the headset).</p>'
      + row(failed && /blocked|microphone|No microphone/i.test(CHK.why) ? false : (CHK.running || CHK.notes === 'ok') ? true : null, 'Microphone allowed')
      + row(failed ? false : CHK.notes === 'ok' ? true : null, 'Live notes hear you', CHK.running ? 'Say: “testing one two three”' : '')
      + (CHK.running ? '<div class="mkc-gate-heard" data-mkc-chkheard>Listening…</div>' : '')
      + (failed ? '<div class="mkc-err" data-mkc-chkwhy>' + esc(CHK.why) + '</div>' : '')
      + '<button type="button" class="mkc-btn go mkc-call" data-mkc-mcheck' + (CHK.running ? ' disabled' : '') + '>' + (CHK.running ? 'Listening…' : failed ? '🔁 Check again' : '🎙 Start the mic check') + '</button>'
      + '<button type="button" class="mkc-btn ghost sm" style="margin-top:8px" data-mkc-connect="bt">📱 Connect your phone (pictures)</button>'
      + '<p class="mkc-muted" style="font-size:12px;margin-top:6px">Only text is kept, never audio. 🔒 Call now unlocks when both are ✅.</p></div>';
    return body;
  }
  function bindGate(el) {
    qa('[data-mkc-mcheck]', el).forEach(function (b) { b.onclick = function () { runCheck(); }; });
    qa('[data-mkc-connect]', el).forEach(function (b) { b.onclick = function () { openConnect(b.getAttribute('data-mkc-connect') || ''); }; });
  }
  // ---- Connect your phone (Arthur, 21 Nov 2026). One big, visual page:
  // live lights for the phone link, the mic, the SMS gateway app and the
  // MoMo forwarder, then picture-by-picture guides. Few words on purpose.
  var CONNECT = { open: false, srv: null, timer: null, guide: 'bt' };
  var G = '#15603f';
  function svgWrap(inner) { return '<svg viewBox="0 0 240 150" width="100%" height="150" role="img" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">' + inner + '</svg>'; }
  function svPhone(x, y, screen) { return '<rect x="' + x + '" y="' + y + '" width="62" height="118" rx="10" fill="#0f172a"/><rect x="' + (x + 5) + '" y="' + (y + 12) + '" width="52" height="92" rx="4" fill="#fff"/><circle cx="' + (x + 31) + '" cy="' + (y + 111) + '" r="3" fill="#475569"/>' + (screen || ''); }
  function svLaptop(x, y, screen) { return '<rect x="' + x + '" y="' + y + '" width="120" height="78" rx="6" fill="#0f172a"/><rect x="' + (x + 6) + '" y="' + (y + 6) + '" width="108" height="66" rx="3" fill="#fff"/><path d="M' + (x - 12) + ' ' + (y + 82) + 'h144l-8 10h-128z" fill="#334155"/>' + (screen || ''); }
  function svBt(cx, cy, s, col) { s = s || 1; col = col || '#2563eb'; return '<g transform="translate(' + cx + ' ' + cy + ') scale(' + s + ')"><circle r="14" fill="' + col + '"/><path d="M-5 -6l10 9-5 4.5v-15l5 4.5-10 9" stroke="#fff" stroke-width="2.4" fill="none" stroke-linejoin="round"/></g>'; }
  function svTick(cx, cy) { return '<g transform="translate(' + cx + ' ' + cy + ')"><circle r="13" fill="#16a34a"/><path d="M-6 0l4 5 8-9" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round"/></g>'; }
  function svCross(cx, cy) { return '<g transform="translate(' + cx + ' ' + cy + ')"><circle r="13" fill="#dc2626"/><path d="M-5 -5l10 10M5 -5l-10 10" stroke="#fff" stroke-width="3" stroke-linecap="round"/></g>'; }
  function svArrow(x1, y, x2) { return '<path d="M' + x1 + ' ' + y + 'H' + (x2 - 8) + '" stroke="' + G + '" stroke-width="4" stroke-dasharray="6 5"/><path d="M' + (x2 - 10) + ' ' + (y - 7) + 'l10 7-10 7z" fill="' + G + '"/>'; }
  function svToggle(x, y, on) { return '<rect x="' + x + '" y="' + y + '" width="30" height="16" rx="8" fill="' + (on ? '#16a34a' : '#cbd5e1') + '"/><circle cx="' + (x + (on ? 22 : 8)) + '" cy="' + (y + 8) + '" r="6" fill="#fff"/>'; }
  function svText(x, y, t, size, col) { return '<text x="' + x + '" y="' + y + '" font-size="' + (size || 10) + '" font-weight="700" fill="' + (col || '#0f172a') + '" font-family="Inter,Arial,sans-serif">' + esc(t) + '</text>'; }
  function svWin(x, y) { return '<g transform="translate(' + x + ' ' + y + ')"><rect width="7" height="7" fill="#2563eb"/><rect x="8" width="7" height="7" fill="#2563eb"/><rect y="8" width="7" height="7" fill="#2563eb"/><rect x="8" y="8" width="7" height="7" fill="#2563eb"/></g>'; }
  function svMoney(cx, cy) { return '<g transform="translate(' + cx + ' ' + cy + ')"><rect x="-18" y="-11" width="36" height="22" rx="4" fill="#facc15" stroke="#a16207" stroke-width="2"/>' + svText(-9, 4, 'UGX', 8, '#713f12') + '</g>'; }
  function svCloud(cx, cy) { return '<g transform="translate(' + cx + ' ' + cy + ')"><path d="M-26 10a12 12 0 0 1 2-23 16 16 0 0 1 30-4 12 12 0 0 1 20 9 11 11 0 0 1-2 18z" fill="#e0f2fe" stroke="#0284c7" stroke-width="2"/>' + svText(-20, 4, 'makaug', 10, '#0c4a6e') + '</g>'; }
  var GUIDES = {
    bt: { title: '🔵 Pair the phone with the laptop', steps: [
      ['Phone: swipe down, turn Bluetooth ON', svgWrap(svPhone(89, 16, '<rect x="99" y="34" width="42" height="20" rx="4" fill="#eff6ff"/>' + svBt(110, 44, .55) + svToggle(117, 36, true)))],
      ['Laptop: Start ⊞ → Settings → Bluetooth & devices', svgWrap(svLaptop(60, 20, svWin(74, 34) + svText(94, 44, 'Settings', 11) + '<rect x="74" y="54" width="92" height="22" rx="4" fill="#eff6ff"/>' + svBt(87, 65, .55) + svText(98, 69, 'Bluetooth', 10)))],
      ['Click “Add device” → Bluetooth → pick the phone', svgWrap(svLaptop(14, 20, '<rect x="26" y="34" width="96" height="18" rx="4" fill="' + G + '"/>' + svText(36, 46, '+ Add device', 10, '#fff') + '<rect x="26" y="58" width="96" height="18" rx="4" fill="#eff6ff"/>' + svText(36, 70, '📱 Company phone', 9)) + svArrow(140, 60, 168) + svPhone(172, 16, svBt(203, 62, .8)))],
      ['Same number on both? Tap Pair. Done ✅', svgWrap(svLaptop(14, 20, svText(42, 50, '482 913', 16, G)) + svPhone(168, 16, svText(178, 64, '482 913', 12, G)) + svTick(120, 132))]
    ] },
    link: { title: '🖥️ Phone Link on Windows', steps: [
      ['Start ⊞ → type “Phone Link” → open it', svgWrap(svLaptop(60, 20, '<rect x="72" y="34" width="96" height="18" rx="9" fill="#f1f5f9" stroke="#94a3b8"/>' + svText(82, 47, '🔍 Phone Link', 10) + svWin(74, 58)))],
      ['Choose Android, scan the QR code with the phone', svgWrap(svLaptop(14, 20, '<g fill="#0f172a"><rect x="44" y="34" width="10" height="10"/><rect x="74" y="34" width="10" height="10"/><rect x="44" y="62" width="10" height="10"/><rect x="58" y="48" width="6" height="6"/><rect x="66" y="58" width="8" height="8"/></g>') + svArrow(140, 60, 168) + svPhone(172, 16, '<rect x="185" y="44" width="36" height="36" rx="4" fill="none" stroke="' + G + '" stroke-width="3" stroke-dasharray="6 4"/>'))],
      ['Allow everything it asks on the phone (calls, contacts)', svgWrap(svPhone(89, 16, '<rect x="97" y="40" width="46" height="18" rx="4" fill="' + G + '"/>' + svText(107, 53, 'Allow', 11, '#fff') + '<rect x="97" y="64" width="46" height="18" rx="4" fill="' + G + '"/>' + svText(107, 77, 'Allow', 11, '#fff')))],
      ['In Phone Link click Calls → Set up. Calls now ring on the laptop', svgWrap(svLaptop(14, 20, svText(28, 44, 'Calls', 12) + '<rect x="28" y="52" width="60" height="18" rx="4" fill="' + G + '"/>' + svText(36, 65, 'Set up', 10, '#fff')) + svBt(150, 64, .9) + svPhone(172, 16, '') + svTick(120, 132))]
    ] },
    sms: { title: '💬 SMS gateway app (sends our texts)', steps: [
      ['On the company phone open Play Store, install “SMS Gateway for Android”', svgWrap(svPhone(89, 16, '<path d="M108 40l26 16-26 16z" fill="#16a34a"/>' + svText(98, 92, 'Install', 11, G)))],
      ['Open it, allow SMS, turn “Cloud server” ON', svgWrap(svPhone(89, 16, svText(98, 48, 'Cloud', 10) + svToggle(124, 38, true) + svText(98, 76, 'SMS ✓', 10, G)))],
      ['Show King the username & password on its screen. King links it', svgWrap(svPhone(30, 16, svText(38, 56, 'user ••••', 9) + svText(38, 72, 'pass ••••', 9)) + svArrow(100, 74, 140) + svCloud(185, 74))],
      ['Keep it open, phone charging, Wi-Fi or data ON. The light turns green', svgWrap(svPhone(89, 16, '<rect x="104" y="96" width="32" height="6" rx="2" fill="#16a34a"/>' + svText(103, 60, '⚡ 📶', 14)) + svTick(190, 74))]
    ] },
    momo: { title: '💰 MoMo forwarder (tells us when an agent pays)', steps: [
      ['Install “SMS to URL Forwarder” from the Play Store', svgWrap(svPhone(89, 16, '<path d="M108 40l26 16-26 16z" fill="#16a34a"/>' + svText(98, 92, 'Install', 11, G)))],
      ['Add a rule: sender “MTN MoMo” (and “AirtelMoney”)', svgWrap(svPhone(89, 16, svText(97, 46, 'From:', 9) + '<rect x="97" y="52" width="46" height="16" rx="3" fill="#fef9c3"/>' + svText(100, 64, 'MTN MoMo', 8)))],
      ['Paste the makaug link King sends you. Never share it', svgWrap(svPhone(30, 16, '<rect x="38" y="52" width="46" height="16" rx="3" fill="#eff6ff"/>' + svText(41, 64, '🔒 link', 9)) + svArrow(100, 74, 140) + svCloud(185, 74))],
      ['An agent pays → the SMS goes to makaug → they show as Paid ✅', svgWrap(svMoney(36, 74) + svArrow(58, 74, 86) + svPhone(90, 16, '') + svArrow(156, 74, 176) + svTick(200, 74))]
    ] },
    fix: { title: '🔌 Calls dropping? Fix it', steps: [
      ['Phone unlocked, Bluetooth ON, phone close to the laptop', svgWrap(svPhone(40, 16, svBt(71, 62, .8)) + '<path d="M112 74h40" stroke="#94a3b8" stroke-width="3"/>' + svText(116, 68, '< 2 m', 11) + svLaptop(160, 34, ''))],
      ['Laptop: open Phone Link. Says Disconnected? Click Reconnect', svgWrap(svLaptop(60, 20, svCross(84, 46) + svText(102, 50, 'Disconnected', 9, '#dc2626') + '<rect x="96" y="58" width="60" height="16" rx="4" fill="' + G + '"/>' + svText(102, 70, 'Reconnect', 9, '#fff')))],
      ['Still no? Turn Bluetooth OFF and ON on both, then Connect', svgWrap(svPhone(30, 16, svToggle(46, 54, false) + svText(40, 86, 'off → on', 9)) + svLaptop(110, 20, svToggle(150, 44, true) + svText(132, 74, 'Connect', 10, G)))],
      ['Back on the calling screen press “Check again”. Green = go', svgWrap(svLaptop(60, 20, '<rect x="74" y="38" width="92" height="24" rx="6" fill="' + G + '"/>' + svText(84, 54, '✅ Check again', 10, '#fff')) + svTick(196, 120))]
    ] }
  };
  function ageText(iso) {
    if (!iso) return 'never';
    var m = Math.round((Date.now() - Date.parse(iso)) / 60000);
    if (!isFinite(m)) return 'never';
    return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' days ago';
  }
  function connectLights() {
    var srv = CONNECT.srv || {};
    var linkOk = CHK.notes === 'ok' && CHK.link !== 'down';
    var L = [
      { key: 'link', ok: CHK.link === 'down' ? false : CHK.notes === 'ok' ? true : null, icon: '📱', name: 'Phone link / Bluetooth', note: CHK.link === 'down' ? 'Dropped – reconnect' : linkOk ? (CHK.bt ? esc(CHK.bt) : 'Connected') : 'Press “Check now”', guide: CHK.link === 'down' ? 'fix' : 'bt' },
      { key: 'mic', ok: CHK.notes === 'ok' ? true : CHK.notes === 'failed' ? false : null, icon: '🎙', name: 'Mic & live notes', note: CHK.notes === 'ok' ? 'Hearing you' : CHK.notes === 'failed' ? esc(CHK.why || 'Not working') : 'Press “Check now”', guide: 'fix' },
      { key: 'sms', ok: srv.sms_gateway && srv.sms_gateway.ok, icon: '💬', name: 'SMS gateway app', note: srv.sms_gateway && srv.sms_gateway.last_seen ? 'Last seen ' + ageText(srv.sms_gateway.last_seen) : 'Not set up yet', guide: 'sms' },
      { key: 'momo', ok: srv.momo && srv.momo.ok, icon: '💰', name: 'MoMo forwarder', note: srv.momo && srv.momo.last_seen ? 'Last SMS ' + ageText(srv.momo.last_seen) : 'Not set up yet', guide: 'momo' }
    ];
    return '<div class="mkc-cx-lights">' + L.map(function (l) {
      var cls = l.ok === true ? 'ok' : l.ok === false || l.key === 'sms' || l.key === 'momo' ? 'bad' : 'wait';
      return '<button type="button" class="mkc-cx-light ' + cls + '" data-mkc-cxlight="' + l.key + '" data-mkc-cxguide="' + l.guide + '"><span class="mkc-cx-dot"></span><span class="mkc-cx-ic">' + l.icon + '</span><b>' + l.name + '</b><span class="mkc-cx-note">' + l.note + '</span></button>';
    }).join('') + '</div>';
  }
  function connectHtml() {
    var g = GUIDES[CONNECT.guide] || GUIDES.bt;
    var tabs = Object.keys(GUIDES).map(function (k) { return '<button type="button" class="mkc-cx-tab' + (k === CONNECT.guide ? ' on' : '') + '" data-mkc-cxguide="' + k + '">' + esc(GUIDES[k].title.split(' (')[0]) + '</button>'; }).join('');
    return '<div class="mkc-cx-box" role="dialog" aria-label="Connect your phone">'
      + '<div class="mkc-cx-head"><h2>📱 Connect your phone</h2><button type="button" class="mkc-btn ghost" data-mkc-cxclose>✕ Close</button></div>'
      + '<div data-mkc-cxlights>' + connectLights() + '</div>'
      + '<div class="mkc-row" style="justify-content:center;margin:10px 0"><button type="button" class="mkc-btn go" style="font-size:18px;padding:12px 26px" data-mkc-cxcheck' + (CHK.running ? ' disabled' : '') + '>' + (CHK.running ? '🎙 Listening… say “testing one two three”' : '🔁 Check now') + '</button></div>'
      + '<div class="mkc-cx-tabs">' + tabs + '</div>'
      + '<h3 class="mkc-cx-gt" data-mkc-cxtitle>' + esc(g.title) + '</h3>'
      + '<ol class="mkc-cx-steps">' + g.steps.map(function (s, i) { return '<li data-mkc-cxstep><div class="mkc-cx-n">' + (i + 1) + '</div><div class="mkc-cx-pic">' + s[1] + '</div><p>' + esc(s[0]) + '</p></li>'; }).join('') + '</ol></div>';
  }
  function renderConnect() {
    var el = document.getElementById('mkc-connect'); if (!el) return;
    el.innerHTML = connectHtml();
    q('[data-mkc-cxclose]', el).onclick = closeConnect;
    q('[data-mkc-cxcheck]', el).onclick = function () { runCheck(); setTimeout(renderConnect, 50); };
    qa('[data-mkc-cxguide]', el).forEach(function (b) { b.onclick = function () { CONNECT.guide = b.getAttribute('data-mkc-cxguide'); renderConnect(); }; });
  }
  function refreshConnectLights() {
    var box = q('#mkc-connect [data-mkc-cxlights]'); if (!box) return;
    box.innerHTML = connectLights();
    qa('[data-mkc-cxlight]', box).forEach(function (b) { b.onclick = function () { CONNECT.guide = b.getAttribute('data-mkc-cxguide'); renderConnect(); }; });
    var btn = q('#mkc-connect [data-mkc-cxcheck]'); if (btn) { btn.disabled = !!CHK.running; btn.textContent = CHK.running ? '🎙 Listening… say “testing one two three”' : '🔁 Check now'; }
  }
  function loadConnectStatus() { return api('/connect-status').then(function (d) { CONNECT.srv = d || {}; refreshConnectLights(); }, function () { /* keep last */ }); }
  function openConnect(guide) {
    if (guide) CONNECT.guide = guide;
    var el = document.getElementById('mkc-connect');
    if (!el) { el = document.createElement('div'); el.id = 'mkc-connect'; el.addEventListener('click', function (e) { if (e.target === el) closeConnect(); }); document.body.appendChild(el); }
    CONNECT.open = true; renderConnect(); loadConnectStatus();
    clearInterval(CONNECT.timer);
    CONNECT.timer = setInterval(function () { if (!document.getElementById('mkc-connect')) { clearInterval(CONNECT.timer); return; } refreshConnectLights(); }, 1000);
    CONNECT.srvTimer = setInterval(loadConnectStatus, 30000);
  }
  function closeConnect() {
    CONNECT.open = false; clearInterval(CONNECT.timer); clearInterval(CONNECT.srvTimer);
    var el = document.getElementById('mkc-connect'); if (el) el.remove();
    renderNum();
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
    if (/video|film|link/.test(t)) pts.push('wants the link');
    if (/hello|whatsapp/.test(t) || c.hi) pts.push('agreed to say Hello on WhatsApp');
    var m = t.match(/(\d+)\s+(houses|places|plots|rentals|listings|properties|apartments)/); if (m) pts.push('has ' + m[1] + ' ' + m[2]);
    if (/wrong number|don'?t know (you|makaug)|who is this/.test(t) && has('wrong_number')) out = 'wrong_number';
    else if (/stop calling|don'?t call|never call/.test(t) && has('do_not_contact')) out = 'do_not_contact';
    else if (/not interested|no thank|don'?t (want|need)/.test(t)) out = has('rejected') ? 'rejected' : (has('not_renewing') ? 'not_renewing' : '');
    else if (task.key === 'payments' && /\bi('ve| have)? (already )?(paid|sent)\b/.test(t) && has('paid')) { out = 'paid'; next = 'Check MoMo for UGX 50,000 and confirm'; }
    else if (task.key === 'retention' && /\b(renewed|i('ve| have) paid)\b/.test(t) && has('renewed')) { out = 'renewed'; next = 'Check MoMo and confirm the renewal'; }
    else if (/(will|i'?ll|going to|can) (pay|send the money|renew)|pay (today|tomorrow|tonight|on)/.test(t) && (has('promised') || has('call_back'))) { out = has('promised') ? 'promised' : 'call_back'; next = 'Chase payment: check MoMo for UGX 50,000'; when = when || { quick: '24h', at: quickDate('24h'), label: 'tomorrow, this time' }; }
    else if (/sign me up|register me|i will join|i'?ll join|let'?s do it|i('m| am) in\b/.test(t) && has('signed_up')) { out = 'signed_up'; next = 'Confirm their first payment by MoMo'; }
    else if (/call (me )?(back|later)|busy|driving|in a meeting|not a good time/.test(t) || (when && !out)) { out = 'call_back'; next = 'Call back'; when = when || { quick: '24h', at: quickDate('24h'), label: 'tomorrow, this time' }; }
    else if (/send|whatsapp me|video|film|link/.test(t)) { out = has('interested') ? 'interested' : (has('will_list') ? 'will_list' : 'call_back'); next = 'Text them the makaug.com link (Texts tab), then call back'; when = when || { quick: '24h', at: quickDate('24h'), label: 'tomorrow, this time' }; }
    if (out && !has(out)) out = '';
    if (when && new Date(when.at).getTime() < Date.now() + 24 * 3600000 - 5 * 60000) when = { quick: '24h', at: quickDate('24h'), label: 'tomorrow, this time' };
    var summary = (t ? 'Spoke ' + clock((S.callEnd - S.callStart) || 0) + '. ' : '') + (pts.length ? 'They ' + pts.join(', ') + '. ' : '') + (when ? 'Next contact ' + when.label + '.' : '');
    if (when && next && next.indexOf(when.label) < 0) next += ' (' + when.label + ')';
    return { outcome: out, next: next, summary: summary.trim(), when: when, auto: Boolean(t) };
  }
  function autoWrap(task) {
    var sg = suggestWrap(task); var w = S.wrap;
    var has = function (k) { return task.outcomes.some(function (o) { return o.key === k; }); };
    var e = S.route && S.route.end;
    if (e && has(e.outcome)) {
      var path = routePath();
      var heard = TX && TX.text && sg && sg.summary && !sg.auto ? ' · From the notes: ' + sg.summary : '';
      sg = { outcome: e.outcome, next: e.next || '', summary: e.note + (path ? ' (' + path + ')' : '') + heard, auto: true, route: true, when: e.when ? { quick: e.when, at: quickDate(e.when) } : null };
      w.note = sg.summary.slice(0, 900);
      if (e.checks) { (boot.close_checks[task.key] || []).forEach(function (_c, i) { w.checklist['close_' + i] = true; }); task.checklist.forEach(function (c) { if (c.required) w.checklist[c.key] = true; }); }
      if (e.hello) { w.checklist.asked_hello = true; w.checklist.wa_hi = true; }
    }
    S.suggest = sg;
    if (sg.outcome) w.outcome = sg.outcome;
    if (sg.next) w.next = sg.next;
    if (sg.when) { w.callback = sg.when.at; w.quick = sg.when.quick; }
    if (sg.summary && !w.note) w.note = sg.summary;
    if (!sg.route && routePath() && !w.note) w.note = 'Said: ' + routePath();
    var o = task.outcomes.filter(function (x) { return x.key === w.outcome; })[0];
    if (o && o.date === 'required' && !w.callback) { w.quick = '24h'; w.callback = quickDate('24h'); }
    if (o && !w.next) w.next = defaultNext(task, o);
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
    new_agents: ['Call back', 'Text them the makaug.com link, then call back', 'Wait for their Hi on WhatsApp, then call', 'Confirm their first payment by MoMo', 'King to decide'],
    payments: ['Chase payment: check MoMo for UGX 50,000', 'Call back', 'Text them the MoMo code', 'King to decide'],
    retention: ['Call back', 'Help them list new places', 'Chase the renewal payment', 'King to decide']
  };
  var NOTE_CHIPS = {
    interested: ['Wants the link first', 'Will sign up this week', 'Will say Hi and send places on WhatsApp', 'Asked about price'],
    call_back: ['Busy, call later', 'Driving', 'Asked to call tomorrow', 'In a meeting'],
    rejected: ['Not interested', 'Price too high', 'Uses another site', 'Not an agent'],
    signed_up: ['Signed up, paying by MoMo today', 'Signed up, will pay tomorrow'],
    promised: ['Will pay today', 'Will pay tomorrow', 'Waiting for money'],
    paid: ['Paid, sending the MoMo ref on WhatsApp'],
    renewed: ['Renewed by MoMo'],
    _: ['Spoke, will follow up', 'Will say Hi on WhatsApp for details', 'Will send new places']
  };
  var CB_CHIPS = [['24h', 'Tomorrow, this time'], ['2d', 'In 2 days'], ['3d', 'In 3 days'], ['mon', 'Next Monday 10:00']];
  function routePath() { return (S.route && S.route.path || []).map(function (x) { return x.label; }).join(' → '); }
  function defaultNext(task, o) {
    if (!o || o.close || o.terminal || o.key === 'no_answer') return '';
    if (o.key === 'promised') return 'Chase payment: check MoMo for UGX 50,000';
    if (o.key === 'will_list' || o.key === 'needs_help') return 'Help them list new places';
    if (o.key === 'interested') return 'Text them the makaug.com link (Texts tab), then call back';
    if (o.date) return 'Call back';
    return 'King to decide';
  }
  function wrapHtml(task, a) {
    var w = S.wrap; a = a || (S.cur && S.cur.attempt) || {};
    var o = task.outcomes.filter(function (x) { return x.key === w.outcome; })[0];
    var outs = task.outcomes.map(function (x) { return '<button type="button" class="mkc-out' + (x.close ? ' close' : '') + (w.outcome === x.key ? ' on' : '') + '" data-mkc-out="' + esc(x.key) + '">' + esc(x.label) + '</button>'; }).join('');
    var path = routePath();
    var html = '<div class="mkc-wrapcard" role="dialog" aria-label="Wrap up the call" data-mkc-wrapcard>'
      + '<div class="mkc-wraphead"><b>Wrap up</b><span>' + esc(a.name || 'This number') + ' · ' + esc(a.phone_masked || ('•••' + String(a.phone || '').slice(-3))) + ' · call ' + clock((S.callEnd || Date.now()) - (S.callStart || Date.now())) + '</span></div>'
      + (path ? '<div class="mkc-wrappath">🧭 ' + esc(path) + '</div>' : '')
      + (S.suggest && S.suggest.outcome && S.suggest.outcome === w.outcome ? '<div class="mkc-wrapsug">✨ Filled in from the call. Check it and save.</div>' : '')
      + '<div class="mkc-outs wrap">' + outs + '</div>';
    if (!o) return html + '<div data-mkc-wraperr></div><div class="mkc-row" style="margin:6px 0 0;align-items:center;flex-wrap:nowrap;gap:8px"><p class="mkc-muted" style="margin:0;flex:1">Tap what happened. <b>No answer</b> saves straight away.</p></div></div>';
    if (o.close) {
      html += '<div class="mkc-wrapchecks"><b>' + esc(T('close_title')) + '</b>'
        + (boot.close_checks[task.key] || []).map(function (c, i) { var same = task.checklist.filter(function (x) { return x.required && sameText(x.label, c); })[0]; return '<label><input type="checkbox" data-mkc-chk="close_' + i + '"' + (same ? ' data-mkc-also="' + esc(same.key) + '"' : '') + (w.checklist['close_' + i] ? ' checked' : '') + '><span>' + esc(c) + '</span></label>'; }).join('')
        + task.checklist.filter(function (c) { return c.required && !(boot.close_checks[task.key] || []).some(function (x) { return sameText(x, c.label); }); }).map(function (c) { return '<label><input type="checkbox" data-mkc-chk="' + esc(c.key) + '"' + (w.checklist[c.key] ? ' checked' : '') + '><span>' + esc(c.label) + '</span></label>'; }).join('')
        + '</div>';
    }
    var f = '';
    if (o.date) {
      f += '<div class="f wide"><label>' + (o.date === 'required' ? 'Call back' : 'Follow-up') + ' <small>(at least 24 hours away)</small></label><div class="mkc-chips">'
        + CB_CHIPS.concat(bestChip()).map(function (x) { return '<button type="button" class="mkc-chip' + (w.quick === x[0] ? ' on' : '') + '" data-mkc-quick="' + x[0] + '">' + x[1] + '</button>'; }).join('')
        + '<input type="datetime-local" class="mkc-input" data-mkc-when min="' + esc(localInput(new Date(Date.now() + 24 * 3600000))) + '" value="' + esc(w.callback) + '"></div></div>';
    }
    if (o.key !== 'no_answer') f += '<div class="f"><label>Note</label><input class="mkc-input" data-mkc-note placeholder="What did they say?" value="' + esc(w.note) + '"></div>';
    if (defaultNext(task, o) || w.next) {
      var nx = NEXT_CHIPS[task.key] || NEXT_CHIPS.new_agents;
      f += '<div class="f"><label>Next step</label><input class="mkc-input" data-mkc-next list="mkc-nextlist" value="' + esc(w.next || '') + '"><datalist id="mkc-nextlist">' + nx.map(function (c) { return '<option value="' + esc(c) + '">'; }).join('') + '</datalist></div>';
    }
    html += '<div class="mkc-wrapgrid">' + f + '</div>';
    if (o.spoke && !o.close) html += '<button type="button" class="mkc-hello sm' + (w.checklist.asked_hello ? ' on' : '') + '" data-mkc-hello>' + (w.checklist.asked_hello ? '✓' : '☐') + ' Asked them to say “Hello” on WhatsApp to ' + esc(boot.whatsapp_display) + '</button>';
    if (TX && TX.text) html += '<details class="mkc-muted" style="font-size:12px"><summary>Live notes (' + TX.text.split(/\s+/).length + ' words, no audio kept)</summary>' + esc(TX.text.slice(0, 1200)) + '</details>';
    return html + '<div data-mkc-wraperr></div><div class="mkc-row" style="flex-wrap:nowrap;gap:6px"><button type="button" class="mkc-btn go mkc-call mkc-save" style="flex:1" data-mkc-save>✓ Save &amp; call next ›</button></div></div>';
  }
  function localInput(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function quickDate(k) {
    var min = Date.now() + 24 * 3600000; var d;
    if (k === '2d' || k === '3d') { d = new Date(); d.setDate(d.getDate() + (k === '2d' ? 2 : 3)); d.setHours(10, 0, 0, 0); }
    else if (k === 'best') { var bt = S.cur && S.cur.context && S.cur.context.best_time; d = new Date(); d.setDate(d.getDate() + 1); d.setHours(bt && bt.hour != null ? bt.hour : 10, 0, 0, 0); }
    else if (k === 'mon') { d = new Date(); d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); d.setHours(10, 0, 0, 0); }
    else { d = new Date(min + 5 * 60000); d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0); } // '24h': tomorrow, this time
    while (d.getTime() < min) d.setDate(d.getDate() + 1);
    return localInput(d);
  }
  function bestChip() { var bt = S.cur && S.cur.context && S.cur.context.best_time; return bt && bt.hour != null ? [['best', pad(bt.hour) + ':00 (their best time)']] : []; }
  function bindWrap(el, task, a) {
    var w = S.wrap;
    qa('[data-mkc-out]', el).forEach(function (b) {
      b.onclick = function () {
        saveWrapInputs(el); w.outcome = b.getAttribute('data-mkc-out');
        var o = task.outcomes.filter(function (x) { return x.key === w.outcome; })[0] || {};
        if (o.date === 'required' && !w.callback) { w.quick = '24h'; w.callback = quickDate('24h'); }
        if (!o.date) { w.callback = ''; w.quick = ''; }
        var routed = S.route && S.route.end && S.route.end.outcome === o.key;
        if (!routed) { w.next = defaultNext(task, o); if (!w.note || w.autoNote) { w.note = o.key === 'no_answer' ? '' : (routePath() ? o.label + ' (' + routePath() + ')' : ''); w.autoNote = true; } }
        if (w.outcome === 'no_answer') { renderWrap(task, a); saveWrap(task, a); return; } // one tap
        renderWrap(task, a);
      };
    });
    qa('[data-mkc-quick]', el).forEach(function (b) { b.onclick = function () { saveWrapInputs(el); w.quick = b.getAttribute('data-mkc-quick'); w.callback = quickDate(w.quick); renderWrap(task, a); }; });
    var hb = q('[data-mkc-hello]', el); if (hb) hb.onclick = function () { saveWrapInputs(el); w.checklist.asked_hello = !w.checklist.asked_hello; w.checklist.wa_hi = w.checklist.asked_hello; renderWrap(task, a); };
    var sb = q('[data-mkc-save]', el); if (sb) sb.onclick = function () { saveWrap(task, a); };
    var nt = q('[data-mkc-note]', el); if (nt) nt.oninput = function () { w.autoNote = false; };
  }
  function saveWrap(task, a) {
    var el = q('[data-mkc-wrapbox]') || document;
    var w = S.wrap;
    saveWrapInputs(el);
    var o = task.outcomes.filter(function (x) { return x.key === w.outcome; })[0];
    if (o && o.spoke && (w.note || '').trim().length < 3) w.note = o.label + (routePath() ? ' (' + routePath() + ')' : ''); // never ask again for what we know
    if (o && !(w.next || '').trim()) w.next = defaultNext(task, o);
    var minCb = Date.now() + 24 * 3600000 - 5 * 60000;
    var err = !o ? 'Tap what happened.' : (o.date === 'required' && !w.callback ? 'Pick when to call back.' : (w.callback && new Date(w.callback).getTime() < minCb ? 'Call backs are at least 24 hours away. Pick tomorrow or later.' : ''));
    if (!err && o.close) {
      var miss = task.checklist.filter(function (c) { return c.required && !w.checklist[c.key]; }).map(function (c) { return c.label; })
        .concat((boot.close_checks[task.key] || []).filter(function (_c, i) { return !w.checklist['close_' + i]; }));
      if (miss.length) err = T('close_title') + ': ' + miss.join('; ');
    }
    var box = q('[data-mkc-wraperr]');
    if (err) { if (box) box.innerHTML = '<div class="mkc-err">' + esc(err) + '</div>'; return; }
    var btn = q('[data-mkc-save]'); if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    var cbIso = w.callback && o.date ? new Date(w.callback).toISOString() : null;
    S.loadT0 = Date.now();
    op('/attempts/' + a.id + '/wrapup', { session_id: S.id, outcome: w.outcome, note: w.note, checklist: w.checklist, callback_at: cbIso, next_step: w.next || '', transcript: txPayload() })
      .then(function (done) {
        S.lastDone = { name: a.name, phone: a.phone, outcome: w.outcome, callback_at: cbIso, task: S.task, label: o.label, note: w.note || '', next: w.next || '',
          talk_s: S.callStart ? Math.max(0, Math.round(((S.callEnd || Date.now()) - S.callStart) / 1000)) : null, hi: Boolean(w.checklist && w.checklist.asked_hello) };
        S.saved = (S.saved || 0) + 1;
        if (done.queued) toast(T('offline'));
        if (o.close) celebrate();
        next(); refreshSide();
      }, function (e) { if (btn) { btn.disabled = false; btn.textContent = '✓ Save & call next ›'; } if (box) box.innerHTML = '<div class="mkc-err">' + esc(e.message) + '</div>'; });
  }
  function saveWrapInputs(el) {
    var w = S.wrap;
    var n = q('[data-mkc-note]', el); if (n) w.note = n.value;
    var d = q('[data-mkc-when]', el); if (d) w.callback = d.value;
    var nxi = q('[data-mkc-next]', el); if (nxi) w.next = nxi.value;
    qa('[data-mkc-chk]', el).forEach(function (c) { w.checklist[c.getAttribute('data-mkc-chk')] = c.checked; if (c.getAttribute('data-mkc-also')) w.checklist[c.getAttribute('data-mkc-also')] = c.checked; });
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
    // SMS only, from the company phone (Phone Link). We never send WhatsApp messages from calls.
    return '<a class="mkc-btn sm" href="sms:+' + esc(digits) + '?body=' + encodeURIComponent(text) + '">SMS</a>';
  }
  // Call summary shown as soon as the call is closed (Arthur, 21 Nov 2026).
  function callSummaryHtml(L) {
    var bits = ['<b>' + esc(L.label || String(L.outcome).replace(/_/g, ' ')) + '</b>'];
    if (L.talk_s != null) bits.push(esc(clock(L.talk_s * 1000)) + ' on the call');
    if (L.hi) bits.push('asked for Hello ✓');
    return '<div class="mkc-panel" style="padding:8px 10px;margin-bottom:8px;background:#f8fafc" data-mkc-callsum><div style="font-size:12px;font-weight:900;color:#475569">📝 Call summary · ' + esc(L.name || 'Last number') + ' ' + esc('•••' + String(L.phone || '').replace(/\D/g, '').slice(-3)) + '</div>'
      + '<div style="font-size:13px">' + bits.join(' · ') + '</div>'
      + (L.note ? '<div style="font-size:13px">“' + esc(L.note) + '”</div>' : '')
      + (L.next || L.callback_at ? '<div style="font-size:13px"><b>Next:</b> ' + esc(L.next || 'Call back') + (L.callback_at ? ' · ' + esc(kDayTime(L.callback_at)) : '') + '</div>' : '') + '</div>';
  }
  function lastDoneHtml() {
    var L = S && S.lastDone; if (!L) return '';
    var tpl = boot.templates[L.outcome];
    if (!tpl) return callSummaryHtml(L);
    var text = fillTemplate(tpl, lastCtx(L));
    return callSummaryHtml(L) + '<div class="mkc-tpl" style="background:#f0fdf4;border-color:#bbf7d0"><b>Saved. Text ' + esc(firstName(L.name) || 'them') + '? (you send it yourself)</b><div style="margin:6px 0">' + esc(text) + '</div>'
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
  function routeFor() { var t = taskOf(S.task); return boot.scripts && boot.scripts.routes ? boot.scripts.routes[t.key] : null; }
  var WHEN_LABEL = { '24h': 'tomorrow, this time', '2d': 'in 2 days', '3d': 'in 3 days', mon: 'next Monday', best: 'their best time' };
  function routeHtml(task) {
    var R = routeFor(); var r = S.route; var ctx = scriptCtx(); ctx.wa = boot.whatsapp_display;
    var say = function (t, lead) { return '<div class="mkc-say"><span>' + (lead || 'Say') + '</span><p>' + esc(String(t || '').replace(/\{(\w+)\}/g, function (m, k) { return ctx[k] != null ? ctx[k] : ''; }).replace(/\s+/g, ' ').replace(/\s+([?.,!])/g, '$1').trim()) + '</p></div>'; };
    var crumbs = r.path.length ? '<div class="mkc-crumbs">' + r.path.map(function (x) { return '<span>' + esc(x.label) + '</span>'; }).join('<i>›</i>') + '</div>' : '';
    var tools = '<div class="mkc-row mkc-routetools">' + (r.path.length && S.phase === 'calling' ? '<button type="button" class="mkc-btn sm ghost" data-mkc-rback>‹ Back</button>' : '') + '<button type="button" class="mkc-btn sm ghost" data-mkc-fullscript>📄 Full script &amp; objections</button></div>';
    if (S.phase === 'wrapup') return '<div class="mkc-routehead">Call ended</div>' + (crumbs || '<p class="mkc-muted">Wrap up in the box.</p>');
    if (!r.node) {
      return '<div class="mkc-routehead">📞 Ringing… when they pick up</div>' + say(R.nodes[R.start].say)
        + '<div class="mkc-replies pick">' + (boot.scripts.pickup || []).map(function (p, i) { return '<button type="button" class="mkc-reply' + (p[1] === 'answered' ? ' go' : ' grey') + '" data-mkc-pick="' + i + '">' + esc(p[0]) + '</button>'; }).join('') + '</div>' + tools;
    }
    var n = R.nodes[r.node];
    if (n.end) {
      var o = task.outcomes.filter(function (x) { return x.key === n.end.outcome; })[0] || { label: n.end.outcome };
      return crumbs + '<div class="mkc-routeend"><span>Suggested wrap-up</span><b>' + esc(o.label) + '</b><div>' + esc(n.end.note) + '</div>' + (n.end.next ? '<div>Next: ' + esc(n.end.next) + (n.end.when ? ' · ' + esc(WHEN_LABEL[n.end.when] || n.end.when) : '') + '</div>' : '') + '</div>'
        + '<div class="mkc-replies"><button type="button" class="mkc-reply go big" data-mkc-endroute>End call &amp; wrap up ›</button></div>' + tools;
    }
    return crumbs + say(n.say) + '<div class="mkc-routehead">If they say…</div><div class="mkc-replies">'
      + n.replies.map(function (x, i) { var to = R.nodes[x[1]]; return '<button type="button" class="mkc-reply' + (to && to.end ? ' fin' : '') + '" data-mkc-reply="' + i + '">' + esc(x[0]) + '</button>'; }).join('') + '</div>' + tools;
  }
  function bindRoute(el, task) {
    var R = routeFor(); var r = S.route;
    qa('[data-mkc-pick]', el).forEach(function (b) {
      b.onclick = function () {
        var p = boot.scripts.pickup[Number(b.getAttribute('data-mkc-pick'))];
        if (p[1] === 'answered') { S.coach.answered = true; S.wrap.checklist.answered = true; r.node = R.start; renderNum(); renderScript(); return; }
        // No answer: one tap saves and brings the next number.
        S.coach.answered = false; S.wrap.checklist.answered = false; S.wrap.outcome = 'no_answer'; S.wrap.note = p[0];
        var a = S.cur.attempt; endCallNow().then(function () { S.wrap.outcome = 'no_answer'; saveWrap(task, a); });
      };
    });
    qa('[data-mkc-reply]', el).forEach(function (b) {
      b.onclick = function () {
        var x = R.nodes[r.node].replies[Number(b.getAttribute('data-mkc-reply'))];
        r.path.push({ from: r.node, label: x[0] }); r.node = x[1];
        var n = R.nodes[r.node]; r.end = n && n.end ? n.end : null;
        if (n && n.lang) S.lang = n.lang; // "Speak Luganda, please": the rest of the call in Luganda
        if (/hello|\bhi\b/i.test(x[0]) && /✓/.test(x[0])) { S.wrap.checklist.asked_hello = true; S.wrap.checklist.wa_hi = true; }
        ev('route', r.node); renderScript();
      };
    });
    var bk = q('[data-mkc-rback]', el); if (bk) bk.onclick = function () { var last = r.path.pop(); if (last) { r.node = last.from; r.end = null; } renderScript(); };
    var er = q('[data-mkc-endroute]', el); if (er) er.onclick = function () { endCallNow(); };
    var fs = q('[data-mkc-fullscript]', el); if (fs) fs.onclick = function () { S.fullScript = !S.fullScript; renderScript(); };
  }
  // ---- Texts tab: ready SMS texts. The link opens the texting app (Phone Link on the laptop)
  // with the number and the text filled in; each one is logged on the contact's timeline.
  function smsDigits(phone) {
    var d = String(phone || '').replace(/\D/g, '');
    if (/^0\d{9}$/.test(d)) d = '256' + d.slice(1); else if (/^\d{9}$/.test(d)) d = '256' + d;
    return d;
  }
  function smsHref(phone, text) { var d = smsDigits(phone); return d ? 'sms:+' + d + '?body=' + encodeURIComponent(text) : ''; }
  function smsLabel(x) {
    var t = (boot.sms_texts || []).filter(function (y) { return y.key === x.template; })[0];
    return t ? t.label : 'our WhatsApp number, ' + (x.lang === 'lg' ? 'Luganda' : 'English');
  }
  function textsHtml(a, ctx) {
    var list = boot.sms_texts || [];
    var fill = function (t) { try { return fillTemplate(t, ctx); } catch (e) { return String(t || ''); } };
    var card = function (key, label, text, logKey) {
      var href = a ? smsHref(a.phone, text) : '';
      return '<div class="mkc-tpl" data-mkc-text="' + esc(key) + '"><b>' + esc(label) + '</b><div style="margin:4px 0 6px">' + esc(text) + '</div><div class="mkc-row">'
        + (href ? '<a class="mkc-btn sm go" style="text-decoration:none" href="' + esc(href) + '" data-mkc-sms="' + esc(logKey || '') + '">✉️ Open in Texts</a>' : '')
        + '<button type="button" class="mkc-btn sm ghost" data-mkc-textcopy="' + esc(key) + '">Copy</button></div></div>';
    };
    var main = list.map(function (t) { return card(t.key, t.label, fill(t.text), t.key); }).join('');
    var more = Object.keys(boot.templates || {}).map(function (k) { return card('o_' + k, 'After “' + k.replace(/_/g, ' ') + '”', fill(boot.templates[k]), ''); }).join('');
    return '<p class="mkc-muted">Texts go by SMS from the company phone. <b>Open in Texts</b> opens your texting app (Phone Link) with the number and the text ready: check it and press Send there. We never send WhatsApp messages from calls.</p>'
      + (a ? '' : '<p class="mkc-muted">Open a number to text it.</p>') + main
      + (more ? '<details style="margin-top:8px"><summary class="mkc-muted" style="cursor:pointer">More texts (after an outcome)</summary>' + more + '</details>' : '');
  }
  function bindTexts(el, a, ctx) {
    var textOf = function (key) {
      var t = (boot.sms_texts || []).filter(function (x) { return x.key === key; })[0];
      var raw = t ? t.text : (boot.templates || {})[key.replace(/^o_/, '')];
      try { return fillTemplate(raw || '', ctx); } catch (e) { return String(raw || ''); }
    };
    qa('[data-mkc-textcopy]', el).forEach(function (b) { b.onclick = function () { copy(textOf(b.getAttribute('data-mkc-textcopy'))); }; });
    qa('[data-mkc-sms]', el).forEach(function (b) { b.addEventListener('click', function () {
      if (!a || boot.sandbox) return; // practice: nothing is sent or logged
      op('/attempts/' + a.id + '/sms', { person_key: S.person, lang: S.lang === 'lg' ? 'lg' : 'en', template: b.getAttribute('data-mkc-sms') || '' })
        .then(function () { ev('action', 'sms_sent'); toast('Text opened in your texting app and logged on their timeline. Press Send there.'); }, function (e) { toast(e.message || 'Could not log the text'); });
    }); });
  }
  function renderScript() {
    var el = q('[data-mkc-script]'); if (!el || !S) return;
    var task = taskOf(S.task);
    var inCall = S.phase === 'calling' || S.phase === 'wrapup';
    if (!inCall) { el.innerHTML = ''; return; } // no call, no script
    if (routeFor() && !S.fullScript && (S.tab || 'script') === 'script') {
      el.innerHTML = '<div class="mkc-tabs"><button type="button" class="mkc-tab on">🧭 Script</button><button type="button" class="mkc-tab" data-mkc-tabk="texts">Texts</button><button type="button" class="mkc-tab" data-mkc-tabk="kit">Sales kit</button></div>' + routeHtml(task);
      qa('[data-mkc-tabk]', el).forEach(function (b) { b.onclick = function () { S.tab = b.getAttribute('data-mkc-tabk'); renderScript(); }; });
      bindRoute(el, task); return;
    }
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
      html += textsHtml(a, ctx);
    } else {
      // For the caller to learn from. We never send films or WhatsApp messages from calls.
      html += '<p class="mkc-muted">Films and cards to learn from. We never send WhatsApp messages or films from calls: ask them to say “Hi” on WhatsApp to ' + esc(boot.whatsapp_display) + ', and use <b>Texts</b> for an SMS.</p>' + boot.sales_kit.map(function (k) {
        return '<div class="mkc-kit"><div><b>' + esc(k.title) + '</b><div class="mkc-muted">' + esc(k.lang) + ' · ' + esc(k.kind) + '</div></div><div class="mkc-row" style="flex-wrap:nowrap">'
          + (k.url ? '<a class="mkc-btn sm" target="_blank" rel="noopener" data-mkc-kit="' + esc(k.key) + '" href="' + esc(k.url) + '">Watch</a>' : '') + '</div></div>';
      }).join('');
    }
    if (S.fullScript) html = '<button type="button" class="mkc-btn sm go" style="margin-bottom:8px" data-mkc-fullscript>🧭 Back to the routing script</button>' + html;
    el.innerHTML = html;
    var fsb = q('[data-mkc-fullscript]', el); if (fsb) fsb.onclick = function () { S.fullScript = false; S.tab = 'script'; renderScript(); };
    qa('[data-mkc-tabk]', el).forEach(function (b) { b.onclick = function () { S.tab = b.getAttribute('data-mkc-tabk'); if (S.tab === 'script') S.fullScript = false; renderScript(); }; });
    qa('[data-mkc-var]', el).forEach(function (b) { b.onclick = function () { S.variant = b.getAttribute('data-mkc-var'); renderScript(); }; });
    qa('[data-mkc-stage]', el).forEach(function (b) { b.onclick = function () { S.stageManual = b.getAttribute('data-mkc-stage'); renderScript(); }; });
    qa('[data-mkc-lang]', el).forEach(function (b) { b.onclick = function () { S.lang = b.getAttribute('data-mkc-lang'); renderScript(); }; });
    qa('[data-mkc-copy]', el).forEach(function (b) { b.onclick = function () { copy(fillTemplate(boot.templates[b.getAttribute('data-mkc-copy')], ctx)); }; });
    if (S.tab === 'texts') bindTexts(el, a, ctx);
    qa('[data-mkc-kit]', el).forEach(function (b) { b.addEventListener('click', function () { ev('kit_send', b.getAttribute('data-mkc-kit') + ' (watched)'); }); });
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
    checkMeeting();
    loadSplit();
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
    el.classList.toggle('full', Boolean(S.sideFull));
    var html = '<div class="mkc-panel" style="margin-bottom:12px"><div class="mkc-sidehead"><div class="mkc-nudge" style="flex:1;margin:0">' + esc(st.next_milestone || feed.nudge || 'Let\'s go.') + '</div>'
      + (S.sideFull ? '<button type="button" class="mkc-btn sm dark" data-mkc-sidefull aria-label="Close the full view">✕ Close</button>' : '<button type="button" class="mkc-btn sm ghost" data-mkc-sidefull title="Open this panel full size">⤢ Open full</button>') + '</div>'
      + (st.callbacks_due_now ? '<div class="mkc-nudge" style="background:#dbeafe;color:#1e3a8a">' + st.callbacks_due_now + ' callback' + (st.callbacks_due_now > 1 ? 's' : '') + ' due now. They come first in the queue.</div>' : '')
      + '<div class="mkc-tabs">' + tabs.map(function (t) { return '<button type="button" class="mkc-tab' + (S.side === t[0] ? ' on' : '') + '" data-mkc-side-tab="' + t[0] + '">' + t[1] + (t[0] === 'wa' && S.wa && S.wa.length ? ' ' + S.wa.length : '') + (t[0] === 'leads' && S.leads && S.leads.length ? ' ' + S.leads.length : '') + '</button>'; }).join('') + '</div>';
    if (S.side === 'live') {
      if (!S.live && !S.liveLoading) { S.liveLoading = true; loadLive(function () { S.liveLoading = false; renderSide(); }); }
      html += '<div style="margin-bottom:8px">' + liveCountsHtml(S.live) + '<button type="button" class="mkc-btn sm ghost" style="margin-top:6px;width:100%" data-mkc-live2>🌐 Live site + preview</button></div>';
      var items = (feed.items || []).map(function (i) { return '<div><span class="k k-' + esc(i.kind) + '">' + esc(kinds[i.kind] || i.kind) + '</span><span class="t">' + esc(i.text) + '</span><span class="w">' + esc(kTime(i.at)) + '</span></div>'; }).join('');
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
    var sf = q('[data-mkc-sidefull]', el); if (sf) sf.onclick = function () { S.sideFull = !S.sideFull; renderSide(); };
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
        + (t.sms || []).map(function (x) { return '<div class="mkc-muted">' + esc(kDayTime(x.at)) + ' · ✉️ SMS sent (' + esc(smsLabel(x)) + ') by ' + esc(personName(x.by)) + '</div>'; }).join('')
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
        + (p.state === 'claimed' || p.state === 'arrived' ? '' : '<button type="button" class="mkc-btn sm amber" data-pay="claim">They say they paid</button>') + '<button type="button" class="mkc-btn sm dark" data-pay="sms">📷 Upload payment SMS</button></div>')
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
        if (k === 'sms') { openSmsProof({ attempt: a }); return; }
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
      + '<div class="mkc-targets" style="grid-template-columns:auto auto auto;margin-top:8px"><span class="mkc-muted">Calls</span><span class="mkc-muted">Paid (closed)</span><span class="mkc-muted">Payments</span>'
      + '<b>' + num('calls', p.calls_target) + '</b><b>' + num('closes', p.closes_target) + '</b><b>' + num('pays', p.payments_target || 0) + '</b></div>'
      + '<h4 style="margin:10px 0 4px">Which numbers / what first</h4>' + (editable ? '<input class="mkc-input" style="width:100%;box-sizing:border-box" data-pl-focus value="' + esc(p.focus || '') + '">' : '<div>' + esc(p.focus || '–') + '</div>')
      + '<h4 style="margin:10px 0 4px">What I will achieve today</h4>' + (editable ? '<textarea class="mkc-input" style="width:100%;box-sizing:border-box" rows="2" data-pl-goal placeholder="e.g. 2 unpaid sign-ups pay, 5 new agents interested">' + esc(p.goal || '') + '</textarea>' : '<div>' + esc(p.goal || '–') + '</div>')
      + (editable ? '<h4 style="margin:10px 0 4px">Numbers agreed (optional)</h4><input class="mkc-input" style="width:100%;box-sizing:border-box" data-pl-nums placeholder="Paste numbers, comma separated">' + ((p.numbers || []).length ? '<div class="mkc-muted">Already: ' + esc(p.numbers.join(', ')) + '</div>' : '') : ((p.numbers || []).length ? '<div class="mkc-muted">Numbers: ' + esc(p.numbers.join(', ')) + '</div>' : ''))
      + '<h4 style="margin:12px 0 4px">So far</h4>' + line('Calls', x.calls, p.calls_target, x.calls_hit) + line('Paid (closed)', x.closes, p.closes_target, x.closes_hit) + line('Payments in', x.payments, p.payments_target || 0, x.payments_hit)
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
  // (No "Share on WhatsApp": we never send WhatsApp messages or films from calls. Arthur, 21 Nov 2026.)
  var HOW_KNOWN = ['Friend or referral', 'Saw their listing', 'Sign board', 'Social media', 'Met them', 'Other'];
  function openAddNumber() {
    var field = function (attr, ph, extra) { return '<input class="mkc-input" style="width:100%;box-sizing:border-box;margin:4px 0" ' + attr + ' placeholder="' + esc(ph) + '"' + (extra || '') + '>'; };
    var cur = S ? S.task : 'new_agents';
    modal('<h3 style="margin:0 0 4px;font-weight:900">➕ Add a number</h3>' + (boot && boot.sandbox ? '<p class="mkc-muted" style="margin:0 0 6px"><b>Practice:</b> add your own phone or a friend\'s to test a real call. It goes only into your practice queue and really rings when you tap Call now. Customers\' numbers are refused. Nothing is texted or counted.</p>' : '<p class="mkc-muted" style="margin:0 0 6px">It goes straight into your queue as <b>your own number</b>. Numbers we already have are caught and their history is shown instead.</p>')
      + field('data-n', 'Name') + field('data-p', boot && boot.sandbox ? 'Phone, e.g. 0772 123 456 or +44 7700 900123' : 'Phone, e.g. 0772 123 456', ' inputmode="tel"')
      + '<div class="mkc-row"><label class="mkc-muted" style="flex:1">How you know them<br><select class="mkc-input" style="width:100%" data-h>' + HOW_KNOWN.map(function (h) { return '<option>' + esc(h) + '</option>'; }).join('') + '</select></label>'
      + '<label class="mkc-muted" style="flex:1">Mode<br><select class="mkc-input" style="width:100%" data-md>' + ((boot && boot.tasks) || [{ key: 'new_agents', name: 'Get new agents' }]).map(function (t) { return '<option value="' + esc(t.key) + '"' + (t.key === cur ? ' selected' : '') + '>' + esc(MODE_LABEL[t.key] || t.name) + '</option>'; }).join('') + '</select></label></div>'
      + field('data-t', 'Note (optional), e.g. has 5 rentals in Kira')
      + '<div data-e></div><div class="mkc-row" style="margin-top:10px;justify-content:flex-end"><button type="button" class="mkc-btn" data-x>Close</button><button type="button" class="mkc-btn" data-ok>Add to my queue</button><button type="button" class="mkc-btn go" data-ok-next title="Becomes the very next number you call">📞 Add &amp; call next</button></div>', function (m, close) {
      q('[data-x]', m).onclick = close;
      var submit = function (callNext) {
        var mode = q('[data-md]', m).value;
        api('/numbers', { method: 'POST', body: { person_key: S ? S.person : pick.person, name: q('[data-n]', m).value, phone: q('[data-p]', m).value, note: q('[data-t]', m).value, how_known: q('[data-h]', m).value, mode: mode } }).then(function (d) {
          if (d.status === 'exists') {
            var hist = (d.history || []).map(function (h) { return '<li><b>' + esc(kDayTime(h.at)) + '</b> · ' + esc(personName(h.by)) + ' · ' + esc(String(h.outcome || '').replace(/_/g, ' ')) + (h.note ? ' – ' + esc(h.note) : '') + (h.callback_at ? ' · call back ' + esc(kDayTime(h.callback_at)) : '') + '</li>'; }).join('');
            q('[data-e]', m).innerHTML = '<div class="mkc-tpl" style="background:#fef3c7;border-color:#fde68a;margin-top:8px"><b>We already have ' + esc(d.phone) + '</b> – ' + esc(d.duplicate_of) + '. Not added again.'
              + (d.owner ? '<div>Own number of ' + esc(personName(d.owner.person_key)) + ' since ' + esc(kDayTime(d.owner.added_at)) + '.</div>' : '')
              + (hist ? '<div style="margin-top:4px"><b>History</b><ul style="margin:4px 0 0 18px;padding:0">' + hist + '</ul></div>' : '<div class="mkc-muted">Not called yet. It is already in a queue.</div>') + '</div>';
            return;
          }
          if (callNext && S && S.id) {
            S.preferNext = d.id;
            if (S.phase === 'calling' || S.phase === 'wrapup') { S.preferTask = d.mode || mode; toast('✓ Added: it is the next number after this call.'); close(); return; }
            var to = d.mode || S.task;
            if (S.phase === 'housekeeping') ev('housekeeping_off', to);
            close(); toast('✓ Added: calling it next.');
            api('/sessions/' + S.id + '/task', { method: 'POST', body: { task_key: to } }).then(function () { S.task = to; S.fellBack = null; next(); renderTop(); refreshSide(); loadCounts(); }, function (e) { toast(e.message, 'bad'); });
            return;
          }
          q('[data-e]', m).innerHTML = '<div class="mkc-nudge">✓ Added to your queue (' + esc(MODE_LABEL[d.mode] || d.mode) + ') as your own number.</div>';
          q('[data-p]', m).value = ''; q('[data-n]', m).value = ''; q('[data-t]', m).value = '';
          if (S) { if (S.phase === 'empty' && mode === S.task) next(); loadCounts(); }
        }, function (e) { q('[data-e]', m).innerHTML = '<div class="mkc-err">' + esc(e.message) + '</div>'; });
      };
      q('[data-ok]', m).onclick = function () { submit(false); };
      q('[data-ok-next]', m).onclick = function () { submit(true); };
    });
  }
  function box(big, small, good) { return '<div class="mkc-panel" style="padding:10px;min-width:90px"><b class="' + (good ? 'mkc-good' : '') + '" style="font-size:22px">' + big + '</b><div class="mkc-muted">' + small + '</div></div>'; }
  function reportHtml(r) {
    var w = r.work || {}; var tg = r.targets || {};
    var flags = Object.keys(r.flags || {}).map(function (k) { return '<span class="mkc-pill flag">' + esc((r.flag_labels || {})[k] || k) + ': ' + r.flags[k] + '</span>'; }).join('') || '<span class="mkc-pill live">No flags</span>';
    var outs = Object.keys(r.outcomes || {}).map(function (k) { return '<span class="mkc-pill">' + esc(k.replace(/_/g, ' ')) + ' ' + r.outcomes[k] + '</span>'; }).join('');
    var tasks = Object.keys(r.by_task || {}).map(function (k) { var t = r.by_task[k]; return '<tr><td>' + esc(t.name) + '</td><td>' + t.calls + '</td><td>' + t.connected + '</td><td>' + t.closes + '</td></tr>'; }).join('');
    var calls = (r.calls_list || []).map(function (c) { return '<tr><td>' + esc(kTime(c.at)) + '</td><td>' + esc(c.name) + ' ' + esc(c.phone) + '</td><td>' + esc(String(c.outcome).replace(/_/g, ' ')) + '</td><td>' + (c.talk_s == null ? '–' : c.talk_s + ' s') + '</td><td>' + esc(c.summary || c.note) + (c.live_notes ? ' <span class="mkc-pill" title="Live notes were on">🎙</span>' : '') + '</td><td>' + esc(c.next_step || '') + '</td></tr>'; }).join('');
    var due = (r.due_tomorrow || []).map(function (d) { return '<li>' + esc(kTime(d.at)) + ' · ' + esc(d.name) + ' ' + esc(d.phone) + ' (' + esc(String(d.outcome).replace(/_/g, ' ')) + ')</li>'; }).join('');
    return '<h3 style="margin:0;font-weight:900">Daily summary · ' + esc(r.name) + '</h3><p class="mkc-muted">' + esc(r.day) + ' · made automatically from the calling log, saved for King</p>'
      + '<div class="mkc-row" style="margin:10px 0">' + box(r.calls + '/' + tg.calls_per_day, 'calls', r.calls_hit) + box(r.closes + '/' + tg.closes_per_day, 'paid (closed)', r.closes_hit) + box(r.connected, 'spoke to') + box(r.payments_chased || 0, 'payments chased') + box(hm((r.talk_s || 0) * 1000), 'talk time') + '</div>'
      + '<p style="font-size:13px" data-mkc-worktime><b>Work time ' + hm(w.open_ms) + '</b> · focused ' + hm(w.focus_ms) + ' · away ' + hm(w.away_ms) + ' · ' + (w.breaks || 0) + ' break' + ((w.breaks || 0) === 1 ? '' : 's') + ' (' + hm(w.break_ms) + ') · left the screen ' + (w.exits || 0) + ' time' + ((w.exits || 0) === 1 ? '' : 's')
      + (w.first_start ? ' · ' + esc(kTime(w.first_start)) + '–' + esc(w.last_end && !w.open_now ? kTime(w.last_end) : 'now') + ' Kampala' : '') + '</p>'
      + '<p style="font-size:13px">Payments promised ' + (r.payments_promised || 0) + ' · paid or renewed ' + (r.payments_paid || 0) + ' · callbacks booked ' + (r.callbacks_booked || 0) + ' · skipped ' + (r.skipped || 0) + ' · average call ' + (r.avg_talk_s || 0) + ' s</p>'
      + '<div style="margin:6px 0">' + outs + '</div><div style="margin:6px 0">' + flags + '</div>'
      + '<h4 style="margin:10px 0 4px">Due tomorrow (' + esc(r.tomorrow || '') + ')</h4>' + (due ? '<ul style="margin:0;padding-left:18px;font-size:13px">' + due + '</ul>' : '<p class="mkc-muted">Nothing booked for tomorrow yet.</p>')
      + '<h4 style="margin:10px 0 4px">Time per task</h4><div data-mkc-reptasktime>' + taskTimeHtml(r.task_ms) + '</div>'
      + '<table class="mkc-table" style="margin-top:8px"><tr><th>Task</th><th>Calls</th><th>Spoke</th><th>Closed</th></tr>' + tasks + '</table>'
      + (calls ? '<h4 style="margin:10px 0 4px">Every call</h4><div class="mkc-scroll"><table class="mkc-table"><tr><th>Time</th><th>Who</th><th>Outcome</th><th>Talk</th><th>Summary</th><th>Next step</th></tr>' + calls + '</table></div>' : '');
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
    api('/my-money?person_key=' + encodeURIComponent(S.person)).then(function (m) { if (!S) return; S.my = m; renderDash(); var c = q('[data-mkc-comm]'); if (c) c.outerHTML = commHtml(); var c2 = q('[data-mkc-comm]'); if (c2) c2.onclick = openMoney; }, function () {});
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
  function dropsCol(list) {
    var lbl = { link_drop: 'Phone link / audio dropped', notes_check_failed: 'Mic check failed' };
    var rowsH = list.map(function (d) { return '<div class="mkc-hit" style="cursor:default"><b>' + esc(personName(d.by)) + '</b> <span class="mkc-pill">' + esc(lbl[d.kind] || d.kind) + '</span> <span class="mkc-muted">' + esc(kDayTime(d.at)) + (d.detail ? ' · ' + esc(d.detail) : '') + '</span></div>'; }).join('');
    return '<div data-k-drops><h4>🔌 Link drops & mic checks (' + list.length + ')</h4><div class="mkc-scroll" style="max-height:320px">' + (rowsH || '<p class="mkc-muted">No drops.</p>') + '</div></div>';
  }
  function drawKCalls(host) {
    var box = q('[data-k-calls]', host); if (!box) return;
    api('/calls-summary?period=' + K.callsPeriod).then(function (r) {
      var line = function (i) { return '<div class="mkc-hit" style="cursor:default"><b>' + esc(i.name || 'Unknown') + ' ' + esc(i.phone) + '</b> ' + (i.direction === 'inbound' ? '<span class="mkc-pill in">inbound</span> ' : '') + '<span class="mkc-pill">' + esc(String(i.outcome || '').replace(/_/g, ' ')) + '</span> <span class="mkc-muted">' + esc(kDayTime(i.at)) + ' · ' + esc(personName(i.by)) + '</span>' + (i.summary ? '<div>' + esc(i.summary) + '</div>' : '') + (i.next_step ? '<div><b>Next:</b> ' + esc(i.next_step) + (i.callback_at ? ' · ' + esc(kDayTime(i.callback_at)) : '') + '</div>' : '') + '</div>'; };
      var col = function (title, list, empty) { return '<div><h4>' + title + ' (' + list.length + ')</h4><div class="mkc-scroll" style="max-height:320px">' + (list.map(line).join('') || '<p class="mkc-muted">' + empty + '</p>') + '</div></div>'; };
      var ppl = Object.keys(r.by_person).map(function (k) { var p = r.by_person[k]; return '<span class="mkc-pill">' + esc(personName(k)) + ': ' + p.outbound + ' out · ' + p.inbound + ' in · ' + p.closes + ' paid</span>'; }).join(' ');
      var outs = Object.keys(r.outcomes).map(function (k) { return esc(k.replace(/_/g, ' ')) + ' ' + r.outcomes[k]; }).join(' · ');
      box.innerHTML = '<div class="mkc-row" style="justify-content:space-between"><h4 style="margin:0">🗂 Calls summary · ' + esc(r.from) + (r.to !== r.from ? ' → ' + esc(r.to) : '') + '</h4>' + periodTabs('data-k-callsper', K.callsPeriod) + '</div>'
        + '<div style="margin:6px 0"><b>' + r.calls + ' calls</b> (' + r.outbound + ' outbound · ' + r.inbound + ' inbound) · ' + (r.not_answered ? 'Not answered: ' + r.not_answered + ' · ' : '') + r.skipped + ' skipped · ' + r.closed.length + ' paid (closed)' + (r.no_next_step.length ? ' · <span class="mkc-bad">' + r.no_next_step.length + ' with no next step</span>' : '') + '</div>'
        + '<div class="mkc-muted">' + outs + '</div><div style="margin:4px 0">' + ppl + '</div>'
        + '<div class="mkc-grid" style="padding:0;grid-template-columns:repeat(auto-fit,minmax(260px,1fr))">' + col('✅ Paid (closed)', r.closed, 'Nobody paid yet.') + col('🎙 No transcript', r.no_transcript || [], 'Every call had live notes.') + dropsCol(r.link_drops || []) + col('⏳ Open – next steps', r.open, 'No open loops.') + col('💬 What was discussed', r.discussed, 'No call notes.') + '</div>'
        + '<h4>🔎 Search all calls</h4>' + searchBoxHtml('all');
      qa('[data-k-callsper]', box).forEach(function (b) { b.onclick = function () { K.callsPeriod = b.getAttribute('data-k-callsper'); drawKCalls(host); }; });
      bindSearch(box);
    }).catch(function (e) { panelFailed(box, e); });
  }
  function drawKIntl(host) {
    var box = q('[data-k-intl]', host); if (!box) return;
    box.innerHTML = '<p class="mkc-muted">Loading international numbers…</p>';
    api('/international').then(function (list) {
      box.innerHTML = '<h4 style="margin:0 0 6px">🌍 International – WhatsApp only (' + list.length + ')</h4><p class="mkc-muted" style="margin:0 0 6px">Not Ugandan numbers. They are never offered to call (callers ring Ugandan lines only). Follow them up on WhatsApp. Nothing was deleted.</p>'
        + (list.length ? '<div class="mkc-scroll"><table class="mkc-table"><tr><th>Name</th><th>Number</th><th>From</th><th>Queue</th></tr>' + list.map(function (n) { return '<tr><td>' + esc(n.name || '') + '</td><td>' + esc(n.phone) + '</td><td>' + esc(n.source || '') + '</td><td>' + esc(personName(n.person_key)) + ' · ' + esc(taskLabel(n.task)) + '</td></tr>'; }).join('') + '</table></div>' : '<p class="mkc-muted">None right now.</p>');
    }).catch(function (e) { panelFailed(box, e); });
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
    }).catch(function (e) { panelFailed(box, e); });
  }
  // ---- SMS from the company SIM + agent video unlock
  function contactHtml(a) {
    S.contact = S.contact || {};
    var c = S.contact[a.id];
    if (c === undefined) { S.contact[a.id] = null; loadContact(a); }
    if (!c) return '<div class="mkc-pay" data-mkc-contact><span class="mkc-muted">✉️ …</span></div>';
    var sms = function (lang, label) { return '<a class="mkc-btn sm" style="text-decoration:none" href="' + esc(smsHref(a.phone, c.sms_text[lang])) + '" data-sms="' + lang + '">' + label + '</a>'; };
    // We never send WhatsApp messages or films from calls (Arthur, 21 Nov 2026): no video request here.
    var v = c.hello && c.hello.at ? '<div class="mkc-good" style="margin-top:6px;font-weight:800">✅ They said Hi on WhatsApp ' + esc(kDayTime(c.hello.at)) + '</div>' : '<div class="mkc-muted" style="margin-top:6px">Ask them to say “Hi” on WhatsApp to ' + esc(boot.whatsapp_display) + '.</div>';
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
    }).catch(function (e) { panelFailed(box, e); });
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
  // ---- Meeting mode: report 10 min before, Meet in a popup, notes + action items
  function meetReportHtml(r) {
    var d = function (b, label) {
      if (!b) return '';
      var outs = Object.keys(b.outcomes || {}).sort(function (x, y) { return b.outcomes[y] - b.outcomes[x]; });
      var m = b.money || {};
      return '<div><h5>' + esc(label) + ' · ' + esc(b.day || '') + '</h5><div class="big">' + (b.calls || 0) + (b.calls === 1 ? ' call' : ' calls') + '</div><div class="mkc-muted">' + (b.connected || 0) + ' spoke · ' + (b.closes || 0) + ' closes · ' + (b.skipped || 0) + ' skipped' + (b.targets ? ' · target ' + b.targets.calls + '/' + b.targets.closes : '') + '</div>'
        + (outs.length ? '<ul>' + outs.map(function (k) { return '<li>' + esc(k.replace(/_/g, ' ')) + ': <b>' + b.outcomes[k] + '</b></li>'; }).join('') + '</ul>' : '<div class="mkc-muted">No outcomes yet</div>')
        + '<div style="margin-top:6px"><b>' + ((b.new_numbers || {}).count || 0) + '</b> new agents added (own numbers)</div>'
        + '<div>Money: <b>' + (m.confirmed || 0) + '</b> confirmed · <b>' + (m.claimed || 0) + '</b> claimed · ' + (m.pay_links_sent || 0) + ' pay links'
        + ((m.sms_proofs_waiting || {}).n ? ' · ' + m.sms_proofs_waiting.n + ' SMS proof(s) waiting (' + ugx(m.sms_proofs_waiting.ugx) + ')' : '') + ((m.sms_proofs_confirmed || {}).n ? ' · ' + m.sms_proofs_confirmed.n + ' SMS proof(s) confirmed (' + ugx(m.sms_proofs_confirmed.ugx) + ')' : '') + '</div></div>';
    };
    var o = r.owes || {}; var rd = r.road_to_1000 || {}; var l = r.open_loops || {}; var c = r.commission;
    return '<div class="mkc-rep">' + d(r.today, 'Today') + d(r.yesterday, 'Yesterday')
      + '<div><h5>Who owes us</h5><div class="big">' + (o.unpaid_signups || 0) + ' + ' + (o.overdue || 0) + '</div><div class="mkc-muted">unpaid sign-ups + overdue renewals</div><ul>' + (o.top || []).slice(0, 8).map(function (x) { return '<li>' + esc(x.name) + ' ' + esc(x.phone) + ' <span class="mkc-muted">since ' + esc(x.since) + '</span></li>'; }).join('') + '</ul></div>'
      + '<div><h5>Road to 1000</h5><div class="big">' + (rd.paying_now || 0) + ' / ' + (rd.goal || 1000) + '</div><div class="bar" style="height:8px;background:#e2e8f0;border-radius:99px;overflow:hidden"><i style="display:block;height:100%;background:#10b981;width:' + Math.max(1, rd.percent || 0) + '%"></i></div><div class="mkc-muted">' + (rd.percent || 0) + '% · ends ' + esc(rd.ends_on || '') + '</div></div>'
      + '<div><h5>Open loops</h5><div class="big">' + (l.count || 0) + '</div><div class="mkc-muted">' + (l.callbacks_overdue || 0) + ' callbacks overdue · ' + (l.callbacks_due_now || 0) + ' due now</div><ul>' + (l.list || []).slice(0, 8).map(function (x) { return '<li>' + esc(x.name) + ' ' + esc(x.phone) + ' – ' + esc(x.next_action) + (x.overdue ? ' <b style="color:#b91c1c">overdue</b>' : '') + '</li>'; }).join('') + '</ul></div>'
      + '<div><h5>Commission</h5>' + (c ? (c.on_commission ? '<div class="big">' + ugx(c.due_next_payday_ugx) + '</div><div class="mkc-muted">due on payday ' + esc(c.next_payday || '') + ' · ' + c.rate_pct + '%</div>' : '<div class="mkc-muted">Not on commission yet</div>') : '<div class="mkc-muted">–</div>') + '</div></div>';
  }
  var MTX = null;
  function meetPopup(url) {
    var w = window.open(url, 'makaugMeet', 'popup=yes,width=1040,height=720,left=40,top=40');
    if (!w) { toast('Your browser blocked the pop-up. Allow pop-ups for makaug.com, or use the link.', 'bad'); return false; }
    // While Meet is open the meeting is work time: not away, idle or downtime.
    if (S) {
      if (S.meeting) clearInterval(S.meeting.poll);
      if (!S.work) setWork(true, 'team meeting');
      if (S.idleSince) { ev('idle_end', String(Date.now() - S.idleSince)); S.idleSince = null; }
      S.meeting = { win: w, since: Date.now(), poll: setInterval(inMeeting, 3000) };
    }
    return true;
  }
  function checkMeeting(first) {
    if (!S) return;
    api('/meeting?person_key=' + encodeURIComponent(S.person)).then(function (m) {
      S.meet = m; var b = q('[data-mkc-meet]'); var sl = m.slot;
      if (b) b.textContent = sl && sl.report_ready ? (sl.on ? '🔴 Meeting now' : '🗓 Meeting in ' + sl.minutes_to + ' min') : (sl ? '🗓 Meeting ' + sl.slot : '🗓 Meeting');
      if (first && window.Notification && Notification.permission === 'default' && (m.settings.times || []).length) { try { Notification.requestPermission(); } catch (x) { /* optional */ } }
      S.meetSeen = S.meetSeen || {}; S.meetShut = S.meetShut || {};
      var key = sl ? sl.day + sl.slot : '';
      if (sl && sl.report_ready && !S.meetShut[key] && !document.querySelector('[data-mt-rep]')) {
        clearTimeout(S.meetRetry); S.meetRetry = setTimeout(checkMeeting, 5000);
        if (document.querySelector('.mkc-modal')) return; // let him finish what is open
        if (!S.meetSeen[key]) {
          S.meetSeen[key] = true;
          var msg = sl.on ? 'The team meeting has started.' : 'Team meeting in ' + sl.minutes_to + ' minutes – your report is ready.';
          try { if (window.Notification && Notification.permission === 'granted') new Notification('makaug · ' + (m.settings.title || 'Meeting'), { body: msg, tag: 'mk-meet-' + sl.slot }); } catch (x) { /* optional */ }
          toast('🗓 ' + msg);
        }
        openTeamMeeting({ slotKey: key });
      }
    }, function () { /* offline: try next minute */ });
  }
  function openTeamMeeting(opts) {
    opts = opts || {};
    var who = opts.person || (S && S.person);
    var m = (S && S.meet) || {}; var sl = m.slot || null; var set = m.settings || {};
    var notes = (m.notes && m.notes.notes) || ''; var acts = ((m.notes && m.notes.actions) || []).slice();
    var slotKey = sl ? sl.slot : 'adhoc'; var dayKey = sl ? sl.day : '';
    modal('<div class="mkc-row" style="justify-content:space-between"><h3 style="margin:0;font-weight:900">🗓 ' + esc(set.title || 'Team meeting') + (sl ? ' · ' + esc(sl.slot) + ' <span class="mkc-muted" style="font-size:12px;font-weight:600">Kampala</span>' : '') + '</h3><button class="mkc-btn sm" data-x>Close</button></div>'
      + '<div class="mkc-meetbar">' + (sl ? (sl.on ? '<b>🔴 On now</b>' : '<b>Starts in ' + sl.minutes_to + ' min</b>') : '<b>No meeting set for now</b>') + '<span class="sp" style="flex:1"></span>'
      + (set.meet_url ? '<button type="button" class="mkc-btn go" data-mt-join>▶ Join meeting</button><a class="mkc-muted" target="_blank" rel="noopener" href="' + esc(set.meet_url) + '">open link</a>' : '<span class="mkc-muted">King has not added the Meet link yet</span>') + '</div>'
      + '<div data-mt-rep><p class="mkc-muted">Building your report…</p></div>'
      + '<h4 style="margin:12px 0 4px">Meeting notes</h4><div class="mkc-row"><button type="button" class="mkc-btn sm dark" data-mt-tx>🎙 Live notes</button><span class="mkc-muted" data-mt-txs>Speech-to-text in this browser; only the text is kept, no audio.</span></div>'
      + '<textarea class="mkc-input" data-mt-notes rows="5" style="width:100%;box-sizing:border-box;margin-top:6px" placeholder="What was agreed…">' + esc(notes) + '</textarea>'
      + '<h4 style="margin:10px 0 4px">Action items</h4><div class="mkc-muted" style="font-size:12px">Add a number to make it that number\'s next step in your queue; leave it empty for a general task.</div><div data-mt-acts></div>'
      + '<div class="mkc-row" style="margin-top:6px"><button type="button" class="mkc-btn sm" data-mt-add>+ Action item</button><span class="sp" style="flex:1"></span><span class="mkc-muted" data-mt-saved></span><button type="button" class="mkc-btn go" data-mt-save>Save notes</button></div>'
      + ((m.tasks || []).length ? '<h4 style="margin:12px 0 4px">Open meeting tasks</h4><ul style="margin:0;padding-left:18px">' + m.tasks.map(function (t) { return '<li>' + esc(t.text) + (t.due ? ' <span class="mkc-muted">by ' + esc(t.due) + '</span>' : '') + ' <span class="mkc-muted">(' + esc(t.day) + ' ' + esc(t.slot) + ')</span></li>'; }).join('') + '</ul>' : ''), function (el, close) {
      var box0 = el.firstChild; if (box0) { box0.style.maxWidth = '980px'; }
      var report = null; var dirty = false;
      var drawActs = function () {
        q('[data-mt-acts]', el).innerHTML = acts.map(function (a, i) {
          return '<div class="mkc-act" data-i="' + i + '"><input class="mkc-input" data-a="text" placeholder="What, e.g. Send John the sign-up link" value="' + esc(a.text || '') + '"><input class="mkc-input" data-a="phone" inputmode="tel" placeholder="Number (optional)" value="' + esc(a.phone || '') + '"' + (a.pipeline ? ' disabled title="Saved to the pipeline"' : '') + '><input class="mkc-input" type="date" data-a="due" value="' + esc(a.due || '') + '"><button type="button" class="mkc-btn sm ghost" data-a-del>×</button></div>';
        }).join('') || '<div class="mkc-muted">None yet.</div>';
        qa('.mkc-act', el).forEach(function (row) {
          var i = Number(row.getAttribute('data-i'));
          qa('[data-a]', row).forEach(function (inp) { inp.oninput = function () { acts[i][inp.getAttribute('data-a')] = inp.value; dirty = true; }; });
          q('[data-a-del]', row).onclick = function () { acts.splice(i, 1); dirty = true; drawActs(); };
        });
      };
      drawActs();
      api('/meeting/report?person_key=' + encodeURIComponent(who)).then(function (r) { report = r; q('[data-mt-rep]', el).innerHTML = meetReportHtml(r); }, function (e) { q('[data-mt-rep]', el).innerHTML = '<div class="mkc-err">' + esc(e.message) + '</div>'; });
      var save = function (joined) {
        var body = { person_key: who, day: dayKey, slot: slotKey, notes: q('[data-mt-notes]', el).value, actions: acts, joined: !!joined, report: report };
        return api('/meeting/notes', { method: 'POST', body: body }).then(function (n) {
          acts = n.actions.slice(); dirty = false; drawActs(); if (S && S.meet) S.meet.notes = n;
          q('[data-mt-saved]', el).textContent = 'Saved ' + new Date().toTimeString().slice(0, 5); return n;
        }, function (e) { q('[data-mt-saved]', el).innerHTML = '<span class="mkc-bad">' + esc(e.message) + '</span>'; throw e; });
      };
      q('[data-mt-notes]', el).oninput = function () { dirty = true; };
      q('[data-mt-add]', el).onclick = function () { acts.push({ text: '', phone: '', due: '' }); drawActs(); var ins = qa('[data-a="text"]', el); if (ins.length) ins[ins.length - 1].focus(); };
      q('[data-mt-save]', el).onclick = function () { save(false).then(function () { toast('Meeting notes saved'); }, function () {}); };
      var j = q('[data-mt-join]', el); if (j) j.onclick = function () { if (meetPopup(set.meet_url)) { save(true).catch(function () {}); if (S) ev('meeting_join', slotKey); } };
      var stopMtx = function () { if (MTX && !MTX.stopped) { MTX.stopped = true; try { MTX.sr.stop(); } catch (x) { /* ignore */ } } };
      q('[data-mt-tx]', el).onclick = function () {
        var b = this; var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (MTX && !MTX.stopped) { stopMtx(); b.textContent = '🎙 Live notes'; save(false).catch(function () {}); return; }
        if (!SR) { toast('Live notes need Chrome or Edge on a laptop. Type the notes instead.', 'bad'); return; }
        try {
          var r = new SR(); r.continuous = true; r.interimResults = true; r.lang = 'en-UG';
          var ta = q('[data-mt-notes]', el); var base = ta.value ? ta.value.replace(/\s*$/, '\n') : '';
          MTX = { sr: r, stopped: false };
          r.onresult = function (e) {
            var fin = '', interim = '';
            for (var i = e.resultIndex; i < e.results.length; i++) { if (e.results[i].isFinal) fin += e.results[i][0].transcript.trim() + '. '; else interim += e.results[i][0].transcript; }
            if (fin) base += fin; ta.value = base + interim; dirty = true;
          };
          r.onerror = function (e) { if (e && e.error === 'not-allowed') { MTX.stopped = true; toast('Microphone blocked: allow it for live notes.', 'bad'); b.textContent = '🎙 Live notes'; } };
          r.onend = function () { if (MTX && !MTX.stopped && document.body.contains(el)) { try { r.start(); } catch (x) { /* ignore */ } } };
          r.start(); b.textContent = '⏹ Stop live notes'; q('[data-mt-txs]', el).textContent = 'Listening… (text only, no audio kept)';
        } catch (x) { toast('Live notes are not available in this browser.', 'bad'); }
      };
      var timer = setInterval(function () { if (!document.body.contains(el)) { clearInterval(timer); stopMtx(); return; } if (dirty) save(false).catch(function () {}); }, 30000);
      q('[data-x]', el).onclick = function () { if (S && opts.slotKey !== undefined) { S.meetShut = S.meetShut || {}; S.meetShut[opts.slotKey] = true; } if (S && sl) { S.meetShut = S.meetShut || {}; S.meetShut[sl.day + sl.slot] = true; } stopMtx(); clearInterval(timer); if (dirty) save(false).catch(function () {}); close(); };
    });
  }
  // King: the day split (which block when). Callers' screens follow it.
  function drawKSplit(host) {
    var box = q('[data-k-split]', host); if (!box) return;
    api('/day-split').then(function (sp) {
      var kinds = sp.kinds || {}; var rowsL = sp.blocks.slice();
      var draw = function () {
        var mins = {}; rowsL.forEach(function (b) { var m = function (t) { var x = String(t).split(':'); return Number(x[0]) * 60 + Number(x[1] || 0); }; var d = Math.max(0, m(b.end) - m(b.start)); mins[b.kind] = (mins[b.kind] || 0) + d; });
        var work = Object.keys(mins).filter(function (k) { return k !== 'lunch'; }).reduce(function (n, k) { return n + mins[k]; }, 0) || 1;
        box.innerHTML = '<h4>⏱ Day split (callers follow it by time of day)</h4><p class="mkc-muted" style="margin:0 0 8px">Kampala time. The calling screen switches to the block\'s work after each call; a caller can still change mode by hand for that block. ' + (sp.custom ? 'Set by ' + esc(sp.updated_by || 'King') + '.' : 'Using the default split.') + '</p>'
          + '<div class="mkc-splitsum">' + Object.keys(mins).filter(function (k) { return k !== 'lunch'; }).map(function (k) { return '<span class="mkc-pill">' + esc((kinds[k] || {}).label || k) + ' ' + Math.round(100 * mins[k] / work) + '% · ' + hm(mins[k] * 60000) + '</span>'; }).join('') + '</div>'
          + '<div class="mkc-splitrows">' + rowsL.map(function (b, i) {
            return '<div class="mkc-splitrow"><input class="mkc-input" type="time" data-ks-start="' + i + '" value="' + esc(b.start) + '" aria-label="Start"><span>–</span><input class="mkc-input" type="time" data-ks-end="' + i + '" value="' + esc(b.end) + '" aria-label="End"><select class="mkc-input" data-ks-kind="' + i + '" aria-label="What for">' + Object.keys(kinds).map(function (k) { return '<option value="' + esc(k) + '"' + (k === b.kind ? ' selected' : '') + '>' + esc(kinds[k].label) + '</option>'; }).join('') + '</select><button type="button" class="mkc-btn sm ghost" data-ks-del="' + i + '" aria-label="Remove">✕</button></div>';
          }).join('') + '</div>'
          + '<div class="mkc-row" style="margin-top:8px"><button type="button" class="mkc-btn sm" data-ks-add>+ Add block</button><button type="button" class="mkc-btn sm go" data-ks-save>Save split</button><button type="button" class="mkc-btn sm ghost" data-ks-reset>Use defaults</button></div><div data-ks-err></div>';
        var read = function () { rowsL = rowsL.map(function (b, i) { return { start: q('[data-ks-start="' + i + '"]', box).value, end: q('[data-ks-end="' + i + '"]', box).value, kind: q('[data-ks-kind="' + i + '"]', box).value }; }); };
        qa('[data-ks-start],[data-ks-end],[data-ks-kind]', box).forEach(function (inp) { inp.onchange = function () { read(); draw(); }; });
        qa('[data-ks-del]', box).forEach(function (b) { b.onclick = function () { read(); rowsL.splice(Number(b.getAttribute('data-ks-del')), 1); draw(); }; });
        q('[data-ks-add]', box).onclick = function () { read(); var last = rowsL[rowsL.length - 1]; rowsL.push({ start: last ? last.end : '08:00', end: '18:00', kind: 'new' }); draw(); };
        var put = function (body) { api('/day-split', { method: 'PUT', body: body }).then(function () { toast('Day split saved'); drawKSplit(host); }, function (e) { q('[data-ks-err]', box).innerHTML = '<div class="mkc-err">' + esc(e.message) + '</div>'; }); };
        q('[data-ks-save]', box).onclick = function () { read(); put({ blocks: rowsL, housekeeping_per_hour: sp.housekeeping_per_hour }); };
        q('[data-ks-reset]', box).onclick = function () { put({ reset: true }); };
      };
      draw();
    }).catch(function (e) { panelFailed(box, e); });
  }
  function drawKMeet(host) {
    var box = q('[data-k-meetings]', host); if (!box) return;
    Promise.all([api('/meeting/settings'), api('/meeting/history?limit=40')]).then(function (res) {
      var st = res[0]; var hist = res[1];
      var set = (st.times || []).length && st.meet_url;
      box.innerHTML = '<h3>📅 Team meetings</h3><p class="mm-sub">Set the daily meeting times and the Google Meet link. Callers are reminded and get their report before each one.</p>'
        + '<div class="mm-form"><label>Times (Kampala, 24h)<input class="mkc-input" data-km-times placeholder="08:30, 16:30" value="' + esc((st.times || []).join(', ')) + '"></label>'
        + '<label>Google Meet link (from the calendar invite)<input class="mkc-input" data-km-url placeholder="https://meet.google.com/abc-defg-hij" value="' + esc(st.meet_url || '') + '"></label>'
        + '<label>Title<input class="mkc-input" data-km-title value="' + esc(st.title || '') + '"></label><button type="button" class="mm-save" data-km-save>Save</button></div>'
        + '<div class="mm-status' + (set ? '' : ' unset') + '" data-km-msg>' + (set ? '✅ Set: ' + esc((st.times || []).join(', ')) + ' Kampala' + (st.updated_at ? ' · saved by ' + esc(st.updated_by || '') + ' · ' + esc(kDayTime(st.updated_at)) : '') : '⚠️ Not set yet — callers get a notification and their report 10 minutes before each meeting.') + '</div>'
        + '<div class="mm-people"><b>Meeting report for:</b>' + (boot.callers || []).map(function (c) { return '<button type="button" class="mm-person" data-km-rep="' + esc(c.key) + '">' + esc(c.name) + '</button>'; }).join('') + (st.meet_url ? '<button type="button" class="mm-save" style="min-height:36px" data-km-join>▶ Join meeting</button>' : '') + '</div>'
        + '<div data-km-report style="margin-top:8px"></div>'
        + '<div class="mm-hist"><h4>Meeting notes history</h4>'
        + (hist.length ? '<div class="mkc-scroll"><table class="mkc-table"><tr><th>When</th><th>Who</th><th>Notes</th><th>Action items</th><th>Report then</th></tr>' + hist.map(function (n) {
          var r = n.report || {}; var t = r.today || {};
          return '<tr><td>' + esc(n.day) + ' ' + esc(n.slot) + (n.joined_at ? '<div class="mkc-muted">joined ' + esc(kDayTime(n.joined_at)) + '</div>' : '') + '</td><td>' + esc(personName(n.person_key)) + '</td><td style="max-width:360px;white-space:pre-wrap">' + esc(String(n.notes || '').slice(0, 600)) + '</td>'
            + '<td>' + ((n.actions || []).map(function (a) { return '<div>• ' + esc(a.text) + (a.phone ? ' <span class="mkc-muted">' + esc(a.phone) + (a.pipeline ? ' → queue' : '') + '</span>' : '') + (a.due ? ' <span class="mkc-muted">by ' + esc(a.due) + '</span>' : '') + '</div>'; }).join('') || '–') + '</td>'
            + '<td class="mkc-muted">' + (t.calls != null ? t.calls + ' calls · ' + (t.closes || 0) + ' closes · ' + (((t.money || {}).confirmed) || 0) + ' paid' : '–') + '</td></tr>';
        }).join('') + '</table></div>' : '<p class="mm-empty">No meeting notes yet. Notes and action items saved in a meeting show here.</p>') + '</div>';
      q('[data-km-save]', box).onclick = function () {
        api('/meeting/settings', { method: 'POST', body: { times: q('[data-km-times]', box).value, meet_url: q('[data-km-url]', box).value, title: q('[data-km-title]', box).value } })
          .then(function () { toast('Meeting settings saved'); drawKMeet(host); }, function (e) { q('[data-km-msg]', box).innerHTML = '<span class="mkc-bad">' + esc(e.message) + '</span>'; });
      };
      var kj = q('[data-km-join]', box); if (kj) kj.onclick = function () { meetPopup(st.meet_url); };
      qa('[data-km-rep]', box).forEach(function (b) {
        b.onclick = function () {
          qa('[data-km-rep]', box).forEach(function (x) { x.classList.toggle('on', x === b); });
          var out = q('[data-km-report]', box); out.innerHTML = '<p class="mkc-muted">Building…</p>';
          api('/meeting/report?person_key=' + encodeURIComponent(b.getAttribute('data-km-rep'))).then(function (r) { out.innerHTML = '<div class="mkc-muted" style="margin-bottom:4px"><b>' + esc(r.name) + '</b> · built ' + esc(kDayTime(r.made_at)) + '</div>' + meetReportHtml(r); }, function (e) { out.innerHTML = '<div class="mkc-err">' + esc(e.message) + '</div>'; });
        };
      });
    }).catch(function (e) { panelFailed(box, e); });
  }
  // ---- Payment SMS proof: screenshot -> free OCR in the browser -> check -> claim for King
  var OCR = null;
  function loadTesseract() {
    if (OCR) return OCR;
    OCR = new Promise(function (resolve, reject) {
      if (window.Tesseract) return resolve(window.Tesseract);
      var sc = document.createElement('script'); sc.src = '/vendor/tesseract/tesseract.min.js'; sc.async = true;
      sc.onload = function () { resolve(window.Tesseract); }; sc.onerror = function () { OCR = null; reject(new Error('The text reader could not load. Type the details by hand.')); };
      document.head.appendChild(sc);
    });
    return OCR;
  }
  function shrinkImage(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onerror = function () { reject(new Error('Could not read that file.')); };
      r.onload = function () {
        var img = new Image();
        img.onload = function () {
          var max = 1800; var sc = Math.min(1, max / Math.max(img.width, img.height));
          var c = document.createElement('canvas'); c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL('image/jpeg', 0.88));
        };
        img.onerror = function () { reject(new Error('That is not a picture. Use a PNG or JPG screenshot.')); };
        img.src = r.result;
      };
      r.readAsDataURL(file);
    });
  }
  function readText(dataUrl, onPct) {
    return loadTesseract().then(function (T) {
      return T.recognize(dataUrl, 'eng', {
        workerPath: '/vendor/tesseract/worker.min.js', corePath: '/vendor/tesseract/core', langPath: '/vendor/tesseract/lang',
        logger: function (m) { if (m && m.status === 'recognizing text' && onPct) onPct(Math.round((m.progress || 0) * 100)); }
      });
    }).then(function (r) { return { text: (r && r.data && r.data.text) || '', confidence: r && r.data ? r.data.confidence : null }; });
  }
  // Second try for a dim / blurry screenshot: 2x, grey, then each pixel against its neighbourhood (adaptive threshold).
  function cleanForOcr(dataUrl) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        var sc = img.width < 1400 ? 2 : 1; var w = img.width * sc; var h = img.height * sc;
        var c = document.createElement('canvas'); c.width = w; c.height = h; var x = c.getContext('2d');
        x.imageSmoothingQuality = 'high'; x.drawImage(img, 0, 0, w, h);
        var d = x.getImageData(0, 0, w, h); var px = d.data; var g = new Float64Array(w * h); var I = new Float64Array((w + 1) * (h + 1));
        for (var i = 0; i < w * h; i++) g[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
        for (var yy = 0; yy < h; yy++) { var row = 0; for (var xx = 0; xx < w; xx++) { row += g[yy * w + xx]; I[(yy + 1) * (w + 1) + xx + 1] = I[yy * (w + 1) + xx + 1] + row; } }
        var r = Math.max(12, Math.round(w / 30));
        for (var y2 = 0; y2 < h; y2++) {
          for (var x2 = 0; x2 < w; x2++) {
            var x0 = Math.max(0, x2 - r), x1 = Math.min(w, x2 + r + 1), y0 = Math.max(0, y2 - r), y1 = Math.min(h, y2 + r + 1);
            var mean = (I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0]) / ((x1 - x0) * (y1 - y0));
            var dark = g[y2 * w + x2] < mean * 0.92; var k = (y2 * w + x2) * 4;
            px[k] = px[k + 1] = px[k + 2] = dark ? 0 : 255; px[k + 3] = 255;
          }
        }
        x.putImageData(d, 0, 0); resolve(c.toDataURL('image/png'));
      };
      img.onerror = function () { resolve(null); };
      img.src = dataUrl;
    });
  }
  function fieldsFound(p) { return ['amount_ugx', 'txn_id', 'paid_at', 'sender_phone'].filter(function (k) { return p && p[k]; }).length; }
  function toLocalInput(iso) { if (!iso) return ''; var d = new Date(new Date(iso).getTime() + 3 * 3600000); return d.toISOString().slice(0, 16); }
  function fromLocalInput(v) { return v ? new Date(v + ':00+03:00').toISOString() : ''; }
  function openSmsProof(ctx) {
    var a = ctx.attempt || null;
    var st = { img: '', text: '', conf: null, parsed: null };
    var who = a ? esc(a.name || '') + ' ' + esc(a.phone_masked || '') : '';
    modal('<div class="mkc-row" style="justify-content:space-between"><h3 style="margin:0;font-weight:900">📷 Upload payment SMS</h3><button class="mkc-btn sm" data-x>Close</button></div>'
      + '<p class="mkc-muted" style="margin:4px 0 8px">Screenshot the MoMo / Airtel confirmation SMS (on the phone, or in Phone Link → Messages) and add it here. The text is read on this computer – check every field before you send it to King.</p>'
      + (a ? '<div class="mkc-tpl">For: <b>' + who + '</b></div>' : '<div class="mkc-fld"><label>Agent\'s number</label><input class="mkc-input" data-sp-phone inputmode="tel" placeholder="0772 123 456"></div>')
      + '<div class="mkc-proof" style="margin-top:8px"><div><div class="mkc-drop" data-sp-drop tabindex="0">Tap to choose a screenshot<br><span class="mkc-muted">or paste it here (Ctrl+V) · PNG/JPG, up to 6 MB</span><input type="file" accept="image/*" data-sp-file style="display:none"></div><div data-sp-prev style="margin-top:8px"></div>'
      + '<div class="mkc-ocrbar" style="margin-top:6px;display:none" data-sp-bar><i></i></div><div class="mkc-muted" data-sp-stat></div>'
      + '<details style="margin-top:6px"><summary class="mkc-muted">Text read from the picture</summary><pre data-sp-text style="white-space:pre-wrap;font-size:11px;background:#f8fafc;padding:6px;border-radius:8px;max-height:160px;overflow:auto"></pre></details></div>'
      + '<div><div class="mkc-fld"><label>Amount (UGX)</label><input class="mkc-input" data-f="amount_ugx" inputmode="numeric"></div>'
      + '<div class="mkc-fld"><label>Sender name</label><input class="mkc-input" data-f="sender_name"></div>'
      + '<div class="mkc-fld"><label>Sender number</label><input class="mkc-input" data-f="sender_phone" inputmode="tel" placeholder="as on the SMS" title="Shown as the last 3 digits. Type the full number to change it."></div>'
      + '<div class="mkc-fld"><label>Transaction ID</label><input class="mkc-input" data-f="txn_id"></div>'
      + '<div class="mkc-fld"><label>Date &amp; time</label><input class="mkc-input" type="datetime-local" data-f="paid_at"></div>'
      + '<div class="mkc-fld"><label>Network</label><select class="mkc-select" data-f="network"><option value="">–</option><option value="mtn">MTN MoMo</option><option value="airtel">Airtel Money</option></select></div>'
      + '<div data-sp-checks style="margin-top:6px"></div><div data-sp-err></div>'
      + '<button type="button" class="mkc-btn go" style="width:100%;margin-top:8px" data-sp-go disabled>Send to King to confirm</button></div></div>', function (m, close) {
      q('[data-x]', m).onclick = close;
      var f = function (k) { return q('[data-f="' + k + '"]', m); };
      var phoneOf = function () { var p = q('[data-sp-phone]', m); return p ? p.value : ''; };
      var fields = function () { return { amount_ugx: f('amount_ugx').value.replace(/[^\d]/g, ''), sender_name: f('sender_name').value.trim(), sender_phone: /^•/.test(f('sender_phone').value.trim()) ? (st.parsed && st.parsed.sender_phone) || '' : f('sender_phone').value.trim(), txn_id: f('txn_id').value.trim(), paid_at: fromLocalInput(f('paid_at').value), network: f('network').value, direction: st.parsed ? st.parsed.direction : '', to_makaug: st.parsed ? st.parsed.to_makaug : null }; };
      var tmr;
      var check = function () {
        api('/sms-proof/parse', { method: 'POST', body: { text: st.text, attempt_id: a ? a.id : null, phone: phoneOf(), fields: fields() } }).then(function (r) {
          q('[data-sp-checks]', m).innerHTML = '<div class="mkc-muted">Plan: ' + esc(r.plan) + (r.who ? ' · ' + esc(r.who) : '') + '</div>'
            + r.problems.map(function (x) { return '<div class="mkc-bad">✖ ' + esc(x) + '</div>'; }).join('')
            + r.flags.map(function (x) { return '<div style="color:#b45309">⚠ ' + esc(x) + ' <span class="mkc-muted">(King will see this)</span></div>'; }).join('')
            + (!r.problems.length && !r.flags.length ? '<div class="mkc-good" style="font-weight:800">✓ All checks pass</div>' : '');
          q('[data-sp-go]', m).disabled = !st.img || r.problems.length > 0;
        }, function (e) { q('[data-sp-err]', m).innerHTML = '<div class="mkc-err">' + esc(e.message) + '</div>'; });
      };
      qa('[data-f]', m).forEach(function (i) { i.oninput = i.onchange = function () { clearTimeout(tmr); tmr = setTimeout(check, 400); }; });
      var ph = q('[data-sp-phone]', m); if (ph) ph.oninput = function () { clearTimeout(tmr); tmr = setTimeout(check, 400); };
      var take = function (file) {
        if (!file) return;
        if (file.size > 15e6) { q('[data-sp-err]', m).innerHTML = '<div class="mkc-err">That file is too big. Crop the screenshot to the SMS.</div>'; return; }
        var stat = q('[data-sp-stat]', m); var bar = q('[data-sp-bar]', m);
        stat.textContent = 'Preparing the picture…';
        shrinkImage(file).then(function (url) {
          st.img = url; q('[data-sp-prev]', m).innerHTML = '<img alt="Payment SMS screenshot" src="' + url + '">';
          bar.style.display = ''; stat.textContent = 'Reading the text… (first time takes a little longer)';
          return readText(url, function (pct) { q('i', bar).style.width = pct + '%'; });
        }).then(function (r) {
          var ask = function (t) { return api('/sms-proof/parse', { method: 'POST', body: { text: t, attempt_id: a ? a.id : null, phone: phoneOf() } }); };
          return ask(r.text).then(function (p1) {
            if (fieldsFound(p1.parsed) >= 3) return { r: r, p: p1, again: false };
            stat.textContent = 'Hard to read – cleaning up the picture and reading it again…';
            return cleanForOcr(st.img).then(function (clean) {
              if (!clean) return { r: r, p: p1, again: false };
              return readText(clean, function (pct) { q('i', bar).style.width = pct + '%'; }).then(function (r2) {
                return ask(r2.text).then(function (p2) { return fieldsFound(p2.parsed) > fieldsFound(p1.parsed) ? { r: r2, p: p2, again: true } : { r: r, p: p1, again: false }; });
              });
            });
          });
        }).then(function (best) {
          var r0 = best.r; var r = best.p;
          st.text = r0.text; st.conf = r0.confidence; q('[data-sp-text]', m).textContent = r0.text;
          bar.style.display = 'none';
          stat.textContent = (best.again ? 'Read after cleaning up the picture. ' : 'Read. ') + 'Confidence ' + Math.round(r0.confidence || 0) + '% – check the fields.' + (fieldsFound(r.parsed) < 3 ? ' Some fields are missing: type them from the SMS.' : '');
          var p = r.parsed; st.parsed = p;
          if (p.amount_ugx) f('amount_ugx').value = p.amount_ugx; if (p.sender_name) f('sender_name').value = p.sender_name;
          if (p.sender_phone) f('sender_phone').value = p.sender_phone_masked || p.sender_phone; if (p.txn_id) f('txn_id').value = p.txn_id;
          if (p.paid_at) f('paid_at').value = toLocalInput(p.paid_at); if (p.network) f('network').value = p.network;
          check();
        }).catch(function (e) { bar.style.display = 'none'; stat.textContent = ''; q('[data-sp-err]', m).innerHTML = '<div class="mkc-err">' + esc(e.message) + '</div>'; q('[data-sp-go]', m).disabled = !st.img; });
      };
      var drop = q('[data-sp-drop]', m); var file = q('[data-sp-file]', m);
      drop.onclick = function () { file.click(); };
      file.onchange = function () { take(file.files[0]); };
      drop.ondragover = function (e) { e.preventDefault(); drop.classList.add('on'); };
      drop.ondragleave = function () { drop.classList.remove('on'); };
      drop.ondrop = function (e) { e.preventDefault(); drop.classList.remove('on'); take(e.dataTransfer.files[0]); };
      m.addEventListener('paste', function (e) { var it = [].slice.call((e.clipboardData || {}).items || []).filter(function (x) { return /^image\//.test(x.type); })[0]; if (it) take(it.getAsFile()); });
      st.take = take; m._sp = st;
      q('[data-sp-go]', m).onclick = function () {
        var b = this; b.disabled = true;
        api('/sms-proof', { method: 'POST', body: { attempt_id: a ? a.id : null, phone: phoneOf(), person_key: S ? S.person : '', image: st.img, ocr_text: st.text, ocr_confidence: st.conf, fields: fields() } }).then(function (r) {
          close(); toast('Sent to King: UGX ' + Number(r.amount_ugx).toLocaleString('en-GB') + ' · ' + r.txn_id + (r.flags.length ? ' · ' + r.flags.length + ' flag(s)' : ''));
          if (a && S && S.pay) { delete S.pay[a.id]; loadPay(a); }
          if (ctx.after) ctx.after();
        }, function (e) { b.disabled = false; q('[data-sp-err]', m).innerHTML = '<div class="mkc-err">' + esc(e.message) + '</div>'; });
      };
    });
  }
  function drawKProofs(host) {
    var box = q('[data-k-proofs]', host); if (!box) return;
    api('/sms-proofs').then(function (list) {
      var waiting = list.filter(function (p) { return p.status === 'pending'; }).length;
      box.innerHTML = '<div class="mkc-row" style="justify-content:space-between"><h4 style="margin:0">📷 Payment SMS proofs (' + waiting + ' to confirm)</h4><button type="button" class="mkc-btn sm dark" data-kp-up>Upload payment SMS</button></div>'
        + '<p class="mkc-muted" style="margin:4px 0 6px">Confirm only when the money is in the MoMo / Airtel line. Confirming records the payment through the normal path (sales, Road to 1000, commission).</p>'
        + (list.length ? '<div class="mkc-scroll"><table class="mkc-table"><tr><th>Screenshot</th><th>Read from the SMS</th><th>For</th><th>Checks</th><th></th></tr>' + list.slice(0, 30).map(function (p) {
          return '<tr><td><a href="' + esc(p.image) + '" target="_blank" rel="noopener"><img src="' + esc(p.image) + '" alt="" style="width:90px;max-height:120px;object-fit:cover;border-radius:6px;border:1px solid #e2e8f0"></a></td>'
            + '<td><b>' + ugx(p.amount_ugx) + '</b> · ' + esc((p.network || '').toUpperCase()) + '<div>' + esc(p.sender_name || '–') + ' ' + esc(p.sender_phone || '') + '</div><div class="mkc-muted">ID ' + esc(p.txn_id) + ' · ' + esc(kDayTime(p.paid_at)) + (p.confidence != null ? ' · OCR ' + Math.round(p.confidence) + '%' : '') + '</div></td>'
            + '<td>' + esc(p.phone) + '<div class="mkc-muted">' + esc(String(p.purpose || '').replace(/_/g, ' ')) + ' · by ' + esc(personName(p.by)) + '</div></td>'
            + '<td>' + ((p.flags || []).map(function (x) { return '<span class="mkc-pill warn">' + esc(x) + '</span>'; }).join(' ') || '<span class="mkc-pill live">OK</span>') + '</td>'
            + '<td>' + (p.status === 'pending' && p.claim_id ? '<button type="button" class="mkc-btn sm go" data-kp-ok="' + esc(p.claim_id) + '">Confirm</button> <button type="button" class="mkc-btn sm ghost" data-kp-no="' + esc(p.claim_id) + '">Reject</button>' : '<span class="mkc-pill' + (p.status === 'confirmed' ? ' live' : ' flag') + '">' + esc(p.status) + '</span>') + '</td></tr>';
        }).join('') + '</table></div>' : '<p class="mkc-muted">No payment SMS uploaded yet.</p>');
      q('[data-kp-up]', box).onclick = function () { openSmsProof({ after: function () { drawKProofs(host); } }); };
      var decide = function (id, ok) {
        if (ok && !window.confirm('Confirm this payment? Only if the money is in the MoMo / Airtel line.')) return;
        var note = ok ? '' : (window.prompt('Why reject it?') || ''); if (!ok && !note) return;
        fetch('/api/admin/revenue/claims/' + encodeURIComponent(id) + '/' + (ok ? 'confirm' : 'reject'), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(ok ? { note: 'Checked against the payment SMS screenshot' } : { note: note }) })
          .then(function (res) { return res.json().then(function (j) { if (!res.ok || j.ok === false) throw new Error(j.error || 'Could not save'); return j; }); })
          .then(function () { toast(ok ? 'Payment confirmed' : 'Rejected'); drawKProofs(host); }, function (e) { toast(e.message); });
      };
      qa('[data-kp-ok]', box).forEach(function (b) { b.onclick = function () { decide(b.getAttribute('data-kp-ok'), true); }; });
      qa('[data-kp-no]', box).forEach(function (b) { b.onclick = function () { decide(b.getAttribute('data-kp-no'), false); }; });
    }).catch(function (e) { panelFailed(box, e); });
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
            + '<td>' + d.left_screen + '× · ' + hm(d.away_ms) + '</td><td>' + hm(d.idle_ms) + '</td><td>' + d.calls + (d.inbound ? '<div class="mkc-muted">' + d.outbound + ' out · ' + d.inbound + ' in</div>' : '') + (d.not_answered ? '<div class="mkc-muted">Not answered: ' + d.not_answered + '</div>' : '') + '</td><td>' + hm(d.talk_s * 1000) + '</td><td>' + d.closes + '</td><td>' + d.pay_sent + ' sent · ' + d.pay_claimed + ' claimed · ' + d.pay_confirmed + ' ✓</td><td>' + ugx(d.commission_ugx) + '</td><td>' + d.actions + '</td>'
            + '<td>' + d.flags.map(function (f) { return '<span class="mkc-pill flag">' + esc(f) + '</span>'; }).join(' ') + '</td></tr>'
            + '<tr><td colspan="13" style="padding-top:0">' + timelineBar(d) + '</td></tr>';
        }).join('');
        return '<div class="mkc-person" style="margin-top:8px"><div class="mkc-row" style="justify-content:space-between"><b style="font-size:16px">' + esc(p.name) + '</b>' + (p.flags ? '<span class="mkc-pill flag">⚠ ' + p.flags + ' flag(s)</span>' : '<span class="mkc-pill live">No flags</span>') + '</div>'
          + '<div class="mkc-row" style="margin:4px 0">' + [['Work mode', hm(t.work_ms)], ['Downtime', hm(t.down_ms)], ['On screen', hm(t.on_screen_ms)], ['Breaks', t.breaks + ' · ' + hm(t.break_ms)], ['Left screen', t.left_screen + '× · ' + hm(t.away_ms)], ['Idle', hm(t.idle_ms) + (t.long_idles ? ' · ' + t.long_idles + ' long' : '')], ['Calls', t.calls], ['Talk', hm(t.talk_s * 1000)], ['Closes', t.closes], ['Payments', t.pay_confirmed + ' confirmed · ' + t.pay_claimed + ' claimed'], ['Commission', ugx(t.commission_ugx)], ['Days', t.days_worked]].map(function (x) { return '<span class="mkc-pill"><span class="mkc-muted">' + x[0] + '</span> <b>' + esc(String(x[1])) + '</b></span>'; }).join('') + '</div>'
          + (p.missed_days.length ? '<div class="mkc-bad">Missed working days: ' + esc(p.missed_days.join(', ')) + '</div>' : '')
          + '<div class="mkc-scroll"><table class="mkc-table"><tr><th>Day</th><th>Open–close</th><th>Work mode</th><th>Breaks</th><th>Left screen</th><th>Idle</th><th>Calls</th><th>Talk</th><th>Closes</th><th>Payments</th><th>Commission</th><th>Actions</th><th>Flags</th></tr>' + days + '</table></div></div>';
      }).join('');
      box.innerHTML = '<div class="mkc-row" style="justify-content:space-between"><h4 style="margin:0">⏱ Staff activity · ' + esc(r.from) + (r.to !== r.from ? ' → ' + esc(r.to) : '') + '</h4>' + periodTabs('data-k-per', K.period) + '</div>'
        + '<p class="mkc-muted" style="margin:4px 0 0">Times are Kampala. Bar: <b style="color:#1f2937;white-space:nowrap"><i style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#10b981;vertical-align:-1px"></i> work mode</b>, <b style="color:#1f2937;white-space:nowrap"><i style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#f59e0b;vertical-align:-1px"></i> breaks</b>, <b style="color:#1f2937;white-space:nowrap"><i style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#ef4444;vertical-align:-1px"></i> downtime</b> (work mode off or out of full screen), black tick = login. Flags: late start (after 10:00), downtime 30+ min, leaving the screen 5+ min or 20+ min in total, idle 10+ min, breaks over their time, missed working days.</p>' + (people || '<p class="mkc-muted">No activity in this period.</p>');
      qa('[data-k-per]', box).forEach(function (b) { b.onclick = function () { K.period = b.getAttribute('data-k-per'); drawKAct(host); }; });
    }).catch(function (e) { panelFailed(box, e); });
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
    }).catch(function (e) { panelFailed(box, e); });
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
      + '<div class="mkc-kpis"><div class="' + (p.calls_hit ? 'mkc-good' : '') + '"><b>' + p.calls + '/' + tg.calls_per_day + '</b>calls</div><div class="' + (p.closes_hit ? 'mkc-good' : '') + '"><b>' + p.closes + '/' + tg.closes_per_day + '</b>closes</div><div><b>' + (p.not_answered || 0) + '</b>not answered</div><div><b>' + p.connected + '</b>spoke</div><div><b>' + (p.avg_talk_s || 0) + ' s</b>avg call</div><div><b>' + (p.callbacks_due || 0) + (p.callbacks_overdue ? '<span class="mkc-bad"> +' + p.callbacks_overdue + ' late</span>' : '') + '</b>callbacks</div></div>'
      + '<div style="margin:4px 0">' + tasks + '</div>'
      + '<div style="margin:4px 0" data-k-tasktime="' + esc(p.person_key) + '">' + taskTimeHtml(p.task_ms) + ' <span class="mkc-pill">📞 talk ' + hm((p.talk_s || 0) * 1000) + '</span></div>'
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
    // data-kpart: which King sidebar page shows each part (Team & calls, Staff pay & targets, Money in,
    // Calling lists). "Full calling desk" (no part) still shows everything.
    host.innerHTML = '<div class="mkc-panel" style="margin-top:16px">'
      + '<div class="mkc-row" style="justify-content:space-between" data-kpart="team"><div><h3 style="margin:0;font-size:20px;font-weight:900"><i class="fas fa-phone"></i> Calling · ' + esc(d.day) + '</h3><p class="mkc-muted" style="margin:2px 0 0">Everyone who calls shows here automatically. Times are Kampala. Phones show the last 3 digits.</p></div>'
      + '<div class="mkc-row"><button type="button" class="mkc-btn sm go" data-k-meet>Meeting review (pipeline)</button><span class="mkc-pill">Team: ' + (team.calls || 0) + ' calls · ' + (team.closes || 0) + ' closes · ' + (team.not_answered ? 'Not answered: ' + team.not_answered + ' · ' : '') + (team.flagged_calls || 0) + ' flagged</span><button type="button" class="mkc-btn sm" data-k-refresh>Refresh</button></div>'
      + '<div style="margin-top:8px;background:#0f172a;color:#fff;border-radius:12px;padding:8px 12px" data-kpart="team"><div class="mkc-row" style="justify-content:space-between"><b>Road to 1,000 paid agents</b><b style="color:#fbbf24">' + (road.paying_now || 0) + ' / 1,000 · ' + (road.percent || 0) + '%</b></div><div style="height:10px;background:#334155;border-radius:99px;margin-top:6px;overflow:hidden"><i style="display:block;height:100%;background:linear-gradient(90deg,#10b981,#f59e0b);width:' + Math.max(1, Math.min(100, road.percent || 0)) + '%"></i></div></div></div>'
      + '<div style="margin-top:6px" data-kpart="team">' + teamTasks + '</div>'
      + '<div class="mkc-people" data-kpart="team">' + d.people.map(function (p) { return personRow(d, p); }).join('') + '</div>'
      + '<div data-k-evbox data-kpart="team"></div>'
      + '<div class="mkc-panel" style="margin-top:14px" data-k-plans data-kpart="team"></div>'
      + '<div class="mkc-panel" style="margin-top:14px" data-k-act data-kpart="team"></div>'
      + '<div class="mkc-panel" style="margin-top:14px" data-k-cashlog data-kpart="money"></div>'
      + '<div class="mkc-panel" style="margin-top:14px" data-k-calls data-kpart="team"></div>'
      + '<div class="mkc-meetcard" style="margin-top:14px" data-k-meetings data-kpart="team"></div>'
      + '<div class="mkc-panel" style="margin-top:14px" data-k-split data-kpart="team"></div>'
      + '<div class="mkc-panel" style="margin-top:14px" data-k-proofs data-kpart="money"></div>'
      + '<div class="mkc-panel" style="margin-top:14px" data-k-videos data-kpart="old"></div>'
      + '<div class="mkc-panel" style="margin-top:14px" data-k-blocks data-kpart="lists"></div>'
      + '<div class="mkc-panel" style="margin-top:14px" data-k-intl data-kpart="lists"></div>'
      + '<div class="mkc-grid" style="padding:0;margin-top:14px;grid-template-columns:repeat(auto-fit,minmax(300px,1fr))">'
      + '<div class="mkc-panel" data-kpart="lists"><h4>Numbers staff added (' + (K.nums || []).length + ' to look at)</h4><p class="mkc-muted" style="margin:0 0 6px">Own numbers are already in the caller\'s queue. Tap OK, or Remove to take one out.</p>' + (nums || '<p class="mkc-muted">Nothing waiting.</p>') + '</div>'
      + '<div class="mkc-panel" data-kpart="lists"><h4>Callbacks booked</h4>' + (cbs ? '<div class="mkc-scroll"><table class="mkc-table">' + cbs + '</table></div>' : '<p class="mkc-muted">None booked.</p>') + '</div>'
      + '<div class="mkc-panel" data-kpart="staff"><h4>Logins (own login per person)</h4>' + loginsHtml() + '<div data-k-link></div></div>'
      + '<div class="mkc-panel" data-kpart="team"><h4>Daily summaries saved today</h4>' + ((K.sums || []).map(function (x, i) { var f = x.figures || {}; return '<div class="mkc-kit"><div><b>' + esc(f.name || x.person_key) + '</b><div class="mkc-muted">' + (f.calls || 0) + ' calls · ' + (f.closes || 0) + ' closes · saved ' + esc(kTime(x.made_at)) + (f.saved_because ? ' (' + esc(f.saved_because === '17:00' ? 'at 17:00' : 'session end') + ')' : '') + '</div></div><button type="button" class="mkc-btn sm" data-k-sum="' + i + '">Open</button></div>'; }).join('') || '<p class="mkc-muted">Saved at 17:00 Kampala and when a session ends.</p>') + '</div>'
      + '<div class="mkc-panel" data-kpart="staff"><h4>Daily targets (per person)</h4>' + targets + '<div data-t-err></div><button type="button" class="mkc-btn dark sm" style="margin-top:8px" data-t-save>Save targets</button></div>'
      + '</div></div>';
    q('[data-k-refresh]', host).onclick = function () { renderKing(host); };
    q('[data-k-meet]', host).onclick = openMeeting;
    K.period = K.period || 'day'; K.cashPeriod = K.cashPeriod || 'week';
    K.callsPeriod = K.callsPeriod || 'day';
    drawKPlans(host); drawKAct(host); drawKCash(host); drawKCalls(host); drawKMeet(host); drawKSplit(host); drawKProofs(host); drawKVideos(host); drawKBlocks(host); drawKIntl(host);
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
      return '<div class="mkc-kit"><div><b>' + esc(l.name) + '</b> <span class="mkc-pill">' + esc(l.scope === 'caller' ? 'calling screen only' : 'staff') + '</span>' + (l.sandbox ? ' <span class="mkc-pill warn">PRACTICE · TEST numbers only</span>' : '') + '<div class="mkc-muted">' + esc(l.login) + '</div>'
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

  // ---- Evidence trail v2: charts with trends, session bars, plain-English timeline, drop-offs, audit.
  var EV_LABELS = { notes_check_passed: 'Mic check passed', notes_check_failed: 'Mic check failed', link_drop: 'Phone link / audio dropped', link_back: 'Phone link reconnected', fs_exit: 'Left full screen', fs_enter: 'Back to full screen', hidden: 'Switched away from the screen', visible: 'Came back to the screen', break_start: 'Started a break', break_end: 'Break over', kit_send: 'Sent a sales-kit item', task_switch: 'Switched task', start: 'Started calling', end: 'Stopped calling', screen_open: 'Opened the calling screen', screen_close: 'Closed the calling screen', idle_start: 'No mouse or keyboard for a while', idle_end: 'Active again', work_on: 'Work mode on', work_off: 'Work mode off', meeting_join: 'Joined the team meeting', meeting_end: 'Left the team meeting', inbound_start: 'Took an incoming call', notes_start: 'Live notes on', notes_stop: 'Live notes off', notes_declined: 'Declined live notes', notes_error: 'Live notes stopped (browser)', wa_share: 'Shared on WhatsApp', housekeeping_on: 'Started housekeeping', housekeeping_off: 'Back to calling', auto_fallback: 'List ran out: moved to the next task', route: 'Script step' };
  var ACT_LABELS = { 'mkc-tap': 'Tapped Call now', 'mkc-end': 'Ended the call', 'mkc-save': 'Saved the wrap-up', 'mkc-skip': 'Skipped the number', 'mkc-start': 'Pressed Start calling', 'mkc-add': 'Opened Add number', 'mkc-myreport': 'Opened My report', 'mkc-sidefull': 'Opened the side panel', 'mkc-endroute': 'Finished the script', 'mkc-hello': 'Asked them to say Hello on WhatsApp', 'mkc-washare': 'Opened Share on WhatsApp', 'mkc-work': 'Toggled work mode', 'mkc-break': 'Break button', 'mkc-exit': 'Exit button', 'mkc-quick': 'Picked a call-back time', 'mkc-hkgo': 'Opened a housekeeping item', 'mkc-hkdone': 'Finished a housekeeping item', 'mkc-tclose': 'Closed the texts panel', 'mkc-ans': 'Marked answered', 'mkc-rep': 'Opened the report', 'mkc-rbg': 'Opened the report', 'mkc-live': 'Opened the live site', 'mkc-live2': 'Opened the live site preview', 'mkc-tree': 'Opened the history tree', 'mkc-chip': 'Picked a quick option', 'mkc-rback': 'Went back a script step', sms_sent: 'Logged an SMS', video_requested: 'Asked King to approve a video', cash_check_signed: 'Signed the cash check' };
  var SIDE_TABS = { wa: 'WhatsApp', leads: 'Leads', live: 'Live', search: 'Search', learn: 'Learn', team: 'Team' };
  function actionText(detail) {
    var d = String(detail || ''); var parts = d.split(':'); var code = parts[0]; var arg = parts.slice(1).join(':');
    if (code === 'mkc-pick') return arg === '0' ? 'They picked up' : 'No answer';
    if (code === 'mkc-reply') return 'Picked script answer ' + (Number(arg) + 1);
    if (code === 'mkc-out') return 'Chose outcome: ' + arg.replace(/_/g, ' ');
    if (code === 'mkc-mode') return 'Switched to ' + taskLabel(arg);
    if (code === 'mkc-side-tab') return 'Opened the ' + (SIDE_TABS[arg] || arg) + ' tab';
    if (code === 'mkc-tx') return arg === 'stop' ? 'Stopped live notes' : 'Started live notes';
    if (code === 'mkc-chk') return 'Ticked a checklist item';
    if (code === 'mkc-stage') return 'Moved the call stage to ' + arg.replace(/_/g, ' ');
    if (code === 'mkc-tabk') return 'Opened ' + ({ texts: 'Texts', kit: 'Sales kit', script: 'Script' }[arg] || arg);
    if (ACT_LABELS[code]) return ACT_LABELS[code];
    if (!/^mkc-/.test(code)) return 'Pressed “' + d.slice(0, 40) + '”';
    return code.replace(/^mkc-/, '').replace(/[-_]/g, ' ').replace(/^./, function (c) { return c.toUpperCase(); }) + (arg ? ' (' + arg.replace(/_/g, ' ') + ')' : '');
  }
  function evText(x) {
    if (x.kind === 'action') return actionText(x.detail);
    var t = EV_LABELS[x.kind] || x.kind.replace(/_/g, ' ');
    if (x.kind === 'task_switch' || x.kind === 'start') return t + ': ' + taskLabel(String(x.detail || '').split(/\s/)[0]);
    if (x.kind === 'auto_fallback') { var ft = String(x.detail || '').split('>'); return 'List ran out: ' + taskLabel(ft[0]) + ' → ' + taskLabel(ft[1] || ''); }
    if (x.kind === 'end') return t + (x.detail ? ' (' + ({ exited: 'pressed Exit', dropped: 'dropped', replaced: 'new session started' }[x.detail] || x.detail) + ')' : '');
    if (x.kind === 'notes_error') return t + (x.detail ? ': ' + ({ 'not-allowed': 'mic not allowed', network: 'no internet' }[x.detail] || x.detail) : '');
    if (x.kind === 'idle_end') return 'Active again' + (/^\d+$/.test(String(x.detail || '')) ? ' after ' + hm(Number(x.detail)) + ' idle' : '');
    if (x.kind === 'route') return 'Script step: ' + String(x.detail || '').replace(/[_-]/g, ' ');
    return t + (x.detail && x.kind !== 'hidden' && x.kind !== 'visible' ? ' (' + String(x.detail).replace(/_/g, ' ') + ')' : (x.detail ? ' · ' + x.detail : ''));
  }
  var OUT_COLORS = { no_answer: '#94a3b8', callback: '#38bdf8', call_back: '#38bdf8', interested: '#22c55e', signed_up: '#16a34a', paid: '#16a34a', paid_now: '#16a34a', promised: '#f59e0b', rejected: '#ef4444', wont_pay: '#ef4444', not_interested: '#ef4444', wrong_number: '#a855f7', do_not_contact: '#64748b' };
  function outColor(k, i) { return OUT_COLORS[k] || ['#0ea5e9', '#8b5cf6', '#14b8a6', '#f97316', '#e11d48', '#84cc16'][i % 6]; }
  // Trend over finished periods (the current one is still running): last 3 vs the 3 before.
  function trendArrow(series, key) {
    var done = (series || []).slice(0, -1); if (done.length < 2) return '';
    var w = Math.min(3, Math.floor(done.length / 2)); var sum = function (a) { return a.reduce(function (t, r) { return t + (r[key] || 0); }, 0); };
    var cur = sum(done.slice(-w)); var prev = sum(done.slice(-2 * w, -w));
    var span = w + ' finished period' + (w === 1 ? '' : 's') + ' vs the ' + w + ' before';
    if (cur === prev) return '<span class="mkc-trend flat" title="' + span + '">→ steady</span>';
    var up = cur > prev; var pct = prev ? Math.round(Math.abs(cur - prev) / prev * 100) + '%' : 'new';
    return '<span class="mkc-trend ' + (up ? 'up' : 'down') + '" title="' + span + '">' + (up ? '▲' : '▼') + ' ' + pct + '</span>';
  }
  function periodLabel(k, unit) {
    var d = new Date(k + 'T12:00:00Z'); var M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    if (unit === 'month') return M[d.getUTCMonth()];
    return d.getUTCDate() + ' ' + M[d.getUTCMonth()];
  }
  function barChart(series, unit, key, color, fmt) {
    var W = 560, H = 150, P = 22, n = series.length || 1; var max = Math.max.apply(null, series.map(function (r) { return r[key] || 0; }).concat([1]));
    var bw = (W - P * 2) / n;
    var bars = series.map(function (r, i) {
      var v = r[key] || 0; var h = Math.round((H - P * 2) * v / max); var x = P + i * bw + bw * 0.15; var y = H - P - h;
      return '<g><rect x="' + x.toFixed(1) + '" y="' + y + '" width="' + (bw * 0.7).toFixed(1) + '" height="' + Math.max(h, v ? 2 : 0) + '" rx="3" fill="' + color + '"' + (i === n - 1 ? '' : ' opacity="0.75"') + '><title>' + esc(periodLabel(r.k, unit)) + ': ' + esc(fmt ? fmt(v) : String(v)) + '</title></rect>'
        + (v ? '<text x="' + (x + bw * 0.35).toFixed(1) + '" y="' + (y - 3) + '" text-anchor="middle" font-size="10" fill="#334155">' + esc(fmt ? fmt(v) : String(v)) + '</text>' : '')
        + ((n <= 8 || i % 2 === n % 2 || i === n - 1) ? '<text x="' + (x + bw * 0.35).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle" font-size="9" fill="#64748b">' + esc(periodLabel(r.k, unit)) + '</text>' : '') + '</g>';
    }).join('');
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="mkc-chart" role="img"><line x1="' + P + '" y1="' + (H - P) + '" x2="' + (W - P) + '" y2="' + (H - P) + '" stroke="#e2e8f0"/>' + bars + '</svg>';
  }
  function outcomeChart(series, unit) {
    var W = 560, H = 150, P = 22, n = series.length || 1; var keys = {};
    series.forEach(function (r) { Object.keys(r.outcomes || {}).forEach(function (k) { keys[k] = 1; }); }); keys = Object.keys(keys);
    var max = Math.max.apply(null, series.map(function (r) { return r.calls || 0; }).concat([1])); var bw = (W - P * 2) / n;
    var bars = series.map(function (r, i) {
      var y = H - P; var x = P + i * bw + bw * 0.15;
      return keys.map(function (k, j) { var v = (r.outcomes || {})[k] || 0; if (!v) return ''; var h = (H - P * 2) * v / max; y -= h; return '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + (bw * 0.7).toFixed(1) + '" height="' + h.toFixed(1) + '" fill="' + outColor(k, j) + '"><title>' + esc(periodLabel(r.k, unit)) + ' · ' + esc(k.replace(/_/g, ' ')) + ': ' + v + '</title></rect>'; }).join('')
        + ((n <= 8 || i % 2 === n % 2 || i === n - 1) ? '<text x="' + (x + bw * 0.35).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle" font-size="9" fill="#64748b">' + esc(periodLabel(r.k, unit)) + '</text>' : '');
    }).join('');
    var legend = keys.map(function (k, j) { return '<span class="mkc-leg"><i style="background:' + outColor(k, j) + '"></i>' + esc(k.replace(/_/g, ' ')) + '</span>'; }).join('');
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="mkc-chart" role="img"><line x1="' + P + '" y1="' + (H - P) + '" x2="' + (W - P) + '" y2="' + (H - P) + '" stroke="#e2e8f0"/>' + bars + '</svg><div class="mkc-legs">' + (legend || '<span class="mkc-muted">No calls in this range.</span>') + '</div>';
  }
  function callTip(c) {
    var ms = function (sec) { sec = Math.round(sec); return sec < 60 ? sec + 's' : Math.floor(sec / 60) + 'm ' + pad(sec % 60) + 's'; };
    return kTime(c.from) + '–' + kTime(c.to) + ' · ' + (c.talk_s == null ? 'talk not saved' : c.talk_s === 0 ? 'no talk' : 'talk ' + ms(c.talk_s)) + ' · ' + String(c.outcome || '').replace(/_/g, ' ') + ' · ' + (c.gap_s == null ? 'first call today' : 'gap since last call ' + hm(c.gap_s * 1000));
  }
  function onCallSummary(e) {
    var m = e.on_call && e.on_call.summary; if (!m || !(m.calls || m.not_answered || m.no_outcome)) return '<div class="mkc-muted" style="margin-top:6px" data-k-oncallsum>No calls tapped today.</div>';
    return '<div class="mkc-row" style="margin-top:6px;gap:6px;flex-wrap:wrap" data-k-oncallsum><span class="mkc-pill">📞 ' + m.calls + ' call' + (m.calls === 1 ? '' : 's') + '</span>' + (m.not_answered ? '<span class="mkc-pill" style="color:#64748b">Not answered: ' + m.not_answered + '</span>' : '') + (m.no_outcome ? '<span class="mkc-pill warn">No outcome saved: ' + m.no_outcome + '</span>' : '') + '<span class="mkc-pill">🗣 talk ' + hm(m.talk_s * 1000) + '</span>'
      + '<span class="mkc-pill">⏱ average gap ' + (m.avg_gap_s == null ? '–' : hm(m.avg_gap_s * 1000)) + '</span><span class="mkc-pill' + (m.longest_gap_s >= 900 ? ' warn' : '') + '">⏳ longest gap ' + (m.longest_gap_s == null ? '–' : hm(m.longest_gap_s * 1000) + ' (before ' + kTime(m.longest_gap_before) + ')') + '</span><span class="mkc-muted" style="font-size:11px">Gaps: from one call ending to the next Call now tap; breaks not counted.</span></div>';
  }
  // Session bars: green = on the screen, amber = switched away, grey = break, red end = dropped, blue = on a call.
  // Details come from an in-memory list (K.evTips) shown by one delegated pointer handler (bindEvBars): no per-element
  // listeners, no native <title> delay, no fetch, no re-render on hover.
  function sessionBars(e) {
    var ss = e.sessions || []; K.evTips = []; K.evGeo = {};
    if (!ss.length) return '<p class="mkc-muted">No sessions today.</p>';
    var tip = function (t) { K.evTips.push(t); return K.evTips.length - 1; };
    var t0 = Math.min.apply(null, ss.map(function (s) { return new Date(s.started_at).getTime(); }));
    var t1 = Math.max.apply(null, ss.map(function (s) { return new Date(s.ended_at || Date.now()).getTime(); }));
    t0 = Math.floor(t0 / 3600000) * 3600000; t1 = Math.max(Math.ceil(t1 / 3600000) * 3600000, t0 + 3600000);
    var W = 560, L = 16, R = 16, row = 18, H = ss.length * row + 26; var X = function (t) { return L + (W - L - R) * (t - t0) / (t1 - t0); };
    var f = function (v) { return v.toFixed(1); };
    var ticks = ''; for (var h = t0; h <= t1; h += 3600000) ticks += '<line x1="' + f(X(h)) + '" y1="0" x2="' + f(X(h)) + '" y2="' + (H - 16) + '" stroke="#f1f5f9"/><text x="' + f(X(h)) + '" y="' + (H - 4) + '" font-size="9" text-anchor="middle" fill="#64748b">' + esc(kTime(new Date(h).toISOString())) + '</text>';
    var allCalls = (e.on_call && e.on_call.calls) || []; K.evCallList = allCalls;
    var hits = '';
    // Busy day: widen the chart (it scrolls sideways) so most calls get at least 8 px to land on.
    var starts = {}; allCalls.forEach(function (c) { (starts[c.session_id] = starts[c.session_id] || []).push(X(new Date(c.from).getTime())); });
    var gapsU = []; Object.keys(starts).forEach(function (k) { var a2 = starts[k].sort(function (p1, p2) { return p1 - p2; }); for (var gi = 1; gi < a2.length; gi++) gapsU.push(a2[gi] - a2[gi - 1]); });
    gapsU.sort(function (p1, p2) { return p1 - p2; });
    var p10 = gapsU.length ? gapsU[Math.floor(gapsU.length * 0.1)] : 99;
    var minW = Math.min(3200, Math.max(560, Math.ceil(W * 8 / Math.max(p10, 0.1))));
    var wide = minW > 740;
    // A wide chart is drawn at its real pixel size (1 unit = 1 px): rows and labels keep their height.
    if (wide) { W = minW; ticks = ''; for (var h2 = t0; h2 <= t1; h2 += 3600000) ticks += '<line x1="' + f(X(h2)) + '" y1="0" x2="' + f(X(h2)) + '" y2="' + (H - 16) + '" stroke="#f1f5f9"/><text x="' + f(X(h2)) + '" y="' + (H - 4) + '" font-size="9" text-anchor="middle" fill="#64748b">' + esc(kTime(new Date(h2).toISOString())) + '</text>'; for (var h3 = t0 + 1800000; h3 < t1; h3 += 3600000) ticks += '<text x="' + f(X(h3)) + '" y="' + (H - 4) + '" font-size="8" text-anchor="middle" fill="#94a3b8">' + esc(kTime(new Date(h3).toISOString())) + '</text>'; }
    var bars = ss.map(function (s, i) {
      var a = new Date(s.started_at).getTime(); var b = new Date(s.ended_at || Date.now()).getTime(); var y = i * row + 4;
      var segs = '<rect x="' + f(X(a)) + '" y="' + y + '" width="' + f(Math.max(2, X(b) - X(a))) + '" height="14" rx="3" fill="#22c55e" data-tip="' + tip('Session ' + kTime(s.started_at) + '–' + (s.ended_at ? kTime(s.ended_at) : 'now') + ' · ' + (s.device || '') + ' · login ' + (s.actor_account || '?')) + '"/>';
      var evs = (e.events || []).filter(function (x) { return x.session_id === s.id; }); var away = null; var brk = null;
      evs.forEach(function (x) {
        var t = new Date(x.at).getTime();
        if (x.kind === 'hidden' && x.detail !== 'in meeting') away = t;
        if (x.kind === 'visible' && away != null) { segs += '<rect x="' + f(X(away)) + '" y="' + y + '" width="' + f(Math.max(1.5, X(t) - X(away))) + '" height="14" fill="#f59e0b" data-tip="' + tip('Switched away ' + kTime(new Date(away).toISOString()) + '–' + kTime(x.at) + ' · ' + hm(t - away)) + '"/>'; away = null; }
        if (x.kind === 'break_start') brk = t;
        if (x.kind === 'break_end' && brk != null) { segs += '<rect x="' + f(X(brk)) + '" y="' + y + '" width="' + f(Math.max(1.5, X(t) - X(brk))) + '" height="14" fill="#94a3b8" data-tip="' + tip('Break ' + kTime(new Date(brk).toISOString()) + '–' + kTime(x.at) + ' · ' + hm(t - brk)) + '"/>'; brk = null; }
      });
      if (away != null) segs += '<rect x="' + f(X(away)) + '" y="' + y + '" width="' + f(Math.max(1.5, X(b) - X(away))) + '" height="14" fill="#f59e0b" data-tip="' + tip('Switched away until the end') + '"/>';
      // Calls in this session, in time order; each gets an invisible hit area of at least 8 units (≈8–11 px),
      // stretched over its wrap-up tick and clipped halfway to its neighbours so hits never overlap.
      var mine = []; allCalls.forEach(function (c, ci) { if (c.session_id === s.id) mine.push({ c: c, ci: ci, x0: X(new Date(c.from).getTime()), x1: X(new Date(c.to).getTime()), xw: c.wrapped_at ? X(new Date(c.wrapped_at).getTime()) : null }); });
      mine.sort(function (p, q2) { return p.x0 - q2.x0; });
      mine.forEach(function (m, k) {
        var w = Math.max(2.5, m.x1 - m.x0); var end = Math.max(m.x0 + w, m.xw || 0);
        segs += '<rect class="mkc-oncall" data-k-call="' + m.ci + '" x="' + f(m.x0) + '" y="' + (y + 2) + '" width="' + f(w) + '" height="10" rx="1.5" fill="' + (m.c.outcome === 'no_answer' ? '#cbd5e1' : '#1d4ed8') + '"/>';
        if (m.xw != null) segs += '<line x1="' + f(m.xw) + '" y1="' + (y - 1) + '" x2="' + f(m.xw) + '" y2="' + (y + 15) + '" stroke="#0f172a" stroke-width="0.8" opacity="0.7"/>';
        var mid = (m.x0 + end) / 2; var hl = Math.min(m.x0, mid - 4); var hr = Math.max(end, mid + 4);
        var prevM = mine[k - 1]; var nextM = mine[k + 1];
        if (prevM) hl = Math.max(hl, (Math.max(prevM.x0 + 2.5, prevM.x1, prevM.xw || 0) + m.x0) / 2);
        if (nextM) hr = Math.min(hr, (end + nextM.x0) / 2);
        hl = Math.min(hl, m.x0); hr = Math.max(hr, m.x0 + w);
        K.evGeo[m.ci] = { x: m.x0, y: y + 2, w: w };
        hits += '<rect class="mkc-hit" data-k-callhit="' + m.ci + '" data-tip="' + tip('📞 ' + callTip(m.c) + (m.c.wrapped_at ? ' · wrap-up saved ' + kTime(m.c.wrapped_at) : '')) + '" x="' + f(hl) + '" y="' + (y - 2) + '" width="' + f(Math.max(1, hr - hl)) + '" height="18" fill="transparent" pointer-events="all"/>';
      });
      if (s.end_reason === 'dropped') segs += '<rect x="' + f(X(b) - 3) + '" y="' + (y - 2) + '" width="5" height="18" fill="#dc2626" data-tip="' + tip('Dropped at ' + kTime(s.ended_at)) + '"/>';
      return segs;
    }).join('');
    return (wide ? '<div class="mkc-muted" style="font-size:11px;margin:0 0 4px">Busy day: the chart is wider so every call is easy to point at. Scroll sideways ↔</div>' : '')
      + '<div class="mkc-evbarsbox" data-k-evbarsbox><div class="mkc-evbarswrap"><svg viewBox="0 0 ' + W + ' ' + H + '" class="mkc-chart mkc-evbars" role="img" data-k-evbars' + (wide ? ' style="width:' + Math.round(W * 1.3) + 'px;height:' + Math.round(H * 1.3) + 'px;max-width:none;min-width:0"' : '') + '>' + ticks + bars
      + '<rect data-k-hl x="0" y="0" width="0" height="10" fill="none" stroke="#facc15" stroke-width="1.6" pointer-events="none" visibility="hidden"/>' + hits + '</svg></div>'
      + '<div class="mkc-evtip" data-k-tip hidden></div></div>'
      + '<div class="mkc-legs"><span class="mkc-leg"><i style="background:#22c55e"></i>On the screen</span><span class="mkc-leg"><i style="background:#1d4ed8"></i>On a call</span><span class="mkc-leg"><i style="background:#cbd5e1"></i>No answer (not counted)</span><span class="mkc-leg"><i style="background:#0f172a;width:2px"></i>Wrap-up saved</span><span class="mkc-leg"><i style="background:#f59e0b"></i>Switched away</span><span class="mkc-leg"><i style="background:#94a3b8"></i>Break</span><span class="mkc-leg"><i style="background:#dc2626"></i>Dropped</span></div>' + onCallSummary(e) + '<div class="mkc-muted" style="font-size:12px;min-height:16px" data-k-callinfo>' + (allCalls.length ? 'Tap or hover a blue call to see its details.' : '') + '</div>';
  }
  // One delegated pointer handler for the whole chart, throttled to one update per animation frame.
  function bindEvBars(el) {
    var box = q('[data-k-evbarsbox]', el); if (!box) return;
    var svg = q('[data-k-evbars]', box); var tipEl = q('[data-k-tip]', box); var hl = q('[data-k-hl]', box); var info = q('[data-k-callinfo]', el);
    var cur = -1; var last = null; var raf = 0; var pinned = false; var dirty = false;
    var apply = function () {
      if (!last) return;
      var t = last.target && last.target.closest ? last.target.closest('[data-tip]') : null;
      if (!t) { if (!pinned) hide(); return; }
      var idx = Number(t.getAttribute('data-tip'));
      var r = box.getBoundingClientRect(); var x = last.x - r.left; var y = last.y - r.top;
      if (idx !== cur) {
        cur = idx; tipEl.textContent = K.evTips[idx] || ''; tipEl.hidden = false;
        var ci = t.getAttribute('data-k-callhit'); var g = ci != null ? K.evGeo[ci] : null;
        if (g) { hl.setAttribute('x', g.x - 0.8); hl.setAttribute('y', g.y - 0.8); hl.setAttribute('width', g.w + 1.6); hl.setAttribute('height', 11.6); hl.setAttribute('visibility', 'visible'); K.evCall = ci; if (info) info.textContent = K.evTips[idx]; } else hl.setAttribute('visibility', 'hidden');
      }
      var left = x > r.width * 0.6;
      tipEl.style.transform = 'translate3d(' + Math.round(left ? x - 12 : x + 14) + 'px,' + Math.round(y + 16) + 'px,0)' + (left ? ' translateX(-100%)' : '');
      K.evHover = { x: last.x, y: last.y };
    };
    var hide = function () { cur = -1; tipEl.hidden = true; hl.setAttribute('visibility', 'hidden'); K.evHover = null; };
    // Frame throttle: the first move in a frame (or onto a new segment) updates at once; other moves in the same
    // frame are folded into one reposition on the next animation frame.
    var tick = function () { if (dirty) { dirty = false; apply(); raf = requestAnimationFrame(tick); } else raf = 0; };
    svg.addEventListener('pointermove', function (ev) {
      if (ev.pointerType === 'touch') return;
      last = { x: ev.clientX, y: ev.clientY, target: ev.target };
      // A new segment under the pointer always shows at once; moves within the same segment only reposition, once per frame.
      var tt = ev.target && ev.target.closest ? ev.target.closest('[data-tip]') : null;
      var changed = (tt ? Number(tt.getAttribute('data-tip')) : -1) !== cur;
      if (raf && !changed) { dirty = true; return; }
      dirty = false; apply(); if (!raf) raf = requestAnimationFrame(tick);
    }, { passive: true });
    svg.addEventListener('pointerleave', function () { last = null; dirty = false; if (raf) { cancelAnimationFrame(raf); raf = 0; } if (!pinned) hide(); K.evHovering = false; flushEvPending(); });
    svg.addEventListener('pointerenter', function (ev) { if (ev.pointerType !== 'touch') K.evHovering = true; });
    // Tap (mobile) or click: show at once and keep it until the next tap elsewhere.
    // King: a click on a blue call opens that call's detail (transcript, outcome, lessons) when the King desk is loaded.
    svg.addEventListener('click', function (ev) {
      var h = ev.target && ev.target.closest ? ev.target.closest('[data-k-callhit]') : null; if (!h) return;
      var c = (K.evCallList || [])[Number(h.getAttribute('data-k-callhit'))];
      if (c && c.attempt_id && window.kingTeam && typeof window.kingTeam.openCall === 'function') window.kingTeam.openCall(c.attempt_id);
    });
    svg.addEventListener('pointerdown', function (ev) { last = { x: ev.clientX, y: ev.clientY, target: ev.target }; cur = -1; apply(); pinned = !!(last.target.closest && last.target.closest('[data-tip]')); });
    box.__restore = function (pt, call) {
      if (pt) { var t = document.elementFromPoint(pt.x, pt.y); if (t && svg.contains(t)) { last = { x: pt.x, y: pt.y, target: t }; apply(); return; } }
      if (call != null) { var h = q('[data-k-callhit="' + call + '"]', svg); if (h) { var b = h.getBoundingClientRect(); last = { x: b.left + b.width / 2, y: b.top + b.height / 2, target: h }; apply(); pinned = true; } }
    };
  }
  function flushEvPending() { var p = K.evPending; if (p && !K.evHovering) { K.evPending = null; p(); } }
  // Plain-English timeline: runs of screen actions fold into one line that opens to show each step.
  function timelineHtml(e) {
    var evs = (e.events || []).slice(); var out = []; var run = [];
    var flush = function () { if (!run.length) return; if (run.length === 1) out.push('<li><b>' + esc(kTime(run[0].at)) + '</b> ' + esc(evText(run[0])) + '</li>'); else out.push('<li><details><summary><b>' + esc(kTime(run[0].at)) + '–' + esc(kTime(run[run.length - 1].at)) + '</b> ' + run.length + ' steps on the screen: ' + esc(run.slice(0, 3).map(evText).join(', ')) + (run.length > 3 ? '…' : '') + '</summary><ul>' + run.map(function (x) { return '<li>' + esc(kTime(x.at)) + ' ' + esc(evText(x)) + '</li>'; }).join('') + '</ul></details></li>'); run = []; };
    evs.forEach(function (x) {
      if (x.kind === 'action' || x.kind === 'route' || x.kind === 'notes_start' || x.kind === 'notes_stop') { run.push(x); return; }
      flush();
      var warn = x.kind === 'hidden' || x.kind === 'fs_exit' || x.kind === 'screen_close' || (x.kind === 'end' && x.detail === 'dropped');
      out.push('<li' + (warn ? ' class="warn"' : '') + '><b>' + esc(kTime(x.at)) + '</b> ' + esc(evText(x)) + '</li>');
    });
    flush();
    return out.length ? '<ul class="mkc-evtl" data-k-evtl>' + out.join('') + '</ul>' : '<p class="mkc-muted">Nothing logged today.</p>';
  }
  function outcomeCell(a) {
    if (a.status === 'done') return '<b>' + esc(String(a.outcome || '').replace(/_/g, ' ')) + '</b>' + (a.is_close && (a.outcome === 'paid' || a.outcome === 'renewed') ? ' <span class="mkc-good">✓ paid (closed)</span>' : '');
    if (a.status === 'skipped') return 'Skipped' + (a.skip_reason ? ': ' + esc(a.skip_reason) : '');
    if (a.status === 'released') return '<span class="mkc-muted">Not called (released when switching)</span>';
    if (a.status === 'shown') return '<span class="mkc-muted">On screen now</span>';
    if (a.tapped_at) return '<span class="mkc-flag">⚠ No outcome saved</span>';
    return '<span class="mkc-flag">⚠ No outcome saved</span><div class="mkc-muted" style="font-size:11px">' + esc(String(a.status || '').replace(/_/g, ' ')) + ' · not tapped</div>';
  }
  // Evidence stays live: refreshes every 30 s while open and the tab is visible; paused when hidden.
  var EV_REFRESH_MS = 30000;
  function stopEvAuto() { if (K.evTimer) { clearInterval(K.evTimer); K.evTimer = null; } }
  function evPanelOpen(host, person) { var el = q('[data-k-evbox]', host); return !!(el && K.open === person && document.body.contains(el) && q('[data-k-ev2]', el)); }
  function startEvAuto(host, person) {
    stopEvAuto();
    K.evTimer = setInterval(function () {
      if (!evPanelOpen(host, person)) { stopEvAuto(); return; }
      if (document.hidden || K.evBusy) return;
      openEvidence(host, person, true, true);
    }, EV_REFRESH_MS);
    if (!K.evVisBound) {
      K.evVisBound = true;
      document.addEventListener('visibilitychange', function () {
        if (document.hidden || !K.evHost || !K.open || !evPanelOpen(K.evHost, K.open)) return;
        if (Date.now() - (K.evAt || 0) >= EV_REFRESH_MS) openEvidence(K.evHost, K.open, true, true);
      });
    }
  }
  function clockSecs(d) { try { return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Africa/Kampala' }).format(d); } catch (x) { return ''; } }
  function openEvidence(host, person, keep, silent, data) {
    var el = q('[data-k-evbox]', host);
    if (!keep && K.open === person && el.innerHTML) { K.open = null; el.innerHTML = ''; stopEvAuto(); return; }
    K.open = person; K.evHost = host;
    // Keep what King was looking at across a refresh: opened timeline groups, the chosen call, the chart scroll.
    var prev = silent ? { open: qa('[data-k-evtl] details', el).map(function (d) { return d.open; }), call: K.evCall, hover: K.evHover, sx: (q('.mkc-evbarswrap', el) || {}).scrollLeft || 0 } : null;
    if (!silent) el.innerHTML = '<p class="mkc-muted">Loading evidence…</p>';
    K.evBusy = true;
    var lbl = q('[data-k-evupd]', el); if (lbl && silent) lbl.textContent = 'Updating…';
    (data ? Promise.resolve(data) : api('/evidence?person_key=' + encodeURIComponent(person))).then(function (e) {
      K.evBusy = false;
      if (K.open !== person) return;
      K.evAt = Date.now();
      // Auto-refresh keeps the DOM when nothing changed, and never rebuilds under the pointer: it waits for pointerleave.
      var sig = JSON.stringify(e) + '|' + (K.evUnit || 'day');
      var lbl0 = q('[data-k-evupd]', el);
      if (silent && sig === K.evSig && q('[data-k-ev2]', el)) { if (lbl0) lbl0.textContent = '🟢 Updated ' + clockSecs(new Date()) + ' Kampala · auto every 30s'; startEvAuto(host, person); return; }
      if (silent && K.evHovering && !data && q('[data-k-ev2]', el)) { if (lbl0) lbl0.textContent = '🟡 New data · shows when you move off the chart'; K.evPending = function () { openEvidence(host, person, true, true, e); }; return; }
      K.evSig = sig; K.evPending = null;
      var unit = K.evUnit || 'day'; var tr = (e.trends || {})[unit] || [];
      var sm = e.summary || { calls: 0, connected: 0, closes: 0, talk_s: 0 };
      var trendNote = { day: 'Trend: last 3 full days vs the 3 before', week: 'Trend: last 3 full weeks vs the 3 before', month: 'Trend: last 3 full months vs the 3 before' }[unit];
      var kpi = function (label, val, key) { return '<div class="mkc-evkpi"><div class="v">' + val + '</div><div class="l">' + label + '</div><div class="s">' + (trendArrow(tr, key) || '<span class="mkc-muted">no trend yet</span>') + '</div></div>'; };
      var cur = tr[tr.length - 1] || {};
      var unitName = { day: 'today', week: 'this week', month: 'this month' }[unit];
      var logins = (e.logins || []).map(function (l) { return '<span class="mkc-pill' + (/moderator/i.test(l.login) ? ' warn' : '') + '">🔑 ' + esc(l.login) + ' · ' + l.sessions + ' session' + (l.sessions === 1 ? '' : 's') + ' · ' + l.calls + ' call' + (l.calls === 1 ? '' : 's') + '</span>'; }).join(' ');
      var shared = (e.logins || []).some(function (l) { return /moderator/i.test(l.login); });
      var drops = (e.dropoffs || []).map(function (d) { return '<li class="' + (d.kind === 'no_outcome' || d.kind === 'dropped' ? 'bad' : '') + '"><b>' + esc(kTime(d.at)) + '</b> ' + esc(d.title) + '<div class="mkc-muted">' + esc(d.why) + '</div></li>'; }).join('');
      var audit = (e.audit || []).map(function (c) { return '<li class="' + (c.ok ? 'ok' : 'bad') + '">' + (c.ok ? '✅' : '⚠️') + ' ' + esc(c.label) + ' <span class="mkc-muted">' + (c.total ? (c.total - c.missing) + '/' + c.total : 'nothing to check yet') + (c.note ? ' · ' + esc(c.note) : '') + '</span></li>'; }).join('');
      var released = (e.attempts || []).filter(function (a) { return a.status === 'released'; }).length;
      var rowsHtml = (e.attempts || []).filter(function (a) { return a.status !== 'released'; }).map(function (a) {
        var fl = (a.flags || []).map(function (f) { return '<span class="mkc-flag">' + esc((e.flag_labels || {})[f] || f) + '</span>'; }).join(' ');
        return '<tr' + (a.tapped_at && a.status !== 'done' && a.status !== 'skipped' ? ' class="bad"' : '') + '><td>' + esc(kTime(a.tapped_at || a.shown_at)) + '</td><td>' + esc(taskLabel(a.task_key)) + '</td><td>' + esc(a.name || '') + ' <span class="mkc-muted">' + esc(a.phone) + '</span></td><td>' + outcomeCell(a) + '</td><td>' + (a.talk_s == null ? '–' : hm(a.talk_s * 1000)) + '</td><td>' + esc(a.note || '') + (a.next_step ? '<div><b>Next:</b> ' + esc(a.next_step) + '</div>' : '') + (a.transcript_summary ? '<div class="mkc-muted">🎙 ' + esc(a.transcript_summary) + '</div>' : '') + '</td><td class="mkc-muted">' + esc(a.login || 'not recorded') + '</td><td>' + fl + ' <button type="button" class="mkc-btn sm ghost" data-k-tree="' + esc(a.id) + '">Tree</button></td></tr>';
      }).join('');
      el.innerHTML = '<div class="mkc-panel mkc-ev2" style="margin-top:12px;background:#f8fafc" data-k-ev2>'
        + '<div class="mkc-row" style="justify-content:space-between"><h4 style="margin:0">Evidence trail · ' + esc(personName(person)) + ' · ' + esc(e.day || '') + '</h4><span class="mkc-row" style="gap:6px;align-items:center"><span class="mkc-muted" style="font-size:12px" data-k-evupd title="Refreshes every 30 seconds while this is open; paused when the tab is hidden">🟢 Updated ' + esc(clockSecs(new Date())) + ' Kampala · auto every 30s</span><button type="button" class="mkc-btn sm ghost" data-k-evrefresh title="Refresh now">⟳ Refresh</button><button type="button" class="mkc-btn sm ghost" data-k-evx>Close</button></span></div>'
        + '<div class="mkc-evsec"><b>Counted for:</b> ' + esc(personName(person)) + ' · <b>Logins used today:</b> ' + (logins || '<span class="mkc-muted">none</span>') + (shared ? '<div class="mkc-flag" style="display:inline-block;margin-top:4px">Shared login used: calls still count for the caller picked on the screen. Give each caller their own login.</div>' : '') + '</div>'
        + '<div class="mkc-row" style="margin:8px 0;gap:6px" data-k-evunit>' + ['day', 'week', 'month'].map(function (u) { return '<button type="button" class="mkc-chip' + (u === unit ? ' on' : '') + '" data-k-evu="' + u + '">' + ({ day: 'Day by day', week: 'Week by week', month: 'Month by month' }[u]) + '</button>'; }).join('') + '</div>'
        + '<div class="mkc-evkpis" data-k-evsum>' + kpi('Calls ' + unitName, cur.calls || 0, 'calls') + kpi('Not answered ' + unitName, cur.not_answered || 0, 'not_answered') + kpi('Talk time ' + unitName, hm((cur.talk_s || 0) * 1000), 'talk_s') + kpi('Spoke to ' + unitName, cur.connected || 0, 'connected') + kpi('Closes ' + unitName, cur.closes || 0, 'closes') + '</div><div class="mkc-muted" style="font-size:11px;margin-top:3px">' + trendNote + '. ▲ up · ▼ down.</div>'
        + '<div class="mkc-evgrid"><div class="mkc-evcard"><h5>Calls</h5>' + barChart(tr, unit, 'calls', '#0ea5e9') + '</div><div class="mkc-evcard"><h5>Talk time</h5>' + barChart(tr, unit, 'talk_s', '#8b5cf6', function (v) { return hm(v * 1000); }) + '</div>'
        + '<div class="mkc-evcard"><h5>Outcomes</h5>' + outcomeChart(tr, unit) + '</div><div class="mkc-evcard"><h5>Closes</h5>' + barChart(tr, unit, 'closes', '#16a34a') + '</div></div>'
        + '<div class="mkc-evcard" style="margin-top:10px"><h5>Today\'s sessions</h5>' + sessionBars(e) + '<div data-k-evtime style="margin-top:6px">' + taskTimeHtml(e.task_ms) + '</div></div>'
        + '<div class="mkc-evgrid"><div class="mkc-evcard" data-k-evdrops><h5>Drop-offs ' + ((e.dropoffs || []).length ? '<span class="mkc-flag">' + e.dropoffs.length + '</span>' : '') + '</h5>' + (drops ? '<ul class="mkc-evtl">' + drops + '</ul>' : '<p class="mkc-good">No drop-offs today.</p>') + '</div>'
        + '<div class="mkc-evcard" data-k-evaudit><h5>Are we tracking everything?</h5><ul class="mkc-audit">' + audit + '</ul></div></div>'
        + '<div class="mkc-evcard" style="margin-top:10px"><h5>Timeline (plain English)</h5>' + timelineHtml(e) + '</div>'
        + '<div class="mkc-evcard" style="margin-top:10px"><h5>Every call today</h5><p class="mkc-muted" style="margin:0 0 6px">Check these against the company phone\'s call log: every tap has a time.' + (released ? ' ' + released + ' number' + (released === 1 ? ' was' : 's were') + ' shown but not called (put back when switching task); not listed.' : '') + '</p><div class="mkc-scroll"><table class="mkc-table" data-k-evcalls><tr><th>Time</th><th>Task</th><th>Who</th><th>Outcome</th><th>Talk</th><th>Note · next step</th><th>Login</th><th></th></tr>' + (rowsHtml || '<tr><td colspan="8" class="mkc-muted">No calls.</td></tr>') + '</table></div></div></div>';
      q('[data-k-evx]', el).onclick = function () { K.open = null; el.innerHTML = ''; stopEvAuto(); };
      var rf = q('[data-k-evrefresh]', el); if (rf) rf.onclick = function () { openEvidence(host, person, true, true); };
      bindEvBars(el);
      if (prev) {
        qa('[data-k-evtl] details', el).forEach(function (d, i) { if (prev.open[i]) d.open = true; });
        var wrapEl = q('.mkc-evbarswrap', el); if (wrapEl) wrapEl.scrollLeft = prev.sx;
        var bx = q('[data-k-evbarsbox]', el); if (bx && bx.__restore) bx.__restore(prev.hover, prev.call);
      }
      startEvAuto(host, person);
      qa('[data-k-evu]', el).forEach(function (b) { b.onclick = function () { K.evUnit = b.getAttribute('data-k-evu'); openEvidence(host, person, true); }; });
      qa('[data-k-tree]', el).forEach(function (b) { b.onclick = function () { openTimeline({ attempt_id: b.getAttribute('data-k-tree') }); }; });
    }, function (err) { K.evBusy = false; if (silent && q('[data-k-ev2]', el)) { var l = q('[data-k-evupd]', el); if (l) l.textContent = '⚠ Could not refresh (' + err.message + '). Retrying in 30s.'; return; } el.innerHTML = '<div class="mkc-err">' + esc(err.message) + '</div>'; });
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
  window.makaugCalling = {
    rescan: scan,
    refreshKing: function () { var k = q('[data-calling-king-root]'); if (k) renderKing(k); },
    // The King per-staff page shows this same evidence trail (sessions graph, auto-refresh every 30s).
    evidence: function (host, person) { injectCss(); return loadBoot().then(function () { K.open = null; openEvidence(host, person, true); }); },
    closeEvidence: function () { K.open = null; stopEvAuto(); },
    // Staff sidebar "Connect your phone" item opens the same guide.
    openConnect: function (guide) { injectCss(); return loadBoot().then(function () { openConnect(guide || 'bt'); }); },
    // Staff desk: answer calls that were dialled but never given an outcome.
    openOwed: function (done) { injectCss(); return loadBoot().then(function () { openOwed(done); }); },
    // Staff desk pipeline: the full contact history of one of my calls.
    openHistory: function (attemptId) { injectCss(); return loadBoot().then(function () { openTimeline({ attempt_id: attemptId }); }); }
  };
})();
