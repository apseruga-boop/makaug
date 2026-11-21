'use strict';

/**
 * Team hub (Arthur, 21 Nov 2026, ops 3c part 1).
 *  - King writes to the whole team or to one person. A target always goes to
 *    one person: the server refuses a target for the whole team.
 *  - Rules, T&Cs and Working hours: one text each, King edits, staff read.
 *  - How-to video slots: a title per slot, King pastes a link when the video exists.
 * Everything stays inside makaug.com: nothing here sends a WhatsApp, SMS or email.
 * Staff only ever see messages to the team or to themselves.
 */
const db = require('../config/database');
const logger = require('../config/logger');

async function rows(sql, params = []) {
  try { return (await db.query(sql, params)).rows || []; } catch (e) { logger.warn('teamHub read failed', { error: e.message }); return []; }
}
function httpError(status, message) { const e = new Error(message); e.status = status; return e; }
const PAGES = Object.freeze({ rules: 'Rules', terms: 'T&Cs', hours: 'Working hours' });
const clean = (v, max) => String(v == null ? '' : v).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
const idOf = (v) => { const n = Number(v); if (!Number.isInteger(n) || n <= 0) throw httpError(400, 'Unknown item.'); return n; };

// A video link must be a plain https link (YouTube, Google Drive, Loom…). Nothing else is ever turned into a link.
function safeVideoUrl(raw) {
  const s = clean(raw, 500);
  if (!s) return '';
  let u;
  try { u = new URL(s); } catch (_) { throw httpError(400, 'Paste the full video link, starting with https://'); }
  if (u.protocol !== 'https:' || !u.hostname || !u.hostname.includes('.')) throw httpError(400, 'Paste the full video link, starting with https://');
  return u.toString();
}

async function staffPeople() {
  const list = await rows(`SELECT id::text AS id, first_name, last_name, profile_data->>'person_key' AS person_key, profile_data->>'staff_scope' AS scope
                             FROM users WHERE role = 'moderator' AND status = 'active'
                              AND COALESCE(profile_data->>'sandbox', 'false') <> 'true'
                            ORDER BY first_name, last_name`);
  return list.map((u) => ({ user_id: u.id, name: `${u.first_name || ''}${u.last_name && u.last_name !== 'Makaug' ? ` ${u.last_name}` : ''}`.trim() || 'Staff', person_key: u.person_key || '', scope: u.scope || '' }));
}

async function pagesAndVideos() {
  const [pages, videos] = await Promise.all([
    rows('SELECT key, body, updated_by, updated_at FROM team_pages'),
    rows('SELECT id, position, title, url, note, updated_at FROM team_videos WHERE removed_at IS NULL ORDER BY position, id')
  ]);
  const byKey = Object.fromEntries(pages.map((p) => [p.key, p]));
  return {
    pages: Object.keys(PAGES).map((key) => ({ key, label: PAGES[key], body: (byKey[key] && byKey[key].body) || '', updated_at: byKey[key] && byKey[key].updated_by !== 'starter' ? byKey[key].updated_at : null })),
    videos: videos.map((v) => ({ id: Number(v.id), position: Number(v.position), title: v.title, url: v.url, note: v.note, ready: Boolean(v.url) }))
  };
}

// ------------------------------------------------------------------ King --
async function kingHub() {
  const [people, msgs, extra] = await Promise.all([
    staffPeople(),
    rows(`SELECT m.id, m.audience, m.to_user_id, m.kind, m.title, m.body, m.created_by, m.created_at, m.withdrawn_at,
                 COALESCE(ARRAY_AGG(r.user_id) FILTER (WHERE r.user_id IS NOT NULL), '{}') AS read_by
            FROM team_messages m LEFT JOIN team_message_reads r ON r.message_id = m.id
           GROUP BY m.id ORDER BY m.created_at DESC LIMIT 60`),
    pagesAndVideos()
  ]);
  const name = Object.fromEntries(people.map((p) => [p.user_id, p.name]));
  return {
    people,
    messages: msgs.map((m) => {
      const readBy = (m.read_by || []).map(String);
      const audience = m.audience === 'team' ? people.map((p) => p.user_id) : [String(m.to_user_id)];
      return {
        id: Number(m.id), audience: m.audience, to_name: m.audience === 'team' ? 'Whole team' : (name[m.to_user_id] || 'A former staff member'),
        kind: m.kind, title: m.title, body: m.body, created_by: m.created_by, created_at: m.created_at, withdrawn: Boolean(m.withdrawn_at),
        read: audience.filter((id) => readBy.includes(id)).length, of: audience.length,
        not_read: audience.filter((id) => !readBy.includes(id)).map((id) => name[id] || 'Staff')
      };
    }),
    ...extra
  };
}

async function send(input = {}, { actor = 'King' } = {}) {
  const audience = input.audience === 'person' ? 'person' : input.audience === 'team' ? 'team' : '';
  if (!audience) throw httpError(400, 'Choose the whole team or one person.');
  const kind = input.kind === 'target' ? 'target' : 'note';
  if (kind === 'target' && audience !== 'person') throw httpError(400, 'Targets go to one person at a time. Pick the person.');
  const body = clean(input.body, 2000);
  if (body.length < 2) throw httpError(400, 'Write the message first.');
  const title = clean(input.title, 120);
  let to = null;
  if (audience === 'person') {
    to = String(input.to_user_id || '');
    const people = await staffPeople();
    if (!people.some((p) => p.user_id === to)) throw httpError(400, 'Pick someone on the team.');
  }
  const r = await db.query(`INSERT INTO team_messages (audience, to_user_id, kind, title, body, created_by)
                            VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, created_at`, [audience, to, kind, title, body, clean(actor, 120) || 'King']);
  return { id: Number(r.rows[0].id), created_at: r.rows[0].created_at, audience, kind };
}

async function withdraw(id, { actor = 'King' } = {}) {
  const r = await db.query('UPDATE team_messages SET withdrawn_at = COALESCE(withdrawn_at, NOW()) WHERE id = $1 RETURNING id', [idOf(id)]);
  if (!r.rows.length) throw httpError(404, 'Message not found.');
  logger.info('team message withdrawn', { id: Number(id), actor });
  return { id: Number(id), withdrawn: true };
}

async function savePage(key, body, { actor = 'King' } = {}) {
  if (!PAGES[key]) throw httpError(400, 'Unknown page.');
  const text = clean(body, 8000);
  await db.query(`INSERT INTO team_pages (key, body, updated_by, updated_at) VALUES ($1, $2, $3, NOW())
                  ON CONFLICT (key) DO UPDATE SET body = EXCLUDED.body, updated_by = EXCLUDED.updated_by, updated_at = NOW()`, [key, text, clean(actor, 120) || 'King']);
  return { key, label: PAGES[key], body: text };
}

async function saveVideo(id, input = {}, { actor = 'King' } = {}) {
  const title = clean(input.title, 120);
  if (title.length < 3) throw httpError(400, 'Give the video a title.');
  const url = safeVideoUrl(input.url);
  const note = clean(input.note, 300);
  const by = clean(actor, 120) || 'King';
  if (id === 'new') {
    const r = await db.query(`INSERT INTO team_videos (position, title, url, note, updated_by)
                              VALUES ((SELECT COALESCE(MAX(position), 0) + 1 FROM team_videos), $1, $2, $3, $4) RETURNING id`, [title, url, note, by]);
    return { id: Number(r.rows[0].id), title, url, note, ready: Boolean(url) };
  }
  const r = await db.query('UPDATE team_videos SET title = $2, url = $3, note = $4, updated_by = $5, updated_at = NOW() WHERE id = $1 AND removed_at IS NULL RETURNING id', [idOf(id), title, url, note, by]);
  if (!r.rows.length) throw httpError(404, 'Video slot not found.');
  return { id: Number(id), title, url, note, ready: Boolean(url) };
}

async function removeVideo(id, { actor = 'King' } = {}) {
  const r = await db.query('UPDATE team_videos SET removed_at = NOW(), updated_by = $2 WHERE id = $1 AND removed_at IS NULL RETURNING id', [idOf(id), clean(actor, 120) || 'King']);
  if (!r.rows.length) throw httpError(404, 'Video slot not found.');
  return { id: Number(id), removed: true };
}

// ----------------------------------------------------------------- staff --
async function myMessages(userId) {
  if (!userId) return [];
  return rows(`SELECT m.id, m.audience, m.kind, m.title, m.body, m.created_by, m.created_at, r.read_at
                 FROM team_messages m LEFT JOIN team_message_reads r ON r.message_id = m.id AND r.user_id = $1
                WHERE m.withdrawn_at IS NULL AND (m.audience = 'team' OR m.to_user_id = $1)
                ORDER BY m.created_at DESC LIMIT 50`, [String(userId)]);
}
async function staffHub(userId) {
  const [msgs, extra] = await Promise.all([myMessages(userId), pagesAndVideos()]);
  const messages = msgs.map((m) => ({ id: Number(m.id), to_me: m.audience === 'person', kind: m.kind, title: m.title, body: m.body, from: 'King', created_at: m.created_at, read: Boolean(m.read_at) }));
  return { unread: messages.filter((m) => !m.read).length, messages, ...extra };
}
async function unreadCount(userId) {
  if (!userId) return 0;
  const r = await rows(`SELECT COUNT(*)::int AS n FROM team_messages m
                         WHERE m.withdrawn_at IS NULL AND (m.audience = 'team' OR m.to_user_id = $1)
                           AND NOT EXISTS (SELECT 1 FROM team_message_reads r WHERE r.message_id = m.id AND r.user_id = $1)`, [String(userId)]);
  return r[0] ? Number(r[0].n) : 0;
}
// "Got it": only messages this person can see are ever marked.
async function markRead(userId, ids) {
  if (!userId) throw httpError(401, 'Sign in first.');
  const list = (Array.isArray(ids) ? ids : [ids]).map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 100);
  if (!list.length) return { marked: 0 };
  const r = await db.query(`INSERT INTO team_message_reads (message_id, user_id)
                            SELECT m.id, $1 FROM team_messages m
                             WHERE m.id = ANY($2::bigint[]) AND m.withdrawn_at IS NULL AND (m.audience = 'team' OR m.to_user_id = $1)
                            ON CONFLICT DO NOTHING`, [String(userId), list]);
  return { marked: r.rowCount || 0, unread: await unreadCount(userId) };
}

module.exports = { PAGES, safeVideoUrl, staffPeople, kingHub, send, withdraw, savePage, saveVideo, removeVideo, staffHub, unreadCount, markRead };
