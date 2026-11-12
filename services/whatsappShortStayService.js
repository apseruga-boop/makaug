'use strict';

/**
 * Listing a short stay on WhatsApp.
 *
 * Arthur, 10 Nov 2026: owners and agents list a short stay (a place let by the
 * night) on WhatsApp, and it reaches the Short stays review desk as the same
 * pending st_listing as /list-property?type=short_stay. Arthur, 12 Nov 2026:
 * "the process to add short terms should be the same as when they are listing
 * a property, but it's just a route for short term", and "the only ID we are
 * asking for is national ID".
 *
 * So these are the property listing's questions, in its order, with its
 * prompts and its photo checks (validateAndStoreListingPhotos and friends come
 * in from routes/whatsapp.js as `kit`). Only the end is different. ✚ marks what
 * a short stay adds:
 *
 *   owner or agent → title → district → area → bedrooms → ✚ guests →
 *   ✚ price a night (or POA) → description → ✚ house rules → photos →
 *   public name → contact number → National ID photo → NIN →
 *   ✚ right to let, terms and fee (AGREE) → the Short stays desk
 *
 * On AGREE, createShortTermListing makes the listing (with the ID, when one
 * was given), the photos already taken are copied in through attachListingPhoto
 * (re-encoded, GPS stripped), and staff are told, as for a property. Nothing
 * reaches the desk half-finished, and nothing the host sent is thrown away:
 * photos sent early are kept, an ID photo without a number still goes to staff.
 *
 * The ID never blocks: LATER skips it, the listing shows "ID still pending" and
 * the host gets the private 30-day link. An approved agent skips what makaug
 * already knows: owner or agent, name, number, and the ID when one is on file.
 */

const fs = require('fs');

const STEP = Object.freeze({
  pick: 'st_pick',
  ownership: 'st_ownership',
  title: 'st_title',
  district: 'st_district',
  area: 'st_area',
  bedrooms: 'st_bedrooms',
  guests: 'st_guests',
  price: 'st_price',
  description: 'st_description',
  rules: 'st_rules',
  photos: 'st_photos',
  name: 'st_name',
  contact: 'st_contact',
  phone: 'st_phone',
  idPhoto: 'st_id_photo',
  idNumber: 'st_id_number',
  terms: 'st_terms'
});
const STEPS = new Set(Object.values(STEP));
// Steps where an ID number may be typed. Their text is kept out of logs.
const ID_STEPS = new Set([STEP.idPhoto, STEP.idNumber]);
// Where a new conversation can begin: the same open steps the bot lets a
// language change happen in (shouldAdoptDetectedLanguage in routes/whatsapp.js).
const ENTRY_STEPS = new Set(['', 'greeting', 'choose_language', 'main_menu', 'missed_call_need', 'missed_call_resolved', 'submitted']);

// A flow left alone this long is dropped, so a message days later is answered
// as what it is rather than as an answer to an old question.
const STALE_MS = 24 * 60 * 60 * 1000;
const MAX_NIGHTLY_UGX = 50_000_000;
const ID_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

function clean(value, max = 500) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function siteUrl(env = process.env) {
  return String(env.PUBLIC_SITE_URL || env.SITE_URL || 'https://makaug.com').replace(/\/+$/, '');
}

function ugx(amount) {
  return `UGX ${Math.round(Number(amount) || 0).toLocaleString('en-US')}`;
}

function digits(value) {
  return String(value || '').replace(/\D+/g, '');
}

function isUgandanNumber(phone) {
  const d = digits(phone);
  return (d.length === 12 && d.startsWith('2567')) || (d.length === 10 && d.startsWith('07'));
}

// ---------------------------------------------------------------------------
// Reading what people type
// ---------------------------------------------------------------------------

const SHORT_STAY_WORDS = /\b(short[\s-]?(?:term\s+)?stays?|shortstays?|air\s?bnb|airbnbs?|bnb|by the night|per night|a night|nightly|holiday (?:home|let|rental)|vacation rental|serviced apartments?|guest ?house)\b|\/night\b/i;
// "List", "post", "advertise": the words of someone with a place to offer.
const LIST_VERBS = /\b(list|listing|post|posting|advertise|advertising|upload|register|put (?:it |my place |my house |my apartment )?(?:up|on))\b/i;
// "my apartment", "I have a guest house": a host talking about their own place.
const HOST_PLACE = /\b(?:my|our|have an?|own an?)\s+(?:[\w-]+\s+){0,3}(?:apartments?|house|home|place|flat|rooms?|air\s?bnb|airbnb|bnb|guest ?house|property|unit|villa|cottage|studio|bedsitter|short[\s-]?stays?)\b/i;
// A guest looking for somewhere to stay.
const GUEST_WORDS = /\b(budget|looking for|i need|we need|need an?|find me|book|booking|want to (?:stay|book|rent a)|stay (?:in|at|for)|check[\s-]?in|tonight|for \d+ nights?|vacant|available for)\b/i;

function normaliseCommand(text) {
  return clean(text, 80).toUpperCase().replace(/[^A-Z0-9 ]+/g, '').replace(/\s+/g, ' ').trim();
}

const isCancel = (text) => /^(CANCEL|STOP|EXIT|QUIT|MENU|HOME|BACK TO MENU|END)$/.test(normaliseCommand(text));
const isDone = (text) => /^(DONE|FINISH|FINISHED|THATS ALL|THAT IS ALL|NO MORE|COMPLETE|COMPLETED|OK DONE|ALL DONE|NEXT|CONTINUE)$/.test(normaliseCommand(text));
const isSkip = (text) => /^(SKIP|NONE|NO|NOPE|NA|N A|NIL|NOTHING|NO RULES|NONE FOR NOW)$/.test(normaliseCommand(text));
const isLater = (text) => /^(LATER|SEND LATER|NOT NOW|ILL SEND LATER|I WILL SEND LATER|TOMORROW|SKIP|NO ID|NO)$/.test(normaliseCommand(text));
// Not "1": nothing here is numbered, and a bare "1" is also how a host accepts a guest's booking.
const isYes = (text) => /^(YES|Y|YES I AGREE|I AGREE|AGREE|AGREED|ACCEPT|I ACCEPT|YES I CONFIRM|I CONFIRM|CONFIRM|CONFIRMED|OK|OKAY|YEAH|YEP|SURE)$/.test(normaliseCommand(text));
const isNo = (text) => /^(NO|N|NOPE|NOT THIS ONE|DIFFERENT NUMBER|ANOTHER NUMBER)$/.test(normaliseCommand(text));
const isOkUseName = (text) => /^(OK|OKAY|YES|Y|USE IT|THAT IS FINE|THATS FINE|FINE|SAME)$/.test(normaliseCommand(text));

/** Someone who has a place to let by the night and wants it listed. */
function isListShortStayRequest(text) {
  const t = clean(text, 400);
  if (!t || !SHORT_STAY_WORDS.test(t)) return false;
  if (LIST_VERBS.test(t)) return true;
  // "My budget is 100k per night" is a guest; "my apartment is a short stay" is a host.
  return HOST_PLACE.test(t) && !GUEST_WORDS.test(t);
}

/** "Short stay" on its own: it could be a host or a guest, so ask. */
function isBareShortStayKeyword(text) {
  return /^(SHORT STAYS?|SHORTSTAYS?|SHORT TERM STAYS?|SHORT TERM|AIRBNB|AIR BNB|BNB)$/.test(normaliseCommand(text));
}

/** The answer to "Are you the owner or an agent?", as the property listing asks it. */
function parseOwnership(text) {
  const t = normaliseCommand(text);
  if (/^(1|OWNER|THE OWNER|I AM THE OWNER|IM THE OWNER|I OWN IT|MINE|MY OWN|LANDLORD|HOST)$/.test(t)) return 'owner';
  if (/^(2|AGENT|AN AGENT|I AM AN AGENT|IM AN AGENT|BROKER|MANAGER|CARETAKER)$/.test(t)) return 'agent';
  if (/\bOWNER\b/.test(t) && !/\bAGENT\b/.test(t)) return 'owner';
  if (/\bAGENT\b/.test(t) && !/\bOWNER\b/.test(t)) return 'agent';
  return '';
}

function wordNumber(word) {
  const map = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, single: 1, double: 2 };
  return map[String(word || '').toLowerCase()];
}

/** "2 bedrooms, 4 guests", "studio for 2", "3br sleeps 6", "2 4". */
function parseRoomsGuests(text) {
  const t = clean(text, 200).toLowerCase();
  const out = {};
  if (/\bstudio\b|\bbedsitter\b|\bsingle room\b|\bno bedrooms?\b/.test(t)) out.bedrooms = 0;
  const bed = t.match(/(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s*-?\s*(?:bed(?:room)?s?|br|bdr|bdrm|rooms?)\b/);
  if (bed) out.bedrooms = Number(bed[1]) || wordNumber(bed[1]);
  const guests = t.match(/(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:guests?|people|persons?|pax|adults?)\b/)
    || t.match(/\b(?:sleeps|for|max(?:imum)?|up to)\s*(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\b/);
  if (guests) out.max_guests = Number(guests[1]) || wordNumber(guests[1]);
  if (out.bedrooms == null && out.max_guests == null) {
    // Two bare numbers answer "bedrooms and guests" in that order.
    const nums = (t.match(/\b\d{1,2}\b/g) || []).map(Number);
    if (nums.length === 2) {
      out.bedrooms = nums[0];
      out.max_guests = nums[1];
    }
  }
  if (out.bedrooms != null && (out.bedrooms < 0 || out.bedrooms > 30)) delete out.bedrooms;
  if (out.max_guests != null && (out.max_guests < 1 || out.max_guests > 50)) delete out.max_guests;
  return out;
}

/** One number: "3", "three", "3 guests". */
function parseCount(text, { min = 0, max = 50 } = {}) {
  const t = clean(text, 80).toLowerCase();
  const match = t.match(/\b(\d{1,2})\b/) || t.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/);
  if (!match) return null;
  const value = Number(match[1]) || wordNumber(match[1]);
  if (!Number.isFinite(value) || value < min || value > max) return null;
  return value;
}

/** "150,000", "150k", "UGX 1.2m", "80 thousand", "POA". Returns null if unreadable. */
function parseNightly(text) {
  const t = clean(text, 120).toLowerCase().replace(/ugx|ush|shs?\.?|shillings?|\/=|=\/|per night|a night|\/night|nightly|each night/g, ' ');
  if (/\b(poa|price on (?:application|request)|on request|ask|negotiable|call (?:me|for price))\b/.test(t)) return { poa: true };
  const m = t.match(/(\d[\d,.\s]*)\s*(k|thousand|m|million|mn)?\b/);
  if (!m) return null;
  let raw = m[1].replace(/\s+/g, '');
  const unit = m[2] || '';
  let value;
  if (unit) {
    value = Number(raw.replace(/,/g, '')) * (unit.startsWith('m') ? 1_000_000 : 1_000);
  } else {
    // "150.000" and "150,000" both mean a hundred and fifty thousand.
    if (/^\d{1,3}([.,]\d{3})+$/.test(raw)) raw = raw.replace(/[.,]/g, '');
    value = Number(raw.replace(/,/g, ''));
  }
  if (!Number.isFinite(value) || value <= 0) return null;
  value = Math.round(value);
  if (value < 1000) return null; // "150" is not a night's price in shillings
  if (value > MAX_NIGHTLY_UGX) return { tooHigh: true };
  return { amount: value };
}

/** A Uganda NIN anywhere in the text ("cm 9001 2345 678a" included), or ''. */
function extractNin(text) {
  const t = String(text || '').toUpperCase();
  const spaced = t.replace(/[^A-Z0-9]+/g, ' ').match(/\b(C[MF]|P[MF])\s?([A-Z0-9]{12})\b/);
  if (spaced) return `${spaced[1]}${spaced[2]}`;
  const compact = t.replace(/[^A-Z0-9]+/g, '').match(/(CM|CF|PM|PF)[A-Z0-9]{12}/);
  return compact ? compact[0] : '';
}

/** Anything that looks like an ID number, replaced, for logs and analytics. */
function redactIdNumbers(text) {
  return String(text || '')
    .replace(/\b(C[MF]|P[MF])\s?[A-Z0-9]{12}\b/gi, '[ID number]')
    .replace(/\b(?=[A-Z0-9-]*\d)[A-Z0-9-]{6,20}\b/gi, '[ID number]');
}

function isShortStayStep(step) {
  return STEPS.has(String(step || ''));
}

function isIdStep(step) {
  return ID_STEPS.has(String(step || ''));
}

const PICK_ANSWER = /^(1|2|LIST|LIST MY PLACE|LIST A PLACE|HOST|LIST IT|FIND|FIND A PLACE|FIND A STAY)$/;

/**
 * Whether this reply answers the question the flow is waiting on with one of
 * the short answers ("1", "3", "2 4", "confirm") that also answer a guest's
 * booking or an agent's weekly check-in. Only those steps need it.
 */
function answersShortStayQuestion(step, body) {
  const text = clean(body, 40);
  if (!text) return false;
  switch (String(step || '')) {
    case STEP.pick:
      return PICK_ANSWER.test(normaliseCommand(text));
    case STEP.ownership:
      return Boolean(parseOwnership(text));
    case STEP.bedrooms: {
      const parsed = parseRoomsGuests(text);
      return parsed.bedrooms != null || parsed.max_guests != null || /^\d{1,2}$/.test(text);
    }
    case STEP.guests:
      return parseCount(text, { min: 1, max: 50 }) != null;
    case STEP.contact:
    case STEP.terms:
      return isYes(text) || isNo(text);
    case STEP.idPhoto:
    case STEP.idNumber:
      return isLater(text);
    default:
      return false;
  }
}

// "1 MKS-AB12CD" or "3 K7" names a booking or viewing request: it goes to that request.
const NAMED_REFERENCE = /\bMKS-[A-Z0-9]{4,12}\b|^\s*[123]\s+[A-Z][2-9]\s*$/i;

/**
 * The web bridge asks this before its booking-reply checks. Those read a bare
 * "1" from a host as accepting a guest's booking, and "3" or "2 4" from an
 * agent as the weekly check-in (let agreed; listing 2 sold). Part-way through
 * listing a short stay, the same reply is an answer to our question: "3"
 * bedrooms must not mark one of the agent's properties let agreed.
 */
async function isAnsweringShortStay(db, phone, body = '', { now = Date.now() } = {}) {
  const text = String(body || '').trim();
  if (!text || text.length > 40 || NAMED_REFERENCE.test(text)) return false;
  const key = String(phone || '').trim();
  if (!key) return false;
  const result = await db.query(
    `SELECT current_step,
            session_data -> 'short_stay' ->> 'updated_at' AS asked_at,
            last_message_at
       FROM whatsapp_sessions
      WHERE phone = $1::text
      LIMIT 1`,
    [key]
  );
  const row = result.rows[0];
  if (!row || !answersShortStayQuestion(row.current_step, text)) return false;
  const askedAt = Date.parse(row.asked_at || '') || (row.last_message_at ? new Date(row.last_message_at).getTime() : NaN);
  return Number.isFinite(askedAt) && now - askedAt <= STALE_MS;
}

// ---------------------------------------------------------------------------
// Places and prices inside a sentence
// ---------------------------------------------------------------------------

function locationFrom(text, resolve) {
  const raw = clean(text, 160);
  if (!raw || typeof resolve !== 'function') return { status: 'unmatched' };
  const attempt = (value, district = '') => resolve(value, { district, allowText: true });
  const isArea = (r) => r.status === 'matched' && r.match && !['district', 'region'].includes(r.match.level);

  let best = attempt(raw);
  if (isArea(best)) return { status: 'area', district: best.match.district, area: best.match.area };

  // "Kampala, Kololo": the district came first. Try each part, in the district.
  const parts = raw.split(/[,;/]|\bin\b|-/i).map((part) => clean(part)).filter(Boolean);
  const district = best.status === 'matched' && best.match ? best.match.district : '';
  for (const part of parts) {
    const r = attempt(part, district);
    if (isArea(r) && (!district || r.match.district === district)) {
      return { status: 'area', district: r.match.district, area: r.match.area };
    }
  }
  if (district) {
    // A district and a place we do not know by name: keep their words as the area.
    const others = parts.filter((part) => part.toLowerCase() !== district.toLowerCase());
    const leftover = clean(others.join(', '), 120);
    if (leftover && leftover.length >= 3) return { status: 'area', district, area: leftover, freeText: true };
    return { status: 'district', district };
  }
  best = best.status === 'unmatched' && parts.length > 1 ? attempt(parts[0]) : best;
  return { status: best.status === 'ambiguous' ? 'ambiguous' : 'unmatched', resolution: best };
}

const AMOUNT = '(?:ugx|ush|shs?\\.?)?\\s*(\\d[\\d,.]*\\s*(?:k|m|mn|thousand|million)?)\\s*(?:ugx|shs?)?';

/** The price a night inside a longer sentence: "… 150k per night", "nightly rate UGX 90,000". */
function nightlyFromSentence(text) {
  const t = String(text || '');
  const before = t.match(new RegExp(`${AMOUNT}\\s*(?:per|a|\\/|each|for one|for a)\\s*night\\b`, 'i'));
  const after = t.match(new RegExp(`\\b(?:nightly|per night|a night)(?:\\s+(?:rate|price|is|of|at|:))*\\s*${AMOUNT}`, 'i'));
  for (const match of [before, after]) {
    if (!match) continue;
    const parsed = parseNightly(match[1]);
    if (parsed?.amount) return parsed.amount;
  }
  return null;
}

/** What a sentence already says ("2 bedroom airbnb in Kololo, 150k a night"), so it is not asked again. */
function prefillFromText(text, resolve) {
  const draft = {};
  const t = clean(text, 400);
  if (!t) return draft;
  const loc = locationFrom(t, resolve);
  if (loc.status === 'area' && !loc.freeText) {
    draft.district = loc.district;
    draft.area = loc.area;
  }
  const rooms = parseRoomsGuests(t);
  if (rooms.bedrooms != null) draft.bedrooms = rooms.bedrooms;
  if (rooms.max_guests != null) draft.max_guests = rooms.max_guests;
  const price = nightlyFromSentence(t);
  if (price) draft.nightly = price;
  return draft;
}

/** Only what is still missing: an answer never overwrites an earlier one. */
function fillMissing(draft, patch) {
  const out = {};
  for (const [key, value] of Object.entries(patch || {})) {
    if (value == null || value === '') continue;
    if (draft[key] == null || draft[key] === '') out[key] = value;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

function imageCandidates({ photoCandidates = [], mediaUrl = '', mediaType = '' } = {}) {
  const out = [];
  for (const item of Array.isArray(photoCandidates) ? photoCandidates : []) {
    if (!item || typeof item !== 'object') continue;
    out.push({
      dataUrl: String(item.data_url || item.dataUrl || ''),
      mediaFile: String(item.media_file || item.mediaFile || ''),
      remoteUrl: /^https:\/\//i.test(String(item.media_url || item.mediaUrl || '')) ? String(item.media_url || item.mediaUrl) : '',
      mimeType: String(item.mime_type || item.mimeType || 'image/jpeg').toLowerCase()
    });
  }
  if (!out.length && /^https:\/\//i.test(String(mediaUrl || '')) && /image/.test(String(mediaType || ''))) {
    out.push({ dataUrl: '', mediaFile: '', remoteUrl: String(mediaUrl), mimeType: String(mediaType).includes('/') ? String(mediaType) : 'image/jpeg' });
  }
  return out.filter((c) => c.dataUrl || c.mediaFile || c.remoteUrl);
}

function documentCandidates({ mediaCandidates = [], mediaType = '' } = {}) {
  const docs = (Array.isArray(mediaCandidates) ? mediaCandidates : [])
    .map((item) => String(item?.mime_type || item?.mimeType || '').toLowerCase())
    .filter(Boolean);
  if (/pdf|document/.test(String(mediaType || '').toLowerCase())) docs.push(String(mediaType).toLowerCase());
  return docs;
}

function sniffImageMime(bytes) {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length > 8 && bytes.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length > 12 && bytes.slice(0, 4).toString('ascii') === 'RIFF' && bytes.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (bytes.length > 6 && bytes.slice(0, 3).toString('ascii') === 'GIF') return 'image/gif';
  if (bytes.length > 4 && bytes.slice(0, 4).toString('ascii') === '%PDF') return 'application/pdf';
  return '';
}

/** The candidate's bytes as a data URL. Reads a spilled file or downloads, within a size limit. */
async function candidateDataUrl(candidate, { maxBytes = 12 * 1024 * 1024, fetchImpl = fetch } = {}) {
  if (candidate.dataUrl && /^data:/i.test(candidate.dataUrl)) {
    if (Math.floor((candidate.dataUrl.length * 3) / 4) > maxBytes) throw Object.assign(new Error('too_large'), { code: 'too_large' });
    return candidate.dataUrl;
  }
  let bytes = null;
  if (candidate.mediaFile) {
    const stat = await fs.promises.stat(candidate.mediaFile);
    if (stat.size > maxBytes) throw Object.assign(new Error('too_large'), { code: 'too_large' });
    bytes = await fs.promises.readFile(candidate.mediaFile);
  } else if (candidate.remoteUrl) {
    const response = await fetchImpl(candidate.remoteUrl);
    if (!response.ok) throw new Error(`download_failed_${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) throw Object.assign(new Error('too_large'), { code: 'too_large' });
    bytes = buffer;
  }
  if (!bytes || !bytes.length) throw new Error('empty');
  const mime = sniffImageMime(bytes) || candidate.mimeType || 'image/jpeg';
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

/**
 * A photo the listing flow already stored, read back so the short-stay
 * pipeline can re-encode it. Our own storage is read through a signed URL.
 */
async function storedPhotoDataUrl(url, { fetchImpl = fetch, maxBytes = 12 * 1024 * 1024 } = {}) {
  const value = String(url || '').trim();
  if (/^data:image\//i.test(value)) return value;
  const storage = require('./cloudMediaStorageService');
  let target = '';
  const ref = storage.parseStoredS3ObjectRef(value);
  if (ref?.bucket && ref?.key) target = storage.createSignedS3GetUrl(`s3://${ref.bucket}/${ref.key}`).url;
  else if (/^https:\/\//i.test(value)) target = value;
  if (!target) throw new Error('unreadable_photo_reference');
  const response = await fetchImpl(target);
  if (!response.ok) throw new Error(`photo_download_${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > maxBytes) throw new Error('photo_size');
  const mime = sniffImageMime(bytes);
  if (!/^image\//.test(mime)) throw new Error('not_an_image');
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

// ---------------------------------------------------------------------------
// What we say. The property listing's own prompts come in through `kit`;
// these are the ones only a short stay needs.
// ---------------------------------------------------------------------------

const OWN_PROMPTS = {
  area: (draft) => (draft.district
    ? `🗺️ Which area or neighbourhood in ${draft.district}? (e.g. Kololo, Ntinda, Bugolobi...)`
    : '🗺️ What area or neighbourhood? (e.g. Kololo, Ntinda, Bugolobi...)'),
  bedrooms: () => '🛏 How many bedrooms does the place have? Use 0 for a studio.',
  guests: () => '👥 How many guests can stay at most?',
  price: () => '💰 What is the price per night in Uganda Shillings? You can type 150000 or 150k. Reply *POA* if guests should ask for the price.',
  rules: () => '📋 Any house rules for guests? (e.g. no parties after 10pm, no smoking inside) Reply *NONE* if there are none.',
  phone: (draft) => (draft.whatsapp_is_ugandan
    ? null
    : 'Guests in Uganda need a Ugandan number to call.')
};

/** The property listing's English prompts, for when the route has not passed its own. */
const ENGLISH_KIT_TEXT = {
  askOwnership: '✅ Are you the owner of this property, or an agent listing on behalf of an owner?\n1️⃣ I am the owner\n2️⃣ I am an agent',
  askTitle: '✏️ Give your property a short title (e.g. "3-bedroom house in Ntinda Kampala"):',
  askDistrict: '📍 Which district is the property in? (e.g. Kampala, Wakiso, Mukono, Jinja...)',
  askDescription: '📝 Describe your property in a few sentences (location, features, condition...)',
  askPublicName: '👤 What public contact name should appear on the listing? (For example: Amina, Amina Properties, or Private Owner)',
  askContactValuePhone: '📱 Please send the WhatsApp/phone number for listing enquiries.\nFormat: +256 7XX XXX XXX',
  askSelfie: '🪪 Please send a clear photo of your National ID (a photo, not a PDF).',
  askIDNumber: '🪪 Now type your National ID Number (NIN) here.',
  invalidNin: '❌ Please enter a valid National ID Number (NIN).',
  sendSelfiePhotoOnly: '❌ Please upload a photo of your National ID. No PDFs or document files. Take a picture and send the photo.',
  titleTooShort: 'Title is too short. Please give a descriptive title.',
  descriptionTooShort: 'Please write a longer description (at least 10 characters).',
  invalidInput: 'I want to keep this quick. Please reply with one of the options above, or type MENU to start again.',
  needExactlyFivePhotos: '❌ Please send at least 2 clear photos of the property first.'
};

function defaultKit() {
  return {
    t: (key) => ENGLISH_KIT_TEXT[key] || '',
    contactPrompt: (phone) => `Should guests contact you on *${phone}*, the WhatsApp number you are using now? Reply *YES* or *NO*.`,
    photos: {
      min: 2,
      max: 10,
      store: async () => { throw new Error('listing photo storage is not configured'); },
      checklist: (count) => `📸 Please send at least 2 clear photos of the place (up to 10). ${count ? `${count} received so far.` : ''}`.trim(),
      accepted: (count) => `✅ Photo ${count} accepted.`,
      enough: (count) => `✅ Photo ${count} accepted — that's enough to list it.\n📸 Send more photos if you have them, or reply *DONE* to continue.`,
      duplicate: () => '⚠️ That photo has already been received, so I did not count it twice.',
      rejected: () => '⚠️ That image has not been counted. Please send a clear photo of the place.',
      complete: (count) => `📸 ${count} photos received — thank you.`
    }
  };
}

function feeLines({ agentPlan, pricing }) {
  if (agentPlan) {
    return [`💵 Short stays are included in your agent plan (${ugx(pricing.agentMonthly)} a month), so there is no separate fee. makaug takes no commission on any stay.`];
  }
  return [
    '💵 *Fees, plainly:*',
    `• Owners: ${ugx(pricing.ownerMonthly)} a month`,
    `• Agents: ${ugx(pricing.agentMonthly)} a month, with short stays included`,
    'Payment is due when your stay is approved. No free trial, no free days. makaug takes no commission on any stay.'
  ];
}

function termsMessage(draft, { pricing, env }) {
  return [
    '📄 *Last step before it goes to our review team.* Please confirm:',
    `• You ${draft.host_type === 'agent' ? 'have the owner\'s permission' : 'own this place, or have the owner\'s permission'} to let it for short stays.`,
    `• You accept the makaug listing terms: ${siteUrl(env)}/terms`,
    '',
    ...feeLines({ agentPlan: Boolean(draft.agent_id), pricing }),
    '',
    'Reply *AGREE* to send it for review, or *NO* to stop.'
  ].join('\n');
}

function pickMessage() {
  return [
    '🏡 *Short stays*: do you want to',
    '1️⃣ *List* a place you let by the night, or',
    '2️⃣ *Find* a place to stay?'
  ].join('\n');
}

function findStayMessage(env) {
  return `🔎 You can browse short stays here: ${siteUrl(env)}/short-term\nOr tell me the area, dates and number of guests, and I will help.`;
}

function savedLine(patch = {}) {
  const bits = [];
  if (patch.title) bits.push('title');
  if (patch.area || patch.district) bits.push([patch.area, patch.district].filter(Boolean).join(', '));
  if (patch.bedrooms != null) bits.push(Number(patch.bedrooms) === 0 ? 'studio' : `${patch.bedrooms} bedroom${Number(patch.bedrooms) === 1 ? '' : 's'}`);
  if (patch.max_guests != null) bits.push(`${patch.max_guests} guest${Number(patch.max_guests) === 1 ? '' : 's'}`);
  if (patch.nightly) bits.push(`${ugx(patch.nightly)} a night`);
  if (patch.poa) bits.push('price on request');
  return bits.length ? `✅ Saved: ${bits.join(' | ')}` : '✅ Saved';
}

function idStatusOf(draft) {
  if (draft.id_on_file) return 'on_file';
  if (draft.id_photo_ref || draft.id_number) return 'received';
  return 'pending';
}

function submittedMessage({ reference, photoCount, idStatus, idUploadUrl, feeIncluded, pricing, env }) {
  const lines = [
    '🎉 *Your short stay has been submitted!*',
    '',
    `Our team will review it before it goes live on ${siteUrl(env).replace(/^https?:\/\//, '')}/short-term. I will message you here when it is approved.`,
    '',
    `Reference: *${reference}*`,
    `📸 ${photoCount} photo${Number(photoCount) === 1 ? '' : 's'}`
  ];
  if (idStatus === 'on_file') lines.push('🪪 Your National ID is already on file from your agent account.');
  else if (idStatus === 'received') lines.push('🪪 We have your National ID. Your listing shows *ID still pending* until our team has checked it.');
  else {
    lines.push('🪪 No ID yet: your listing shows *ID still pending* until we have checked one.');
    if (idUploadUrl) lines.push(`Send your National ID any time with this private link (it works for 30 days, keep it to yourself): ${siteUrl(env)}${idUploadUrl}`);
  }
  lines.push('');
  lines.push(feeIncluded
    ? `💵 Short stays are included in your agent plan (${ugx(pricing.agentMonthly)} a month). makaug takes no commission on any stay.`
    : `💵 Once it is approved, I send you the payment link: ${ugx(pricing.ownerMonthly)} a month keeps it live. No free days, and makaug takes no commission on any stay.`);
  lines.push('');
  lines.push('Thank you for using makaug! 🏠🇺🇬');
  return lines.join('\n');
}

/** Their description, kept. When it is short, facts are added rather than it being replaced. */
function descriptionFor(draft) {
  const own = clean(draft.description, 2000);
  if (own.length >= 40) return own;
  const rooms = Number(draft.bedrooms) === 0 ? 'Studio' : `${draft.bedrooms}-bedroom`;
  return `${own}${own && !/[.!?]$/.test(own) ? '.' : ''} ${rooms} short stay in ${draft.area}, ${draft.district}, for up to ${draft.max_guests} guest${Number(draft.max_guests) === 1 ? '' : 's'}.`.trim();
}

// ---------------------------------------------------------------------------
// The draft
// ---------------------------------------------------------------------------

function nextQuestion(draft = {}) {
  if (!draft.host_type) return STEP.ownership;
  if (!draft.title) return STEP.title;
  if (!draft.district) return STEP.district;
  if (!draft.area) return STEP.area;
  if (draft.bedrooms == null) return STEP.bedrooms;
  if (draft.max_guests == null) return STEP.guests;
  if (!draft.poa && !draft.nightly) return STEP.price;
  if (!draft.description) return STEP.description;
  if (draft.house_rules == null) return STEP.rules;
  if (!draft.photos_done) return STEP.photos;
  if (!draft.host_name) return STEP.name;
  if (!draft.host_phone) return draft.whatsapp_is_ugandan && !draft.contact_declined ? STEP.contact : STEP.phone;
  if (!draft.id_on_file && !draft.id_later) {
    if (!draft.id_photo_ref && !draft.id_photo_skipped) return STEP.idPhoto;
    if (draft.id_photo_ref && !draft.id_number && !draft.id_number_skipped) return STEP.idNumber;
  }
  return STEP.terms;
}

// ---------------------------------------------------------------------------
// Dependencies (the real ones by default; tests pass their own)
// ---------------------------------------------------------------------------

function defaultDeps() {
  const shortTerm = require('./shortTermService');
  const media = require('./shortTermMediaService');
  const identity = require('./shortTermIdentityService');
  const { storeDataUrl } = require('./cloudMediaStorageService');
  const { resolveWhatsappLocation, whatsappLocationPrompt } = require('./whatsappLocationResolverService');
  const { shortTermIntakeEnabled } = require('../utils/shortTermFeatureFlags');
  const { publishedPricing } = require('../config/publishedPricing');
  return {
    db: require('../config/database'),
    logger: require('../config/logger'),
    env: process.env,
    now: () => new Date(),
    intakeEnabled: () => shortTermIntakeEnabled(),
    pricing: () => {
      const published = publishedPricing();
      return { ownerMonthly: shortTerm.LISTING_FEE_UGX, agentMonthly: Number(published.agent.monthly_ugx) };
    },
    resolveLocation: resolveWhatsappLocation,
    locationPrompt: whatsappLocationPrompt,
    createListing: (payload, context) => shortTerm.createShortTermListing(require('../config/database'), payload, context),
    attachPhoto: (listingId, dataUrl) => media.attachListingPhoto(require('../config/database'), listingId, {
      dataUrl,
      token: media.createUploadToken(listingId)
    }),
    photoDataUrl: (url) => storedPhotoDataUrl(url),
    idUploadPath: (listingId) => identity.identityUploadPath(listingId, identity.createIdentityUploadToken(listingId)),
    agentIdOnFile: (agent) => identity.findVerifiedAgentIdentityOnFile(require('../config/database'), {
      userId: agent?.user_id || '',
      agentId: agent?.id || ''
    }),
    storePrivateIdPhoto: (dataUrl) => storeDataUrl(dataUrl, {
      keyPrefix: 'short-stays/whatsapp/identity',
      filename: 'national-id-front',
      isPrivate: true,
      allowedMimeTypes: identity.HOST_ID_PHOTO_MIMES,
      maxBytes: identity.HOST_ID_MAX_BYTES,
      label: 'Short-stay host National ID photo'
    }),
    validNin: identity.isValidUgNinNumber,
    candidateDataUrl,
    notifyStaff: async () => {},
    kit: null
  };
}

/** An approved agent on this number: the same rule the fee uses (findApprovedAgentForHost). */
async function findApprovedAgent(db, phone) {
  const tail = digits(phone).slice(-9);
  if (tail.length !== 9) return null;
  const result = await db.query(
    `SELECT id, user_id, full_name, greeting_name, company_name, email, phone
       FROM agents
      WHERE removed_at IS NULL
        AND status = 'approved'
        AND (RIGHT(REGEXP_REPLACE(COALESCE(phone, ''), '[^0-9]', '', 'g'), 9) = $1::text
          OR RIGHT(REGEXP_REPLACE(COALESCE(whatsapp, ''), '[^0-9]', '', 'g'), 9) = $1::text)
      ORDER BY created_at DESC
      LIMIT 1`,
    [tail]
  );
  return result.rows[0] || null;
}

async function saveState(db, phone, step, draft) {
  await db.query(
    `UPDATE whatsapp_sessions
        SET current_step = $2::text,
            session_data = COALESCE(session_data, '{}'::jsonb) || jsonb_build_object('short_stay', $3::jsonb),
            last_message_at = NOW()
      WHERE phone = $1::text`,
    [phone, step, draft ? JSON.stringify(draft) : 'null']
  );
}

// ---------------------------------------------------------------------------
// The conversation
// ---------------------------------------------------------------------------

/**
 * Answers one inbound message if it belongs to the short-stay flow, or starts
 * the flow. Returns { handled: false } for anything else.
 */
async function handleShortStayWhatsapp(input = {}, overrides = {}) {
  const deps = { ...defaultDeps(), ...overrides };
  const kit = deps.kit || defaultKit();
  const {
    phone,
    body = '',
    step = '',
    session = {},
    contactName = '',
    photoCandidates = [],
    mediaCandidates = [],
    mediaUrl = '',
    mediaType = '',
    conversationControl = null
  } = input;
  const db = deps.db;
  const env = deps.env || process.env;
  const say = (key) => kit.t(key) || ENGLISH_KIT_TEXT[key] || '';
  const text = clean(body, 1000);
  const sessionData = session.session_data || {};
  let draft = sessionData.short_stay && typeof sessionData.short_stay === 'object' ? { ...sessionData.short_stay } : null;
  const nowMs = deps.now().getTime();
  const images = imageCandidates({ photoCandidates, mediaUrl, mediaType });
  const documents = documentCandidates({ mediaCandidates, mediaType });
  // A voice note arrives here already transcribed; it is text, not media.
  const isAudio = /audio|ogg|opus|voice/.test(String(mediaType || '').toLowerCase());
  const hasMedia = Boolean(images.length || documents.length || (mediaUrl && !isAudio));
  const inFlowStep = isShortStayStep(step);

  // A person has taken this conversation over. The flow waits.
  const control = conversationControl || {};
  if (['off', 'copilot'].includes(String(control.ai_mode || '').toLowerCase())
    || ['needs_human', 'escalated'].includes(String(control.status || '').toLowerCase())) {
    return { handled: false };
  }

  const reply = async (message, nextStep, nextDraft) => {
    const keep = nextDraft === null ? null : { ...(nextDraft || draft || {}), updated_at: new Date(nowMs).toISOString() };
    await saveState(db, phone, nextStep, keep);
    return { handled: true, message, nextStep, sensitive: isIdStep(step) };
  };
  // Leaving the flow without answering: the rest of the bot takes the message,
  // from the main menu rather than from a step only this flow knows.
  const passOn = async () => {
    if (inFlowStep) await saveState(db, phone, 'main_menu', null);
    return { handled: false, resetStep: inFlowStep ? 'main_menu' : null };
  };
  const pricing = deps.pricing();

  const promptFor = (next, d) => {
    switch (next) {
      case STEP.ownership: return say('askOwnership');
      case STEP.title: return say('askTitle');
      case STEP.district: return say('askDistrict');
      case STEP.area: return OWN_PROMPTS.area(d);
      case STEP.bedrooms: return OWN_PROMPTS.bedrooms();
      case STEP.guests: return OWN_PROMPTS.guests();
      case STEP.price: return OWN_PROMPTS.price();
      case STEP.description: return say('askDescription');
      case STEP.rules: return OWN_PROMPTS.rules();
      case STEP.photos: return kit.photos.checklist((d.photos || []).length);
      case STEP.name: return contactName
        ? `${say('askPublicName')}\nReply *OK* to use *${clean(contactName, 60)}*.`
        : say('askPublicName');
      case STEP.contact: return kit.contactPrompt(phone);
      case STEP.phone: return [OWN_PROMPTS.phone(d), say('askContactValuePhone')].filter(Boolean).join('\n');
      case STEP.idPhoto: return `${say('askSelfie')}\n\nOr reply *LATER* to send it another time: your listing will show *ID still pending* until we have checked one.`;
      case STEP.idNumber: return `${say('askIDNumber')}\n\nOr reply *LATER*.`;
      case STEP.terms: return termsMessage(d, { pricing, env });
      default: return '';
    }
  };
  // "✅ Saved … Next: …", as the property listing says it.
  const advance = (patch, { prefix = '' } = {}) => {
    const nextDraft = { ...draft, ...patch };
    const next = nextQuestion(nextDraft);
    const head = prefix || savedLine(patch);
    const question = [STEP.photos, STEP.terms].includes(next) ? promptFor(next, nextDraft) : `Next: ${promptFor(next, nextDraft)}`;
    return reply(`${head}\n\n${question}`, next, nextDraft);
  };
  const askAgain = (prefix = '') => {
    const q = promptFor(step, draft);
    return reply(prefix ? `${prefix}\n\n${q}` : q, step, draft);
  };

  // Photos go through the property listing's checks and storage as they
  // arrive, whatever the step, so none is lost.
  async function keepPhotos(current) {
    const result = await kit.photos.store({
      listing_type: 'short_stay',
      photos: current.photos || [],
      photo_hashes: current.photo_hashes || [],
      photo_perceptual_hashes: current.photo_perceptual_hashes || [],
      photo_validation: current.photo_validation || []
    });
    const next = {
      ...current,
      photos: result.photos || [],
      photo_hashes: result.photoHashes || [],
      photo_perceptual_hashes: result.photoPerceptualHashes || [],
      photo_validation: result.photoValidation || []
    };
    const outcomes = Array.isArray(result.outcomes) ? result.outcomes : [];
    return {
      next,
      count: next.photos.length,
      accepted: outcomes.filter((item) => item.status === 'accepted').length,
      duplicate: outcomes.find((item) => item.status === 'duplicate') || null,
      rejected: outcomes.find((item) => item.status === 'rejected') || null
    };
  }

  async function startFlow({ agent = null, fromMenu = false } = {}) {
    if (!deps.intakeEnabled()) {
      return reply(`Short-stay listings are not open on WhatsApp yet. You can list on the website: ${siteUrl(env)}/list-property?type=short_stay`, 'main_menu', null);
    }
    const known = agent || await findApprovedAgent(db, phone).catch(() => null);
    let fresh = {
      started_at: new Date(nowMs).toISOString(),
      whatsapp_is_ugandan: isUgandanNumber(phone),
      ...prefillFromText(text, deps.resolveLocation)
    };
    if (known) {
      fresh = {
        ...fresh,
        host_type: 'agent',
        agent_id: String(known.id),
        agent_user_id: known.user_id ? String(known.user_id) : null,
        host_name: clean(known.full_name, 120) || null,
        host_email: clean(known.email, 200) || '',
        host_phone: isUgandanNumber(phone) ? phone : (isUgandanNumber(known.phone) ? clean(known.phone, 40) : null)
      };
      const onFile = await Promise.resolve(deps.agentIdOnFile(known)).catch(() => null);
      if (onFile) fresh.id_on_file = true;
    }
    draft = fresh;
    let photoNote = '';
    if (images.length) {
      const kept = await keepPhotos(fresh).catch(() => null);
      if (kept) {
        fresh = kept.next;
        if (kept.accepted) photoNote = `📸 ${kept.count} photo${kept.count === 1 ? '' : 's'} saved for your listing.`;
      }
    }
    const next = nextQuestion(fresh);
    const first = clean(known?.greeting_name || known?.full_name, 60).split(' ')[0];
    const intro = known
      ? `🏡 *List a short stay*${first ? `, ${first}` : ''}: the same steps as listing a property. Short stays are included in your agent plan (${ugx(pricing.agentMonthly)} a month), so there is no separate fee.`
      : fromMenu
        ? '✅ *Short stay* (by the night).'
        : `🏡 *List a short stay*: the same steps as listing a property, then our team reviews it. Owners pay ${ugx(pricing.ownerMonthly)} a month once approved: no free days, no commission.`;
    const question = next === STEP.ownership ? promptFor(next, fresh) : `Next: ${promptFor(next, fresh)}`;
    return reply([intro, photoNote, question].filter(Boolean).join('\n\n'), next, fresh);
  }

  const stale = Boolean(draft && draft.updated_at && nowMs - Date.parse(draft.updated_at) > STALE_MS);
  const active = inFlowStep && step !== STEP.pick && Boolean(draft) && !stale;

  if (!active) {
    if (step === STEP.pick) {
      const askedAt = session.last_message_at ? new Date(session.last_message_at).getTime() : NaN;
      if (Number.isFinite(askedAt) && nowMs - askedAt > STALE_MS) return passOn();
      const answer = normaliseCommand(text);
      if (/^(1|LIST|LIST MY PLACE|LIST A PLACE|HOST|LIST IT)$/.test(answer) || isListShortStayRequest(text)) return startFlow();
      if (isCancel(text)) return passOn();
      return reply(`${findStayMessage(env)}\n\nTo list your own place instead, reply *SHORT STAY*.`, 'main_menu', null);
    }
    // The only ways in: option 6 on the listing menu, an explicit "list my
    // short stay", "short stay" on its own (asked which they mean), or SHORT
    // STAY or 5 from an approved agent's menu. Only from a resting step: a
    // title, a description or a staff intake in progress is never taken over.
    // Words alone are a request; photos with a caption are a post for the
    // existing intake (an agent's "posting my airbnb" with photos stays a post).
    const restingStep = inFlowStep ? 'main_menu' : String(step || '');
    const resting = ENTRY_STEPS.has(restingStep);
    const fromListingMenu = restingStep === 'listing_type' && (/^6\b/.test(text) || SHORT_STAY_WORDS.test(text));
    const explicit = resting && !hasMedia && isListShortStayRequest(text);
    const bare = resting && !hasMedia && isBareShortStayKeyword(text);
    const agentMenuFive = !hasMedia && text === '5' && ['main_menu', 'greeting', 'submitted', ''].includes(restingStep);
    if (!fromListingMenu && !explicit && !bare && !agentMenuFive) return passOn();
    if (agentMenuFive) {
      const agent = await findApprovedAgent(db, phone).catch(() => null);
      return agent ? startFlow({ agent }) : passOn();
    }
    if (bare) {
      const agent = await findApprovedAgent(db, phone).catch(() => null);
      if (agent) return startFlow({ agent });
      return reply(pickMessage(), STEP.pick, null);
    }
    return startFlow({ fromMenu: fromListingMenu });
  }

  // ---- inside the flow ----------------------------------------------------

  if (isCancel(text) && !images.length) {
    return reply('OK, stopped. Nothing was sent for review. Reply *SHORT STAY* any time to start again.', 'main_menu', null);
  }

  // A photo while we are asking something else: kept for the listing, and the
  // question asked again. (At the ID steps a photo is the ID.)
  if (images.length && !draft.photos_done && step !== STEP.photos && !isIdStep(step)) {
    const kept = await keepPhotos(draft).catch(() => null);
    if (!kept) return askAgain('Sorry, that photo could not be saved right now. Please send it again in a minute.');
    draft = kept.next;
    const note = kept.accepted
      ? `📸 Photo saved (${kept.count} so far). I will add it to your listing.`
      : kept.duplicate
        ? '📸 I already have that photo.'
        : kit.photos.rejected(kept.count, kept.rejected?.validation?.verdict || 'non_property');
    return askAgain(note);
  }

  if (step === STEP.ownership) {
    const hostType = parseOwnership(text);
    if (!hostType) return askAgain(say('invalidInput'));
    return advance({ host_type: hostType });
  }

  if (step === STEP.title) {
    const title = clean(text, 160);
    if (title.length < 5) return askAgain(say('titleTooShort'));
    // "2-bedroom apartment in Kololo": what the title already says is not asked again.
    return advance({ title, ...fillMissing(draft, prefillFromText(title, deps.resolveLocation)) });
  }

  if (step === STEP.district) {
    const loc = locationFrom(text, deps.resolveLocation);
    if (loc.status === 'area') return advance({ district: loc.district, area: loc.area });
    if (loc.status === 'district') return advance({ district: loc.district });
    const prompt = loc.resolution && typeof deps.locationPrompt === 'function'
      ? deps.locationPrompt(loc.resolution)
      : 'I could not find that place.';
    return reply(`${prompt}\n\n${promptFor(STEP.district, draft)}`, STEP.district, draft);
  }

  if (step === STEP.area) {
    const area = clean(text, 120);
    if (area.length < 3 || /^\d+$/.test(area)) return askAgain();
    const loc = locationFrom(`${area}, ${draft.district}`, deps.resolveLocation);
    const chosen = loc.status === 'area' && loc.district === draft.district ? loc.area : area;
    return advance({ area: chosen });
  }

  if (step === STEP.bedrooms) {
    const parsed = parseRoomsGuests(text);
    const patch = {};
    if (parsed.bedrooms != null) patch.bedrooms = parsed.bedrooms;
    if (parsed.max_guests != null && draft.max_guests == null) patch.max_guests = parsed.max_guests;
    if (patch.bedrooms == null) {
      const count = parseCount(text, { min: 0, max: 30 });
      if (count == null) return askAgain(say('invalidInput'));
      patch.bedrooms = count;
    }
    return advance(patch);
  }

  if (step === STEP.guests) {
    const parsed = parseRoomsGuests(text);
    const count = parsed.max_guests != null ? parsed.max_guests : parseCount(text, { min: 1, max: 50 });
    if (count == null) return askAgain(say('invalidInput'));
    return advance({ max_guests: count });
  }

  if (step === STEP.price) {
    const price = parseNightly(text);
    if (price?.poa) return advance({ poa: true, nightly: null });
    if (price?.tooHigh) return askAgain('That price looks too high for one night. Please check the figure.');
    if (!price?.amount) return askAgain('❌ Please enter the price per night in UGX, e.g. 150000.');
    return advance({ nightly: price.amount, poa: false });
  }

  if (step === STEP.description) {
    if (text.length < 10) return askAgain(say('descriptionTooShort'));
    return advance({ description: String(body || '').trim().slice(0, 2000) });
  }

  if (step === STEP.rules) {
    if (isSkip(text)) return advance({ house_rules: '' });
    if (text.length < 3) return askAgain();
    return advance({ house_rules: String(body || '').trim().slice(0, 1500) });
  }

  if (step === STEP.photos) {
    const min = Number(kit.photos.min) || 2;
    const max = Number(kit.photos.max) || 10;
    if (images.length) {
      const kept = await keepPhotos(draft).catch(() => null);
      if (!kept) return askAgain('Sorry, that photo could not be saved right now. Please send it again in a minute.');
      draft = kept.next;
      if (kept.count >= max) return advance({ photos_done: true }, { prefix: kit.photos.complete(kept.count) });
      if (kept.count >= min && kept.accepted) return reply(kit.photos.enough(kept.count), STEP.photos, draft);
      if (kept.accepted) return reply(kit.photos.accepted(kept.count), STEP.photos, draft);
      if (kept.duplicate) return reply(kit.photos.duplicate(kept.count), STEP.photos, draft);
      return reply(kit.photos.rejected(kept.count, kept.rejected?.validation?.verdict || 'unavailable'), STEP.photos, draft);
    }
    if (hasMedia) return askAgain('Please send *photos* of the place, not videos or files.');
    const count = (draft.photos || []).length;
    // With the minimum in, DONE (or any other reply) moves on, as for a property.
    if (count >= min) return advance({ photos_done: true }, { prefix: kit.photos.complete(count) });
    if (isDone(text)) return askAgain(say('needExactlyFivePhotos'));
    return askAgain();
  }

  if (step === STEP.name) {
    const name = isOkUseName(text) && contactName ? clean(contactName, 120) : clean(text, 120);
    if (name.length < 2 || /^\d+$/.test(name) || isOkUseName(name)) return askAgain();
    return advance({ host_name: name });
  }

  if (step === STEP.contact) {
    if (isYes(text)) return advance({ host_phone: phone, host_phone_is_whatsapp: true });
    if (isNo(text)) return advance({ contact_declined: true });
    return askAgain();
  }

  if (step === STEP.phone) {
    if (!isUgandanNumber(text)) return askAgain('That does not look like a Ugandan mobile number.');
    return advance({ host_phone: clean(text, 40), host_phone_is_whatsapp: false });
  }

  if (step === STEP.idPhoto || step === STEP.idNumber) {
    if (images.length) {
      let ref;
      let mime = 'image/jpeg';
      try {
        const dataUrl = await deps.candidateDataUrl(images[0], { maxBytes: ID_PHOTO_MAX_BYTES });
        mime = (dataUrl.match(/^data:([^;]+);/) || [])[1] || mime;
        if (!/^image\//.test(mime)) return askAgain(say('sendSelfiePhotoOnly'));
        ref = await deps.storePrivateIdPhoto(dataUrl);
      } catch (error) {
        if (error?.code === 'too_large' || /too large/i.test(String(error?.message || ''))) {
          return askAgain('That photo is too big. A normal phone photo under 5 MB is enough.');
        }
        deps.logger?.warn?.('WhatsApp short stay ID photo could not be stored', { message: error?.message });
        return askAgain('Sorry, that photo could not be saved. Please send it again.');
      }
      if (!ref) return askAgain('Sorry, that photo could not be saved. Please send it again.');
      const patch = { id_photo_ref: ref, id_photo_mime: mime };
      const number = extractNin(text);
      if (number && deps.validNin(number)) patch.id_number = number;
      return advance(patch, { prefix: '📷 Got the photo of your National ID.' });
    }
    if (documents.length || hasMedia) return askAgain(say('sendSelfiePhotoOnly'));
    if (isLater(text)) {
      // A photo already sent still goes to staff; only what is missing is skipped.
      return advance(step === STEP.idNumber ? { id_number_skipped: true } : { id_later: true });
    }
    const number = extractNin(text) || clean(text, 40).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (!deps.validNin(number)) {
      // A wrong number is never repeated back.
      return askAgain(step === STEP.idNumber || /\d/.test(text) ? say('invalidNin') : '');
    }
    if (step === STEP.idPhoto && !draft.id_photo_ref) {
      // The number first: kept, and the photo still asked for.
      return reply(`✅ National ID number saved.\n\n📷 Now send a clear photo of the front of the card (a photo, not a PDF), or reply *LATER*.`, STEP.idPhoto, { ...draft, id_number: number });
    }
    return advance({ id_number: number });
  }

  if (step === STEP.terms) {
    if (isNo(text)) {
      return reply('No problem — nothing has been submitted and nothing is published. If you change your mind, reply *AGREE* here.', STEP.terms, draft);
    }
    if (!isYes(text)) return askAgain();
    return submit(draft);
  }

  return askAgain();

  // ---- sending it to the desk ---------------------------------------------
  async function submit(current) {
    const identity = current.id_on_file ? {} : {
      ...((current.id_photo_ref || current.id_number) ? { id_kind: 'national_id' } : {}),
      ...(current.id_number ? { id_number: current.id_number } : {}),
      ...(current.id_photo_ref ? {
        id_document_url: current.id_photo_ref,
        id_document_name: 'whatsapp-national-id-front.jpg',
        id_document_mime_type: current.id_photo_mime || 'image/jpeg'
      } : {})
    };
    let created;
    try {
      created = await deps.createListing({
        title: current.title,
        description: descriptionFor(current),
        district: current.district,
        area: current.area,
        bedrooms: current.bedrooms,
        max_guests: current.max_guests,
        base_nightly_ugx: current.poa ? '' : current.nightly,
        price_on_application: Boolean(current.poa),
        house_rules: current.house_rules || '',
        host_name: current.host_name,
        host_phone: current.host_phone,
        host_whatsapp: phone,
        host_email: current.host_email || '',
        host_type: current.host_type === 'agent' ? 'agent' : 'owner',
        right_to_let_declared: true,
        terms_accepted: true,
        listed_from: 'whatsapp',
        ...identity
      }, {
        listedVia: 'whatsapp',
        hostUserId: current.agent_user_id || null,
        hostAgentId: current.agent_id || null,
        acquisitionNotes: `Listed by the host on WhatsApp (number ending ${digits(phone).slice(-3)}).`
      });
    } catch (error) {
      const details = Array.isArray(error?.details) && error.details.length ? error.details : null;
      if (details) {
        // Send them back to the answer that needs fixing; everything else is kept.
        if (details.some((line) => /phone number/i.test(line))) {
          return reply(`${details.join('\n')}\n\n${promptFor(STEP.phone, current)}`, STEP.phone, { ...current, host_phone: null, contact_declined: true });
        }
        if (details.some((line) => /National ID number/i.test(line))) {
          return reply(`${say('invalidNin')}\n\n${promptFor(STEP.idNumber, current)}`, STEP.idNumber, { ...current, id_number: null });
        }
        return reply(`I could not send it yet:\n• ${details.join('\n• ')}\n\nReply *AGREE* to try again, or *CANCEL*.`, STEP.terms, current);
      }
      deps.logger?.error?.('WhatsApp short stay could not be created', { message: error?.message, phone_tail: digits(phone).slice(-3) });
      return reply('Sorry, something went wrong saving your stay. Nothing was sent yet, and your answers are kept: reply *AGREE* to try again in a minute.', STEP.terms, current);
    }

    // The photos already taken go in through the short-stay pipeline.
    let photoCount = 0;
    for (const url of (current.photos || []).slice(0, 12)) {
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          await deps.attachPhoto(created.id, await deps.photoDataUrl(url));
          photoCount += 1;
          break;
        } catch (error) {
          if (attempt === 2) {
            deps.logger?.warn?.('WhatsApp short stay photo could not be copied', { reference: created.reference, message: error?.message });
          }
        }
      }
    }

    const idStatus = idStatusOf(current);
    let idUploadUrl = null;
    if (idStatus === 'pending') {
      try { idUploadUrl = deps.idUploadPath(created.id); } catch (_ignored) { idUploadUrl = null; }
    }

    // Staff hear about it, as they do for a property.
    try {
      await deps.notifyStaff({
        listingId: String(created.id),
        reference: created.reference,
        title: current.title,
        area: current.area,
        district: current.district,
        nightly: current.poa ? null : current.nightly,
        hostType: current.host_type === 'agent' ? 'agent' : 'owner',
        hostName: current.host_name,
        hostPhone: current.host_phone,
        photoCount,
        photosSent: (current.photos || []).length,
        idStatus
      });
    } catch (error) {
      deps.logger?.warn?.('WhatsApp short stay staff notice failed', { reference: created.reference, message: error?.message });
    }

    return reply(submittedMessage({
      reference: created.reference,
      photoCount,
      idStatus,
      idUploadUrl,
      feeIncluded: created.listing_fee_included_in_agent_plan === true,
      pricing,
      env
    }), 'submitted', null);
  }
}

module.exports = {
  STEP,
  STEPS,
  STALE_MS,
  isShortStayStep,
  isIdStep,
  answersShortStayQuestion,
  isAnsweringShortStay,
  isListShortStayRequest,
  isBareShortStayKeyword,
  parseOwnership,
  parseRoomsGuests,
  parseCount,
  parseNightly,
  extractNin,
  redactIdNumbers,
  locationFrom,
  prefillFromText,
  nightlyFromSentence,
  nextQuestion,
  imageCandidates,
  candidateDataUrl,
  storedPhotoDataUrl,
  sniffImageMime,
  termsMessage,
  submittedMessage,
  descriptionFor,
  findApprovedAgent,
  handleShortStayWhatsapp
};
