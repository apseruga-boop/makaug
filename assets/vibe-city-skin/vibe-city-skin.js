'use strict';
(function (root) {
  var ASSET = '/assets/vibe-city-skin/';
  var HERO_WIDE = ASSET + 'hero-wide.webp';
  var HERO_MOBILE = ASSET + 'hero-mobile.webp';
  var BANNER = ASSET + 'banner-thin.webp';

  // Official area first; campaign badge second. Only names already used in
  // the approved Kampala Vibe City map key — nothing invented here.
  var BADGES = {
    kololo: 'Kololo Heights',
    muyenga: 'Tank Hill Beach',
    ntinda: 'Ntinda Nights',
    kabalagala: 'Kabz Strip',
    rubaga: 'Rubaga Cathedral Hills',
    mengo: 'Mengo Old Town',
    nakawa: 'Nakawa Hustle Yard',
    bugolobi: 'Bugolobi Bay',
    munyonyo: 'Munyonyo Marina',
    kira: 'Kira Boulevard',
    kyanja: 'Kyanja Palms',
    gayaza: 'Gayaza Plot Country',
    nansana: 'Nansana Starter Strip',
    entebbe: 'Entebbe Airport Shores',
    mukono: 'Mukono Eastside',
    jinja: 'Source Bay',
    gaba: 'Coco Beach Lagoon',
    gabaa: 'Coco Beach Lagoon',
    kansanga: 'Kansanga College Strip',
    najjera: 'Najjera Ridge',
    bweyogerere: 'Bweyogerere Junction',
    kyaliwajjala: 'Kyaliwajjala Crossroads',
    namugongo: 'Namugongo Martyrs Way',
    wandegeya: 'Wandegeya Campus Gate',
    makindye: 'Makindye Hill',
    kisaasi: 'Kisaasi Gardens',
    nakasero: 'Downtown'
  };

  var savedHero = null;
  var hooked = false;

  function windowApi() {
    return root.VibeCitySkinWindow || {};
  }

  function active() {
    var W = windowApi();
    if (typeof W.isVibeCitySkinActive !== 'function') return false;
    return W.isVibeCitySkinActive({
      search: location.search,
      pathname: location.pathname,
      page: currentPageName()
    });
  }

  function currentPageName() {
    var el = document.querySelector('.page.active');
    var id = el && el.id ? el.id : '';
    return id.indexOf('page-') === 0 ? id.slice(5) : '';
  }

  function isDesk() {
    var W = windowApi();
    return (W.isDeskPath && W.isDeskPath(location.pathname)) || (W.isDeskPage && W.isDeskPage(currentPageName()));
  }

  function path() {
    var p = location.pathname || '/';
    if (p.length > 1 && p.slice(-1) === '/') p = p.slice(0, -1);
    return p || '/';
  }

  function el(html) {
    var t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  function lazyArt(src, className, objectPos) {
    var img = document.createElement('img');
    img.className = className;
    img.alt = '';
    img.decoding = 'async';
    img.loading = 'lazy';
    img.src = src;
    if (objectPos) img.style.objectPosition = objectPos;
    return img;
  }

  function insertAfterHeader(node) {
    var spotlight = document.getElementById('language-spotlight');
    var header = document.querySelector('header') || document.querySelector('nav');
    var anchor = spotlight || header;
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(node, anchor.nextSibling);
    else document.body.insertBefore(node, document.body.firstChild);
  }

  function hideHomeCounts() {
    document.querySelectorAll(
      '#hero-property-counter, #hero-property-count, #hero-property-counter-tooltip, .hero-opportunity-counter, .hero-opportunity-tooltip'
    ).forEach(function (n) { n.setAttribute('hidden', 'hidden'); });
    var popular = Array.prototype.find.call(document.querySelectorAll('h2'), function (h) {
      return /Popular property areas/i.test(h.textContent || '');
    });
    if (!popular) return;
    var rootEl = popular.parentElement || popular;
    rootEl.querySelectorAll('a,button,span').forEach(function (a) {
      var t = a.childNodes.length === 1 ? a.textContent : null;
      if (t && /\(\d+\)\s*$/.test(t) && t.length < 40) a.textContent = t.replace(/\s*\(\d+\)\s*$/, '');
    });
  }

  function slugKey(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function titleCase(value) {
    return String(value || '').replace(/[-_]+/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); }).trim();
  }

  function areaFromPath() {
    var parts = path().split('/').filter(Boolean);
    if (!parts.length) return null;
    var last = decodeURIComponent(parts[parts.length - 1] || '');
    if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(last) || /^MK-/i.test(last)) return null;
    var bits = last.split('-').filter(Boolean);
    if (!bits.length) return null;
    var area = titleCase(bits[0]);
    var district = bits.length > 1 ? titleCase(bits.slice(1).join(' ')) : '';
    var official = district ? area + ', ' + district : area;
    return { area: area, official: official, key: slugKey(bits[0]) };
  }

  function areaFromPage() {
    var heading = document.querySelector('#page-detail h1, #page-land h1, .page.active h1');
    var text = heading ? String(heading.textContent || '') : '';
    var match = text.match(/\bin\s+([A-Za-z][A-Za-z\s'-]+?)(?:,\s*([A-Za-z][A-Za-z\s'-]+?))?(?:,\s*[A-Za-z].*)?$/);
    if (match) {
      var area = match[1].trim();
      var district = (match[2] || '').trim();
      return { area: area, official: district ? area + ', ' + district : area, key: slugKey(area) };
    }
    return areaFromPath();
  }

  function missionOpts() {
    var info = areaFromPage() || { area: 'Kampala', official: 'Kampala', key: 'kampala' };
    var badge = BADGES[info.key] || '';
    return {
      area: info.area,
      official: info.official,
      badge: badge,
      mission: 'MISSION: Ride to ' + info.area,
      gold: info.area
    };
  }

  function detectMode() {
    var W = windowApi();
    var p = path();
    if (p === '/' || p === '/index.html') return 'home';
    if (p === '/list-property' || p.indexOf('/list-property') === 0) {
      var box = document.getElementById('lp-success-box');
      var success = box && !box.classList.contains('hidden');
      if (success || (W.isConfirmPreview && W.isConfirmPreview({ search: location.search }))) return 'confirm';
      return 'list';
    }
    if (/^\/property\//i.test(p)) return 'listing';
    if (/^\/(land|for-sale|to-rent|houses-for-sale|houses-for-rent|short-stay|student-accommodation|commercial|off-plan)\//i.test(p)) return 'results';
    return 'thin';
  }

  function ensureHeroArt(hero) {
    if (hero.querySelector('.vc-hero-art')) return;
    var pic = document.createElement('picture');
    pic.className = 'vc-hero-art';
    var source = document.createElement('source');
    source.media = '(max-width: 640px)';
    source.srcset = HERO_MOBILE;
    var img = document.createElement('img');
    img.alt = '';
    img.decoding = 'async';
    img.loading = 'lazy';
    img.src = HERO_WIDE;
    img.sizes = '100vw';
    pic.appendChild(source);
    pic.appendChild(img);
    hero.insertBefore(pic, hero.firstChild);
  }

  function skinHero() {
    var hero = document.querySelector('section.hero-bg');
    if (hero) {
      hero.classList.add('vc-hero');
      ensureHeroArt(hero);
    }
    var badge = document.getElementById('hero-badge');
    var title = document.getElementById('hero-title');
    var sub = document.getElementById('hero-subtitle');
    if (!savedHero) {
      savedHero = {
        badge: badge ? badge.innerHTML : null,
        title: title ? title.innerHTML : null,
        sub: sub ? sub.innerHTML : null
      };
    }
    if (badge) {
      badge.classList.add('vc-hero-badge');
      badge.innerHTML = '<i class="fas fa-check-circle"></i> Kampala Vibe City';
    }
    if (title) {
      title.classList.add('vc-hero-title');
      title.innerHTML =
        '<span class="vc-kampala">KAMPALA</span>' +
        '<span class="vc-vibe">Vibe City</span>';
    }
    if (sub) {
      sub.classList.add('vc-hero-sub');
      sub.innerHTML = 'MISSION: Find your next <span class="vc-gold">home</span>';
    }
  }

  function restoreHero() {
    if (!savedHero) return;
    var badge = document.getElementById('hero-badge');
    var title = document.getElementById('hero-title');
    var sub = document.getElementById('hero-subtitle');
    var hero = document.querySelector('section.hero-bg');
    if (badge && savedHero.badge != null) {
      badge.innerHTML = savedHero.badge;
      badge.classList.remove('vc-hero-badge');
    }
    if (title && savedHero.title != null) {
      title.innerHTML = savedHero.title;
      title.classList.remove('vc-hero-title');
    }
    if (sub && savedHero.sub != null) {
      sub.innerHTML = savedHero.sub;
      sub.classList.remove('vc-hero-sub');
    }
    if (hero) {
      hero.classList.remove('vc-hero');
      hero.querySelectorAll('.vc-hero-art').forEach(function (n) { n.remove(); });
    }
  }

  function thinBanner() {
    if (document.getElementById('vc-thin-banner')) return;
    var bar = el(
      '<div id="vc-thin-banner" role="banner">' +
        '<div class="vc-thin-inner">' +
          '<span class="vc-thin-brand">KAMPALA</span>' +
          '<span class="vc-thin-script">Vibe City</span>' +
          '<span class="vc-thin-sep">·</span>' +
          '<span class="vc-thin-mission">MISSION: Find your next <span class="vc-gold">home</span></span>' +
        '</div>' +
      '</div>'
    );
    bar.insertBefore(lazyArt(BANNER, 'vc-thin-art', 'right center'), bar.firstChild);
    insertAfterHeader(bar);
  }

  function missionStrip(opts) {
    if (document.getElementById('vc-mission-strip')) return;
    var area = opts.area || 'Kampala';
    var official = opts.official || area;
    var badge = opts.badge || '';
    var mission = opts.mission || ('MISSION: Ride to ' + area);
    var goldWord = opts.gold || area;
    var parts = mission.split(goldWord);
    var line = (parts[0] || '') + '<span class="vc-gold">' + goldWord + '</span>' + (parts[1] || '');
    var badgeHtml = badge
      ? '<div class="vc-area-badge"><span class="official"></span><span class="dot"></span><span class="game"></span></div>'
      : '<div class="vc-area-badge"><span class="official"></span></div>';
    var strip = el('<div id="vc-mission-strip"><div class="vc-mission-line"></div>' + badgeHtml + '</div>');
    strip.querySelector('.vc-mission-line').innerHTML = line;
    strip.querySelector('.official').textContent = official;
    var game = strip.querySelector('.game');
    if (game) game.textContent = badge;
    insertAfterHeader(strip);
  }

  function listHero() {
    if (document.getElementById('vc-list-hero')) return;
    var box = el(
      '<div id="vc-list-hero">' +
        '<div class="vc-list-inner">' +
          '<span class="vc-kampala">KAMPALA</span>' +
          '<span class="vc-vibe">Vibe City</span>' +
          '<div class="vc-mission-line">MISSION: List your <span class="vc-gold">plot</span></div>' +
          '<p>Selling or renting? List it yourself on makaug.com</p>' +
        '</div>' +
      '</div>'
    );
    box.insertBefore(lazyArt(HERO_WIDE, 'vc-list-art', 'right 28%'), box.firstChild);
    insertAfterHeader(box);
  }

  function formatUgPhone(raw) {
    var digits = String(raw || '').replace(/\D/g, '');
    if (digits.indexOf('256') === 0 && digits.length === 12) digits = '0' + digits.slice(3);
    if (digits.length === 10 && digits.charAt(0) === '0') {
      return digits.slice(0, 4) + ' ' + digits.slice(4, 7) + ' ' + digits.slice(7);
    }
    return String(raw || '').replace(/\s+/g, ' ').trim();
  }

  function headerWhatsapp() {
    var link = document.querySelector('.mk-top-strip a[href*="wa.me"], .mk-top-strip a[href*="whatsapp"]');
    if (!link) return '';
    var text = String(link.textContent || '').replace(/\s+/g, ' ').trim();
    var num = text.match(/0\d[\d\s]{6,}/);
    if (num) return formatUgPhone(num[0]);
    return '';
  }

  function successReference() {
    var ref = document.getElementById('lp-success-ref');
    var text = ref ? String(ref.textContent || '').trim() : '';
    return text;
  }

  function addConfirmRow(panel, label, value, className) {
    var row = document.createElement('div');
    row.className = 'row';
    var l = document.createElement('span');
    l.textContent = label;
    var v = document.createElement('span');
    if (className) v.className = className;
    v.textContent = value;
    row.appendChild(l);
    row.appendChild(v);
    var cta = panel.querySelector('.cta');
    panel.insertBefore(row, cta);
  }

  function confirmPanel() {
    document.body.classList.add('vc-confirm-mode');
    if (document.getElementById('vc-confirm-wrap')) return;
    var panel = el(
      '<div id="vc-confirm-wrap"><div id="vc-confirm">' +
        '<div id="vc-confirm-band">' +
          '<div class="vc-complete">mission complete</div>' +
          '<div class="vc-complete-sub">We have your listing for review</div>' +
        '</div>' +
        '<div id="vc-confirm-panel">' +
          '<a class="cta" href="/list-property">List another property</a>' +
          '<div class="fine">Looking for your next property or rental? Try makaug.com</div>' +
        '</div>' +
      '</div></div>'
    );
    var box = panel.querySelector('#vc-confirm-panel');
    addConfirmRow(box, 'Listed on', 'makaug.com');
    addConfirmRow(box, 'Staff review', 'In progress', 'ok');
    var ref = successReference();
    if (ref) addConfirmRow(box, 'Reference', ref);
    var wa = headerWhatsapp();
    if (wa) addConfirmRow(box, 'WhatsApp', wa);
    panel.insertBefore(lazyArt(HERO_WIDE, 'vc-confirm-art', 'right 30%'), panel.firstChild);
    insertAfterHeader(panel);
  }

  function clearInjected() {
    ['vc-thin-banner', 'vc-mission-strip', 'vc-list-hero', 'vc-confirm-wrap'].forEach(function (id) {
      var n = document.getElementById(id);
      if (n) n.remove();
    });
    document.body.classList.remove('vc-confirm-mode', 'vc-skin');
    restoreHero();
  }

  function apply() {
    if (!active() || isDesk()) {
      clearInjected();
      return;
    }
    var next = detectMode();
    var current = document.body.getAttribute('data-vc-mode') || '';
    if (document.body.classList.contains('vc-skin') && current === next &&
        (next !== 'confirm' || document.getElementById('vc-confirm-wrap')) &&
        (next !== 'home' || document.querySelector('.hero-bg.vc-hero'))) {
      return;
    }
    clearInjected();
    document.body.classList.add('vc-skin');
    document.body.setAttribute('data-vc-mode', next);
    if (next === 'home') {
      hideHomeCounts();
      skinHero();
    } else if (next === 'thin') {
      thinBanner();
    } else if (next === 'results' || next === 'listing') {
      missionStrip(missionOpts());
    } else if (next === 'list') {
      listHero();
    } else if (next === 'confirm') {
      confirmPanel();
    }
  }

  function hookNavigation() {
    if (hooked) return;
    hooked = true;
    ['pushState', 'replaceState'].forEach(function (key) {
      var orig = history[key];
      if (typeof orig !== 'function') return;
      history[key] = function () {
        var result = orig.apply(this, arguments);
        setTimeout(apply, 0);
        return result;
      };
    });
    window.addEventListener('popstate', function () { setTimeout(apply, 0); });
    var pending = null;
    function queue() {
      if (pending) return;
      pending = setTimeout(function () { pending = null; apply(); }, 50);
    }
    var observer = new MutationObserver(queue);
    var watch = document.getElementById('lp-success-box') || document.querySelector('main') || document.body;
    observer.observe(watch, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    document.querySelectorAll('.page').forEach(function (page) {
      observer.observe(page, { attributes: true, attributeFilter: ['class'] });
    });
  }

  function start() {
    hookNavigation();
    apply();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  root.VCSkin = { apply: apply, detectMode: detectMode };
})(window);
