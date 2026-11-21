/* Staff desk (Arthur, 21 Nov 2026).
 * A sidebar for every staff login and a "Good morning <name>" home: today's
 * numbers against targets, this week vs last week, this month vs last month,
 * today's checklist and day planner, and a "behind" nudge (King sees it too).
 * Plus My performance, My pay, Connect your phone, Profile (photo, private ID)
 * and Settings. Everything is the signed-in person's own data.
 * The old staff sections stay where they are in the page; the sidebar only
 * shows or hides them, so the calling screen is never moved or reloaded. */
(function () {
  'use strict';
  if (window.staffDesk) return;
  var S = { mounted: false, page: '', scope: '', home: null, homeErr: '', timer: null, busy: false };
  var KMS = 3 * 3600000;
  function q(sel, root) { return (root || document).querySelector(sel); }
  function qa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function n(v) { return Number(v || 0); }
  function fmt(v) { return n(v).toLocaleString('en-GB'); }
  function ugx(v) { return 'UGX ' + fmt(v); }
  function pad(x) { return (x < 10 ? '0' : '') + x; }
  function dur(s) { s = Math.round(n(s)); if (s < 60) return s + 's'; var m = Math.round(s / 60); return m < 60 ? m + ' min' : Math.floor(m / 60) + 'h ' + pad(m % 60); }
  function niceDay(day) { if (!day) return ''; var p = String(day).slice(0, 10).split('-'); var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }); }
  function monthName(day) { var p = String(day || '').split('-'); if (p.length < 2) return ''; return new Date(Date.UTC(+p[0], +p[1] - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }); }
  function api(path, opts) {
    opts = opts || {};
    var h = { Accept: 'application/json' };
    if (typeof window.adminAuthHeaders === 'function') { try { Object.assign(h, window.adminAuthHeaders()); } catch (x) { /* cookie auth */ } }
    if (opts.body) h['Content-Type'] = 'application/json';
    return fetch((opts.root || '/api/admin') + path, { method: opts.method || 'GET', credentials: 'same-origin', headers: h, body: opts.body ? JSON.stringify(opts.body) : undefined }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok || j.ok === false) { var e = new Error(j.error || j.message || ('Error ' + r.status)); e.status = r.status; throw e; } return j.data !== undefined ? j.data : j; });
    });
  }

  // ------------------------------------------------------------ pages ----
  // [id, icon, label, sections of the old page it shows, staff (not caller) only]
  var NAV = [
    ['Today', [['home', '🏠', 'Dashboard'], ['calls', '📞', 'Calls', ['staff-calling-card']], ['perf', '📈', 'My performance']]],
    ['Work', [['review', '🏡', 'Properties to review', ['staff-booking-escalations', 'staff-review-grid'], 1], ['stays', '🛏️', 'Short stays', ['staff-short-term-control', 'staff-video-caption-conflicts'], 1],
      ['leads', '💬', 'Leads & WhatsApp', ['staff-home-seekers', 'staff-leads-grid'], 1], ['harvest', '🔎', 'Harvest', ['staff-source-panel'], 1], ['tools', '🧰', 'Desk tools', ['staff-king-tools'], 1], ['howto', '🎓', 'How to', ['staff-training-panel'], 1]]],
    ['Me', [['pay', '💰', 'My pay'], ['connect', '📱', 'Connect your phone'], ['profile', '🪪', 'Profile'], ['settings', '⚙️', 'Settings', ['staff-settings-panel']]]]
  ];
  var KNOWN = ['staff-calling-card', 'staff-booking-escalations', 'staff-header-card', 'staff-short-term-control', 'staff-video-caption-conflicts', 'staff-settings-panel', 'staff-kpi-grid', 'staff-review-grid', 'staff-source-panel', 'staff-leads-grid', 'staff-home-seekers', 'staff-king-tools', 'staff-training-panel'];
  var NEW_PAGES = ['home', 'perf', 'pay', 'profile', 'settings'];
  function items() { var out = []; NAV.forEach(function (g) { g[1].forEach(function (i) { out.push(i); }); }); return out; }
  function item(id) { return items().filter(function (i) { return i[0] === id; })[0]; }
  function allowed(i) { return !(i[4] && S.scope === 'caller'); }
  function css() {
    var out = [
      'body.sd-on #staff-hero{display:none!important}',
      // Staff desk is its own app: no public site header, language strip, footer or WhatsApp bubble.
      'body.sd-on > .mk-top-strip,body.sd-on > nav,body.sd-on > #language-spotlight,body.sd-on > footer,body.sd-on > #floating-whatsapp-link{display:none!important}',
      // One source per number: the old KPI tiles disagreed with the pages they summarise.
      'body.sd-on #staff-kpi-grid{display:none!important}',
      // Ops-only monitor detail (schedule, raw health codes, CLI commands) belongs to the King, not the desk.
      'body.sd-on #staff-source-monitor-status,body.sd-on #staff-source-monitor-health,body.sd-on #staff-source-monitor-window,body.sd-on #staff-source-monitor-cadence,body.sd-on #staff-source-monitor-rules,body.sd-on #staff-source-monitor-card > details{display:none!important}',
      'body.sd-on #page-staff-dashboard > .max-w-6xl{max-width:none;margin:0 0 0 256px;padding:20px 24px 48px}',
      // Every old section is hidden unless the open page lists it.
      'body.sd-on #staff-body > :not(#' + KNOWN.join('):not(#') + '){display:none!important}',
      'body.sd-on #staff-body > #staff-header-card{display:none!important}',
      'body.sd-on #staff-body{margin-top:0}',
      'body.sd-on:not([data-sd-page="' + NEW_PAGES.join('"]):not([data-sd-page="') + '"]) #sd-pages{display:none!important}',
      '#sd-side{position:fixed;left:0;top:var(--sd-top,64px);bottom:var(--sd-bot,0px);width:244px;background:#10291f;color:#e2f0e8;overflow:auto;z-index:40;padding:12px 10px 20px;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;display:none}',
      'body.sd-on #sd-side{display:block}',
      '#sd-side .sd-me{display:flex;gap:10px;align-items:center;background:rgba(255,255,255,.07);border-radius:14px;padding:10px;margin-bottom:8px;cursor:pointer}',
      '.sd-av{width:36px;height:36px;border-radius:50%;background:#15603f;display:grid;place-items:center;font-weight:900;color:#fff;overflow:hidden;flex:0 0 auto}.sd-av img{width:100%;height:100%;object-fit:cover}',
      '#sd-side .sd-g{font-size:11px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;color:#86b39a;margin:14px 8px 6px}',
      '#sd-side button.sd-i{display:flex;align-items:center;gap:10px;width:100%;text-align:left;background:none;border:0;color:#e2f0e8;padding:9px 10px;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer}',
      '#sd-side button.sd-i:hover{background:rgba(255,255,255,.08)}#sd-side button.sd-i.on{background:#15603f;color:#fff}',
      '#sd-side .sd-b{margin-left:auto;background:#f59e0b;color:#111;border-radius:999px;font-size:11px;font-weight:900;padding:1px 8px}',
      '#sd-side .sd-foot{margin-top:16px;border-top:1px solid rgba(255,255,255,.1);padding-top:10px}',
      '#sd-top{display:none}',
      '@media(max-width:1023px){body.sd-on #page-staff-dashboard > .max-w-6xl{margin-left:0;padding:12px 12px 40px}#sd-side{width:82vw;max-width:300px;transform:translateX(-105%);transition:transform .2s;box-shadow:0 0 40px rgba(0,0,0,.4)}body.sd-on.sd-drawer #sd-side{transform:none}',
      'body.sd-on #sd-top{display:flex;position:sticky;top:var(--sd-top,64px);z-index:39;align-items:center;gap:10px;background:#10291f;color:#fff;padding:10px 12px;margin:-12px -12px 12px;font-weight:800}#sd-top button{background:#15603f;border:0;color:#fff;border-radius:10px;padding:8px 12px;font-weight:900;font-size:16px}',
      '#sd-scrim{display:none}body.sd-on.sd-drawer #sd-scrim{display:block;position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:38}}',
      '.sd-page{font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a}',
      '.sd-h1{font-size:26px;font-weight:900;margin:0;line-height:1.2}.sd-sub{color:#64748b;font-size:13px;margin:4px 0 0}',
      '.sd-card{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:14px}.sd-card h3{font-size:16px;font-weight:900;margin:0 0 10px}',
      '.sd-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:14px 0}@media(max-width:900px){.sd-kpis{grid-template-columns:repeat(2,1fr)}}',
      '.sd-kpi{display:flex;gap:12px;align-items:center}.sd-kpi .l{font-size:12px;color:#64748b;font-weight:700}.sd-kpi .v{font-size:24px;font-weight:900}.sd-kpi .t{font-size:12px;color:#64748b}',
      '.sd-grid2{display:grid;grid-template-columns:1.3fr 1fr;gap:12px;margin-bottom:12px}@media(max-width:900px){.sd-grid2{grid-template-columns:1fr}}',
      '.sd-banner{border-radius:14px;padding:12px 14px;display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin-top:12px;font-weight:700;font-size:14px}',
      '.sd-banner.behind{background:#fff7ed;border:1px solid #fdba74;color:#9a3412}.sd-banner.ok{background:#f0fdf4;border:1px solid #bbf7d0;color:#166534}.sd-banner.info{background:#eff6ff;border:1px solid #bfdbfe;color:#1e3a8a}',
      '.sd-btn{border:0;border-radius:10px;padding:9px 14px;font-weight:800;font-size:13px;cursor:pointer;background:#15603f;color:#fff}.sd-btn.ghost{background:#f1f5f9;color:#0f172a}.sd-btn:disabled{opacity:.6;cursor:wait}',
      '.sd-check{list-style:none;margin:0;padding:0}.sd-check li{display:flex;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:14px}.sd-check li:last-child{border:0}',
      '.sd-dot{width:22px;height:22px;border-radius:50%;display:grid;place-items:center;font-size:12px;font-weight:900;flex:0 0 auto}.sd-dot.done{background:#dcfce7;color:#166534}.sd-dot.now{background:#dbeafe;color:#1d4ed8}.sd-dot.missed{background:#ffe4e6;color:#be123c}.sd-dot.todo{background:#f1f5f9;color:#64748b}',
      '.sd-check .p{margin-left:auto;font-weight:800;color:#334155;font-size:13px;white-space:nowrap}.sd-check .w{font-size:12px;color:#64748b}',
      '.sd-plan{display:grid;gap:6px}.sd-blk{display:grid;grid-template-columns:92px 1fr auto;gap:10px;align-items:center;border-radius:12px;padding:8px 10px;background:#f8fafc;font-size:13px}.sd-blk.now{background:#ecfdf5;outline:2px solid #15603f}.sd-blk.past{opacity:.7}',
      '.sd-bar{height:8px;background:#e2e8f0;border-radius:999px;overflow:hidden}.sd-bar i{display:block;height:100%;background:#15603f}',
      '.sd-table{width:100%;border-collapse:collapse;font-size:13px}.sd-table th{text-align:left;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;padding:6px 4px;border-bottom:1px solid #e2e8f0}.sd-table td{padding:8px 4px;border-bottom:1px solid #f1f5f9}',
      '.sd-scroll{overflow-x:auto}.sd-muted{color:#64748b}.sd-up{color:#15803d;font-weight:800}.sd-down{color:#be123c;font-weight:800}',
      '.sd-form{display:grid;gap:10px;max-width:520px}.sd-form label{display:grid;gap:4px;font-size:13px;font-weight:700;color:#334155}.sd-form input,.sd-form select{border:1px solid #cbd5e1;border-radius:10px;padding:9px 10px;font-size:14px;font-weight:500}',
      '.sd-msg{font-size:13px;font-weight:700;min-height:18px}.sd-msg.err{color:#be123c}.sd-msg.ok{color:#166534}',
      '.sd-photo{width:96px;height:96px;border-radius:50%;background:#e2e8f0;overflow:hidden;display:grid;place-items:center;font-size:36px;font-weight:900;color:#475569}.sd-photo img{width:100%;height:100%;object-fit:cover}',
      '.sd-big{font-size:28px;font-weight:900}.sd-row{display:flex;gap:12px;align-items:center;flex-wrap:wrap;justify-content:space-between}'
    ];
    // Show an old section only on the pages that list it.
    var map = {};
    items().forEach(function (i) { (i[3] || []).forEach(function (sec) { (map[sec] = map[sec] || []).push(i[0]); }); });
    KNOWN.forEach(function (sec) {
      var pages = map[sec] || [];
      out.push('body.sd-on' + pages.map(function (p) { return ':not([data-sd-page="' + p + '"])'; }).join('') + ' #staff-body > #' + sec + '{display:none!important}');
    });
    // Callers only ever see their own pages; the payout form needs a full staff login.
    out.push('body.sd-on.sd-caller #staff-body > #staff-settings-panel{display:none!important}');
    return out.join('\n');
  }
  function injectCss() { if (q('#sd-css')) return; var st = document.createElement('style'); st.id = 'sd-css'; st.textContent = css(); document.head.appendChild(st); }

  function headerHeight() {
    var pinned = 0;
    qa('header, nav, body > div, body > header, [class*="sticky"], [class*="fixed"]').forEach(function (el) {
      if (el.id === 'sd-side' || el.id === 'sd-top' || el.id === 'sd-scrim' || el.closest('#sd-side') || el.closest('#mkc-overlay')) return;
      var cs = getComputedStyle(el); if (cs.position !== 'sticky' && cs.position !== 'fixed') return;
      var r = el.getBoundingClientRect(); if (r.top <= 1 && r.bottom > 0 && r.bottom < 220 && r.width > window.innerWidth * 0.6) pinned = Math.max(pinned, r.bottom);
    });
    // The public header is hidden on the desk, so normally nothing is pinned and the sidebar starts at the very top.
    return Math.round(Math.max(pinned, 0));
  }
  // The sidebar stops where the dashboard ends, so it never covers anything below it.
  function bottomGap() { var pg = q('#page-staff-dashboard'); if (!pg) return 0; var r = pg.getBoundingClientRect(); if (!r.height) return 0; return Math.max(0, Math.round(window.innerHeight - r.bottom)); }
  function placeSide() { var st = document.documentElement.style; st.setProperty('--sd-top', headerHeight() + 'px'); st.setProperty('--sd-bot', bottomGap() + 'px'); }
  function staffVisible() { var b = q('#staff-body'); var pg = q('#page-staff-dashboard'); return !!(b && !b.classList.contains('hidden') && pg && pg.offsetParent !== null); }

  function me() { return (S.home && S.home.me) || {}; }
  function avatar(photo, name) { return photo ? '<img alt="" src="' + esc(photo) + '">' : esc((String(name || '?').trim()[0] || '?').toUpperCase()); }
  function drawSide() {
    var side = q('#sd-side'); if (!side) return;
    var m = me(); var behind = S.home && S.home.pace && S.home.pace.behind;
    side.innerHTML = '<div class="sd-me" data-sd-go="profile"><div class="sd-av">' + avatar(m.photo, m.first_name) + '</div><div><b>' + esc(m.first_name || 'Staff') + '</b><div style="font-size:12px;color:#86b39a">' + (S.scope === 'caller' ? 'Calling team' : 'Staff') + '</div></div></div>'
      + NAV.map(function (g) {
        var list = g[1].filter(allowed);
        if (!list.length) return '';
        return '<div class="sd-g">' + esc(g[0]) + '</div>' + list.map(function (i) {
          var badge = i[0] === 'home' && behind ? '<span class="sd-b" data-sd-badge="behind">behind</span>' : (i[0] === 'profile' && S.home && (S.home.profile_missing || []).length ? '<span class="sd-b" data-sd-badge="profile">' + S.home.profile_missing.length + '</span>' : '');
          return '<button type="button" class="sd-i' + (i[0] === S.page ? ' on' : '') + '" data-sd-go="' + i[0] + '"><span>' + i[1] + '</span><span>' + esc(i[2]) + '</span>' + badge + '</button>';
        }).join('');
      }).join('')
      + '<div class="sd-foot">' + (S.scope !== 'caller' ? '<button type="button" class="sd-i" data-sd-addlisting><span>➕</span><span>Add a listing</span></button>' : '') + '<button type="button" class="sd-i" data-sd-public><span>🌐</span><span>Public site</span></button><button type="button" class="sd-i" data-sd-signout><span>🚪</span><span>Sign out</span></button></div>';
    qa('[data-sd-go]', side).forEach(function (b) { b.onclick = function () { go(b.getAttribute('data-sd-go')); }; });
    var pub = q('[data-sd-public]', side); if (pub) pub.onclick = function () { closeDrawer(); if (typeof window.showPage === 'function') window.showPage('home'); else location.href = '/'; };
    var so = q('[data-sd-signout]', side); if (so) so.onclick = function () { closeDrawer(); if (typeof window.signOut === 'function') window.signOut(); };
    var al = q('[data-sd-addlisting]', side); if (al) al.onclick = function () { closeDrawer(); if (typeof window.showPage === 'function') window.showPage('list-property'); };
    var t = q('#sd-top-title'); if (t) t.textContent = (item(S.page) || [0, 0, 'Dashboard'])[2];
  }
  function openDrawer() { document.body.classList.add('sd-drawer'); }
  function closeDrawer() { document.body.classList.remove('sd-drawer'); }
  function go(page) {
    var it = item(page);
    if (!it || !allowed(it)) page = 'home';
    closeDrawer();
    if (page === 'connect') { openConnect(); return; }
    S.page = page; try { sessionStorage.setItem('sd-page', page); } catch (x) { /* private mode */ }
    document.body.setAttribute('data-sd-page', page);
    clearInterval(S.timer); S.timer = null;
    drawSide();
    try { window.scrollTo({ top: 0 }); } catch (x) { window.scrollTo(0, 0); }
    var host = q('#sd-pages');
    if (page === 'home') { drawHome(); loadHome(); S.timer = setInterval(function () { if (!document.hidden && staffVisible() && S.page === 'home') loadHome(); }, 60000); }
    else if (page === 'perf') loadPerf(host);
    else if (page === 'pay') loadPay(host);
    else if (page === 'profile') loadProfile(host);
    else if (page === 'settings') drawSettings(host);
    else if (page === 'calls' && window.makaugCalling && typeof window.makaugCalling.rescan === 'function') { try { window.makaugCalling.rescan(); } catch (x) { /* calling screen redraws itself */ } }
  }
  function openConnect() {
    if (window.makaugCalling && typeof window.makaugCalling.openConnect === 'function') { window.makaugCalling.openConnect('bt'); return; }
    // The calling screen has not loaded yet: show the calls page; its own button opens the same guide.
    go('calls');
  }

  // ------------------------------------------------------------- home ----
  function loadHome() {
    return api('/desk/home').then(function (h) { S.home = h; S.homeErr = ''; S.scope = (h.me && h.me.scope) || S.scope; document.body.classList.toggle('sd-caller', S.scope === 'caller'); drawSide(); if (S.page === 'home') drawHome(); return h; },
      function (e) { S.homeErr = e.message; if (S.page === 'home') drawHome(); throw e; });
  }
  function greeting(min) { return min < 12 * 60 ? 'Good morning' : (min < 17 * 60 ? 'Good afternoon' : 'Good evening'); }
  function ring(done, target, color) {
    var pct = target ? Math.min(1, done / target) : 0; var r = 22, c = 2 * Math.PI * r;
    return '<svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true"><circle cx="28" cy="28" r="' + r + '" fill="none" stroke="#e2e8f0" stroke-width="7"/><circle cx="28" cy="28" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="7" stroke-linecap="round" stroke-dasharray="' + (c * pct).toFixed(1) + ' ' + c.toFixed(1) + '" transform="rotate(-90 28 28)"/><text x="28" y="32" text-anchor="middle" font-size="12" font-weight="900" fill="#0f172a">' + Math.round(pct * 100) + '%</text></svg>';
  }
  function kpi(label, done, target, color, extra) {
    return '<div class="sd-card sd-kpi" data-sd-kpi="' + esc(label) + '">' + (target ? ring(done, target, color) : '') + '<div><div class="l">' + esc(label) + '</div><div class="v">' + esc(done) + (target ? ' <span class="t">/ ' + esc(target) + '</span>' : '') + '</div>' + (extra ? '<div class="t">' + extra + '</div>' : '') + '</div></div>';
  }
  function weekChart(a, b, elapsed) {
    var max = Math.max.apply(null, (a || []).concat(b || []).concat([1])); var days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    var W = 520, H = 160, base = 130, slot = W / 7;
    var bars = days.map(function (d, i) {
      var x = i * slot + slot / 2; var h1 = Math.round(((b || [])[i] || 0) / max * 110); var h2 = Math.round(((a || [])[i] || 0) / max * 110);
      return '<rect x="' + (x - 18) + '" y="' + (base - h1) + '" width="16" height="' + h1 + '" rx="3" fill="#cbd5e1"><title>Last week ' + d + ': ' + ((b || [])[i] || 0) + '</title></rect>'
        + (i < elapsed ? '<rect x="' + (x + 2) + '" y="' + (base - h2) + '" width="16" height="' + h2 + '" rx="3" fill="#15603f"><title>This week ' + d + ': ' + ((a || [])[i] || 0) + '</title></rect><text x="' + (x + 10) + '" y="' + (base - h2 - 4) + '" font-size="10" text-anchor="middle" fill="#0f172a" font-weight="800">' + ((a || [])[i] || '') + '</text>' : '')
        + '<text x="' + x + '" y="' + (base + 16) + '" font-size="11" text-anchor="middle" fill="#64748b">' + d + '</text>';
    }).join('');
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto" role="img" aria-label="Calls this week against last week">' + bars + '</svg><div class="sd-muted" style="font-size:12px"><span style="display:inline-block;width:10px;height:10px;background:#15603f;border-radius:2px"></span> this week &nbsp; <span style="display:inline-block;width:10px;height:10px;background:#cbd5e1;border-radius:2px"></span> last week</div>';
  }
  function change(cur, prev, unit) {
    if (!prev && !cur) return '<span class="sd-muted">nothing yet</span>';
    if (!prev) return '<span class="sd-up">new this ' + unit + '</span>';
    var pct = Math.round(100 * (cur - prev) / prev);
    return '<span class="' + (pct >= 0 ? 'sd-up' : 'sd-down') + '">' + (pct >= 0 ? '▲ ' : '▼ ') + Math.abs(pct) + '% vs last ' + unit + '</span>';
  }
  function drawHome() {
    var host = q('#sd-pages'); if (!host || S.page !== 'home') return;
    var h = S.home;
    if (!h) { host.innerHTML = '<div class="sd-page"><div class="sd-card" data-sd-home-wait>' + (S.homeErr ? esc(S.homeErr) : 'Loading your day…') + '</div></div>'; return; }
    var m = h.me || {}; var t = h.targets || {}; var d = h.today || {}; var p = h.pace || {};
    var wk = h.week || {}; var mo = h.month || {};
    var sum = function (a, k) { return (a || []).slice(0, k).reduce(function (x, y) { return x + y; }, 0); };
    var thisW = sum(wk.this_week, wk.elapsed_days), lastW = sum(wk.last_week, wk.elapsed_days);
    var banner = p.behind
      ? '<div class="sd-banner behind" data-sd-behind>⚠️ You are behind: ' + p.done + ' calls so far, ' + p.expected + ' expected by now (' + p.short_by + ' short). King can see this too. <button type="button" class="sd-btn" data-sd-go-calls>Start calling</button></div>'
      : (p.expected ? '<div class="sd-banner ok" data-sd-ontrack>✅ On track: ' + p.done + ' calls, ' + p.expected + ' expected by now.</div>' : '');
    var missing = (h.profile_missing || []);
    var nudge = missing.length ? '<div class="sd-banner info" data-sd-profile-nudge>🪪 Finish your profile: add your ' + esc(missing.join(', ')) + '. <button type="button" class="sd-btn ghost" data-sd-go-profile>Open profile</button></div>' : '';
    var check = (h.checklist || []).map(function (c) {
      var icon = { done: '✓', now: '▶', missed: '!', todo: '' }[c.state] || '';
      return '<li data-sd-check="' + esc(c.key) + '" data-state="' + esc(c.state) + '"><span class="sd-dot ' + esc(c.state) + '">' + icon + '</span><span>' + esc(c.label) + (c.block ? ' <span class="w">' + esc(c.block) + '</span>' : '') + '</span><span class="p">' + esc(c.progress) + '</span></li>';
    }).join('');
    var plan = ((h.plan && h.plan.blocks) || []).map(function (b) {
      var pct = b.target ? Math.min(100, Math.round(100 * b.done / b.target)) : 0;
      return '<div class="sd-blk' + (b.now ? ' now' : '') + (b.past ? ' past' : '') + '" data-sd-block="' + esc(b.kind) + '"><b>' + esc(b.start) + '–' + esc(b.end) + '</b><div><div style="font-weight:800">' + esc(b.label) + (b.now ? ' · now' : '') + '</div>' + (b.target ? '<div class="sd-bar" style="margin-top:4px"><i style="width:' + pct + '%"></i></div>' : '') + '</div><span class="sd-muted">' + (b.target ? b.done + '/' + b.target : '') + '</span></div>';
    }).join('') || '<p class="sd-muted">No plan for today.</p>';
    var money = h.money ? '<div class="sd-card" data-sd-money><h3>Money</h3><div class="sd-row"><div><div class="sd-muted" style="font-size:12px">Commission earned</div><div class="sd-big">' + ugx(h.money.earned_ugx) + '</div></div><div><div class="sd-muted" style="font-size:12px">Due on payday ' + esc(niceDay(h.money.next_payday)) + '</div><div class="sd-big">' + ugx(h.money.due_next_payday_ugx) + '</div></div></div><button type="button" class="sd-btn ghost" style="margin-top:10px" data-sd-go-pay>Open My pay</button></div>' : '';
    host.innerHTML = '<div class="sd-page" data-sd-home>'
      + '<div class="sd-row"><div style="display:flex;gap:12px;align-items:center"><div class="sd-av" style="width:52px;height:52px;font-size:20px">' + avatar(m.photo, m.first_name) + '</div><div><h1 class="sd-h1" data-sd-greeting>' + greeting(n(h.now_min)) + ', ' + esc(m.first_name || 'there') + '</h1><p class="sd-sub">' + esc(niceDay(h.day)) + ' · targets today: ' + n(t.calls) + ' calls, ' + n(t.interested) + ' interested, ' + n(t.paid) + ' paid</p></div></div><button type="button" class="sd-btn" data-sd-go-calls>📞 Start calling</button></div>'
      + banner + nudge
      + '<div class="sd-kpis">' + kpi('Calls today', n(d.calls), n(t.calls), '#15603f') + kpi('Interested', n(d.interested), n(t.interested), '#2563eb') + kpi('Paid', n(d.paid), n(t.paid), '#d97706') + kpi('Talk time', dur(d.talk_s), 0, '', 'on calls today') + '</div>'
      + '<div class="sd-grid2"><div class="sd-card" data-sd-week><div class="sd-row"><h3>This week vs last week</h3><span>' + thisW + ' calls · ' + change(thisW, lastW, 'week') + '</span></div>' + weekChart(wk.this_week, wk.last_week, wk.elapsed_days) + '</div>'
      + '<div class="sd-card" data-sd-month><h3>This month (' + esc(monthName(h.day)) + ')</h3><div class="sd-row"><div><div class="sd-muted" style="font-size:12px">Calls</div><div class="sd-big">' + fmt(mo.calls) + '</div><div style="font-size:12px">' + change(n(mo.calls), n(mo.calls_prev), 'month') + '</div></div><div><div class="sd-muted" style="font-size:12px">Paid</div><div class="sd-big">' + fmt(mo.paid) + '</div><div style="font-size:12px">' + change(n(mo.paid), n(mo.paid_prev), 'month') + '</div></div></div><p class="sd-muted" style="font-size:12px;margin-top:8px">Compared with the same days last month.</p></div></div>'
      + '<div class="sd-grid2"><div class="sd-card"><h3>Today’s checklist</h3><ul class="sd-check" data-sd-checklist>' + check + '</ul></div><div class="sd-card"><h3>Day planner</h3><div class="sd-plan" data-sd-plan>' + plan + '</div></div></div>'
      + money + '</div>';
    qa('[data-sd-go-calls]', host).forEach(function (b) { b.onclick = function () { go('calls'); }; });
    qa('[data-sd-go-profile]', host).forEach(function (b) { b.onclick = function () { go('profile'); }; });
    qa('[data-sd-go-pay]', host).forEach(function (b) { b.onclick = function () { go('pay'); }; });
  }

  // ------------------------------------------------------ performance ----
  var OUTCOME = { no_answer: 'No answer', replied: 'Replied / chatting', interested: 'Interested', signed_up: 'Signed up', paid: 'Paid', renewed: 'Renewed', not_interested: 'Not interested', wrong_number: 'Wrong number', call_back: 'Call back', none: 'No outcome' };
  function loadPerf(host) {
    host.innerHTML = '<div class="sd-page"><h1 class="sd-h1">My performance</h1><p class="sd-sub">Loading…</p></div>';
    api('/desk/performance').then(function (p) {
      if (S.page !== 'perf') return;
      var days = p.days || []; var max = Math.max.apply(null, days.map(function (d) { return d.calls; }).concat([p.target_calls || 1, 1]));
      var hit = days.filter(function (d) { return d.hit; }).length;
      var tot = days.reduce(function (a, d) { a.calls += d.calls; a.paid += d.paid; a.interested += d.interested; a.talk += d.talk_s; return a; }, { calls: 0, paid: 0, interested: 0, talk: 0 });
      var rows = days.map(function (d) {
        return '<tr data-sd-day="' + esc(d.day) + '"><td>' + esc(niceDay(d.day)) + '</td><td><div style="display:flex;gap:8px;align-items:center"><b style="min-width:24px">' + d.calls + '</b><div class="sd-bar" style="flex:1;min-width:60px"><i style="width:' + Math.round(100 * d.calls / max) + '%;background:' + (d.hit ? '#15603f' : '#94a3b8') + '"></i></div></div></td><td>' + d.interested + '</td><td>' + d.paid + '</td><td>' + dur(d.talk_s) + '</td><td>' + (d.hit ? '✅' : '—') + '</td></tr>';
      }).join('') || '<tr><td colspan="6" class="sd-muted">No calls in the last 30 days yet.</td></tr>';
      var outs = (p.outcomes_month || []).map(function (o) { return '<tr><td>' + esc(OUTCOME[o.outcome] || o.outcome) + '</td><td><b>' + o.n + '</b></td></tr>'; }).join('') || '<tr><td colspan="2" class="sd-muted">No calls this month yet.</td></tr>';
      host.innerHTML = '<div class="sd-page" data-sd-perf><h1 class="sd-h1">My performance</h1><p class="sd-sub">Your own calls only. Target: ' + n(p.target_calls) + ' calls and ' + n(p.target_paid) + ' paid a day.</p>'
        + '<div class="sd-kpis">' + kpi('Calls (30 days)', fmt(tot.calls), 0) + kpi('Interested', fmt(tot.interested), 0) + kpi('Paid', fmt(tot.paid), 0) + kpi('Days on target', hit + ' of ' + days.length, 0) + '</div>'
        + '<div class="sd-grid2"><div class="sd-card"><h3>Day by day</h3><div class="sd-scroll"><table class="sd-table" data-sd-days><tr><th>Day</th><th>Calls</th><th>Interested</th><th>Paid</th><th>Talk</th><th>Target</th></tr>' + rows + '</table></div></div>'
        + '<div class="sd-card"><h3>Outcomes this month</h3><table class="sd-table" data-sd-outcomes>' + outs + '</table></div></div></div>';
    }, function (e) { host.innerHTML = '<div class="sd-page"><h1 class="sd-h1">My performance</h1><div class="sd-card" style="margin-top:12px">' + esc(e.message) + '</div></div>'; });
  }

  // -------------------------------------------------------------- pay ----
  function loadPay(host) {
    host.innerHTML = '<div class="sd-page"><h1 class="sd-h1">My pay</h1><p class="sd-sub">Loading…</p></div>';
    api('/desk/pay').then(function (p) {
      if (S.page !== 'pay') return;
      var s = p.salary || {}; var c = p.commission || {}; var k = c.counts || {};
      var hist = (s.history || []).map(function (x) { return '<tr><td>' + esc(monthName(x.month)) + '</td><td>' + ugx(x.salary_ugx) + '</td><td class="sd-muted">' + esc(x.note || '') + '</td></tr>'; }).join('') || '<tr><td colspan="3" class="sd-muted">King has not set a salary yet.</td></tr>';
      host.innerHTML = '<div class="sd-page" data-sd-pay><h1 class="sd-h1">My pay</h1><p class="sd-sub">' + esc(monthName(p.month)) + '. Payday is ' + esc(niceDay(c.next_payday)) + (c.cutoff ? ' (counts close ' + esc(niceDay(c.cutoff)) + ')' : '') + '.</p>'
        + '<div class="sd-kpis">'
        + kpi('Salary this month', s.salary_ugx == null ? 'Not set' : ugx(s.salary_ugx), 0, '', s.carried ? 'same as last set' : '')
        + kpi('Commission earned', ugx(c.earned_ugx), 0, '', c.rate_pct ? c.rate_pct + '% of first payments' : '')
        + kpi('Due next payday', ugx(c.due_next_payday_ugx), 0, '', c.on_hold_ugx ? ugx(c.on_hold_ugx) + ' on hold' : '')
        + kpi('Paid to you so far', ugx(c.paid_to_date_ugx), 0) + '</div>'
        + '<div class="sd-grid2"><div class="sd-card"><h3>Your agents this month</h3><table class="sd-table" data-sd-paycounts><tr><td>Contacted</td><td><b>' + n(k.contacted) + '</b></td></tr><tr><td>Signed up</td><td><b>' + n(k.signed_up) + '</b></td></tr><tr><td>Paid</td><td><b>' + n(k.paid) + '</b></td></tr><tr><td>On hold (' + n(c.hold_days) + ' days)</td><td><b>' + n(k.on_hold) + '</b></td></tr></table></div>'
        + '<div class="sd-card"><h3>Salary history</h3><table class="sd-table" data-sd-salary>' + hist + '</table></div></div></div>';
    }, function (e) { host.innerHTML = '<div class="sd-page"><h1 class="sd-h1">My pay</h1><div class="sd-card" style="margin-top:12px">' + esc(e.message) + '</div></div>'; });
  }

  // ---------------------------------------------------------- profile ----
  function shrinkPhoto(file) {
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\//.test(file.type)) { reject(new Error('Pick a photo (JPEG, PNG or WebP).')); return; }
      var fr = new FileReader();
      fr.onerror = function () { reject(new Error('Could not read that photo.')); };
      fr.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error('Could not open that photo.')); };
        img.onload = function () {
          var size = 320; var side = Math.min(img.width, img.height); var cv = document.createElement('canvas'); cv.width = size; cv.height = size;
          cv.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
          var qual = 0.85; var out = cv.toDataURL('image/jpeg', qual);
          while (out.length > 110000 && qual > 0.3) { qual -= 0.1; out = cv.toDataURL('image/jpeg', qual); }
          resolve(out);
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }
  function loadProfile(host) {
    host.innerHTML = '<div class="sd-page"><h1 class="sd-h1">Profile</h1><p class="sd-sub">Loading…</p></div>';
    api('/desk/profile').then(function (p) { if (S.page === 'profile') drawProfile(host, p); }, function (e) { host.innerHTML = '<div class="sd-page"><h1 class="sd-h1">Profile</h1><div class="sd-card" style="margin-top:12px">' + esc(e.message) + '</div></div>'; });
  }
  function drawProfile(host, p) {
    var m = me(); var pending = { photo: null };
    var types = [['', 'Pick one'], ['national_id', 'National ID'], ['passport', 'Passport'], ['driving_permit', 'Driving permit'], ['refugee_id', 'Refugee ID']];
    host.innerHTML = '<div class="sd-page" data-sd-profile><h1 class="sd-h1">Profile</h1><p class="sd-sub">Your photo shows on your desk and to King. Your ID stays private: you only ever see the last 3 characters, and only King can open it.</p>'
      + (p.missing && p.missing.length ? '<div class="sd-banner info">Still missing: ' + esc(p.missing.join(', ')) + '.</div>' : '<div class="sd-banner ok">Profile complete. Thank you!</div>')
      + '<div class="sd-grid2" style="margin-top:12px"><div class="sd-card"><h3>Photo</h3><div style="display:flex;gap:14px;align-items:center"><div class="sd-photo" data-sd-photo>' + avatar(p.photo, m.first_name) + '</div><div style="display:grid;gap:6px"><label class="sd-btn ghost" style="display:inline-block;text-align:center">Choose a photo<input type="file" accept="image/jpeg,image/png,image/webp" data-sd-photo-input style="display:none"></label><span class="sd-muted" style="font-size:12px">A clear photo of your face. We shrink it for you.</span></div></div></div>'
      + '<div class="sd-card"><h3>' + esc(m.first_name || '') + '</h3><p class="sd-muted" style="font-size:13px;margin:0">Calling name: ' + esc(m.person_key || '—') + '. Ask King to change your name or phone.</p></div></div>'
      + '<div class="sd-card"><h3>Private details</h3><form class="sd-form" data-sd-profile-form autocomplete="off">'
      + '<label>Kind of ID<select name="id_type">' + types.map(function (t) { return '<option value="' + t[0] + '"' + (t[0] === p.id_type ? ' selected' : '') + '>' + t[1] + '</option>'; }).join('') + '</select></label>'
      + '<label>ID number<input name="id_number" type="password" autocomplete="off" spellcheck="false" placeholder="' + esc(p.id_saved ? 'Saved: ' + p.id_number_masked + ' (type a new one to replace it)' : 'Type your ID number') + '"></label>'
      + '<label>ID expiry date<input name="id_expiry" type="date" value="' + esc(p.id_expiry || '') + '"></label>'
      + '<label>Home area<input name="home_area" maxlength="80" value="' + esc(p.home_area || '') + '" placeholder="e.g. Ntinda"></label>'
      + '<label>Emergency contact name<input name="emergency_name" maxlength="80" value="' + esc(p.emergency_name || '') + '"></label>'
      + '<label>Emergency contact phone<input name="emergency_phone" type="tel" autocomplete="off" placeholder="' + esc(p.emergency_phone_masked ? 'Saved: ' + p.emergency_phone_masked + ' (type a new one to replace it)' : 'e.g. 07…') + '"></label>'
      + '<div class="sd-msg" data-sd-profile-msg></div><div><button type="submit" class="sd-btn" data-sd-profile-save>Save profile</button></div></form></div></div>';
    var msg = q('[data-sd-profile-msg]', host);
    var inp = q('[data-sd-photo-input]', host);
    inp.onchange = function () {
      msg.className = 'sd-msg'; msg.textContent = 'Getting the photo ready…';
      shrinkPhoto(inp.files && inp.files[0]).then(function (data) { pending.photo = data; q('[data-sd-photo]', host).innerHTML = '<img alt="" src="' + data + '">'; msg.textContent = 'Photo ready. Press Save profile.'; }, function (e) { msg.className = 'sd-msg err'; msg.textContent = e.message; });
    };
    var form = q('[data-sd-profile-form]', host);
    form.onsubmit = function (ev) {
      ev.preventDefault();
      var f = form.elements; var body = { id_type: f.id_type.value, id_expiry: f.id_expiry.value, home_area: f.home_area.value, emergency_name: f.emergency_name.value };
      if (f.id_number.value.trim()) body.id_number = f.id_number.value.trim();
      if (f.emergency_phone.value.trim()) body.emergency_phone = f.emergency_phone.value.trim();
      if (pending.photo) body.photo = pending.photo;
      var btn = q('[data-sd-profile-save]', host); btn.disabled = true; msg.className = 'sd-msg'; msg.textContent = 'Saving…';
      api('/desk/profile', { method: 'PUT', body: body }).then(function (np) {
        if (S.home && S.home.me) { S.home.me.photo = np.photo; S.home.profile_missing = np.missing; }
        drawSide(); drawProfile(host, np);
        var m2 = q('[data-sd-profile-msg]', host); m2.className = 'sd-msg ok'; m2.textContent = 'Saved.';
      }, function (e) { btn.disabled = false; msg.className = 'sd-msg err'; msg.textContent = e.message; });
    };
  }

  // --------------------------------------------------------- settings ----
  function drawSettings(host) {
    host.innerHTML = '<div class="sd-page" data-sd-settings><h1 class="sd-h1">Settings</h1><p class="sd-sub">Change your password or sign out.</p>'
      + '<div class="sd-card" style="margin-top:12px"><h3>Change password</h3><form class="sd-form" data-sd-pw-form autocomplete="off">'
      + '<label>Current password<input name="old" type="password" autocomplete="current-password" required></label>'
      + '<label>New password (8 or more characters)<input name="new1" type="password" autocomplete="new-password" minlength="8" required></label>'
      + '<label>New password again<input name="new2" type="password" autocomplete="new-password" minlength="8" required></label>'
      + '<div class="sd-msg" data-sd-pw-msg></div><div><button type="submit" class="sd-btn" data-sd-pw-save>Change password</button></div></form></div>'
      + '<div class="sd-card" style="margin-top:12px"><h3>Sign out</h3><p class="sd-muted" style="font-size:13px">Sign out when you finish, especially on a shared computer.</p><button type="button" class="sd-btn ghost" data-sd-signout2>Sign out</button></div>'
      + (S.scope !== 'caller' ? '<p class="sd-muted" style="font-size:12px;margin-top:12px">Your payout details are below.</p>' : '') + '</div>';
    var form = q('[data-sd-pw-form]', host); var msg = q('[data-sd-pw-msg]', host);
    form.onsubmit = function (ev) {
      ev.preventDefault();
      var f = form.elements; msg.className = 'sd-msg err';
      if (f.new1.value.length < 8) { msg.textContent = 'The new password needs 8 or more characters.'; return; }
      if (f.new1.value !== f.new2.value) { msg.textContent = 'The two new passwords are not the same.'; return; }
      var btn = q('[data-sd-pw-save]', host); btn.disabled = true; msg.className = 'sd-msg'; msg.textContent = 'Changing…';
      api('/change-password', { root: '/api/auth', method: 'POST', body: { old_password: f.old.value, new_password: f.new1.value } }).then(function () {
        form.reset(); btn.disabled = false; msg.className = 'sd-msg ok'; msg.textContent = 'Password changed. Use the new one next time you sign in.';
      }, function (e) { btn.disabled = false; msg.className = 'sd-msg err'; msg.textContent = e.message; });
    };
    q('[data-sd-signout2]', host).onclick = function () { if (typeof window.signOut === 'function') window.signOut(); };
  }

  // ------------------------------------------------------------ mount ----
  function mount(scope) {
    if (S.mounted) return; S.mounted = true; S.scope = scope || ''; injectCss();
    document.body.classList.toggle('sd-caller', S.scope === 'caller');
    var side = document.createElement('aside'); side.id = 'sd-side'; side.setAttribute('aria-label', 'Staff menu'); document.body.appendChild(side);
    var scrim = document.createElement('div'); scrim.id = 'sd-scrim'; scrim.onclick = closeDrawer; document.body.appendChild(scrim);
    var body = q('#staff-body');
    var top = document.createElement('div'); top.id = 'sd-top'; top.innerHTML = '<button type="button" data-sd-menu aria-label="Open menu">☰</button><span id="sd-top-title">Dashboard</span>';
    var pages = document.createElement('div'); pages.id = 'sd-pages';
    body.parentNode.insertBefore(top, body); body.parentNode.insertBefore(pages, body);
    q('[data-sd-menu]', top).onclick = openDrawer;
    var placing = false; var onMove = function () { if (placing) return; placing = true; requestAnimationFrame(function () { placing = false; if (document.body.classList.contains('sd-on')) placeSide(); }); };
    window.addEventListener('resize', onMove); window.addEventListener('scroll', onMove, { passive: true });
    document.body.classList.add('sd-on'); placeSide();
    var start = ''; try { start = sessionStorage.getItem('sd-page') || ''; } catch (x) { /* private mode */ }
    var asked = (location.hash.match(/sd=([a-z]+)/) || [])[1];
    go(asked || start || 'home');
  }
  function tick() {
    var vis = staffVisible();
    if (!vis) { S.blocked = false; if (document.body.classList.contains('sd-on')) { document.body.classList.remove('sd-on', 'sd-drawer'); clearInterval(S.timer); } return; }
    if (S.blocked) return;
    if (S.mounted) { if (!document.body.classList.contains('sd-on')) { document.body.classList.add('sd-on'); go(S.page || 'home'); } placeSide(); return; }
    if (S.busy) return; S.busy = true;
    loadHome().then(function (h) { S.busy = false; mount((h.me && h.me.scope) || ''); }, function (e) {
      S.busy = false;
      // A staff login without a calling name still gets the desk (Profile, Settings, Work pages).
      if (e.status === 400) mount('');
      else if (e.status === 401 || e.status === 403) S.blocked = true;
    });
  }
  setInterval(tick, 1200);
  tick();
  window.staffDesk = { go: go, reload: loadHome, state: S };
})();
