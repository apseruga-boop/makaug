'use strict';

/**
 * Agent removal requests (Arthur, 21 Nov 2026).
 *
 * Staff can never remove or restore an agent. They send a request with a
 * reason; it waits on King's Agents desk. Only King (the manager) removes the
 * agent, with the existing removal flow, which closes the request as
 * approved. King can also decline it with a note. Every step is audited.
 */

const db = require('../config/database');
const agentGoodbye = require('./agentGoodbyeService');

const rows = async (sql, params = []) => (await db.query(sql, params)).rows;
const clean = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
const UUID_RE = /^[0-9a-f-]{36}$/i;

function httpError(status, message) { const e = new Error(message); e.status = status; return e; }

/** Validates a staff request; returns { reason, note } or throws a 400. */
function validateRequest({ agentId, reasonCode, note } = {}) {
  if (!UUID_RE.test(String(agentId || ''))) throw httpError(400, 'Invalid agent id');
  const reason = agentGoodbye.removalReason(reasonCode);
  if (!reason) throw httpError(400, 'Choose why this agent should be removed');
  const text = clean(note, 500);
  if (text.length < 5) throw httpError(400, 'Say why in a few words, so King can decide');
  return { reason, note: text };
}

async function createRequest({ agentId, reasonCode, note, requestedBy, requestedByName }) {
  const v = validateRequest({ agentId, reasonCode, note });
  const agent = (await rows('SELECT id, full_name, removed_at FROM agents WHERE id = $1::uuid', [agentId]))[0];
  if (!agent) throw httpError(404, 'Agent not found');
  if (agent.removed_at) throw httpError(409, 'This agent has already been removed');
  const open = (await rows(`SELECT id FROM agent_removal_requests WHERE agent_id = $1::uuid AND status = 'open' LIMIT 1`, [agentId]))[0];
  if (open) throw httpError(409, 'A removal request for this agent is already waiting for King');
  const out = (await rows(
    `INSERT INTO agent_removal_requests (agent_id, agent_name, reason_code, reason_label, note, requested_by, requested_by_name)
     VALUES ($1::uuid, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [agentId, agent.full_name || '', v.reason.code, v.reason.label, v.note, clean(requestedBy, 80), clean(requestedByName, 120)]
  ))[0];
  return out;
}

async function listRequests({ status = 'open', limit = 100 } = {}) {
  const st = ['open', 'approved', 'declined', 'all'].includes(status) ? status : 'open';
  return rows(
    `SELECT r.*, a.removed_at, a.status AS agent_status
       FROM agent_removal_requests r LEFT JOIN agents a ON a.id = r.agent_id
      WHERE ($1 = 'all' OR r.status = $1)
      ORDER BY r.created_at DESC LIMIT $2`, [st, Math.max(1, Math.min(500, Number(limit) || 100))]);
}

async function countOpen() {
  return Number((await rows(`SELECT COUNT(*)::int AS n FROM agent_removal_requests WHERE status = 'open'`))[0]?.n || 0);
}

async function decline(id, { decidedBy, note }) {
  if (!UUID_RE.test(String(id || ''))) throw httpError(400, 'Invalid request id');
  const out = (await rows(
    `UPDATE agent_removal_requests SET status = 'declined', decided_by = $2, decided_at = NOW(), decision_note = $3
      WHERE id = $1::uuid AND status = 'open' RETURNING *`, [id, clean(decidedBy, 80), clean(note, 500)]
  ))[0];
  if (!out) throw httpError(409, 'This request is no longer open');
  return out;
}

/** Called after King removes an agent: closes any open request as approved. */
async function approveForAgent(agentId, { decidedBy } = {}) {
  return rows(
    `UPDATE agent_removal_requests SET status = 'approved', decided_by = $2, decided_at = NOW(), decision_note = 'Removed by King'
      WHERE agent_id = $1::uuid AND status = 'open' RETURNING id`, [agentId, clean(decidedBy, 80)]
  ).catch(() => []);
}

module.exports = { validateRequest, createRequest, listRequests, countOpen, decline, approveForAgent };
