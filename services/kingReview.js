'use strict';

/**
 * King review queues (Arthur, 21 Nov 2026). Pending listings split in two:
 *  - Found online to review: listings we imported from TikTok, YouTube, Facebook and websites.
 *  - Agent properties to review: listings agents and owners sent us themselves.
 * Approve and reject keep using the full listing review (all its checks); this service
 * lists, counts and handles "Send back with a note" (agent and owner listings only).
 */
const db = require('../config/database');
const reviewQueueSplit = require('../utils/reviewQueueSplit');

async function rows(sql, params = []) { return (await db.query(sql, params)).rows || []; }
const num = (v) => Number(v || 0);
const mask = (v) => { const d = String(v || '').replace(/\D/g, ''); return d.length >= 3 ? `•••${d.slice(-3)}` : ''; };
const httpError = (status, message) => Object.assign(new Error(message), { status });

// The same found-online rule as the staff desk (utils/reviewQueueSplit.js).
const FOUND_ONLINE_SQL = reviewQueueSplit.foundOnlineSql('p');
// Sent back and not changed since: waiting on the agent, not on us.
const SENT_BACK_SQL = `(p.extra_fields->>'sent_back_at' IS NOT NULL AND p.updated_at <= (p.extra_fields->>'sent_back_at')::timestamptz + INTERVAL '2 minutes')`;
const KINDS = { found: FOUND_ONLINE_SQL, agent: `NOT ${FOUND_ONLINE_SQL}` };

function platformOf(r) {
  const id = String(r.platform_id || '').toLowerCase();
  const src = `${id} ${String(r.source_url || '').toLowerCase()} ${String(r.source_type || '').toLowerCase()}`;
  if (/tiktok/.test(src)) return 'TikTok';
  if (/youtube|youtu\.be|creator_channel/.test(src)) return 'YouTube';
  if (/facebook|fb\.com/.test(src)) return 'Facebook';
  if (/instagram/.test(src)) return 'Instagram';
  if (/x\.com|twitter/.test(src)) return 'X';
  return 'Website';
}

async function counts() {
  const r = (await rows(
    `SELECT COUNT(*) FILTER (WHERE ${FOUND_ONLINE_SQL}) AS found,
            COUNT(*) FILTER (WHERE NOT ${FOUND_ONLINE_SQL} AND NOT ${SENT_BACK_SQL}) AS agent,
            COUNT(*) FILTER (WHERE NOT ${FOUND_ONLINE_SQL} AND ${SENT_BACK_SQL}) AS agent_sent_back
       FROM properties p WHERE p.status = 'pending'`))[0] || {};
  let stays = 0;
  try { stays = num((await rows(`SELECT COUNT(*) AS n FROM st_listing WHERE status = 'king_review'`))[0]?.n); } catch (_) { stays = 0; }
  return { found_online: num(r.found), agent_props: num(r.agent), agent_sent_back: num(r.agent_sent_back), short_stays: stays };
}

const FILTERS = {
  found: {
    tiktok: `lower(COALESCE(p.extra_fields->>'source_platform_id', '') || ' ' || COALESCE(p.extra_fields->>'source_url', '')) LIKE '%tiktok%'`,
    youtube: `lower(COALESCE(p.extra_fields->>'source_platform_id', '') || ' ' || COALESCE(p.extra_fields->>'source_url', '') || ' ' || COALESCE(p.extra_fields->>'source_type', '')) ~ '(youtube|youtu\\.be|creator_channel)'`,
    facebook: `lower(COALESCE(p.extra_fields->>'source_platform_id', '') || ' ' || COALESCE(p.extra_fields->>'source_url', '')) ~ '(facebook|fb\\.com)'`,
    no_price: `(COALESCE(p.price, 0) <= 0 AND COALESCE(p.price_on_application, false) = false)`,
    no_pin: `(p.latitude IS NULL OR p.longitude IS NULL OR COALESCE(p.extra_fields->>'map_pin_confirmed', '') = 'false')`
  },
  agent: {
    agents: `(p.agent_id IS NOT NULL OR lower(COALESCE(p.lister_type, '')) IN ('agent', 'broker') OR lower(COALESCE(p.listed_via, '')) LIKE '%broker%')`,
    owners: `NOT (p.agent_id IS NOT NULL OR lower(COALESCE(p.lister_type, '')) IN ('agent', 'broker') OR lower(COALESCE(p.listed_via, '')) LIKE '%broker%')`,
    sent_back: SENT_BACK_SQL,
    fee_overdue: `(a.id IS NOT NULL AND COALESCE(a.fee_exempt, false) = false AND (a.paid_until IS NULL OR a.paid_until < (NOW() AT TIME ZONE 'Africa/Kampala')::date))`
  }
};

/** One page of a queue, oldest first, with the checks King looks at before deciding. */
async function queue(kind, { filter = '', limit = 50, offset = 0 } = {}) {
  if (!KINDS[kind]) throw httpError(400, 'Unknown queue.');
  const where = [`p.status = 'pending'`, KINDS[kind]];
  if (kind === 'agent' && filter !== 'sent_back') where.push(`NOT ${SENT_BACK_SQL}`);
  if (filter) { const f = FILTERS[kind][filter]; if (!f) throw httpError(400, 'Unknown filter.'); where.push(f); }
  const lim = Math.min(100, Math.max(1, Number(limit) || 50));
  const off = Math.max(0, Number(offset) || 0);
  const list = await rows(
    `SELECT p.id, p.title, p.inquiry_reference, p.listing_type, p.district, p.area, p.price, p.price_currency, p.price_period, p.price_on_application,
            p.latitude, p.longitude, p.created_at, p.updated_at, p.lister_name, p.lister_phone, p.lister_type, p.listed_via, p.agent_id,
            p.extra_fields->>'source_platform_id' AS platform_id, COALESCE(p.extra_fields->>'source_url', p.extra_fields->>'source_post_url') AS source_url,
            p.extra_fields->>'source_type' AS source_type, COALESCE(p.extra_fields->>'source_name', p.extra_fields->>'source_agent_name') AS source_name,
            COALESCE(p.extra_fields->>'first_posted_online_at', p.extra_fields->>'source_published_at') AS posted_at,
            p.extra_fields->>'map_pin_confirmed' AS pin_confirmed, COALESCE(p.extra_fields->>'contact_phone', p.extra_fields->>'public_contact_phone') AS source_phone,
            p.extra_fields->>'sent_back_at' AS sent_back_at, p.extra_fields->>'sent_back_note' AS sent_back_note,
            COALESCE(p.extra_fields->>'thumbnail_url', p.extra_fields->>'source_thumbnail_url') AS thumb,
            img.n AS photos, img.first_url,
            a.full_name AS agent_name, a.paid_until AS agent_paid_until, COALESCE(a.fee_exempt, false) AS agent_fee_exempt
       FROM properties p
       LEFT JOIN LATERAL (SELECT COUNT(*) AS n, (array_agg(url ORDER BY is_primary DESC NULLS LAST, sort_order NULLS LAST))[1] AS first_url FROM property_images i WHERE i.property_id = p.id) img ON true
       LEFT JOIN agents a ON a.id = p.agent_id
      WHERE ${where.join(' AND ')}
      ORDER BY p.created_at ASC
      LIMIT ${lim} OFFSET ${off}`);
  const total = num((await rows(
    `SELECT COUNT(*) AS n FROM properties p LEFT JOIN agents a ON a.id = p.agent_id WHERE ${where.join(' AND ')}`))[0]?.n);
  const today = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
  const items = list.map((r) => {
    const photos = num(r.photos);
    const hasPrice = num(r.price) > 0 || r.price_on_application === true;
    const pin = r.latitude != null && r.longitude != null && r.pin_confirmed !== 'false';
    const contact = Boolean(String(r.lister_phone || r.source_phone || '').replace(/\D/g, ''));
    const paidUntil = r.agent_paid_until ? String(r.agent_paid_until instanceof Date ? r.agent_paid_until.toISOString() : r.agent_paid_until).slice(0, 10) : null;
    const isAgent = Boolean(r.agent_id) || ['agent', 'broker'].includes(String(r.lister_type || '').toLowerCase()) || /broker/i.test(String(r.listed_via || ''));
    const checks = [
      { ok: photos > 0, text: photos ? `${photos} photo${photos === 1 ? '' : 's'}` : 'No photos' },
      { ok: hasPrice, text: hasPrice ? 'Price' : 'Price missing' },
      { ok: pin, text: pin ? 'Map pin' : 'Check map pin', warn: !pin },
      { ok: contact, text: contact ? 'Contact number' : 'No contact number' }
    ];
    if (kind === 'agent' && r.agent_id && !r.agent_fee_exempt) {
      const overdue = !paidUntil || paidUntil < today;
      checks.push({ ok: !overdue, text: overdue ? (paidUntil ? 'Agent fee overdue' : 'Agent has not paid yet') : `Paid until ${paidUntil}`, warn: overdue });
    }
    const out = {
      id: r.id, ref: r.inquiry_reference || '', title: r.title || 'Untitled listing', type: r.listing_type || '',
      place: [r.area, r.district].filter(Boolean).join(', '),
      price: num(r.price), currency: r.price_currency || 'UGX', period: r.price_period || '', poa: r.price_on_application === true,
      submitted_at: r.created_at, photo: r.first_url || r.thumb || '', checks, waiting_days: Math.floor((Date.now() - new Date(r.created_at).getTime()) / 86400000)
    };
    if (kind === 'found') Object.assign(out, { platform: platformOf(r), source_name: r.source_name || '', source_url: /^https?:\/\//.test(String(r.source_url || '')) ? r.source_url : '', posted_at: r.posted_at || null });
    else {
      const phone = String(r.lister_phone || '').replace(/\D/g, '');
      Object.assign(out, {
        who: isAgent ? 'Agent' : 'Owner', name: r.agent_name || r.lister_name || '', phone: mask(r.lister_phone), paid_until: paidUntil,
        sent_back_at: r.sent_back_at || null, sent_back_note: r.sent_back_note || '',
        // King only: texts go from the company phone, King presses send.
        sms_phone: phone ? `+${phone.startsWith('256') ? phone : `256${phone.replace(/^0/, '')}`}` : ''
      });
    }
    return out;
  });
  return { kind, filter, total, items };
}

/** This week's decisions per queue (approved, rejected, sent back). */
async function weekStats() {
  const r = (await rows(
    `SELECT COUNT(*) FILTER (WHERE ${FOUND_ONLINE_SQL} AND p.status = 'approved') AS found_approved,
            COUNT(*) FILTER (WHERE ${FOUND_ONLINE_SQL} AND p.status = 'rejected') AS found_rejected,
            COUNT(*) FILTER (WHERE NOT ${FOUND_ONLINE_SQL} AND p.status = 'approved') AS agent_approved,
            COUNT(*) FILTER (WHERE NOT ${FOUND_ONLINE_SQL} AND p.status = 'rejected') AS agent_rejected
       FROM properties p WHERE p.reviewed_at > NOW() - INTERVAL '7 days'`))[0] || {};
  const found = (await rows(`SELECT COUNT(*) AS n FROM properties p WHERE ${FOUND_ONLINE_SQL} AND p.created_at > NOW() - INTERVAL '24 hours'`))[0] || {};
  const back = (await rows(`SELECT COUNT(*) AS n FROM properties p WHERE (p.extra_fields->>'sent_back_at')::timestamptz > NOW() - INTERVAL '7 days'`))[0] || {};
  return { found_approved: num(r.found_approved), found_rejected: num(r.found_rejected), agent_approved: num(r.agent_approved), agent_rejected: num(r.agent_rejected), found_today: num(found.n), sent_back: num(back.n) };
}

/**
 * Send an agent or owner listing back with a note. It stays pending (not live) and leaves
 * King's waiting count until the agent changes it. The note shows on the agent's own
 * listing (moderation reason) and in the review history.
 */
async function sendBack(id, { note = '', actor = 'King' } = {}) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) throw httpError(400, 'Invalid listing id.');
  const text = String(note || '').trim().replace(/\s+/g, ' ').slice(0, 500);
  if (text.length < 5) throw httpError(400, 'Write what the agent needs to change.');
  const p = (await rows(`SELECT p.id, p.status, ${FOUND_ONLINE_SQL} AS found FROM properties p WHERE p.id = $1`, [id]))[0];
  if (!p) throw httpError(404, 'That listing was not found.');
  if (p.status !== 'pending') throw httpError(409, 'Only listings waiting for review can be sent back.');
  if (p.found) throw httpError(400, 'Found-online listings have no agent to send back to. Fix details or reject.');
  const stamp = new Date().toISOString();
  const out = (await rows(
    `UPDATE properties p SET moderation_reason = $2,
            moderation_notes = CONCAT_WS(E'\\n', NULLIF(p.moderation_notes, ''), $3::text),
            extra_fields = COALESCE(p.extra_fields, '{}'::jsonb) || jsonb_build_object('sent_back_at', $4::text, 'sent_back_by', $5::text, 'sent_back_note', $6::text),
            updated_at = $4::timestamptz
      WHERE p.id = $1 AND p.status = 'pending' RETURNING p.id, p.inquiry_reference`,
    [id, `Changes needed: ${text}`, `[${stamp.slice(0, 16).replace('T', ' ')} UTC] Sent back by ${actor}: ${text}`, stamp, String(actor).slice(0, 80), text]))[0];
  if (!out) throw httpError(409, 'Only listings waiting for review can be sent back.');
  return { id: out.id, ref: out.inquiry_reference || '', sent_back_at: stamp };
}

module.exports = { counts, queue, weekStats, sendBack, platformOf, FOUND_ONLINE_SQL, SENT_BACK_SQL, mask };
