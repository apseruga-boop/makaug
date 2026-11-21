/* Desk app shell (Arthur, 21 Nov 2026): the King desk (/admin) and the staff desk
 * (/staff-dashboard) are apps, not public pages. While either desk is on screen
 * (body.kd-on or body.sd-on) the public site chrome is hidden (top strip, main nav,
 * language strip, footer, WhatsApp bubble) and a slim app header shows the logo,
 * the signed-in person's first name and Sign out. */
(function () {
  'use strict';
  if (window.makaugDeskShell) return;
  var H = 52;
  var q = function (s) { return document.querySelector(s); };
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  // Words that are account labels, not a person's name ("MakaUg Super Admin").
  var GENERIC = /^(makaug|makaug\.com|admin|administrator|super|superadmin|king|staff|user|test|moderator|api)$/i;
  /** First name to greet. King's shared account is "MakaUg Super Admin": that is Arthur. Never "MakaUg". */
  function firstName(first, last, role, fallback) {
    var f = String(first || '').trim().split(/\s+/)[0] || '';
    if (f && !GENERIC.test(f)) return f;
    if (/super/i.test(String(role || '')) || /super\s*admin/i.test(String(last || ''))) return 'Arthur';
    return fallback || 'King';
  }
  function kingName() {
    var u = null; try { u = (typeof adminUser !== 'undefined' && adminUser) ? adminUser : null; } catch (x) { u = null; }
    if (!u) { try { u = (typeof authState !== 'undefined' && authState && authState.user) ? authState.user : null; } catch (x) { u = null; } }
    if (u) return firstName(u.first_name, u.last_name, u.role, 'King');
    var t = ((q('#admin-dashboard-name') || {}).textContent || '').trim().split(/\s+/);
    return firstName(t[0], t.slice(1).join(' '), '', 'King');
  }
  function staffName() {
    var st = window.staffDesk && window.staffDesk.state; var me = st && st.home && st.home.me;
    var n = me && (me.first_name || me.name);
    if (n) return firstName(String(n).split(/\s+/)[0], '', '', 'there');
    var u = null; try { u = (typeof authState !== 'undefined' && authState && authState.user) ? authState.user : null; } catch (x) { u = null; }
    return u ? firstName(u.first_name, u.last_name, u.role, 'there') : '';
  }
  var CSS = [
    'body.mk-app > .mk-top-strip,body.mk-app > nav,body.mk-app > #language-spotlight,body.mk-app > footer,body.mk-app > #floating-whatsapp-link{display:none!important}',
    'body.mk-app{padding-top:' + H + 'px}',
    // The desk fills the screen, so its sidebar always reaches the bottom (there is no footer).
    'body.mk-app #page-admin-dashboard,body.mk-app #page-staff-dashboard{min-height:calc(100vh - ' + H + 'px)}',
    '#mk-apphdr{display:none}',
    'body.mk-app #mk-apphdr{display:flex;position:fixed;top:0;left:0;right:0;height:' + H + 'px;z-index:60;align-items:center;gap:12px;padding:0 16px;background:#fff;border-bottom:1px solid #e2e8f0;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}',
    '#mk-apphdr .lg{display:flex;align-items:center;gap:8px;text-decoration:none;color:#14532d;font-weight:900;font-size:18px}',
    '#mk-apphdr .lg i{font-style:normal;width:30px;height:30px;border-radius:9px;background:#15803d;color:#fff;display:grid;place-items:center;font-size:16px}',
    '#mk-apphdr .lg b{font-weight:900}#mk-apphdr .lg span{color:#f59e0b}#mk-apphdr .tag{font-size:11px;font-weight:800;color:#64748b;text-transform:uppercase;letter-spacing:.06em}',
    '#mk-apphdr .sp{flex:1}#mk-apphdr .who{font-size:14px;font-weight:800;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:40vw}',
    '#mk-apphdr button{border:1px solid #cbd5e1;background:#fff;border-radius:10px;padding:6px 12px;font-weight:800;font-size:13px;cursor:pointer;color:#0f172a}',
    '@media(max-width:640px){#mk-apphdr .tag{display:none}#mk-apphdr{padding:0 10px;gap:8px}}'
  ].join('\n');
  function ensure() {
    if (!q('#mk-shell-css')) { var st = document.createElement('style'); st.id = 'mk-shell-css'; st.textContent = CSS; document.head.appendChild(st); }
    var h = q('#mk-apphdr');
    if (!h) {
      h = document.createElement('header'); h.id = 'mk-apphdr';
      h.innerHTML = '<a class="lg" href="/" data-mk-home><i>M</i><b>makaug<span>.com</span></b></a><span class="tag" data-mk-tag></span><span class="sp"></span><span class="who" data-mk-who></span><button type="button" data-mk-signout>Sign out</button>';
      document.body.insertBefore(h, document.body.firstChild);
      h.querySelector('[data-mk-signout]').onclick = function () { if (typeof window.signOut === 'function') window.signOut(); };
    }
    return h;
  }
  var last = '';
  function sync() {
    var king = document.body.classList.contains('kd-on'); var staff = document.body.classList.contains('sd-on');
    var on = king || staff;
    if (on) {
      var h = ensure();
      var who = king ? kingName() : staffName(); var tag = king ? 'King desk' : 'Staff desk';
      var key = who + '|' + tag;
      if (key !== last) { last = key; h.querySelector('[data-mk-who]').textContent = who; h.querySelector('[data-mk-tag]').textContent = tag; }
    }
    if (document.body.classList.contains('mk-app') !== on) document.body.classList.toggle('mk-app', on);
  }
  var pending = false;
  new MutationObserver(function () { if (pending) return; pending = true; setTimeout(function () { pending = false; sync(); }, 60); }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  setInterval(sync, 1500);
  sync();
  window.makaugDeskShell = { firstName: firstName, kingName: kingName, sync: sync, height: H };
  if (typeof module !== 'undefined' && module.exports) module.exports = { firstName: firstName };
})();
