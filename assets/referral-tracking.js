/* First-touch ?ref= capture. First code wins for about 30 days. */
(function (root) {
  var COOKIE = "makaug_ref";
  var STORAGE = "makaug.ref";
  var DAYS = 30;
  var MAX_MS = DAYS * 24 * 60 * 60 * 1000;

  function normalise(value) {
    return String(value || "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^[-_]|[-_]$/g, "")
      .slice(0, 40);
  }

  function readCookie() {
    try {
      var parts = String(document.cookie || "").split(";");
      for (var i = 0; i < parts.length; i += 1) {
        var part = parts[i];
        var idx = part.indexOf("=");
        if (idx === -1) continue;
        if (part.slice(0, idx).trim() !== COOKIE) continue;
        return normalise(decodeURIComponent(part.slice(idx + 1).trim()));
      }
    } catch (_error) {}
    return "";
  }

  function readStorage() {
    try {
      var raw = window.localStorage.getItem(STORAGE);
      if (!raw) return "";
      var parsed = JSON.parse(raw);
      var code = normalise(parsed && parsed.code);
      var at = Number(parsed && parsed.at);
      if (!code || !Number.isFinite(at) || (Date.now() - at) > MAX_MS) {
        window.localStorage.removeItem(STORAGE);
        return "";
      }
      return code;
    } catch (_error) {
      return "";
    }
  }

  function existing() {
    return readCookie() || readStorage() || "";
  }

  function write(code) {
    var norm = normalise(code);
    if (!norm) return "";
    try {
      var secure = window.location.protocol === "https:" ? "; Secure" : "";
      document.cookie = COOKIE + "=" + encodeURIComponent(norm)
        + "; Path=/; Max-Age=" + String(DAYS * 24 * 60 * 60)
        + "; SameSite=Lax" + secure;
    } catch (_error) {}
    try {
      window.localStorage.setItem(STORAGE, JSON.stringify({ code: norm, at: Date.now() }));
    } catch (_error2) {}
    return norm;
  }

  function capture() {
    var current = existing();
    var fromUrl = "";
    try {
      fromUrl = normalise(new URLSearchParams(window.location.search || "").get("ref"));
    } catch (_error) {}
    if (fromUrl && !current) return write(fromUrl);
    if (current && !readCookie()) write(current);
    if (current && !readStorage()) write(current);
    return current || "";
  }

  var api = {
    cookieName: COOKIE,
    storageKey: STORAGE,
    days: DAYS,
    normalise: normalise,
    capture: capture,
    get: function () { return existing() || capture(); },
    code: function () { return existing() || capture() || ""; }
  };

  try { capture(); } catch (_error) {}
  root.makaugReferral = api;
})(typeof window !== "undefined" ? window : this);
