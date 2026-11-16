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
      // Best reviewed only once a stay has a review to sort by.
      + (sort === 'rating' ? opt('rating', helpers.t('sortRated')) : '')
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
      // The "Can't find what you're looking for?" card sits under the map, as
      // it does on the sale and rent pages, whenever the map is on screen.
      + '<div id="st-map-lead-slot"></div>'
      + '</div></div>';
  }

  // Aggregator notice. Short on the grid, the same words on every stay.
  function aggregatorNotice(helpers) {
    return '<div class="st-opt-aggregator" role="note" id="st-aggregator">'
      + '<p><b>makaug.com gathers short stays posted online in Uganda</b> (social media, Airbnb and similar sites) so they are easier to find. '
      + 'We do not take bookings or payments and are not responsible for any stay. '
      + 'Contact the original poster to check availability, dates and price.</p></div>';
  }

  function safetyTips() {
    return '<section class="st-opt-safety" aria-labelledby="st-opt-safety-h">'
      + '<h2 id="st-opt-safety-h">Before you pay for a stay</h2>'
      + '<ul>'
      + '<li>View the place, or have someone you trust view it, before you pay.</li>'
      + '<li>Do not send a deposit to someone you cannot verify.</li>'
      + '<li>Check the original post and that the photos, price and dates match.</li>'
      + '<li>Report a listing that looks wrong with "Something wrong with this listing?" or on WhatsApp.</li>'
      + '</ul>'
      + '<p>makaug.com is not a party to any booking. Payment is agreed between you and the poster.</p>'
      + '</section>';
  }

  function mapIsOnScreen() {
    var col = document.querySelector('#page-short-term .st-opt-mapcol');
    // On a phone the open map covers the page, so the card stays with the list.
    var wide = window.matchMedia ? window.matchMedia('(min-width: 1024px)').matches : true;
    return !!(wide && col && col.offsetParent);
  }

  // One card, never two: it moves between the results and the map column.
  function placeLeadCard() {
    var slot = document.getElementById('st-lead-slot');
    var under = document.getElementById('st-map-lead-slot');
    var home = document.getElementById('st-lead-home');
    if (!slot || !under || !home) return;
    if (mapIsOnScreen()) {
      if (slot.parentNode !== under) under.appendChild(slot);
    } else if (slot.parentNode !== home) {
      home.appendChild(slot);
    }
  }
  window.shortStayPlaceLeadCard = placeLeadCard;

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
    var narrow = window.matchMedia ? window.matchMedia('(max-width: 767px)').matches : false;
    return '<div class="st-opt st-opt-grid"><div class="st-opt-wrap">'
      + '<header class="st-opt-intro"><h1>short stays</h1>'
      + '<p>Apartments, cottages and guest houses by the night, found online across Uganda.</p></header>'
      + searchFields(helpers, 'is-pill')
      + aggregatorNotice(helpers)
      + (narrow ? '' : '<div id="st-ai-slot"></div>')
      + '<div class="st-opt-tools"><div class="st-count" id="st-count">' + helpers.esc(helpers.t('loading')) + '</div><div class="st-opt-tools-end">'
      + sortSelect(helpers)
      + mapButton(helpers)
      + '</div></div>'
      + '<div id="st-results"></div>'
      // On a phone Ask AI follows the stays, so the first stay is on screen.
      + (narrow ? '<div id="st-ai-slot"></div>' : '')
      + '<div id="st-lead-home"><div id="st-lead-slot"></div></div>'
      + safetyTips()
      + payLine(helpers)
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
    var ask = '<a class="st-opt-wa st-opt-ask" id="st-stay-ask" target="_blank" rel="noopener noreferrer" data-whatsapp-static="true">'
      + '<i class="fab fa-whatsapp"></i> Ask makaug.com about ' + helpers.esc(listing.reference || 'this stay') + '</a>';
    var note = '<p class="st-opt-found-note">This stay was found online. Contact the original poster to check availability and dates.</p>';
    if (/^https:\/\//i.test(source) && !/^https:\/\/media\.makaug\.com\//i.test(source)) {
      return '<p class="st-opt-found">Found online</p>' + note
        + '<a class="st-opt-source" href="' + helpers.esc(source) + '" target="_blank" rel="noopener noreferrer">See original post</a>'
        + ask;
    }
    return '<p class="st-opt-found">Found online</p>' + note
      + '<p class="st-opt-found-note">No original post is listed for this stay.</p>' + ask;
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

  // The message makaug.com's own WhatsApp opens with on a stay page: the stay
  // ref, its name and the dates typed in, so nobody has to ask which stay.
  function supportStayMessage(listing) {
    var fields = stayFields();
    var name = String((listing && listing.title) || 'a short stay').replace(/[\r\n"]/g, ' ').trim();
    var ref = String((listing && listing.reference) || '').trim();
    var text = 'Hi makaug.com, I am asking about short stay ' + (ref ? ref + ' (' + name + ')' : '"' + name + '"') + '.';
    var from = prettyStayDate(fields.checkIn, false);
    var to = prettyStayDate(fields.checkOut, true);
    var nights = from && to ? nightCount(fields.checkIn, fields.checkOut) : 0;
    var people = Number(fields.guests);
    if (from && to && nights > 0) text += ' Dates: ' + from + ' to ' + to + ' (' + nights + ' night' + (nights === 1 ? '' : 's') + ').';
    if (people > 0) text += ' Guests: ' + people + '.';
    text += ' Please help me check availability.';
    return text;
  }

  function shareLinksHtml(listing, helpers) {
    var url = stayPublicUrl(listing);
    var text = (listing.title || 'Short stay') + ' on makaug.com';
    var enc = encodeURIComponent;
    return '<div class="st-opt-share" aria-label="Share this stay">'
      + '<span>Share</span>'
      + '<a href="https://wa.me/?text=' + helpers.esc(enc(text + ': ' + url)) + '" target="_blank" rel="noopener noreferrer" data-whatsapp-static="true" aria-label="Share on WhatsApp"><i class="fab fa-whatsapp" aria-hidden="true"></i></a>'
      + '<a href="https://www.facebook.com/sharer/sharer.php?u=' + helpers.esc(enc(url)) + '" target="_blank" rel="noopener noreferrer" aria-label="Share on Facebook"><i class="fab fa-facebook-f" aria-hidden="true"></i></a>'
      + '<a href="https://x.com/intent/post?text=' + helpers.esc(enc(text)) + '&url=' + helpers.esc(enc(url)) + '" target="_blank" rel="noopener noreferrer" aria-label="Share on X"><i class="fab fa-x-twitter" aria-hidden="true"></i></a>'
      + '<button type="button" id="st-share-copy" data-url="' + helpers.esc(url) + '" aria-label="Copy link"><i class="fas fa-link" aria-hidden="true"></i> Copy link</button>'
      + '</div>';
  }

  var activeStay = null;
  window.shortStaySupportMessage = function () {
    if (!activeStay) return '';
    if (!/^\/short-term\/[^/]+$/.test(window.location.pathname || '')) return '';
    return supportStayMessage(activeStay);
  };

  function paintSupportLinks(listing) {
    activeStay = listing || null;
    var ask = document.getElementById('st-stay-ask');
    if (ask && typeof window.supportWhatsappUrl === 'function') {
      ask.href = window.supportWhatsappUrl({});
    } else if (ask && typeof supportWhatsappUrl === 'function') {
      ask.href = supportWhatsappUrl({}); // eslint-disable-line no-undef
    }
    var copy = document.getElementById('st-share-copy');
    if (copy && copy.getAttribute('data-bound') !== '1') {
      copy.setAttribute('data-bound', '1');
      copy.addEventListener('click', function () {
        var url = copy.getAttribute('data-url') || window.location.href;
        var done = function () { copy.innerHTML = '<i class="fas fa-check" aria-hidden="true"></i> Copied'; };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, done);
        else done();
      });
    }
    ['st-d-in', 'st-d-out', 'st-d-guests'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el && el.getAttribute('data-ask-bound') !== '1') {
        el.setAttribute('data-ask-bound', '1');
        el.addEventListener('change', function () { paintSupportLinks(activeStay); });
      }
    });
  }

  function paintStayLinks(listing) {
    paintSupportLinks(listing);
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
      [listing.max_guests || null, 'Guests'],
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
      + '<p class="st-opt-where">' + helpers.esc(whereText(listing)) + (specText(listing) ? ' · ' + helpers.esc(specText(listing)) : '') + '</p>'
      + shareLinksHtml(listing, helpers)
      + '</div></div>'
      + aggregatorNotice(helpers)
      + '<div class="st-opt-detaillayout">'
      + '<div>' + gallery
      + '<div class="st-opt-facts">' + facts + '</div>'
      + '<p class="st-opt-check">Check in from ' + helpers.esc(listing.check_in_from || '—')
      + ' · Check out by ' + helpers.esc(listing.check_out_by || '—') + '</p>'
      + '<div class="st-opt-prose">' + helpers.esc(listing.description || '') + '</div>'
      + '<div class="listing-map-col st-opt-detailmap"><div class="listing-map-shell">'
      + '<div id="map-short-term" class="map-h rounded-xl border border-gray-200 overflow-hidden"></div>'
      + '</div></div>'
      + safetyTips()
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
      setTimeout(placeLeadCard, 80);
    });
  }

  function syncMap(snapshot) {
    bindMapButton();
    placeLeadCard();
    var active = document.querySelector('.st-view.is-active') || document.getElementById('page-short-term');
    document.querySelectorAll('[id="map-short-term"]').forEach(function (node) {
      if (active && !active.contains(node)) node.removeAttribute('id');
    });
    if (!document.getElementById('map-short-term') || typeof window.mountSharedListingMap !== 'function') return;
    Promise.resolve(window.mountSharedListingMap('map-short-term', pinsFrom(snapshot))).then(function () {
      if (typeof window.syncListingMapToggle === 'function') window.syncListingMapToggle();
    }).catch(function () {});
  }

  if (typeof window.addEventListener === 'function') window.addEventListener('resize', function () { placeLeadCard(); });
  if (typeof MutationObserver === 'function' && typeof document !== 'undefined' && document.body) new MutationObserver(function () { placeLeadCard(); }).observe(document.body, { attributes: true, attributeFilter: ['class'] });

  window.makaugShortTermOptions = {
    searchHtml: searchHtml,
    paintResults: paintResults,
    detailHtml: detailHtml,
    syncMap: syncMap,
    paintStayLinks: paintStayLinks,
    stayMessage: stayMessage
  };
})();
