/* Short-stay design options. Open with ?design=grid, ?design=split or ?design=list.
   The live page is unchanged when the parameter is absent.
   Every option that shows a map calls mountSharedListingMap, the same map
   for-sale, to-rent and the homepage use. */
(function () {
  'use strict';

  var RIBBON = {
    grid: 'Option A · photo grid',
    split: 'Option B · map split',
    list: 'Option C · compact list'
  };

  function photoUrl(listing) {
    var url = '';
    if (listing && listing.primary_image) url = String(listing.primary_image);
    else if (listing && listing.images && listing.images[0]) url = String((listing.images[0] && listing.images[0].url) || '');
    return /^https?:\/\//i.test(url) ? url : '';
  }

  function realImages(listing) {
    var rows = (listing && listing.images) || [];
    var images = rows.map(function (img) {
      var url = img && (img.url || img);
      return /^https?:\/\//i.test(String(url || '')) ? { url: String(url), caption: (img && img.caption) || '' } : null;
    }).filter(Boolean);
    if (!images.length && photoUrl(listing)) images = [{ url: photoUrl(listing), caption: '' }];
    return images;
  }

  function whereText(listing) {
    return [listing.area, listing.district].filter(Boolean).join(', ');
  }

  function specText(listing) {
    var bits = [];
    if (listing.place_type_label) bits.push(listing.place_type_label);
    var beds = Number(listing.bedrooms) || 0;
    if (beds) bits.push(beds + (beds === 1 ? ' bedroom' : ' bedrooms'));
    var guests = Number(listing.max_guests) || 0;
    if (guests) bits.push('sleeps ' + guests);
    return bits.join(' · ');
  }

  function previewText(listing) {
    var status = String((listing && (listing.status || listing.moderation_status)) || '').toLowerCase();
    if (!listing) return '';
    if (listing.preview === true || (status && status !== 'approved')) return 'Preview · not approved';
    return '';
  }

  function badges(listing, helpers) {
    var html = '';
    var preview = previewText(listing);
    var badge = helpers.badge(listing);
    if (preview) html += '<span class="st-opt-badge is-preview">' + helpers.esc(preview) + '</span>';
    if (badge && badge.label) {
      html += '<span class="st-opt-badge' + (badge.approved ? ' is-approved' : '') + '">' + helpers.esc(badge.label) + '</span>';
    }
    return html;
  }

  function stayBits(helpers) {
    var q = helpers.qs();
    var bits = [];
    if (q.check_in && q.check_out) bits.push(q.check_in + ' to ' + q.check_out);
    else if (q.check_in) bits.push('from ' + q.check_in);
    if (q.guests) bits.push(q.guests + (String(q.guests) === '1' ? ' guest' : ' guests'));
    return bits.join(' · ');
  }

  function field(helpers, name, fallback) {
    var q = helpers.qs();
    return helpers.esc(q[name] || fallback || '');
  }

  function sortSelect(helpers) {
    var sort = helpers.qs().sort || '';
    function opt(value, label) {
      return '<option value="' + helpers.esc(value) + '"' + (sort === value ? ' selected' : '') + '>' + helpers.esc(label) + '</option>';
    }
    return '<select class="st-opt-sort" id="st-sort" aria-label="' + helpers.esc(helpers.t('sortNewest')) + '">'
      + opt('', helpers.t('sortNewest'))
      + opt('price_asc', helpers.t('sortLow'))
      + opt('price_desc', helpers.t('sortHigh'))
      + opt('rating', helpers.t('sortRated'))
      + '</select>';
  }

  function searchFields(helpers, extraClass) {
    return '<form class="st-opt-form ' + (extraClass || '') + '" id="st-search-form">'
      + '<label><span>' + helpers.esc(helpers.t('where')) + '</span>'
      + '<input id="st-q" name="q" value="' + field(helpers, 'q') + '" placeholder="' + helpers.esc(helpers.t('wherePh')) + '" autocomplete="off"></label>'
      + '<label><span>' + helpers.esc(helpers.t('checkIn')) + '</span>'
      + '<input id="st-in" name="check_in" type="date" value="' + field(helpers, 'check_in') + '"></label>'
      + '<label><span>' + helpers.esc(helpers.t('checkOut')) + '</span>'
      + '<input id="st-out" name="check_out" type="date" value="' + field(helpers, 'check_out') + '"></label>'
      + '<label><span>' + helpers.esc(helpers.t('guests')) + '</span>'
      + '<input id="st-guests" name="guests" type="number" min="1" max="30" value="' + field(helpers, 'guests') + '" placeholder="2"></label>'
      + '<label><span>' + helpers.esc(helpers.t('maxNight')) + '</span>'
      + '<input id="st-max" name="max_price" type="number" min="0" step="10000" value="' + field(helpers, 'max_price') + '" placeholder="UGX"></label>'
      + '<button class="st-opt-go" type="submit">' + helpers.esc(helpers.t('search')) + '</button>'
      + '</form>';
  }

  function payLine(helpers) {
    return '<p class="st-opt-pay">' + helpers.esc(helpers.t('d1Lead')) + ' ' + helpers.esc(helpers.t('paymentDirect')) + '</p>';
  }

  function mapColumn(design) {
    var hidden = design === 'split' ? ' hidden lg:block' : ' hidden';
    return '<div class="listing-map-col st-opt-mapcol' + hidden + '">'
      + '<div class="listing-map-shell">'
      + '<div id="map-short-term" class="map-h rounded-xl border border-gray-200 overflow-hidden"></div>'
      + '</div>'
      + '<p class="st-opt-mapnote">Nightly price on each pin. Same map as for sale and to rent.</p>'
      + '</div>';
  }

  function mapButton(helpers) {
    return '<button class="st-opt-mapbtn" id="st-opt-mapbtn" type="button"><i class="fas fa-map"></i> ' + helpers.esc(helpers.t('showMap')) + '</button>';
  }

  function searchHtml(design, helpers) {
    var ribbon = '<p class="st-opt-ribbon">' + helpers.esc(RIBBON[design] || 'Preview') + '</p>';
    var ai = '<div id="st-ai-slot"></div>';
    var results = '<div id="st-results"></div>';
    var tools = '<div class="st-opt-tools"><div class="st-count" id="st-count">' + helpers.esc(helpers.t('loading')) + '</div><div class="st-opt-tools-end">'
      + sortSelect(helpers)
      + (design === 'split' ? '' : mapButton(helpers))
      + '</div></div>';

    if (design === 'split') {
      return '<div class="st-opt st-opt-split">'
        + '<header class="st-opt-band"><div class="st-opt-wrap">' + ribbon
        + '<h1>Find a short stay</h1>'
        + '<p>Nightly places on makaug. You agree the dates, and you pay the host.</p>'
        + '</div></header>'
        + '<div class="st-opt-filterbar"><div class="st-opt-wrap">' + searchFields(helpers, 'is-bar') + '</div></div>'
        + ai
        + '<div class="st-opt-wrap st-opt-splitgrid">'
        + '<div class="st-opt-main">' + tools + results + payLine(helpers) + '</div>'
        + mapColumn('split')
        + '</div></div>';
    }

    if (design === 'list') {
      return '<div class="st-opt st-opt-list"><div class="st-opt-wrap">'
        + ribbon
        + '<header class="st-opt-listhead"><div><h1>short stays</h1>'
        + '<p>A compact list of nightly places on makaug.</p></div>'
        + '<a class="st-opt-listlink" href="/short-term/list-your-place" data-st-link>' + helpers.esc(helpers.t('listPlace')) + '</a>'
        + '</header>'
        + searchFields(helpers, 'is-line')
        + payLine(helpers)
        + ai + tools + results
        + '</div>' + mapColumn('list') + '</div>';
    }

    return '<div class="st-opt st-opt-grid"><div class="st-opt-wrap">'
      + ribbon
      + '<header class="st-opt-intro"><h1>short stays</h1>'
      + '<p>Apartments, cottages and guest houses by the night, with the host’s own photos.</p></header>'
      + searchFields(helpers, 'is-pill')
      + payLine(helpers)
      + ai + tools + results
      + '</div>' + mapColumn('grid') + '</div>';
  }

  function detailHref(listing, helpers, design) {
    var q = helpers.qs();
    var params = new URLSearchParams();
    params.set('design', design);
    ['check_in', 'check_out', 'guests'].forEach(function (key) {
      if (q[key]) params.set(key, q[key]);
    });
    return (listing.url || '/short-term') + '?' + params.toString();
  }

  function cardHtml(design, listing, helpers) {
    var id = listing.id || listing.url || '';
    var href = detailHref(listing, helpers, design);
    var photo = photoUrl(listing);
    var media = photo
      ? '<img src="' + helpers.esc(photo) + '" alt="' + helpers.esc(listing.title || 'Short stay') + '">'
      : '<div class="st-opt-nophoto"><i class="fas fa-house"></i><span>No photo yet</span></div>';
    var price = listing.nightly_display
      ? '<b>' + helpers.esc(listing.nightly_display) + '</b> <span>' + helpers.esc(helpers.t('perNight')) + '</span>'
      : '';
    var body = '<h2><a href="' + helpers.esc(href) + '" data-st-link>' + helpers.esc(listing.title || 'Short stay') + '</a></h2>'
      + '<p class="st-opt-where">' + helpers.esc(whereText(listing)) + '</p>'
      + '<p class="st-opt-spec">' + helpers.esc(specText(listing)) + '</p>'
      + '<p class="st-opt-price">' + price + '</p>'
      + helpers.availabilityRowHtml(listing);

    if (design === 'list') {
      return '<article class="st-opt-row" data-map-card-id="' + helpers.esc(id) + '" data-st-card-id="' + helpers.esc(id) + '">'
        + '<a class="st-opt-rowmedia" href="' + helpers.esc(href) + '" data-st-link>' + media + '</a>'
        + '<div class="st-opt-rowbody">' + badges(listing, helpers) + body + '</div></article>';
    }

    return '<article class="st-opt-card" data-map-card-id="' + helpers.esc(id) + '" data-st-card-id="' + helpers.esc(id) + '">'
      + '<a class="st-opt-media" href="' + helpers.esc(href) + '" data-st-link>' + media + badges(listing, helpers) + '</a>'
      + '<div class="st-opt-body">' + body + '</div></article>';
  }

  function paintResults(design, state, helpers) {
    var count = document.getElementById('st-count');
    var target = document.getElementById('st-results');
    var total = state.total || (state.listings || []).length;
    var when = stayBits(helpers);
    if (count) {
      count.innerHTML = '<span>' + total + ' ' + helpers.esc(helpers.t('stays')) + '</span>'
        + (when ? '<small>' + helpers.esc(when) + '</small>' : '<small>' + helpers.esc(helpers.t('countNote')) + '</small>');
    }
    if (!target) return;
    var listings = state.listings || [];
    if (!listings.length) {
      target.innerHTML = '<div class="st-opt-empty">' + helpers.esc(helpers.t('emptyFilters')) + '</div>';
      return;
    }
    var cls = design === 'list' ? 'st-opt-rows' : 'st-opt-cards';
    target.innerHTML = '<div class="' + cls + '">' + listings.map(function (listing) {
      return cardHtml(design, listing, helpers);
    }).join('') + '</div>';
  }

  function bookCard(listing, payload, helpers) {
    var q = helpers.qs();
    var contact = listing.contact || {};
    var wa = contact.whatsapp_href
      ? '<a class="st-opt-wa" href="' + helpers.esc(contact.whatsapp_href) + '" target="_blank" rel="noopener noreferrer" data-st-contact="whatsapp"><i class="fab fa-whatsapp"></i> WhatsApp the host</a>'
      : '';
    var tel = contact.tel_href
      ? '<a class="st-opt-tel" href="' + helpers.esc(contact.tel_href) + '" data-st-contact="phone"><i class="fas fa-phone"></i> Call ' + helpers.esc(contact.phone_display || 'the host') + '</a>'
      : '';
    return '<aside class="st-opt-book">'
      + '<p class="st-opt-bookprice">' + helpers.esc(listing.nightly_display || '') + ' <span>' + helpers.esc(helpers.t('perNight')) + '</span></p>'
      + '<p class="st-opt-bookwhere">' + helpers.esc(whereText(listing)) + '</p>'
      + '<div class="st-opt-bookgrid">'
      + '<label>Check in<input class="st-input" id="st-d-in" type="date" value="' + helpers.esc(q.check_in || '') + '"></label>'
      + '<label>Check out<input class="st-input" id="st-d-out" type="date" value="' + helpers.esc(q.check_out || '') + '"></label>'
      + '</div>'
      + helpers.stayDayStrip(listing)
      + '<label class="st-opt-guestlabel">Guests<input class="st-input" id="st-d-guests" type="number" min="1" max="30" value="' + helpers.esc(q.guests || '2') + '"></label>'
      + '<label class="st-opt-guestlabel">Email (optional)<input class="st-input" id="st-d-email" type="email"></label>'
      + '<div id="st-quote">' + helpers.quoteHtml(payload.quote) + '</div>'
      + '<div id="st-availability">' + helpers.availabilityHtml(payload.availability) + '</div>'
      + '<p class="st-opt-pay">' + helpers.esc(helpers.t('paymentDirect')) + '</p>'
      + wa + tel
      + '<div class="agent-booking-tabs" role="tablist" id="st-intent-tabs">'
      + '<button type="button" class="is-active" data-st-intent="dates">Request these dates</button>'
      + '<button type="button" data-st-intent="callback">Request a callback</button>'
      + '<button type="button" data-st-intent="question">Ask a question</button>'
      + '</div>'
      + '<button class="st-contact-btn st-contact-form" type="button" id="st-enquire-open"><i class="fas fa-envelope"></i> Request these dates</button>'
      + '<div id="st-enquire-shell"></div>'
      + '<label class="st-check"><input type="checkbox" id="st-d-terms"> <span><a href="/short-term/terms?design=' + helpers.esc(helpers.qs().design || '') + '" data-st-link>Short stay terms</a></span></label>'
      + '</aside>';
  }

  function detailHtml(design, payload, helpers) {
    var listing = payload.listing || {};
    var q = helpers.qs();
    var back = new URLSearchParams();
    back.set('design', design);
    ['q', 'check_in', 'check_out', 'guests', 'max_price'].forEach(function (key) {
      if (q[key]) back.set(key, q[key]);
    });
    var images = realImages(listing);
    var gallery = images.length
      ? '<div class="st-opt-gallery">' + images.slice(0, 5).map(function (img) {
        return '<img src="' + helpers.esc(img.url) + '" alt="' + helpers.esc(img.caption || listing.title || '') + '">';
      }).join('') + '</div>'
      : '<div class="st-opt-nophoto st-opt-nophoto-lg"><i class="fas fa-house"></i><span>No photo from this listing yet</span></div>';
    var facts = [
      [listing.max_guests, 'Guests'],
      [listing.bedrooms, 'Bedrooms'],
      [listing.beds, 'Beds'],
      [listing.bathrooms, 'Bathrooms']
    ].map(function (pair) {
      return '<div><b>' + helpers.esc(pair[0] == null ? '—' : String(pair[0])) + '</b><span>' + pair[1] + '</span></div>';
    }).join('');

    return '<div class="st-opt st-opt-detail st-opt-detail-' + design + '"><div class="st-opt-wrap">'
      + '<p class="st-opt-ribbon">' + helpers.esc(RIBBON[design] || 'Preview') + '</p>'
      + '<p class="st-opt-crumb"><a href="/short-term?' + helpers.esc(back.toString()) + '" data-st-link>All short stays</a></p>'
      + '<div class="st-opt-detailtop">'
      + '<div><div class="st-opt-badges">' + badges(listing, helpers) + '</div>'
      + '<h1>' + helpers.esc(listing.title || 'Short stay') + '</h1>'
      + '<p class="st-opt-where">' + helpers.esc(whereText(listing)) + ' · ' + helpers.esc(specText(listing)) + '</p>'
      + '</div></div>'
      + '<div class="st-opt-detaillayout">'
      + '<div>' + gallery
      + '<div class="st-opt-facts">' + facts + '</div>'
      + '<p class="st-opt-check">Check in from ' + helpers.esc(listing.check_in_from || '—')
      + ' · Check out by ' + helpers.esc(listing.check_out_by || '—') + '</p>'
      + '<div class="st-opt-prose">' + helpers.esc(listing.description || '') + '</div>'
      + '<div class="listing-map-col st-opt-detailmap"><div class="listing-map-shell">'
      + '<div id="map-short-term" class="map-h rounded-xl border border-gray-200 overflow-hidden"></div>'
      + '</div></div>'
      + '<details class="st-opt-report"><summary>Something wrong with this listing?</summary>'
      + '<form id="st-report-form" class="st-form-grid">'
      + '<div><label class="st-label" for="st-report-reason">What is wrong</label>'
      + '<select class="st-input" id="st-report-reason">'
      + '<option>It is not available / does not exist</option>'
      + '<option>The price is wrong</option>'
      + '<option>The photos are not of this place</option>'
      + '<option>I think this is a scam</option>'
      + '<option>Something else</option></select></div>'
      + '<div><label class="st-label" for="st-report-contact">Your contact (optional)</label><input class="st-input" id="st-report-contact"></div>'
      + '<div><label class="st-label" for="st-report-details">Details</label><textarea class="st-input" id="st-report-details"></textarea></div>'
      + '<div><button class="st-btn" type="submit">Report this listing</button><span id="st-report-feedback"></span></div>'
      + '</form></details>'
      + '</div>'
      + bookCard(listing, payload, helpers)
      + '</div></div></div>';
  }

  function pinsFrom(snapshot) {
    return ((snapshot && snapshot.listings) || []).filter(function (row) {
      return row && isFinite(Number(row.latitude)) && isFinite(Number(row.longitude));
    }).map(function (row) {
      if (typeof window.shortStayPinForMap !== 'function') return null;
      var pin = window.shortStayPinForMap(row);
      var photo = photoUrl(row);
      if (photo) {
        pin.img = photo;
        pin.images = [{ url: photo }];
        pin.primary_image_url = photo;
      }
      return pin;
    }).filter(Boolean);
  }

  function bindMapButton() {
    var btn = document.getElementById('st-opt-mapbtn');
    if (!btn || btn.getAttribute('data-bound') === '1') return;
    btn.setAttribute('data-bound', '1');
    btn.addEventListener('click', function () {
      if (typeof window.toggleListingMap === 'function') window.toggleListingMap();
    });
  }

  function syncMap(snapshot) {
    bindMapButton();
    var active = document.querySelector('.st-view.is-active') || document.getElementById('page-short-term');
    document.querySelectorAll('[id="map-short-term"]').forEach(function (node) {
      if (active && !active.contains(node)) node.removeAttribute('id');
    });
    if (!document.getElementById('map-short-term') || typeof window.mountSharedListingMap !== 'function') return;
    Promise.resolve(window.mountSharedListingMap('map-short-term', pinsFrom(snapshot))).then(function () {
      if (typeof window.syncListingMapToggle === 'function') window.syncListingMapToggle();
    }).catch(function () {});
  }

  window.makaugShortTermOptions = {
    searchHtml: searchHtml,
    paintResults: paintResults,
    detailHtml: detailHtml,
    syncMap: syncMap
  };
})();
