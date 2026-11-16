(function () {
  'use strict';
  var token = new URLSearchParams(location.search).get('t') || '';
  // Drop the token from the address bar and history straight away.
  try { history.replaceState(null, '', '/staff-setup'); } catch (e) { /* old browser */ }
  var box = document.getElementById('box');
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fail(msg) { box.innerHTML = '<h1>makaug.com staff login</h1><div class="err">' + esc(msg) + '</div>'; }
  fetch('/api/staff-setup/' + encodeURIComponent(token)).then(function (r) { return r.json(); }).then(function (p) {
    if (!p.ok) return fail(p.error || 'This setup link is not valid.');
    var d = p.data;
    box.innerHTML = '<h1>Welcome, ' + esc(d.name) + '</h1>'
      + '<p class="m">Choose your own password. Your login is<br><span class="login">' + esc(d.login) + '</span><br>This link works once and runs out ' + esc(new Date(d.expires_at).toLocaleString('en-GB', { timeZone: 'Africa/Kampala', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })) + ' (Kampala).</p>'
      + '<form id="f"><label for="p1">New password</label><input id="p1" type="password" autocomplete="new-password" minlength="10" required>'
      + '<label for="p2">Type it again</label><input id="p2" type="password" autocomplete="new-password" minlength="10" required>'
      + '<p class="m">At least 10 characters, with letters and a number. Do not share it, not even with Arthur.</p>'
      + '<div id="e"></div><button id="b" type="submit">Save my password</button></form>';
    document.getElementById('f').onsubmit = function (ev) {
      ev.preventDefault();
      var a = document.getElementById('p1').value, b = document.getElementById('p2').value, e = document.getElementById('e');
      if (a !== b) { e.innerHTML = '<div class="err">The two passwords are not the same.</div>'; return; }
      var btn = document.getElementById('b'); btn.disabled = true;
      fetch('/api/staff-setup/' + encodeURIComponent(token), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: a }) })
        .then(function (r) { return r.json(); }).then(function (q) {
          if (!q.ok) { btn.disabled = false; e.innerHTML = '<div class="err">' + esc(q.error || 'Could not save.') + '</div>'; return; }
          token = '';
          box.innerHTML = '<h1>All set, ' + esc(q.data.name) + '</h1><div class="ok">Your password is saved. Sign in as staff with <b>' + esc(q.data.login) + '</b> and your new password.</div><button onclick="location.href=\'/staff-dashboard\'">Go to staff sign-in</button>';
        }, function () { btn.disabled = false; e.innerHTML = '<div class="err">No connection. Try again.</div>'; });
    };
  }, function () { fail('No connection. Check your internet and open the link again.'); });
})();
