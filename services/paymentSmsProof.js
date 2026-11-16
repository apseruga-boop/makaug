'use strict';

/**
 * "Upload payment SMS": the caller (or King) uploads or pastes a screenshot
 * of the MoMo / Airtel confirmation SMS. The browser reads it for free with
 * Tesseract.js; here we parse the text, run the guards, store the screenshot
 * privately as proof and open a payment claim for King. King's confirm uses
 * the existing claim path, so the money flows into payments, finance, Road to
 * 1000 and commission exactly like any other confirmed claim.
 *
 * Guards: a transaction ID is used once (proofs, claims, ledger); the amount
 * must be at least the plan price; the sender's number must match the number
 * on the call or it is flagged; the SMS must be recent (and not in the future).
 */

const db = require('../config/database');
const revenue = require('./revenueService');
const { publishedPricing } = require('../config/publishedPricing');

const RECENT_HOURS = Number(process.env.SMS_PROOF_RECENT_HOURS || 72);
const MAX_IMAGE_BYTES = 6_000_000; // same limit as other payment receipts
const MERCHANT_CODE = '27248497';

class ProofError extends Error { constructor(status, message, code = '') { super(message); this.status = status; this.code = code; } }
const err = (status, message, code) => new ProofError(status, message, code);
const rows = async (sql, params = []) => (await db.query(sql, params)).rows;
const safeRows = (sql, params = []) => rows(sql, params).catch(() => []);
const key9 = (v) => String(v || '').replace(/\D+/g, '').slice(-9);
const mask = (k) => (k ? `•••${String(k).slice(-3)}` : '');

/** OCR slips in money and IDs: O→0, l/I→1 next to digits, stray spaces in numbers. */
function cleanOcr(text = '') {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/U\s*G\s*X/gi, 'UGX').replace(/\bUGX(?=[\dOo])/g, 'UGX ')
    // Number-like tokens (at least one digit): O→0, I/l/|→1.
    .replace(/(?<![A-Za-z])[\dOo][\dOoIl|,.]*(?![A-Za-z])/g, (tok) => (/\d/.test(tok) ? tok.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1') : tok))
    .replace(/(\d)\s*,\s*(\d{3})\b/g, '$1,$2')
    // 50.000 / 1.300.000 (dots read for commas) → 50,000; dates like 16.11.26 are left alone.
    .replace(/\b(\d{1,3})((?:\.\d{3})+)(?![.\d])/g, (all, a, rest) => a + rest.replace(/\./g, ','))
    // Common misreads of the words the parser keys on.
    .replace(/\brec[a-z]{1,4}ved\b/gi, 'received').replace(/\bY'?el+o\b/gi, "Y'ello")
    .replace(/[ \t]+/g, ' ');
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
/** Dates as the networks write them; Kampala time (UTC+3). Returns ISO or null. */
function parseSmsDate(text = '') {
  const t = String(text || '');
  let y; let mo; let d; let h = 12; let mi = 0;
  let m = t.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T,]+(?:at\s+)?(\d{1,2})[:. ](\d{2})(?:[:. ]\d{2})?\s*([AaPp][Mm])?)?/);
  if (m) { [y, mo, d] = [m[1], m[2], m[3]].map(Number); if (m[4]) { h = Number(m[4]); mi = Number(m[5]); if (m[6]) h = (h % 12) + (/p/i.test(m[6]) ? 12 : 0); } }
  if (!m) {
    m = t.match(/\b(\d{1,2})[-/.](\d{1,2}|[A-Za-z]{3,9})[-/.](\d{2,4})(?:[ T,]+(?:at\s+)?(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?)?/);
    if (m) {
      d = Number(m[1]); mo = /\d/.test(m[2]) ? Number(m[2]) : MONTHS[m[2].slice(0, 3).toLowerCase()]; y = Number(m[3]); if (y < 100) y += 2000;
      if (m[4]) { h = Number(m[4]); mi = Number(m[5]); if (m[6]) h = (h % 12) + (/p/i.test(m[6]) ? 12 : 0); }
    }
  }
  if (!m) {
    m = t.match(/\b(\d{1,2})\s+([A-Za-z]{3,9})\s+(20\d{2})(?:[ ,]+(?:at\s+)?(\d{1,2}):(\d{2})\s*([AaPp][Mm])?)?/);
    if (m && MONTHS[m[2].slice(0, 3).toLowerCase()]) {
      d = Number(m[1]); mo = MONTHS[m[2].slice(0, 3).toLowerCase()]; y = Number(m[3]);
      if (m[4]) { h = Number(m[4]); mi = Number(m[5]); if (m[6]) h = (h % 12) + (/p/i.test(m[6]) ? 12 : 0); }
    } else m = null;
  }
  if (!m || !y || !mo || !d || mo > 12 || d > 31 || h > 23 || mi > 59) return null;
  const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}:00+03:00`;
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

/** Text from the screenshot → the fields Ronald checks. */
function parseSmsText(raw = '') {
  const text = cleanOcr(raw);
  const flat = text.replace(/\s+/g, ' ').trim();
  const base = revenue.parseMoneySms(flat, '');
  const phone = (flat.match(/\b(?:\+?256|0)\s?7\d{2}\s?\d{3}\s?\d{3}\b/) || [])[0] || '';
  let name = base.counterparty ? base.counterparty.replace(/\b(?:\+?256|0)7\d{8}\b/, '').trim() : '';
  name = name.replace(/\s+(?:on|at|ref|reason)$/i, '').replace(/[^A-Za-z .'-]/g, '').trim().slice(0, 80);
  const network = base.account_key === 'airtel_money' ? 'airtel' : (base.account_key === 'mtn_momo' || /momopay|mobile money|y'ello/i.test(flat) ? 'mtn' : (/\bTID\b/.test(flat) ? 'airtel' : (/financial transaction id/i.test(flat) ? 'mtn' : '')));
  const toMakaug = new RegExp(`makaug|${MERCHANT_CODE}`, 'i').test(flat);
  // A "you have sent" SMS is the payer's own phone: the name in it is us, not them.
  let recipient = null;
  if (base.direction === 'out') { recipient = name || null; name = ''; }
  return {
    network, direction: base.direction, amount_ugx: base.amount_ugx || null,
    sender_name: name || null, sender_phone: base.direction === 'out' ? null : (phone ? phone.replace(/\s+/g, '') : null), recipient,
    txn_id: base.reference || null, paid_at: parseSmsDate(flat), to_makaug: toMakaug
  };
}

async function planFor(phone) {
  const ctx = await require('./billingOpsService').payerContext(db, phone).catch(() => ({}));
  const p = publishedPricing();
  if (ctx.purpose === 'listing_fee') return { purpose: 'listing_fee', min_ugx: Number(p.owner_listing.monthly_ugx), label: p.owner_listing.label, agent_id: null, who: ctx.property?.title || 'listing' };
  return { purpose: ctx.purpose || 'agent_subscription', min_ugx: Number(p.agent.monthly_ugx), label: p.agent.label, agent_id: ctx.agent?.id || null, who: ctx.agent?.full_name || '' };
}

async function txnUsed(txn) {
  const t = String(txn || '').trim();
  if (!t) return null;
  const [proof, claim, entry] = await Promise.all([
    safeRows("SELECT id, status FROM payment_sms_proofs WHERE LOWER(txn_id) = LOWER($1) AND status <> 'rejected' LIMIT 1", [t]),
    safeRows("SELECT id, status FROM payment_claims WHERE LOWER(reference) = LOWER($1) AND status <> 'rejected' LIMIT 1", [t]),
    safeRows('SELECT id FROM revenue_entries WHERE LOWER(reference) = LOWER($1) AND voided_at IS NULL LIMIT 1', [t])
  ]);
  if (proof[0]) return 'already uploaded as proof';
  if (entry[0]) return 'already in the payments ledger';
  if (claim[0]) return `already on a ${claim[0].status} payment claim`;
  return null;
}

/** The guards. hard = refuse; flags = King sees them. */
async function checkFields(fields = {}, { phone = '', now = new Date() } = {}) {
  if (fields.txn_id) await db.query(`UPDATE payment_sms_proofs p SET status = 'rejected' FROM payment_claims c WHERE c.id = p.claim_id AND c.status = 'rejected' AND p.status <> 'rejected' AND LOWER(p.txn_id) = LOWER($1)`, [String(fields.txn_id).trim()]).catch(() => null);
  const plan = await planFor(phone);
  const hard = []; const flags = [];
  const amount = Number(String(fields.amount_ugx || '').replace(/[^\d]/g, '')) || 0;
  const txn = String(fields.txn_id || '').trim().replace(/\s+/g, '');
  if (!txn || txn.length < 5) hard.push('Type the transaction ID from the SMS.');
  else { const used = await txnUsed(txn); if (used) hard.push(`This transaction ID was ${used}.`); }
  if (!amount) hard.push('Type the amount paid.');
  else if (amount < plan.min_ugx) hard.push(`UGX ${amount.toLocaleString('en-GB')} is less than the plan price (${plan.label}).`);
  const at = fields.paid_at ? new Date(fields.paid_at) : null;
  if (!at || Number.isNaN(at.getTime())) hard.push('Type the date and time on the SMS.');
  else if (at.getTime() > now.getTime() + 15 * 60000) hard.push('The SMS date is in the future. Check it.');
  else if (now.getTime() - at.getTime() > RECENT_HOURS * 3600000) hard.push(`The SMS is older than ${Math.round(RECENT_HOURS / 24)} days. King must record old payments by hand.`);
  const sk = key9(fields.sender_phone);
  const callKey = key9(phone);
  if (!sk) flags.push(fields.direction === 'out' ? "Screenshot from the payer's phone: no sender number on it" : 'No sender number on the SMS');
  else if (callKey && sk !== callKey) flags.push(`Paid from a different number (${mask(sk)}, the call was ${mask(callKey)})`);
  if (!String(fields.sender_name || '').trim() && fields.direction !== 'out') flags.push('No sender name');
  if (fields.direction === 'out' && fields.to_makaug === false) flags.push('Sent-money SMS that does not name makaug or merchant 27248497');
  if (fields.network && !['mtn', 'airtel'].includes(fields.network)) flags.push('Unknown network');
  return { plan, hard, flags, amount, txn, sender_phone_key: sk || null };
}

async function storeImage(dataUrl) {
  const raw = String(dataUrl || '');
  const m = raw.match(/^data:(image\/(?:png|jpe?g|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw err(400, 'Add the screenshot (PNG or JPG).');
  const bytes = Math.floor(m[2].length * 3 / 4);
  if (bytes > MAX_IMAGE_BYTES) throw err(413, 'The screenshot is too big (max 6 MB). Crop it to the SMS.');
  const storage = require('./cloudMediaStorageService');
  const configured = typeof storage.cloudMediaStorageConfigured === 'function' ? storage.cloudMediaStorageConfigured() : false;
  if (configured) {
    const ref = await storage.prepareMediaUrlForStorage(raw, {
      keyPrefix: `payment-sms-proofs/${require('crypto').randomUUID()}`, filename: 'payment-sms.jpg', label: 'payment SMS screenshot',
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'], maxBytes: MAX_IMAGE_BYTES, isPrivate: true
    });
    if (!ref || ref.startsWith('data:')) throw err(502, 'The screenshot could not be stored. Try again.');
    return { ref, bytes };
  }
  if (process.env.NODE_ENV === 'production') throw err(503, 'Photo storage is not set up, so the proof cannot be kept.');
  return { ref: raw, bytes }; // local / test only
}

/** Ronald (or King) submits the checked fields + the screenshot. */
async function submitProof({ attemptId = null, phone = '', personKey = '', imageDataUrl = '', ocrText = '', ocrConfidence = null, fields = {}, now = new Date() } = {}) {
  let callPhone = phone;
  if (attemptId) callPhone = (await rows('SELECT phone FROM call_attempts WHERE id::text = $1', [String(attemptId)]))[0]?.phone || phone;
  const pk = key9(callPhone);
  if (pk.length !== 9) throw err(400, 'Pick the agent or number this payment is for.');
  const sbx = require('./callingSandbox');
  if (sbx.isTestKey(pk) || await sbx.isSandbox(personKey)) throw err(409, `${sbx.PRACTICE_MSG} stores the screenshot and makes a payment claim for King. The fields above show what it read.`, 'practice');
  const parsed = parseSmsText(ocrText);
  const c = await checkFields({ ...parsed, ...fields }, { phone: callPhone, now });
  if (c.hard.length) throw err(422, c.hard.join(' '), 'guard');
  const edited = ['amount_ugx', 'sender_name', 'sender_phone', 'txn_id', 'paid_at'].filter((k) => fields[k] != null && String(fields[k] || '').replace(/\s+/g, '') !== String(parsed[k] || '').replace(/\s+/g, '') && !(k === 'amount_ugx' && Number(fields[k]) === Number(parsed[k])) && !(k === 'paid_at' && parsed[k] && new Date(fields[k]).getTime() === new Date(parsed[k]).getTime()));
  const flags = [...c.flags];
  if (ocrConfidence != null && Number(ocrConfidence) < 60) flags.push(`Low OCR confidence (${Math.round(Number(ocrConfidence))}%)`);
  if (edited.length) flags.push(`Corrected by hand: ${edited.join(', ').replace(/_/g, ' ')}`);
  const img = await storeImage(imageDataUrl);
  const proof = (await rows(
    `INSERT INTO payment_sms_proofs (attempt_id, phone_key, agent_id, purpose, uploaded_by, image_ref, image_bytes, ocr_text, ocr_confidence, parsed, network, amount_ugx, sender_name, sender_phone_key, txn_id, paid_at, flags, edited_fields)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18) RETURNING *`,
    [attemptId || null, pk, c.plan.agent_id, c.plan.purpose, String(personKey || 'staff').slice(0, 60), img.ref, img.bytes, String(ocrText || '').slice(0, 4000),
      ocrConfidence == null ? null : Number(ocrConfidence), JSON.stringify(parsed), fields.network || parsed.network || null, c.amount,
      String(fields.sender_name || parsed.sender_name || '').slice(0, 80) || null, c.sender_phone_key, c.txn, new Date(fields.paid_at || parsed.paid_at).toISOString(), flags, edited]
  ).catch((e) => { if (e.code === '23505') throw err(409, 'This transaction ID was already uploaded as proof.', 'guard'); throw e; }))[0];
  const claim = await require('./billingOpsService').createClaim(db, {
    phone: callPhone, payerName: proof.sender_name, reference: proof.txn_id, amountUgx: proof.amount_ugx,
    receiptUrl: `/api/admin/calling/sms-proofs/${proof.id}/image`, source: 'calling_sms_proof',
    message: `Payment SMS screenshot uploaded by ${proof.uploaded_by}${flags.length ? ` · flags: ${flags.join('; ')}` : ''}`
  });
  const claimId = claim?.claim?.id || claim?.id || null;
  await db.query('UPDATE payment_sms_proofs SET claim_id = $2 WHERE id = $1', [proof.id, claimId]);
  return { id: proof.id, claim_id: claimId, flags, amount_ugx: proof.amount_ugx, txn_id: proof.txn_id, plan: c.plan.label };
}

async function listProofs({ status = '' } = {}) {
  const list = await rows(
    `SELECT p.*, c.status AS claim_status, c.decided_by, c.decided_at FROM payment_sms_proofs p LEFT JOIN payment_claims c ON c.id = p.claim_id
      ${status ? 'WHERE p.status = $1' : ''} ORDER BY p.created_at DESC LIMIT 60`, status ? [status] : []);
  return list.map((p) => ({
    id: p.id, claim_id: p.claim_id, phone: mask(p.phone_key), purpose: p.purpose, by: p.uploaded_by, at: p.created_at, network: p.network,
    amount_ugx: p.amount_ugx, sender_name: p.sender_name, sender_phone: mask(p.sender_phone_key), txn_id: p.txn_id, paid_at: p.paid_at,
    flags: p.flags, edited: p.edited_fields, confidence: p.ocr_confidence == null ? null : Number(p.ocr_confidence),
    status: p.claim_status === 'confirmed' ? 'confirmed' : p.claim_status === 'rejected' ? 'rejected' : p.status,
    decided_by: p.decided_by, image: `/api/admin/calling/sms-proofs/${p.id}/image`
  }));
}

/** How the money came in, for King's confirm: the network on the screenshot. */
async function methodForClaim(claimId) {
  const p = (await rows('SELECT network, ocr_text FROM payment_sms_proofs WHERE claim_id = $1 ORDER BY created_at DESC LIMIT 1', [claimId]))[0];
  if (!p) return '';
  if (p.network === 'airtel') return 'airtel_money';
  if (p.network === 'mtn') return /momopay|27248497/i.test(p.ocr_text || '') ? 'mtn_momopay' : 'mtn_momo';
  return '';
}

/** Keep the proof's status in step with its claim (King decides on the claim). */
async function syncFromClaim(claimId) {
  await db.query(`UPDATE payment_sms_proofs p SET status = CASE c.status WHEN 'confirmed' THEN 'confirmed' WHEN 'rejected' THEN 'rejected' ELSE p.status END
                    FROM payment_claims c WHERE c.id = p.claim_id AND p.claim_id = $1`, [claimId]).catch(() => null);
}

/** The screenshot, for staff/King only: a short signed link for stored ones. */
async function imageFor(id) {
  const p = (await rows('SELECT image_ref FROM payment_sms_proofs WHERE id::text = $1', [String(id)]))[0];
  if (!p) throw err(404, 'Not found.');
  if (p.image_ref.startsWith('data:')) {
    const m = p.image_ref.match(/^data:([^;]+);base64,(.+)$/);
    return { type: m[1], buffer: Buffer.from(m[2], 'base64') };
  }
  const storage = require('./cloudMediaStorageService');
  return { redirect: storage.createSignedS3GetUrl(p.image_ref, { expiresSeconds: 300 }) };
}

module.exports = {
  methodForClaim, cleanOcr, parseSmsDate, parseSmsText, checkFields, submitProof, listProofs, syncFromClaim, imageFor, txnUsed, planFor, RECENT_HOURS, ProofError };
