'use strict';

// Kampala Vibe City campaign window. The look is on from 21 Nov 2026 00:00
// Africa/Kampala through the end of Sun 29 Nov 2026 (23:59:59 EAT, which is
// 20:59:59 UTC). After that this module says no, so the skin turns off
// without a second deploy. A query or env flag can override.
//
// Kill switch: ?noskin=1  or  VIBE_CITY_SKIN=off
// Preview:     ?skin=1    or  VIBE_CITY_SKIN=on
// Forced clock for QA: ?skin_at=2026-11-30T00:00:00+03:00

(function (root) {
  var START_MS = Date.parse('2026-11-21T00:00:00+03:00');
  var END_MS = Date.parse('2026-11-30T00:00:00+03:00'); // exclusive
  var DESK = /^\/(king|admin|staff|staff-dashboard|staff-setup)(\/|$)/i;
  var DESK_PAGES = {
    'staff-dashboard': 1,
    'admin-dashboard': 1,
    'admin-docs': 1,
    'admin-setup-status': 1,
    'staff-review': 1
  };

  function envFlag(env) {
    var raw = '';
    if (env && env.VIBE_CITY_SKIN != null) raw = env.VIBE_CITY_SKIN;
    else if (env && env.MAKAUG_VIBE_CITY_SKIN != null) raw = env.MAKAUG_VIBE_CITY_SKIN;
    raw = String(raw || '').trim().toLowerCase();
    if (raw === 'off' || raw === '0' || raw === 'false' || raw === 'no') return 'off';
    if (raw === 'on' || raw === '1' || raw === 'true' || raw === 'yes' || raw === 'preview') return 'on';
    return 'auto';
  }

  function paramsOf(search) {
    if (search && typeof search.get === 'function') return search;
    var raw = String(search == null ? '' : search);
    var q = raw.indexOf('?') >= 0 ? raw.slice(raw.indexOf('?') + 1) : (raw.charAt(0) === '?' ? raw.slice(1) : raw);
    if (q.indexOf('#') >= 0) q = q.slice(0, q.indexOf('#'));
    return new URLSearchParams(q);
  }

  function pathOf(pathname) {
    var path = String(pathname || '').split('?')[0].split('#')[0] || '/';
    if (path.length > 1 && path.slice(-1) === '/') path = path.slice(0, -1);
    return path || '/';
  }

  function isDeskPath(pathname) {
    return DESK.test(pathOf(pathname));
  }

  function isDeskPage(page) {
    return Boolean(DESK_PAGES[String(page || '')]);
  }

  function flagValue(params, name) {
    return String(params.get(name) || '').trim().toLowerCase();
  }

  function isOn(opts) {
    opts = opts || {};
    if (isDeskPath(opts.pathname || '')) return false;
    if (isDeskPage(opts.page)) return false;
    var flag = envFlag(opts.env || (typeof process !== 'undefined' ? process.env : {}));
    if (flag === 'off') return false;
    var params = paramsOf(opts.search || '');
    var noskin = flagValue(params, 'noskin');
    if (noskin === '1' || noskin === 'true' || noskin === 'yes') return false;
    if (flagValue(params, 'skin') === 'off') return false;
    var vibe = flagValue(params, 'vibe');
    if (vibe === 'off') return false;
    if (flag === 'on') return true;
    var skin = flagValue(params, 'skin');
    if (skin === '1' || skin === 'true' || skin === 'on' || skin === 'preview' || skin === 'confirm') return true;
    if (vibe === 'preview' || vibe === 'on' || vibe === '1') return true;
    var at = params.get('skin_at');
    var t = at ? Date.parse(at) : (opts.now != null ? Number(opts.now) : Date.now());
    if (!isFinite(t)) return false;
    return t >= START_MS && t < END_MS;
  }

  function confirmPreview(opts) {
    opts = opts || {};
    return flagValue(paramsOf(opts.search || ''), 'skin') === 'confirm';
  }

  var api = {
    START_MS: START_MS,
    END_MS: END_MS,
    envFlag: envFlag,
    isDeskPath: isDeskPath,
    isDeskPage: isDeskPage,
    isVibeCitySkinActive: isOn,
    isConfirmPreview: confirmPreview
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  root.VibeCitySkinWindow = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
