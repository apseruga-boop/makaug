'use strict';

// Closed loop for a short-stay date request.
//
// makaug records the request, tells the host, and tells the guest what the
// host decided. It does not take a payment, hold a deposit, or send a pay
// link for the stay. The host's listing fee is a separate makaug charge.
//
// WhatsApp goes out through the WAHA bridge queue (one message per event).
// Email is a copy when an address is known. The phone-text sender is not used.

const crypto = require('crypto');

const logger = require('../config/logger');
const { sendSupportEmail, getSupportEmail } = require('./emailService');
const {
  isWhatsappWebBridgeEnabled,
  queueWhatsappWebBridgeMessage
} = require('./whatsappWebBridgeService');
const {
  eachNight,
  isStayAvailable,
  normalisePhone,
  parseDate,
  searchShortTermListings
} = require('./shortTermService');

const STAY_REQUEST_MARKER = 'short-stay-booking-request-v1';
const REQUEST_TTL_MS = 24 * 60 * 60 * 1000;
const TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const HOST_PHOTO_TTL_MS = TOKEN_TTL_MS;
const ICAL_MIN_INTERVAL_MS = 60 * 60 * 1000;
const REFERENCE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const PAYMENT_LINE = 'Payment is agreed directly between you and the host. makaug does not take or hold payments.';

const SAFETY_TIPS = Object.freeze([
  'View the place and confirm who you are paying before you pay.',
  'Never pay into an account in a different name.',
  'Report a problem from the listing if something is wrong.'
]);

function stayError(message, status = 400, details) {
  const error = new Error(message);
  error.status = status;
  if (details) error.details = details;
  return error;
}

function tokenSecret() {
  return String(process.env.STAY_REQUEST_TOKEN_SECRET || process.env.JWT_SECRET || '').trim();
}

function publicBase() {
  return String(process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || 'https://makaug.com').replace(/\/+$/, '');
}

function isoDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const parsed = parseDate(String(value).slice(0, 10));
  return parsed || null;
}

function shiftIsoDate(iso, days) {
  const base = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) return null;
  return new Date(base.getTime() + days * 86400000).toISOString().slice(0, 10);
}

function phoneDigits(value) {
  return String(normalisePhone(value) || '').replace(/\D/g, '');
}

function makeReference() {
  const bytes = crypto.randomBytes(6);
  let out = 'MKS-';
  for (let i = 0; i < 6; i += 1) out += REFERENCE_ALPHABET[bytes[i] % REFERENCE_ALPHABET.length];
  return out;
}

function signStayToken(payload, secret = tokenSecret()) {
  if (!secret) throw stayError('Stay request links are not configured', 500);
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function readStayToken(token, secret = tokenSecret()) {
  const raw = String(token || '');
  const dot = raw.indexOf('.');
  if (dot < 1 || !secret) return null;
  const body = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload || typeof payload !== 'object') return null;
    if (!Number.isFinite(Number(payload.exp)) || Number(payload.exp) < Date.now()) return null;
    return payload;
  } catch (_error) {
    return null;
  }
}

function guestToken(reference, listingId, now = Date.now()) {
  return signStayToken({ v: 1, role: 'guest', ref: reference, listing_id: String(listingId), exp: now + TOKEN_TTL_MS });
}

function hostToken(listingId, now = Date.now()) {
  return signStayToken({ v: 1, role: 'host', listing_id: String(listingId), exp: now + TOKEN_TTL_MS });
}

function choiceFromReply(body) {
  const text = String(body || '').trim().toLowerCase();
  if (text === '1' || text === 'confirm') return 'accept';
  if (text === '2' || text === 'suggest' || text === 'suggest new time') return 'reschedule';
  if (text === '3' || text === "can't" || text === 'cant' || text === "can't do it" || text === 'decline') return 'decline';
  return null;
}

function stayActionLinks(reference, now = Date.now()) {
  const booking = require('./agentBookingService');
  return booking.issueStayLinks(reference, now);
}

function stayListingLinks(listingId, now = Date.now()) {
  const booking = require('./agentBookingService');
  return booking.issueStayListingLinks(listingId, now);
}

function blockedNightRange(checkIn, checkOut) {
  const nights = eachNight(isoDate(checkIn), isoDate(checkOut));
  if (!nights.length) return null;
  return { starts_on: nights[0], ends_on: nights[nights.length - 1] };
}

function channelsFor({ phone, email, bridgeEnabled }) {
  const hasPhone = Boolean(phoneDigits(phone));
  return {
    whatsapp: Boolean(hasPhone && bridgeEnabled),
    email: Boolean(String(email || '').trim()),
    staff_wa_link: Boolean(hasPhone && !bridgeEnabled)
  };
}

function stayWhenLine({ intent = 'dates', checkIn, checkOut, guests, message }) {
  if (intent === 'callback') return 'Callback request. No dates yet.';
  if (intent === 'question') return message ? `Question: ${String(message).slice(0, 400)}` : 'Question about this stay.';
  if (!checkIn || !checkOut) return 'Dates to be agreed.';
  return `${checkIn} to ${checkOut}, ${guests || 1} guest${Number(guests) === 1 ? '' : 's'}`;
}

function hostRequestMessage({
  reference, title, checkIn, checkOut, guests, hostLink, intent = 'dates',
  guestName, guestPhone, message, links
} = {}) {
  const lines = [
    `makaug stay request ${reference}`,
    title,
    stayWhenLine({ intent, checkIn, checkOut, guests, message }),
    guestName ? `Guest: ${guestName}` : '',
    guestPhone || '',
    '',
    'Please confirm within 1 hour. Reply 1 Confirm, 2 Suggest new time, 3 Can\'t do it',
    links?.confirm ? `1 Confirm: ${links.confirm}` : '',
    links?.reschedule ? `2 Suggest new time: ${links.reschedule}` : '',
    links?.decline ? `3 Can't do it: ${links.decline}` : '',
    hostLink || '',
    'Payment is agreed directly between you and the guest. makaug does not take or hold payments.'
  ];
  return lines.filter((line) => line !== '').join('\n');
}

function guestRequestMessage({ reference, statusUrl }) {
  return [
    `Request ${reference} is with the host. They have 24 hours to accept or decline.`,
    statusUrl,
    PAYMENT_LINE
  ].join('\n');
}

function guestDecisionMessage({ reference, accepted, statusUrl, hostPhone, address, checkInFrom, houseRules }) {
  if (!accepted) {
    return [
      `The host cannot take ${reference}. Similar places are on this page:`,
      statusUrl,
      PAYMENT_LINE
    ].join('\n');
  }
  return [
    `Accepted ${reference}.`,
    hostPhone ? `Host phone: ${hostPhone}` : '',
    address ? `Address: ${address}` : '',
    checkInFrom ? `Check in from ${checkInFrom}` : '',
    houseRules ? `House rules: ${houseRules}` : '',
    statusUrl,
    PAYMENT_LINE,
    ...SAFETY_TIPS
  ].filter(Boolean).join('\n');
}

function hostDecisionAck({ reference, accepted }) {
  return accepted
    ? `Accepted ${reference}. The guest has your phone and the address. ${PAYMENT_LINE}`
    : `Declined ${reference}. The guest has been told.`;
}

function expiryMessage({ reference, statusUrl }) {
  return [
    `Request ${reference} expired. The host did not reply within 24 hours.`,
    statusUrl,
    PAYMENT_LINE
  ].join('\n');
}

function reviewRequestMessage({ reference, statusUrl }) {
  return `How was your stay ${reference}? Leave a short review: ${statusUrl}`;
}

function staffWaLink(phone, text) {
  const digits = phoneDigits(phone);
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

async function deliverStayNotice({ phone, email, text, reference, event, role }, deps = {}) {
  const bridgeEnabled = deps.bridgeEnabled != null ? deps.bridgeEnabled : isWhatsappWebBridgeEnabled();
  const queue = deps.queueWhatsappWebBridgeMessage || queueWhatsappWebBridgeMessage;
  const mail = deps.sendSupportEmail || sendSupportEmail;
  const plan = channelsFor({ phone, email, bridgeEnabled });
  const out = { whatsapp_queued: false, email_sent: false, staff_wa_link: null, event, role };

  if (plan.whatsapp) {
    await queue({
      recipient: normalisePhone(phone) || phone,
      text,
      source: 'short_stay_request',
      metadata: { stay_reference: reference, event, role }
    });
    out.whatsapp_queued = true;
  } else if (plan.staff_wa_link) {
    out.staff_wa_link = staffWaLink(phone, text);
  }

  if (plan.email) {
    const sent = await mail({
      to: String(email).trim(),
      subject: `makaug stay ${reference}`,
      text
    });
    out.email_sent = Boolean(sent && (sent.sent || sent.ok));
  }
  return out;
}

function publicRequestShape(row) {
  return {
    reference: row.reference,
    status: row.status,
    check_in: isoDate(row.check_in),
    check_out: isoDate(row.check_out),
    guests: row.party_size == null ? null : Number(row.party_size),
    title: row.title || null,
    area: row.area || null,
    district: row.district || null,
    expires_at: row.expires_at || null,
    payment_line: PAYMENT_LINE,
    safety_tips: SAFETY_TIPS.slice()
  };
}

function acceptedGuestShape(row) {
  const base = publicRequestShape(row);
  if (row.status !== 'accepted' && row.status !== 'completed') return base;
  return {
    ...base,
    host_name: row.host_name || null,
    host_phone: normalisePhone(row.host_phone) || null,
    host_whatsapp: normalisePhone(row.host_whatsapp || row.host_phone) || null,
    address: row.address || null,
    latitude: row.latitude == null ? null : Number(row.latitude),
    longitude: row.longitude == null ? null : Number(row.longitude),
    check_in_from: row.check_in_from || null,
    check_out_by: row.check_out_by || null,
    house_rules: row.house_rules || null
  };
}

async function loadListingForRequest(db, listingId) {
  const result = await db.query(
    `/* st-booking:load-listing */
     SELECT l.id, l.reference, l.slug, l.title, l.district, l.area, l.address,
            l.latitude, l.longitude, l.max_guests, l.min_nights, l.max_nights,
            l.base_nightly_ugx, l.host_name, l.host_phone, l.host_whatsapp, l.host_email,
            l.check_in_from, l.check_out_by, l.house_rules, l.status, l.moderation_stage,
            l.king_facts_confirmed, l.listing_fee_status,
            COALESCE(avail.items, '[]'::json) AS availability
     FROM st_listing l
     LEFT JOIN LATERAL (
       SELECT json_agg(json_build_object(
         'starts_on', to_char(v.starts_on, 'YYYY-MM-DD'),
         'ends_on', to_char(v.ends_on, 'YYYY-MM-DD'),
         'is_available', v.is_available
       )) AS items
       FROM st_availability v
       WHERE v.listing_id = l.id
     ) avail ON TRUE
     WHERE l.id = $1::uuid
     LIMIT 1`,
    [listingId]
  );
  return result.rows[0] || null;
}

function assertRequestInput(listing, payload) {
  const errors = [];
  const name = String(payload.guest_name || '').trim().slice(0, 120);
  const phone = String(payload.guest_phone || '').trim();
  const email = String(payload.guest_email || '').trim().slice(0, 200);
  const checkIn = isoDate(payload.check_in);
  const checkOut = isoDate(payload.check_out);
  const guests = Number(payload.guests || payload.party_size || 1);
  if (name.length < 2) errors.push('Add your name.');
  const intent = ['dates', 'callback', 'question'].includes(String(payload.intent || 'dates'))
    ? String(payload.intent || 'dates')
    : 'dates';
  if (!phoneDigits(phone) && !email.includes('@')) errors.push('Add a phone number or an email.');
  if (payload.terms_accepted !== true && payload.terms_accepted !== 'true') {
    errors.push('Tick the short stay terms before sending the request.');
  }
  if (intent === 'dates') {
    if (!checkIn || !checkOut || checkOut <= checkIn) errors.push('Choose a check-in and a later check-out.');
    if (!Number.isFinite(guests) || guests < 1) errors.push('Say how many guests.');
    if (listing && Number.isFinite(guests) && guests > Number(listing.max_guests || 0)) errors.push('That party is larger than this place allows.');
    if (checkIn && checkOut && listing) {
      const nights = eachNight(parseDate(checkIn), parseDate(checkOut)).length;
      if (nights < Number(listing.min_nights || 1)) errors.push('This place asks for a longer stay.');
      const stay = isStayAvailable(listing.availability || [], checkIn, checkOut);
      if (stay.available === false) errors.push('Those dates are not available.');
    }
  } else if (!phoneDigits(phone)) {
    errors.push('Add a phone number.');
  }
  if (errors.length) throw stayError(errors[0], 400, errors);
  return {
    name,
    phone: phone || null,
    email: email || null,
    checkIn: intent === 'dates' ? checkIn : null,
    checkOut: intent === 'dates' ? checkOut : null,
    guests: intent === 'dates' ? guests : (Number.isFinite(guests) ? guests : null),
    message: String(payload.message || '').trim().slice(0, 2000) || null,
    intent
  };
}

async function createBookingRequest(db, listingId, payload = {}, deps = {}) {
  const listing = await loadListingForRequest(db, listingId);
  if (!listing) throw stayError('Listing not found', 404);
  const liveFee = ['paid', 'waived'].includes(String(listing.listing_fee_status || ''));
  if (listing.status !== 'approved' || listing.moderation_stage !== 'approved' || listing.king_facts_confirmed !== true || !liveFee) {
    throw stayError('Listing not found', 404);
  }
  const value = assertRequestInput(listing, payload);
  const now = deps.now ? new Date(deps.now) : new Date();
  const expiresAt = new Date(now.getTime() + REQUEST_TTL_MS);
  const bookingTiming = require('./agentBookingService');
  const reminderAt = bookingTiming.reminderDueAt(now);
  const escalateAt = bookingTiming.escalateDueAt(now);
  let reference = '';
  let row = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    reference = makeReference();
    try {
      const inserted = await db.query(
        `/* st-booking:insert */
         INSERT INTO st_booking_request (
           reference, listing_id, guest_name, guest_phone, guest_email, party_size,
           check_in, check_out, message, status, expires_at, intent,
           reminder_due_at, escalate_due_at, language
         ) VALUES ($1,$2::uuid,$3,$4,$5,$6,$7::date,$8::date,$9,'requested',$10,$11,$12,$13,$14)
         RETURNING id, reference, status, expires_at, check_in, check_out, party_size`,
        [
          reference, listing.id, value.name, value.phone, value.email, value.guests,
          value.checkIn, value.checkOut, value.message, expiresAt, value.intent,
          reminderAt, escalateAt, String(payload.language || 'en').slice(0, 8)
        ]
      );
      row = inserted.rows[0];
      break;
    } catch (error) {
      if (error && error.code === '23505') continue;
      throw error;
    }
  }
  if (!row) throw stayError('Could not save the request', 500);

  const guestLinkToken = guestToken(row.reference, listing.id, now.getTime());
  const hostLinkToken = hostToken(listing.id, now.getTime());
  const statusUrl = `${publicBase()}/short-term/requests/${row.reference}?t=${encodeURIComponent(guestLinkToken)}`;
  const hostUrl = `${publicBase()}/short-term/host?t=${encodeURIComponent(hostLinkToken)}`;
  const actionLinks = stayActionLinks(row.reference, now.getTime());
  const hostText = hostRequestMessage({
    reference: row.reference,
    title: listing.title,
    checkIn: value.checkIn,
    checkOut: value.checkOut,
    guests: value.guests,
    hostLink: hostUrl,
    intent: value.intent,
    guestName: value.name,
    guestPhone: value.phone,
    message: value.message,
    links: actionLinks
  });
  const guestText = guestRequestMessage({ reference: row.reference, statusUrl });
  const deliver = deps.deliverStayNotice || deliverStayNotice;
  const hostNotice = await deliver({
    phone: listing.host_whatsapp || listing.host_phone,
    email: listing.host_email,
    text: hostText,
    reference: row.reference,
    event: 'requested',
    role: 'host'
  }, deps);
  await deliver({
    phone: value.phone,
    email: value.email,
    text: guestText,
    reference: row.reference,
    event: 'requested',
    role: 'guest'
  }, deps);
  if (hostNotice.staff_wa_link) {
    await db.query(
      `/* st-booking:staff-link */ UPDATE st_booking_request SET staff_wa_link = $2, updated_at = NOW() WHERE id = $1::uuid`,
      [row.id, hostNotice.staff_wa_link]
    );
  }
  const support = Object.prototype.hasOwnProperty.call(deps, 'supportEmail') ? deps.supportEmail : getSupportEmail();
  if (support) {
    await deliver({
      phone: null,
      email: support,
      text: `New stay request ${row.reference} for ${listing.title}. ${hostNotice.staff_wa_link || 'WhatsApp queued to the host.'}`,
      reference: row.reference,
      event: 'staff_new',
      role: 'staff'
    }, deps).catch((error) => {
      logger.warn('Stay request staff email failed', { marker: STAY_REQUEST_MARKER, message: error.message });
    });
  }

  return {
    reference: row.reference,
    status: 'requested',
    status_url: statusUrl,
    expires_at: row.expires_at,
    payment_line: PAYMENT_LINE,
    message: `Request ${row.reference} is with the host. They have 24 hours to accept or decline.`,
    whatsapp_configured: hostNotice.whatsapp_queued === true
  };
}

async function blockAcceptedDates(db, listingId, checkIn, checkOut, reference) {
  const range = blockedNightRange(checkIn, checkOut);
  if (!range) return;
  await db.query(
    `/* st-booking:block */
     INSERT INTO st_availability (listing_id, starts_on, ends_on, is_available, note, source)
     VALUES ($1::uuid, $2::date, $3::date, FALSE, $4, 'host')`,
    [listingId, range.starts_on, range.ends_on, `booked ${reference}`]
  );
}

async function loadRequestRow(db, reference) {
  const result = await db.query(
    `/* st-booking:load-request */
     SELECT r.*, l.title, l.slug, l.district, l.area, l.address, l.latitude, l.longitude,
            l.host_name, l.host_phone, l.host_whatsapp, l.host_email,
            l.check_in_from, l.check_out_by, l.house_rules
     FROM st_booking_request r
     JOIN st_listing l ON l.id = r.listing_id
     WHERE r.reference = $1
     LIMIT 1`,
    [reference]
  );
  return result.rows[0] || null;
}

async function decideRequest(db, row, decision, { via = 'link' } = {}, deps = {}) {
  if (!row) throw stayError('Request not found', 404);
  if (!['requested', 'reschedule', 'escalated', 'no_response'].includes(row.status)) {
    throw stayError('This request is no longer open', 409);
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await expireDueRequests(db, deps);
    throw stayError('This request has expired', 409);
  }
  const accepted = decision === 'accept';
  const status = accepted ? 'accepted' : 'declined';
  const updated = await db.query(
    `/* st-booking:decide */
     UPDATE st_booking_request
     SET status = $2,
         decided_via = $3,
         accepted_at = CASE WHEN $2 = 'accepted' THEN NOW() ELSE accepted_at END,
         declined_at = CASE WHEN $2 = 'declined' THEN NOW() ELSE declined_at END,
         updated_at = NOW()
     WHERE id = $1::uuid AND status IN ('requested', 'reschedule', 'escalated', 'no_response')
     RETURNING id, reference, status, listing_id, check_in, check_out, guest_phone, guest_email`,
    [row.id, status, via]
  );
  const saved = updated.rows[0];
  if (!saved) throw stayError('This request is no longer open', 409);
  if (accepted && row.check_in && row.check_out) {
    await blockAcceptedDates(db, row.listing_id, row.check_in, row.check_out, row.reference);
  }
  if (accepted) {
    await db.query(
      `/* st-booking:touch-confirmed */ UPDATE st_listing SET last_confirmed_at = NOW() WHERE id = $1::uuid`,
      [row.listing_id]
    ).catch(() => null);
  }

  const now = Date.now();
  const statusUrl = `${publicBase()}/short-term/requests/${row.reference}?t=${encodeURIComponent(guestToken(row.reference, row.listing_id, now))}`;
  const guestText = guestDecisionMessage({
    reference: row.reference,
    accepted,
    statusUrl,
    hostPhone: normalisePhone(row.host_phone),
    address: row.address,
    checkInFrom: row.check_in_from,
    houseRules: row.house_rules
  });
  const deliver = deps.deliverStayNotice || deliverStayNotice;
  await deliver({
    phone: row.guest_phone,
    email: row.guest_email,
    text: guestText,
    reference: row.reference,
    event: status,
    role: 'guest'
  }, deps);

  return {
    reference: row.reference,
    status,
    host_reply: hostDecisionAck({ reference: row.reference, accepted })
  };
}

async function findOpenRequestForHostPhone(db, phone) {
  const digits = phoneDigits(phone);
  if (!digits) return null;
  const result = await db.query(
    `/* st-booking:host-phone */
     SELECT r.*, l.title, l.address, l.host_phone, l.host_whatsapp, l.host_email,
            l.check_in_from, l.house_rules
     FROM st_booking_request r
     JOIN st_listing l ON l.id = r.listing_id
     WHERE r.status IN ('requested', 'reschedule', 'escalated', 'no_response')
       AND r.expires_at > NOW()
       AND (
         regexp_replace(COALESCE(l.host_phone, ''), '\\D', '', 'g') = $1
         OR regexp_replace(COALESCE(l.host_whatsapp, ''), '\\D', '', 'g') = $1
       )
     ORDER BY r.created_at DESC
     LIMIT 1`,
    [digits]
  );
  return result.rows[0] || null;
}

async function handleHostStayReply(db, { phone, body, dryRun = false } = {}, deps = {}) {
  const choice = choiceFromReply(body);
  if (!choice) return { handled: false };
  try {
    await expireDueRequests(db, deps);
    const row = await findOpenRequestForHostPhone(db, phone);
    if (!row) return { handled: false };
    if (choice === 'reschedule') {
      const links = stayActionLinks(row.reference);
      const message = `Open this link to suggest new dates: ${links.reschedule}`;
      if (!dryRun) {
        await db.query(
          `/* st-booking:reschedule */
           UPDATE st_booking_request
              SET status = 'reschedule', updated_at = NOW()
            WHERE id = $1::uuid
              AND status IN ('requested', 'reschedule', 'escalated', 'no_response')`,
          [row.id]
        );
      }
      return {
        handled: true,
        dry_run: Boolean(dryRun),
        message,
        request: { reference: row.reference, status: 'reschedule' }
      };
    }
    if (dryRun) {
      return {
        handled: true,
        dry_run: true,
        message: hostDecisionAck({ reference: row.reference, accepted: choice === 'accept' }),
        request: { reference: row.reference, status: choice === 'accept' ? 'accepted' : 'declined' }
      };
    }
    const decided = await decideRequest(db, row, choice, { via: 'whatsapp' }, deps);
    return { handled: true, message: decided.host_reply, request: { reference: decided.reference, status: decided.status } };
  } catch (error) {
    logger.warn('Stay request reply was not applied', { marker: STAY_REQUEST_MARKER, message: error.message });
    return { handled: false };
  }
}

async function guestRequestView(db, reference, token, deps = {}) {
  const claims = readStayToken(token);
  if (!claims || claims.role !== 'guest' || claims.ref !== reference) throw stayError('This link is not valid', 403);
  await sweepStayRequests(db, deps);
  const row = await loadRequestRow(db, reference);
  if (!row) throw stayError('Request not found', 404);
  const view = acceptedGuestShape(row);
  if (row.status === 'declined' || row.status === 'expired') {
    try {
      const found = await searchShortTermListings(db, { district: row.district, limit: 6 });
      view.similar = (found.listings || []).filter((item) => item.id !== String(row.listing_id)).slice(0, 4)
        .map((item) => ({ title: item.title, url: item.url, area: item.area, district: item.district, nightly_display: item.nightly_display }));
    } catch (_error) {
      view.similar = [];
    }
  }
  return view;
}

async function hostSession(db, token) {
  const claims = readStayToken(token);
  if (!claims || claims.role !== 'host' || !claims.listing_id) throw stayError('This link is not valid', 403);
  await sweepStayRequests(db);
  const listing = await loadListingForRequest(db, claims.listing_id);
  if (!listing) throw stayError('Listing not found', 404);
  const requests = await db.query(
    `/* st-booking:host-list */
     SELECT reference, status, check_in, check_out, party_size, guest_name, guest_phone, expires_at, created_at
     FROM st_booking_request
     WHERE listing_id = $1::uuid
     ORDER BY created_at DESC
     LIMIT 50`,
    [listing.id]
  );
  const feeds = await db.query(
    `/* st-booking:ical-list */ SELECT url, last_fetched_at, last_error FROM st_ical_subscription WHERE listing_id = $1::uuid`,
    [listing.id]
  );
  return {
    listing: {
      id: String(listing.id),
      reference: listing.reference,
      title: listing.title,
      area: listing.area,
      district: listing.district,
      address: listing.address || null,
      nightly_ugx: Number(listing.base_nightly_ugx || 0),
      check_in_from: listing.check_in_from,
      house_rules: listing.house_rules || null,
      availability: listing.availability || [],
      listing_fee_status: listing.listing_fee_status,
      fee_label: ['paid', 'waived'].includes(String(listing.listing_fee_status || ''))
        ? 'Live'
        : 'Approved, awaiting fee'
    },
    requests: requests.rows.map((row) => ({
      reference: row.reference,
      status: row.status,
      check_in: isoDate(row.check_in),
      check_out: isoDate(row.check_out),
      guests: row.party_size,
      guest_name: row.guest_name,
      guest_phone: row.guest_phone,
      expires_at: row.expires_at
    })),
    ical: feeds.rows,
    photo_ttl_ms: HOST_PHOTO_TTL_MS
  };
}

async function hostDecideByToken(db, reference, token, decision, deps = {}) {
  const claims = readStayToken(token);
  if (!claims || claims.role !== 'host') throw stayError('This link is not valid', 403);
  const row = await loadRequestRow(db, reference);
  if (!row || String(row.listing_id) !== String(claims.listing_id)) throw stayError('Request not found', 404);
  return decideRequest(db, row, decision, { via: 'link' }, deps);
}

async function updateHostPrice(db, token, nightlyUgx) {
  const claims = readStayToken(token);
  if (!claims || claims.role !== 'host') throw stayError('This link is not valid', 403);
  const amount = Number(nightlyUgx);
  if (!Number.isFinite(amount) || amount < 0) throw stayError('Enter the nightly price in UGX', 400);
  await db.query(
    `/* st-booking:price */ UPDATE st_listing SET base_nightly_ugx = $2, updated_at = NOW() WHERE id = $1::uuid`,
    [claims.listing_id, Math.round(amount)]
  );
  return { nightly_ugx: Math.round(amount) };
}

async function updateHostAvailability(db, token, { starts_on, ends_on, is_available }) {
  const claims = readStayToken(token);
  if (!claims || claims.role !== 'host') throw stayError('This link is not valid', 403);
  const start = isoDate(starts_on);
  const end = isoDate(ends_on);
  if (!start || !end || end < start) throw stayError('Choose a start and end date', 400);
  await db.query(
    `/* st-booking:availability */
     INSERT INTO st_availability (listing_id, starts_on, ends_on, is_available, note, source)
     VALUES ($1::uuid, $2::date, $3::date, $4, $5, 'host')`,
    [claims.listing_id, start, end, is_available !== false && is_available !== 'false', is_available === false || is_available === 'false' ? 'blocked by host' : 'open']
  );
  return { starts_on: start, ends_on: end, is_available: !(is_available === false || is_available === 'false') };
}

function assertPublicIcalUrl(raw) {
  let url;
  try { url = new URL(String(raw || '').trim()); } catch (_error) { throw stayError('Paste an https calendar link', 400); }
  if (url.protocol !== 'https:') throw stayError('Paste an https calendar link', 400);
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || /^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(host)) {
    throw stayError('That calendar link is not public', 400);
  }
  return url.toString();
}

function unfoldIcs(text) {
  return String(text || '').replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
}

function parseIcsEvents(text) {
  const events = [];
  const blocks = unfoldIcs(text).split('BEGIN:VEVENT').slice(1);
  for (const block of blocks) {
    const body = block.split('END:VEVENT')[0] || '';
    const start = (body.match(/^DTSTART(?:;[^:]*)?:(\d{8})/m) || [])[1];
    const end = (body.match(/^DTEND(?:;[^:]*)?:(\d{8})/m) || [])[1];
    if (!start) continue;
    const startsOn = `${start.slice(0, 4)}-${start.slice(4, 6)}-${start.slice(6, 8)}`;
    const endIso = end ? `${end.slice(0, 4)}-${end.slice(4, 6)}-${end.slice(6, 8)}` : startsOn;
    const inclusive = end && end !== start && parseDate(endIso)
      ? shiftIsoDate(endIso, -1)
      : startsOn;
    if (inclusive >= startsOn) events.push({ starts_on: startsOn, ends_on: inclusive });
  }
  return events;
}

function buildIcs(blocks = []) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//makaug//short-stay//EN', 'CALSCALE:GREGORIAN'];
  blocks.forEach((block, index) => {
    const start = String(block.starts_on || '').replace(/-/g, '');
    const endIso = parseDate(block.ends_on);
    const end = endIso ? String(shiftIsoDate(endIso, 1) || '').replace(/-/g, '') : start;
    if (!/^\d{8}$/.test(start)) return;
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:block-${index}-${start}@makaug.com`);
    lines.push(`DTSTART;VALUE=DATE:${start}`);
    lines.push(`DTEND;VALUE=DATE:${end}`);
    lines.push('SUMMARY:Blocked');
    lines.push('END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

async function saveIcalUrl(db, token, url) {
  const claims = readStayToken(token);
  if (!claims || claims.role !== 'host') throw stayError('This link is not valid', 403);
  const safe = assertPublicIcalUrl(url);
  await db.query(
    `/* st-booking:ical-save */
     INSERT INTO st_ical_subscription (listing_id, url)
     VALUES ($1::uuid, $2)
     ON CONFLICT (listing_id, url) DO UPDATE SET last_error = NULL`,
    [claims.listing_id, safe]
  );
  return refreshIcal(db, claims.listing_id, safe, { force: true });
}

async function refreshIcal(db, listingId, url, { force = false, fetchImpl = global.fetch } = {}) {
  const existing = await db.query(
    `/* st-booking:ical-one */ SELECT last_fetched_at FROM st_ical_subscription WHERE listing_id = $1::uuid AND url = $2`,
    [listingId, url]
  );
  const last = existing.rows[0] && existing.rows[0].last_fetched_at ? new Date(existing.rows[0].last_fetched_at).getTime() : 0;
  if (!force && last && (Date.now() - last) < ICAL_MIN_INTERVAL_MS) return { skipped: true };
  if (typeof fetchImpl !== 'function') throw stayError('Calendar fetch is unavailable', 500);
  const signal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(8000)
    : undefined;
  const response = await fetchImpl(url, { headers: { Accept: 'text/calendar' }, signal });
  if (!response.ok) throw stayError('The calendar link did not respond', 502);
  const text = await response.text();
  const events = parseIcsEvents(text).slice(0, 400);
  await db.query(
    `/* st-booking:ical-clear */ DELETE FROM st_availability WHERE listing_id = $1::uuid AND source = 'ical'`,
    [listingId]
  );
  for (const event of events) {
    await db.query(
      `/* st-booking:ical-block */
       INSERT INTO st_availability (listing_id, starts_on, ends_on, is_available, note, source)
       VALUES ($1::uuid, $2::date, $3::date, FALSE, 'imported calendar', 'ical')`,
      [listingId, event.starts_on, event.ends_on]
    );
  }
  await db.query(
    `/* st-booking:ical-stamp */ UPDATE st_ical_subscription SET last_fetched_at = NOW(), last_error = NULL WHERE listing_id = $1::uuid AND url = $2`,
    [listingId, url]
  );
  return { imported: events.length };
}

async function listingIcs(db, listingId) {
  const result = await db.query(
    `/* st-booking:ics */
     SELECT to_char(starts_on, 'YYYY-MM-DD') AS starts_on, to_char(ends_on, 'YYYY-MM-DD') AS ends_on
     FROM st_availability
     WHERE listing_id = $1::uuid AND is_available = FALSE
     ORDER BY starts_on`,
    [listingId]
  );
  return buildIcs(result.rows);
}

async function expireDueRequests(db, deps = {}) {
  const due = await db.query(
    `/* st-booking:expire */
     UPDATE st_booking_request
     SET status = 'expired', expired_at = NOW(), expiry_notified_at = NOW(), updated_at = NOW()
     WHERE status = 'requested' AND expires_at <= NOW() AND expiry_notified_at IS NULL
     RETURNING id, reference, listing_id, guest_phone, guest_email`
  );
  const deliver = deps.deliverStayNotice || deliverStayNotice;
  for (const row of due.rows) {
    const statusUrl = `${publicBase()}/short-term/requests/${row.reference}?t=${encodeURIComponent(guestToken(row.reference, row.listing_id))}`;
    await deliver({
      phone: row.guest_phone,
      email: row.guest_email,
      text: expiryMessage({ reference: row.reference, statusUrl }),
      reference: row.reference,
      event: 'expired',
      role: 'guest'
    }, deps).catch((error) => {
      logger.warn('Stay expiry notice failed', { marker: STAY_REQUEST_MARKER, message: error.message });
    });
    const support = Object.prototype.hasOwnProperty.call(deps, 'supportEmail') ? deps.supportEmail : getSupportEmail();
    if (support) {
      await deliver({
        phone: null,
        email: support,
        text: `Stay request ${row.reference} expired without a host reply.`,
        reference: row.reference,
        event: 'staff_expired',
        role: 'staff'
      }, deps).catch(() => null);
    }
  }
  return due.rows.length;
}

async function sweepStayRequests(db, deps = {}) {
  const expired = await expireDueRequests(db, deps);
  const done = await db.query(
    `/* st-booking:complete */
     UPDATE st_booking_request
     SET status = 'completed', completed_at = NOW(), updated_at = NOW()
     WHERE status = 'accepted' AND check_out < CURRENT_DATE
     RETURNING id`
  );
  const reviews = await db.query(
    `/* st-booking:review-due */
     SELECT reference, listing_id, guest_phone, guest_email
     FROM st_booking_request
     WHERE status = 'completed' AND review_requested_at IS NULL AND check_out < CURRENT_DATE
     LIMIT 20`
  );
  const deliver = deps.deliverStayNotice || deliverStayNotice;
  for (const row of reviews.rows) {
    const statusUrl = `${publicBase()}/short-term/requests/${row.reference}?t=${encodeURIComponent(guestToken(row.reference, row.listing_id))}`;
    await deliver({
      phone: row.guest_phone,
      email: row.guest_email,
      text: reviewRequestMessage({ reference: row.reference, statusUrl }),
      reference: row.reference,
      event: 'review',
      role: 'guest'
    }, deps).catch(() => null);
    await db.query(
      `/* st-booking:review-stamp */ UPDATE st_booking_request SET review_requested_at = NOW() WHERE reference = $1`,
      [row.reference]
    );
  }
  return { expired, completed: done.rows.length, review_requests: reviews.rows.length };
}

async function submitVerifiedReview(db, reference, token, payload = {}) {
  const claims = readStayToken(token);
  if (!claims || claims.role !== 'guest' || claims.ref !== reference) throw stayError('This link is not valid', 403);
  const row = await loadRequestRow(db, reference);
  if (!row || row.status !== 'completed') throw stayError('A verified stay review follows a completed stay', 409);
  const name = String(payload.reviewer_name || row.guest_name || '').trim().slice(0, 120);
  const rating = Number(payload.rating);
  const comment = String(payload.comment || '').trim().slice(0, 3000);
  if (name.length < 2) throw stayError('Add the name to show with your review', 400);
  if (rating < 1 || rating > 5) throw stayError('Score the place from 1 to 5', 400);
  if (comment.length < 8) throw stayError('Say a little about the stay', 400);
  const saved = await db.query(
    `/* st-booking:verified-review */
     INSERT INTO st_review (
       listing_id, reviewer_name, rating, comment, stayed_on, status, published_at, booking_request_id, verified_stay
     ) VALUES ($1::uuid,$2,$3,$4,$5::date,'published',NOW(),$6::uuid,TRUE)
     RETURNING id`,
    [row.listing_id, name, rating, comment, isoDate(row.check_out), row.id]
  );
  return { id: String(saved.rows[0].id), verified_stay: true, status: 'published' };
}

function escapeStayHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

function stayTokenPage({ title, body, lang = 'en', form = null }) {
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const booking = require('./agentBookingService');
  const say = (english) => (booking.phrase ? booking.phrase(lang, english) : english);
  const formHtml = form ? `
    <form method="post">
      <label>${escapeStayHtml(say('Check in'))}<input type="date" name="check_in" required value="${escapeStayHtml(form.checkIn || '')}"></label>
      <label>${escapeStayHtml(say('Check out'))}<input type="date" name="check_out" required value="${escapeStayHtml(form.checkOut || '')}"></label>
      <button type="submit">${escapeStayHtml(say(form.submit || 'Suggest new dates'))}</button>
    </form>` : '';
  return `<!DOCTYPE html>
<html lang="${escapeStayHtml(lang)}" dir="${dir}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeStayHtml(title)}</title>
<style>
  body { margin: 0; font-family: "Plus Jakarta Sans", system-ui, sans-serif; background: #f0fdf4; color: #14532d; }
  main { max-width: 32rem; margin: 2rem auto; background: #fff; border: 1px solid #bbf7d0; border-radius: 20px; padding: 1.25rem; }
  h1 { font-size: 1.35rem; margin: 0 0 .75rem; }
  label { display: grid; gap: .25rem; font-weight: 700; margin: .75rem 0; }
  input { border: 1px solid #bbf7d0; border-radius: 12px; padding: .7rem .8rem; font: inherit; }
  button { background: #15803d; color: #fff; border: 0; border-radius: 999px; padding: .8rem 1rem; font-weight: 800; width: 100%; }
</style></head>
<body><main><h1>${escapeStayHtml(title)}</h1><p>${escapeStayHtml(body)}</p>${formHtml}</main></body></html>`;
}

async function openStayToken(db, payload, { method = 'GET', purpose = '', body = {}, lang = 'en' } = {}, deps = {}) {
  const booking = require('./agentBookingService');
  const say = (english) => booking.phrase(lang, english);
  const action = String(payload.action || '');
  if (payload.stay_listing && ['still_available', 'under_offer', 'let_agreed', 'sold'].includes(action)) {
    if (!booking.shouldApplyOnOpen({ method, purpose, action })) {
      return {
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: stayTokenPage({ title: say('Still available for these dates?'), body: say('Open this link again to save the listing status.'), lang })
      };
    }
    const status = action === 'still_available' ? 'available' : action;
    await db.query(
      `/* st-booking:listing-status */
       UPDATE st_listing SET availability_status = $2, last_confirmed_at = NOW(), updated_at = NOW() WHERE id = $1::uuid`,
      [payload.stay_listing, status]
    );
    return {
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: stayTokenPage({ title: say('Saved.'), body: say('Saved.'), lang })
    };
  }
  const reference = String(payload.stay || '');
  const row = reference ? await loadRequestRow(db, reference) : null;
  if (!row) {
    return {
      status: 404,
      contentType: 'text/html; charset=utf-8',
      body: stayTokenPage({ title: say('This link has expired.'), body: say('Ask for a new link.'), lang })
    };
  }
  if (action === 'reschedule') {
    if (String(method).toUpperCase() === 'POST') {
      const checkIn = isoDate(body.check_in);
      const checkOut = isoDate(body.check_out);
      if (!checkIn || !checkOut || checkOut <= checkIn) {
        return {
          status: 400,
          contentType: 'text/html; charset=utf-8',
          body: stayTokenPage({
            title: say('Suggest new dates'),
            body: say('Choose a check-in and a later check-out.'),
            lang,
            form: { checkIn, checkOut, submit: 'Suggest new dates' }
          })
        };
      }
      await db.query(
        `/* st-booking:propose-dates */
         UPDATE st_booking_request
            SET status = 'reschedule', proposed_check_in = $2::date, proposed_check_out = $3::date, updated_at = NOW()
          WHERE id = $1::uuid`,
        [row.id, checkIn, checkOut]
      );
      const deliver = deps.deliverStayNotice || deliverStayNotice;
      await deliver({
        phone: row.guest_phone,
        email: row.guest_email,
        text: `The host suggests ${checkIn} to ${checkOut} for ${row.reference}.`,
        reference: row.reference,
        event: 'reschedule',
        role: 'guest'
      }, deps).catch(() => null);
      return {
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: stayTokenPage({ title: say('New time saved'), body: `${checkIn} to ${checkOut}`, lang })
      };
    }
    return {
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: stayTokenPage({
        title: say('Suggest new dates'),
        body: row.title || '',
        lang,
        form: { checkIn: isoDate(row.check_in), checkOut: isoDate(row.check_out), submit: 'Suggest new dates' }
      })
    };
  }
  if (!booking.shouldApplyOnOpen({ method, purpose, action })) {
    return {
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: stayTokenPage({ title: say('Still available for these dates?'), body: row.title || '', lang })
    };
  }
  if (action !== 'confirm' && action !== 'decline') {
    return {
      status: 400,
      contentType: 'text/html; charset=utf-8',
      body: stayTokenPage({ title: say('This link has expired.'), body: say('Ask for a new link.'), lang })
    };
  }
  try {
    const decided = await decideRequest(db, row, action === 'confirm' ? 'accept' : 'decline', { via: 'link' }, deps);
    return {
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: stayTokenPage({ title: say('Saved.'), body: decided.host_reply, lang })
    };
  } catch (error) {
    return {
      status: error.status || 409,
      contentType: 'text/html; charset=utf-8',
      body: stayTokenPage({ title: say('This request is already closed.'), body: error.message, lang })
    };
  }
}

function stayCheckInInstant(iso) {
  const day = isoDate(iso);
  if (!day) return null;
  return new Date(`${day}T11:00:00.000Z`);
}

async function sweepStayReplyLoop(db, now = new Date(), deps = {}) {
  const booking = require('./agentBookingService');
  const at = now instanceof Date ? now : new Date(now);
  const summary = { reminded: 0, escalated: 0, visitor_reminders: 0, weekly: 0, expired: 0 };
  const expired = await sweepStayRequests(db, deps).catch(() => ({ expired: 0 }));
  summary.expired = expired?.expired || 0;
  const due = await db.query(
    `/* st-booking:reply-due */
     SELECT r.*, l.title, l.host_phone, l.host_whatsapp, l.host_email, l.area, l.district
       FROM st_booking_request r
       JOIN st_listing l ON l.id = r.listing_id
      WHERE r.status IN ('requested', 'reschedule', 'accepted')
        AND r.created_at > NOW() - INTERVAL '21 days'
      ORDER BY r.created_at ASC
      LIMIT 200`
  );
  const deliver = deps.deliverStayNotice || deliverStayNotice;
  for (const row of due.rows) {
    if (row.status === 'requested' && !row.escalated_at && row.escalate_due_at && new Date(row.escalate_due_at) <= at) {
      await db.query(
        `/* st-booking:mark-escalated */
         UPDATE st_booking_request
            SET status = 'escalated', no_response_at = COALESCE(no_response_at, $2), escalated_at = $2, updated_at = NOW()
          WHERE id = $1::uuid AND status = 'requested'`,
        [row.id, at]
      );
      const text = [
        'A short stay request needs a person from MakaUG.',
        `${row.guest_name || 'A guest'} asked about ${row.title || 'a stay'}.`,
        stayWhenLine({ intent: row.intent, checkIn: isoDate(row.check_in), checkOut: isoDate(row.check_out), guests: row.party_size, message: row.message }),
        row.guest_phone ? `Call the guest: ${row.guest_phone}` : '',
        'The host has not replied.'
      ].filter(Boolean).join('\n');
      const targets = booking.escalationTargets();
      if (!targets.length) {
        await booking.flagStaff(db, { bookingId: null, listingId: null, kind: 'stay_escalation', message: `${row.reference}\n${text}` });
      } else {
        for (const target of targets) {
          await deliver({ phone: target, email: null, text, reference: row.reference, event: 'escalated', role: 'staff' }, deps);
        }
      }
      await deliver({
        phone: row.guest_phone,
        email: row.guest_email,
        text: `The host has not confirmed ${row.reference}. A MakaUG team member will call you.`,
        reference: row.reference,
        event: 'escalated',
        role: 'guest'
      }, deps).catch(() => null);
      summary.escalated += 1;
      continue;
    }
    if (row.status === 'requested' && !row.reminded_at && row.reminder_due_at && new Date(row.reminder_due_at) <= at) {
      await db.query(
        `/* st-booking:mark-reminded */ UPDATE st_booking_request SET reminded_at = $2, updated_at = NOW() WHERE id = $1::uuid`,
        [row.id, at]
      );
      const links = stayActionLinks(row.reference, at.getTime());
      await deliver({
        phone: row.host_whatsapp || row.host_phone,
        email: row.host_email,
        text: hostRequestMessage({
          reference: row.reference,
          title: row.title,
          checkIn: isoDate(row.check_in),
          checkOut: isoDate(row.check_out),
          guests: row.party_size,
          intent: row.intent || 'dates',
          guestName: row.guest_name,
          guestPhone: row.guest_phone,
          message: row.message,
          links
        }),
        reference: row.reference,
        event: 'reminder',
        role: 'host'
      }, deps);
      summary.reminded += 1;
    }
    if (row.status === 'accepted' && row.check_in) {
      const when = stayCheckInInstant(row.check_in);
      if (when && when > at) {
        const dayBefore = new Date(when.getTime() - 24 * 3600000);
        const twoHours = new Date(when.getTime() - 2 * 3600000);
        if (!row.visitor_reminder_24h_at && dayBefore <= at) {
          await db.query(
            `/* st-booking:remind-24 */ UPDATE st_booking_request SET visitor_reminder_24h_at = $2 WHERE id = $1::uuid`,
            [row.id, at]
          );
          await deliver({
            phone: row.guest_phone,
            email: row.guest_email,
            text: `Reminder: your stay ${row.reference} starts tomorrow (${isoDate(row.check_in)}).`,
            reference: row.reference,
            event: 'remind_24h',
            role: 'guest'
          }, deps).catch(() => null);
          summary.visitor_reminders += 1;
        }
        if (!row.visitor_reminder_2h_at && twoHours <= at) {
          await db.query(
            `/* st-booking:remind-2 */ UPDATE st_booking_request SET visitor_reminder_2h_at = $2 WHERE id = $1::uuid`,
            [row.id, at]
          );
          await deliver({
            phone: row.guest_phone,
            email: row.guest_email,
            text: `Reminder: your stay ${row.reference} starts in about 2 hours.`,
            reference: row.reference,
            event: 'remind_2h',
            role: 'guest'
          }, deps).catch(() => null);
          summary.visitor_reminders += 1;
        }
      }
    }
  }
  if (booking.shouldSendWeekly(at)) {
    const key = booking.weekKey(at);
    const listings = await db.query(
      `/* st-booking:weekly-listings */
       SELECT l.id, l.title, l.area, l.district, l.host_phone, l.host_whatsapp, l.host_email
         FROM st_listing l
        WHERE l.status = 'approved'
          AND l.moderation_stage = 'approved'
          AND l.king_facts_confirmed = TRUE
          AND l.listing_fee_status IN ('paid', 'waived')
          AND NOT EXISTS (
            SELECT 1 FROM st_availability_checkins c
             WHERE c.listing_id = l.id AND c.week_key = $1
          )
        LIMIT 40`,
      [key]
    );
    for (const listing of listings.rows) {
      const blocked = await db.query(
        `/* st-booking:weekly-blocked */
         SELECT to_char(starts_on, 'YYYY-MM-DD') AS starts_on, to_char(ends_on, 'YYYY-MM-DD') AS ends_on
           FROM st_availability
          WHERE listing_id = $1::uuid AND is_available = FALSE
          ORDER BY starts_on
          LIMIT 8`,
        [listing.id]
      );
      const links = stayListingLinks(listing.id, at.getTime());
      const lines = [
        'Still available for these dates?',
        listing.title,
        blocked.rows.length
          ? `Blocked dates: ${blocked.rows.map((item) => `${item.starts_on} to ${item.ends_on}`).join('; ')}`
          : 'Blocked dates: none on the calendar.',
        `Still available: ${links.still_available}`,
        `Under offer: ${links.under_offer}`,
        `Let agreed: ${links.let_agreed}`,
        `Sold: ${links.sold}`
      ];
      await deliver({
        phone: listing.host_whatsapp || listing.host_phone,
        email: listing.host_email,
        text: lines.join('\n'),
        reference: String(listing.id),
        event: 'weekly',
        role: 'host'
      }, deps);
      await db.query(
        `/* st-booking:weekly-mark */
         INSERT INTO st_availability_checkins (listing_id, week_key) VALUES ($1::uuid, $2)
         ON CONFLICT (listing_id, week_key) DO NOTHING`,
        [listing.id, key]
      );
      summary.weekly += 1;
    }
  }
  return summary;
}

async function listStaffRequests(db) {
  await sweepStayRequests(db).catch(() => null);
  const result = await db.query(
    `/* st-booking:staff */
     SELECT r.reference, r.status, r.check_in, r.check_out, r.guest_name, r.expires_at,
            r.staff_wa_link, r.created_at, l.reference AS listing_reference, l.title
     FROM st_booking_request r
     JOIN st_listing l ON l.id = r.listing_id
     ORDER BY r.created_at DESC
     LIMIT 200`
  );
  return result.rows;
}

module.exports = {
  HOST_PHOTO_TTL_MS,
  ICAL_MIN_INTERVAL_MS,
  PAYMENT_LINE,
  SAFETY_TIPS,
  STAY_REQUEST_MARKER,
  acceptedGuestShape,
  assertPublicIcalUrl,
  assertRequestInput,
  blockedNightRange,
  buildIcs,
  channelsFor,
  choiceFromReply,
  createBookingRequest,
  deliverStayNotice,
  expireDueRequests,
  guestDecisionMessage,
  guestRequestMessage,
  guestRequestView,
  guestToken,
  handleHostStayReply,
  hostDecisionAck,
  hostRequestMessage,
  hostSession,
  hostDecideByToken,
  hostToken,
  listingIcs,
  listStaffRequests,
  makeReference,
  parseIcsEvents,
  publicRequestShape,
  readStayToken,
  refreshIcal,
  saveIcalUrl,
  signStayToken,
  submitVerifiedReview,
  sweepStayRequests,
  sweepStayReplyLoop,
  openStayToken,
  stayWhenLine,
  updateHostAvailability,
  updateHostPrice
};
