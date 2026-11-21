'use strict';

const db = require('../config/database');

/**
 * Staff "Leads & WhatsApp" desk (Arthur, approved 21 Nov 2026).
 * - One lead queue, worked from the top: list-my-property leads, listing
 *   enquiries, no-match needs and alert-me searches that have a phone.
 * - WhatsApp is read only. Staff text (SMS) or call; nothing here sends a
 *   WhatsApp message, and nothing here sends anything at all: the client opens
 *   sms:/tel: links on the company phone.
 * - Phones are masked in everything staff read (•••last 3). The dial number
 *   only rides in the link the Text / Call button opens.
 */

const DAY = 86400000;
const QUEUE_TYPES = ['listing_owner', 'enquiry', 'viewing', 'callback', 'property_need_unavailable', 'property_need', 'property_need_request', 'saved_search', 'buyer'];
const OPEN = ['open', 'contacted', 'qualified', 'handed_over'];
const DONE = ['won', 'lost', 'closed', 'spam'];
const FILTERS = ['action', 'list', 'looking', 'asked', 'mine', 'done'];
const OUTCOMES = {
  no_answer: 'No answer',
  spoke: 'Spoke to them',
  sent_matches: 'Sent matches by text',
  viewing: 'Viewing booked',
  call_back: 'Call back later',
  listed: 'Listed / done',
  not_interested: 'Not interested',
  wrong_number: 'Wrong number'
};

function err(status, message) { const e = new Error(message); e.status = status; return e; }
function digits(v) { return String(v || '').replace(/\D/g, ''); }
function dialOf(...values) {
  for (const v of values) {
    let d = digits(v);
    if (d.length < 9 || d.length > 13) continue;
    if (d.length === 9) d = '256' + d;
    else if (d.length === 10 && d[0] === '0') d = '256' + d.slice(1);
    return '+' + d;
  }
  return '';
}
function mask(phone) { const d = digits(phone); return d.length >= 7 ? '•••' + d.slice(-3) : ''; }
function shortName(name) {
  const parts = String(name || '').replace(/[^\p{L}\s'-]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  const first = parts[0][0].toUpperCase() + parts[0].slice(1).toLowerCase();
  return parts.length > 1 ? `${first} ${parts[parts.length - 1][0].toUpperCase()}.` : first;
}
function firstName(name) { return String(shortName(name) || '').split(' ')[0] || ''; }
function money(v) {
  const n = Number(v || 0);
  if (!n) return '';
  if (n >= 1e6) return `UGX ${Math.round(n / 1e5) / 10}m`.replace('.0m', 'm');
  if (n >= 1e3) return `UGX ${Math.round(n / 1e3)}k`;
  return `UGX ${n}`;
}
function typeOf(row) {
  const t = String(row.lead_type || '');
  if (t === 'listing_owner' || /^(list_property|listing_submission)/.test(String(row.source || ''))) return 'list';
  if (t === 'enquiry' || t === 'viewing') return 'asked';
  if (t === 'callback') return 'callback';
  return 'looking';
}
function searchPath(text) {
  const s = String(text || '').toLowerCase();
  if (/\b(land|plot|acre)/.test(s)) return '/land';
  if (/\b(buy|sale|for sale|purchase)/.test(s)) return '/for-sale';
  return '/to-rent';
}
function areaOf(row) {
  const m = row.metadata || {};
  const raw = row.location || m.preferred_area || m.location || '';
  const fromText = /\b(?:in|at|around|near)\s+([A-Z][a-zA-Z]+)/.exec(String(row.message || m.original_message || m.query_text || ''));
  return String(raw || (fromText ? fromText[1] : '')).split(',')[0].trim();
}
function matchesLink(row) {
  const area = areaOf(row);
  const path = searchPath([row.category, row.message, (row.metadata || {}).search_type].join(' '));
  return `makaug.com${path}${area ? `?area=${encodeURIComponent(area)}` : ''}`;
}
function sourceLabel(row) {
  const s = String(row.source || '');
  if (s === 'alert_me_search') return 'Alert-me search';
  if (/whatsapp_ai|ai_chatbot/.test(s)) return 'WhatsApp AI';
  if (/whatsapp_no_match/.test(s)) return 'WhatsApp · no match found';
  if (/whatsapp_missed_call/.test(s)) return 'Missed WhatsApp call';
  if (/whatsapp_read_only_desk/.test(s)) return 'WhatsApp · added by staff';
  if (/listing_detail.*whatsapp/.test(s)) return 'Listing page · WhatsApp button';
  if (/listing_detail/.test(s)) return 'Listing page';
  if (/list_property_online/.test(s)) return 'Website · "List my property"';
  if (/listing_submission/.test(s)) return 'Website · listing form';
  if (/whatsapp/.test(s) || row.channel === 'whatsapp') return 'WhatsApp';
  return 'Website';
}
function wantOf(row) {
  const m = row.metadata || {};
  const t = typeOf(row);
  const area = areaOf(row);
  if (t === 'list') {
    const cat = String(row.category || '').toLowerCase();
    const lt = String(m.listing_type || (['sale', 'rent'].includes(cat) ? cat : '')).toLowerCase();
    const what = m.title || row.listing_title || (cat && !['sale', 'rent', 'land'].includes(cat) ? `a ${cat}` : (cat === 'land' ? 'land' : 'a property'));
    const forWhat = m.title || row.listing_title ? '' : (lt === 'sale' ? ' for sale' : (lt === 'rent' ? ' to rent' : ''));
    return `Wants to list ${what}${forWhat}${area && !String(what).includes(area) ? ` in ${area}` : ''}`;
  }
  if (t === 'asked') return `Asked about ${row.listing_ref || m.property_reference || 'a listing'}${row.listing_title ? ` (${row.listing_title})` : ''}`;
  if (t === 'callback') return 'Rang on WhatsApp and wants a call back';
  const need = row.message || m.original_message || m.query_text || m.summary || row.alert_label || '';
  if (need) return `Looking: ${String(need).slice(0, 90)}`;
  const parts = [row.category || 'a place', area ? `in ${area}` : '', row.budget ? `up to ${money(row.budget)}` : ''].filter(Boolean);
  return `Looking for ${parts.join(' ')}`;
}
function stageOf(row) {
  const st = String(row.lead_status || 'open');
  if (DONE.includes(st)) return 'done';
  if (String(row.lifecycle_stage || '') === 'viewing') return 'viewing';
  if (st === 'qualified') return 'matched';
  if (st === 'contacted' || st === 'handed_over') return 'contacted';
  return 'new';
}
function when(at) {
  try { return new Date(at).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Kampala' }); } catch (_) { return ''; }
}
function nextOf(row, item, now) {
  const fu = row.next_follow_up_at ? new Date(row.next_follow_up_at) : null;
  const name = firstName(row.contact_name);
  const hi = `Hi${name ? ` ${name}` : ''}, this is MakaUg.`;
  if (item.stage === 'viewing') return { label: `Viewing ${when(fu)}`, button: '📅 See viewing', action: 'call', dial: item.dial };
  if (fu && fu > now) return { label: `Call back booked ${when(fu)}`, button: '📞 Call', action: 'call', dial: item.dial };
  if (item.type === 'list') return { label: 'Call to help them list', button: '📞 Call now', action: 'call', dial: item.dial, sms: `${hi} We can help you list your property free on makaug.com. When can we call you?` };
  if (item.type === 'asked') return { label: 'Check the owner was told', button: '📞 Call owner', action: 'call', dial: item.owner_dial || item.dial };
  if (item.type === 'callback') return { label: 'Call them back', button: '📞 Call now', action: 'call', dial: item.dial };
  return { label: 'Text matching listings', button: '✉️ Text matches', action: 'text', dial: item.dial, sms: `${hi} Here are places that match what you asked for: ${matchesLink(row)}` };
}

function toItem(row, userId, now = new Date()) {
  const m = row.metadata || {};
  const sub = m.submitted_contact && typeof m.submitted_contact === 'object' ? m.submitted_contact : {};
  const type = typeOf(row);
  const dial = dialOf(row.contact_phone, row.contact_whatsapp, sub.phone, m.phone, type === 'list' ? row.lister_phone : '', row.alert_phone);
  const ownerDial = type === 'asked' ? dialOf(row.lister_phone) : '';
  const who = shortName(row.contact_name || sub.name || m.target_contact_name || row.alert_name || (type === 'list' ? row.lister_name : '')) || 'Unknown';
  const item = {
    key: row.kind === 'alert' ? `ss:${row.id}` : String(row.id),
    kind: row.kind || 'lead',
    type,
    who,
    initials: who === 'Unknown' ? '?' : who.split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase(),
    phone: mask(dial || ownerDial),
    dial,
    owner_dial: ownerDial,
    want: wantOf(row),
    source: sourceLabel(row),
    at: row.created_at,
    stage: stageOf(row),
    follow_up_at: row.next_follow_up_at || null,
    mine: Boolean(userId && row.assigned_to_user_id && String(row.assigned_to_user_id) === String(userId)),
    taken: Boolean(row.assigned_to_user_id && (!userId || String(row.assigned_to_user_id) !== String(userId))),
    taken_by: row.assigned_name ? shortName(row.assigned_name) : ''
  };
  item.next = nextOf(row, item, now);
  if (!item.next.dial) delete item.next.dial;
  return item;
}

function needsAction(item, now = new Date()) {
  if (item.stage === 'done' || item.taken) return false;
  const tomorrow = new Date(now.getTime() + DAY);
  if (item.follow_up_at) return new Date(item.follow_up_at) < tomorrow;
  return item.stage === 'new' || item.stage === 'contacted';
}
function inFilter(item, filter, now) {
  if (filter === 'done') return item.stage === 'done';
  if (item.stage === 'done') return false;
  if (filter === 'action') return needsAction(item, now);
  if (filter === 'mine') return item.mine;
  return item.type === filter;
}
function rank(item, now) {
  const fu = item.follow_up_at ? new Date(item.follow_up_at).getTime() : null;
  if (fu && fu <= now.getTime() + DAY) return 0;
  return { new: 1, contacted: 2, matched: 3, viewing: 4, done: 5 }[item.stage] || 5;
}

const LEAD_SQL = `
  SELECT 'lead' AS kind, l.id, l.lead_type, l.source, l.channel, l.lead_status, l.lifecycle_stage, l.category, l.location,
         l.budget, LEFT(l.message, 300) AS message,
         (l.metadata - 'metering') AS metadata, l.created_at, l.updated_at, l.next_follow_up_at, l.assigned_to_user_id,
         c.name AS contact_name, c.phone AS contact_phone, c.whatsapp AS contact_whatsapp,
         p.title AS listing_title, p.inquiry_reference AS listing_ref, p.lister_name, p.lister_phone,
         NULLIF(TRIM(CONCAT_WS(' ', au.first_name, au.last_name)), '') AS assigned_name,
         NULL::text AS alert_phone, NULL::text AS alert_name, NULL::text AS alert_label
  FROM leads l
  LEFT JOIN contacts c ON c.id = l.contact_id
  LEFT JOIN properties p ON p.id = l.listing_id
  LEFT JOIN users au ON au.id = l.assigned_to_user_id
  WHERE l.deleted_at IS NULL AND COALESCE(l.is_test, FALSE) = FALSE
    AND l.lead_type = ANY($1::text[])
    AND (
      (l.lead_status = ANY($2::text[]) AND l.lead_status <> 'handed_over' AND (l.created_at >= NOW() - INTERVAL '60 days' OR l.next_follow_up_at >= NOW() - INTERVAL '14 days' OR l.assigned_to_user_id = $3::uuid))
      OR (l.lead_status = 'handed_over' AND l.created_at >= NOW() - INTERVAL '14 days')
      OR (l.lead_status = ANY($4::text[]) AND l.updated_at >= NOW() - INTERVAL '30 days' AND l.assigned_to_user_id IS NOT NULL)
    )
  ORDER BY l.created_at DESC
  LIMIT 600`;

// Alert-me searches with a phone that have no lead yet.
const ALERT_SQL = `
  SELECT 'alert' AS kind, ss.id, 'saved_search' AS lead_type, 'alert_me_search' AS source, NULL::text AS channel,
         'open' AS lead_status, 'new' AS lifecycle_stage, ss.category, ss.location, ss.max_price AS budget,
         NULL::text AS message, '{}'::jsonb AS metadata, ss.created_at, ss.created_at AS updated_at, NULL::timestamptz AS next_follow_up_at,
         NULL::uuid AS assigned_to_user_id, NULL::text AS contact_name, NULL::text AS contact_phone, NULL::text AS contact_whatsapp,
         NULL::text AS listing_title, NULL::text AS listing_ref, NULL::text AS lister_name, NULL::text AS lister_phone, NULL::text AS assigned_name,
         COALESCE(NULLIF(ss.phone, ''), u.phone) AS alert_phone,
         NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), '') AS alert_name, ss.label AS alert_label
  FROM saved_searches ss
  LEFT JOIN users u ON u.id = ss.user_id
  WHERE ss.created_from = 'results_alert_button' AND ss.status = 'active'
    AND ss.created_at >= NOW() - INTERVAL '30 days'
    AND LENGTH(REGEXP_REPLACE(COALESCE(NULLIF(ss.phone, ''), u.phone, ''), '\\D', '', 'g')) >= 9
    AND NOT EXISTS (SELECT 1 FROM leads l WHERE l.lead_type = 'saved_search' AND l.metadata->>'saved_search_id' = ss.id::text AND l.deleted_at IS NULL)
  ORDER BY ss.created_at DESC
  LIMIT 100`;

// Latest inbound WhatsApp message per number in the last 24 hours (read only).
const CHAT_SQL = `
  WITH latest AS (
    SELECT DISTINCT ON (m.user_phone) m.id, m.user_phone, m.message_type, m.created_at,
           LEFT(COALESCE(NULLIF(m.payload->>'effectiveBody', ''), NULLIF(m.payload->>'body', ''), ''), 400) AS body,
           m.payload->'metadata'->>'push_name' AS push_name
    FROM whatsapp_messages m
    WHERE m.direction = 'inbound' AND m.created_at >= NOW() - INTERVAL '24 hours'
      AND COALESCE(m.payload->'metadata'->>'chat_id', '') NOT LIKE '%@g.us'
    ORDER BY m.user_phone, m.created_at DESC
  )
  SELECT l.*,
         EXISTS (SELECT 1 FROM whatsapp_messages o WHERE o.user_phone = l.user_phone AND o.direction = 'outbound' AND o.created_at > l.created_at) AS answered,
         (SELECT c.name FROM contacts c WHERE RIGHT(REGEXP_REPLACE(COALESCE(c.phone, c.whatsapp, ''), '\\D', '', 'g'), 9) = RIGHT(l.user_phone, 9) AND c.name IS NOT NULL LIMIT 1) AS contact_name,
         (SELECT ld.id FROM leads ld JOIN contacts c ON c.id = ld.contact_id
           WHERE RIGHT(REGEXP_REPLACE(COALESCE(c.phone, c.whatsapp, ''), '\\D', '', 'g'), 9) = RIGHT(l.user_phone, 9)
             AND ld.deleted_at IS NULL AND ld.lead_status = ANY($1::text[]) AND ld.created_at >= NOW() - INTERVAL '30 days'
           ORDER BY ld.created_at DESC LIMIT 1) AS lead_id
  FROM latest l
  WHERE LENGTH(l.user_phone) BETWEEN 9 AND 13
  ORDER BY l.created_at DESC
  LIMIT 30`;

function chatText(row) {
  if (row.body) return row.body;
  return { voice: '🎤 Voice note', media: '📷 Photo or video', image: '📷 Photo', video: '🎬 Video' }[row.message_type] || '(no text)';
}
function suggestFor(text, name, type) {
  const s = String(text || '').toLowerCase();
  const n = name ? ` ${name}` : '';
  if (/\b(paid|momo|mobile money|fee|payment|pay)\b/.test(s)) return { kind: 'paid', tip: 'Check Owes us money. If you see the MoMo text, tell King. Do not reply on WhatsApp.', sms: `Hi${n}, this is MakaUg. Thank you, we are checking your payment and will confirm today.` };
  if (/\b(list|sell my|post my|advertise|upload)\b/.test(s)) return { kind: 'list', tip: 'They want to list. Call them and help them list.', sms: `Hi${n}, this is MakaUg. We can help you list your property free on makaug.com. When can we call you?` };
  if (/\b(rent|bed|bedroom|house|apartment|room|hostel|looking|buy|land|plot|shop|office|rental)/.test(s)) {
    const link = matchesLink({ message: text });
    return { kind: 'looking', tip: `Send them matches by text: "Hi${n}, here are places that match: ${link}"`, sms: `Hi${n}, this is MakaUg. Here are places that match what you asked for: ${link}` };
  }
  if (type === 'voice' || type === 'media' || type === 'image' || type === 'video') return { kind: 'media', tip: 'They sent a voice note or photo. Call them to hear what they need.', sms: `Hi${n}, this is MakaUg. We got your message. When is a good time to call you?` };
  if (/^\W*(hi|hello|hey|hallo|good (morning|afternoon|evening)|oli otya)\W*$/.test(s.trim()) || s.trim().split(/\s+/).length <= 2) return { kind: 'hi', tip: 'They said Hi after a call. Mark "Said Hi" on their call, then text the makaug.com link.', sms: `Hi${n}, thanks for saying hi! Here is MakaUg: makaug.com` };
  return { kind: 'other', tip: 'Call them to ask what they need, or text them the makaug.com link.', sms: `Hi${n}, this is MakaUg. We got your message. When is a good time to call you?` };
}
function toChat(row) {
  const name = shortName(row.contact_name || row.push_name);
  const text = chatText(row);
  const suggest = suggestFor(row.body || '', firstName(name), row.message_type);
  return {
    id: String(row.id),
    who: name || 'Unknown',
    phone: mask(row.user_phone),
    dial: dialOf(row.user_phone),
    at: row.created_at,
    text,
    needs_reply: !row.answered,
    suggest,
    lead_id: row.lead_id || null
  };
}

async function desk(user = {}, { filter = 'action' } = {}, runner = db) {
  const f = FILTERS.includes(filter) ? filter : 'action';
  const userId = user.userId || null;
  const now = new Date();
  const [leads, alerts, chats, counts] = await Promise.all([
    runner.query(LEAD_SQL, [QUEUE_TYPES, OPEN, userId, DONE]),
    runner.query(ALERT_SQL).catch(() => ({ rows: [] })),
    runner.query(CHAT_SQL, [OPEN]).catch(() => ({ rows: [] })),
    runner.query(`SELECT
        (SELECT COUNT(*)::int FROM leads WHERE lead_type = 'listing_owner' AND deleted_at IS NULL AND COALESCE(is_test, FALSE) = FALSE AND created_at >= NOW() - INTERVAL '30 days') AS want_to_list_30d,
        (SELECT COUNT(DISTINCT user_phone)::int FROM whatsapp_messages WHERE direction = 'inbound' AND created_at >= NOW() - INTERVAL '7 days') AS chats_week`).catch(() => ({ rows: [{}] }))
  ]);
  const all = [...leads.rows, ...alerts.rows].map((r) => toItem(r, userId, now)).filter((i) => i.dial || i.owner_dial);
  const by = {};
  FILTERS.forEach((k) => { by[k] = all.filter((i) => inFilter(i, k, now)).length; });
  const items = all.filter((i) => inFilter(i, f, now))
    .sort((a, b) => rank(a, now) - rank(b, now) || new Date(b.at) - new Date(a.at))
    .slice(0, 60);
  const c = counts.rows[0] || {};
  const chatList = chats.rows.map(toChat);
  return {
    filter: f,
    counts: {
      need_action: by.action,
      want_to_list_30d: c.want_to_list_30d || 0,
      looking: by.looking,
      chats_week: c.chats_week || 0,
      chats_need_reply: chatList.filter((x) => x.needs_reply).length,
      by_filter: by
    },
    items,
    chats: chatList,
    outcomes: OUTCOMES
  };
}

async function count(runner = db) {
  const d = await desk({}, { filter: 'action' }, runner);
  return { need_action: d.counts.need_action };
}

function guessType(text) {
  const s = String(text || '').toLowerCase();
  if (/\b(list|sell my|post my|advertise|upload)\b/.test(s)) return 'listing_owner';
  if (/\b(rent|bed|house|apartment|room|hostel|looking|buy|land|plot|shop|office)/.test(s)) return 'property_need';
  return 'callback';
}

async function findOrCreateContact(client, phone, name) {
  const d = digits(phone);
  const found = await client.query(
    `SELECT id FROM contacts WHERE RIGHT(REGEXP_REPLACE(COALESCE(phone, whatsapp, ''), '\\D', '', 'g'), 9) = $1 ORDER BY created_at LIMIT 1`, [d.slice(-9)]);
  if (found.rows.length) return found.rows[0].id;
  const made = await client.query(
    `INSERT INTO contacts (name, phone, whatsapp, phone_key, preferred_contact_channel, role_type)
     VALUES ($1, $2, $2, $3, 'phone', 'unknown') RETURNING id`, [name || null, dialOf(d), d.slice(-9)]);
  return made.rows[0].id;
}

/** "Add as lead" from the read-only WhatsApp feed. Never sends anything. */
async function addFromChat(user = {}, messageId, runner = db) {
  if (!/^[0-9a-f-]{36}$/i.test(String(messageId || ''))) throw err(400, 'Pick a WhatsApp message first.');
  if (!user.userId) throw err(403, 'Sign in first.');
  const msg = await runner.query(
    `SELECT id, user_phone, LEFT(COALESCE(NULLIF(payload->>'effectiveBody', ''), NULLIF(payload->>'body', ''), ''), 400) AS body,
            payload->'metadata'->>'push_name' AS push_name
     FROM whatsapp_messages WHERE id = $1 AND direction = 'inbound' LIMIT 1`, [messageId]);
  const m = msg.rows[0];
  if (!m) throw err(404, 'That WhatsApp message is gone.');
  if (!dialOf(m.user_phone)) throw err(400, 'That chat has no usable phone number.');
  const client = runner.getClient ? await runner.getClient() : runner;
  const pooled = client !== runner;
  try {
    if (pooled) await client.query('BEGIN');
    const existing = await client.query(
      `SELECT ld.id FROM leads ld JOIN contacts c ON c.id = ld.contact_id
       WHERE RIGHT(REGEXP_REPLACE(COALESCE(c.phone, c.whatsapp, ''), '\\D', '', 'g'), 9) = $1
         AND ld.deleted_at IS NULL AND ld.lead_status = ANY($2::text[]) AND ld.created_at >= NOW() - INTERVAL '30 days'
       ORDER BY ld.created_at DESC LIMIT 1`, [digits(m.user_phone).slice(-9), OPEN]);
    if (existing.rows.length) { if (pooled) await client.query('COMMIT'); return { lead_id: existing.rows[0].id, existing: true }; }
    const contactId = await findOrCreateContact(client, m.user_phone, m.push_name ? String(m.push_name).slice(0, 80) : null);
    const lead = await client.query(
      `INSERT INTO leads (contact_id, source, channel, lead_type, message, lead_status, lifecycle_stage, assigned_to_user_id, metadata)
       VALUES ($1, 'whatsapp_read_only_desk', 'whatsapp', $2, $3, 'open', 'new', $4, $5::jsonb) RETURNING id`,
      [contactId, guessType(m.body), m.body || null, user.userId, JSON.stringify({ whatsapp_message_id: m.id, added_by: user.name || null })]);
    await client.query(
      `INSERT INTO lead_activities (lead_id, actor_user_id, actor_type, activity_type, message, new_status, metadata)
       VALUES ($1, $2, $3, 'added_from_whatsapp', 'Added as a lead from the WhatsApp feed (read only)', 'open', '{}'::jsonb)`,
      [lead.rows[0].id, user.userId, user.king ? 'admin' : 'moderator']);
    if (pooled) await client.query('COMMIT');
    return { lead_id: lead.rows[0].id, existing: false };
  } catch (e) {
    if (pooled) { try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ } }
    throw e;
  } finally {
    if (pooled && client.release) client.release();
  }
}

/** Outcome… on a queue item. Alert-me searches become a lead on their first outcome. */
async function outcome(user = {}, key, body = {}, runner = db) {
  const kind = String(body.outcome || '');
  if (!OUTCOMES[kind]) throw err(400, 'Pick an outcome.');
  if (!user.userId) throw err(403, 'Sign in first.');
  const at = body.at ? new Date(body.at) : null;
  if ((kind === 'viewing' || kind === 'call_back') && (!at || Number.isNaN(at.getTime()))) throw err(400, 'Pick the day and time.');
  const note = String(body.note || '').trim().slice(0, 500);
  let leadId = String(key || '');
  if (leadId.startsWith('ss:')) {
    const ssId = leadId.slice(3);
    if (!/^[0-9a-f-]{36}$/i.test(ssId)) throw err(400, 'Unknown lead.');
    const ss = await runner.query(
      `SELECT ss.id, ss.label, COALESCE(NULLIF(ss.phone, ''), u.phone) AS phone, NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), '') AS name, ss.user_id
       FROM saved_searches ss LEFT JOIN users u ON u.id = ss.user_id WHERE ss.id = $1`, [ssId]);
    if (!ss.rows.length) throw err(404, 'That search is gone.');
    const s = ss.rows[0];
    const had = await runner.query(`SELECT id FROM leads WHERE lead_type = 'saved_search' AND metadata->>'saved_search_id' = $1 AND deleted_at IS NULL LIMIT 1`, [ssId]);
    if (had.rows.length) leadId = had.rows[0].id;
    else {
      const contactId = dialOf(s.phone) ? await findOrCreateContact(runner, s.phone, s.name) : null;
      const made = await runner.query(
        `INSERT INTO leads (contact_id, user_id, source, lead_type, message, lead_status, lifecycle_stage, metadata)
         VALUES ($1, $2, 'alert_me_search', 'saved_search', $3, 'open', 'new', $4::jsonb) RETURNING id`,
        [contactId, s.user_id || null, s.label || null, JSON.stringify({ saved_search_id: s.id })]);
      leadId = made.rows[0].id;
    }
  }
  if (!/^[0-9a-f-]{36}$/i.test(leadId)) throw err(400, 'Unknown lead.');
  const prev = await runner.query('SELECT id, lead_status, assigned_to_user_id FROM leads WHERE id = $1 AND deleted_at IS NULL', [leadId]);
  const p = prev.rows[0];
  if (!p) throw err(404, 'That lead is gone.');
  if (p.assigned_to_user_id && String(p.assigned_to_user_id) !== String(user.userId) && !user.king) throw err(409, 'Someone else is working this lead.');
  const sets = ['assigned_to_user_id = COALESCE(assigned_to_user_id, $2::uuid)', 'updated_at = NOW()'];
  const vals = [leadId, user.userId];
  const add = (sql, v) => { vals.push(v); sets.push(sql.replace('?', `$${vals.length}`)); };
  const contacted = () => sets.push('last_contacted_at = NOW()');
  let status = p.lead_status === 'handed_over' ? 'contacted' : p.lead_status;
  if (kind === 'no_answer') { contacted(); sets.push("next_follow_up_at = NOW() + INTERVAL '20 hours'"); }
  if (kind === 'spoke') { contacted(); status = 'contacted'; sets.push('next_follow_up_at = NULL'); }
  if (kind === 'sent_matches') { contacted(); status = 'qualified'; sets.push("lifecycle_stage = 'matched'", 'next_follow_up_at = NULL'); }
  if (kind === 'viewing') { contacted(); status = 'qualified'; sets.push("lifecycle_stage = 'viewing'"); add('next_follow_up_at = ?::timestamptz', at.toISOString()); }
  if (kind === 'call_back') { contacted(); if (status === 'open') status = 'contacted'; add('next_follow_up_at = ?::timestamptz', at.toISOString()); }
  if (kind === 'listed') { contacted(); status = 'won'; sets.push('next_follow_up_at = NULL', "outcome = 'listed_or_done'"); }
  if (kind === 'not_interested') { status = 'lost'; sets.push('next_follow_up_at = NULL', "outcome = 'not_interested'"); add('lost_reason = ?', note || 'Not interested'); }
  if (kind === 'wrong_number') { status = 'lost'; sets.push('next_follow_up_at = NULL', "outcome = 'wrong_number'"); add('lost_reason = ?', 'Wrong number'); }
  add('lead_status = ?', status);
  sets.push(DONE.includes(status) ? 'closed_at = COALESCE(closed_at, NOW())' : 'closed_at = NULL');
  const up = await runner.query(`UPDATE leads SET ${sets.join(', ')} WHERE id = $1 RETURNING id, lead_status, lifecycle_stage, next_follow_up_at, assigned_to_user_id`, vals);
  await runner.query(
    `INSERT INTO lead_activities (lead_id, actor_user_id, actor_type, activity_type, message, old_status, new_status, metadata)
     VALUES ($1, $2, $3, 'staff_outcome', $4, $5, $6, $7::jsonb)`,
    [leadId, user.userId, user.king ? 'admin' : 'moderator', `${OUTCOMES[kind]}${note ? `: ${note}` : ''}`, p.lead_status, status, JSON.stringify({ outcome: kind, at: at ? at.toISOString() : null })]);
  return up.rows[0];
}

module.exports = { desk, count, outcome, addFromChat, toItem, toChat, suggestFor, mask, dialOf, shortName, needsAction, OUTCOMES, FILTERS, LEAD_SQL, CHAT_SQL, ALERT_SQL };
