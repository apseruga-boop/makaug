/* Team hub (Arthur, 21 Nov 2026, ops 3c part 1).
 * Staff: Messages from King (with "Got it"), Rules, T&Cs & Working hours, How-to videos.
 * King (Team hub page): write to the whole team or one person (targets go to one
 * person only), see who has read it, edit Rules / T&Cs / Working hours and fill
 * the how-to video slots. In-app only: nothing here sends a WhatsApp, SMS or email. */
(function () {
  'use strict';
  if (window.teamHub) return;
  var q = function (s, el) { return (el || document).querySelector(s); };
  var qa = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  function when(d) { try { return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Kampala' }).format(new Date(d)); } catch (x) { return ''; } }
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
    '.th-page{font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a}',
    '.th-h1{font-size:26px;font-weight:900;margin:0;line-height:1.2}.th-sub{color:#64748b;font-size:13px;margin:4px 0 12px}',
    '.th-card{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:14px;margin-bottom:12px}.th-card h3{font-size:16px;font-weight:900;margin:0 0 8px}',
    '.th-msg{border:1px solid #e2e8f0;border-radius:14px;padding:12px 14px;margin-bottom:10px;background:#fff}.th-msg.new{border-color:#15603f;box-shadow:inset 4px 0 0 #15603f}',
    '.th-tag{display:inline-block;border-radius:999px;padding:2px 9px;font-size:11px;font-weight:900;margin-right:6px}.th-tag.team{background:#e0f2fe;color:#075985}.th-tag.me{background:#ede9fe;color:#5b21b6}.th-tag.target{background:#fef3c7;color:#92400e}.th-tag.off{background:#f1f5f9;color:#64748b}',
    '.th-body{white-space:pre-wrap;word-break:break-word;margin:6px 0;font-size:14px;line-height:1.5}.th-meta{font-size:12px;color:#64748b}',
    '.th-row{display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap}',
    '.th-btn{border:0;border-radius:10px;padding:8px 13px;font-weight:800;font-size:13px;cursor:pointer;background:#15603f;color:#fff;text-decoration:none;display:inline-block}.th-btn.ghost{background:#f1f5f9;color:#0f172a}.th-btn.red{background:#fff1f2;color:#be123c}.th-btn:disabled{opacity:.6;cursor:wait}',
    '.th-list{margin:0;padding-left:20px;font-size:14px;line-height:1.6}.th-empty{color:#64748b;font-size:14px}',
    '.th-vids{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}@media(max-width:1100px){.th-vids{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:640px){.th-vids{grid-template-columns:1fr}}',
    '.th-vid{border:1px solid #e2e8f0;border-radius:14px;padding:12px;background:#fff;display:flex;flex-direction:column;gap:8px}.th-vid .ic{font-size:26px}.th-vid b{font-size:15px}.th-vid.wait{background:#f8fafc}',
    '.th-form{display:grid;gap:8px}.th-form label{display:grid;gap:4px;font-size:13px;font-weight:800;color:#334155}.th-form input,.th-form select,.th-form textarea{border:1px solid #cbd5e1;border-radius:10px;padding:9px 10px;font-size:14px;font-family:inherit;width:100%;box-sizing:border-box}',
    '.th-form textarea{min-height:90px;resize:vertical}.th-g2{display:grid;grid-template-columns:1fr 1fr;gap:8px}@media(max-width:640px){.th-g2{grid-template-columns:1fr}}',
    '.th-cols{display:grid;grid-template-columns:1fr 1.2fr;gap:12px;align-items:start}@media(max-width:1023px){.th-cols{grid-template-columns:1fr}}',
    '.th-note{font-size:12px;color:#64748b}.th-ok{color:#166534;font-weight:800;font-size:13px}.th-err{color:#be123c;font-weight:800;font-size:13px}',
    '.th-vedit{display:grid;grid-template-columns:1.2fr 1.6fr auto;gap:8px;align-items:end;border-top:1px solid #f1f5f9;padding:10px 0}@media(max-width:900px){.th-vedit{grid-template-columns:1fr}}'
  ].join('\n');
  function css() { if (q('#th-css')) return; var st = document.createElement('style'); st.id = 'th-css'; st.textContent = CSS; document.head.appendChild(st); }
  function lines(text) { return String(text || '').split('\n').map(function (l) { return l.trim(); }).filter(Boolean); }
  function textBlock(text, empty) {
    var ls = lines(text);
    if (!ls.length) return '<p class="th-empty">' + esc(empty) + '</p>';
    return ls.length === 1 ? '<p class="th-body">' + esc(ls[0]) + '</p>' : '<ul class="th-list">' + ls.map(function (l) { return '<li>' + esc(l.replace(/^[-•*]\s*/, '')) + '</li>'; }).join('') + '</ul>';
  }
  function tagFor(m) {
    if (m.kind === 'target') return '<span class="th-tag target">🎯 Target for you</span>';
    return m.to_me ? '<span class="th-tag me">✉️ Just for you</span>' : '<span class="th-tag team">📣 To the whole team</span>';
  }

  // ---------------------------------------------------------------- staff --
  var ST = { data: null, onUnread: null };
  function staffLoad(page, host) {
    css();
    if (!ST.data) host.innerHTML = '<div class="th-page"><p class="th-sub">Loading…</p></div>';
    return api('/desk/hub').then(function (d) {
      ST.data = d; if (ST.onUnread) ST.onUnread(d.unread);
      if (host.isConnected !== false) staffDraw(page, host);
      return d;
    }, function (e) { host.innerHTML = '<div class="th-page"><div class="th-card th-err">' + esc(e.message) + '</div></div>'; });
  }
  function staffDraw(page, host) {
    var d = ST.data || { messages: [], pages: [], videos: [] };
    if (page === 'msgs') {
      var unread = d.messages.filter(function (m) { return !m.read; });
      host.innerHTML = '<div class="th-page" data-th-msgs><div class="th-row"><h1 class="th-h1">Messages from King</h1>' + (unread.length > 1 ? '<button type="button" class="th-btn ghost" data-th-readall>Mark all as read</button>' : '') + '</div>'
        + '<p class="th-sub">Messages to the whole team and to you. Press "Got it" so King knows you have read it.</p>'
        + (d.messages.length ? d.messages.map(function (m) {
          return '<div class="th-msg' + (m.read ? '' : ' new') + '" data-th-msg="' + m.id + '"><div class="th-row"><div>' + tagFor(m) + (m.title ? '<b>' + esc(m.title) + '</b>' : '') + '</div><span class="th-meta">' + esc(when(m.created_at)) + ' · Kampala time</span></div>'
            + '<div class="th-body">' + esc(m.body) + '</div>'
            + (m.read ? '<span class="th-ok">✓ Read</span>' : '<button type="button" class="th-btn" data-th-got="' + m.id + '">Got it</button>') + '</div>';
        }).join('') : '<div class="th-card th-empty">No messages from King yet.</div>') + '</div>';
      var mark = function (ids, btn) {
        if (btn) btn.disabled = true;
        api('/desk/hub/read', { method: 'POST', body: { ids: ids } }).then(function (r) {
          d.messages.forEach(function (m) { if (ids.indexOf(m.id) >= 0) m.read = true; });
          d.unread = r.unread != null ? r.unread : d.messages.filter(function (m) { return !m.read; }).length;
          if (ST.onUnread) ST.onUnread(d.unread); staffDraw(page, host);
        }, function (e) { if (btn) btn.disabled = false; window.alert(e.message); });
      };
      qa('[data-th-got]', host).forEach(function (b) { b.onclick = function () { mark([Number(b.getAttribute('data-th-got'))], b); }; });
      var all = q('[data-th-readall]', host); if (all) all.onclick = function () { mark(unread.map(function (m) { return m.id; }), all); };
      return;
    }
    if (page === 'rules') {
      host.innerHTML = '<div class="th-page" data-th-rules><h1 class="th-h1">Rules, T&amp;Cs &amp; hours</h1><p class="th-sub">Written by King. Ask King if anything is unclear.</p>'
        + d.pages.map(function (p) {
          var icon = { rules: '📘', terms: '📄', hours: '🕘' }[p.key] || '📄';
          return '<div class="th-card" data-th-page="' + esc(p.key) + '"><h3>' + icon + ' ' + esc(p.label) + '</h3>' + textBlock(p.body, 'King has not written this yet.') + (p.updated_at ? '<div class="th-meta" style="margin-top:6px">Updated ' + esc(when(p.updated_at)) + '</div>' : '') + '</div>';
        }).join('') + '</div>';
      return;
    }
    if (page === 'videos') {
      host.innerHTML = '<div class="th-page" data-th-videos><h1 class="th-h1">How-to videos</h1><p class="th-sub">Short videos on how to do each job on this desk. A video opens in a new tab.</p><div class="th-vids">'
        + (d.videos.length ? d.videos.map(function (v) {
          return '<div class="th-vid' + (v.ready ? '' : ' wait') + '" data-th-video="' + v.id + '"><span class="ic">' + (v.ready ? '🎬' : '⏳') + '</span><b>' + esc(v.title) + '</b>' + (v.note ? '<span class="th-note">' + esc(v.note) + '</span>' : '')
            + (v.ready ? '<a class="th-btn" target="_blank" rel="noopener noreferrer" href="' + esc(v.url) + '">▶ Watch</a>' : '<span class="th-note">Video coming soon.</span>') + '</div>';
        }).join('') : '<p class="th-empty">No videos yet.</p>') + '</div></div>';
    }
  }
  function unread() { return api('/desk/hub').then(function (d) { ST.data = d; return d.unread; }); }

  // ----------------------------------------------------------------- King --
  var KS = { data: null, flash: '' };
  function kHost() { return q('#king-hub'); }
  function kingLoad() {
    var el = kHost(); if (!el) return; css();
    if (!KS.data) el.innerHTML = '<div class="th-page"><p class="th-sub">Loading the team hub…</p></div>';
    return api('/king/hub').then(function (d) { KS.data = d; kingDraw(); }, function (e) { el.innerHTML = '<div class="th-page"><div class="th-card th-err">' + esc(e.message) + '</div></div>'; });
  }
  function kingDraw() {
    var el = kHost(); var d = KS.data; if (!el || !d) return;
    var people = d.people || [];
    var sent = (d.messages || []).map(function (m) {
      var tag = m.withdrawn ? '<span class="th-tag off">Withdrawn</span>' : m.kind === 'target' ? '<span class="th-tag target">🎯 Target</span>' : m.audience === 'team' ? '<span class="th-tag team">📣 Team</span>' : '<span class="th-tag me">✉️ One person</span>';
      return '<div class="th-msg" data-th-sent="' + m.id + '"><div class="th-row"><div>' + tag + '<b>To ' + esc(m.to_name) + '</b>' + (m.title ? ' · ' + esc(m.title) : '') + '</div><span class="th-meta">' + esc(when(m.created_at)) + '</span></div>'
        + '<div class="th-body">' + esc(m.body) + '</div><div class="th-row"><span class="th-meta" data-th-reads>' + (m.withdrawn ? 'Hidden from staff.' : 'Read by ' + m.read + ' of ' + m.of + (m.not_read.length ? ' · not yet: ' + esc(m.not_read.join(', ')) : '')) + '</span>'
        + (m.withdrawn ? '' : '<button type="button" class="th-btn red" data-th-withdraw="' + m.id + '">Withdraw</button>') + '</div></div>';
    }).join('') || '<p class="th-empty">Nothing sent yet.</p>';
    el.innerHTML = '<div class="th-page" data-th-king><h1 class="th-h1">Team hub</h1><p class="th-sub">Write to the team, keep the Rules, T&amp;Cs and Working hours up to date, and add the how-to videos. Staff see all of this on their desk.</p>'
      + (KS.flash ? '<div class="th-card th-ok" data-th-flash>' + esc(KS.flash) + '</div>' : '')
      + '<div class="th-cols"><div class="th-card"><h3>✍️ New message</h3><form class="th-form" data-th-send autocomplete="off">'
      + '<div class="th-g2"><label>To<select name="to"><option value="team">Whole team (' + people.length + ')</option>' + people.map(function (p) { return '<option value="' + esc(p.user_id) + '">' + esc(p.name) + '</option>'; }).join('') + '</select></label>'
      + '<label>Kind<select name="kind"><option value="note">Message</option><option value="target">🎯 Target (one person only)</option></select></label></div>'
      + '<label>Title (optional)<input name="title" maxlength="120" placeholder="e.g. This week"></label>'
      + '<label>Message<textarea name="body" maxlength="2000" required placeholder="Write to the team…"></textarea></label>'
      + '<div class="th-note" data-th-kindnote>Shows on their desk only. Nothing is sent by WhatsApp, text or email.</div>'
      + '<div class="th-err" data-th-send-err></div><div><button type="submit" class="th-btn" data-th-send-btn>Send to the desk</button></div></form></div>'
      + '<div class="th-card"><h3>📬 Sent</h3>' + sent + '</div></div>'
      + '<div class="th-card"><h3>📘 Rules, T&amp;Cs &amp; Working hours</h3><p class="th-note">One point per line. Staff see a list.</p>'
      + (d.pages || []).map(function (p) {
        return '<form class="th-form" data-th-pageform="' + esc(p.key) + '" style="margin-top:10px"><label>' + esc(p.label) + '<textarea name="body" maxlength="8000" placeholder="' + esc(p.key === 'hours' ? 'e.g. Monday to Friday 08:30–17:30, Saturday 09:00–13:00' : p.key === 'terms' ? 'The terms staff work under' : 'One rule per line') + '">' + esc(p.body) + '</textarea></label><div class="th-row"><span class="th-note" data-th-pagemsg></span><button type="submit" class="th-btn">Save ' + esc(p.label) + '</button></div></form>';
      }).join('') + '</div>'
      + '<div class="th-card"><h3>🎬 How-to video slots</h3><p class="th-note">Paste a link (YouTube, Google Drive, Loom…) when a video is ready. Slots without a link show "Video coming soon" to staff.</p>'
      + (d.videos || []).map(vRow).join('') + vRow({ id: 'new', title: '', url: '', note: '' }) + '</div></div>';
    KS.flash = '';
    var f = q('[data-th-send]', el); var kind = f.elements.kind; var to = f.elements.to;
    var syncKind = function () {
      var team = to.value === 'team';
      kind.options[1].disabled = team; if (team && kind.value === 'target') kind.value = 'note';
      q('[data-th-kindnote]', el).textContent = kind.value === 'target' ? 'A target goes to one person only. It shows on their desk; nothing is sent by WhatsApp, text or email.' : 'Shows on their desk only. Nothing is sent by WhatsApp, text or email.';
    };
    to.onchange = syncKind; kind.onchange = syncKind; syncKind();
    f.onsubmit = function (ev) {
      ev.preventDefault();
      var btn = q('[data-th-send-btn]', el); var err = q('[data-th-send-err]', el); err.textContent = ''; btn.disabled = true;
      var body = { audience: to.value === 'team' ? 'team' : 'person', to_user_id: to.value === 'team' ? null : to.value, kind: kind.value, title: f.elements.title.value, body: f.elements.body.value };
      api('/king/hub/messages', { method: 'POST', body: body }).then(function () { KS.flash = 'Sent. It is on ' + (body.audience === 'team' ? 'everyone\u2019s desk' : to.options[to.selectedIndex].text + '\u2019s desk') + ' now.'; kingLoad(); }, function (e) { btn.disabled = false; err.textContent = e.message; });
    };
    qa('[data-th-withdraw]', el).forEach(function (b) { b.onclick = function () { if (!window.confirm('Withdraw this message? Staff will no longer see it.')) return; b.disabled = true; api('/king/hub/messages/' + b.getAttribute('data-th-withdraw') + '/withdraw', { method: 'POST', body: {} }).then(kingLoad, function (e) { b.disabled = false; window.alert(e.message); }); }; });
    qa('[data-th-pageform]', el).forEach(function (pf) {
      pf.onsubmit = function (ev) {
        ev.preventDefault(); var msg = q('[data-th-pagemsg]', pf); msg.className = 'th-note'; msg.textContent = 'Saving…';
        api('/king/hub/pages/' + pf.getAttribute('data-th-pageform'), { method: 'PUT', body: { body: pf.elements.body.value } }).then(function () { msg.className = 'th-ok'; msg.textContent = 'Saved. Staff see it now.'; }, function (e) { msg.className = 'th-err'; msg.textContent = e.message; });
      };
    });
    qa('[data-th-vform]', el).forEach(function (vf) {
      var id = vf.getAttribute('data-th-vform');
      vf.onsubmit = function (ev) {
        ev.preventDefault(); var msg = q('[data-th-vmsg]', vf); msg.className = 'th-note'; msg.textContent = 'Saving…';
        api('/king/hub/videos/' + id, { method: 'PUT', body: { title: vf.elements.title.value, url: vf.elements.url.value, note: vf.elements.note.value } }).then(function () { KS.flash = 'Video slot saved.'; kingLoad(); }, function (e) { msg.className = 'th-err'; msg.textContent = e.message; });
      };
      var rm = q('[data-th-vremove]', vf); if (rm) rm.onclick = function () { if (!window.confirm('Remove this video slot?')) return; api('/king/hub/videos/' + id + '/remove', { method: 'POST', body: {} }).then(kingLoad, function (e) { window.alert(e.message); }); };
    });
  }
  function vRow(v) {
    var isNew = v.id === 'new';
    return '<form class="th-vedit th-form" data-th-vform="' + esc(v.id) + '"><label>' + (isNew ? '➕ New slot title' : 'Title') + '<input name="title" maxlength="120" value="' + esc(v.title) + '"' + (isNew ? ' placeholder="e.g. Using the Missed calls page"' : '') + '></label>'
      + '<label>Video link<input name="url" maxlength="500" inputmode="url" value="' + esc(v.url) + '" placeholder="https://…"></label>'
      + '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><button type="submit" class="th-btn">' + (isNew ? 'Add slot' : 'Save') + '</button>' + (isNew ? '' : '<button type="button" class="th-btn red" data-th-vremove>Remove</button>') + '</div>'
      + '<input type="hidden" name="note" value="' + esc(v.note || '') + '"><span class="th-note" data-th-vmsg style="grid-column:1/-1">' + (isNew ? '' : (v.url ? '✓ Staff can watch this.' : 'No link yet: staff see "Video coming soon".')) + '</span></form>';
  }
  document.addEventListener('makaug:admin-tab', function (e) { if (e.detail && e.detail.tab === 'k-hub') kingLoad(); });
  setTimeout(function () { try { if (typeof activeAdminWorkflowTab !== 'undefined' && activeAdminWorkflowTab === 'k-hub') kingLoad(); } catch (x) { /* King page not open */ } }, 0);
  window.teamHub = {
    staff: function (page, host, onUnread) { ST.onUnread = onUnread || ST.onUnread; if (ST.data) staffDraw(page, host); return staffLoad(page, host); },
    unread: unread,
    king: kingLoad
  };
})();
