/* makaug Short Term stays - staff and King review desks
 *
 * Deliberately a SEPARATE asset from assets/short-term.js.
 *
 * The desks only exist in the DOM on the staff and admin dashboards, which are
 * protected routes; publicHtmlSanitizer strips those page containers out of
 * every public response. So this file loads only where the queue elements are
 * actually present, and a guest searching for a place in Kampala never
 * downloads a byte of it. That matters on mobile data.
 *
 * Two desks, one per gate:
 *   #staff-short-term-queue       a moderator screens and hands on
 *   #admin-short-term-king-queue  the King confirms the facts and publishes
 */
(function () {
  'use strict';

  if (window.__makaugShortTermDeskLoaded) return;
  window.__makaugShortTermDeskLoaded = true;

  var API = '/api/short-term';
  var desks = {
    staff: { stage: 'submitted', counts: {}, listings: [], open: {} },
    king: { stage: 'king_review', counts: {}, listings: [], open: {} }
  };

  function deskState(which) {
    return desks[which === 'king' ? 'king' : 'staff'];
  }

  // Found-online stays are flagged do_not_message. The desk labels them and
  // never offers a message, a pay link, or WhatsApp for them.
  function isFoundOnline(row) {
    if (!row) return false;
    if (row.source === 'imported' || row.found_online_label) return true;
    var flag = row.do_not_message;
    if (flag === true || flag === 'true' || flag === 't' || flag === '1' || flag === 'yes') return true;
    var extra = row.extra_fields;
    if (typeof extra === 'string') {
      try { extra = JSON.parse(extra); } catch (e) { extra = null; }
    }
    if (extra && typeof extra === 'object') {
      if (extra.found_online_label) return true;
      var nested = extra.do_not_message;
      if (nested === true || nested === 'true' || nested === 't' || nested === '1' || nested === 'yes') return true;
    }
    return false;
  }

  function allowsHostMessage(row) {
    return !isFoundOnline(row);
  }

  function foundOnlineBadge(row) {
    return isFoundOnline(row) ? '<span class="st-desk-found">Found online</span>' : '';
  }

  function findListing(id) {
    var wanted = String(id);
    var groups = [desks.staff.listings, desks.king.listings];
    for (var g = 0; g < groups.length; g += 1) {
      var rows = groups[g] || [];
      for (var i = 0; i < rows.length; i += 1) {
        if (String(rows[i].id) === wanted) return rows[i];
      }
    }
    return null;
  }

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
    var headers = Object.assign({ Accept: 'application/json' }, opts.body ? { 'Content-Type': 'application/json' } : {});
    // Cookie auth covers both moderators and the King. An admin API key is
    // added only if the main bundle happens to have one to hand.
    if (window.adminApiKey) headers['x-api-key'] = window.adminApiKey;
    return fetch(API + path, {
      method: opts.method || 'GET',
      credentials: 'same-origin',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (payload) {
        if (!res.ok || payload.ok === false) {
          var err = new Error(payload.error || 'Request failed');
          err.details = payload.details || [];
          err.status = res.status;
          throw err;
        }
        return payload;
      });
    });
  }

  function deskHost(which) {
    return document.getElementById(which === 'king' ? 'admin-short-term-king-queue' : 'staff-short-term-queue');
  }

  var STAGE_LABELS = {
    submitted: 'New', staff_review: 'With a moderator', changes_requested: 'Changes asked',
    king_review: 'With the King', approved: 'Live', rejected: 'Rejected', suspended: 'Suspended'
  };

  function stageChipsHtml(counts, active, which) {
    var order = which === 'king'
      ? ['king_review', 'approved', 'suspended', 'rejected']
      : ['submitted', 'staff_review', 'changes_requested', 'king_review', 'approved', 'rejected'];
    return '<div class="st-desk-chips">' + order.map(function (stage) {
      return '<button type="button" class="st-desk-chip' + (stage === active ? ' is-on' : '') + '"'
        + ' data-st-desk-stage="' + stage + '" data-st-desk-which="' + which + '">'
        + esc(STAGE_LABELS[stage] || stage) + ' <b>' + (counts[stage] || 0) + '</b></button>';
    }).join('') + '</div>';
  }

  function checkRowsHtml(checks, checklist, listingId) {
    return '<div class="st-desk-checks">' + checks.map(function (check) {
      return '<label class="st-desk-check">'
        + '<input type="checkbox" data-st-check="' + esc(check.key) + '" data-st-listing="' + esc(listingId) + '"'
        + (checklist[check.key] === true ? ' checked' : '') + '>'
        + '<span>' + esc(check.label) + (check.overrideable ? ' <em>(can be waived)</em>' : '') + '</span>'
        + '</label>';
    }).join('') + '</div>';
  }

  function listingRowHtml(row, which) {
    var id = String(row.id);
    var photos = Number(row.photo_count || 0);
    var feeSettled = ['paid', 'waived'].indexOf(String(row.listing_fee_status)) !== -1;

    return '<article class="st-desk-row" data-st-row="' + esc(id) + '">'
      + '<div class="st-desk-head">'
      + (row.cover_url
        ? '<a class="st-desk-cover" href="' + esc(row.cover_url) + '" target="_blank" rel="noopener"><img src="' + esc(row.cover_url) + '" alt=""></a>'
        : '')
      + '<div>'
      + '<p class="st-desk-ref">' + esc(row.reference || '') + '</p>'
      + '<h4>' + esc(row.title || 'Untitled') + '</h4>'
      + '<p class="st-desk-meta">' + esc(row.area || '') + ', ' + esc(row.district || '')
      + ' &middot; ' + esc(Number(row.base_nightly_ugx) > 0 && !(row.extra_fields && row.extra_fields.price_on_application === true) ? ugx(row.base_nightly_ugx) + ' per night' : 'POA')
      + ' &middot; ' + esc(row.host_name || 'no host name')
      + (isFoundOnline(row) ? '' : (row.host_phone ? ' · ' + esc(row.host_phone) : '')) + '</p>'
      + '<p class="st-desk-flags">'
      + foundOnlineBadge(row)
      + (photos
        ? '<span class="st-desk-ok"><i class="fas fa-image"></i> ' + photos + ' photos</span>'
        : '<span class="st-desk-warn"><i class="fas fa-triangle-exclamation"></i> No photos</span>')
      + (feeSettled
        ? '<span class="st-desk-ok"><i class="fas fa-coins"></i> Fee ' + esc(row.listing_fee_status) + '</span>'
        : '<span class="st-desk-warn"><i class="fas fa-coins"></i> '
          + (row.moderation_stage === 'approved' ? 'Approved, awaiting the UGX 20,000 monthly fee for a non-agent host. No free days. Agent-plan short stays are included.' : 'Fee ' + esc(row.listing_fee_status))
          + '</span>')
      + (row.right_to_let_declared
        ? '<span class="st-desk-ok"><i class="fas fa-file-signature"></i> Right to let declared</span>'
        : '<span class="st-desk-warn"><i class="fas fa-file-signature"></i> No right-to-let declaration</span>')
      + (row.king_facts_confirmed ? '<span class="st-desk-ok"><i class="fas fa-crown"></i> King confirmed</span>' : '')
      + (row.source === 'imported' || row.found_online_label
        ? '<span class="st-desk-warn"><i class="fas fa-globe"></i> Found online. Do not message.</span>'
        : '')
      + (row.listed_via === 'staff_assisted'
        ? '<span class="st-desk-warn"><i class="fas fa-user-pen"></i> Entered by '
          + esc(row.entered_by_staff_name || 'staff') + '</span>'
        : '')
      + (row.referral_code ? '<span class="st-desk-ok"><i class="fas fa-tag"></i> ' + esc(row.referral_code) + '</span>' : '')
      + '</p></div>'
      + '<button type="button" class="st-btn" data-st-desk-open="' + esc(id) + '" data-st-desk-which="' + which + '">'
      + (deskState(which).open[id] ? 'Close' : 'Open') + '</button>'
      + '</div>'
      + (deskState(which).open[id] ? '<div class="st-desk-body" data-st-desk-body="' + esc(id) + '">Loading the review sheet…</div>' : '')
      + '</article>';
  }

  function renderDesk(which) {
    var host = deskHost(which);
    var desk = deskState(which);
    if (!host) return;
    host.innerHTML = stageChipsHtml(desk.counts, desk.stage, which)
      + (desk.listings.length
        ? desk.listings.map(function (row) { return listingRowHtml(row, which); }).join('')
        : '<p class="st-desk-empty">Nothing at this stage.</p>');
  }

  function loadDesk(which, stage) {
    var host = deskHost(which);
    var desk = deskState(which);
    if (!host) return Promise.resolve();
    desk.stage = stage || (which === 'king' ? 'king_review' : 'submitted');
    host.innerHTML = '<p class="st-desk-empty">Loading…</p>';
    return api('/staff/queue?stage=' + encodeURIComponent(desk.stage)).then(function (payload) {
      desk.listings = payload.listings || [];
      desk.counts = payload.counts || {};
      if (which !== 'king') {
        var stat = document.getElementById('staff-stat-short-term');
        if (stat) stat.textContent = String((payload.counts && payload.counts.submitted) || 0);
      }
      renderDesk(which);
    }).catch(function (error) {
      host.innerHTML = '<p class="st-desk-empty st-desk-warn">'
        + esc(error.status === 401 || error.status === 403
          ? (which === 'king'
            ? 'King review needs an admin account. Sign in as admin to open this queue.'
            : 'Sign in with a staff account to open this queue.')
          : error.message) + '</p>';
    });
  }

  function photosHtml(photos) {
    var list = photos || [];
    if (!list.length) return '<p class="st-desk-warn">No photos on this stay yet.</p>';
    return '<div class="st-desk-photos">' + list.map(function (photo) {
      var url = esc(photo.url || '');
      return '<a href="' + url + '" target="_blank" rel="noopener"><img src="' + url + '" alt="' + esc(photo.caption || 'Short stay photo') + '"></a>';
    }).join('') + '</div>';
  }

  function factField(id, key, label, value, kind) {
    var common = ' data-st-fact="' + esc(key) + '" data-st-listing="' + esc(id) + '"';
    var control;
    if (kind === 'area') {
      control = '<textarea class="st-input" style="min-height:72px"' + common + '>' + esc(value || '') + '</textarea>';
    } else if (kind === 'place') {
      control = '<select class="st-input"' + common + '>'
        + [['entire_place', 'Entire place'], ['private_room', 'Private room'], ['shared_room', 'Shared room']].map(function (opt) {
          return '<option value="' + opt[0] + '"' + (String(value || '') === opt[0] ? ' selected' : '') + '>' + esc(opt[1]) + '</option>';
        }).join('') + '</select>';
    } else {
      control = '<input class="st-input" type="' + (kind || 'text') + '"' + common + ' value="' + esc(value == null ? '' : value) + '">';
    }
    return '<div' + (kind === 'area' ? ' style="grid-column:1/-1"' : '') + '>'
      + '<label class="st-label">' + esc(label) + '</label>' + control + '</div>';
  }

  function factsFormHtml(id, listing) {
    var l = listing || {};
    return '<h5 style="margin-top:14px">Facts</h5>'
      + '<div class="st-form-grid">'
      + factField(id, 'title', 'Title', l.title, 'text')
      + factField(id, 'district', 'District', l.district, 'text')
      + factField(id, 'area', 'Area', l.area, 'text')
      + factField(id, 'place_type', 'Type of place', l.place_type, 'place')
      + factField(id, 'property_type', 'Property type', l.property_type, 'text')
      + factField(id, 'base_nightly_ugx', 'Per night (UGX), blank for POA', (l.extra_fields && l.extra_fields.price_on_application === true) ? '' : l.base_nightly_ugx, 'number')
      + factField(id, 'cleaning_fee_ugx', 'Cleaning fee (UGX)', l.cleaning_fee_ugx, 'number')
      + factField(id, 'min_nights', 'Minimum nights', l.min_nights, 'number')
      + factField(id, 'bedrooms', 'Bedrooms', l.bedrooms, 'number')
      + factField(id, 'beds', 'Beds', l.beds, 'number')
      + factField(id, 'bathrooms', 'Bathrooms', l.bathrooms, 'number')
      + factField(id, 'max_guests', 'Sleeps', l.max_guests, 'number')
      + factField(id, 'host_name', 'Host name', l.host_name, 'text')
      + factField(id, 'host_phone', 'Phone', l.host_phone, 'text')
      + factField(id, 'address', 'Address', l.address, 'text')
      + factField(id, 'description', 'Description', l.description, 'area')
      + factField(id, 'house_rules', 'House rules', l.house_rules, 'area')
      + '</div>'
      + '<div class="st-desk-buttons">'
      + '<button type="button" class="st-btn st-btn-primary" data-st-save-facts="' + esc(id) + '" data-st-id="' + esc(id) + '" data-st-which="">Save facts</button>'
      + '</div>';
  }

  function staffActionsHtml(id, listing) {
    var askHost = allowsHostMessage(listing)
      ? '<button type="button" class="st-btn" data-st-staff="request_changes" data-st-id="' + esc(id) + '">Ask host for changes</button>'
      : '';
    return '<div class="st-desk-actions"><div class="st-desk-buttons">'
      + '<button type="button" class="st-btn st-btn-primary" data-st-staff="approve" data-st-id="' + esc(id) + '">Approve</button>'
      + '<button type="button" class="st-btn" data-st-staff="reject" data-st-id="' + esc(id) + '">Reject</button>'
      + '<button type="button" class="st-btn" data-st-staff="claim" data-st-id="' + esc(id) + '">' + (listing && listing.moderation_stage === 'rejected' ? 'Reopen' : 'Claim') + '</button>'
      + askHost
      + '</div>'
      + '<p class="st-desk-note">Approve puts this stay live now. A non-agent host gets the UGX 20,000 monthly pay link.'
      + (allowsHostMessage(listing) ? '' : ' Found online: nothing here messages the host.')
      + '</p></div>';
  }

  function kingActionsHtml(id, listing) {
    var feeNote = allowsHostMessage(listing)
      ? '<p class="st-desk-note">Approved, awaiting the UGX 20,000 monthly fee for a non-agent host. No free days. Agent-plan short stays are included. A pay link follows. The listing goes live when that fee is paid.</p>'
      : '<p class="st-desk-note">Found online. Approval does not message the host.</p>';
    return '<div class="st-desk-actions">'
      + '<label class="st-desk-confirm"><input type="checkbox" data-st-facts="' + esc(id) + '"> '
      + '<b>I have checked the facts on this listing myself.</b></label>'
      + '<div class="st-desk-buttons">'
      + '<button type="button" class="st-btn st-btn-primary" data-st-king="approve" data-st-id="' + esc(id) + '"><i class="fas fa-crown"></i> Approve</button>'
      + feeNote
      + '<button type="button" class="st-btn" data-st-king="send_back" data-st-id="' + esc(id) + '">Send back to staff</button>'
      + '<button type="button" class="st-btn" data-st-king="reject" data-st-id="' + esc(id) + '">Reject</button>'
      + '<button type="button" class="st-btn" data-st-king="suspend" data-st-id="' + esc(id) + '">Suspend</button>'
      + '</div></div>';
  }

  function renderReviewSheet(id, which, payload) {
    var body = document.querySelector('[data-st-desk-body="' + id + '"]');
    if (!body) return;
    var l = payload.listing;
    var outstanding = payload.outstanding || [];
    var canMessage = allowsHostMessage(l);
    var actions = which === 'king' ? kingActionsHtml(id, l) : staffActionsHtml(id, l);
    var payLink = canMessage && ['paid', 'waived'].indexOf(String(l.listing_fee_status)) === -1
      ? '<p class="st-desk-meta"><button type="button" class="st-btn" data-st-paylink="' + esc(id) + '"><i class="fas fa-credit-card"></i> Send host a pay link</button></p>'
      : '';

    body.innerHTML = '<div class="st-desk-sheet"><div>'
      + '<h5>Photos</h5>'
      + photosHtml(payload.photos)
      + factsFormHtml(id, l).replace('data-st-which=""', 'data-st-which="' + esc(which) + '"')
      + (which === 'king'
        ? '<h5 style="margin-top:14px">Review checks</h5>'
          + checkRowsHtml(payload.checks || [], payload.checklist || {}, id)
          + (outstanding.length
            ? '<p class="st-desk-warn"><i class="fas fa-list-check"></i> Still outstanding: '
              + outstanding.map(function (c) { return esc(c.label); }).join('; ') + '</p>'
            : '<p class="st-desk-ok"><i class="fas fa-check"></i> Every check is ticked.</p>')
        : '')
      + '<label class="st-label" style="margin-top:12px">'
      + (canMessage ? 'Reason / note for the host' : 'Reason (kept on the listing, not sent)')
      + '</label>'
      + '<textarea class="st-input" data-st-reason="' + esc(id) + '" style="min-height:64px"></textarea>'
      + actions
      + '<div data-st-desk-feedback="' + esc(id) + '"></div>'
      + '</div><div>'
      + '<h5>Where it is</h5>'
      + foundOnlineBadge(l)
      + '<p class="st-desk-meta"><b>' + esc(l.stage_label || l.moderation_stage) + '</b></p>'
      + '<p class="st-desk-meta">Photos: ' + esc(l.photo_count) + ' &middot; Fee: ' + esc(l.listing_fee_status) + '</p>'
      + payLink
      + (l.listed_via === 'staff_assisted'
        ? '<p class="st-desk-warn" style="display:block;margin:6px 0"><i class="fas fa-user-pen"></i> '
          + 'Entered by ' + esc(l.entered_by_staff_name || 'a colleague') + ', not by the host. '
          + 'The first gate was not an independent pair of eyes.</p>'
        : '')
      + (l.referral_code ? '<p class="st-desk-meta">Brought in by: ' + esc(l.referral_code) + '</p>' : '')
      + (l.acquisition_notes ? '<p class="st-desk-meta"><i>' + esc(l.acquisition_notes) + '</i></p>' : '')
      + (l.staff_reviewed_by ? '<p class="st-desk-meta">Screened by ' + esc(l.staff_reviewed_by) + '</p>' : '')
      + (l.king_reviewed_by ? '<p class="st-desk-meta">King: ' + esc(l.king_reviewed_by) + '</p>' : '')
      + '<h5 style="margin-top:12px">History</h5>'
      + ((payload.history || []).length
        ? '<ul class="st-desk-history">' + payload.history.map(function (h) {
          return '<li><b>' + esc(h.action) + '</b> ' + esc(h.stage_from || '') + ' → ' + esc(h.stage_to || '')
            + '<span>' + esc(String(h.created_at).slice(0, 16).replace('T', ' ')) + ' &middot; ' + esc(h.actor_id || '') + '</span>'
            + (h.reason ? '<em>' + esc(h.reason) + '</em>' : '') + '</li>';
        }).join('') + '</ul>'
        : '<p class="st-desk-meta">Nothing yet.</p>')
      + '</div></div>';
  }

  function openReviewSheet(id, which) {
    var desk = deskState(which);
    desk.open[id] = !desk.open[id];
    renderDesk(which);
    if (!desk.open[id]) return;
    api('/staff/listings/' + encodeURIComponent(id) + '/review')
      .then(function (payload) {
        var row = findListing(id);
        if (row && payload.listing) row.do_not_message = payload.listing.do_not_message === true;
        renderReviewSheet(id, which, payload);
      })
      .catch(function (error) {
        var body = document.querySelector('[data-st-desk-body="' + id + '"]');
        if (body) body.innerHTML = '<p class="st-desk-warn">' + esc(error.message) + '</p>';
      });
  }

  function collectChecklist(id) {
    var out = {};
    Array.prototype.forEach.call(
      document.querySelectorAll('[data-st-check][data-st-listing="' + id + '"]'),
      function (input) { out[input.getAttribute('data-st-check')] = input.checked; }
    );
    return out;
  }

  function showError(id, error) {
    var feedback = document.querySelector('[data-st-desk-feedback="' + id + '"]');
    if (!feedback) return;
    var lines = (error.details && error.details.length) ? error.details : [error.message];
    feedback.innerHTML = '<ul class="st-errors">'
      + lines.map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('') + '</ul>';
  }

  function runAction(id, which, action) {
    var reasonEl = document.querySelector('[data-st-reason="' + id + '"]');
    var body = { action: action, checklist: collectChecklist(id), reason: reasonEl ? reasonEl.value : '' };
    if (which === 'king') {
      var facts = document.querySelector('[data-st-facts="' + id + '"]');
      body.facts_confirmed = Boolean(facts && facts.checked);
    }
    var path = '/staff/listings/' + encodeURIComponent(id) + '/' + (which === 'king' ? 'king-decision' : 'decision');

    return api(path, { method: 'POST', body: body }).then(function (payload) {
      deskState(which).open[id] = false;
      if (typeof window.toast === 'function') {
        window.toast(payload.note || ('Moved to ' + ((payload.listing && payload.listing.moderation_stage) || 'the next stage')));
      }
      return loadDesk(which, deskState(which).stage);
    }).catch(function (error) { showError(id, error); });
  }

  function collectFacts(id) {
    var out = {};
    Array.prototype.forEach.call(
      document.querySelectorAll('[data-st-fact][data-st-listing="' + id + '"]'),
      function (input) { out[input.getAttribute('data-st-fact')] = input.value; }
    );
    return out;
  }

  function saveFacts(id, which) {
    var btn = document.querySelector('[data-st-save-facts="' + id + '"]');
    if (btn) btn.disabled = true;
    return api('/staff/listings/' + encodeURIComponent(id) + '/facts', { method: 'POST', body: collectFacts(id) })
      .then(function () {
        var row = findListing(id);
        return api('/staff/listings/' + encodeURIComponent(id) + '/review').then(function (payload) {
          if (row && payload.listing) {
            row.title = payload.listing.title;
            row.area = payload.listing.area;
            row.district = payload.listing.district;
            row.base_nightly_ugx = payload.listing.base_nightly_ugx;
            if (payload.listing.extra_fields) row.extra_fields = payload.listing.extra_fields;
            row.host_name = payload.listing.host_name;
            row.host_phone = payload.listing.host_phone;
            row.do_not_message = payload.listing.do_not_message === true;
          }
          renderDesk(which);
          renderReviewSheet(id, which, payload);
          var feedback = document.querySelector('[data-st-desk-feedback="' + id + '"]');
          if (feedback) feedback.innerHTML = '<p class="st-desk-ok">Facts saved.</p>';
        });
      })
      .catch(function (error) {
        if (btn) btn.disabled = false;
        showError(id, error);
      });
  }


  // ---------------------------------------------------------------- staff intake
  //
  // For sitting with a host and entering the place for them. That is how this
  // section gets its first hundred listings - not by hoping landlords fill in
  // a four step form on a phone for a site they have not heard of.
  //
  // Everything entered here goes through the SAME two gates. The listing is
  // flagged staff_assisted so the King can see at the final gate that a
  // colleague typed it rather than a host, and because King review is
  // admin-only a moderator cannot enter a listing and then wave it through
  // themselves.

  function intakeField(id, label, opts) {
    var o = opts || {};
    var input = o.type === 'textarea'
      ? '<textarea class="st-input" id="' + id + '" style="min-height:' + (o.height || 70) + 'px"'
        + (o.placeholder ? ' placeholder="' + esc(o.placeholder) + '"' : '') + '></textarea>'
      : o.type === 'select'
        ? '<select class="st-input" id="' + id + '">'
          + (o.options || []).map(function (opt) {
            return '<option value="' + esc(opt[0]) + '">' + esc(opt[1]) + '</option>';
          }).join('') + '</select>'
        : '<input class="st-input" id="' + id + '" type="' + (o.type || 'text') + '"'
          + (o.value != null ? ' value="' + esc(o.value) + '"' : '')
          + (o.min != null ? ' min="' + esc(o.min) + '"' : '')
          + (o.step ? ' step="' + esc(o.step) + '"' : '')
          + (o.placeholder ? ' placeholder="' + esc(o.placeholder) + '"' : '') + '>';
    return '<div' + (o.full ? ' style="grid-column:1/-1"' : '') + '>'
      + '<label class="st-label" for="' + id + '">' + esc(label) + '</label>' + input
      + (o.help ? '<p class="st-help">' + esc(o.help) + '</p>' : '')
      + '</div>';
  }

  function intakeFormHtml(meta) {
    var amenities = (meta && meta.amenities) || [];
    var payments = (meta && meta.payment_methods) || {};
    return '<div class="st-desk-intake">'
      + '<h4>Add a place for a host</h4>'
      + '<p class="st-desk-meta">Fill this in with the host in front of you, then take the photos on your phone. '
      + 'It goes into the same queue and still needs King approval before anyone sees it.</p>'

      + '<div class="st-form-grid" style="margin-top:12px">'
      + intakeField('i-title', 'Title', { full: true, placeholder: 'Quiet 2-bed apartment in Naguru' })
      + intakeField('i-district', 'District', { placeholder: 'Kampala' })
      + intakeField('i-area', 'Area', { placeholder: 'Naguru' })
      + intakeField('i-place', 'Type of place', { type: 'select', options: [
        ['entire_place', 'Entire place'], ['private_room', 'Private room'], ['shared_room', 'Shared room']
      ] })
      + intakeField('i-ptype', 'Property type', { placeholder: 'Apartment, cottage, guest house' })
      + intakeField('i-guests', 'Sleeps', { type: 'number', min: 1, value: 2 })
      + intakeField('i-bedrooms', 'Bedrooms', { type: 'number', min: 0, value: 1 })
      + intakeField('i-beds', 'Beds', { type: 'number', min: 1, value: 1 })
      + intakeField('i-bathrooms', 'Bathrooms', { type: 'number', min: 0, value: 1 })
      + intakeField('i-desc', 'Describe it', { full: true, type: 'textarea', height: 90,
        placeholder: 'What is it actually like? What is nearby? What should a guest know before arriving?' })
      + '</div>'

      + '<h5 style="margin-top:14px">Price</h5>'
      + '<div class="st-form-grid">'
      + intakeField('i-nightly', 'Per night (UGX)', { type: 'number', min: 1000, step: 1000, placeholder: '200000' })
      + intakeField('i-clean', 'Cleaning fee (UGX)', { type: 'number', min: 0, step: 1000, value: 0 })
      + intakeField('i-min', 'Minimum nights', { type: 'number', min: 1, value: 1 })
      + intakeField('i-pay', 'How the host wants paying', { type: 'select', options:
        [['', 'Choose one']].concat(Object.keys(payments).map(function (k) { return [k, payments[k]]; })) })
      + '</div>'

      + '<h5 style="margin-top:14px">The host</h5>'
      + '<div class="st-form-grid">'
      + intakeField('i-hname', 'Name guests ask for', {})
      + intakeField('i-hphone', 'Phone', { placeholder: '0780 863 394' })
      + intakeField('i-hwa', 'WhatsApp (if different)', {})
      + intakeField('i-htype', 'They are the', { type: 'select', options: [
        ['owner', 'Owner'], ['manager', 'Manager'], ['agent', 'Agent']
      ] })
      + '</div>'

      + '<h5 style="margin-top:14px">Amenities</h5>'
      + '<div class="st-amenity-pick">'
      + amenities.map(function (a) {
        return '<label><input type="checkbox" value="' + esc(a.slug) + '" data-i-amenity> ' + esc(a.label) + '</label>';
      }).join('')
      + '</div>'

      + '<div class="st-form-grid" style="margin-top:14px">'
      + intakeField('i-rules', 'House rules', { full: true, type: 'textarea',
        placeholder: 'No parties. No smoking indoors. Gate locked at midnight.' })
      + intakeField('i-ref', 'Who brought this host in', { placeholder: 'your name or code',
        help: 'Lets us count where supply is actually coming from.' })
      + intakeField('i-notes', 'Notes for the team', { placeholder: 'Where you met, what to follow up' })
      + '</div>'

      + '<div class="st-desk-confirm" style="margin-top:14px;display:block">'
      + '<p style="margin:0 0 8px"><b>You are recording what the host told you, not vouching for it yourself.</b></p>'
      + '<label class="st-desk-check"><input type="checkbox" id="i-right"> '
      + '<span>The host confirmed to me that they have the right to let this place out for short stays.</span></label>'
      + '<label class="st-desk-check"><input type="checkbox" id="i-terms"> '
      + '<span>I read the host the makaug listing terms and the fee, and they accepted.</span></label>'
      + '<label class="st-desk-check"><input type="checkbox" id="i-tax"> '
      + '<span>The host understands they are responsible for their own tax and any local hotel tax.</span></label>'
      + '</div>'

      + '<div data-st-intake-feedback></div>'
      + '<div class="st-desk-buttons" style="margin-top:12px">'
      + '<button type="button" class="st-btn st-btn-primary" id="st-intake-save"><i class="fas fa-plus"></i> Save and add photos</button>'
      + '<button type="button" class="st-btn" id="st-intake-cancel">Cancel</button>'
      + '</div>'
      + '</div>';
  }

  function intakeValue(id) {
    var el = document.getElementById(id);
    return el ? el.value : '';
  }

  function intakeChecked(id) {
    var el = document.getElementById(id);
    return !!(el && el.checked);
  }

  function submitIntake() {
    var feedback = document.querySelector('[data-st-intake-feedback]');
    var btn = document.getElementById('st-intake-save');
    if (btn) btn.disabled = true;

    return api('/staff/listings', {
      method: 'POST',
      body: {
        title: intakeValue('i-title'),
        description: intakeValue('i-desc'),
        district: intakeValue('i-district'),
        area: intakeValue('i-area'),
        place_type: intakeValue('i-place'),
        property_type: intakeValue('i-ptype'),
        max_guests: intakeValue('i-guests'),
        bedrooms: intakeValue('i-bedrooms'),
        beds: intakeValue('i-beds'),
        bathrooms: intakeValue('i-bathrooms'),
        base_nightly_ugx: intakeValue('i-nightly'),
        cleaning_fee_ugx: intakeValue('i-clean'),
        min_nights: intakeValue('i-min'),
        preferred_payment_method: intakeValue('i-pay'),
        host_name: intakeValue('i-hname'),
        host_phone: intakeValue('i-hphone'),
        host_whatsapp: intakeValue('i-hwa'),
        host_type: intakeValue('i-htype'),
        house_rules: intakeValue('i-rules'),
        referral_code: intakeValue('i-ref'),
        acquisition_notes: intakeValue('i-notes'),
        amenities: Array.prototype.slice.call(document.querySelectorAll('[data-i-amenity]:checked'))
          .map(function (el) { return el.value; }),
        right_to_let_declared: intakeChecked('i-right'),
        terms_accepted: intakeChecked('i-terms'),
        local_hotel_tax_ack: intakeChecked('i-tax')
      }
    }).then(function (out) {
      var host = document.getElementById('staff-short-term-intake');
      if (host) {
        host.innerHTML = '<div class="st-desk-intake"><div class="st-ok">'
          + '<b>Saved as ' + esc(out.listing.reference) + '.</b> It is in the queue at the submitted stage.'
          + '<p class="st-help" style="margin-top:6px">' + esc(out.next_step || '') + '</p>'
          + '<p class="st-help"><b>Add the photos now, while you are still with the host.</b> '
          + 'The King cannot approve a listing with no photos, so it will sit in the queue until they are on.</p>'
          + '</div></div>';
      }
      return loadDesk('staff', 'submitted');
    }).catch(function (error) {
      if (btn) btn.disabled = false;
      if (feedback) {
        var lines = (error.details && error.details.length) ? error.details : [error.message];
        feedback.innerHTML = '<ul class="st-errors">'
          + lines.map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('') + '</ul>';
        feedback.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  }

  function openIntake() {
    var host = document.getElementById('staff-short-term-intake');
    if (!host) return;
    if (host.innerHTML.trim()) { host.innerHTML = ''; return; }
    host.innerHTML = '<p class="st-desk-empty">Loading the form…</p>';
    api('/meta').then(function (meta) {
      host.innerHTML = intakeFormHtml(meta);
    }).catch(function () {
      host.innerHTML = intakeFormHtml(null);
    });
  }

  document.addEventListener('click', function (e) {
    if (!e.target.closest) return;

    var chip = e.target.closest('[data-st-desk-stage]');
    if (chip) {
      loadDesk(chip.getAttribute('data-st-desk-which'), chip.getAttribute('data-st-desk-stage'));
      return;
    }
    var saveBtn = e.target.closest('[data-st-save-facts]');
    if (saveBtn) {
      saveFacts(saveBtn.getAttribute('data-st-id'), saveBtn.getAttribute('data-st-which') || 'staff');
      return;
    }
    var payBtn = e.target.closest('[data-st-paylink]');
    if (payBtn) {
      var listingId = payBtn.getAttribute('data-st-paylink');
      if (!allowsHostMessage(findListing(listingId))) return;
      payBtn.disabled = true;
      api('/staff/listings/' + encodeURIComponent(listingId) + '/pay-link', { method: 'POST', body: {} })
        .then(function (r) {
          var st = r.sent && r.sent.status;
          payBtn.outerHTML = '<span class="st-desk-ok"><i class="fas fa-check"></i> '
            + (st === 'sent' || st === 'queued' || st === 'simulated' ? 'Pay link sent to the host on WhatsApp' : 'Pay link ready — WhatsApp ' + esc(st || 'not sent') + ': ' + esc(r.url))
            + '</span>';
        })
        .catch(function (err) {
          payBtn.disabled = false;
          window.alert(err.message || 'Could not send the pay link');
        });
      return;
    }
    var openBtn = e.target.closest('[data-st-desk-open]');
    if (openBtn) {
      openReviewSheet(openBtn.getAttribute('data-st-desk-open'), openBtn.getAttribute('data-st-desk-which'));
      return;
    }
    var staffBtn = e.target.closest('[data-st-staff]');
    if (staffBtn) {
      var staffId = staffBtn.getAttribute('data-st-id');
      var staffAction = staffBtn.getAttribute('data-st-staff');
      if (staffAction === 'request_changes' && !allowsHostMessage(findListing(staffId))) return;
      runAction(staffId, 'staff', staffAction);
      return;
    }
    var kingBtn = e.target.closest('[data-st-king]');
    if (kingBtn) {
      runAction(kingBtn.getAttribute('data-st-id'), 'king', kingBtn.getAttribute('data-st-king'));
      return;
    }
    if (e.target.closest('#st-intake-save')) { submitIntake(); return; }
    if (e.target.closest('#st-intake-cancel')) {
      var host = document.getElementById('staff-short-term-intake');
      if (host) host.innerHTML = '';
    }
  });

  window.makaugShortTermDesk = {
    intake: openIntake,
    load: loadDesk,
    reload: function (which) { return loadDesk(which || 'staff', deskState(which || 'staff').stage); }
  };

  if (deskHost('staff')) loadDesk('staff', 'submitted');
  if (deskHost('king')) loadDesk('king', 'king_review');
})();
