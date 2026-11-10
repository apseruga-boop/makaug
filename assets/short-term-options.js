/* Short-stay search grid and stay page. The map is mountSharedListingMap,
   the same map for-sale, to-rent and the homepage use. */
(function () {
  'use strict';

  var STAY_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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
    if (listing.id_pending) {
      html += '<span class="st-opt-badge is-id-pending">ID still pending</span>';
    } else if (listing.id_checked) {
      html += '<span class="st-opt-badge is-id-checked">ID checked</span>';
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

  function mapColumn() {
    return '<div class="listing-map-col st-opt-mapcol hidden">'
      + '<div class="listing-map-shell">'
      + '<div id="map-short-term" class="map-h rounded-xl border border-gray-200 overflow-hidden"></div>'
      + '</div></div>';
  }

  function blocksDirectContact(listing) {
    if (!listing) return true;
    if (listing.found_online === true || listing.do_not_message === true) return true;
    if (String(listing.source || '').toLowerCase() === 'imported') return true;
    var contact = listing.direct_contact;
    return !(contact && (contact.whatsapp_digits || contact.tel_href));
  }

  function stayPublicUrl(listing) {
    var path = String((listing && listing.url) || '/short-term');
    if (/^https:\/\//i.test(path)) return path;
    if (path.charAt(0) !== '/') path = '/' + path;
    return 'https://makaug.com' + path;
  }

  function prettyStayDate(iso, withYear) {
    var parts = String(iso || '').slice(0, 10).split('-');
    if (parts.length !== 3) return '';
    var month = Number(parts[1]);
    var day = Number(parts[2]);
    if (!Number(parts[0]) || month < 1 || month > 12 || day < 1 || day > 31) return '';
    return day + ' ' + STAY_MONTHS[month - 1] + (withYear === false ? '' : ' ' + parts[0]);
  }

  function nightCount(from, to) {
    var start = Date.parse(String(from || '').slice(0, 10) + 'T00:00:00Z');
    var end = Date.parse(String(to || '').slice(0, 10) + 'T00:00:00Z');
    if (!isFinite(start) || !isFinite(end)) return 0;
    return Math.round((end - start) / 86400000);
  }

  function stayMessage(listing, checkIn, checkOut, guests) {
    var title = String((listing && listing.title) || 'your stay').replace(/[\r\n"]/g, ' ').replace(/\s+/g, ' ').trim() || 'your stay';
    var reference = String((listing && listing.reference) || '').trim();
    var text = 'Hi, I saw your stay "' + title + '"';
    if (reference) text += ' (' + reference + ')';
    text += ' on makaug.com: ' + stayPublicUrl(listing) + '.';
    var from = prettyStayDate(checkIn, false);
    var to = prettyStayDate(checkOut, true);
    var nights = from && to ? nightCount(checkIn, checkOut) : 0;
    var people = Number(guests);
    if (from && to && nights > 0) {
      text += ' Is it available from ' + from + ' to ' + to + ' (' + nights + ' night' + (nights === 1 ? '' : 's') + ')';
      if (people > 0) text += ' for ' + people + ' guest' + (people === 1 ? '' : 's');
      text += '?';
    } else {
      text += ' Is it available?';
    }
    return text;
  }

  function waDigits(listing) {
    var raw = listing && listing.direct_contact && listing.direct_contact.whatsapp_digits;
    return String(raw || '').replace(/\D/g, '');
  }

  function telHref(listing) {
    var href = String((listing && listing.direct_contact && listing.direct_contact.tel_href) || '');
    return /^tel:\+\d{8,15}$/.test(href) ? href : '';
  }

  function stayFields() {
    return {
      checkIn: (document.getElementById('st-d-in') || {}).value || '',
      checkOut: (document.getElementById('st-d-out') || {}).value || '',
      guests: (document.getElementById('st-d-guests') || {}).value || ''
    };
  }

  function mapButton(helpers) {
    return '<button class="st-opt-mapbtn" id="st-opt-mapbtn" type="button"><i class="fas fa-map"></i> ' + helpers.esc(helpers.t('showMap')) + '</button>';
  }

  function searchHtml(helpers) {
    return '<div class="st-opt st-opt-grid"><div class="st-opt-wrap">'
      + '<header class="st-opt-intro"><h1>short stays</h1>'
      + '<p>Apartments, cottages and guest houses by the night, with the host’s own photos.</p></header>'
      + searchFields(helpers, 'is-pill')
      + payLine(helpers)
      + '<div id="st-ai-slot"></div>'
      + '<div class="st-opt-tools"><div class="st-count" id="st-count">' + helpers.esc(helpers.t('loading')) + '</div><div class="st-opt-tools-end">'
      + sortSelect(helpers)
      + mapButton(helpers)
      + '</div></div>'
      + '<div id="st-results"></div>'
      + '<div id="st-lead-slot"></div>'
      + '</div>' + mapColumn() + '</div>'
      + '<div id="st-worth-slot"></div>';
  }

  function detailHref(listing, helpers) {
    var q = helpers.qs();
    var params = new URLSearchParams();
    ['check_in', 'check_out', 'guests'].forEach(function (key) {
      if (q[key]) params.set(key, q[key]);
    });
    var search = params.toString();
    return (listing.url || '/short-term') + (search ? '?' + search : '');
  }

  function cardHtml(listing, helpers) {
    var id = listing.id || listing.url || '';
    var href = detailHref(listing, helpers);
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

    return '<article class="st-opt-card" data-map-card-id="' + helpers.esc(id) + '" data-st-card-id="' + helpers.esc(id) + '">'
      + '<a class="st-opt-media" href="' + helpers.esc(href) + '" data-st-link>' + media + badges(listing, helpers) + '</a>'
      + '<div class="st-opt-body">' + body + '</div></article>';
  }

  function paintResults(state, helpers) {
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
    target.innerHTML = '<div class="st-opt-cards">' + listings.map(function (listing) {
      return cardHtml(listing, helpers);
    }).join('') + '</div>';
  }

  function contactActions(listing, helpers) {
    if (!blocksDirectContact(listing)) {
      return '<a class="st-opt-wa" id="st-stay-wa" target="_blank" rel="noopener noreferrer"><i class="fab fa-whatsapp"></i> Request stay</a>'
        + '<a class="st-opt-tel" id="st-stay-call"><i class="fas fa-phone"></i> Call</a>';
    }
    var source = String(listing.source_url || listing.source_post_url || listing.youtube_url || listing.tiktok_url || '');
    if (/^https:\/\//i.test(source) && !/^https:\/\/media\.makaug\.com\//i.test(source)) {
      return '<p class="st-opt-found">Found online</p>'
        + '<a class="st-opt-source" href="' + helpers.esc(source) + '" target="_blank" rel="noopener noreferrer">See original post</a>';
    }
    return '<p class="st-opt-found">Found online</p>'
      + '<p class="st-opt-found-note">No original post is listed for this stay.</p>';
  }

  function bookCard(listing, payload, helpers) {
    var q = helpers.qs();
    return '<aside class="st-opt-book">'
      + '<p class="st-opt-bookprice">' + helpers.esc(listing.nightly_display || '') + ' <span>' + helpers.esc(helpers.t('perNight')) + '</span></p>'
      + '<p class="st-opt-bookwhere">' + helpers.esc(whereText(listing)) + '</p>'
      + '<div class="st-opt-bookgrid">'
      + '<label>Check in<input class="st-input" id="st-d-in" type="date" value="' + helpers.esc(q.check_in || '') + '"></label>'
      + '<label>Check out<input class="st-input" id="st-d-out" type="date" value="' + helpers.esc(q.check_out || '') + '"></label>'
      + '</div>'
      + helpers.stayDayStrip(listing)
      + '<label class="st-opt-guestlabel">Guests<input class="st-input" id="st-d-guests" type="number" min="1" max="30" value="' + helpers.esc(q.guests || '') + '"></label>'
      + '<div id="st-quote">' + helpers.quoteHtml(payload.quote) + '</div>'
      + '<div id="st-availability">' + helpers.availabilityHtml(payload.availability) + '</div>'
      + '<p class="st-opt-pay">' + helpers.esc(helpers.t('paymentDirect')) + '</p>'
      + contactActions(listing, helpers)
      + '</aside>';
  }

  function logContactClick(listing, channel) {
    if (!listing || !listing.id || blocksDirectContact(listing)) return;
    var fields = stayFields();
    var message = stayMessage(listing, fields.checkIn, fields.checkOut, fields.guests);
    try {
      fetch('/api/short-term/listings/' + encodeURIComponent(listing.id) + '/contact-clicks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: channel,
          check_in: fields.checkIn,
          check_out: fields.checkOut,
          guests: fields.guests,
          message: message
        }),
        keepalive: true
      }).catch(function () {});
    } catch (_error) {}
  }

  function paintStayLinks(listing) {
    if (!listing || blocksDirectContact(listing)) return;
    var fields = stayFields();
    var wa = document.getElementById('st-stay-wa');
    var call = document.getElementById('st-stay-call');
    var digits = waDigits(listing);
    var message = stayMessage(listing, fields.checkIn, fields.checkOut, fields.guests);
    var dated = !!(prettyStayDate(fields.checkIn, false) && prettyStayDate(fields.checkOut, true) && nightCount(fields.checkIn, fields.checkOut) > 0);
    if (wa && digits) {
      wa.href = 'https://wa.me/' + digits + '?text=' + encodeURIComponent(message);
      wa.innerHTML = '<i class="fab fa-whatsapp"></i> ' + (dated ? 'Request these dates' : 'Request stay');
      if (wa.getAttribute('data-bound') !== '1') {
        wa.setAttribute('data-bound', '1');
        wa.addEventListener('click', function () { logContactClick(listing, 'whatsapp'); });
      }
    }
    var tel = telHref(listing);
    if (call && tel) {
      call.href = tel;
      if (call.getAttribute('data-bound') !== '1') {
        call.setAttribute('data-bound', '1');
        call.addEventListener('click', function () { logContactClick(listing, 'phone'); });
      }
    }
  }

  function detailHtml(payload, helpers) {
    var listing = payload.listing || {};
    var q = helpers.qs();
    var back = new URLSearchParams();
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

    var backSearch = back.toString();
    return '<div class="st-opt st-opt-detail"><div class="st-opt-wrap">'
      + '<p class="st-opt-crumb"><a href="/short-term' + (backSearch ? '?' + helpers.esc(backSearch) : '') + '" data-st-link>All short stays</a></p>'
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
    syncMap: syncMap,
    paintStayLinks: paintStayLinks,
    stayMessage: stayMessage
  };
})();
