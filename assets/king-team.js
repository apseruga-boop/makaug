/* King · Team performance (Arthur, 21 Nov 2026).
 * Team list -> one person's page: refreshes every 30s, compares today with any
 * other day (side by side or overlaid), this week vs last week and this month
 * vs last month, keeps the full evidence trail, and opens any call (blue bar)
 * with its transcript, outcome, follow-up, actions, drop-offs and lessons. */
(function () {
  'use strict';
  if (window.kingTeam) return;
  var REFRESH_MS = 30000;
  var T = { person: null, cmp: 'yesterday', date: '', mode: 'side', timer: null, today: null, other: null, otherDay: '', sig: '', busy: false };
  var U = null; // shared helpers from king-desk.js
  function ready(fn) { if (window.kingDesk && window.kingDesk.util) { U = window.kingDesk.util; fn(); } else setTimeout(function () { ready(fn); }, 150); }
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  // Kampala is UTC+3 all year.
  var KMS = 3 * 3600000;
  function kDay(ms) { var d = new Date(ms + KMS); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function minOfDay(iso) { var d = new Date(new Date(iso).getTime() + KMS); return d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60; }
  function hhmm(m) { m = Math.round(m); return pad(Math.floor(m / 60) % 24) + ':' + pad(m % 60); }
  function nowClock() { var d = new Date(Date.now() + KMS); return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds()) + ' Kampala'; }
  function clock(iso) { return iso ? hhmm(minOfDay(iso)) : ''; }
  function dur(s) { s = Math.round(Number(s || 0)); if (s < 60) return s + 's'; var m = Math.round(s / 60); return m < 60 ? m + ' min' : Math.floor(m / 60) + 'h ' + pad(m % 60); }
  function niceDay(day) { if (!day) return ''; var today = kDay(Date.now()); if (day === today) return 'Today'; if (day === kDay(Date.now() - 864e5)) return 'Yesterday'; var p = day.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }); }
  function otherDay() {
    if (T.cmp === 'yesterday') return kDay(Date.now() - 864e5);
    if (T.cmp === 'lastweek') return kDay(Date.now() - 7 * 864e5);
    if (T.cmp === 'date') return T.date;
    return '';
  }
  var CSS = [
    '.kt-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px;margin-top:14px}',
    '.kt-card{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:14px;text-align:left;cursor:pointer;font:inherit;color:inherit}.kt-card:hover{border-color:#15603f;box-shadow:0 4px 14px rgba(21,96,63,.12)}',
    '.kt-card .n{font-size:17px;font-weight:900}.kt-live{display:inline-block;border-radius:999px;padding:2px 9px;font-size:11px;font-weight:800;background:#f1f5f9;color:#475569}.kt-live.on{background:#dcfce7;color:#166534}.kt-live.call{background:#dbeafe;color:#1d4ed8}',
    '.kt-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:10px;font-size:12px;color:#64748b}.kt-stats b{display:block;font-size:18px;color:#0f172a}',
    '.kt-ctl{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:12px 0}.kt-ctl .lbl{font-size:12px;font-weight:800;color:#64748b}.kt-pill{border:1px solid #cbd5e1;background:#fff;border-radius:999px;padding:6px 12px;font-size:13px;font-weight:700;cursor:pointer}.kt-pill.on{background:#15603f;border-color:#15603f;color:#fff}.kt-ctl input[type=date]{border:1px solid #cbd5e1;border-radius:10px;padding:5px 8px;font-size:13px}',
    '.kt-cmp{display:grid;grid-template-columns:repeat(5,1fr);gap:10px}@media(max-width:900px){.kt-cmp{grid-template-columns:repeat(2,1fr)}}',
    '.kt-m{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:10px}.kt-m .l{font-size:12px;color:#64748b;font-weight:700}.kt-m .v{font-size:22px;font-weight:900}.kt-m .o{font-size:12px;color:#7c3aed;font-weight:700}',
    '.kt-lanes{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}.kt-lanes.one{grid-template-columns:1fr}@media(max-width:900px){.kt-lanes{grid-template-columns:1fr}}',
    '.kt-lane svg{width:100%;height:auto;display:block}.kt-lane .cap{font-weight:900;font-size:14px;margin-bottom:6px}.kt-lane rect[data-kt-call]{cursor:pointer}.kt-lane rect[data-kt-call]:hover{stroke:#facc15;stroke-width:1.5}',
    '.kt-legend{display:flex;flex-wrap:wrap;gap:10px;font-size:12px;color:#475569;margin-top:6px}.kt-legend i{display:inline-block;width:12px;height:10px;border-radius:2px;margin-right:4px;vertical-align:middle}',
    '#kt-modal{position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:80;display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:30px 12px}',
    '#kt-modal .box{background:#fff;border-radius:18px;max-width:880px;width:100%;padding:18px;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;box-shadow:0 20px 60px rgba(0,0,0,.35)}',
    '#kt-modal h2{font-size:20px;font-weight:900;margin:0}#kt-modal h4{font-size:13px;font-weight:900;text-transform:uppercase;letter-spacing:.05em;color:#475569;margin:14px 0 6px}',
    '.kt-g2{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media(max-width:700px){.kt-g2{grid-template-columns:1fr}#kt-modal{padding:0}#kt-modal .box{border-radius:0;min-height:100vh}}',
    '.kt-tx{white-space:pre-wrap;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:10px;font-size:13px;max-height:220px;overflow:auto}',
    '.kt-list{list-style:none;margin:0;padding:0;font-size:13px}.kt-list li{padding:5px 0;border-bottom:1px solid #f1f5f9}.kt-list li b{display:inline-block;min-width:46px;color:#475569}',
    '.kt-theme{display:inline-block;background:#ede9fe;color:#5b21b6;border-radius:999px;padding:3px 10px;font-size:12px;font-weight:800;margin:0 4px 4px 0}',
    '.kt-out{display:inline-block;border-radius:8px;padding:3px 10px;font-weight:900;font-size:13px;background:#e2e8f0}.kt-out.paid{background:#dcfce7;color:#166534}.kt-out.bad{background:#ffe4e6;color:#be123c}',
    '#kt-modal textarea{width:100%;min-height:80px;border:1px solid #cbd5e1;border-radius:12px;padding:10px;font:inherit;font-size:14px}'
  ].join('\n');
  function css() { if (document.getElementById('kt-css')) return; var st = document.createElement('style'); st.id = 'kt-css'; st.textContent = CSS; document.head.appendChild(st); }
  function host() { return document.getElementById('king-team'); }
  function stop() { clearInterval(T.timer); T.timer = null; if (window.makaugCalling && window.makaugCalling.closeEvidence) window.makaugCalling.closeEvidence(); }

  // ------------------------------------------------------------- team list --
  function liveCls(l) { var s = (l && l.state) || ''; return s === 'on_call' ? 'call' : (s === 'working' || s === 'online' || s === 'open' || s === 'idle' ? 'on' : ''); }
  function drawTeam() {
    var el = host(); if (!el) return;
    if (!el.innerHTML) el.innerHTML = '<div class="kd-page"><p class="kd-muted">Loading the team…</p></div>';
    U.api('/calling/performance').then(function (p) {
      if (T.person) return;
      var people = (p.people || []); T.names = {}; people.forEach(function (x) { T.names[x.person_key] = x.name || x.person_key; });
      el.innerHTML = '<div class="kd-page" data-kt-team><div class="kd-row"><div><h1 class="kd-h1">Team performance</h1><p class="kd-sub">Today in Kampala · tap a person for their day, compare days and open any call</p></div><span class="kd-muted" style="font-size:12px" data-kt-upd>🟢 Updated ' + nowClock() + ' · auto every 30s</span></div>'
        + '<div class="kt-cards">' + (people.map(function (x) {
          var tgt = (x.targets && x.targets.calls_per_day) || 0; var pct = tgt ? Math.min(100, Math.round(100 * (x.calls || 0) / tgt)) : 0;
          return '<button type="button" class="kt-card" data-kt-person="' + U.esc(x.person_key) + '"><div class="kd-row"><span class="n">' + U.esc(x.name || x.person_key) + '</span><span class="kt-live ' + liveCls(x.live) + '">' + U.esc((x.live && x.live.label) || 'Not on') + '</span></div>'
            + '<div class="kt-stats"><div><b>' + (x.calls || 0) + (tgt ? '<span class="kd-muted" style="font-size:12px">/' + tgt + '</span>' : '') + '</b>calls</div><div><b>' + (x.connected || 0) + '</b>spoke</div><div><b>' + (x.closes || 0) + '</b>paid</div></div>'
            + '<div class="kd-bar" style="margin-top:8px"><i style="width:' + pct + '%"></i></div><div class="kd-muted" style="font-size:12px;margin-top:6px">Talk ' + dur(x.talk_s) + (x.flagged_calls ? ' · <span style="color:#be123c;font-weight:800">' + x.flagged_calls + ' flagged</span>' : '') + '</div></button>';
        }).join('') || '<div class="kd-card">No callers yet. Add staff in Staff, pay & targets.</div>') + '</div></div>';
      U.qa('[data-kt-person]', el).forEach(function (b) { b.onclick = function () { openPerson(b.getAttribute('data-kt-person')); }; });
    }, function (e) { el.innerHTML = '<div class="kd-page"><div class="kd-card" style="color:#be123c">' + U.esc(e.message) + '</div></div>'; });
  }

  // ------------------------------------------------------------ one person --
  // A session with no end: still open today, or on a past day it ended at its last heartbeat.
  function sessEnd(s) { if (s.ended_at) return s.ended_at; if (s.last_heartbeat_at && kDay(new Date(s.started_at).getTime()) !== kDay(Date.now())) return s.last_heartbeat_at; return s.last_heartbeat_at && Date.now() - new Date(s.last_heartbeat_at).getTime() > 10 * 60000 ? s.last_heartbeat_at : new Date().toISOString(); }
  function metrics(e) {
    var sm = (e && e.summary) || {};
    // Time on the screen is the union of sessions: two tabs open at once count once.
    var iv = ((e && e.sessions) || []).map(function (s) { return [new Date(s.started_at).getTime(), new Date(sessEnd(s)).getTime()]; }).sort(function (x, y) { return x[0] - y[0]; });
    var screen = 0, ce = -Infinity; iv.forEach(function (x) { var st = Math.max(x[0], ce); if (x[1] > st) { screen += x[1] - st; ce = x[1]; } }); screen /= 1000;
    var calls = ((e && e.on_call && e.on_call.calls) || []);
    return { calls: sm.calls || 0, connected: sm.connected || 0, closes: sm.closes || 0, talk_s: sm.talk_s || 0, screen_s: screen, first: calls.length ? calls[0].from : null };
  }
  function delta(a, b, fmt) {
    if (b == null) return '';
    var d = a - b; if (!d) return '<span class="kd-flat">same</span>';
    return '<span class="' + (d > 0 ? 'kd-up' : 'kd-down') + '">' + (d > 0 ? '▲ ' : '▼ ') + (fmt ? fmt(Math.abs(d)) : Math.abs(d)) + '</span>';
  }
  function cmpHtml(a, b, bLabel) {
    var m = function (label, key, fmt) { var av = a[key]; var bv = b ? b[key] : null; return '<div class="kt-m" data-kt-metric="' + key + '"><div class="l">' + label + '</div><div class="v">' + (fmt ? fmt(av) : av) + '</div>' + (b ? '<div class="o">' + U.esc(bLabel) + ': ' + (fmt ? fmt(bv) : bv) + ' ' + delta(av, bv, fmt) + '</div>' : '') + '</div>'; };
    return '<div class="kt-cmp" data-kt-kpis>' + m('Calls', 'calls') + m('Spoke to', 'connected') + m('Paid', 'closes') + m('Talk time', 'talk_s', dur) + m('On the screen', 'screen_s', dur) + '</div>';
  }
  // A day as lanes on a shared 24h-clock axis, so two days line up minute for minute.
  function span(days) {
    var lo = 24 * 60, hi = 0;
    days.forEach(function (e) { ((e && e.sessions) || []).forEach(function (s) { lo = Math.min(lo, minOfDay(s.started_at)); hi = Math.max(hi, minOfDay(sessEnd(s))); }); });
    if (hi <= lo) { lo = 8 * 60; hi = 18 * 60; }
    lo = Math.max(0, Math.floor(lo / 60) * 60); hi = Math.min(24 * 60, Math.max(lo + 120, Math.ceil(hi / 60) * 60));
    return [lo, hi];
  }
  function laneSvg(list, sp) {
    // list: [{ e, y, h, color: {screen, call, away}, faint }]
    var W = 640, L = 8, R = 8; var rows = Math.max.apply(null, list.map(function (x) { return x.y + x.h; })) + 22;
    var X = function (m) { return L + (W - L - R) * (m - sp[0]) / (sp[1] - sp[0]); };
    var f = function (v) { return v.toFixed(1); };
    var out = '';
    var step = (sp[1] - sp[0]) > 10 * 60 ? 120 : 60;
    for (var m = sp[0]; m <= sp[1]; m += step) out += '<line x1="' + f(X(m)) + '" y1="0" x2="' + f(X(m)) + '" y2="' + (rows - 16) + '" stroke="#eef2f7"/><text x="' + f(X(m)) + '" y="' + (rows - 4) + '" font-size="10" text-anchor="middle" fill="#64748b">' + hhmm(m) + '</text>';
    list.forEach(function (x) {
      var e = x.e || {}; var c = x.color; var op = x.faint ? ' opacity="0.45"' : '';
      (e.sessions || []).forEach(function (s) {
        var a = minOfDay(s.started_at), b = minOfDay(sessEnd(s));
        out += '<rect x="' + f(X(a)) + '" y="' + x.y + '" width="' + f(Math.max(2, X(b) - X(a))) + '" height="' + x.h + '" rx="3" fill="' + c.screen + '"' + op + '><title>' + U.esc(x.label + ' · on the screen ' + hhmm(a) + '–' + (s.ended_at ? hhmm(b) : 'now')) + '</title></rect>';
        var away = null;
        (e.events || []).filter(function (v) { return v.session_id === s.id; }).forEach(function (v) {
          if (v.kind === 'hidden' && v.detail !== 'in meeting') away = minOfDay(v.at);
          if (v.kind === 'visible' && away != null) { out += '<rect x="' + f(X(away)) + '" y="' + x.y + '" width="' + f(Math.max(1.5, X(minOfDay(v.at)) - X(away))) + '" height="' + x.h + '" fill="#f59e0b"' + op + '><title>Switched away ' + hhmm(away) + '–' + clock(v.at) + '</title></rect>'; away = null; }
        });
      });
      ((e.on_call && e.on_call.calls) || []).forEach(function (k) {
        var a = minOfDay(k.from), b = minOfDay(k.to);
        var na = k.outcome === 'no_answer';
        out += '<rect data-kt-call="' + U.esc(k.attempt_id) + '" x="' + f(X(a) - 1) + '" y="' + (x.y + 2) + '" width="' + f(Math.max(4, X(b) - X(a) + 2)) + '" height="' + (x.h - 4) + '" rx="1.5" fill="' + (na ? '#cbd5e1' : c.call) + '"' + op + '><title>' + U.esc(x.label + ' · call ' + hhmm(a) + (k.talk_s != null ? ' · ' + dur(k.talk_s) + ' talk' : '') + ' · ' + String(k.outcome || '').replace(/_/g, ' ') + ' · click to open') + '</title></rect>';
      });
    });
    return '<svg viewBox="0 0 ' + W + ' ' + rows + '" role="img" aria-label="Day timeline">' + out + '</svg>';
  }
  var COL_A = { screen: '#22c55e', call: '#1d4ed8' };
  var COL_B = { screen: '#c4b5fd', call: '#6d28d9' };
  function legend(two) {
    return '<div class="kt-legend"><span><i style="background:#22c55e"></i>On the screen</span><span><i style="background:#1d4ed8"></i>On a call (click to open)</span><span><i style="background:#cbd5e1"></i>No answer</span><span><i style="background:#f59e0b"></i>Switched away</span>' + (two ? '<span><i style="background:#c4b5fd"></i>Compared day</span><span><i style="background:#6d28d9"></i>Compared day call</span>' : '') + '</div>';
  }
  function lanesHtml() {
    var a = T.today; var b = T.other; var od = T.otherDay;
    var sp = span(b ? [a, b] : [a]);
    if (!b) return '<div class="kt-lanes one" data-kt-lanes="single"><div class="kd-card kt-lane"><div class="cap">Today</div>' + laneSvg([{ e: a, y: 4, h: 18, color: COL_A, label: 'Today' }], sp) + legend(false) + '</div></div>';
    if (T.mode === 'overlay') {
      return '<div class="kt-lanes one" data-kt-lanes="overlay"><div class="kd-card kt-lane"><div class="cap">Today over ' + U.esc(niceDay(od)) + '</div>'
        + laneSvg([{ e: b, y: 2, h: 26, color: COL_B, label: niceDay(od), faint: true }, { e: a, y: 8, h: 14, color: COL_A, label: 'Today' }], sp) + legend(true) + '</div></div>';
    }
    return '<div class="kt-lanes" data-kt-lanes="side"><div class="kd-card kt-lane" data-kt-lane="today"><div class="cap">Today</div>' + laneSvg([{ e: a, y: 4, h: 18, color: COL_A, label: 'Today' }], sp) + '</div>'
      + '<div class="kd-card kt-lane" data-kt-lane="other"><div class="cap">' + U.esc(niceDay(od)) + '</div>' + laneSvg([{ e: b, y: 4, h: 18, color: COL_B, label: niceDay(od) }], sp) + '</div></div>' + legend(true);
  }
  function periodsHtml(e) {
    var tr = (e && e.trends) || {};
    var row = function (unit, a, b) {
      var cur = (tr[unit] || [])[(tr[unit] || []).length - 1] || {}; var prev = (tr[unit] || [])[(tr[unit] || []).length - 2] || {};
      // Before the calling screen started recording, "0" means "no data", not "no calls".
      var since = e && e.tracking_since; var untracked = Boolean(since && prev.k && prev.k < since && !prev.calls && !prev.talk_s);
      var cell = function (key, fmt) { var x = cur[key] || 0, y = prev[key] || 0; if (untracked) return '<td><b>' + (fmt ? fmt(x) : x) + '</b> <span class="kd-muted" data-kt-untracked>vs not tracked</span></td>'; return '<td><b>' + (fmt ? fmt(x) : x) + '</b> <span class="kd-muted">vs ' + (fmt ? fmt(y) : y) + '</span> ' + delta(x, y, fmt) + '</td>'; };
      return '<tr data-kt-period="' + unit + '"><td><b>' + a + '</b><div class="kd-muted" style="font-size:11px">vs ' + b + '</div></td>' + cell('calls') + cell('connected') + cell('closes') + cell('talk_s', dur) + '</tr>';
    };
    return '<div class="kd-card" style="margin-top:12px"><h3>Week and month</h3><div class="kd-scroll"><table class="kd-table"><thead><tr><th></th><th>Calls</th><th>Spoke to</th><th>Paid</th><th>Talk time</th></tr></thead><tbody>'
      + row('week', 'This week', 'last week') + row('month', 'This month', 'last month') + '</tbody></table></div><p class="kd-muted" style="font-size:12px;margin:6px 0 0">This week and this month are so far; last week and last month are complete.' + (e && e.tracking_since ? ' Calls are recorded from ' + U.esc(niceDay(e.tracking_since)) + '; earlier periods show “not tracked”.' : '') + '</p></div>';
  }
  function personName() { var t = T.today || {}; return t.name || (T.names && T.names[T.person]) || T.person; }
  function drawPerson() {
    var el = host(); if (!el || !T.today) return;
    var od = T.otherDay;
    var cmpChips = [['yesterday', 'Yesterday'], ['lastweek', 'Same day last week'], ['date', 'Pick a day'], ['none', 'No compare']].map(function (c) { return '<button type="button" class="kt-pill' + (T.cmp === c[0] ? ' on' : '') + '" data-kt-cmp="' + c[0] + '">' + c[1] + '</button>'; }).join('');
    var keepEv = el.querySelector('[data-kt-evhost]');
    var html = '<div class="kd-page" data-kt-personpage="' + U.esc(T.person) + '">'
      + '<div class="kd-row"><div><button type="button" class="kd-link" data-kt-back>← All staff</button><h1 class="kd-h1">' + U.esc(personName()) + '</h1><p class="kd-sub">' + U.esc(niceDay(T.today.day)) + ' · Kampala time</p></div><span class="kd-muted" style="font-size:12px" data-kt-upd>🟢 Updated ' + nowClock() + ' · auto every 30s</span></div>'
      + '<div class="kt-ctl" data-kt-ctl><span class="lbl">Compare with</span>' + cmpChips + '<input type="date" data-kt-date value="' + U.esc(T.date) + '" max="' + kDay(Date.now()) + '"' + (T.cmp === 'date' ? '' : ' hidden') + '>'
      + (od ? '<span class="lbl" style="margin-left:8px">Show</span><button type="button" class="kt-pill' + (T.mode === 'side' ? ' on' : '') + '" data-kt-mode="side">Side by side</button><button type="button" class="kt-pill' + (T.mode === 'overlay' ? ' on' : '') + '" data-kt-mode="overlay">Overlaid</button>' : '') + '</div>'
      + cmpHtml(metrics(T.today), T.other ? metrics(T.other) : null, niceDay(od))
      + '<div data-kt-lanebox>' + lanesHtml() + '</div>'
      + periodsHtml(T.today)
      + '<div class="kd-card" style="margin-top:12px" data-kt-evcard><h3>Full evidence trail</h3><div data-kt-evslot></div></div></div>';
    if (keepEv) keepEv.parentNode.removeChild(keepEv);
    el.innerHTML = html;
    var slot = el.querySelector('[data-kt-evslot]');
    if (keepEv) slot.appendChild(keepEv);
    else { var h = document.createElement('div'); h.setAttribute('data-kt-evhost', ''); h.innerHTML = '<div data-k-evbox></div>'; slot.appendChild(h); if (window.makaugCalling && window.makaugCalling.evidence) window.makaugCalling.evidence(h, T.person); else slot.innerHTML = '<p class="kd-muted">Evidence trail is loading…</p>'; }
    el.querySelector('[data-kt-back]').onclick = function () { T.person = null; stop(); el.innerHTML = ''; drawTeam(); start(); };
    U.qa('[data-kt-cmp]', el).forEach(function (b) { b.onclick = function () { T.cmp = b.getAttribute('data-kt-cmp'); if (T.cmp === 'date' && !T.date) T.date = kDay(Date.now() - 2 * 864e5); loadOther(); }; });
    U.qa('[data-kt-mode]', el).forEach(function (b) { b.onclick = function () { T.mode = b.getAttribute('data-kt-mode'); drawPerson(); }; });
    var di = el.querySelector('[data-kt-date]'); if (di) di.onchange = function () { if (di.value) { T.date = di.value; T.cmp = 'date'; loadOther(); } };
    U.qa('[data-kt-call]', el).forEach(function (r) { r.addEventListener('click', function () { openCall(r.getAttribute('data-kt-call')); }); });
  }
  function ev(person, day) { return U.api('/calling/evidence?person_key=' + encodeURIComponent(person) + (day ? '&day=' + encodeURIComponent(day) : '')); }
  function loadToday(silent) {
    if (!T.person || T.busy) return Promise.resolve();
    T.busy = true; var who = T.person;
    return ev(who).then(function (e) {
      T.busy = false; if (T.person !== who) return;
      var sig = JSON.stringify([e.summary, e.sessions, e.on_call, e.events && e.events.length]);
      T.today = e;
      if (silent && sig === T.sig) { var u = host() && host().querySelector('[data-kt-upd]'); if (u) u.textContent = '🟢 Updated ' + nowClock() + ' · auto every 30s'; return; }
      T.sig = sig; drawPerson();
    }, function (err) { T.busy = false; var u = host() && host().querySelector('[data-kt-upd]'); if (u) u.textContent = '⚠ Could not refresh (' + err.message + '). Retrying in 30s.'; else if (host()) host().innerHTML = '<div class="kd-page"><div class="kd-card" style="color:#be123c">' + U.esc(err.message) + '</div></div>'; });
  }
  function loadOther() {
    var day = otherDay(); T.otherDay = day;
    if (!day) { T.other = null; drawPerson(); return Promise.resolve(); }
    var who = T.person;
    return ev(who, day).then(function (e) { if (T.person !== who || T.otherDay !== day) return; T.other = e; drawPerson(); }, function (err) { T.other = null; drawPerson(); var u = host().querySelector('[data-kt-upd]'); if (u) u.textContent = '⚠ ' + err.message; });
  }
  function openPerson(person) {
    stop(); T.person = person; T.today = null; T.other = null; T.sig = '';
    var el = host(); if (el) el.innerHTML = '<div class="kd-page"><p class="kd-muted">Loading ' + U.esc(person) + '…</p></div>';
    loadToday().then(loadOther); start();
  }
  function start() {
    clearInterval(T.timer);
    T.timer = setInterval(function () {
      if (U.currentTab() !== 'k-team') { stop(); return; }
      if (document.hidden) return;
      if (T.person) loadToday(true); else drawTeam();
    }, REFRESH_MS);
  }

  // ------------------------------------------------------------ call detail --
  function closeCall() { var m = document.getElementById('kt-modal'); if (m) m.parentNode.removeChild(m); document.removeEventListener('keydown', escKey); }
  function escKey(e) { if (e.key === 'Escape') closeCall(); }
  function openCall(id) {
    css(); closeCall();
    var m = document.createElement('div'); m.id = 'kt-modal'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
    m.innerHTML = '<div class="box"><p class="kd-muted">Loading the call…</p></div>';
    m.addEventListener('click', function (e) { if (e.target === m) closeCall(); });
    document.body.appendChild(m); document.addEventListener('keydown', escKey);
    U.api('/king/calls/' + encodeURIComponent(id)).then(function (c) { drawCall(m, c); }, function (e) { m.querySelector('.box').innerHTML = '<div class="kd-row"><h2>Call</h2><button type="button" class="kd-btn ghost" data-kt-close>Close</button></div><p style="color:#be123c">' + U.esc(e.message) + '</p>'; m.querySelector('[data-kt-close]').onclick = closeCall; });
  }
  function drawCall(m, c) {
    var L = c.lessons || {};
    var outCls = c.paid ? 'paid' : (c.status !== 'done' && c.status !== 'skipped' ? 'bad' : '');
    var li = function (arr, empty) { return arr.length ? '<ul class="kt-list">' + arr.map(function (x) { return '<li>' + (x.at ? '<b>' + clock(x.at) + '</b> ' : '') + U.esc(x.what) + (x.detail ? ' <span class="kd-muted">' + U.esc(x.detail) + '</span>' : '') + '</li>'; }).join('') + '</ul>' : '<p class="kd-muted" style="margin:0">' + empty + '</p>'; };
    var flags = (c.flags || []).map(function (f) { return '<span class="kd-tag flag">' + U.esc((c.flag_labels || {})[f] || f) + '</span>'; }).join(' ');
    m.querySelector('.box').innerHTML = '<div data-kt-calldetail="' + U.esc(c.id) + '">'
      + '<div class="kd-row"><div><h2>' + U.esc(c.name || 'Call') + ' <span class="kd-muted" style="font-size:14px">' + U.esc(c.phone) + '</span></h2><p class="kd-sub">' + U.esc(c.person_key) + ' · ' + U.esc(c.task_name || '') + ' · ' + (c.direction === 'inbound' ? 'Incoming' : 'Outgoing') + ' · ' + U.esc(U.when(c.tapped_at || c.shown_at)) + (c.talk_s != null ? ' · ' + dur(c.talk_s) + ' talk' : '') + '</p></div><button type="button" class="kd-btn ghost" data-kt-close aria-label="Close">✕ Close</button></div>'
      + '<div class="kt-g2"><div><h4>Outcome</h4><span class="kt-out ' + outCls + '" data-kt-outcome>' + U.esc(c.outcome_label) + '</span> ' + flags
      + '<h4>Follow-up</h4><p style="margin:0;font-size:14px" data-kt-follow>' + (c.next_step ? U.esc(c.next_step) : '<span class="kd-muted">No next step written</span>') + (c.callback_at ? '<br><b>Call back:</b> ' + U.esc(U.when(c.callback_at)) : '') + '</p>'
      + (c.note ? '<h4>Caller\'s note</h4><p style="margin:0;font-size:14px">' + U.esc(c.note) + '</p>' : '') + '</div>'
      + '<div><h4>Summary</h4><p style="margin:0;font-size:14px" data-kt-summary>' + (c.transcript.summary ? U.esc(c.transcript.summary) : '<span class="kd-muted">No summary (live notes were off or too short)</span>') + '</p></div></div>'
      + '<h4>Transcript</h4><div class="kt-tx" data-kt-transcript>' + (c.transcript.text ? U.esc(c.transcript.text) : '<span class="kd-muted">No live notes were captured on this call.</span>') + '</div>'
      + '<div class="kt-g2"><div><h4>Actions taken</h4><div data-kt-actions>' + li(c.actions || [], 'Nothing recorded.') + '</div></div>'
      + '<div><h4>Drop-offs</h4><div data-kt-drops>' + li(c.drops || [], '✅ No drop-offs on this call.') + '</div></div></div>'
      + '<div class="kd-card" style="margin-top:14px;background:#faf5ff;border-color:#e9d5ff" data-kt-lessons><h3>💡 Lessons learned</h3>'
      + ((L.themes || []).length ? '<div style="margin-bottom:6px">' + L.themes.map(function (t) { return '<span class="kt-theme" data-kt-theme="' + U.esc(t) + '">' + U.esc((L.theme_labels || {})[t] || t) + '</span>'; }).join('') + '</div>' : '')
      + '<div class="kt-g2"><div><b style="font-size:13px">Key points</b>' + ((L.key_points || []).length ? '<ul style="margin:4px 0 0 18px;font-size:13px">' + L.key_points.map(function (p) { return '<li>' + U.esc(p) + '</li>'; }).join('') + '</ul>' : '<p class="kd-muted" style="font-size:13px;margin:4px 0">No key points: no transcript or notes.</p>') + '</div>'
      + '<div><b style="font-size:13px">Try next time</b>' + ((L.suggestions || []).length ? '<ul style="margin:4px 0 0 18px;font-size:13px">' + L.suggestions.map(function (p) { return '<li>' + U.esc(p) + '</li>'; }).join('') + '</ul>' : '<p class="kd-muted" style="font-size:13px;margin:4px 0">Nothing to suggest.</p>') + '</div></div>'
      + '<b style="font-size:13px;display:block;margin-top:10px">Your note (King)</b><textarea data-kt-note placeholder="What should the team learn from this call?">' + U.esc(L.king_note || '') + '</textarea>'
      + '<div class="kd-row" style="margin-top:6px"><span class="kd-muted" style="font-size:12px" data-kt-notemsg>' + (L.updated_at ? 'Saved ' + U.esc(U.when(L.updated_at)) : 'Not saved yet') + '</span><button type="button" class="kd-btn" data-kt-savenote>Save lesson</button></div></div>'
      + ((c.earlier || []).length ? '<h4>Earlier calls to this number</h4><ul class="kt-list" data-kt-earlier>' + c.earlier.map(function (x) { return '<li><b>' + U.esc(U.when(x.at)) + '</b> ' + U.esc(x.by) + ' · ' + U.esc(String(x.outcome || '').replace(/_/g, ' ')) + (x.note ? ' <span class="kd-muted">' + U.esc(x.note) + '</span>' : '') + '</li>'; }).join('') + '</ul>' : '')
      + '</div>';
    m.querySelector('[data-kt-close]').onclick = closeCall;
    var btn = m.querySelector('[data-kt-savenote]'); var ta = m.querySelector('[data-kt-note]'); var msg = m.querySelector('[data-kt-notemsg]');
    btn.onclick = function () {
      btn.disabled = true; msg.textContent = 'Saving…';
      U.api('/king/calls/' + encodeURIComponent(c.id) + '/lesson', { method: 'PUT', body: { note: ta.value } }).then(function () { btn.disabled = false; msg.textContent = '✅ Saved just now'; }, function (e) { btn.disabled = false; msg.textContent = '⚠ ' + e.message; });
    };
  }

  // ---------------------------------------------------------------- wiring --
  function onTab(tab) {
    if (tab !== 'k-team') { stop(); return; }
    css();
    if (T.person) { loadToday().then(loadOther); start(); } else { drawTeam(); start(); }
  }
  ready(function () {
    css();
    document.addEventListener('makaug:admin-tab', function (e) { onTab(e.detail && e.detail.tab); });
    if (U.currentTab() === 'k-team') onTab('k-team');
  });
  window.kingTeam = { openCall: openCall, openPerson: function (p) { ready(function () { if (window.kingDesk) window.kingDesk.go('k-team'); openPerson(p); }); }, closeCall: closeCall, _kDay: kDay, _minOfDay: minOfDay, _span: span, _metrics: metrics };
})();
