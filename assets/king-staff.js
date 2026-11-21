/* King · Staff, pay & targets (Arthur, 21 Nov 2026).
 * One page: add a person (own login via a one-time link), today's targets
 * (set each morning), monthly salary with history, remove with a reason
 * (history kept) and bring back. */
(function () {
  'use strict';
  if (window.kingStaff) return;
  var U = null; var S = { data: null, open: {} };
  function ready(fn) { if (window.kingDesk && window.kingDesk.util) { U = window.kingDesk.util; fn(); } else setTimeout(function () { ready(fn); }, 150); }
  function host() { return document.getElementById('king-staff'); }
  var CSS = [
    '.ks-banner{display:flex;gap:10px;align-items:center;flex-wrap:wrap;background:#fef3c7;border:1px solid #fde68a;color:#78350f;border-radius:14px;padding:10px 14px;margin:12px 0;font-weight:700;font-size:14px}.ks-banner.ok{background:#dcfce7;border-color:#bbf7d0;color:#166534}',
    '.ks-people{display:grid;gap:12px;margin-top:12px}',
    '.ks-p{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:14px;display:grid;grid-template-columns:1.2fr 1.4fr 1.2fr auto;gap:14px;align-items:center}@media(max-width:1100px){.ks-p{grid-template-columns:1fr 1fr}}@media(max-width:640px){.ks-p{grid-template-columns:1fr}}',
    '.ks-p .nm{font-size:17px;font-weight:900}.ks-p .sm{font-size:12px;color:#64748b}.ks-lbl{font-size:11px;font-weight:900;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px}',
    '.ks-in{border:1px solid #cbd5e1;border-radius:10px;padding:7px 9px;font-size:14px;width:76px}.ks-in.w{width:130px}.ks-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}',
    '.ks-state{display:inline-block;border-radius:999px;padding:2px 9px;font-size:11px;font-weight:800}.ks-state.ok{background:#dcfce7;color:#166534}.ks-state.wait{background:#fef3c7;color:#92400e}.ks-state.no{background:#ffe4e6;color:#be123c}',
    '.ks-hist{grid-column:1/-1;background:#f8fafc;border-radius:12px;padding:10px;font-size:13px}',
    '#ks-modal{position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:80;display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:40px 12px}',
    '#ks-modal .box{background:#fff;border-radius:18px;max-width:560px;width:100%;padding:18px;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a}',
    '#ks-modal label{display:block;font-size:13px;font-weight:800;margin:10px 0 4px}#ks-modal input,#ks-modal select,#ks-modal textarea{width:100%;border:1px solid #cbd5e1;border-radius:10px;padding:9px 10px;font-size:15px;font-family:inherit}',
    '#ks-modal .g2{display:grid;grid-template-columns:1fr 1fr;gap:10px}.ks-err{color:#be123c;font-weight:700;font-size:13px;min-height:18px;margin-top:8px}',
    '.ks-link{background:#f1f5f9;border-radius:10px;padding:10px;font-family:ui-monospace,monospace;font-size:12px;word-break:break-all}',
    '@media(max-width:640px){#ks-modal{padding:0}#ks-modal .box{border-radius:0;min-height:100vh}}'
  ].join('\n');
  function css() { if (document.getElementById('ks-css')) return; var st = document.createElement('style'); st.id = 'ks-css'; st.textContent = CSS; document.head.appendChild(st); }
  function monthName(m) { var p = String(m || '').split('-'); return p.length >= 2 ? new Date(Date.UTC(+p[0], +p[1] - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : ''; }
  function loginState(p) {
    if (!p.active) return '<span class="ks-state no">Removed</span>';
    if (p.password_set) return '<span class="ks-state ok">Login ready</span>';
    if (p.link_state === 'waiting') return '<span class="ks-state wait">Setup link sent, not used yet</span>';
    return '<span class="ks-state wait">Needs a setup link</span>';
  }
  function load() {
    var el = host(); if (!el) return;
    if (!S.data) el.innerHTML = '<div class="kd-page"><p class="kd-muted">Loading staff…</p></div>';
    return U.api('/king/staff').then(function (d) { S.data = d; draw(); }, function (e) { el.innerHTML = '<div class="kd-page"><div class="kd-card" style="color:#be123c">' + U.esc(e.message) + '</div></div>'; });
  }
  function draw() {
    var el = host(); var d = S.data; if (!el || !d) return;
    var act = d.people.filter(function (p) { return p.active; }); var gone = d.people.filter(function (p) { return !p.active; });
    var todo = act.length - d.targets_set_today;
    var banner = !act.length ? '' : todo > 0
      ? '<div class="ks-banner" data-ks-morning>☀️ Today\'s targets: ' + todo + ' of ' + act.length + ' not set yet. Change any below, or <button type="button" class="kd-btn" data-ks-keep>Keep current targets for everyone</button></div>'
      : '<div class="ks-banner ok" data-ks-morning="done">✅ Today\'s targets are set for everyone.</div>';
    var person = function (p) {
      var t = p.targets; var sal = p.salary;
      return '<div class="ks-p" data-ks-person="' + U.esc(p.person_key) + '">'
        + '<div><div class="nm">' + U.esc(p.name) + '</div><div class="sm">' + U.esc(p.scope_label) + ' · login ' + U.esc(p.login) + (p.phone ? ' · ' + U.esc(p.phone) : '') + '</div><div style="margin-top:6px">' + loginState(p) + '</div>'
        + '<div class="sm" style="margin-top:4px">Last sign-in: ' + (p.last_login_at ? U.esc(U.when(p.last_login_at)) : 'never') + '</div></div>'
        + '<div><div class="ks-lbl">Today\'s targets ' + (t.set_today ? '<span class="ks-state ok">set today</span>' : '<span class="ks-state wait">from ' + (t.effective_from ? U.esc(t.effective_from) : 'default') + '</span>') + '</div>'
        + '<div class="ks-row"><input class="ks-in" type="number" min="0" max="1000" inputmode="numeric" value="' + t.calls_per_day + '" data-ks-calls aria-label="Calls a day"><span class="sm">calls</span><input class="ks-in" type="number" min="0" max="200" inputmode="numeric" value="' + t.closes_per_day + '" data-ks-closes aria-label="Paid a day"><span class="sm">paid</span><button type="button" class="kd-btn ghost" data-ks-savetargets>Save</button></div></div>'
        + '<div><div class="ks-lbl">Salary · ' + U.esc(monthName(d.month)) + '</div><div class="ks-row"><input class="ks-in w" inputmode="numeric" placeholder="UGX a month" value="' + (sal.ugx == null ? '' : sal.ugx) + '" data-ks-salary aria-label="Monthly salary in UGX"><button type="button" class="kd-btn ghost" data-ks-savesalary>Save</button></div>'
        + '<div class="sm" style="margin-top:4px" data-ks-salnote>' + (sal.ugx == null ? 'Not set' : (sal.carried ? 'Carried from an earlier month' : 'Set ' + U.esc(U.when(sal.set_at)) + ' by ' + U.esc(sal.set_by || 'King'))) + ' · <button type="button" class="kd-link" data-ks-hist>History</button></div></div>'
        + '<div class="ks-row" style="justify-content:flex-end">' + (p.password_set ? '' : '<button type="button" class="kd-btn" data-ks-link>Setup link</button>') + '<button type="button" class="kd-btn ghost" data-ks-open>Their day</button><button type="button" class="kd-btn red" data-ks-remove>Remove</button></div>'
        + (S.open[p.person_key] ? histHtml(p) : '') + '</div>';
    };
    var removed = gone.map(function (p) {
      var r = p.removed || {};
      return '<tr data-ks-removed="' + U.esc(p.person_key) + '"><td><b>' + U.esc(p.name) + '</b><div class="sm kd-muted">' + U.esc(p.login) + '</div></td><td>' + (r.at ? U.esc(U.when(r.at)) : '') + '</td><td>' + U.esc(r.reason_label || '') + (r.reason ? ': ' + U.esc(r.reason) : '') + '</td><td>' + U.esc(r.by || '') + '</td><td>' + (r.at ? '<button type="button" class="kd-btn ghost" data-ks-back="' + U.esc(p.user_id) + '">Bring back</button>' : '') + '</td></tr>';
    }).join('');
    el.innerHTML = '<div class="kd-page" data-ks-page>'
      + '<div class="kd-row"><div><h1 class="kd-h1">Staff, pay &amp; targets</h1><p class="kd-sub">' + act.length + ' active · payroll ' + U.esc(monthName(d.month)) + ': <b data-ks-payroll>' + U.esc(U.ugxFull(d.payroll_month_ugx)) + '</b></p></div><button type="button" class="kd-btn" data-ks-add>＋ Add staff</button></div>'
      + banner
      + '<div class="ks-people">' + (act.map(person).join('') || '<div class="kd-card">No staff yet. Tap ＋ Add staff.</div>') + '</div>'
      + (gone.length ? '<div class="kd-card" style="margin-top:14px"><h3>Removed (history kept)</h3><div class="kd-scroll"><table class="kd-table"><tr><th>Who</th><th>Removed</th><th>Why</th><th>By</th><th></th></tr>' + removed + '</table></div></div>' : '')
      + '<p class="kd-muted" style="font-size:12px;margin-top:10px">Other moderator accounts (without their own calling login) are in Ops → Staff accounts (advanced).</p></div>';
    bind(el);
  }
  function histHtml(p) {
    var h = p.salary_history || []; var c = p.changes || [];
    return '<div class="ks-hist" data-ks-history="' + U.esc(p.person_key) + '"><b>Salary history</b>' + (h.length ? '<table class="kd-table" style="margin-top:4px"><tr><th>Month</th><th>Salary</th><th>Set</th><th>By</th><th>Note</th></tr>' + h.map(function (x) { return '<tr><td>' + U.esc(monthName(x.month)) + '</td><td><b>' + U.esc(U.ugxFull(x.ugx)) + '</b></td><td>' + U.esc(U.when(x.set_at)) + '</td><td>' + U.esc(x.set_by) + '</td><td>' + U.esc(x.note || '') + '</td></tr>'; }).join('') + '</table>' : '<p class="kd-muted" style="margin:4px 0">No salary set yet.</p>')
      + (c.length ? '<b style="display:block;margin-top:8px">Changes</b><ul style="margin:4px 0 0 18px">' + c.map(function (x) { return '<li>' + U.esc(U.when(x.at)) + ' · ' + U.esc(x.action) + (x.reason ? ' · ' + U.esc(x.reason) : '') + ' · ' + U.esc(x.actor) + '</li>'; }).join('') + '</ul>' : '') + '</div>';
  }
  function flash(btn, text) { var t = btn.textContent; btn.textContent = text; btn.disabled = true; setTimeout(function () { btn.textContent = t; btn.disabled = false; }, 1500); }
  function bind(el) {
    var add = el.querySelector('[data-ks-add]'); if (add) add.onclick = openAdd;
    var keep = el.querySelector('[data-ks-keep]'); if (keep) keep.onclick = function () { keep.disabled = true; U.api('/king/staff/targets/keep', { method: 'POST' }).then(load, function (e) { keep.disabled = false; alert(e.message); }); };
    U.qa('[data-ks-person]', el).forEach(function (row) {
      var key = row.getAttribute('data-ks-person'); var p = S.data.people.filter(function (x) { return x.person_key === key; })[0];
      row.querySelector('[data-ks-savetargets]').onclick = function () {
        var b = this; var calls = row.querySelector('[data-ks-calls]').value; var closes = row.querySelector('[data-ks-closes]').value;
        U.api('/king/staff/targets', { method: 'PUT', body: { targets: [{ person_key: key, calls_per_day: calls, closes_per_day: closes }] } }).then(function () { flash(b, '✓ Saved'); setTimeout(load, 600); }, function (e) { alert(e.message); });
      };
      row.querySelector('[data-ks-savesalary]').onclick = function () {
        var b = this; var v = row.querySelector('[data-ks-salary]').value;
        U.api('/king/staff/salary', { method: 'PUT', body: { person_key: key, month: S.data.month, salary_ugx: v } }).then(function () { flash(b, '✓ Saved'); setTimeout(load, 600); }, function (e) { alert(e.message); });
      };
      row.querySelector('[data-ks-hist]').onclick = function () { S.open[key] = !S.open[key]; draw(); };
      var lk = row.querySelector('[data-ks-link]'); if (lk) lk.onclick = function () { U.api('/calling/logins/' + encodeURIComponent(p.user_id) + '/link', { method: 'POST' }).then(function (l) { showLink(p.name, l); load(); }, function (e) { alert(e.message); }); };
      row.querySelector('[data-ks-open]').onclick = function () { if (window.kingTeam) window.kingTeam.openPerson(key); };
      row.querySelector('[data-ks-remove]').onclick = function () { openRemove(p); };
    });
    U.qa('[data-ks-back]', el).forEach(function (b) { b.onclick = function () { if (!confirm('Bring them back? Their login works again; send a new setup link if they forgot the password.')) return; U.api('/king/staff/' + encodeURIComponent(b.getAttribute('data-ks-back')) + '/reactivate', { method: 'POST' }).then(load, function (e) { alert(e.message); }); }; });
  }
  function modal(html) {
    closeModal(); css();
    var m = document.createElement('div'); m.id = 'ks-modal'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
    m.innerHTML = '<div class="box">' + html + '</div>';
    m.addEventListener('click', function (e) { if (e.target === m) closeModal(); });
    document.body.appendChild(m); document.addEventListener('keydown', escKey);
    U.qa('[data-ks-cancel]', m).forEach(function (b) { b.onclick = closeModal; });
    return m;
  }
  function closeModal() { var m = document.getElementById('ks-modal'); if (m) m.parentNode.removeChild(m); document.removeEventListener('keydown', escKey); }
  function escKey(e) { if (e.key === 'Escape') closeModal(); }
  function openAdd() {
    var sc = S.data.scopes || {};
    var m = modal('<h3 style="margin:0;font-size:20px;font-weight:900">Add staff</h3><p class="kd-muted" style="font-size:13px;margin:4px 0 0">They get their own login. You send them a one-time link (48 hours) and they choose their password.</p>'
      + '<div class="g2"><div><label>First name</label><input data-ks-f="first_name" autocomplete="off"></div><div><label>Surname (optional)</label><input data-ks-f="last_name" autocomplete="off"></div></div>'
      + '<label>Phone</label><input data-ks-f="phone" inputmode="tel" placeholder="07XX XXX XXX" autocomplete="off">'
      + '<label>What they use</label><select data-ks-f="scope">' + Object.keys(sc).map(function (k) { return '<option value="' + k + '">' + U.esc(sc[k]) + '</option>'; }).join('') + '</select>'
      + '<div class="g2"><div><label>Calls a day</label><input data-ks-f="calls_per_day" type="number" min="0" max="1000" value="40"></div><div><label>Paid a day</label><input data-ks-f="closes_per_day" type="number" min="0" max="200" value="2"></div></div>'
      + '<label>Monthly salary (UGX, optional)</label><input data-ks-f="salary_ugx" inputmode="numeric" placeholder="e.g. 500000">'
      + '<div class="ks-err" data-ks-err></div><div class="kd-row" style="margin-top:10px"><button type="button" class="kd-btn ghost" data-ks-cancel>Cancel</button><button type="button" class="kd-btn" data-ks-create>Add and make login link</button></div>');
    m.querySelector('[data-ks-f="first_name"]').focus();
    m.querySelector('[data-ks-create]').onclick = function () {
      var b = this; var body = {}; U.qa('[data-ks-f]', m).forEach(function (i) { body[i.getAttribute('data-ks-f')] = i.value; });
      b.disabled = true; m.querySelector('[data-ks-err]').textContent = '';
      U.api('/king/staff', { method: 'POST', body: body }).then(function (out) { showLink(out.name, out.link, true); load(); }, function (e) { b.disabled = false; m.querySelector('[data-ks-err]').textContent = e.message; });
    };
  }
  function showLink(name, l, isNew) {
    var m = modal('<h3 style="margin:0;font-size:20px;font-weight:900">' + (isNew ? '✅ ' + U.esc(name) + ' added' : 'Setup link for ' + U.esc(name)) + '</h3>'
      + '<p style="font-size:14px">Send this link to ' + U.esc(name) + ' (WhatsApp is fine). It works once, for 48 hours (until ' + U.esc(U.when(l.expires_at)) + '). Their login: <b>' + U.esc(l.login) + '</b></p>'
      + '<div class="ks-link" data-ks-linkurl>' + U.esc(l.url) + '</div><p class="kd-muted" style="font-size:12px">This link is shown only now. You can make a new one any time; the old one then stops working.</p>'
      + '<div class="kd-row" style="margin-top:10px"><button type="button" class="kd-btn ghost" data-ks-cancel>Done</button><button type="button" class="kd-btn" data-ks-copy>Copy link</button></div>');
    m.querySelector('[data-ks-copy]').onclick = function () { var b = this; try { navigator.clipboard.writeText(l.url).then(function () { flash(b, '✓ Copied'); }, function () { flash(b, 'Select and copy'); }); } catch (x) { flash(b, 'Select and copy'); } };
  }
  function openRemove(p) {
    var rr = S.data.remove_reasons || {};
    var m = modal('<h3 style="margin:0;font-size:20px;font-weight:900">Remove ' + U.esc(p.name) + '?</h3><p style="font-size:14px">Their login stops working straight away and they leave the calling desk. Their calls, pay and history are kept. You can bring them back later.</p>'
      + '<label>Why</label><select data-ks-reason><option value="">Pick one…</option>' + Object.keys(rr).map(function (k) { return '<option value="' + k + '">' + U.esc(rr[k]) + '</option>'; }).join('') + '</select>'
      + '<label>Note (optional, needed for Other)</label><textarea data-ks-note rows="2"></textarea>'
      + '<div class="ks-err" data-ks-err></div><div class="kd-row" style="margin-top:10px"><button type="button" class="kd-btn ghost" data-ks-cancel>Cancel</button><button type="button" class="kd-btn red" data-ks-confirm>Remove ' + U.esc(p.name) + '</button></div>');
    m.querySelector('[data-ks-confirm]').onclick = function () {
      var b = this; b.disabled = true;
      U.api('/king/staff/' + encodeURIComponent(p.user_id) + '/remove', { method: 'POST', body: { reason_code: m.querySelector('[data-ks-reason]').value, reason: m.querySelector('[data-ks-note]').value } }).then(function () { closeModal(); load(); }, function (e) { b.disabled = false; m.querySelector('[data-ks-err]').textContent = e.message; });
    };
  }
  ready(function () {
    css();
    document.addEventListener('makaug:admin-tab', function (e) { if (e.detail && e.detail.tab === 'k-staff') load(); else closeModal(); });
    if (U.currentTab() === 'k-staff') load();
  });
  window.kingStaff = { refresh: function () { ready(load); } };
})();
