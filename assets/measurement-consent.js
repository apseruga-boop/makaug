(function initializeMakaugMeasurementConsent(windowObject, documentObject) {
  "use strict";

  const COUNTRY_CODE = String(windowObject.MAKAUG_CONFIG?.countryCode || "UG").trim().toUpperCase() || "UG";
  const PUBLIC_NAME = String(
    windowObject.MAKAUG_CONFIG?.publicName
      || (COUNTRY_CODE === "UG" ? "MakaUG" : "the property platform")
  ).trim();
  const PUBLIC_NAME_HTML = escapeHtml(PUBLIC_NAME);
  const TENANT_NAMESPACE = COUNTRY_CODE === "UG" ? "makaug" : `property_${COUNTRY_CODE.toLowerCase()}`;
  const STORAGE_KEY = `${TENANT_NAMESPACE}_measurement_consent_v1`;
  const COOKIE_NAME = `${TENANT_NAMESPACE}_measurement_consent`;
  const ATTRIBUTION_STORAGE_KEY = "makaug_traffic_attribution_v2";
  const CONSENT_VERSION = "1";
  const COOKIE_MAX_AGE = 60 * 60 * 24 * 180;
  let currentChoice = readChoice();

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function normalizedChoice(value) {
    if (!value || typeof value !== "object" || value.version !== CONSENT_VERSION) return null;
    if (typeof value.analytics !== "boolean" || typeof value.advertising !== "boolean") return null;
    return {
      analytics: value.analytics,
      advertising: value.advertising,
      version: CONSENT_VERSION,
      decided_at: String(value.decided_at || "")
    };
  }

  function cookieValue(name) {
    const prefix = `${name}=`;
    return String(documentObject.cookie || "")
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(prefix))
      ?.slice(prefix.length) || "";
  }

  function readChoice() {
    try {
      const local = normalizedChoice(JSON.parse(windowObject.localStorage.getItem(STORAGE_KEY) || "null"));
      if (local) return local;
    } catch (_error) {}
    try {
      return normalizedChoice(JSON.parse(decodeURIComponent(cookieValue(COOKIE_NAME) || "null")));
    } catch (_error) {
      return null;
    }
  }

  function persistChoice(choice) {
    const serialized = JSON.stringify(choice);
    try {
      windowObject.localStorage.setItem(STORAGE_KEY, serialized);
    } catch (_error) {}
    const secure = windowObject.location?.protocol === "https:" ? "; Secure" : "";
    documentObject.cookie = `${COOKIE_NAME}=${encodeURIComponent(serialized)}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
  }

  function rootCookieDomain() {
    const host = String(windowObject.location?.hostname || "").replace(/^www\./, "");
    return host.includes(".") ? `.${host}` : "";
  }

  function deleteCookie(name) {
    const base = `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
    documentObject.cookie = base;
    const domain = rootCookieDomain();
    if (domain) documentObject.cookie = `${base}; Domain=${domain}`;
  }

  function deleteCookiesWithPrefixes(prefixes) {
    String(documentObject.cookie || "")
      .split(";")
      .map((part) => part.split("=")[0].trim())
      .filter((name) => prefixes.some((prefix) => name === prefix || name.startsWith(prefix)))
      .forEach(deleteCookie);
  }

  function clearStoredAttribution({ keepCampaign = false } = {}) {
    [ATTRIBUTION_STORAGE_KEY, "makaug_traffic_attribution_v1"].forEach((key) => {
      try {
        if (!keepCampaign) {
          windowObject.sessionStorage.removeItem(key);
          return;
        }
        const stored = JSON.parse(windowObject.sessionStorage.getItem(key) || "null");
        if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
          windowObject.sessionStorage.removeItem(key);
          return;
        }
        delete stored.oppref;
        delete stored.oppref_source_param;
        windowObject.sessionStorage.setItem(key, JSON.stringify(stored));
      } catch (_error) {
        try { windowObject.sessionStorage.removeItem(key); } catch (_ignored) {}
      }
    });
  }

  function validMetaPixelId(value) {
    return /^\d{6,24}$/.test(String(value || "").trim());
  }

  function openAIAdsPixelId() {
    const value = String(
      windowObject.MAKAUG_OPENAI_ADS_PIXEL_ID
        || windowObject.MAKAUG_CONFIG?.openAIAdsPixelId
        || ""
    ).trim();
    return /^[A-Za-z0-9_-]{6,200}$/.test(value) ? value : "";
  }

  function initializeMetaPixel() {
    const pixelId = String(windowObject.__makaugMetaPixelId || "").trim();
    if (!validMetaPixelId(pixelId)) return false;
    if (typeof windowObject.fbq !== "function") {
      const queue = function () {
        if (queue.callMethod) queue.callMethod.apply(queue, arguments);
        else queue.queue.push(arguments);
      };
      windowObject.fbq = queue;
      if (!windowObject._fbq) windowObject._fbq = queue;
      queue.push = queue;
      queue.loaded = true;
      queue.version = "2.0";
      queue.queue = [];
      const script = documentObject.createElement("script");
      script.async = true;
      script.src = "https://connect.facebook.net/en_US/fbevents.js";
      script.setAttribute("data-meta-pixel-id", pixelId);
      const firstScript = documentObject.getElementsByTagName("script")[0];
      firstScript.parentNode.insertBefore(script, firstScript);
      queue("consent", "grant");
      queue("init", pixelId);
      queue("track", "PageView", {
        page_path: windowObject.location.pathname || "/",
        site_country: COUNTRY_CODE
      });
    } else {
      windowObject.fbq("consent", "grant");
    }
    windowObject.__makaugMetaPixelReady = true;
    return true;
  }

  function initializeOpenAIAdsPixel() {
    const pixelId = openAIAdsPixelId();
    if (!pixelId) return false;
    if (windowObject.__makaugOpenAIAdsPixelReady === true && typeof windowObject.oaiq === "function") {
      windowObject.oaiq("consent", true);
      return true;
    }
    if (typeof windowObject.oaiq !== "function") {
      const queue = function () { queue.q.push(arguments); };
      queue.q = [];
      windowObject.oaiq = queue;
      const script = documentObject.createElement("script");
      script.async = true;
      script.src = "https://bzrcdn.openai.com/sdk/oaiq.min.js";
      script.setAttribute("data-openai-ads-pixel-id", pixelId);
      const firstScript = documentObject.getElementsByTagName("script")[0];
      firstScript.parentNode.insertBefore(script, firstScript);
    }
    // OpenAI defaults to granted consent, so this order is deliberate: the
    // explicit consent decision is queued before Pixel initialization.
    windowObject.oaiq("consent", true);
    windowObject.oaiq("init", { pixelId });
    windowObject.__makaugOpenAIAdsPixelReady = true;
    return true;
  }

  function revokeAnalytics() {
    try {
      windowObject.localStorage.removeItem("makaug_client_id");
    } catch (_error) {}
    if (typeof windowObject.gtag === "function") {
      windowObject.gtag("consent", "update", {
        analytics_storage: "denied",
        ad_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied"
      });
    }
    documentObject.querySelectorAll("script[data-ga-id]").forEach((script) => {
      const id = script.getAttribute("data-ga-id");
      if (id) windowObject[`ga-disable-${id}`] = true;
    });
    deleteCookiesWithPrefixes(["_ga", "_gid", "_gat"]);
    if (!allowsAdvertising()) clearStoredAttribution();
  }

  function revokeAdvertising() {
    if (typeof windowObject.fbq === "function") windowObject.fbq("consent", "revoke");
    if (typeof windowObject.oaiq === "function") windowObject.oaiq("consent", false);
    windowObject.__makaugMetaPixelReady = false;
    windowObject.__makaugOpenAIAdsPixelReady = false;
    deleteCookiesWithPrefixes(["_fbp", "_fbc", "__oppref", "__obref"]);
    clearStoredAttribution({ keepCampaign: allowsAnalytics() });
  }

  function applyChoice(choice) {
    if (choice.analytics) {
      documentObject.querySelectorAll("script[data-ga-id]").forEach((script) => {
        const id = script.getAttribute("data-ga-id");
        if (id) windowObject[`ga-disable-${id}`] = false;
      });
    } else {
      revokeAnalytics();
    }

    if (choice.advertising) {
      initializeMetaPixel();
      initializeOpenAIAdsPixel();
    } else {
      revokeAdvertising();
    }
  }

  function snapshot() {
    return currentChoice
      ? { ...currentChoice }
      : { analytics: false, advertising: false, version: CONSENT_VERSION, decided_at: "" };
  }

  function allowsAnalytics() {
    return currentChoice?.analytics === true;
  }

  function allowsAdvertising() {
    return currentChoice?.advertising === true;
  }

  function boundedAttributionText(value, maxLength) {
    return String(value || "")
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .trim()
      .slice(0, maxLength);
  }

  function attributionForLead() {
    const consent = snapshot();
    const allowCampaign = consent.analytics === true || consent.advertising === true;
    let stored = null;
    if (allowCampaign) {
      try {
        stored = JSON.parse(
          windowObject.sessionStorage.getItem(ATTRIBUTION_STORAGE_KEY)
            || windowObject.sessionStorage.getItem("makaug_traffic_attribution_v1")
            || "null"
        );
      } catch (_error) {}
    }

    const params = new URLSearchParams(windowObject.location?.search || "");
    const directOppref = boundedAttributionText(params.get("oppref"), 512);
    const fallbackOppref = boundedAttributionText(params.get("click_id"), 512);
    const current = {
      utm_source: boundedAttributionText(params.get("utm_source"), 120).toLowerCase(),
      utm_medium: boundedAttributionText(params.get("utm_medium"), 120).toLowerCase(),
      utm_campaign: boundedAttributionText(params.get("utm_campaign"), 240),
      utm_content: boundedAttributionText(params.get("utm_content"), 240),
      utm_term: boundedAttributionText(params.get("utm_term"), 240),
      oppref: directOppref || fallbackOppref,
      oppref_source_param: directOppref ? "oppref" : (fallbackOppref ? "click_id" : ""),
      landing_page: boundedAttributionText(
        `${windowObject.location?.pathname || "/"}${windowObject.location?.hash || ""}`,
        1024
      )
    };
    const hasCurrentAttribution = Object.entries(current)
      .some(([key, value]) => key !== "landing_page" && Boolean(value));
    const attribution = hasCurrentAttribution ? current : (stored || current);

    if (allowCampaign && hasCurrentAttribution) {
      try {
        windowObject.sessionStorage.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify(attribution));
      } catch (_error) {}
    }

    return {
      ...(allowCampaign && attribution.utm_source ? { utm_source: boundedAttributionText(attribution.utm_source, 120) } : {}),
      ...(allowCampaign && attribution.utm_medium ? { utm_medium: boundedAttributionText(attribution.utm_medium, 120) } : {}),
      ...(allowCampaign && attribution.utm_campaign ? { utm_campaign: boundedAttributionText(attribution.utm_campaign, 240) } : {}),
      ...(allowCampaign && attribution.utm_content ? { utm_content: boundedAttributionText(attribution.utm_content, 240) } : {}),
      ...(allowCampaign && attribution.utm_term ? { utm_term: boundedAttributionText(attribution.utm_term, 240) } : {}),
      ...(consent.advertising === true && attribution.oppref ? { oppref: boundedAttributionText(attribution.oppref, 512) } : {}),
      ...(consent.advertising === true && attribution.oppref_source_param
        ? { oppref_source_param: boundedAttributionText(attribution.oppref_source_param, 32) }
        : {}),
      ...(allowCampaign && attribution.landing_page ? { landing_page: boundedAttributionText(attribution.landing_page, 1024) } : {}),
      measurement_consent: {
        analytics: consent.analytics === true,
        advertising: consent.advertising === true,
        version: String(consent.version || CONSENT_VERSION).slice(0, 16)
      }
    };
  }

  function leadAttributionHeaders() {
    const attribution = attributionForLead();
    let encoded = encodeURIComponent(JSON.stringify(attribution));
    if (encoded.length > 7000) {
      encoded = encodeURIComponent(JSON.stringify({
        ...(attribution.utm_content ? { utm_content: attribution.utm_content } : {}),
        ...(attribution.oppref ? { oppref: attribution.oppref } : {}),
        ...(attribution.oppref_source_param ? { oppref_source_param: attribution.oppref_source_param } : {}),
        measurement_consent: attribution.measurement_consent
      }));
    }
    return encoded.length <= 7000 ? { "X-Makaug-Lead-Attribution": encoded } : {};
  }

  function emitChange() {
    windowObject.dispatchEvent(new CustomEvent("makaug:measurement-consent-changed", {
      detail: snapshot()
    }));
  }

  function renderUiState() {
    const banner = documentObject.getElementById("makaug-consent-banner");
    if (banner) banner.hidden = Boolean(currentChoice);
    const analyticsToggle = documentObject.getElementById("makaug-consent-analytics");
    const advertisingToggle = documentObject.getElementById("makaug-consent-advertising");
    if (analyticsToggle) analyticsToggle.checked = currentChoice?.analytics === true;
    if (advertisingToggle) advertisingToggle.checked = currentChoice?.advertising === true;
  }

  function saveChoice(nextChoice) {
    const previous = currentChoice;
    currentChoice = {
      analytics: nextChoice.analytics === true,
      advertising: nextChoice.advertising === true,
      version: CONSENT_VERSION,
      decided_at: new Date().toISOString()
    };
    persistChoice(currentChoice);
    applyChoice(currentChoice);
    renderUiState();
    closeSettings();
    emitChange();

    const revokedLoadedCategory = Boolean(
      (previous?.analytics && !currentChoice.analytics)
      || (previous?.advertising && !currentChoice.advertising)
    );
    if (revokedLoadedCategory) windowObject.location.reload();
  }

  function openSettings() {
    ensureUi();
    renderUiState();
    const dialog = documentObject.getElementById("makaug-consent-dialog");
    if (dialog) {
      dialog.hidden = false;
      dialog.setAttribute("aria-hidden", "false");
      documentObject.getElementById("makaug-consent-analytics")?.focus();
    }
  }

  function closeSettings() {
    const dialog = documentObject.getElementById("makaug-consent-dialog");
    if (!dialog) return;
    dialog.hidden = true;
    dialog.setAttribute("aria-hidden", "true");
  }

  function ensureUi() {
    if (!documentObject.body || documentObject.getElementById("makaug-consent-banner")) return;
    const shell = documentObject.createElement("div");
    shell.id = "makaug-consent-shell";
    shell.innerHTML = `
      <section id="makaug-consent-banner" class="makaug-consent-banner" role="region" aria-label="Privacy choices" ${currentChoice ? "hidden" : ""}>
        <div class="makaug-consent-copy">
          <h2>Your privacy choices</h2>
          <p>Essential storage keeps ${PUBLIC_NAME_HTML} secure and remembers settings. With your permission, analytics helps us improve the site and advertising measurement tells us which campaigns lead to enquiries.</p>
          <p class="makaug-consent-links"><a href="/privacy-policy">Privacy Policy</a><a href="/cookie-policy">Cookie Policy</a></p>
        </div>
        <div class="makaug-consent-actions">
          <button type="button" data-consent-action="accept">Accept optional</button>
          <button type="button" data-consent-action="essential">Use essential only</button>
          <button type="button" class="makaug-consent-manage" data-consent-action="manage">Manage choices</button>
        </div>
      </section>
      <div id="makaug-consent-dialog" class="makaug-consent-dialog" role="dialog" aria-modal="true" aria-labelledby="makaug-consent-title" aria-hidden="true" hidden>
        <div class="makaug-consent-panel">
          <h2 id="makaug-consent-title">Cookie and measurement settings</h2>
          <p>Choose the optional categories ${PUBLIC_NAME_HTML} may use. Essential storage is always on because the site needs it to work securely.</p>
          <label class="makaug-consent-option"><span><strong>Essential</strong><small>Sign-in, security, language and your privacy choice.</small></span><input type="checkbox" checked disabled aria-label="Essential storage is always on"></label>
          <label class="makaug-consent-option"><span><strong>Analytics</strong><small>First-party usage events, Google Analytics and performance measurements.</small></span><input id="makaug-consent-analytics" type="checkbox"></label>
          <label class="makaug-consent-option"><span><strong>Advertising measurement</strong><small>Meta, OpenAI and Google advertising tools, including campaign and conversion identifiers.</small></span><input id="makaug-consent-advertising" type="checkbox"></label>
          <div class="makaug-consent-dialog-actions">
            <button type="button" data-consent-action="save">Save choices</button>
            <button type="button" class="makaug-consent-secondary" data-consent-action="cancel">Cancel</button>
          </div>
        </div>
      </div>`;
    documentObject.body.appendChild(shell);
    shell.addEventListener("click", (event) => {
      const action = event.target.closest("[data-consent-action]")?.dataset.consentAction;
      if (action === "accept") saveChoice({ analytics: true, advertising: true });
      if (action === "essential") saveChoice({ analytics: false, advertising: false });
      if (action === "manage") openSettings();
      if (action === "save") saveChoice({
        analytics: documentObject.getElementById("makaug-consent-analytics")?.checked === true,
        advertising: documentObject.getElementById("makaug-consent-advertising")?.checked === true
      });
      if (action === "cancel") closeSettings();
    });
    documentObject.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && currentChoice) closeSettings();
    });
    renderUiState();
  }

  function measureOpenAILead(eventId) {
    if (!allowsAdvertising() || windowObject.__makaugOpenAIAdsPixelReady !== true || typeof windowObject.oaiq !== "function") return false;
    const options = eventId ? { event_id: String(eventId).slice(0, 200) } : undefined;
    if (options) windowObject.oaiq("measure", "lead_created", { type: "customer_action" }, options);
    else windowObject.oaiq("measure", "lead_created", { type: "customer_action" });
    return true;
  }

  windowObject.makaugMeasurementConsent = Object.freeze({
    allowsAdvertising,
    allowsAnalytics,
    leadAttributionHeaders,
    measureOpenAILead,
    openSettings,
    snapshot
  });
  windowObject.openMakaugCookieSettings = openSettings;

  if (currentChoice) applyChoice(currentChoice);
  else clearStoredAttribution();
  if (documentObject.readyState === "loading") {
    documentObject.addEventListener("DOMContentLoaded", ensureUi, { once: true });
  } else {
    ensureUi();
  }
})(window, document);
