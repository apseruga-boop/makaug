/* Rejections & lessons (Arthur, 21 Nov 2026, ops 3c part 2).
 * Staff: why people said no on calls and why listings were sent back (team
 * counts, last 30 days, no names or numbers), the lessons King approved, and a
 * form to suggest a lesson with an optional script line. King: the same counts,
 * suggestions to approve (edit the words first if needed) or decline with a
 * note, and approved ones to retire. Approved script lines show on the calling
 * screen as "Team tip, approved by King". Nothing here sends anything. */
(function () {
  'use strict';
  if (window.teamLessons) return;
  var q = function (s, el) { return (el || document).querySelector(s); };
  var qa = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  function when(d) { try { return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Kampala' }).format(new Date(d)); } catch (x) { return ''; } }
  function api(path, opts) {
    opts = opts || {};
    var h = { Accept: 'application/json' };
    if (typeof window.adminAuthHeaders === 'function') { try { Object.assign(h, window.adminAuthHeaders()); } catch (x) { /* cookie auth */ } }
    if (opts.body) h['Content-Type'] = 'application/json';
    return fetch('/api/admin' + path, { method: opts.method || 'GET', credentials: 'same-origin', headers: h, body: opts.body ? JSON.stringify(opts.body) : undefined }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok || j.ok === false) { var e = new Error(j.error || ('Error ' + r.status)); e.status = r.status; throw e; } return j.data !== undefined ? j.data : j; });
    });
  }
  var CSS = [
    '.tl-page{font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a}',
    '.tl-h1{font-size:26px;font-weight:900;margin:0;line-height:1.2}.tl-sub{color:#64748b;font-size:13px;margin:4px 0 12px}',
    '.tl-card{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:14px;margin-bottom:12px}.tl-card h3{font-size:16px;font-weight:900;margin:0 0 8px}',
    '.tl-cols{display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:start}@media(max-width:1023px){.tl-cols{grid-template-columns:1fr}}',
    '.tl-bar{display:grid;grid-template-columns:minmax(0,1fr) 44px;gap:8px;align-items:center;margin:8px 0;font-size:13px;font-weight:700}.tl-bar .t{display:grid;gap:4px}.tl-bar i{display:block;height:8px;border-radius:999px;background:#ef4444}.tl-bar.l i{background:#f59e0b}.tl-bar .n{text-align:right;font-weight:900}',
    '.tl-say{font-size:12px;color:#334155;background:#f8fafc;border-radius:10px;padding:6px 8px;font-weight:500}.tl-say b{font-weight:800}',
    '.tl-item{border-top:1px solid #f1f5f9;padding:10px 0}.tl-item:first-of-type{border-top:0}.tl-tag{display:inline-block;border-radius:999px;padding:2px 9px;font-size:11px;font-weight:900;margin-right:6px;background:#e0f2fe;color:#075985}',
    '.tl-st{display:inline-block;border-radius:999px;padding:2px 9px;font-size:11px;font-weight:900}.tl-st.suggested{background:#fef3c7;color:#92400e}.tl-st.approved{background:#dcfce7;color:#166534}.tl-st.declined,.tl-st.retired{background:#f1f5f9;color:#475569}',
    '.tl-script{margin-top:6px;border:1px solid #fde68a;background:#fffbeb;border-radius:10px;padding:8px 10px;font-size:13px}.tl-script b{display:block}',
    '.tl-form{display:grid;gap:8px}.tl-form label{display:grid;gap:4px;font-size:13px;font-weight:800;color:#334155}.tl-form input,.tl-form select,.tl-form textarea{border:1px solid #cbd5e1;border-radius:10px;padding:9px 10px;font-size:14px;font-family:inherit;width:100%;box-sizing:border-box}.tl-form textarea{min-height:70px;resize:vertical}',
    '.tl-g2{display:grid;grid-template-columns:1fr 1fr;gap:8px}@media(max-width:640px){.tl-g2{grid-template-columns:1fr}}',
    '.tl-btn{border:0;border-radius:10px;padding:8px 13px;font-weight:800;font-size:13px;cursor:pointer;background:#15603f;color:#fff}.tl-btn.ghost{background:#f1f5f9;color:#0f172a}.tl-btn.red{background:#fff1f2;color:#be123c}.tl-btn:disabled{opacity:.6;cursor:wait}',
    '.tl-row{display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap}.tl-meta{font-size:12px;color:#64748b}.tl-empty{color:#64748b;font-size:14px}.tl-ok{color:#166534;font-weight:800;font-size:13px}.tl-err{color:#be123c;font-weight:800;font-size:13px}',
    'details.tl-more summary{cursor:pointer;font-weight:800;font-size:13px;color:#15603f;margin-top:6px}'
  ].join('\n');
  function css() { if (q('#tl-css')) return; var st = document.createElement('style'); st.id = 'tl-css'; st.textContent = CSS; document.head.appendChild(st); }
  var STATUS = { suggested: 'Waiting for King', approved: 'Approved', declined: 'Not used', retired: 'Retired' };
  function bars(list, total, cls, withScript) {
    if (!list.length) return '<p class="tl-empty">None in the last 30 days.</p>';
    var max = Math.max.apply(null, list.map(function (r) { return r.count; }).concat([1]));
    return list.map(function (r) {
      return '<div class="tl-bar' + (cls ? ' ' + cls : '') + '" data-tl-reason="' + esc(r.key) + '"><div class="t"><span>' + esc(r.label) + '</span><i style="width:' + Math.max(4, Math.round(100 * r.count / max)) + '%"></i>'
        + (withScript && r.script ? '<span class="tl-say">Script (' + esc(r.script.task) + '): <b>“' + esc(r.script.if_they_say) + '”</b> → ' + esc(r.script.we_say) + '</span>' : '') + '</div><span class="n">' + r.count + '</span></div>';
    }).join('');
  }
  function rejectionCards(rej) {
    return '<div class="tl-cols"><div class="tl-card" data-tl-calls><h3>📞 Why people said no on calls</h3><p class="tl-meta">' + rej.calls.total + ' in the last ' + rej.days + ' days, whole team.</p>' + bars(rej.calls.reasons, rej.calls.total, '', true) + '</div>'
      + '<div class="tl-card" data-tl-listings><h3>🏠 Why listings were sent back</h3><p class="tl-meta">' + rej.listings.total + ' in the last ' + rej.days + ' days.</p>' + bars(rej.listings.reasons, rej.listings.total, 'l', false) + '</div></div>';
  }
  function scriptBox(s) { return s ? '<div class="tl-script"><span class="tl-meta">' + esc(s.task) + ' · If they say…</span><b>“' + esc(s.if_they_say) + '”</b>' + esc(s.we_say) + '</div>' : ''; }
  function lessonItem(l, extra) {
    return '<div class="tl-item" data-tl-lesson="' + l.id + '"><div class="tl-row"><div><span class="tl-tag">' + esc(l.theme_label) + '</span>' + (extra || '') + '</div><span class="tl-meta">' + esc(when(l.decided_at || l.created_at)) + '</span></div>'
      + '<div style="margin-top:4px;font-size:14px">' + esc(l.lesson) + '</div>' + scriptBox(l.script) + (l.king_note ? '<div class="tl-meta" style="margin-top:4px">King: ' + esc(l.king_note) + '</div>' : '') + '</div>';
  }
  function themeOptions(themes, sel) { return Object.keys(themes).map(function (k) { return '<option value="' + esc(k) + '"' + (k === sel ? ' selected' : '') + '>' + esc(themes[k]) + '</option>'; }).join(''); }
  function taskOptions(tasks, sel, blank) { return (blank ? '<option value="">' + esc(blank) + '</option>' : '') + Object.keys(tasks).map(function (k) { return '<option value="' + esc(k) + '"' + (k === sel ? ' selected' : '') + '>' + esc(tasks[k]) + '</option>'; }).join(''); }
  function readForm(f) { return { theme: f.elements.theme.value, lesson: f.elements.lesson.value, task_key: f.elements.task_key.value || null, if_they_say: f.elements.if_they_say.value, we_say: f.elements.we_say.value }; }
  function lessonForm(d, attr, button) {
    return '<form class="tl-form" ' + attr + ' autocomplete="off"><label>What is it about?<select name="theme">' + themeOptions(d.themes, 'price') + '</select></label>'
      + '<label>The lesson<textarea name="lesson" maxlength="600" placeholder="e.g. When they ask for a free trial, saying they can stop any month works better than arguing."></textarea></label>'
      + '<details class="tl-more"><summary>Add a script line (optional)</summary><div class="tl-form" style="margin-top:8px"><label>For which calls?<select name="task_key">' + taskOptions(d.tasks, '', 'Pick the calls') + '</select></label>'
      + '<div class="tl-g2"><label>If they say…<input name="if_they_say" maxlength="200" placeholder="e.g. I want a free trial first"></label><label>We say…<input name="we_say" maxlength="400" placeholder="What works"></label></div></div></details>'
      + '<div class="tl-err" data-tl-err></div><div><button type="submit" class="tl-btn">' + button + '</button></div></form>';
  }

  // ---------------------------------------------------------------- staff --
  var ST = { flash: '' };
  function staff(host) {
    css();
    host.innerHTML = '<div class="tl-page"><p class="tl-sub">Loading…</p></div>';
    return api('/desk/lessons').then(function (d) {
      host.innerHTML = '<div class="tl-page" data-tl-staff><h1 class="tl-h1">Rejections &amp; lessons</h1><p class="tl-sub">Why people said no, and what the team has learned. Suggest a lesson or a better line; King approves it, and approved lines show on the calling screen.</p>'
        + (ST.flash ? '<div class="tl-card tl-ok" data-tl-flash>' + esc(ST.flash) + '</div>' : '')
        + rejectionCards(d.rejections)
        + '<div class="tl-cols"><div class="tl-card" data-tl-approved><h3>✅ Lessons King approved</h3>' + (d.approved.map(function (l) { return lessonItem(l); }).join('') || '<p class="tl-empty">No approved lessons yet. Be the first to suggest one.</p>') + '</div>'
        + '<div><div class="tl-card"><h3>💡 Suggest a lesson</h3>' + lessonForm(d, 'data-tl-suggest', 'Send to King') + '</div>'
        + '<div class="tl-card" data-tl-mine><h3>My suggestions</h3>' + (d.mine.map(function (l) { return lessonItem(l, '<span class="tl-st ' + esc(l.status) + '">' + esc(STATUS[l.status] || l.status) + '</span>'); }).join('') || '<p class="tl-empty">You have not suggested anything yet.</p>') + '</div></div></div></div>';
      ST.flash = '';
      var f = q('[data-tl-suggest]', host);
      f.onsubmit = function (ev) {
        ev.preventDefault(); var err = q('[data-tl-err]', f); err.textContent = ''; var btn = q('button[type="submit"]', f); btn.disabled = true;
        api('/desk/lessons', { method: 'POST', body: readForm(f) }).then(function () { ST.flash = 'Sent to King. You will see here when King decides.'; staff(host); }, function (e) { btn.disabled = false; err.textContent = e.message; });
      };
    }, function (e) { host.innerHTML = '<div class="tl-page"><div class="tl-card tl-err">' + esc(e.message) + '</div></div>'; });
  }

  // ----------------------------------------------------------------- King --
  var KS = { flash: '' };
  function kHost() { return q('#king-lessons'); }
  function king() {
    var el = kHost(); if (!el) return; css();
    if (!el.innerHTML) el.innerHTML = '<div class="tl-page"><p class="tl-sub">Loading…</p></div>';
    return api('/king/lessons').then(function (d) {
      if (window.kingDesk && window.kingDesk.setBadges) window.kingDesk.setBadges({ lessons_waiting: d.waiting.length });
      el.innerHTML = '<div class="tl-page" data-tl-king><h1 class="tl-h1">Rejections &amp; lessons</h1><p class="tl-sub">Approve the team\u2019s lessons and script lines. Approved lines show on the calling screen as “Team tip, approved by King”. Edit the words before approving if needed.</p>'
        + (KS.flash ? '<div class="tl-card tl-ok" data-tl-flash>' + esc(KS.flash) + '</div>' : '')
        + '<div class="tl-card" data-tl-waiting><h3>💡 Waiting for you (' + d.waiting.length + ')</h3>' + (d.waiting.map(function (l) {
          var s = l.script || {};
          return '<form class="tl-item tl-form" data-tl-decide="' + l.id + '" autocomplete="off"><div class="tl-row"><div><span class="tl-tag">' + esc(l.theme_label) + '</span><b>From ' + esc(l.proposed_by) + '</b></div><span class="tl-meta">' + esc(when(l.created_at)) + '</span></div>'
            + '<div class="tl-g2"><label>About<select name="theme">' + themeOptions(d.themes, l.theme) + '</select></label><label>Calls<select name="task_key">' + taskOptions(d.tasks, s.task_key || '', 'No script line') + '</select></label></div>'
            + '<label>Lesson<textarea name="lesson" maxlength="600">' + esc(l.lesson) + '</textarea></label>'
            + '<div class="tl-g2"><label>If they say…<input name="if_they_say" maxlength="200" value="' + esc(s.if_they_say || '') + '"></label><label>We say…<input name="we_say" maxlength="400" value="' + esc(s.we_say || '') + '"></label></div>'
            + '<label>Note to them (needed to decline)<input name="note" maxlength="300" placeholder="Optional when approving"></label>'
            + '<div class="tl-row"><span class="tl-err" data-tl-err></span><div style="display:flex;gap:6px"><button type="button" class="tl-btn red" data-tl-act="decline">Decline</button><button type="button" class="tl-btn" data-tl-act="approve">Approve</button></div></div></form>';
        }).join('') || '<p class="tl-empty">Nothing waiting.</p>') + '</div>'
        + rejectionCards(d.rejections)
        + '<div class="tl-cols"><div class="tl-card" data-tl-decided><h3>Decided</h3>' + (d.decided.map(function (l) {
          return lessonItem(l, '<span class="tl-st ' + esc(l.status) + '">' + esc(STATUS[l.status] || l.status) + '</span><span class="tl-meta">from ' + esc(l.proposed_by) + '</span>') + (l.status === 'approved' ? '<div style="margin:-4px 0 8px"><button type="button" class="tl-btn ghost" data-tl-retire="' + l.id + '">Retire</button></div>' : '');
        }).join('') || '<p class="tl-empty">Nothing decided yet.</p>') + '</div>'
        + '<div class="tl-card"><h3>✍️ Add a lesson yourself</h3><p class="tl-meta">Yours are approved straight away.</p>' + lessonForm(d, 'data-tl-kadd', 'Add lesson') + '</div></div></div>';
      KS.flash = '';
      qa('[data-tl-decide]', el).forEach(function (f) {
        qa('[data-tl-act]', f).forEach(function (b) {
          b.onclick = function () {
            var action = b.getAttribute('data-tl-act'); var err = q('[data-tl-err]', f); err.textContent = '';
            var body = readForm(f); body.action = action; body.note = f.elements.note.value;
            b.disabled = true;
            api('/king/lessons/' + f.getAttribute('data-tl-decide') + '/decide', { method: 'POST', body: body }).then(function () { KS.flash = action === 'approve' ? 'Approved. ' + (body.if_they_say ? 'The line is on the calling screen now.' : 'Staff see it in their lessons.') : 'Declined. They will see your note.'; king(); }, function (e) { b.disabled = false; err.textContent = e.message; });
          };
        });
      });
      qa('[data-tl-retire]', el).forEach(function (b) { b.onclick = function () { if (!window.confirm('Retire this lesson? Its script line comes off the calling screen.')) return; b.disabled = true; api('/king/lessons/' + b.getAttribute('data-tl-retire') + '/decide', { method: 'POST', body: { action: 'retire' } }).then(function () { KS.flash = 'Retired.'; king(); }, function (e) { b.disabled = false; window.alert(e.message); }); }; });
      var kf = q('[data-tl-kadd]', el);
      kf.onsubmit = function (ev) { ev.preventDefault(); var err = q('[data-tl-err]', kf); err.textContent = ''; api('/king/lessons', { method: 'POST', body: readForm(kf) }).then(function () { KS.flash = 'Lesson added and approved.'; king(); }, function (e) { err.textContent = e.message; }); };
    }, function (e) { el.innerHTML = '<div class="tl-page"><div class="tl-card tl-err">' + esc(e.message) + '</div></div>'; });
  }
  document.addEventListener('makaug:admin-tab', function (e) { if (e.detail && e.detail.tab === 'k-lessons') king(); });
  setTimeout(function () { try { if (typeof activeAdminWorkflowTab !== 'undefined' && activeAdminWorkflowTab === 'k-lessons') king(); } catch (x) { /* King page not open */ } }, 0);
  window.teamLessons = { staff: staff, king: king };
})();
