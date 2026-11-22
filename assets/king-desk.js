/* King desk (Arthur, 21 Nov 2026). A left sidebar for King with new pages:
 * Overview, Payments & MoMo, Removal requests (and Staff, pay & targets).
 * Every existing King tab stays and is reachable from the sidebar.
 * Loaded only on the King page. No phone numbers are shown in full. */
(function () {
  'use strict';
  if (window.__kingDesk) return; window.__kingDesk = true;
  var q = function (s, el) { return (el || document).querySelector(s); };
  var qa = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var ugx = function (n) { n = Number(n || 0); return n >= 1e6 ? 'UGX ' + (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'm' : 'UGX ' + n.toLocaleString('en-GB'); };
  var ugxFull = function (n) { return 'UGX ' + Number(n || 0).toLocaleString('en-GB'); };
  function when(d) { try { return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Kampala' }).format(new Date(d)); } catch (x) { return ''; } }
  function ago(d) { if (!d) return 'never'; var m = Math.round((Date.now() - new Date(d).getTime()) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' days ago'; }
  function api(path, opts) {
    opts = opts || {};
    var h = { Accept: 'application/json' };
    if (typeof window.adminAuthHeaders === 'function') { try { Object.assign(h, window.adminAuthHeaders()); } catch (x) { /* cookie auth */ } }
    if (opts.body) h['Content-Type'] = 'application/json';
    return fetch('/api/admin' + path, { method: opts.method || 'GET', credentials: 'same-origin', headers: h, body: opts.body ? JSON.stringify(opts.body) : undefined }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok || j.ok === false) { var e = new Error(j.error || ('Error ' + r.status)); e.status = r.status; throw e; } return j.data; });
    });
  }
  // King sidebar, regrouped (Arthur approved 21 Nov 2026): 20 items → 16. Items starting "v:" are pages
  // made of parts of the existing tabs; the chips at the top switch between the parts. Nothing is deleted:
  // every old tab is still reachable from a chip, and "Full calling desk" shows the old page whole.
  var NAV = [
    ['King', [['k-overview', '👑', 'Overview'], ['v:team', '👥', 'Team & calls'], ['v:staff', '🧾', 'Staff, pay & targets'], ['v:hub', '📣', 'Team hub', 'lessons_waiting'], ['v:money', '💳', 'Money in', 'momo_unmatched']]],
    ['To review', [['review:found', '🌐', 'Found online to review', 'found_online'], ['review:agent', '🏠', 'Agent properties to review', 'agent_props'], ['review:stays', '🛏️', 'Short stays', 'short_stays'], ['k-removals', '🗑️', 'Removal requests', 'removal_requests'], ['agent-reports', '🚩', 'Agent reports']]],
    ['Agents & listings', [['v:agents', '👩‍💼', 'Agents & owners'], ['listings', '📋', 'All listings'], ['live', '⭐', 'Live & featured']]],
    ['Leads & calls', [['v:leads', '💬', 'Leads & WhatsApp'], ['v:lists', '📞', 'Calling lists']]],
    ['Harvest', [['v:harvest', '🔎', 'Harvest']]],
    ['System', [['v:settings', '⚙️', 'Settings & logs']]]
  ];
  // [chip label, admin tab, part shown (null = the whole tab)]
  var VIEWS = {
    'v:team': [['Team', 'k-team', null], ['Calls today', 'performance', 'team']],
    'v:staff': [['Staff & pay', 'k-staff', null], ['Commission, targets & logins', 'performance', 'staff'], ['Staff logins (advanced)', 'staff', null]],
    'v:hub': [['Messages, rules & videos', 'k-hub', null], ['Rejections & lessons', 'k-lessons', null]],
    'v:money': [['Payments & MoMo', 'k-payments', null], ['Cash check & payment SMS proofs', 'performance', 'money'], ['Sales', 'revenue', null], ['Ad slots', 'revenue', 'ads']],
    'v:agents': [['Agents', 'agents', null], ['Owners', 'public', null], ['Find a person', 'accounts', null]],
    'v:leads': [['WhatsApp inbox', 'whatsapp', null], ['Lead desk & CRM', 'notifications', 'leads'], ['Find a person', 'accounts', null], ['Home seekers & consent', 'whatsapp', 'seekers']],
    'v:lists': [['Numbers & call-backs', 'performance', 'lists'], ['Outreach', 'outreach', null], ['Full calling desk', 'performance', null]],
    'v:harvest': [['YouTube & sources', 'youtube-sweep', null], ['Harvest tools & old review queue', 'review', 'legacy']],
    'v:settings': [['Logs & mortgage rates', 'notifications', 'logs'], ['Field agents (not in use)', 'field-agents', null]]
  };
  var LABEL = {}; NAV.forEach(function (g) { g[1].forEach(function (i) { LABEL[i[0]] = i[2]; }); });
  // Where a plain tab lives now (for links and for the old code that jumps to a tab by itself).
  var HOME = {};
  Object.keys(VIEWS).forEach(function (v) { VIEWS[v].forEach(function (pt, i) { if (!HOME[pt[1]] && pt[1] !== 'review') HOME[pt[1]] = [v, i]; }); });
  var S = { counts: {}, tab: null, timer: null, mounted: false, drawer: false };
  var CSS = [
    'body.kd-on #page-admin-dashboard > .bg-gray-900{display:none}',
    'body.kd-on #admin-body > .bg-white.border.border-gray-200.rounded-2xl.p-6:first-child,body.kd-on #admin-command-centre,body.kd-on #king-control-map,body.kd-on #admin-workflow-tabs{display:none!important}',
    'body.kd-on #page-admin-dashboard > .max-w-6xl{max-width:none;margin:0 0 0 256px;padding:20px 24px 40px}',
    '#kd-side{position:fixed;left:0;top:var(--kd-top,64px);bottom:var(--kd-bot,0px);width:244px;background:#10291f;color:#e2f0e8;overflow:auto;z-index:40;padding:12px 10px 20px;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;display:none}',
    'body.kd-on #kd-side{display:block}',
    '#kd-side .kd-me{display:flex;gap:10px;align-items:center;background:rgba(255,255,255,.07);border-radius:14px;padding:10px;margin-bottom:12px}#kd-side .kd-av{width:34px;height:34px;border-radius:50%;background:#15603f;display:grid;place-items:center;font-weight:900;color:#fff}',
    '#kd-side .kd-g{font-size:11px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;color:#86b39a;margin:14px 8px 6px}',
    '#kd-side button.kd-i{display:flex;align-items:center;gap:10px;width:100%;text-align:left;background:none;border:0;color:#e2f0e8;padding:9px 10px;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer}',
    '#kd-side button.kd-i:hover{background:rgba(255,255,255,.08)}#kd-side button.kd-i.on{background:#15603f;color:#fff}',
    '#kd-side .kd-b{margin-left:auto;background:#e11d48;color:#fff;border-radius:999px;font-size:11px;font-weight:900;padding:1px 8px}',
    '#kd-side .kd-foot{margin-top:16px;border-top:1px solid rgba(255,255,255,.1);padding-top:10px;display:grid;gap:4px}',
    '#kd-top{display:none}',
    '@media(max-width:1023px){.kd-kpi .v{font-size:20px}body.kd-on #page-admin-dashboard > .max-w-6xl{margin-left:0;padding:12px 12px 40px}#kd-side{width:82vw;max-width:300px;transform:translateX(-105%);transition:transform .2s;box-shadow:0 0 40px rgba(0,0,0,.4)}body.kd-on.kd-drawer #kd-side{transform:none}',
    'body.kd-on #kd-top{display:flex;position:sticky;top:var(--kd-top,64px);z-index:39;align-items:center;gap:10px;background:#10291f;color:#fff;padding:10px 12px;margin:-12px -12px 12px;font-weight:800}#kd-top button{background:#15603f;border:0;color:#fff;border-radius:10px;padding:8px 12px;font-weight:900;font-size:16px}',
    '#kd-scrim{display:none}body.kd-on.kd-drawer #kd-scrim{display:block;position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:38}}',
    '.kd-page{font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a}',
    '.kd-h1{font-size:26px;font-weight:900;margin:0}.kd-sub{color:#64748b;font-size:13px;margin:2px 0 0}',
    '.kd-chips{display:flex;gap:6px;flex-wrap:wrap}.kd-chip{border-radius:999px;padding:4px 10px;font-size:12px;font-weight:800;border:0;cursor:pointer}.kd-chip.red{background:#ffe4e6;color:#be123c}.kd-chip.amber{background:#fef3c7;color:#92400e}.kd-chip.grey{background:#f1f5f9;color:#475569}',
    '.kd-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:14px 0}@media(max-width:900px){.kd-kpis{grid-template-columns:repeat(2,1fr)}}',
    '.kd-card{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:14px}.kd-card h3{font-size:16px;font-weight:900;margin:0 0 10px}',
    '.kd-kpi .l{font-size:12px;color:#64748b;font-weight:700}.kd-kpi .v{font-size:26px;font-weight:900;margin:2px 0}.kd-up{color:#15803d;font-size:12px;font-weight:800}.kd-down{color:#be123c;font-size:12px;font-weight:800}.kd-flat{color:#64748b;font-size:12px;font-weight:700}',
    '.kd-grid2{display:grid;grid-template-columns:1.6fr 1fr;gap:12px;margin-bottom:12px}.kd-grid2b{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media(max-width:900px){.kd-grid2,.kd-grid2b{grid-template-columns:1fr}}',
    '.kd-funnel div{display:flex;align-items:center;gap:8px;margin:6px 0;font-size:13px;font-weight:700}.kd-funnel span.n{display:inline-block;min-width:28px;color:#fff;border-radius:6px;padding:3px 8px;font-weight:900}.kd-funnel label{width:140px;flex:0 0 140px}',
    '.kd-need{display:flex;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:13px}.kd-need:last-child{border:0}.kd-tag{border-radius:6px;padding:2px 8px;font-size:11px;font-weight:900}.kd-tag.removal{background:#ffe4e6;color:#be123c}.kd-tag.momo{background:#fef3c7;color:#92400e}.kd-tag.flag{background:#e2e8f0;color:#334155}.kd-tag.behind{background:#fef3c7;color:#92400e}.kd-tag.ok{background:#dcfce7;color:#166534}',
    '.kd-need .t{flex:1;min-width:0}.kd-link{background:none;border:0;color:#15603f;font-weight:800;cursor:pointer;font-size:12px;text-decoration:underline}',
    '.kd-table{width:100%;border-collapse:collapse;font-size:13px}.kd-table th{text-align:left;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;padding:6px 4px;border-bottom:1px solid #e2e8f0}.kd-table td{padding:8px 4px;border-bottom:1px solid #f1f5f9;vertical-align:middle}',
    '.kd-bar{height:8px;background:#e2e8f0;border-radius:999px;overflow:hidden;min-width:70px}.kd-bar i{display:block;height:100%;background:#15603f}',
    '.kd-btn{border:0;border-radius:10px;padding:8px 12px;font-weight:800;font-size:13px;cursor:pointer;background:#15603f;color:#fff}.kd-btn.ghost{background:#f1f5f9;color:#0f172a}.kd-btn.red{background:#be123c}',
    '.kd-scroll{overflow-x:auto}.kd-muted{color:#64748b}.kd-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;justify-content:space-between}',
    // Pages made of parts of old tabs (see VIEWS)
    'body.kd-on[data-kd-part="team"] [data-kpart]:not([data-kpart~="team"]){display:none!important}',
    'body.kd-on[data-kd-part="staff"] [data-kpart]:not([data-kpart~="staff"]){display:none!important}',
    'body.kd-on[data-kd-part="money"] [data-kpart]:not([data-kpart~="money"]){display:none!important}',
    'body.kd-on[data-kd-part="lists"] [data-kpart]:not([data-kpart~="lists"]){display:none!important}',
    'body.kd-on[data-kd-part="leads"] [data-kpart]:not([data-kpart~="leads"]){display:none!important}',
    'body.kd-on[data-kd-part="logs"] [data-kpart]:not([data-kpart~="logs"]){display:none!important}',
    // Home seekers & consent (King only): its own card on the WhatsApp tab.
    'body.kd-on[data-kd-part="seekers"] [data-admin-tab-panel="whatsapp"]:not(#king-home-seekers){display:none!important}body:not([data-kd-part="seekers"]) #king-home-seekers{display:none!important}',
    'body.kd-on[data-kd-view="v:money"]:not([data-kd-part="ads"]) #admin-advertising-control{display:none!important}body.kd-on[data-kd-part="ads"] #admin-revenue-control{display:none!important}',
    'body.kd-on[data-kd-view="v:harvest"] #kr-root{display:none!important}',
    '#kd-viewbar{display:none}body.kd-on #kd-viewbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}',
    '#kd-viewbar .kd-vt{font-size:22px;font-weight:900;color:#0f172a;margin-right:6px}#kd-viewbar .kd-vchips{display:flex;gap:6px;flex-wrap:wrap}',
    '#kd-viewbar .kd-vc{border:1px solid #cbd5e1;background:#fff;border-radius:999px;padding:6px 12px;font-size:13px;font-weight:800;cursor:pointer;color:#0f172a}#kd-viewbar .kd-vc.on{background:#15603f;border-color:#15603f;color:#fff}',
    '@media(max-width:700px){#kd-viewbar .kd-vt{font-size:18px;width:100%}#kd-viewbar .kd-vchips{flex-wrap:nowrap;overflow-x:auto;width:100%;padding-bottom:4px}#kd-viewbar .kd-vc{white-space:nowrap}}'
  ].join('\n');
  function injectCss() { if (q('#kd-css')) return; var st = document.createElement('style'); st.id = 'kd-css'; st.textContent = CSS; document.head.appendChild(st); }
  function adminVisible() { var b = q('#admin-body'); var pg = q('#page-admin-dashboard'); return !!(b && !b.classList.contains('hidden') && pg && pg.offsetParent !== null); }
  function currentTab() { try { return typeof activeAdminWorkflowTab !== 'undefined' ? activeAdminWorkflowTab : S.tab; } catch (x) { return S.tab; } }
  // Review queues are views of the one "review" tab: review:found, review:agent, review:stays.
  function setReviewKind(k) { S.reviewKind = k; document.body.setAttribute('data-kd-review', k); }
  function setPart(view, idx) {
    S.view = view || null; S.part = view ? idx : 0;
    var pt = view ? VIEWS[view][idx] : null;
    if (view) document.body.setAttribute('data-kd-view', view); else document.body.removeAttribute('data-kd-view');
    if (pt && pt[2]) document.body.setAttribute('data-kd-part', pt[2]); else document.body.removeAttribute('data-kd-part');
  }
  function go(tab, idx) {
    closeDrawer();
    tab = String(tab || '');
    if (VIEWS[tab]) {
      var i = Math.max(0, Math.min(VIEWS[tab].length - 1, Number(idx) || 0)); var pt = VIEWS[tab][i];
      setPart(tab, i);
      if (pt[2] === 'legacy') { document.body.classList.add('kr-legacy'); tab = 'review:found'; }
      else { document.body.classList.remove('kr-legacy'); tab = pt[1]; }
    } else {
      document.body.classList.remove('kr-legacy');
      var h = HOME[tab]; setPart(h ? h[0] : null, h ? h[1] : 0);
    }
    var m = /^review:(found|agent|stays)$/.exec(tab);
    if (m) { setReviewKind(m[1]); tab = 'review'; if (typeof window.closeAdminReviewPanel === 'function') window.closeAdminReviewPanel(); }
    if (typeof window.setAdminWorkflowTab === 'function') { var was = currentTab(); window.setAdminWorkflowTab(tab); if (was === tab) onTab(tab); } else { S.tab = tab; onTab(tab); }
    try { window.scrollTo({ top: 0 }); } catch (x) { window.scrollTo(0, 0); }
  }
  function itemOn(id, tab) {
    if (/^review:/.test(id)) return tab === 'review' && !S.view && id === 'review:' + (S.reviewKind || 'found');
    if (VIEWS[id]) return S.view === id;
    return !S.view && id === tab;
  }
  // The old code sometimes switches tab by itself (after an approval it opens Live & featured):
  // keep the sidebar and chips in step with the tab actually showing.
  function syncView(tab) {
    if (S.view) { var pt = VIEWS[S.view][S.part]; if (pt && (pt[1] === tab || (pt[2] === 'legacy' && tab === 'review'))) return; }
    var h = HOME[tab]; setPart(h ? h[0] : null, h ? h[1] : 0);
    if (tab !== 'review') document.body.classList.remove('kr-legacy');
  }
  function drawViewbar() {
    var bar = q('#kd-viewbar');
    if (!bar) { var anchor = q('#king-overview'); if (!anchor) return; bar = document.createElement('div'); bar.id = 'kd-viewbar'; anchor.parentNode.insertBefore(bar, anchor); }
    if (!S.view) { bar.innerHTML = ''; bar.style.display = 'none'; return; }
    bar.style.display = '';
    bar.innerHTML = '<div class="kd-vt">' + esc(LABEL[S.view]) + '</div><div class="kd-vchips">' + VIEWS[S.view].map(function (pt, i) {
      return '<button type="button" class="kd-vc' + (i === S.part ? ' on' : '') + '" data-kd-part-go="' + i + '">' + esc(pt[0]) + '</button>';
    }).join('') + '</div>';
    qa('[data-kd-part-go]', bar).forEach(function (b) { b.onclick = function () { go(S.view, Number(b.getAttribute('data-kd-part-go'))); }; });
  }
  window.kingDeskGo = go;
  // The sidebar starts below whatever is pinned at the top (the site header), or below
  // the page's own top while the strips above it are still on screen.
  function headerHeight() {
    var pinned = 0;
    qa('header, nav, body > div, body > header, [class*="sticky"], [class*="fixed"]').forEach(function (el) {
      if (el.id === 'kd-side' || el.id === 'kd-top' || el.id === 'kd-scrim' || el.closest('#kd-side')) return;
      var cs = getComputedStyle(el); if (cs.position !== 'sticky' && cs.position !== 'fixed') return;
      var r = el.getBoundingClientRect(); if (r.top <= 1 && r.bottom > 0 && r.bottom < 220 && r.width > window.innerWidth * 0.6) pinned = Math.max(pinned, r.bottom);
    });
    var pg = q('#page-admin-dashboard'); var pt = pg ? pg.getBoundingClientRect().top : 0;
    return Math.round(Math.max(pinned, Math.min(pt, 260), 0)) || 64;
  }
  // ...and stops where the dashboard ends, so it never covers anything below it.
  function bottomGap() { var pg = q('#page-admin-dashboard'); if (!pg) return 0; var r = pg.getBoundingClientRect(); if (!r.height) return 0; return Math.max(0, Math.round(window.innerHeight - r.bottom)); }
  function placeSide() { var st = document.documentElement.style; st.setProperty('--kd-top', headerHeight() + 'px'); st.setProperty('--kd-bot', bottomGap() + 'px'); }
  // King's first name: the shared account is "MakaUg Super Admin", which is Arthur. Never "MakaUg".
  function kingName() { if (window.makaugDeskShell) return window.makaugDeskShell.kingName(); var t = ((q('#admin-dashboard-name') || {}).textContent || '').trim().split(' ')[0]; return t && !/^(makaug|admin|king)$/i.test(t) ? t : 'King'; }
  function sideHtml() {
    var tab = currentTab();
    var who = kingName();
    return '<div class="kd-me"><div class="kd-av">' + esc((who.trim()[0] || 'K').toUpperCase()) + '</div><div><b>' + esc(who) + '</b><div style="font-size:12px;color:#86b39a">King · manager</div></div></div>'
      + NAV.map(function (g) {
        return '<div class="kd-g">' + esc(g[0]) + '</div>' + g[1].map(function (i) {
          var n = i[3] ? Number(S.counts[i[3]] || 0) : 0;
          return '<button type="button" class="kd-i' + (itemOn(i[0], tab) ? ' on' : '') + '" data-kd-go="' + i[0] + '"><span>' + i[1] + '</span><span>' + esc(i[2]) + '</span>' + (n ? '<span class="kd-b" data-kd-badge="' + i[3] + '">' + n + '</span>' : '') + '</button>';
        }).join('');
      }).join('')
      + '<div class="kd-foot"><button type="button" class="kd-i" data-kd-refresh><span>🔄</span><span>Refresh</span></button><button type="button" class="kd-i" data-kd-account><span>⚙️</span><span>Account settings</span></button></div>';
  }
  function drawSide() {
    var side = q('#kd-side'); if (!side) return;
    side.innerHTML = sideHtml();
    qa('[data-kd-go]', side).forEach(function (b) { b.onclick = function () { go(b.getAttribute('data-kd-go')); }; });
    var rf = q('[data-kd-refresh]', side); if (rf) rf.onclick = function () { closeDrawer(); if (typeof window.renderAdminDashboard === 'function') window.renderAdminDashboard(); onTab(currentTab(), true); };
    var ac = q('[data-kd-account]', side); if (ac) ac.onclick = function () { closeDrawer(); if (typeof window.showPage === 'function') window.showPage('account'); };
    var top = q('#kd-top-title'); if (top) top.textContent = (S.view ? LABEL[S.view] : currentTab() === 'review' ? LABEL['review:' + (S.reviewKind || 'found')] : LABEL[currentTab()]) || 'King';
  }
  function openDrawer() { document.body.classList.add('kd-drawer'); }
  function closeDrawer() { document.body.classList.remove('kd-drawer'); }
  function mount() {
    if (S.mounted) return; S.mounted = true; injectCss();
    var side = document.createElement('aside'); side.id = 'kd-side'; side.setAttribute('aria-label', 'King menu'); document.body.appendChild(side);
    var scrim = document.createElement('div'); scrim.id = 'kd-scrim'; scrim.onclick = closeDrawer; document.body.appendChild(scrim);
    var body = q('#admin-body');
    var top = document.createElement('div'); top.id = 'kd-top'; top.innerHTML = '<button type="button" data-kd-menu aria-label="Open King menu">☰</button><span id="kd-top-title">Overview</span>';
    body.parentNode.insertBefore(top, body);
    q('[data-kd-menu]', top).onclick = openDrawer;
    document.addEventListener('makaug:admin-tab', function (e) { S.tab = e.detail && e.detail.tab; onTab(S.tab); });
    var placing = false; var onMove = function () { if (placing) return; placing = true; requestAnimationFrame(function () { placing = false; if (document.body.classList.contains('kd-on')) placeSide(); }); };
    window.addEventListener('resize', onMove); window.addEventListener('scroll', onMove, { passive: true });
    placeSide();
    refreshCounts();
    setInterval(function () { if (adminVisible() && !document.hidden) refreshCounts(); }, 60000);
    setInterval(function () { if (document.body.classList.contains('kd-on')) placeSide(); }, 1500); // content height changes without a scroll
    var t = currentTab();
    // King lands on Overview, unless a link asked for a tab.
    if (!/[?&#](tab|section)=/.test(location.search + location.hash) && (t === 'review' || !t)) go('k-overview'); else onTab(t);
  }
  function refreshCounts() {
    return api('/king/overview').then(function (o) { S.counts = o.counts || {}; if (window.kingReview) window.kingReview.counts(S.counts); S.overview = o; drawSide(); if (currentTab() === 'k-overview') drawOverview(o); }, function () { drawSide(); });
  }
  function onTab(tab, force) {
    syncView(tab);
    drawSide(); drawViewbar();
    clearInterval(S.timer); S.timer = null;
    if (tab === 'k-overview') { if (S.overview && !force) drawOverview(S.overview); refreshCounts(); S.timer = setInterval(function () { if (!document.hidden) refreshCounts(); }, 60000); }
    if (tab === 'k-payments') { loadPayments(); S.timer = setInterval(function () { if (!document.hidden) loadPayments(true); }, 30000); }
    if (tab === 'k-removals') loadRemovals();
    if (tab === 'whatsapp' && document.body.getAttribute('data-kd-part') === 'seekers' && typeof window.loadKingHomeSeekers === 'function') window.loadKingHomeSeekers();
    if (tab === 'review') { setReviewKind(S.reviewKind || 'found'); if (window.kingReview) window.kingReview.show(S.reviewKind); }
    else document.body.removeAttribute('data-kd-review');
  }
  // ------------------------------------------------------------- overview --
  function trend(cur, prev, unit) {
    if (prev == null) return '';
    var d = cur - prev;
    if (!d) return '<span class="kd-flat">same as ' + unit + '</span>';
    return '<span class="' + (d > 0 ? 'kd-up' : 'kd-down') + '">' + (d > 0 ? '▲ ' : '▼ ') + Math.abs(d).toLocaleString('en-GB') + ' vs ' + unit + '</span>';
  }
  // This week (green) next to last week (grey), with a legend. Before calls were tracked, last week
  // has no data: the chart says "not tracked" instead of drawing empty bars that read as zero.
  function weekChart(a, b, untracked) {
    var max = Math.max.apply(null, a.concat(untracked ? [] : b).concat([1])); var days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    var W = 560, H = 170, base = 140, slot = W / 7;
    var bars = days.map(function (d, i) {
      var x = i * slot + slot / 2; var h1 = Math.round(110 * b[i] / max); var h2 = Math.round(110 * a[i] / max);
      var last = untracked
        ? '<rect x="' + (x - 20) + '" y="' + (base - 110) + '" width="17" height="110" rx="3" fill="url(#kd-hatch)" stroke="#cbd5e1" stroke-dasharray="3 3"><title>Last week ' + d + ': not tracked</title></rect>'
        : '<rect x="' + (x - 20) + '" y="' + (base - h1) + '" width="17" height="' + h1 + '" rx="3" fill="#94a3b8"><title>Last week ' + d + ': ' + b[i] + '</title></rect>';
      return last + '<rect x="' + (x + 2) + '" y="' + (base - h2) + '" width="17" height="' + h2 + '" rx="3" fill="#15603f"><title>This week ' + d + ': ' + a[i] + '</title></rect>'
        + (a[i] ? '<text x="' + (x + 10) + '" y="' + (base - h2 - 4) + '" font-size="10" text-anchor="middle" fill="#0f172a" font-weight="700">' + a[i] + '</text>' : '')
        + '<text x="' + x + '" y="' + (base + 16) + '" font-size="11" text-anchor="middle" fill="#64748b">' + d + '</text>';
    }).join('');
    var defs = '<defs><pattern id="kd-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#f8fafc"/><line x1="0" y1="0" x2="0" y2="6" stroke="#e2e8f0" stroke-width="3"/></pattern></defs>';
    var stamp = untracked ? '<g data-kd-lw-untracked><rect x="' + (W / 2 - 150) + '" y="34" width="300" height="24" rx="12" fill="#fff" stroke="#cbd5e1"/><text x="' + (W / 2) + '" y="50" font-size="12" text-anchor="middle" fill="#475569" font-weight="700">Last week: not tracked (calling screen started later)</text></g>' : '';
    var key = function (style, label) { return '<span style="display:inline-flex;align-items:center;gap:6px;margin-right:14px"><span style="display:inline-block;width:12px;height:12px;border-radius:3px;' + style + '"></span>' + label + '</span>'; };
    return '<div class="kd-muted" style="font-size:12px;font-weight:700;margin:-4px 0 6px" data-kd-legend>' + key('background:#15603f', 'This week') + key(untracked ? 'background:#f8fafc;border:1px dashed #94a3b8' : 'background:#94a3b8', 'Last week' + (untracked ? ' (not tracked)' : '')) + '</div>'
      + '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Team calls this week vs last week" data-kd-weekchart>' + defs + bars + stamp + '</svg>';
  }
  function funnel(p) {
    var steps = [['Contacted', p.contacted, '#15603f'], ['Interested', p.interested, '#1f8a5c'], ['Said Hi on WhatsApp', p.said_hi, '#2f9e6b'], ['Agent submitted', p.submitted, '#d97706'], ['Approved', p.approved, '#c2410c'], ['Paid = Closed', p.paid, '#be123c']];
    var max = Math.max.apply(null, steps.map(function (s) { return s[1]; }).concat([1]));
    return '<div class="kd-funnel" data-kd-funnel>' + steps.map(function (s) { return '<div><label>' + esc(s[0]) + '</label><span class="n" style="background:' + s[2] + ';width:' + Math.max(28, Math.round(160 * s[1] / max)) + 'px">' + s[1] + '</span></div>'; }).join('') + '<p class="kd-muted" style="font-size:12px;margin:6px 0 0" data-kd-funnel-note>Each step counts only the people who passed the step above, from calls this month.' + (p.other_submitted ? ' Plus ' + p.other_submitted + ' agent' + (p.other_submitted === 1 ? '' : 's') + ' signed up without a call (' + (p.other_approved || 0) + ' approved).' : '') + (p.paid_all != null && p.paid_all !== p.paid ? ' All paid agents this month: ' + p.paid_all + '.' : '') + ' Only “Paid” counts as closed, for commission and reports.</p></div>';
  }
  function dayShort(d) { var p = String(d || '').split('-'); var M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']; return p.length === 3 ? Number(p[2]) + ' ' + M[Number(p[1]) - 1] : ''; }
  function greet() { var h = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Africa/Kampala' }).format(new Date())); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; }
  function drawOverview(o) {
    var el = q('#king-overview'); if (!el) return;
    var who = kingName();
    var c = o.counts || {};
    var cw = o.calls_week || {}; var ln = o.live_notes || {};
    var needs = (o.needs_you || []).map(function (n) {
      return '<div class="kd-need" data-kd-need="' + esc(n.kind) + '"><span class="kd-tag ' + esc(n.kind) + '">' + esc({ removal: 'Removal', momo: 'MoMo', flag: 'Flag', behind: 'Behind', low_list: 'Low list', remove: 'Remove?' }[n.kind] || n.kind) + '</span><span class="t">' + esc(n.text) + '</span><button type="button" class="kd-link" data-kd-open="' + esc(n.open) + '">Open</button></div>';
    }).join('') || '<p class="kd-muted" data-kd-needs-empty>Nothing waiting for you. 🎉</p>';
    var staff = (o.staff_today || []).map(function (s) {
      var pct = s.target_calls ? Math.min(100, Math.round(100 * s.calls / s.target_calls)) : 0;
      return '<tr data-kd-staffrow="' + esc(s.person_key) + '"><td><b>' + esc(s.name) + '</b>' + (s.live && s.live.label ? '<div class="kd-muted" style="font-size:11px">' + esc(s.live.label) + '</div>' : '') + '</td><td>' + s.calls + '</td><td><div class="kd-row" style="flex-wrap:nowrap;gap:6px"><div class="kd-bar" style="flex:1"><i style="width:' + pct + '%"></i></div><span class="kd-muted" style="font-size:11px">' + s.calls + '/' + s.target_calls + '</span></div></td><td>' + s.paid + '</td><td>' + (s.notes_pct == null ? '—' : (s.notes_pct >= 90 ? '✅ ' : '⚠️ ') + s.notes_pct + '%') + '</td><td data-kd-away>' + (s.away_min >= 15 ? '⚠️ ' : '') + s.away_min + ' min' + (s.exits ? ' <span class="kd-muted" style="font-size:11px">' + s.exits + '× left' + (s.away_on_call_min ? ', ' + s.away_on_call_min + ' min on calls' : '') + '</span>' : '') + '</td></tr>';
    }).join('') || '<tr><td colspan="6" class="kd-muted">Nobody has called today yet.</td></tr>';
    el.innerHTML = '<div class="kd-page" data-kd-overview>'
      + '<div class="kd-row"><div><h1 class="kd-h1">' + esc(greet()) + ', ' + esc(who) + ' 👑</h1><p class="kd-sub">' + esc(new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Africa/Kampala' }).format(new Date())) + ' · everything the team did, and what needs you</p></div>'
      + '<div class="kd-chips">' + (c.removal_requests ? '<button type="button" class="kd-chip red" data-kd-open="k-removals">' + c.removal_requests + ' removal request' + (c.removal_requests === 1 ? '' : 's') + '</button>' : '') + (c.momo_unmatched ? '<button type="button" class="kd-chip amber" data-kd-open="k-payments">' + c.momo_unmatched + ' MoMo text' + (c.momo_unmatched === 1 ? '' : 's') + ' to match</button>' : '') + (c.behind ? '<button type="button" class="kd-chip grey" data-kd-open="k-team">' + c.behind + ' behind target</button>' : '') + (c.targets_unset ? '<button type="button" class="kd-chip amber" data-kd-open="k-staff" data-kd-chip="targets">☀️ Set today\'s targets (' + c.targets_unset + ')</button>' : '') + '</div></div>'
      + '<div class="kd-kpis">'
      + '<div class="kd-card kd-kpi" data-kd-kpi="money"><div class="l">Money in this month</div><div class="v">' + esc(ugx(o.money_month.ugx)) + '</div>' + trend(o.money_month.ugx, o.money_month.prev_ugx, 'last month so far').replace(/▲ ([\d,]+)/, function (m, n) { return '▲ ' + esc(ugx(Number(n.replace(/,/g, '')))); }).replace(/▼ ([\d,]+)/, function (m, n) { return '▼ ' + esc(ugx(Number(n.replace(/,/g, '')))); }) + '</div>'
      + '<div class="kd-card kd-kpi" data-kd-kpi="paid"><div class="l">Paid agents (closed)</div><div class="v">' + o.paid_agents_month.n + '</div>' + trend(o.paid_agents_month.n, o.paid_agents_month.prev, 'last month so far') + '</div>'
      + '<div class="kd-card kd-kpi" data-kd-kpi="calls"><div class="l">Calls this week</div><div class="v">' + cw.n + '</div>' + (o.tracking_since && !o.last_week_tracked ? '<span class="kd-flat" data-kd-untracked>last week not tracked (calls tracked from ' + esc(dayShort(o.tracking_since)) + ')</span>' : cw.change_pct == null ? '<span class="kd-flat">no calls last week</span>' : '<span class="' + (cw.change_pct >= 0 ? 'kd-up' : 'kd-down') + '">' + (cw.change_pct >= 0 ? '▲ ' : '▼ ') + Math.abs(cw.change_pct) + '% vs last week</span>') + '</div>'
      + '<div class="kd-card kd-kpi" data-kd-kpi="notes"><div class="l">Calls with live notes</div><div class="v">' + (ln.pct == null ? '—' : ln.pct + '%') + '</div>' + (ln.flagged ? '<span class="kd-down">' + ln.flagged + ' call' + (ln.flagged === 1 ? '' : 's') + ' flagged ⚠</span>' : '<span class="kd-flat">this week</span>') + '</div>'
      + '</div>'
      + '<div class="kd-grid2"><div class="kd-card"><h3>Team calls · this week vs last week</h3>' + weekChart(cw.this_week || [0, 0, 0, 0, 0, 0, 0], cw.last_week || [0, 0, 0, 0, 0, 0, 0], !!(o.tracking_since && !o.last_week_tracked)) + (o.tracking_since && !o.last_week_tracked ? '<p class="kd-muted" style="font-size:12px;margin:6px 0 0" data-kd-week-note>Last week shows “not tracked” because the calling screen only started recording calls on ' + esc(dayShort(o.tracking_since)) + '. They appear from next week.</p>' : '') + '</div><div class="kd-card"><h3>Pipeline this month</h3>' + funnel(o.pipeline || {}) + '</div></div>'
      + '<div class="kd-grid2b"><div class="kd-card" data-kd-needs><h3>Needs you</h3>' + needs + '</div>'
      + '<div class="kd-card"><h3>Staff today</h3><div class="kd-scroll"><table class="kd-table" data-kd-staff><tr><th>Who</th><th>Calls</th><th>Target</th><th>Paid</th><th>Notes on</th><th title="Time the calling screen was hidden or switched away today">Away</th></tr>' + staff + '</table></div></div></div>'
      + '<p class="kd-muted" style="font-size:11px;margin-top:8px" data-kd-updated>Updated ' + esc(when(new Date())) + ' Kampala · refreshes every minute</p></div>';
    bindOpen(el);
    qa('[data-kd-person]', el).forEach(function (b) { b.onclick = function () { if (window.kingTeam) window.kingTeam.openPerson(b.getAttribute('data-kd-person')); }; });
    qa('[data-kd-staffrow]', el).forEach(function (r) { r.style.cursor = 'pointer'; r.title = 'Open their day'; r.onclick = function () { if (window.kingTeam) window.kingTeam.openPerson(r.getAttribute('data-kd-staffrow')); }; });
  }
  function bindOpen(el) { qa('[data-kd-open]', el).forEach(function (b) { b.onclick = function () { go(b.getAttribute('data-kd-open')); }; }); }
  // -------------------------------------------------------------- payments --
  function loadPayments(silent) {
    var el = q('#king-payments'); if (!el) return;
    if (!silent) el.innerHTML = '<div class="kd-page"><p class="kd-muted">Loading payments…</p></div>';
    api('/king/payments?days=30').then(function (p) {
      S.counts.momo_unmatched = p.unmatched; drawSide();
      var fwd = p.forwarder_last_seen && (Date.now() - new Date(p.forwarder_last_seen).getTime()) < 48 * 3600000;
      var ent = (p.entries || []).map(function (e) { return '<tr data-kd-entry><td>' + esc(when(e.at)) + '</td><td><b>' + esc(ugxFull(e.amount_ugx)) + '</b></td><td>' + esc(e.who || '—') + ' <span class="kd-muted">' + esc(e.phone) + '</span></td><td>' + esc(String(e.method || '').replace(/_/g, ' ')) + '</td><td>' + (e.verified === 'verified' ? '<span class="kd-tag ok">verified</span>' : '<span class="kd-tag momo">' + esc(e.verified || 'unverified') + '</span>') + (e.from_sms ? ' <span class="kd-tag flag">from SMS</span>' : '') + '</td></tr>'; }).join('') || '<tr><td colspan="5" class="kd-muted">No payments recorded in the last 30 days.</td></tr>';
      var sms = (p.sms || []).map(function (s) { return '<tr data-kd-sms="' + (s.matched ? 'matched' : 'unmatched') + '"><td>' + esc(when(s.at)) + '</td><td><b>' + esc(ugxFull(s.amount_ugx)) + '</b></td><td>' + esc(s.from || '—') + '</td><td>' + (s.matched ? '<span class="kd-tag ok">✓ matched · marked paid</span>' : '<span class="kd-tag momo">needs matching</span> <button type="button" class="kd-link" data-kd-open="revenue">Match</button>') + '</td></tr>'; }).join('') || '<tr><td colspan="4" class="kd-muted">No MoMo texts in the last 30 days.</td></tr>';
      el.innerHTML = '<div class="kd-page" data-kd-payments>'
        + '<div class="kd-row"><div><h1 class="kd-h1">💳 Payments & MoMo</h1><p class="kd-sub">Money in, and every MoMo text the forwarder phone sends us. Refreshes every 30 seconds.</p></div><button type="button" class="kd-btn ghost" data-kd-open="revenue">Open Sales & revenue</button></div>'
        + '<div class="kd-kpis"><div class="kd-card kd-kpi"><div class="l">Today</div><div class="v">' + esc(ugx(p.totals.today)) + '</div></div><div class="kd-card kd-kpi"><div class="l">This week</div><div class="v">' + esc(ugx(p.totals.week)) + '</div></div><div class="kd-card kd-kpi"><div class="l">This month</div><div class="v">' + esc(ugx(p.totals.month)) + '</div></div>'
        + '<div class="kd-card kd-kpi" data-kd-forwarder="' + (fwd ? 'ok' : 'off') + '"><div class="l">MoMo forwarder</div><div class="v" style="font-size:18px">' + (fwd ? '🟢 Working' : '🔴 Not sending') + '</div><span class="kd-flat">Last text: ' + esc(ago(p.forwarder_last_seen)) + ' · link key ' + (p.token_configured ? 'set ✓' : 'missing') + '</span></div></div>'
        + (fwd ? '' : '<div class="kd-card" style="border-color:#fcd34d;background:#fffbeb;margin-bottom:12px" data-kd-fwdhelp><b>No MoMo texts are reaching makaug yet.</b> On the MoMo phone, open the staff desk → 📱 Connect your phone → 💰 MoMo forwarder, and follow the 4 pictures. When it works, each payment text appears here within a minute and the agent is marked Paid.</div>')
        + '<div class="kd-grid2b"><div class="kd-card"><h3>MoMo texts received' + (p.unmatched ? ' · <span class="kd-down">' + p.unmatched + ' to match</span>' : '') + '</h3><div class="kd-scroll"><table class="kd-table" data-kd-smslist><tr><th>When</th><th>Amount</th><th>From</th><th></th></tr>' + sms + '</table></div></div>'
        + '<div class="kd-card"><h3>Payments recorded</h3><div class="kd-scroll"><table class="kd-table" data-kd-entries><tr><th>When</th><th>Amount</th><th>Who</th><th>How</th><th></th></tr>' + ent + '</table></div></div></div>'
        + '<p class="kd-muted" style="font-size:11px;margin-top:8px">Updated ' + esc(when(new Date())) + ' Kampala · last 30 days</p></div>';
      bindOpen(el);
    }, function (e) { if (!silent) el.innerHTML = '<div class="kd-page"><div class="kd-card" style="color:#be123c">' + esc(e.message) + '</div></div>'; });
  }
  // -------------------------------------------------------------- removals --
  function loadRemovals() {
    var el = q('#king-removals'); if (!el) return;
    el.innerHTML = '<div class="kd-page"><p class="kd-muted">Loading removal requests…</p></div>';
    api('/agent-removal-requests?status=all').then(function (list) {
      list = Array.isArray(list) ? list : [];
      var open = list.filter(function (r) { return r.status === 'open'; }); var done = list.filter(function (r) { return r.status !== 'open'; }).slice(0, 30);
      S.counts.removal_requests = open.length; drawSide();
      var row = function (r, isOpen) {
        return '<div class="kd-need" data-kd-req="' + esc(r.id) + '"><span class="kd-tag ' + (isOpen ? 'removal' : r.status === 'approved' ? 'ok' : 'flag') + '">' + esc(isOpen ? 'Open' : r.status === 'approved' ? 'Removed' : 'Declined') + '</span><span class="t"><b>' + esc(r.agent_name || 'Agent') + '</b> · ' + esc(r.reason_label || r.reason_code) + ' · “' + esc(r.note) + '”<div class="kd-muted" style="font-size:12px">Asked by ' + esc(r.requested_by_name || 'staff') + ' · ' + esc(when(r.created_at)) + (r.decided_at ? ' · decided ' + esc(when(r.decided_at)) + (r.decision_note ? ' · “' + esc(r.decision_note) + '”' : '') : '') + '</div></span>'
          + (isOpen ? '<button type="button" class="kd-btn" data-kd-remopen="' + esc(r.agent_id) + '">Open agent to remove</button><button type="button" class="kd-btn ghost" data-kd-decline="' + esc(r.id) + '">Decline</button>' : '') + '</div>';
      };
      el.innerHTML = '<div class="kd-page" data-kd-removals><h1 class="kd-h1">🗑️ Removal requests</h1><p class="kd-sub">Staff can’t remove agents. They ask here with a reason; only you remove or decline.</p>'
        + '<div class="kd-card" style="margin-top:12px"><h3>Waiting for you (' + open.length + ')</h3>' + (open.map(function (r) { return row(r, true); }).join('') || '<p class="kd-muted" data-kd-noreq>No open requests.</p>') + '</div>'
        + '<div class="kd-card" style="margin-top:12px"><h3>Decided</h3>' + (done.map(function (r) { return row(r, false); }).join('') || '<p class="kd-muted">Nothing decided yet.</p>') + '</div></div>';
      qa('[data-kd-remopen]', el).forEach(function (b) { b.onclick = function () { var id = b.getAttribute('data-kd-remopen'); go('agents'); setTimeout(function () { if (typeof window.adminAgentManagerOpen === 'function') window.adminAgentManagerOpen(id); }, 300); }; });
      qa('[data-kd-decline]', el).forEach(function (b) {
        b.onclick = function () {
          var note = window.prompt('Why decline? (staff will see this)', 'Keep the agent'); if (note === null) return;
          api('/agent-removal-requests/' + encodeURIComponent(b.getAttribute('data-kd-decline')) + '/decline', { method: 'POST', body: { note: note } }).then(loadRemovals, function (e) { window.alert('Decline failed: ' + e.message); });
        };
      });
    }, function (e) { el.innerHTML = '<div class="kd-page"><div class="kd-card" style="color:#be123c">' + esc(e.message) + '</div></div>'; });
  }
  // ---------------------------------------------------------------- mount --
  function scan() {
    var on = adminVisible();
    if (on && !S.mounted) mount();
    document.body.classList.toggle('kd-on', on);
    if (on) placeSide();
    if (!on) closeDrawer();
  }
  var pending = false;
  new MutationObserver(function () { if (pending) return; pending = true; setTimeout(function () { pending = false; scan(); }, 200); }).observe(document.body, { attributes: true, attributeFilter: ['class'], subtree: true });
  scan();
  window.kingDesk = { refresh: function () { onTab(currentTab(), true); }, go: go, refreshCounts: refreshCounts, setBadges: function (c) { for (var k in c) S.counts[k] = c[k]; drawSide(); }, util: { api: api, esc: esc, when: when, ago: ago, ugx: ugx, ugxFull: ugxFull, q: q, qa: qa, currentTab: currentTab } };
})();
