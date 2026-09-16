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
  var state = { stage: 'submitted', counts: {}, listings: [], open: {} };

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
      + '<div class="st-desk-head"><div>'
      + '<p class="st-desk-ref">' + esc(row.reference || '') + '</p>'
      + '<h4>' + esc(row.title || 'Untitled') + '</h4>'
      + '<p class="st-desk-meta">' + esc(row.area || '') + ', ' + esc(row.district || '')
      + ' &middot; ' + esc(ugx(row.base_nightly_ugx)) + ' per night'
      + ' &middot; ' + esc(row.host_name || 'no host name') + ' ' + esc(row.host_phone || '') + '</p>'
      + '<p class="st-desk-flags">'
      + (photos
        ? '<span class="st-desk-ok"><i class="fas fa-image"></i> ' + photos + ' photos</span>'
        : '<span class="st-desk-warn"><i class="fas fa-triangle-exclamation"></i> No photos</span>')
      + (feeSettled
        ? '<span class="st-desk-ok"><i class="fas fa-coins"></i> Fee ' + esc(row.listing_fee_status) + '</span>'
        : '<span class="st-desk-warn"><i class="fas fa-coins"></i> Fee ' + esc(row.listing_fee_status) + '</span>')
      + (row.right_to_let_declared
        ? '<span class="st-desk-ok"><i class="fas fa-file-signature"></i> Right to let declared</span>'
        : '<span class="st-desk-warn"><i class="fas fa-file-signature"></i> No right-to-let declaration</span>')
      + (row.king_facts_confirmed ? '<span class="st-desk-ok"><i class="fas fa-crown"></i> King confirmed</span>' : '')
      + '</p></div>'
      + '<button type="button" class="st-btn" data-st-desk-open="' + esc(id) + '" data-st-desk-which="' + which + '">'
      + (state.open[id] ? 'Close' : 'Review') + '</button>'
      + '</div>'
      + (state.open[id] ? '<div class="st-desk-body" data-st-desk-body="' + esc(id) + '">Loading the review sheet…</div>' : '')
      + '</article>';
  }

  function renderDesk(which) {
    var host = deskHost(which);
    if (!host) return;
    host.innerHTML = stageChipsHtml(state.counts, state.stage, which)
      + (state.listings.length
        ? state.listings.map(function (row) { return listingRowHtml(row, which); }).join('')
        : '<p class="st-desk-empty">Nothing at this stage.</p>');
  }

  function loadDesk(which, stage) {
    var host = deskHost(which);
    if (!host) return Promise.resolve();
    state.stage = stage || (which === 'king' ? 'king_review' : 'submitted');
    host.innerHTML = '<p class="st-desk-empty">Loading…</p>';
    return api('/staff/queue?stage=' + encodeURIComponent(state.stage)).then(function (payload) {
      state.listings = payload.listings || [];
      state.counts = payload.counts || {};
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

  function renderReviewSheet(id, which, payload) {
    var body = document.querySelector('[data-st-desk-body="' + id + '"]');
    if (!body) return;
    var l = payload.listing;
    var outstanding = payload.outstanding || [];

    var actions = which === 'king'
      ? '<div class="st-desk-actions">'
        + '<label class="st-desk-confirm"><input type="checkbox" data-st-facts="' + esc(id) + '"> '
        + '<b>I have checked the facts on this listing myself.</b></label>'
        + '<div class="st-desk-buttons">'
        + '<button type="button" class="st-btn st-btn-primary" data-st-king="approve" data-st-id="' + esc(id) + '"><i class="fas fa-crown"></i> Approve and publish</button>'
        + '<button type="button" class="st-btn" data-st-king="send_back" data-st-id="' + esc(id) + '">Send back to staff</button>'
        + '<button type="button" class="st-btn" data-st-king="reject" data-st-id="' + esc(id) + '">Reject</button>'
        + '<button type="button" class="st-btn" data-st-king="suspend" data-st-id="' + esc(id) + '">Suspend</button>'
        + '</div></div>'
      : '<div class="st-desk-actions"><div class="st-desk-buttons">'
        + '<button type="button" class="st-btn st-btn-primary" data-st-staff="pass_to_king" data-st-id="' + esc(id) + '"><i class="fas fa-arrow-right"></i> Send to King review</button>'
        + '<button type="button" class="st-btn" data-st-staff="claim" data-st-id="' + esc(id) + '">Claim</button>'
        + '<button type="button" class="st-btn" data-st-staff="request_changes" data-st-id="' + esc(id) + '">Ask host for changes</button>'
        + '<button type="button" class="st-btn" data-st-staff="reject" data-st-id="' + esc(id) + '">Reject</button>'
        + '</div>'
        + '<p class="st-desk-note"><i class="fas fa-circle-info"></i> A moderator cannot publish a short stay. '
        + 'The most this desk can do is hand it to the King.</p></div>';

    body.innerHTML = '<div class="st-desk-sheet"><div>'
      + '<h5>Review checks</h5>'
      + checkRowsHtml(payload.checks || [], payload.checklist || {}, id)
      + (outstanding.length
        ? '<p class="st-desk-warn"><i class="fas fa-list-check"></i> Still outstanding: '
          + outstanding.map(function (c) { return esc(c.label); }).join('; ') + '</p>'
        : '<p class="st-desk-ok"><i class="fas fa-check"></i> Every check is ticked.</p>')
      + '<label class="st-label" style="margin-top:12px">Reason / note for the host</label>'
      + '<textarea class="st-input" data-st-reason="' + esc(id) + '" style="min-height:64px"></textarea>'
      + actions
      + '<div data-st-desk-feedback="' + esc(id) + '"></div>'
      + '</div><div>'
      + '<h5>Where it is</h5>'
      + '<p class="st-desk-meta"><b>' + esc(l.stage_label || l.moderation_stage) + '</b></p>'
      + '<p class="st-desk-meta">Photos: ' + esc(l.photo_count) + ' &middot; Fee: ' + esc(l.listing_fee_status) + '</p>'
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
    state.open[id] = !state.open[id];
    renderDesk(which);
    if (!state.open[id]) return;
    api('/staff/listings/' + encodeURIComponent(id) + '/review')
      .then(function (payload) { renderReviewSheet(id, which, payload); })
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
      state.open[id] = false;
      if (typeof window.toast === 'function') {
        window.toast(payload.note || ('Moved to ' + ((payload.listing && payload.listing.moderation_stage) || 'the next stage')));
      }
      return loadDesk(which, state.stage);
    }).catch(function (error) { showError(id, error); });
  }

  document.addEventListener('click', function (e) {
    if (!e.target.closest) return;

    var chip = e.target.closest('[data-st-desk-stage]');
    if (chip) {
      loadDesk(chip.getAttribute('data-st-desk-which'), chip.getAttribute('data-st-desk-stage'));
      return;
    }
    var openBtn = e.target.closest('[data-st-desk-open]');
    if (openBtn) {
      openReviewSheet(openBtn.getAttribute('data-st-desk-open'), openBtn.getAttribute('data-st-desk-which'));
      return;
    }
    var staffBtn = e.target.closest('[data-st-staff]');
    if (staffBtn) {
      runAction(staffBtn.getAttribute('data-st-id'), 'staff', staffBtn.getAttribute('data-st-staff'));
      return;
    }
    var kingBtn = e.target.closest('[data-st-king]');
    if (kingBtn) {
      runAction(kingBtn.getAttribute('data-st-id'), 'king', kingBtn.getAttribute('data-st-king'));
    }
  });

  window.makaugShortTermDesk = {
    load: loadDesk,
    reload: function (which) { return loadDesk(which || 'staff', state.stage); }
  };
})();
