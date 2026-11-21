/* King review queues (Arthur, 21 Nov 2026): "Found online to review" and "Agent properties to review".
 * Lists the pending listings of each kind with their checks. Approve, Reject and Fix details open the
 * full listing review (all its checks stay in force); "Send back with a note" is for agent and owner
 * listings. After each decision the queue, the red badges and the next listing follow on.
 * Short stays keep their own King gate (shown alone under "Short stays"). */
(function () {
  'use strict';
  if (window.kingReview) return;
  var S = { kind: 'found', filter: '', data: null, loading: false, lastShow: 0, openId: null, decided: {}, seen: {}, flash: '' };
  var U = function () { return (window.kingDesk && window.kingDesk.util) || null; };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function q(s, r) { return (r || document).querySelector(s); }
  function qa(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function api(path, opts) { return U().api(path, opts); }
  var CSS = [
    'body.kd-on[data-kd-review="found"] #admin-short-term-king-control,body.kd-on[data-kd-review="agent"] #admin-short-term-king-control{display:none!important}',
    'body.kd-on[data-kd-review] #admin-review-queue-control{display:none!important}body.kd-on.kr-legacy[data-kd-review] #admin-review-queue-control{display:block!important}',
    'body.kd-on[data-kd-review="stays"] #kr-root{display:none!important}body.kd-on.kr-reviewing #kr-list{display:none}',
    '#kr-back{display:none}body.kd-on.kr-reviewing #kr-back{display:flex}',
    '.kr-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:12px 0}@media(max-width:900px){.kr-kpis{grid-template-columns:repeat(2,1fr)}}',
    '.kr-kpi{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:10px 12px}.kr-kpi b{display:block;font-size:22px;font-weight:900}.kr-kpi small{color:#64748b;font-size:12px}.kr-kpi.red b{color:#dc2626}',
    '.kr-chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}@media(max-width:700px){.kr-chips{flex-wrap:nowrap;overflow-x:auto;padding-bottom:4px}}',
    '.kr-chip{border:1px solid #d1d5db;border-radius:999px;padding:5px 11px;font-size:12.5px;font-weight:700;background:#fff;cursor:pointer;white-space:nowrap}.kr-chip.on{background:#14532d;color:#fff;border-color:#14532d}.kr-chip .n{background:#dc2626;color:#fff;border-radius:999px;padding:0 6px;font-size:11px;margin-left:4px}',
    '.kr-q{display:grid;grid-template-columns:112px 1fr auto;gap:14px;align-items:start;padding:12px 0;border-top:1px solid #f1f5f9}.kr-q:first-child{border-top:0}',
    '.kr-th{width:112px;height:84px;border-radius:10px;background:linear-gradient(135deg,#cbd5e1,#94a3b8) center/cover no-repeat;position:relative;overflow:hidden}.kr-th span{position:absolute;left:6px;bottom:6px;background:#0009;color:#fff;font-size:10.5px;font-weight:800;border-radius:6px;padding:1px 6px}',
    '.kr-t{font-weight:800;font-size:14.5px}.kr-m{color:#64748b;font-size:12.5px;margin-top:2px}.kr-ck{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}.kr-ck span{font-size:11.5px;font-weight:700;border-radius:7px;padding:2px 7px}.kr-ck .ok{background:#dcfce7;color:#166534}.kr-ck .no{background:#fee2e2;color:#991b1b}.kr-ck .wa{background:#fef3c7;color:#92400e}',
    '.kr-pill{font-size:11px;font-weight:800;border-radius:999px;padding:2px 8px;background:#ede9fe;color:#5b21b6;margin-left:6px}.kr-pill.ag{background:#e0f2fe;color:#075985}',
    '.kr-acts{display:flex;flex-direction:column;gap:6px;min-width:150px}.kr-btn{border:0;border-radius:10px;padding:7px 11px;font-weight:800;font-size:12.5px;cursor:pointer;background:#15803d;color:#fff}.kr-btn.gh{background:#fff;border:1px solid #cbd5e1;color:#0f172a}.kr-btn.red{background:#fee2e2;color:#991b1b}',
    '@media(max-width:700px){.kr-q{grid-template-columns:84px 1fr}.kr-th{width:84px;height:68px}.kr-acts{grid-column:1/-1;flex-direction:row;flex-wrap:wrap;min-width:0}.kr-acts .kr-btn{flex:1}}',
    '#kr-back{position:sticky;top:var(--kd-top,56px);z-index:30;gap:10px;align-items:center;flex-wrap:wrap;background:#14532d;color:#fff;border-radius:14px;padding:10px 12px;margin-bottom:10px;font-weight:800;font-size:13px}',
    '#kr-back button{border:0;border-radius:9px;padding:6px 10px;font-weight:800;cursor:pointer}#kr-back .w{background:#fff;color:#14532d}#kr-back .g{background:#1f6b43;color:#fff}',
    '.kr-note{font-size:12px;color:#475569;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:10px;padding:8px 10px;margin-top:10px}',
    '.kr-sb{margin-top:6px;font-size:12px;background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;border-radius:8px;padding:5px 8px}'
  ].join('\n');
  function injectCss() { if (q('#kr-css')) return; var st = document.createElement('style'); st.id = 'kr-css'; st.textContent = CSS; document.head.appendChild(st); }
  function ensureRoot() {
    var root = q('#kr-root'); if (root) return root;
    var anchor = q('#admin-short-term-king-control') || q('#admin-review-queue-control'); if (!anchor) return null;
    root = document.createElement('div'); root.id = 'kr-root'; root.setAttribute('data-admin-tab-panel', 'review'); root.className = 'admin-tab-panel';
    root.innerHTML = '<div id="kr-list"></div>';
    anchor.parentNode.insertBefore(root, anchor);
    var back = document.createElement('div'); back.id = 'kr-back';
    var panel = q('#admin-review-panel'); if (panel) panel.parentNode.insertBefore(back, panel);
    watchPanel();
    return root;
  }
  // The full listing review opens in #admin-review-panel; while it is open the queue steps aside.
  function reviewing() { var p = q('#admin-review-panel'); return !!(p && !p.classList.contains('hidden')); }
  function watchPanel() {
    var p = q('#admin-review-panel'); if (!p || p.__krWatched) return; p.__krWatched = true;
    new MutationObserver(function () {
      var on = reviewing() && document.body.hasAttribute('data-kd-review') && document.body.getAttribute('data-kd-review') !== 'stays';
      var was = document.body.classList.contains('kr-reviewing');
      document.body.classList.toggle('kr-reviewing', on);
      if (on) drawBack(); else if (was) { S.openId = null; load(); }
    }).observe(p, { attributes: true, attributeFilter: ['class'] });
  }
  function kindLabel(k) { return k === 'agent' ? 'Agent properties to review' : 'Found online to review'; }
  function drawBack() {
    var b = q('#kr-back'); if (!b) return;
    var id = S.openId; var done = '';
    var next = nextAfter(id);
    b.innerHTML = '<button type="button" class="w" data-kr-backq>← Back to ' + esc(kindLabel(S.kind)) + '</button>'
      + '<span style="flex:1">' + (done ? '✓ ' + esc(done) + '. ' : 'Check the listing below, then Approve or Reject at the bottom.') + '</span>'
      + (next ? '<button type="button" class="g" data-kr-next="' + esc(next.id) + '">Next: ' + esc(next.title.slice(0, 40)) + ' →</button>' : '');
    q('[data-kr-backq]', b).onclick = function () { if (typeof window.closeAdminReviewPanel === 'function') window.closeAdminReviewPanel(); else { document.body.classList.remove('kr-reviewing'); load(); } window.scrollTo(0, 0); };
    var nx = q('[data-kr-next]', b); if (nx) nx.onclick = function () { openReview(nx.getAttribute('data-kr-next'), ''); };
  }
  function nextAfter(id) {
    var items = (S.data && S.data.items) || []; var i = -1;
    for (var k = 0; k < items.length; k++) if (items[k].id === id) i = k;
    for (var j = i + 1; j < items.length; j++) if (!S.decided[items[j].id]) return items[j];
    for (var j2 = 0; j2 < i; j2++) if (!S.decided[items[j2].id]) return items[j2];
    return null;
  }
  function openReview(id, intent) {
    S.openId = id;
    if (typeof window.openAdminListingReview !== 'function') { window.alert('The listing review is still loading. Try again in a moment.'); return; }
    Promise.resolve(window.openAdminListingReview(id)).then(function () {
      drawBack();
      setTimeout(function () {
        var panel = q('#admin-review-panel'); if (!panel) return;
        var target = intent === 'approve' ? q('button[onclick*="\'approved\'"]', panel) : intent === 'reject' ? (q('#admin-review-reason', panel) || q('[data-reject-button="admin-review"]', panel)) : null;
        if (target) { target.scrollIntoView({ block: 'center' }); if (intent === 'reject' && target.focus) target.focus(); target.style.outline = '3px solid #f59e0b'; setTimeout(function () { target.style.outline = ''; }, 2500); }
        else (q('#kr-back') || panel).scrollIntoView({ block: 'start' });
      }, 300);
    });
  }
  function money(it) {
    if (it.poa) return 'Price on request';
    if (!it.price) return 'No price';
    return (it.currency || 'UGX') + ' ' + Number(it.price).toLocaleString('en-GB') + (it.period && !/once|sale|outright/i.test(it.period) ? ' / ' + it.period.replace(/^per_?/, '').replace(/ly$/, '') : '');
  }
  function when(v) { try { return new Date(v).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Kampala' }); } catch (e) { return ''; } }
  function checksHtml(list) { return '<div class="kr-ck">' + (list || []).map(function (c) { return '<span class="' + (c.ok ? 'ok' : (c.warn ? 'wa' : 'no')) + '">' + esc(c.text) + '</span>'; }).join('') + '</div>'; }
  function rowHtml(it) {
    var found = S.kind === 'found';
    var thumb = it.photo ? ' style="background-image:url(&quot;' + esc(it.photo) + '&quot;),linear-gradient(135deg,#cbd5e1,#94a3b8)"' : '';
    var src = found
      ? esc(it.platform) + (it.source_name ? ' · ' + esc(it.source_name) : '') + ' · found ' + esc(when(it.submitted_at)) + (it.source_url ? ' · <a href="' + esc(it.source_url) + '" target="_blank" rel="noopener">see the post</a>' : '')
      : esc(it.who) + ': ' + esc(it.name || 'No name') + ' ' + esc(it.phone) + ' · sent ' + esc(when(it.submitted_at)) + (it.waiting_days ? ' · waiting ' + it.waiting_days + ' day' + (it.waiting_days === 1 ? '' : 's') : '');
    var acts = '<button type="button" class="kr-btn" data-kr-act="approve" data-id="' + esc(it.id) + '">✓ Approve & publish</button>'
      + (found ? '<button type="button" class="kr-btn gh" data-kr-act="fix" data-id="' + esc(it.id) + '">✎ Fix details</button>' : '<button type="button" class="kr-btn gh" data-kr-act="back" data-id="' + esc(it.id) + '">↩ Send back with a note</button>')
      + '<button type="button" class="kr-btn red" data-kr-act="reject" data-id="' + esc(it.id) + '">✕ Reject…</button>';
    return '<div class="kr-q" data-kr-row="' + esc(it.id) + '"><div class="kr-th"' + thumb + '>' + (found ? '<span>' + esc(it.platform) + '</span>' : (it.photo ? '' : '<span>No photo</span>')) + '</div>'
      + '<div><div><span class="kr-t">' + esc(it.title) + '</span><span class="kr-pill' + (found ? '' : ' ag') + '">' + (found ? 'Found online' : esc(it.who)) + '</span> <span class="kr-m">' + esc(it.ref) + '</span></div>'
      + '<div class="kr-m">' + esc(it.place || 'No area') + ' · ' + esc(money(it)) + (it.type ? ' · ' + esc(it.type.replace(/_/g, ' ')) : '') + '</div><div class="kr-m">' + src + '</div>' + checksHtml(it.checks)
      + (it.sent_back_at ? '<div class="kr-sb">Sent back ' + esc(when(it.sent_back_at)) + ': “' + esc(it.sent_back_note) + '”. Waiting for the agent.</div>' : '') + '</div>'
      + '<div class="kr-acts">' + acts + '</div></div>';
  }
  var CHIPS = { found: [['', 'All'], ['tiktok', 'TikTok'], ['youtube', 'YouTube'], ['facebook', 'Facebook'], ['no_price', 'Missing price'], ['no_pin', 'Check map pin']],
    agent: [['', 'All'], ['agents', 'Agents'], ['owners', 'Owners'], ['fee_overdue', 'Fee overdue'], ['sent_back', 'Sent back']] };
  function draw() {
    var root = ensureRoot(); if (!root) return; var list = q('#kr-list', root);
    var d = S.data || {}; var c = d.counts || {}; var w = d.week || {}; var found = S.kind === 'found';
    var waiting = found ? c.found_online : c.agent_props;
    var kpis = found
      ? [['red', waiting, 'waiting'], ['', w.found_today, 'found in the last 24 h'], ['', w.found_approved, 'approved this week'], ['', w.found_rejected, 'rejected this week']]
      : [['red', waiting, 'waiting'], ['', d.items && d.items.length ? (Math.max.apply(null, d.items.map(function (x) { return x.waiting_days || 0; })) + ' days') : '0 days', 'longest wait'], ['', w.agent_approved, 'approved this week'], ['', w.sent_back, 'sent back this week']];
    var chips = CHIPS[S.kind].map(function (ch) { return '<button type="button" class="kr-chip' + (S.filter === ch[0] ? ' on' : '') + '" data-kr-filter="' + ch[0] + '">' + esc(ch[1]) + (ch[0] === '' && waiting ? '<span class="n">' + waiting + '</span>' : '') + (ch[0] === 'sent_back' && c.agent_sent_back ? ' ' + c.agent_sent_back : '') + '</button>'; }).join('');
    var items = (d.items || []).map(rowHtml).join('');
    list.innerHTML = '<div class="kd-page"><div class="kd-row"><div><h1 class="kd-h1">' + esc(kindLabel(S.kind)) + (waiting ? ' <span class="kd-b" style="background:#dc2626;color:#fff;border-radius:999px;font-size:13px;padding:1px 9px;vertical-align:middle">' + waiting + '</span>' : '') + '</h1>'
      + '<p class="kd-sub">' + (found ? 'Listings we found on TikTok, YouTube, Facebook and websites. Nothing goes live until you approve it. Oldest first.' : 'Listings agents and owners sent us themselves. They are waiting on us, so these come first.') + '</p></div>'
      + '<button type="button" class="kd-btn ghost" data-kr-refresh>↻ Refresh</button></div>'
      + '<div class="kr-kpis">' + kpis.map(function (k) { return '<div class="kr-kpi ' + k[0] + '"><b>' + esc(k[1] == null ? 0 : k[1]) + '</b><small>' + esc(k[2]) + '</small></div>'; }).join('') + '</div>'
      + (S.flash ? '<div class="kr-sb" data-kr-flash style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:13px;margin-bottom:10px">' + S.flash + ' <button type="button" class="kd-link" data-kr-flash-x>Dismiss</button></div>' : '')
      + '<div class="kr-chips">' + chips + '</div>'
      + '<div class="kd-card">' + (S.loading && !d.items ? '<p class="kd-muted">Loading…</p>' : (items || '<p class="kd-muted" data-kr-empty>' + (S.filter ? 'Nothing here with this filter.' : 'Nothing waiting. Well done.') + '</p>')) + '</div>'
      + (d.total > (d.items || []).length ? '<p class="kd-muted" style="font-size:12px;margin-top:6px">Showing the oldest ' + d.items.length + ' of ' + d.total + '.</p>' : '')
      + '<div class="kr-note">' + (found
        ? '<b>How it works:</b> Approve and Reject open the full listing review with all its checks. After you decide, the badge updates and <b>Next</b> takes you to the next one. Reject needs a reason.'
        : '<b>How it works:</b> Approve and Reject open the full listing review with all its checks. <b>Send back</b> keeps the listing off the site and shows your note on the agent\'s own listing; you can text them from the company phone.')
      + ' <button type="button" class="kd-link" data-kr-legacy>' + (document.body.classList.contains('kr-legacy') ? 'Hide' : 'Show') + ' the old full queue and tools</button></div></div>';
    var fx = q('[data-kr-flash-x]', list); if (fx) fx.onclick = function () { S.flash = ''; draw(); };
    var nx = q('[data-kr-flash] [data-kr-next]', list); if (nx) nx.onclick = function () { S.flash = ''; openReview(nx.getAttribute('data-kr-next'), ''); };
    q('[data-kr-refresh]', list).onclick = function () { load(); if (window.kingDesk) window.kingDesk.refreshCounts(); };
    q('[data-kr-legacy]', list).onclick = function () { document.body.classList.toggle('kr-legacy'); draw(); };
    qa('[data-kr-filter]', list).forEach(function (b) { b.onclick = function () { S.filter = b.getAttribute('data-kr-filter'); load(); }; });
    qa('[data-kr-act]', list).forEach(function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-id'); var act = b.getAttribute('data-kr-act');
        if (act === 'back') return sendBack(id);
        openReview(id, act === 'approve' ? 'approve' : act === 'reject' ? 'reject' : '');
      };
    });
  }
  function remember(d) { ((d && d.items) || []).forEach(function (x) { S.seen[x.id] = x; }); }
  function smsLink(it, body, label) {
    if (!it || !it.sms_phone) return '';
    return '<a class="kr-btn" style="text-decoration:none;display:inline-block" data-kr-sms href="sms:' + esc(it.sms_phone) + '?body=' + encodeURIComponent(body) + '">' + esc(label) + '</a>';
  }
  function firstName(it) { return String((it && it.name) || '').replace(/\(test\)/i, '').trim().split(/\s+/)[0] || 'there'; }
  function liveSms(it) { return smsLink(it, 'Hi ' + firstName(it) + ', good news: your MakaUg listing ' + (it.ref || '') + ' is now live on makaug.com. Thank you for listing with us.', '✉️ Text them it is live'); }
  function sendBack(id) {
    var it = ((S.data && S.data.items) || []).filter(function (x) { return x.id === id; })[0] || {};
    var note = window.prompt('What should ' + (it.name || 'the agent') + ' change? They will see this on their listing.', '');
    if (note === null) return;
    api('/king/review/' + encodeURIComponent(id) + '/send-back', { method: 'POST', body: { note: note } }).then(function () {
      var body = 'Hi ' + firstName(it) + ', your MakaUg listing ' + (it.ref || '') + ' needs a change before it goes live: ' + note + '. Please update it on your MakaUg dashboard. Thank you.';
      S.flash = '↩ Sent back to ' + esc(it.name || 'the lister') + '. They see your note on their listing. ' + smsLink(it, body, '✉️ Text them from the company phone');
      load(); if (window.kingDesk) window.kingDesk.refreshCounts();
    }, function (e) { window.alert(e.message); });
  }
  function load() {
    if (S.kind === 'stays') return;
    ensureRoot(); S.loading = true; draw();
    var kind = S.kind;
    return api('/king/review/' + kind + (S.filter ? '?filter=' + encodeURIComponent(S.filter) : '')).then(function (d) {
      if (kind !== S.kind) return; S.loading = false; S.data = d; S.decided = {}; remember(d);
      if (window.kingDesk && window.kingDesk.setBadges) window.kingDesk.setBadges(d.counts || {});
      draw(); if (document.body.classList.contains('kr-reviewing')) drawBack();
    }, function (e) { S.loading = false; var l = q('#kr-list'); if (l) l.innerHTML = '<div class="kd-card" style="color:#be123c">Could not load the queue: ' + esc(e.message) + ' <button type="button" class="kd-link" data-kr-retry>Retry</button></div>'; var r = q('[data-kr-retry]'); if (r) r.onclick = load; });
  }
  // After a decision in the full review the old code jumps to "Live & featured" or the actioned list.
  // From a queue we come straight back to the queue instead, with the result, the next listing and
  // (agent listings) a ready "your listing is live" text the King can send from the company phone.
  function hookDecisions() {
    var orig = window.adminSetListingStatus; if (typeof orig !== 'function' || orig.__kr) return;
    var wrapped = function (localId, nextStatus, backendId) {
      var id = String(backendId || localId || '');
      var kind = document.body.getAttribute('data-kd-review');
      var fromQueue = (kind === 'found' || kind === 'agent') && reviewing();
      var result = orig.apply(this, arguments);
      if (!fromQueue) return result;
      return Promise.resolve(result).then(function (r) {
        return api('/king/review/' + kind + (S.filter ? '?filter=' + encodeURIComponent(S.filter) : '')).then(function (d) {
          var still = (d.items || []).some(function (x) { return x.id === id; });
          if (still || !/approved|rejected|deleted|hidden/.test(String(nextStatus))) return r; // blocked or kept: stay in the review
          var it = S.seen[id] || { title: 'Listing' }; var approved = /approved/.test(String(nextStatus));
          remember(d); S.data = d; S.kind = kind;
          var next = (d.items || [])[0];
          S.flash = (approved ? '✓ Approved and live: ' : '✕ Rejected: ') + esc(it.title) + '.'
            + (approved && kind === 'agent' ? ' ' + liveSms(it) : '')
            + (next ? ' <button type="button" class="kr-btn gh" data-kr-next="' + esc(next.id) + '">Next: ' + esc(String(next.title).slice(0, 40)) + ' →</button>' : ' Nothing else waiting.');
          if (window.kingDesk && window.kingDesk.setBadges) window.kingDesk.setBadges(d.counts || {});
          S.lastShow = 0;
          if (window.kingDesk && window.kingDesk.go) window.kingDesk.go('review:' + kind);
          window.scrollTo(0, 0);
          return r;
        }, function () { return r; });
      });
    };
    wrapped.__kr = true; window.adminSetListingStatus = wrapped;
  }
  // Short stays: when the short-stay module is off, the King gate would say "Loading…" forever.
  function staysOffNote() {
    var host = q('#admin-short-term-king-queue'); if (!host) return;
    var off = !(window.__makaugShortTerm && window.__makaugShortTerm.enabled === true);
    if (off && /Loading short stays/.test(host.textContent || '')) host.innerHTML = '<p class="text-sm text-gray-500" data-st-off>Short stays are switched off, so there is nothing to review here.</p>';
  }
  window.kingReview = {
    show: function (kind) {
      injectCss(); hookDecisions(); staysOffNote();
      var k = kind === 'agent' ? 'agent' : kind === 'stays' ? 'stays' : 'found';
      if (k !== S.kind) { S.kind = k; S.filter = ''; S.data = null; S.flash = ''; }
      if (k === 'stays') return;
      if (Date.now() - S.lastShow < 400) return; S.lastShow = Date.now();
      load();
    },
    counts: function () {},
    reload: load
  };
  // king-desk.js may have opened a review queue before this file arrived.
  try { if (document.body.getAttribute('data-kd-review') && typeof activeAdminWorkflowTab !== 'undefined' && activeAdminWorkflowTab === 'review') window.kingReview.show(document.body.getAttribute('data-kd-review')); } catch (e) { /* not on the King desk */ }
})();
