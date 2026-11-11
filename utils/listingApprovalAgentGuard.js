'use strict';

// Listings went live on pending agents (Matugga, 10 Nov 2026) because
// approval only looked at the property status. A listing with an agent_id
// can only be approved when that agent is already approved, unless a
// super_admin records a written override reason.

const PENDING_AGENT_APPROVAL_MESSAGE = "This agent isn't approved yet. Approve the agent first, or unlink the listing.";
const PENDING_AGENT_OVERRIDE_MIN_REASON = 8;
const PENDING_AGENT_OVERRIDE_ACTION = 'pending_agent_approval_override';
const PENDING_AGENT_BLOCKER_CODE = 'unapproved_agent';

function cleanOverrideReason(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function parseBooleanLike(value, fallback = false) {
  if (value === true || value === false) return value;
  const text = String(value == null ? '' : value).trim().toLowerCase();
  if (!text) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'off'].includes(text)) return false;
  return fallback;
}

function isApprovedAgentStatus(status) {
  return String(status || '').trim().toLowerCase() === 'approved';
}

async function loadLinkedAgentStatus(queryable, agentId) {
  const id = String(agentId || '').trim();
  if (!id) return null;
  if (!queryable || typeof queryable.query !== 'function') {
    return { id, status: null, missing: true };
  }
  const result = await queryable.query(
    `SELECT id, status FROM agents WHERE id = $1 LIMIT 1`,
    [id]
  );
  const row = result.rows && result.rows[0];
  if (!row) return { id, status: null, missing: true };
  return { id: row.id, status: row.status, missing: false };
}

function pendingAgentOverrideRequest({ body = {}, adminAuth = {} } = {}) {
  const role = String(adminAuth?.role || '').trim().toLowerCase();
  const requested = parseBooleanLike(
    body.pending_agent_override || body.unapproved_agent_override,
    false
  );
  const reason = cleanOverrideReason(
    body.pending_agent_override_reason
      || body.unapproved_agent_override_reason
  );
  const isSuperAdmin = role === 'super_admin';
  return {
    requested,
    reason,
    isSuperAdmin,
    allowed: isSuperAdmin && requested && reason.length >= PENDING_AGENT_OVERRIDE_MIN_REASON
  };
}

function evaluatePendingAgentApproval({ agent = null, override = {} } = {}) {
  if (!agent || !agent.id) return { blocked: false };
  if (!agent.missing && isApprovedAgentStatus(agent.status)) return { blocked: false };
  if (override.allowed) {
    return {
      blocked: false,
      override: {
        used: true,
        reason: override.reason,
        action: PENDING_AGENT_OVERRIDE_ACTION,
        agent_id: agent.id,
        agent_status: agent.status || null,
        agent_missing: agent.missing === true
      }
    };
  }
  const needsReason = override.requested === true
    && override.isSuperAdmin === true
    && cleanOverrideReason(override.reason).length < PENDING_AGENT_OVERRIDE_MIN_REASON;
  return {
    blocked: true,
    httpStatus: override.requested && !override.isSuperAdmin ? 403 : 400,
    response: {
      ok: false,
      code: PENDING_AGENT_BLOCKER_CODE,
      error: needsReason
        ? `Type a reason of at least ${PENDING_AGENT_OVERRIDE_MIN_REASON} characters to override this and approve the listing.`
        : PENDING_AGENT_APPROVAL_MESSAGE,
      approval_blocker: PENDING_AGENT_BLOCKER_CODE,
      approval_blocked: true,
      human_approval_override_available: false,
      pending_agent_override_available: override.isSuperAdmin === true,
      pending_agent_override_min_length: PENDING_AGENT_OVERRIDE_MIN_REASON,
      pending_agent_override_required: needsReason,
      agent_status: agent.status || null,
      agent_missing: agent.missing === true
    }
  };
}

async function applyStaffBulkPendingAgentGate(decisions = [], rows = [], queryable) {
  const rowById = new Map((Array.isArray(rows) ? rows : []).map((row) => [String(row.id), row]));
  const agentIds = [...new Set((Array.isArray(rows) ? rows : [])
    .map((row) => String(row.agent_id || '').trim())
    .filter(Boolean))];
  const statusById = new Map();
  if (agentIds.length && queryable && typeof queryable.query === 'function') {
    const result = await queryable.query(
      `SELECT id, status FROM agents WHERE id = ANY($1::uuid[])`,
      [agentIds]
    );
    for (const row of result.rows || []) statusById.set(String(row.id), row);
  }
  return (Array.isArray(decisions) ? decisions : []).map((decision) => {
    if (String(decision.decision || '').toLowerCase() !== 'approve') return decision;
    const listing = rowById.get(String(decision.id));
    const agentId = String(listing?.agent_id || '').trim();
    if (!agentId) return decision;
    const agentRow = statusById.get(agentId);
    const verdict = evaluatePendingAgentApproval({
      agent: agentRow ? { id: agentRow.id, status: agentRow.status, missing: false } : { id: agentId, status: null, missing: true },
      override: { allowed: false }
    });
    if (!verdict.blocked) return decision;
    return {
      ...decision,
      decision: 'hold',
      reason: PENDING_AGENT_BLOCKER_CODE,
      details: [PENDING_AGENT_APPROVAL_MESSAGE]
    };
  });
}

module.exports = {
  PENDING_AGENT_APPROVAL_MESSAGE,
  PENDING_AGENT_BLOCKER_CODE,
  PENDING_AGENT_OVERRIDE_ACTION,
  PENDING_AGENT_OVERRIDE_MIN_REASON,
  applyStaffBulkPendingAgentGate,
  evaluatePendingAgentApproval,
  isApprovedAgentStatus,
  loadLinkedAgentStatus,
  pendingAgentOverrideRequest
};
