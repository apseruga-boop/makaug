/* makaug Short Term stays - client app
 *
 * Loads after assets/makaug-app.js, the same way assets/off-plan.js does.
 * Everything it touches lives inside #page-short-term.
 *
 * The model this code enforces, everywhere: makaug is a DISCOVERY platform.
 * We show the place and the host's own phone number. We do not take bookings,
 * we do not hold money, and we never tell a guest whether a host replied.
 */
(function () {
  'use strict';

  if (window.__makaugShortTermLoaded) return;

  // The server injects window.__makaugShortTerm into every public page when
  // SHORT_TERM_ENABLED is on. No config means the section is dark, so this
  // script does nothing at all: no requests, no DOM changes, no nav entries.
  if (!window.__makaugShortTerm || window.__makaugShortTerm.enabled !== true) return;

  window.__makaugShortTermLoaded = true;

  var API = '/api/short-term';
  var ROOT_ID = 'page-short-term';
  var state = {
    meta: null,
    listings: [],
    total: 0,
    map: null,
    markers: [],
    mapOn: false,
    rating: 0,
    wizardStep: 1,
    windows: [{ starts_on: '', ends_on: '' }],
    // Set once the listing exists. Photos are attached after submission, not
    // before: that is the only point at which there is a listing to attach
    // them to, and it means a host on a bad connection has already saved the
    // hard part before they start uploading megabytes.
    listingId: null,
    uploadToken: null,
    photos: []
  };

  // ---------------------------------------------------------------- helpers

  function root() { return document.getElementById(ROOT_ID); }
  function $(sel) { var r = root(); return r ? r.querySelector(sel) : null; }
  function $$(sel) { var r = root(); return r ? Array.prototype.slice.call(r.querySelectorAll(sel)) : []; }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function ugx(amount) {
    var n = Number(amount || 0);
    if (!isFinite(n)) return 'UGX 0';
    return 'UGX ' + Math.round(n).toLocaleString('en-UG');
  }

  function api(path, options) {
    var opts = options || {};
    return fetch(API + path, {
      method: opts.method || 'GET',
      credentials: 'same-origin',
      headers: Object.assign({ Accept: 'application/json' }, opts.body ? { 'Content-Type': 'application/json' } : {}),
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (payload) {
        if (!res.ok || payload.ok === false) {
          var err = new Error(payload.error || 'Something went wrong');
          err.details = payload.details || [];
          err.status = res.status;
          throw err;
        }
        return payload;
      });
    });
  }

  function currentPath() {
    return (window.location.pathname || '/').replace(/\/+$/, '') || '/';
  }

  function qs() {
    var out = {};
    new URLSearchParams(window.location.search || '').forEach(function (v, k) { out[k] = v; });
    return out;
  }

  function go(path, replace) {
    if (window.history && window.history.pushState) {
      window.history[replace ? 'replaceState' : 'pushState']({}, '', path);
      route();
      window.scrollTo({ top: 0, behavior: 'auto' });
    } else {
      window.location.href = path;
    }
  }

  function stars(rating) {
    var full = Math.round(Number(rating) || 0);
    var out = '';
    for (var i = 1; i <= 5; i += 1) out += i <= full ? '★' : '☆';
    return out;
  }

  function todayIso(offsetDays) {
    var d = new Date();
    d.setDate(d.getDate() + (offsetDays || 0));
    return d.toISOString().slice(0, 10);
  }

  // ---------------------------------------------------------------- leaflet

  function loadLeaflet() {
    if (window.L) return Promise.resolve(true);
    return new Promise(function (resolve) {
      if (!document.querySelector('link[data-makaug-leaflet-css="true"]')) {
        var link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        link.setAttribute('data-makaug-leaflet-css', 'true');
        document.head.appendChild(link);
      }
      var existing = document.getElementById('makaug-leaflet-script');
      if (existing) {
        existing.addEventListener('load', function () { resolve(!!window.L); }, { once: true });
        existing.addEventListener('error', function () { resolve(false); }, { once: true });
        if (window.L) resolve(true);
        return;
      }
      var script = document.createElement('script');
      script.id = 'makaug-leaflet-script';
      script.async = true;
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.onload = function () { resolve(!!window.L); };
      script.onerror = function () { resolve(false); };
      document.head.appendChild(script);
    });
  }

  function paintMap() {
    var host = document.getElementById('st-map');
    if (!host) return;
    loadLeaflet().then(function (ok) {
      if (!ok || !window.L) {
        host.innerHTML = '<div class="st-empty"><i class="fas fa-map"></i>The map could not load. The list below shows every place.</div>';
        return;
      }
      var pins = state.listings.filter(function (l) {
        return typeof l.latitude === 'number' && typeof l.longitude === 'number';
      });

      if (!state.map) {
        state.map = window.L.map(host, { scrollWheelZoom: false })
          .setView([0.3476, 32.5825], 11); // Kampala
        window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 18,
          attribution: '&copy; OpenStreetMap contributors'
        }).addTo(state.map);
      }

      state.markers.forEach(function (m) { state.map.removeLayer(m); });
      state.markers = [];

      if (!pins.length) {
        state.map.setView([0.3476, 32.5825], 10);
        setTimeout(function () { state.map.invalidateSize(); }, 60);
        return;
      }

      var bounds = [];
      pins.forEach(function (listing) {
        // The price IS the pin. That is the thing people scan a map for.
        var icon = window.L.divIcon({
          className: '',
          html: '<div class="st-pin">' + esc(ugx(listing.nightly_ugx).replace('UGX ', 'USh ')) + '</div>',
          iconSize: [0, 0]
        });
        var marker = window.L.marker([listing.latitude, listing.longitude], { icon: icon }).addTo(state.map);
        marker.bindPopup(
          '<a class="st-pop-title" href="' + esc(listing.url) + '" data-st-link>' + esc(listing.title) + '</a>'
          + '<div>' + esc(listing.area) + '</div>'
          + '<div><b>' + esc(listing.nightly_display) + '</b> per night</div>'
        );
        state.markers.push(marker);
        bounds.push([listing.latitude, listing.longitude]);
      });
      state.map.fitBounds(bounds, { padding: [34, 34], maxZoom: 14 });
      setTimeout(function () { state.map.invalidateSize(); }, 60);
    });
  }

  // ---------------------------------------------------------------- shared blocks

  function disclaimerBlock() {
    return ''
      + '<section class="st-disclaimer" id="st-disclaimer">'
      + '<h2><i class="fas fa-triangle-exclamation"></i> Read this before you contact anyone</h2>'
      + '<ul>'
      + '<li><b>makaug does not take bookings and does not handle money.</b> Every short stay here is arranged directly between you and the host. We are not an agent, a broker or a party to your stay.</li>'
      + '<li><b>Never send a deposit to someone you have not verified.</b> If a host asks for money before you have seen the place or confirmed who they are, stop. That is the single most common way people get cheated.</li>'
      + '<li><b>Hosts write their own listings.</b> makaug does not inspect every property, does not check every photo and cannot guarantee that a place is as described, is legally let, or is available.</li>'
      + '<li><b>Prices shown are the host’s.</b> Any total you see on this site is worked out from the host’s published rate and the dates you typed. It is an estimate, not a quote and not a contract.</li>'
      + '<li><b>Agree the terms in writing.</b> Check-in, check-out, what is included, the deposit and the refund rules should all be written down before you pay anything.</li>'
      + '<li><b>Report anything that looks wrong.</b> Use the report link on any listing. We take listings down.</li>'
      + '</ul>'
      + '</section>';
  }

  function guestInfoBlock() {
    return ''
      + '<section style="margin:26px 0">'
      + '<h2 style="font-size:1.15rem;font-weight:900;margin:0 0 12px">Coming to Uganda? Worth knowing.</h2>'
      + '<div class="st-info-grid">'
      + '<div class="st-info-card"><h3><i class="fas fa-passport"></i> Visas and entry</h3>'
      + '<p>Most visitors need a visa, and Uganda issues them online before travel. Check the current rules and apply on the official government portal.</p>'
      + '<a href="https://visas.immigration.go.ug" target="_blank" rel="noopener noreferrer">Uganda immigration e-visa portal <i class="fas fa-arrow-up-right-from-square"></i></a></div>'

      + '<div class="st-info-card"><h3><i class="fas fa-umbrella-beach"></i> Uganda Tourism Board</h3>'
      + '<p>The official source for what to see and do across the country.</p>'
      + '<a href="https://utb.go.ug" target="_blank" rel="noopener noreferrer">Visit utb.go.ug <i class="fas fa-arrow-up-right-from-square"></i></a></div>'

      + '<div class="st-info-card"><h3><i class="fas fa-money-bill-wave"></i> Paying for things</h3>'
      + '<p>The shilling (UGX) is cash and mobile money country. MTN Mobile Money and Airtel Money are accepted almost everywhere. Cards work in larger hotels and malls, less so elsewhere.</p></div>'

      + '<div class="st-info-card"><h3><i class="fas fa-car"></i> Getting around</h3>'
      + '<p>Kampala traffic is heavy. Ride-hailing apps and boda bodas are the quickest way across town. For Entebbe airport runs, agree the fare or book the car before you travel.</p></div>'

      + '<div class="st-info-card"><h3><i class="fas fa-plug"></i> Power and water</h3>'
      + '<p>Cuts happen. This is why the filters here include backup power, a water tank and a borehole. If you need to work while you are here, look for those and for Wi-Fi.</p></div>'

      + '<div class="st-info-card"><h3><i class="fas fa-receipt"></i> Local hotel tax</h3>'
      + '<p>Short stay accommodation in Uganda can attract a local hotel tax per room per night, collected by the local authority. Ask your host whether their rate includes it.</p></div>'
      + '</div></section>';
  }

  // ---------------------------------------------------------------- search view

  function searchViewHtml() {
    var q = qs();
    return ''
      + '<section class="st-hero">'
      + '<div class="st-wrap">'
      + '<div class="st-countdown" id="st-countdown">'
      + '<span class="st-countdown-label" id="st-countdown-label">AFCON 2027</span>'
      + '<div class="st-countdown-units" id="st-countdown-units"></div>'
      + '<span style="font-size:.84rem;opacity:.9">Rooms in Kampala, Entebbe and Jinja go early. List now or book early.</span>'
      + '</div>'
      + '<h1>Short stays across Uganda, by the night</h1>'
      + '<p class="st-hero-sub">Apartments, cottages and guest houses from hosts in Kampala, Entebbe, Jinja and beyond. Every listing carries the host’s own phone number, so you deal with them directly.</p>'
      + '<form class="st-search" id="st-search-form">'
      + '<div class="st-field"><label for="st-q">Where</label><input class="st-input" id="st-q" name="q" placeholder="Kampala, Entebbe, Jinja..." value="' + esc(q.q || '') + '"></div>'
      + '<div class="st-field"><label for="st-in">Check in</label><input class="st-input" id="st-in" name="check_in" type="date" value="' + esc(q.check_in || '') + '"></div>'
      + '<div class="st-field"><label for="st-out">Check out</label><input class="st-input" id="st-out" name="check_out" type="date" value="' + esc(q.check_out || '') + '"></div>'
      + '<div class="st-field"><label for="st-guests">Guests</label><input class="st-input" id="st-guests" name="guests" type="number" min="1" max="30" value="' + esc(q.guests || '') + '" placeholder="2"></div>'
      + '<div class="st-field"><label for="st-max">Max per night</label><input class="st-input" id="st-max" name="max_price" type="number" min="0" step="10000" value="' + esc(q.max_price || '') + '" placeholder="UGX"></div>'
      + '<button class="st-search-go" type="submit"><i class="fas fa-search"></i> Search</button>'
      + '</form>'
      + '</div></section>'

      + '<div class="st-wrap">'
      + '<div class="st-toolbar">'
      + '<div class="st-count" id="st-count">Loading short stays…<small>Short stays are counted in the makaug property total.</small></div>'
      + '<div class="st-toolbar-actions">'
      + '<select class="st-btn" id="st-sort" aria-label="Sort results">'
      + '<option value="">Newest first</option>'
      + '<option value="price_asc">Price: low to high</option>'
      + '<option value="price_desc">Price: high to low</option>'
      + '<option value="rating">Best reviewed</option>'
      + '</select>'
      + '<button class="st-btn" id="st-map-toggle" type="button"><i class="fas fa-map-location-dot"></i> Show map</button>'
      + '<a class="st-btn st-btn-primary" href="/short-term/list-your-place" data-st-link><i class="fas fa-plus"></i> List your place</a>'
      + '</div></div>'

      + '<div class="st-split" id="st-split">'
      + '<div id="st-results"><div class="st-grid">'
      + '<div class="st-skeleton"></div><div class="st-skeleton"></div><div class="st-skeleton"></div><div class="st-skeleton"></div>'
      + '</div></div>'
      + '<div class="st-map-shell" id="st-map-shell" hidden><div id="st-map"></div></div>'
      + '</div>'

      + disclaimerBlock()
      + guestInfoBlock()
      + '</div>';
  }

  function cardHtml(listing) {
    var score = listing.review_count > 0 && listing.review_average != null
      ? '<p class="st-card-score"><i class="fas fa-star"></i> ' + listing.review_average.toFixed(1)
        + ' <span>(' + listing.review_count + ')</span></p>'
      : '<p class="st-card-score">New listing</p>';

    return ''
      + '<article class="st-card">'
      + '<a class="st-card-media" href="' + esc(listing.url) + '" data-st-link>'
      + (listing.primary_image
        ? '<img src="' + esc(listing.primary_image) + '" alt="' + esc(listing.title) + '" loading="lazy">'
        : '<div class="st-noimg"><i class="fas fa-house"></i></div>')
      + (listing.is_private_listing ? '<span class="st-badge">Private host</span>' : '<span class="st-badge">Partner</span>')
      + '</a>'
      + '<div class="st-card-body">'
      + '<h3 class="st-card-title"><a href="' + esc(listing.url) + '" data-st-link>' + esc(listing.title) + '</a></h3>'
      + '<p class="st-card-where">' + esc(listing.area) + ', ' + esc(listing.district) + '</p>'
      + '<p class="st-card-spec">' + esc(listing.place_type_label) + ' &middot; ' + listing.bedrooms + ' bed'
      + (listing.bedrooms === 1 ? '' : 's') + ' &middot; sleeps ' + listing.max_guests + '</p>'
      + '<p class="st-card-price"><b>' + esc(listing.nightly_display) + '</b> <span>per night</span></p>'
      + score
      + '</div></article>';
  }

  function runSearch() {
    var form = document.getElementById('st-search-form');
    var params = new URLSearchParams();
    if (form) {
      ['q', 'check_in', 'check_out', 'guests', 'max_price'].forEach(function (name) {
        var el = form.querySelector('[name="' + name + '"]');
        if (el && String(el.value).trim()) params.set(name, String(el.value).trim());
      });
    }
    var sort = document.getElementById('st-sort');
    if (sort && sort.value) params.set('sort', sort.value);

    var target = document.getElementById('st-results');
    if (target) {
      target.innerHTML = '<div class="st-grid"><div class="st-skeleton"></div><div class="st-skeleton"></div>'
        + '<div class="st-skeleton"></div><div class="st-skeleton"></div></div>';
    }

    var search = params.toString();
    if (window.history && window.history.replaceState) {
      window.history.replaceState({}, '', '/short-term' + (search ? '?' + search : ''));
    }

    return api('/search' + (search ? '?' + search : '')).then(function (payload) {
      state.listings = payload.listings || [];
      state.total = payload.total || 0;
      renderResults();
      if (state.mapOn) paintMap();
    }).catch(function (error) {
      if (target) {
        target.innerHTML = '<div class="st-empty"><i class="fas fa-triangle-exclamation"></i>'
          + esc(error.message || 'Short stays could not be loaded') + '</div>';
      }
    });
  }

  function renderResults() {
    var count = document.getElementById('st-count');
    if (count) {
      count.innerHTML = '<span>' + state.total + ' short stay' + (state.total === 1 ? '' : 's')
        + '</span><small>Short stays are counted in the makaug property total.</small>';
    }
    var target = document.getElementById('st-results');
    if (!target) return;
    if (!state.listings.length) {
      target.innerHTML = '<div class="st-empty"><i class="fas fa-magnifying-glass"></i>'
        + 'Nothing matches those filters yet. Try widening the dates or the area.<br><br>'
        + '<a class="st-btn st-btn-primary" href="/short-term/list-your-place" data-st-link>List your own place</a></div>';
      return;
    }
    target.innerHTML = '<div class="st-grid">' + state.listings.map(cardHtml).join('') + '</div>';
  }

  function startCountdown() {
    var config = window.__makaugShortTerm || {};
    if (!config.countdown) return;
    var shell = document.getElementById('st-countdown');
    var units = document.getElementById('st-countdown-units');
    var label = document.getElementById('st-countdown-label');
    if (!shell || !units) return;
    var target = new Date(config.countdown).getTime();
    if (!isFinite(target)) return;
    if (label && config.countdownLabel) label.textContent = config.countdownLabel;

    function tick() {
      var diff = target - Date.now();
      if (diff <= 0) { shell.classList.remove('is-live'); return; }
      var days = Math.floor(diff / 86400000);
      var hours = Math.floor((diff % 86400000) / 3600000);
      var mins = Math.floor((diff % 3600000) / 60000);
      var secs = Math.floor((diff % 60000) / 1000);
      units.innerHTML = [[days, 'days'], [hours, 'hrs'], [mins, 'min'], [secs, 'sec']].map(function (pair) {
        return '<div class="st-countdown-unit"><b>' + pair[0] + '</b><span>' + pair[1] + '</span></div>';
      }).join('');
      shell.classList.add('is-live');
    }
    tick();
    if (state.countdownTimer) clearInterval(state.countdownTimer);
    state.countdownTimer = setInterval(tick, 1000);
  }

  function mountSearch() {
    var r = root();
    if (!r) return;
    r.querySelector('.st-view-search').innerHTML = searchViewHtml();
    startCountdown();

    var form = document.getElementById('st-search-form');
    if (form) form.addEventListener('submit', function (e) { e.preventDefault(); runSearch(); });
    var sort = document.getElementById('st-sort');
    if (sort) sort.addEventListener('change', runSearch);

    var toggle = document.getElementById('st-map-toggle');
    if (toggle) {
      toggle.addEventListener('click', function () {
        state.mapOn = !state.mapOn;
        var shell = document.getElementById('st-map-shell');
        var split = document.getElementById('st-split');
        if (shell) shell.hidden = !state.mapOn;
        if (split) split.classList.toggle('is-map', state.mapOn);
        toggle.classList.toggle('is-on', state.mapOn);
        toggle.innerHTML = state.mapOn
          ? '<i class="fas fa-list"></i> Hide map'
          : '<i class="fas fa-map-location-dot"></i> Show map';
        if (state.mapOn) paintMap();
      });
    }

    runSearch();
  }

  // ---------------------------------------------------------------- detail view

  function quoteHtml(quote) {
    if (!quote) {
      return '<p class="st-help">Add your dates above to see what the host’s rate works out at.</p>';
    }
    var rows = ''
      + '<div class="st-quote-row"><span>' + quote.nights + ' night' + (quote.nights === 1 ? '' : 's')
      + ' at ' + esc(quote.per_night_display) + '</span><span>' + esc(ugx(quote.nights_subtotal_ugx)) + '</span></div>';
    if (quote.discount_ugx > 0) {
      rows += '<div class="st-quote-row"><span>' + esc(quote.discount_label) + ' (' + quote.discount_pct + '%)</span><span>-'
        + esc(ugx(quote.discount_ugx)) + '</span></div>';
    }
    if (quote.cleaning_fee_ugx > 0) {
      rows += '<div class="st-quote-row"><span>Cleaning fee</span><span>' + esc(ugx(quote.cleaning_fee_ugx)) + '</span></div>';
    }
    rows += '<div class="st-quote-row is-total"><span>Estimated total</span><span>' + esc(quote.total_display) + '</span></div>';

    var warn = '';
    if (!quote.meets_min_nights) {
      warn += '<p class="st-help" style="color:#b45309"><i class="fas fa-circle-info"></i> This host asks for at least '
        + quote.min_nights + ' nights.</p>';
    }
    if (quote.over_capacity) {
      warn += '<p class="st-help" style="color:#b45309"><i class="fas fa-circle-info"></i> That is more guests than this place sleeps.</p>';
    }
    return '<div class="st-quote">' + rows + '</div>' + warn
      + '<p class="st-help">' + esc(quote.disclaimer) + '</p>';
  }

  function availabilityHtml(availability) {
    if (!availability) return '';
    if (availability.available === true) {
      return '<p class="st-help" style="color:#15803d"><i class="fas fa-circle-check"></i> The host has these dates open on their calendar.</p>';
    }
    if (availability.available === false) {
      return '<p class="st-help" style="color:#b91c1c"><i class="fas fa-circle-xmark"></i> Those dates are not open on the host’s calendar. Ask them anyway if you are flexible.</p>';
    }
    return '<p class="st-help"><i class="fas fa-circle-info"></i> This host has not published a calendar. Ask them what is free.</p>';
  }

  function reviewsHtml(reviews, listing, open) {
    if (!listing.is_private_listing) return '';
    var body = reviews.length
      ? reviews.map(function (review) {
        return '<div class="st-review"><div class="st-review-head">'
          + '<span class="st-review-name">' + esc(review.reviewer_name) + '</span>'
          + '<span class="st-review-stars">' + stars(review.rating) + '</span></div>'
          + (review.stayed_on ? '<span class="st-review-date">Stayed ' + esc(review.stayed_on) + '</span>' : '')
          + '<p>' + esc(review.comment) + '</p></div>';
      }).join('')
      : '<p class="st-help">No reviews yet. If you have stayed here, you can be the first.</p>';

    var form = open ? ''
      + '<h3>Been here? Score it.</h3>'
      + '<form id="st-review-form">'
      + '<div class="st-stars-input" id="st-stars">'
      + [1, 2, 3, 4, 5].map(function (n) {
        return '<button type="button" data-star="' + n + '" aria-label="' + n + ' out of 5">★</button>';
      }).join('')
      + '</div>'
      + '<div class="st-form-grid" style="margin-top:10px">'
      + '<div><label class="st-label" for="st-rev-name">Your name</label><input class="st-input" id="st-rev-name" required></div>'
      + '<div><label class="st-label" for="st-rev-contact">Phone or email</label><input class="st-input" id="st-rev-contact" placeholder="Not shown publicly"></div>'
      + '<div><label class="st-label" for="st-rev-stayed">When you stayed</label><input class="st-input" id="st-rev-stayed" type="date"></div>'
      + '</div>'
      + '<div style="margin-top:10px"><label class="st-label" for="st-rev-comment">Your review</label>'
      + '<textarea class="st-input" id="st-rev-comment" required placeholder="What was it actually like?"></textarea></div>'
      + '<div id="st-review-feedback"></div>'
      + '<button class="st-btn st-btn-primary" type="submit" style="margin-top:10px">Post review</button>'
      + '<p class="st-help">Reviews go to a moderator before they appear. We ask for a contact so we can tell a real stay from a rival.</p>'
      + '</form>'
      : '';

    return '<div class="st-panel"><h2>Reviews and scores</h2>' + body + form + '</div>';
  }

  function detailViewHtml(payload) {
    var listing = payload.listing;
    var contact = listing.contact || {};
    var q = qs();

    var gallery = listing.images && listing.images.length
      ? '<div class="st-gallery">' + listing.images.slice(0, 6).map(function (img) {
        return '<img src="' + esc(img.url) + '" alt="' + esc(img.caption || listing.title) + '" loading="lazy">';
      }).join('') + '</div>'
      : '<div class="st-empty"><i class="fas fa-image"></i>This host has not added photos yet.</div>';

    var amenities = (listing.amenities || []).length && state.meta
      ? '<div class="st-panel"><h2>What this place has</h2><ul class="st-amenities">'
        + listing.amenities.map(function (slug) {
          var found = (state.meta.amenities || []).find(function (a) { return a.slug === slug; });
          return '<li><i class="fas fa-check"></i>' + esc(found ? found.label : slug.replace(/_/g, ' ')) + '</li>';
        }).join('') + '</ul></div>'
      : '';

    return ''
      + '<div class="st-wrap">'
      + '<p class="st-crumb"><a href="/short-term" data-st-link><i class="fas fa-arrow-left"></i> All short stays</a></p>'
      + '<h1 style="font-size:clamp(1.4rem,3.4vw,2rem);font-weight:900;margin:10px 0 4px">' + esc(listing.title) + '</h1>'
      + '<p style="color:#5b6b63;margin:0 0 14px">' + esc(listing.area) + ', ' + esc(listing.district)
      + (listing.review_count > 0 ? ' &nbsp;&middot;&nbsp; <span style="color:#f59e0b">' + stars(listing.review_average)
        + '</span> ' + listing.review_average.toFixed(1) + ' (' + listing.review_count + ')' : '')
      + '</p>'
      + gallery
      + '<div class="st-detail-grid" style="margin-top:20px">'
      + '<div>'
      + '<div class="st-facts">'
      + '<div class="st-fact"><b>' + listing.max_guests + '</b><span>Guests</span></div>'
      + '<div class="st-fact"><b>' + listing.bedrooms + '</b><span>Bedrooms</span></div>'
      + '<div class="st-fact"><b>' + listing.beds + '</b><span>Beds</span></div>'
      + '<div class="st-fact"><b>' + listing.bathrooms + '</b><span>Bathrooms</span></div>'
      + '</div>'
      + '<div class="st-panel"><h2>' + esc(listing.place_type_label) + '</h2>'
      + '<p class="st-prose">' + esc(listing.description) + '</p></div>'
      + amenities
      + '<div class="st-panel"><h2>Arriving and leaving</h2>'
      + '<p><b>Check in from</b> ' + esc(listing.check_in_from || '—')
      + ' &nbsp;&middot;&nbsp; <b>Check out by</b> ' + esc(listing.check_out_by || '—') + '</p>'
      + '<p><b>Minimum stay</b> ' + listing.min_nights + ' night' + (listing.min_nights === 1 ? '' : 's') + '</p>'
      + '<p><b>Cancellation</b> ' + esc(listing.cancellation_policy_label) + '</p>'
      + (listing.house_rules ? '<h3>House rules</h3><p class="st-prose">' + esc(listing.house_rules) + '</p>' : '')
      + (listing.terms_text ? '<h3>The host’s terms</h3><p class="st-prose">' + esc(listing.terms_text) + '</p>'
        + '<p class="st-help">These terms are written by the host, not by makaug. Read them before you agree anything.</p>' : '')
      + '</div>'
      + reviewsHtml(payload.reviews || [], listing, payload.reviews_open)
      + '<div class="st-panel"><h2>Something wrong with this listing?</h2>'
      + '<form id="st-report-form" class="st-form-grid">'
      + '<div><label class="st-label" for="st-report-reason">What is wrong</label>'
      + '<select class="st-input" id="st-report-reason">'
      + '<option>It is not available / does not exist</option>'
      + '<option>The price is wrong</option>'
      + '<option>The photos are not of this place</option>'
      + '<option>I think this is a scam</option>'
      + '<option>The host does not have the right to let it</option>'
      + '<option>Something else</option></select></div>'
      + '<div><label class="st-label" for="st-report-contact">Your contact (optional)</label>'
      + '<input class="st-input" id="st-report-contact"></div>'
      + '<div style="grid-column:1/-1"><label class="st-label" for="st-report-details">Details</label>'
      + '<textarea class="st-input" id="st-report-details" style="min-height:70px"></textarea></div>'
      + '<div style="grid-column:1/-1"><button class="st-btn" type="submit">Report this listing</button>'
      + '<span id="st-report-feedback"></span></div>'
      + '</form></div>'
      + '</div>'

      // ---- contact rail ----
      + '<aside>'
      + '<div class="st-book">'
      + '<div class="st-book-price">' + esc(listing.nightly_display) + ' <span>per night</span></div>'
      + '<div class="st-form-grid" style="margin-top:12px">'
      + '<div><label class="st-label" for="st-d-in">Check in</label><input class="st-input" id="st-d-in" type="date" value="' + esc(q.check_in || '') + '"></div>'
      + '<div><label class="st-label" for="st-d-out">Check out</label><input class="st-input" id="st-d-out" type="date" value="' + esc(q.check_out || '') + '"></div>'
      + '</div>'
      + '<div id="st-quote">' + quoteHtml(payload.quote) + '</div>'
      + '<div id="st-availability">' + availabilityHtml(payload.availability) + '</div>'

      + '<hr style="border:0;border-top:1px solid #dfe8e3;margin:14px 0">'
      + '<p style="font-weight:800;margin:0 0 2px">' + esc(listing.host_name || 'The host') + '</p>'
      + '<p class="st-help" style="margin:0 0 10px">You arrange this stay directly with them. makaug is not involved in the booking or the payment.</p>'
      + (contact.whatsapp_href
        ? '<a class="st-contact-btn st-contact-wa" href="' + esc(contact.whatsapp_href) + '" target="_blank" rel="noopener noreferrer" data-st-contact="whatsapp"><i class="fab fa-whatsapp"></i> WhatsApp the host</a>'
        : '')
      + (contact.tel_href
        ? '<a class="st-contact-btn st-contact-tel" href="' + esc(contact.tel_href) + '" data-st-contact="phone"><i class="fas fa-phone"></i> Call ' + esc(contact.phone_display || '') + '</a>'
        : '')
      + (listing.external_booking_url
        ? '<a class="st-contact-btn st-contact-form" href="' + esc(listing.external_booking_url) + '" target="_blank" rel="noopener noreferrer nofollow sponsored"><i class="fas fa-arrow-up-right-from-square"></i> See it on ' + esc(listing.partner_name || 'the partner site') + '</a>'
        : '')
      + '<button class="st-contact-btn st-contact-form" type="button" id="st-enquire-open"><i class="fas fa-envelope"></i> Send your dates instead</button>'
      + '<div id="st-enquire-shell"></div>'
      + '</div>'
      + '</aside>'
      + '</div>'
      + disclaimerBlock()
      + '</div>';
  }

  function enquiryFormHtml() {
    return '<form id="st-enquire-form" style="margin-top:12px;border-top:1px solid #dfe8e3;padding-top:12px">'
      + '<div><label class="st-label" for="st-e-name">Your name</label><input class="st-input" id="st-e-name" required></div>'
      + '<div style="margin-top:8px"><label class="st-label" for="st-e-phone">Phone</label><input class="st-input" id="st-e-phone" placeholder="0780 000 000"></div>'
      + '<div style="margin-top:8px"><label class="st-label" for="st-e-email">Email</label><input class="st-input" id="st-e-email" type="email"></div>'
      + '<div style="margin-top:8px"><label class="st-label" for="st-e-guests">Guests</label><input class="st-input" id="st-e-guests" type="number" min="1" max="30"></div>'
      + '<div style="margin-top:8px"><label class="st-label" for="st-e-msg">Message</label><textarea class="st-input" id="st-e-msg" style="min-height:70px" placeholder="What you need to know"></textarea></div>'
      + '<div id="st-enquire-feedback"></div>'
      + '<button class="st-btn st-btn-primary" type="submit" style="width:100%;margin-top:10px">Send to the host</button>'
      + '<p class="st-help">This saves your details against the listing and shows you the host’s number. makaug does not pass the message on for you and does not chase a reply.</p>'
      + '</form>';
  }

  function bindDetail(payload) {
    var listing = payload.listing;

    function refreshQuote() {
      var from = document.getElementById('st-d-in');
      var to = document.getElementById('st-d-out');
      if (!from || !to || !from.value || !to.value) return;
      api('/listings/' + encodeURIComponent(listing.slug)
        + '?check_in=' + encodeURIComponent(from.value)
        + '&check_out=' + encodeURIComponent(to.value)).then(function (next) {
        var quoteEl = document.getElementById('st-quote');
        var availEl = document.getElementById('st-availability');
        if (quoteEl) quoteEl.innerHTML = quoteHtml(next.quote);
        if (availEl) availEl.innerHTML = availabilityHtml(next.availability);
      }).catch(function () {});
    }

    ['st-d-in', 'st-d-out'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('change', refreshQuote);
    });

    var open = document.getElementById('st-enquire-open');
    if (open) {
      open.addEventListener('click', function () {
        var shell = document.getElementById('st-enquire-shell');
        if (!shell || shell.innerHTML) return;
        shell.innerHTML = enquiryFormHtml();
        var form = document.getElementById('st-enquire-form');
        if (!form) return;
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          var feedback = document.getElementById('st-enquire-feedback');
          var from = document.getElementById('st-d-in');
          var to = document.getElementById('st-d-out');
          api('/listings/' + encodeURIComponent(listing.id) + '/enquiries', {
            method: 'POST',
            body: {
              guest_name: (document.getElementById('st-e-name') || {}).value,
              guest_phone: (document.getElementById('st-e-phone') || {}).value,
              guest_email: (document.getElementById('st-e-email') || {}).value,
              party_size: (document.getElementById('st-e-guests') || {}).value,
              message: (document.getElementById('st-e-msg') || {}).value,
              check_in: from ? from.value : null,
              check_out: to ? to.value : null
            }
          }).then(function (payloadOut) {
            var c = payloadOut.contact || {};
            form.innerHTML = '<div class="st-ok"><b>Saved.</b> Now contact '
              + esc(payloadOut.host_name || 'the host') + ' directly:<br><br>'
              + (c.whatsapp_href ? '<a class="st-contact-btn st-contact-wa" href="' + esc(c.whatsapp_href)
                + '" target="_blank" rel="noopener noreferrer"><i class="fab fa-whatsapp"></i> WhatsApp</a>' : '')
              + (c.tel_href ? '<a class="st-contact-btn st-contact-tel" href="' + esc(c.tel_href)
                + '"><i class="fas fa-phone"></i> Call ' + esc(c.phone_display || '') + '</a>' : '')
              + '<p class="st-help" style="margin-top:8px">' + esc(payloadOut.next_step || '') + '</p></div>';
          }).catch(function (error) {
            if (feedback) {
              feedback.innerHTML = '<ul class="st-errors">'
                + ((error.details && error.details.length ? error.details : [error.message])
                  .map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('')) + '</ul>';
            }
          });
        });
      });
    }

    var starsEl = document.getElementById('st-stars');
    if (starsEl) {
      starsEl.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-star]');
        if (!btn) return;
        state.rating = Number(btn.getAttribute('data-star'));
        Array.prototype.forEach.call(starsEl.querySelectorAll('button'), function (b) {
          b.classList.toggle('is-on', Number(b.getAttribute('data-star')) <= state.rating);
        });
      });
    }

    var reviewForm = document.getElementById('st-review-form');
    if (reviewForm) {
      reviewForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var feedback = document.getElementById('st-review-feedback');
        api('/listings/' + encodeURIComponent(listing.id) + '/reviews', {
          method: 'POST',
          body: {
            reviewer_name: (document.getElementById('st-rev-name') || {}).value,
            reviewer_contact: (document.getElementById('st-rev-contact') || {}).value,
            stayed_on: (document.getElementById('st-rev-stayed') || {}).value,
            comment: (document.getElementById('st-rev-comment') || {}).value,
            rating: state.rating
          }
        }).then(function (out) {
          reviewForm.innerHTML = '<div class="st-ok">' + esc(out.message || 'Thanks.') + '</div>';
        }).catch(function (error) {
          if (feedback) {
            feedback.innerHTML = '<ul class="st-errors">'
              + ((error.details && error.details.length ? error.details : [error.message])
                .map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('')) + '</ul>';
          }
        });
      });
    }

    var reportForm = document.getElementById('st-report-form');
    if (reportForm) {
      reportForm.addEventListener('submit', function (e) {
        e.preventDefault();
        api('/listings/' + encodeURIComponent(listing.id) + '/reports', {
          method: 'POST',
          body: {
            reason: (document.getElementById('st-report-reason') || {}).value,
            details: (document.getElementById('st-report-details') || {}).value,
            reporter_contact: (document.getElementById('st-report-contact') || {}).value
          }
        }).then(function () {
          reportForm.innerHTML = '<div class="st-ok">Thanks. Our team will look at this listing.</div>';
        }).catch(function (error) {
          var feedback = document.getElementById('st-report-feedback');
          if (feedback) feedback.innerHTML = ' <span style="color:#b91c1c;font-size:.82rem">' + esc(error.message) + '</span>';
        });
      });
    }
  }

  function mountDetail(slug) {
    var view = $('.st-view-detail');
    if (!view) return;
    view.innerHTML = '<div class="st-wrap"><div class="st-skeleton" style="height:340px;margin-top:20px"></div></div>';
    api('/listings/' + encodeURIComponent(slug)).then(function (payload) {
      view.innerHTML = detailViewHtml(payload);
      bindDetail(payload);
      document.title = payload.listing.title + ' | Short stay on makaug.com';
    }).catch(function (error) {
      view.innerHTML = '<div class="st-wrap"><div class="st-empty"><i class="fas fa-house-circle-xmark"></i>'
        + esc(error.status === 404 ? 'This short stay is no longer listed.' : error.message)
        + '<br><br><a class="st-btn st-btn-primary" href="/short-term" data-st-link>See what is available</a></div></div>';
    });
  }

  // ---------------------------------------------------------------- list your place

  function listViewHtml() {
    var meta = state.meta || {};
    var amenities = meta.amenities || [];
    var fee = meta.fee || { display: 'UGX 50,000', term_months: 3 };

    return ''
      + '<section class="st-hero"><div class="st-wrap">'
      + '<h1>List your short stay on makaug</h1>'
      + '<p class="st-hero-sub">Flat fee of <b>' + esc(fee.display) + ' for ' + esc(fee.term_months)
      + ' months</b>. No commission on any stay, ever. Guests contact you directly on your own number — we never sit in the middle.</p>'
      + '</div></section>'

      + '<div class="st-wrap" style="padding-top:22px;padding-bottom:40px">'
      + '<div class="st-steps">'
      + '<span class="st-step is-on" data-step="1">1. The place</span>'
      + '<span class="st-step" data-step="2">2. Price and dates</span>'
      + '<span class="st-step" data-step="3">3. Rules and terms</span>'
      + '<span class="st-step" data-step="4">4. You and payment</span>'
      + '</div>'

      + '<form id="st-list-form">'

      // step 1
      + '<div class="st-panel" data-panel="1">'
      + '<h2>What are you listing?</h2>'
      + '<div class="st-form-grid">'
      + '<div style="grid-column:1/-1"><label class="st-label" for="f-title">Title</label>'
      + '<input class="st-input" id="f-title" required placeholder="Quiet 2-bed apartment in Naguru"></div>'
      + '<div><label class="st-label" for="f-place">Type of place</label><select class="st-input" id="f-place">'
      + '<option value="entire_place">Entire place</option><option value="private_room">Private room</option>'
      + '<option value="shared_room">Shared room</option></select></div>'
      + '<div><label class="st-label" for="f-ptype">Property type</label>'
      + '<input class="st-input" id="f-ptype" placeholder="Apartment, cottage, guest house"></div>'
      + '<div><label class="st-label" for="f-district">District</label><input class="st-input" id="f-district" required placeholder="Kampala"></div>'
      + '<div><label class="st-label" for="f-area">Area / neighbourhood</label><input class="st-input" id="f-area" required placeholder="Naguru"></div>'
      + '<div><label class="st-label" for="f-guests">Sleeps</label><input class="st-input" id="f-guests" type="number" min="1" value="2"></div>'
      + '<div><label class="st-label" for="f-beds">Bedrooms</label><input class="st-input" id="f-bedrooms" type="number" min="0" value="1"></div>'
      + '<div><label class="st-label" for="f-bedcount">Beds</label><input class="st-input" id="f-beds" type="number" min="1" value="1"></div>'
      + '<div><label class="st-label" for="f-baths">Bathrooms</label><input class="st-input" id="f-bathrooms" type="number" min="0" value="1"></div>'
      + '<div style="grid-column:1/-1"><label class="st-label" for="f-desc">Describe it</label>'
      + '<textarea class="st-input" id="f-desc" required placeholder="What is it actually like? What is nearby? What should a guest know before they arrive?"></textarea></div>'
      + '</div>'
      + '<h3>Amenities</h3>'
      + '<div class="st-amenity-pick">'
      + amenities.map(function (a) {
        return '<label><input type="checkbox" value="' + esc(a.slug) + '" data-amenity> ' + esc(a.label) + '</label>';
      }).join('')
      + '</div>'
      + '<button class="st-btn st-btn-primary" type="button" data-next="2" style="margin-top:14px">Next</button>'
      + '</div>'

      // step 2
      + '<div class="st-panel" data-panel="2" hidden>'
      + '<h2>Your price and your dates</h2>'
      + '<div class="st-form-grid">'
      + '<div><label class="st-label" for="f-nightly">Price per night (UGX)</label>'
      + '<input class="st-input" id="f-nightly" type="number" min="1000" step="1000" required placeholder="200000"></div>'
      + '<div><label class="st-label" for="f-clean">Cleaning fee (UGX)</label><input class="st-input" id="f-clean" type="number" min="0" step="1000" value="0"></div>'
      + '<div><label class="st-label" for="f-deposit">Refundable deposit (UGX)</label><input class="st-input" id="f-deposit" type="number" min="0" step="1000" value="0"></div>'
      + '<div><label class="st-label" for="f-min">Minimum nights</label><input class="st-input" id="f-min" type="number" min="1" value="1"></div>'
      + '<div><label class="st-label" for="f-week">Weekly discount %</label><input class="st-input" id="f-week" type="number" min="0" max="90" value="0"></div>'
      + '<div><label class="st-label" for="f-month">Monthly discount %</label><input class="st-input" id="f-month" type="number" min="0" max="90" value="0"></div>'
      + '<div><label class="st-label" for="f-cin">Check in from</label><input class="st-input" id="f-cin" type="time" value="14:00"></div>'
      + '<div><label class="st-label" for="f-cout">Check out by</label><input class="st-input" id="f-cout" type="time" value="10:00"></div>'
      + '</div>'
      + '<h3>When is it free?</h3>'
      + '<p class="st-help">Add the date ranges you can take guests. Leave it blank if you would rather people just ask — we will say so on your listing.</p>'
      + '<div id="st-windows" style="margin-top:10px"></div>'
      + '<button class="st-btn" type="button" id="st-add-window"><i class="fas fa-plus"></i> Add another range</button>'
      + '<div style="margin-top:14px"><button class="st-btn" type="button" data-next="1">Back</button> '
      + '<button class="st-btn st-btn-primary" type="button" data-next="3">Next</button></div>'
      + '</div>'

      // step 3
      + '<div class="st-panel" data-panel="3" hidden>'
      + '<h2>House rules and your terms</h2>'
      + '<div><label class="st-label" for="f-rules">House rules</label>'
      + '<textarea class="st-input" id="f-rules" placeholder="No parties. No smoking indoors. Quiet after 10pm. Gate is locked at midnight."></textarea></div>'
      + '<div style="margin-top:12px"><label class="st-label" for="f-terms">Your terms and conditions</label>'
      + '<textarea class="st-input" id="f-terms" style="min-height:130px" placeholder="What the deposit covers and when you return it. What happens if a guest cancels. What is included in the price: water, power, Wi-Fi, cleaning. Anything a guest must agree before they arrive."></textarea>'
      + '<p class="st-help">These are your terms, shown on your listing as yours. makaug does not write them and is not a party to them.</p></div>'
      + '<div style="margin-top:12px"><label class="st-label" for="f-cancel">Cancellation policy</label>'
      + '<select class="st-input" id="f-cancel">'
      + Object.keys(meta.cancellation_policies || { moderate: 'Moderate' }).map(function (key) {
        return '<option value="' + esc(key) + '"' + (key === 'moderate' ? ' selected' : '') + '>'
          + esc((meta.cancellation_policies || {})[key] || key) + '</option>';
      }).join('')
      + '</select></div>'
      + '<div style="margin-top:14px"><button class="st-btn" type="button" data-next="2">Back</button> '
      + '<button class="st-btn st-btn-primary" type="button" data-next="4">Next</button></div>'
      + '</div>'

      // step 4
      + '<div class="st-panel" data-panel="4" hidden>'
      + '<h2>You, and how you want to be paid</h2>'
      + '<div class="st-form-grid">'
      + '<div><label class="st-label" for="f-hname">Name guests should ask for</label><input class="st-input" id="f-hname" required></div>'
      + '<div><label class="st-label" for="f-hphone">Phone</label><input class="st-input" id="f-hphone" required placeholder="0780 863 394"></div>'
      + '<div><label class="st-label" for="f-hwa">WhatsApp (if different)</label><input class="st-input" id="f-hwa"></div>'
      + '<div><label class="st-label" for="f-hemail">Email</label><input class="st-input" id="f-hemail" type="email"></div>'
      + '<div><label class="st-label" for="f-htype">You are the</label><select class="st-input" id="f-htype">'
      + '<option value="owner">Owner</option><option value="manager">Manager</option><option value="agent">Agent</option></select></div>'
      + '<div><label class="st-label" for="f-pay">How you prefer to be paid</label><select class="st-input" id="f-pay">'
      + '<option value="">Choose one</option>'
      + Object.keys(meta.payment_methods || {}).map(function (key) {
        return '<option value="' + esc(key) + '">' + esc((meta.payment_methods || {})[key]) + '</option>';
      }).join('')
      + '</select><p class="st-help">This is how guests pay <b>you</b>. makaug never receives or holds guest money.</p></div>'
      + '<div style="grid-column:1/-1"><label class="st-label" for="f-titleref">Title or tenancy reference (optional)</label>'
      + '<input class="st-input" id="f-titleref" placeholder="Helps us verify you faster">'
      + '<p class="st-help">If you have a land title reference or a tenancy agreement number, adding it gets your listing through review quicker.</p></div>'
      + '</div>'

      + '<div class="st-disclaimer" style="margin:18px 0">'
      + '<h2><i class="fas fa-file-signature"></i> What you are agreeing to</h2>'
      + '<ul>'
      + '<li>You have the legal right to let this property out for short stays, and letting it does not breach a lease, mortgage or landlord’s condition.</li>'
      + '<li>The listing is accurate. The photos are of this property. The price is real.</li>'
      + '<li>You deal with guests directly. makaug is a place to be found, not your agent. We do not take bookings, hold deposits or guarantee guests.</li>'
      + '<li>You are responsible for your own tax and licences, including any local hotel tax on short stay accommodation and any income tax due.</li>'
      + '<li>The fee is <b>' + esc(fee.display) + ' for ' + esc(fee.term_months) + ' months</b>, payable once we approve the listing. We take no commission on any stay.</li>'
      + '<li>We can take a listing down if it is reported, inaccurate, or we cannot reach you.</li>'
      + '</ul></div>'

      + '<label class="st-check"><input type="checkbox" id="f-right" required> '
      + '<span>I confirm I have the right to let this property out for short stays.</span></label>'
      + '<label class="st-check"><input type="checkbox" id="f-tax"> '
      + '<span>I understand I am responsible for my own tax and any local hotel tax on short stays.</span></label>'
      + '<label class="st-check"><input type="checkbox" id="f-terms-ok" required> '
      + '<span>I accept the makaug listing terms above.</span></label>'

      + '<div id="st-list-feedback"></div>'
      + '<p class="st-help" style="margin-top:8px"><i class="fas fa-floppy-disk"></i> '
      + '<span id="st-draft-note">This form saves itself on this device as you type.</span></p>'
      + '<p class="st-help" style="margin-top:12px"><i class="fas fa-camera"></i> '
      + 'Photos come next, once the listing is saved. Have a few ready — the outside, the beds, the bathroom and the kitchen.</p>'
      + '<div style="margin-top:14px"><button class="st-btn" type="button" data-next="3">Back</button> '
      + '<button class="st-btn st-btn-primary" type="submit">Submit my place</button></div>'
      + '</div>'
      + '</form>'
      + '</div>';
  }


  // ---------------------------------------------------------------- draft rescue
  //
  // A host filling this in is on a phone, on Kampala mobile data, and the
  // connection WILL drop. Losing ten minutes of typing is how you lose a
  // listing and never get a second attempt. So the wizard writes itself to
  // localStorage as they go and offers it back when they return.
  //
  // Every access is wrapped: private mode, blocked site data and quota errors
  // all have to degrade to "no draft", never to a broken form.

  var DRAFT_KEY = 'makaug.short-term.draft.v1';
  var DRAFT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
  var draftTimer = null;

  var DRAFT_FIELDS = [
    'f-title', 'f-place', 'f-ptype', 'f-district', 'f-area', 'f-guests',
    'f-bedrooms', 'f-beds', 'f-bathrooms', 'f-desc',
    'f-nightly', 'f-clean', 'f-deposit', 'f-min', 'f-week', 'f-month', 'f-cin', 'f-cout',
    'f-rules', 'f-terms', 'f-cancel',
    'f-hname', 'f-hphone', 'f-hwa', 'f-hemail', 'f-htype', 'f-pay', 'f-titleref'
  ];

  function readDraft() {
    try {
      var raw = window.localStorage.getItem(DRAFT_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || !parsed.savedAt) return null;
      if (Date.now() - parsed.savedAt > DRAFT_MAX_AGE_MS) {
        clearDraft();
        return null;
      }
      return parsed;
    } catch (_error) {
      return null;
    }
  }

  function writeDraft() {
    try {
      var fields = {};
      DRAFT_FIELDS.forEach(function (id) {
        var el = document.getElementById(id);
        if (el && String(el.value || '').trim()) fields[id] = el.value;
      });
      var amenities = $$('[data-amenity]:checked').map(function (el) { return el.value; });
      var hasSomething = Object.keys(fields).length || amenities.length
        || state.windows.some(function (w) { return w.starts_on || w.ends_on; });
      if (!hasSomething) return;

      window.localStorage.setItem(DRAFT_KEY, JSON.stringify({
        savedAt: Date.now(),
        step: state.wizardStep,
        fields: fields,
        amenities: amenities,
        windows: state.windows
      }));
      var note = document.getElementById('st-draft-note');
      if (note) note.textContent = 'Saved on this device';
    } catch (_error) {
      // Storage unavailable. The form still works; there is just no rescue.
    }
  }

  function queueDraftSave() {
    if (draftTimer) clearTimeout(draftTimer);
    draftTimer = setTimeout(writeDraft, 600);
  }

  function clearDraft() {
    try { window.localStorage.removeItem(DRAFT_KEY); } catch (_error) {}
  }

  function applyDraft(draft) {
    if (!draft) return;
    Object.keys(draft.fields || {}).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.value = draft.fields[id];
    });
    (draft.amenities || []).forEach(function (slug) {
      var box = document.querySelector('[data-amenity][value="' + slug + '"]');
      if (box) box.checked = true;
    });
    if (Array.isArray(draft.windows) && draft.windows.length) {
      state.windows = draft.windows;
      renderWindows();
    }
  }

  function draftBannerHtml(draft) {
    if (!draft) return '';
    var when = new Date(draft.savedAt);
    var title = (draft.fields && draft.fields['f-title']) ? draft.fields['f-title'] : 'an unfinished listing';
    return '<div class="st-ok" style="margin-bottom:14px;display:flex;gap:12px;align-items:center;flex-wrap:wrap">'
      + '<span style="flex:1;min-width:200px"><b>You left off part way through.</b> '
      + esc(title) + ', saved ' + esc(when.toLocaleString('en-GB')) + ' on this device.</span>'
      + '<button class="st-btn st-btn-primary" type="button" id="st-draft-restore">Pick up where I left off</button>'
      + '<button class="st-btn" type="button" id="st-draft-discard">Start fresh</button>'
      + '</div>';
  }

  // The share link carries ?ref=<whoever brought this host in>. It is kept for
  // the length of the visit so it survives the wizard, and submitted with the
  // listing so supply work can be counted rather than guessed at.
  function referralCode() {
    var fromUrl = (qs().ref || '').trim();
    if (fromUrl) {
      try { window.sessionStorage.setItem('makaug.short-term.ref', fromUrl); } catch (_error) {}
      return fromUrl;
    }
    try { return window.sessionStorage.getItem('makaug.short-term.ref') || ''; } catch (_error) { return ''; }
  }

  // ---------------------------------------------------------------- photos

  // Phone cameras produce 4MB+ files. Sending one over Kampala mobile data is
  // slow enough that hosts give up, so the image is drawn into a canvas at a
  // sane size before it ever leaves the device. The server resizes and strips
  // metadata again on arrival - this is about the host's data bundle, not
  // about trusting the browser.
  var CLIENT_MAX_EDGE = 1600;
  var CLIENT_QUALITY = 0.82;

  function shrinkImageFile(file) {
    return new Promise(function (resolve, reject) {
      if (!/^image\//i.test(file.type || '')) {
        reject(new Error(file.name + ' is not an image.'));
        return;
      }
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('Could not read ' + file.name)); };
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error(file.name + ' could not be opened as an image.')); };
        img.onload = function () {
          try {
            var scale = Math.min(1, CLIENT_MAX_EDGE / Math.max(img.width, img.height));
            var w = Math.max(1, Math.round(img.width * scale));
            var h = Math.max(1, Math.round(img.height * scale));
            var canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            resolve({
              name: file.name,
              data_url: canvas.toDataURL('image/jpeg', CLIENT_QUALITY),
              status: 'ready'
            });
          } catch (error) {
            // A canvas can be tainted or the file can be a format the browser
            // will not decode. Fall back to the original bytes and let the
            // server judge it.
            resolve({ name: file.name, data_url: reader.result, status: 'ready' });
          }
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function renderPhotoTray() {
    var tray = document.getElementById('st-photo-tray');
    if (!tray) return;
    if (!state.photos.length) {
      tray.innerHTML = '<p class="st-help">No photos yet. Guests skip listings with no photo, so add at least three.</p>';
      return;
    }
    tray.innerHTML = '<div class="st-photo-grid">' + state.photos.map(function (photo, i) {
      var badge = photo.status === 'done'
        ? '<span class="st-photo-state is-done"><i class="fas fa-check"></i></span>'
        : photo.status === 'uploading'
          ? '<span class="st-photo-state is-busy"><i class="fas fa-spinner fa-spin"></i></span>'
          : photo.status === 'error'
            ? '<span class="st-photo-state is-error" title="' + esc(photo.error || 'Failed') + '"><i class="fas fa-triangle-exclamation"></i></span>'
            : '<span class="st-photo-state"><i class="fas fa-clock"></i></span>';
      var remove = photo.status === 'done' ? ''
        : '<button type="button" class="st-photo-remove" data-photo-remove="' + i + '" aria-label="Remove photo"><i class="fas fa-xmark"></i></button>';
      return '<figure class="st-photo' + (i === 0 ? ' is-cover' : '') + '">'
        + '<img src="' + esc(photo.data_url) + '" alt="">'
        + badge + remove
        + (i === 0 ? '<figcaption>Cover photo</figcaption>' : '')
        + '</figure>';
    }).join('') + '</div>';
  }

  function addPhotoFiles(files) {
    var meta = (state.meta && state.meta.photos) || {};
    var max = Number(meta.max_per_listing || 12);
    var room = Math.max(0, max - state.photos.length);
    var chosen = Array.prototype.slice.call(files || []).slice(0, room);
    var feedback = document.getElementById('st-photo-feedback');

    if (!room) {
      if (feedback) feedback.innerHTML = '<ul class="st-errors"><li>That is the maximum of ' + max + ' photos.</li></ul>';
      return Promise.resolve();
    }
    if (feedback) feedback.innerHTML = '';

    return Promise.all(chosen.map(function (file) {
      return shrinkImageFile(file).catch(function (error) {
        return { name: file.name, error: error.message, status: 'error', data_url: '' };
      });
    })).then(function (prepared) {
      prepared.filter(function (p) { return p.data_url; }).forEach(function (p) { state.photos.push(p); });
      var failed = prepared.filter(function (p) { return !p.data_url; });
      if (failed.length && feedback) {
        feedback.innerHTML = '<ul class="st-errors">'
          + failed.map(function (p) { return '<li>' + esc(p.error) + '</li>'; }).join('') + '</ul>';
      }
      renderPhotoTray();
    });
  }

  // One request per photo. The host watches them land instead of staring at a
  // single request that either all works or all fails, and a connection that
  // drops halfway leaves the photos that did upload in place.
  function uploadPendingPhotos() {
    var pending = state.photos.filter(function (p) { return p.status === 'ready' || p.status === 'error'; });
    if (!pending.length || !state.listingId) return Promise.resolve();

    var progress = document.getElementById('st-photo-progress');
    var done = 0;

    function step(index) {
      if (index >= pending.length) return Promise.resolve();
      var photo = pending[index];
      photo.status = 'uploading';
      photo.error = null;
      renderPhotoTray();

      return api('/listings/' + encodeURIComponent(state.listingId) + '/photos', {
        method: 'POST',
        body: { data_url: photo.data_url, upload_token: state.uploadToken }
      }).then(function (out) {
        photo.status = 'done';
        photo.url = out.photo.url;
        done += 1;
      }).catch(function (error) {
        photo.status = 'error';
        photo.error = (error.details && error.details[0]) || error.message;
      }).then(function () {
        renderPhotoTray();
        if (progress) {
          progress.textContent = done + ' of ' + pending.length + ' uploaded';
        }
        return step(index + 1);
      });
    }

    if (progress) progress.textContent = 'Uploading…';
    return step(0).then(function () {
      var failed = state.photos.filter(function (p) { return p.status === 'error'; });
      if (progress) {
        progress.textContent = failed.length
          ? done + ' uploaded, ' + failed.length + ' failed. Tap Upload to retry the rest.'
          : done + ' photo' + (done === 1 ? '' : 's') + ' uploaded.';
      }
    });
  }

  function photoStageHtml(listing) {
    var meta = (state.meta && state.meta.photos) || {};
    var ready = meta.ready !== false;
    return '<div class="st-wrap" style="padding:30px 16px 48px">'
      + '<div class="st-ok" style="margin-bottom:18px">'
      + '<h2 style="margin:0 0 6px;font-size:1.2rem;font-weight:900">Your place is in.</h2>'
      + '<p style="margin:0">Reference <b>' + esc(listing.reference) + '</b>. It is with our team for review.</p>'
      + '</div>'

      + (ready
        ? '<div class="st-panel">'
          + '<h2>Now add photos</h2>'
          + '<p class="st-help" style="margin-bottom:12px">This is the part that decides whether anyone contacts you. '
          + 'The first photo becomes the cover. Up to ' + esc(meta.max_per_listing || 12) + ' photos.</p>'
          + '<label class="st-photo-drop" for="st-photo-input">'
          + '<i class="fas fa-camera"></i><span>Choose photos from this device</span>'
          + '<input id="st-photo-input" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden>'
          + '</label>'
          + '<div id="st-photo-tray" style="margin-top:14px"></div>'
          + '<div id="st-photo-feedback"></div>'
          + '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:14px">'
          + '<button class="st-btn st-btn-primary" type="button" id="st-photo-upload"><i class="fas fa-cloud-arrow-up"></i> Upload photos</button>'
          + '<span class="st-help" id="st-photo-progress"></span>'
          + '</div>'
          + '<p class="st-help" style="margin-top:12px"><i class="fas fa-shield-halved"></i> '
          + esc(meta.note || 'Photos are resized and re-encoded on upload, which removes the location data a phone stores inside them.')
          + '</p>'
          + '</div>'
        : '<div class="st-panel"><h2>Photos</h2>'
          + '<p class="st-help">Photo uploads are temporarily unavailable on this server. Your listing is saved '
          + 'and our team will be in touch about adding pictures.</p></div>')

      + '<div class="st-panel">'
      + '<h2>What happens next</h2>'
      + '<p>Our team checks the listing. Once it is approved you pay the flat listing fee and it goes live for three months.</p>'
      + '<p class="st-help">makaug takes no commission on any stay. Guests will contact you directly on the number you gave us.</p>'
      + '</div>'
      + '<p><a class="st-btn st-btn-primary" href="/short-term" data-st-link>See other short stays</a></p>'
      + '</div>';
  }

  function bindPhotoStage() {
    renderPhotoTray();

    var input = document.getElementById('st-photo-input');
    if (input) {
      input.addEventListener('change', function () {
        addPhotoFiles(input.files).then(function () { input.value = ''; });
      });
    }

    var uploadBtn = document.getElementById('st-photo-upload');
    if (uploadBtn) {
      uploadBtn.addEventListener('click', function () {
        uploadBtn.disabled = true;
        uploadPendingPhotos().then(function () { uploadBtn.disabled = false; });
      });
    }

    var tray = document.getElementById('st-photo-tray');
    if (tray) {
      tray.addEventListener('click', function (e) {
        var remove = e.target.closest('[data-photo-remove]');
        if (!remove) return;
        state.photos.splice(Number(remove.getAttribute('data-photo-remove')), 1);
        renderPhotoTray();
      });
    }
  }

  function renderWindows() {
    var host = document.getElementById('st-windows');
    if (!host) return;
    host.innerHTML = state.windows.map(function (w, i) {
      return '<div class="st-window">'
        + '<div><label class="st-label">Free from</label><input class="st-input" type="date" data-win-from="' + i + '" value="' + esc(w.starts_on) + '" min="' + todayIso() + '"></div>'
        + '<div><label class="st-label">Until</label><input class="st-input" type="date" data-win-to="' + i + '" value="' + esc(w.ends_on) + '" min="' + todayIso() + '"></div>'
        + (state.windows.length > 1 ? '<button class="st-btn" type="button" data-win-remove="' + i + '"><i class="fas fa-trash"></i></button>' : '<span></span>')
        + '</div>';
    }).join('');
  }

  function mountList() {
    var view = $('.st-view-list');
    if (!view) return;

    var render = function () {
      var draft = readDraft();
      view.innerHTML = listViewHtml();
      renderWindows();

      if (draft) {
        var steps = view.querySelector('.st-steps');
        if (steps) steps.insertAdjacentHTML('beforebegin', draftBannerHtml(draft));
        var restore = document.getElementById('st-draft-restore');
        var discard = document.getElementById('st-draft-discard');
        if (restore) {
          restore.addEventListener('click', function () {
            applyDraft(draft);
            var banner = restore.closest('.st-ok');
            if (banner) banner.remove();
          });
        }
        if (discard) {
          discard.addEventListener('click', function () {
            clearDraft();
            var banner = discard.closest('.st-ok');
            if (banner) banner.remove();
          });
        }
      }

      // Autosave. Debounced, so typing a description is not 400 writes.
      view.addEventListener('input', queueDraftSave);
      view.addEventListener('change', queueDraftSave);

      view.addEventListener('click', function (e) {
        var next = e.target.closest('[data-next]');
        if (next) {
          var step = Number(next.getAttribute('data-next'));
          $$('[data-panel]').forEach(function (p) { p.hidden = Number(p.getAttribute('data-panel')) !== step; });
          $$('.st-step').forEach(function (s) {
            var n = Number(s.getAttribute('data-step'));
            s.classList.toggle('is-on', n === step);
            s.classList.toggle('is-done', n < step);
          });
          state.wizardStep = step;
          window.scrollTo({ top: 0, behavior: 'smooth' });
          return;
        }
        if (e.target.closest('#st-add-window')) {
          state.windows.push({ starts_on: '', ends_on: '' });
          renderWindows();
          return;
        }
        var remove = e.target.closest('[data-win-remove]');
        if (remove) {
          state.windows.splice(Number(remove.getAttribute('data-win-remove')), 1);
          if (!state.windows.length) state.windows.push({ starts_on: '', ends_on: '' });
          renderWindows();
        }
      });

      view.addEventListener('change', function (e) {
        var from = e.target.getAttribute && e.target.getAttribute('data-win-from');
        var to = e.target.getAttribute && e.target.getAttribute('data-win-to');
        if (from != null) state.windows[Number(from)].starts_on = e.target.value;
        if (to != null) state.windows[Number(to)].ends_on = e.target.value;
      });

      var form = document.getElementById('st-list-form');
      if (form) {
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          var val = function (id) { var el = document.getElementById(id); return el ? el.value : ''; };
          var checked = function (id) { var el = document.getElementById(id); return !!(el && el.checked); };
          var feedback = document.getElementById('st-list-feedback');

          api('/listings', {
            method: 'POST',
            body: {
              title: val('f-title'),
              description: val('f-desc'),
              district: val('f-district'),
              area: val('f-area'),
              place_type: val('f-place'),
              property_type: val('f-ptype'),
              bedrooms: val('f-bedrooms'),
              beds: val('f-beds'),
              bathrooms: val('f-bathrooms'),
              max_guests: val('f-guests'),
              base_nightly_ugx: val('f-nightly'),
              cleaning_fee_ugx: val('f-clean'),
              security_deposit_ugx: val('f-deposit'),
              min_nights: val('f-min'),
              weekly_discount_pct: val('f-week'),
              monthly_discount_pct: val('f-month'),
              check_in_from: val('f-cin'),
              check_out_by: val('f-cout'),
              house_rules: val('f-rules'),
              terms_text: val('f-terms'),
              cancellation_policy: val('f-cancel'),
              host_name: val('f-hname'),
              host_phone: val('f-hphone'),
              host_whatsapp: val('f-hwa'),
              host_email: val('f-hemail'),
              host_type: val('f-htype'),
              preferred_payment_method: val('f-pay'),
              right_to_let_reference: val('f-titleref'),
              right_to_let_declared: checked('f-right'),
              local_hotel_tax_ack: checked('f-tax'),
              terms_accepted: checked('f-terms-ok'),
              referral_code: referralCode(),
              amenities: $$('[data-amenity]:checked').map(function (el) { return el.value; }),
              availability: state.windows.filter(function (w) { return w.starts_on && w.ends_on; })
            }
          }).then(function (out) {
            // Saved on the server, so the local rescue copy has done its job.
            clearDraft();
            state.listingId = out.listing.id;
            state.uploadToken = out.upload_token || null;
            if (state.meta && state.meta.photos) {
              state.meta.photos.ready = out.photos_ready !== false && state.meta.photos.ready !== false;
            }
            view.innerHTML = photoStageHtml(out.listing);
            bindPhotoStage();
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }).catch(function (error) {
            if (feedback) {
              feedback.innerHTML = '<ul class="st-errors">'
                + ((error.details && error.details.length ? error.details : [error.message])
                  .map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('')) + '</ul>';
              feedback.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          });
        });
      }
    };

    if (state.meta) return render();
    api('/meta').then(function (meta) { state.meta = meta; render(); }).catch(render);
  }

  // ---------------------------------------------------------------- routing

  function setView(name) {
    var r = root();
    if (!r) return;
    r.classList.add('st-hydrated');
    ['search', 'detail', 'list'].forEach(function (key) {
      var el = r.querySelector('.st-view-' + key);
      if (el) el.classList.toggle('is-active', key === name);
    });
  }

  function route() {
    var r = root();
    if (!r) return;
    var path = currentPath();
    if (path !== '/short-term' && path.indexOf('/short-term/') !== 0) return;

    if (typeof window.showPage === 'function') {
      try { window.showPage('short-term', { scroll: false }); } catch (_e) {}
    } else {
      document.querySelectorAll('.page.active').forEach(function (p) {
        if (p !== r) p.classList.remove('active');
      });
      r.classList.add('active');
    }

    if (path === '/short-term/list-your-place') {
      setView('list');
      mountList();
      return;
    }
    if (path.indexOf('/short-term/') === 0) {
      setView('detail');
      mountDetail(path.slice('/short-term/'.length));
      return;
    }
    setView('search');
    if (!r.querySelector('#st-search-form')) mountSearch();
  }

  // Internal links stay in the single page app.
  document.addEventListener('click', function (e) {
    var link = e.target.closest ? e.target.closest('a[data-st-link], a[href^="/short-term"]') : null;
    if (!link) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    if (link.target === '_blank') return;
    var href = link.getAttribute('href') || '';
    if (href.indexOf('/short-term') !== 0) return;
    e.preventDefault();
    go(href);
  });

  window.addEventListener('popstate', route);

  function boot() {
    if (!root()) return;
    api('/meta').then(function (meta) { state.meta = meta; }).catch(function () {});
    route();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }


  window.makaugShortTerm = { route: route, search: runSearch };
})();
