/*
 * makaug site-wide language layer.
 *
 * The page-specific packs in makaug-app.js only translate elements they know
 * by id. Anything rendered from plain HTML (page headers, footer, nav items,
 * card badges, share buttons, off-plan cards...) stayed English when a visitor
 * picked another language. This layer closes that gap for every page:
 *
 *  - it watches <html lang> (set by setLang) and every DOM change;
 *  - every visible text node and placeholder/title/aria-label/alt attribute
 *    whose English text is in the site phrase pack is swapped for the chosen
 *    language, and templated strings ("3-bed property for sale in Kira") are
 *    translated by pattern;
 *  - the English original is remembered, so switching back to English (or to
 *    another language) always starts from the source text.
 *
 * Phrase packs live in /assets/i18n/site-<lang>.json and are fetched only when
 * a non-English language is chosen, so English visitors download nothing extra.
 */
(function () {
  "use strict";
  if (window.__makaugSiteI18n) return;

  var SUPPORTED = { lg: 1, sw: 1, ac: 1, ny: 1, rn: 1, sm: 1, am: 1, ar: 1 };
  var VERSION = "20261003-site-i18n-v3";
  var ATTRS = ["placeholder", "title", "aria-label", "alt", "data-tooltip"];
  var SKIP_SELECTOR = "script,style,noscript,code,pre,[data-no-translate],[contenteditable=true]";

  var packs = {};          // lang -> { phrases: {}, patterns: [[regex, template]] }
  var loading = {};        // lang -> Promise
  var textOrig = new WeakMap();   // Text node -> { src: english, out: last written }
  var activeLang = "en";
  var observer = null;
  var pending = new Set();
  var scheduled = false;
  var applying = false;

  function norm(value) {
    return String(value || "").replace(/[\s ]+/g, " ").trim();
  }

  function currentLang() {
    var lang = String(document.documentElement.getAttribute("lang") || "en").toLowerCase().split("-")[0];
    return SUPPORTED[lang] ? lang : "en";
  }

  function compilePack(raw) {
    var pack = { phrases: Object.create(null), lower: Object.create(null), patterns: [] };
    var phrases = raw && raw.phrases ? raw.phrases : {};
    Object.keys(phrases).forEach(function (key) {
      var k = norm(key);
      if (!k || !phrases[key]) return;
      pack.phrases[k] = phrases[key];
      pack.lower[k.toLowerCase()] = phrases[key];
    });
    (raw && raw.patterns ? raw.patterns : []).forEach(function (entry) {
      try {
        pack.patterns.push([new RegExp("^" + entry[0] + "$", "i"), entry[1]]);
      } catch (error) {}
    });
    return pack;
  }

  function loadPack(lang) {
    if (lang === "en" || packs[lang]) return Promise.resolve(packs[lang] || null);
    if (loading[lang]) return loading[lang];
    loading[lang] = fetch("/assets/i18n/site-" + lang + ".json?v=" + VERSION, { credentials: "same-origin" })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (raw) {
        packs[lang] = compilePack(raw || {});
        try {
          window.dispatchEvent(new CustomEvent("makaug:site-i18n-ready", { detail: { lang: lang } }));
        } catch (error) {}
        return packs[lang];
      })
      .catch(function () {
        packs[lang] = compilePack({});
        return packs[lang];
      });
    return loading[lang];
  }

  function lookupExact(pack, text) {
    if (!text) return "";
    return pack.phrases[text] || pack.lower[text.toLowerCase()] || "";
  }

  // Translate a captured fragment of a pattern ({1}, {2}...). Fragments are
  // usually place names (kept as-is) or small phrases ("for sale").
  function translateFragment(pack, fragment) {
    var value = norm(fragment);
    if (!value) return fragment;
    return lookupExact(pack, value) || (fragmentDepth < 3 ? nestedTranslate(pack, value) : "") || value;
  }

  function translateString(pack, source) {
    var text = norm(source);
    if (!text || !/[A-Za-z]/.test(text)) return "";
    var exact = lookupExact(pack, text);
    if (exact) return exact;

    // Leading emoji/icon text such as "💬 Chat on WhatsApp" or "📧 Email: x".
    var lead = text.match(/^([^A-Za-z0-9\s(]+)\s*(.+)$/);
    if (lead) {
      var inner = translateString(pack, lead[2]);
      return inner ? lead[1] + " " + inner : "";
    }

    // "Label: value" / "Label · value" combinations built in templates.
    var split = text.match(/^(.+?)(\s*[:·|]\s*)(.+)$/);
    if (split) {
      var left = lookupExact(pack, split[1]);
      var right = lookupExact(pack, split[3]) || patternTranslate(pack, split[3]);
      if (left && (right || !/[a-z]{3,}/.test(split[3]))) return left + split[2] + (right || split[3]);
      if (right && !/[a-z]{3,}/.test(split[1])) return split[1] + split[2] + right;
    }

    // Trailing counts or punctuation such as "Entebbe (1)" or "Search →".
    var tail = text.match(/^(.+?)\s*(\(\d[\d,]*\)|[→←›»…:]+)$/);
    if (tail) {
      var head = lookupExact(pack, tail[1]);
      if (head) return head + " " + tail[2];
    }
    return patternTranslate(pack, text);
  }

  // A captured fragment can itself be a templated string ("I am interested in
  // 3-bed house for sale in Kira."), so translate it fully, with a depth guard.
  var fragmentDepth = 0;
  function nestedTranslate(pack, value) {
    fragmentDepth += 1;
    try { return translateString(pack, value); } finally { fragmentDepth -= 1; }
  }

  function patternTranslate(pack, text) {
    for (var i = 0; i < pack.patterns.length; i += 1) {
      var match = text.match(pack.patterns[i][0]);
      if (!match) continue;
      return pack.patterns[i][1].replace(/\{(\d)\}/g, function (_all, index) {
        return translateFragment(pack, match[Number(index)] || "");
      });
    }
    return "";
  }

  function keepWhitespace(original, translated) {
    var lead = (original.match(/^\s*/) || [""])[0];
    var trail = (original.match(/\s*$/) || [""])[0];
    return lead + translated + trail;
  }

  function shouldSkip(element) {
    return !element || (element.closest && element.closest(SKIP_SELECTOR));
  }

  function translateTextNode(node, pack) {
    var value = node.nodeValue;
    if (!value || !value.trim()) return;
    // What a visitor typed into a text box is theirs; only its placeholder is ours.
    if (node.parentElement && node.parentElement.tagName === "TEXTAREA") return;
    var state = textOrig.get(node);
    if (state && value === state.out) {
      // Already ours; re-render only if the language changed.
    } else if (!state || value !== state.out) {
      state = { src: value, out: value };
      textOrig.set(node, state);
    }
    var target = state.src;
    if (pack) {
      var translated = translateString(pack, state.src);
      if (translated) target = keepWhitespace(state.src, translated);
    }
    if (node.nodeValue !== target) {
      state.out = target;
      node.nodeValue = target;
    } else {
      state.out = target;
    }
  }

  function translateAttributes(element, pack) {
    for (var i = 0; i < ATTRS.length; i += 1) {
      var name = ATTRS[i];
      if (!element.hasAttribute(name)) continue;
      var value = element.getAttribute(name);
      var srcKey = "data-i18n-src-" + name;
      var outKey = "data-i18n-out-" + name;
      var src = element.getAttribute(srcKey);
      var out = element.getAttribute(outKey);
      if (src === null || value !== out) {
        src = value;
        element.setAttribute(srcKey, src);
      }
      var target = src;
      if (pack) {
        var translated = translateString(pack, src);
        if (translated) target = translated;
      }
      element.setAttribute(outKey, target);
      if (value !== target) element.setAttribute(name, target);
    }
    if (element.tagName === "INPUT" && (element.type === "button" || element.type === "submit") && element.value) {
      var vSrc = element.getAttribute("data-i18n-src-value");
      var vOut = element.getAttribute("data-i18n-out-value");
      if (vSrc === null || element.value !== vOut) {
        vSrc = element.value;
        element.setAttribute("data-i18n-src-value", vSrc);
      }
      var vTarget = pack ? (translateString(pack, vSrc) || vSrc) : vSrc;
      element.setAttribute("data-i18n-out-value", vTarget);
      if (element.value !== vTarget) element.value = vTarget;
    }
  }

  function translateTree(root, pack) {
    if (!root) return;
    if (root.nodeType === 3) {
      if (!shouldSkip(root.parentElement)) translateTextNode(root, pack);
      return;
    }
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    if (root.nodeType === 1 && shouldSkip(root)) return;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        if (node.nodeType === 1) {
          return node.matches(SKIP_SELECTOR) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    if (root.nodeType === 1) translateAttributes(root, pack);
    var node;
    while ((node = walker.nextNode())) {
      if (node.nodeType === 3) translateTextNode(node, pack);
      else translateAttributes(node, pack);
    }
  }

  function withObserverPaused(fn) {
    // Changes the page made before this pass (and not yet delivered to the
    // observer) are still real changes: queue them first so they are not lost.
    if (observer) {
      var earlier = observer.takeRecords();
      if (earlier.length) onMutations(earlier);
    }
    applying = true;
    try { fn(); } finally {
      // Whatever is queued now was written by this pass itself.
      if (observer) observer.takeRecords();
      applying = false;
    }
    if (pending.size && !scheduled) {
      scheduled = true;
      (window.requestAnimationFrame || window.setTimeout)(flush, 16);
    }
  }

  function applyAll() {
    var lang = currentLang();
    activeLang = lang;
    if (lang === "en") {
      withObserverPaused(function () { translateTree(document.body, null); });
      if (document.title && document.documentElement.getAttribute("data-i18n-src-title")) {
        document.title = document.documentElement.getAttribute("data-i18n-src-title");
      }
      return Promise.resolve();
    }
    return loadPack(lang).then(function (pack) {
      if (currentLang() !== lang) return;
      withObserverPaused(function () {
        translateTree(document.body, pack);
        var title = document.title;
        var translatedTitle = translateString(pack, title);
        if (translatedTitle) {
          document.documentElement.setAttribute("data-i18n-src-title", title);
          document.title = translatedTitle;
        }
      });
    });
  }

  function flush() {
    scheduled = false;
    var lang = currentLang();
    if (lang !== activeLang) {
      pending.clear();
      applyAll();
      return;
    }
    var pack = lang === "en" ? null : packs[lang];
    if (lang !== "en" && !pack) {
      pending.clear();
      applyAll();
      return;
    }
    if (lang === "en") { pending.clear(); return; }
    var nodes = Array.from(pending);
    pending.clear();
    withObserverPaused(function () {
      nodes.forEach(function (node) {
        if (node.isConnected) translateTree(node, pack);
      });
    });
  }

  function schedule(node) {
    pending.add(node);
    if (scheduled) return;
    scheduled = true;
    (window.requestAnimationFrame || window.setTimeout)(flush, 16);
  }

  function onMutations(records) {
    if (applying) return;
    for (var i = 0; i < records.length; i += 1) {
      var record = records[i];
      if (record.type === "attributes") {
        if (record.target === document.documentElement) {
          if (record.attributeName === "lang") {
            pending.clear();
            if (!scheduled) { scheduled = true; (window.requestAnimationFrame || window.setTimeout)(flush, 16); }
            activeLang = "__changed__";
          }
          continue;
        }
        schedule(record.target);
      } else if (record.type === "characterData") {
        schedule(record.target);
      } else {
        for (var j = 0; j < record.addedNodes.length; j += 1) schedule(record.addedNodes[j]);
      }
    }
  }

  function start() {
    if (!document.body) return;
    observer = new MutationObserver(onMutations);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ATTRS
    });
    applyAll();
  }

  window.__makaugSiteI18n = {
    version: VERSION,
    apply: applyAll,
    translate: function (text, lang) {
      var target = lang || currentLang();
      if (target === "en" || !packs[target]) return text;
      return translateString(packs[target], text) || text;
    },
    load: loadPack
  };

  // Start fetching the visitor's saved language straight away, so the pack is
  // usually in place before the main bundle renders anything.
  (function preloadSavedLanguage() {
    var saved = "";
    try { saved = localStorage.getItem("makaug_lang") || ""; } catch (error) {}
    if (!saved) {
      var match = String(document.cookie || "").match(/(?:^|; )makaug_lang=([^;]+)/);
      saved = match ? decodeURIComponent(match[1]) : "";
    }
    saved = String(saved || "").toLowerCase().split("-")[0];
    if (SUPPORTED[saved]) loadPack(saved);
  })();

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
