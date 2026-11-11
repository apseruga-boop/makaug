'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  PENDING_AGENT_APPROVAL_MESSAGE,
  PENDING_AGENT_BLOCKER_CODE,
  PENDING_AGENT_OVERRIDE_ACTION,
  PENDING_AGENT_OVERRIDE_MIN_REASON,
  applyStaffBulkPendingAgentGate,
  evaluatePendingAgentApproval,
  isApprovedAgentStatus,
  loadLinkedAgentStatus,
  pendingAgentOverrideRequest
} = require('../utils/listingApprovalAgentGuard');

const properties = fs.readFileSync(path.join(__dirname, '../routes/properties.js'), 'utf8');
const staff = fs.readFileSync(path.join(__dirname, '../routes/staff.js'), 'utf8');
const admin = fs.readFileSync(path.join(__dirname, '../routes/admin.js'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '../assets/makaug-app.js'), 'utf8');

const PENDING_AGENT = { id: '00bb9387-fca5-4ae6-b420-e9000cc61597', status: 'pending', missing: false };
const APPROVED_AGENT = { id: '00bb9387-fca5-4ae6-b420-e9000cc61597', status: 'approved', missing: false };

test('approval is blocked when the linked agent is not approved', () => {
  assert.equal(isApprovedAgentStatus('approved'), true);
  assert.equal(isApprovedAgentStatus('pending'), false);
  assert.equal(evaluatePendingAgentApproval({ agent: null }).blocked, false);
  assert.equal(evaluatePendingAgentApproval({ agent: APPROVED_AGENT }).blocked, false);

  const blocked = evaluatePendingAgentApproval({
    agent: PENDING_AGENT,
    override: pendingAgentOverrideRequest({ body: {}, adminAuth: { role: 'moderator' } })
  });
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.httpStatus, 400);
  assert.equal(blocked.response.error, PENDING_AGENT_APPROVAL_MESSAGE);
  assert.equal(blocked.response.code, PENDING_AGENT_BLOCKER_CODE);
  assert.equal(blocked.response.human_approval_override_available, false);
  assert.equal(blocked.response.pending_agent_override_available, false);

  const missing = evaluatePendingAgentApproval({
    agent: { id: PENDING_AGENT.id, status: null, missing: true }
  });
  assert.equal(missing.blocked, true);
  assert.equal(missing.response.error, PENDING_AGENT_APPROVAL_MESSAGE);
});

test('only a super_admin with a written reason can override the pending-agent block', () => {
  const short = evaluatePendingAgentApproval({
    agent: PENDING_AGENT,
    override: pendingAgentOverrideRequest({
      body: { pending_agent_override: true, pending_agent_override_reason: 'short' },
      adminAuth: { role: 'super_admin' }
    })
  });
  assert.equal(short.blocked, true);
  assert.match(short.response.error, /at least 8 characters/);
  assert.equal(short.response.pending_agent_override_available, true);

  const moderator = evaluatePendingAgentApproval({
    agent: PENDING_AGENT,
    override: pendingAgentOverrideRequest({
      body: { pending_agent_override: true, pending_agent_override_reason: 'I checked the agent and the listing facts.' },
      adminAuth: { role: 'moderator' }
    })
  });
  assert.equal(moderator.blocked, true);
  assert.equal(moderator.httpStatus, 403);
  assert.equal(moderator.response.error, PENDING_AGENT_APPROVAL_MESSAGE);

  const allowed = evaluatePendingAgentApproval({
    agent: PENDING_AGENT,
    override: pendingAgentOverrideRequest({
      body: { pending_agent_override: true, pending_agent_override_reason: 'I checked the agent and the listing facts.' },
      adminAuth: { role: 'super_admin' }
    })
  });
  assert.equal(allowed.blocked, false);
  assert.equal(allowed.override.used, true);
  assert.equal(allowed.override.action, PENDING_AGENT_OVERRIDE_ACTION);
  assert.match(allowed.override.reason, /listing facts/);
  assert.ok(allowed.override.reason.length >= PENDING_AGENT_OVERRIDE_MIN_REASON);
});

test('bulk review holds listings whose agent is not approved', async () => {
  const rows = [
    { id: 'listing-ok', title: 'Ok', agent_id: 'agent-approved' },
    { id: 'listing-pending', title: 'Pending agent', agent_id: 'agent-pending' },
    { id: 'listing-none', title: 'No agent', agent_id: null }
  ];
  const decisions = [
    { id: 'listing-ok', decision: 'approve' },
    { id: 'listing-pending', decision: 'approve' },
    { id: 'listing-none', decision: 'approve' }
  ];
  const queryable = {
    async query() {
      return {
        rows: [
          { id: 'agent-approved', status: 'approved' },
          { id: 'agent-pending', status: 'pending' }
        ]
      };
    }
  };
  const next = await applyStaffBulkPendingAgentGate(decisions, rows, queryable);
  assert.equal(next[0].decision, 'approve');
  assert.equal(next[1].decision, 'hold');
  assert.equal(next[1].reason, PENDING_AGENT_BLOCKER_CODE);
  assert.deepEqual(next[1].details, [PENDING_AGENT_APPROVAL_MESSAGE]);
  assert.equal(next[2].decision, 'approve');
});

test('the status, preview, bulk, and direct-publish paths use the guard and log the override', () => {
  const statusStart = properties.indexOf("router.patch('/:id/status'");
  const statusEnd = properties.indexOf('const writeModerationAuditEvents');
  assert.ok(statusStart >= 0 && statusEnd > statusStart);
  const statusBlock = properties.slice(statusStart, statusEnd);
  assert.match(statusBlock, /evaluatePendingAgentApproval\(/);
  assert.match(statusBlock, /pendingAgentOverrideRequest\(/);
  assert.match(statusBlock, /loadLinkedAgentStatus\(/);

  const auditStart = properties.indexOf('const writeModerationAuditEvents');
  const auditBlock = properties.slice(auditStart, auditStart + 12000);
  assert.match(auditBlock, /PENDING_AGENT_OVERRIDE_ACTION/);
  assert.match(auditBlock, /pending_agent_approval_override/);

  assert.match(staff, /applyStaffBulkPendingAgentGate\(/);
  assert.match(staff, /evaluatePendingAgentApproval\(\{ agent: linkedAgent \}\)/);

  const publishStart = admin.indexOf("router.post('/properties/:id/direct-publish'");
  const publishBlock = admin.slice(publishStart, publishStart + 8000);
  assert.match(publishBlock, /evaluatePendingAgentApproval\(/);
  assert.match(publishBlock, /pending_agent_approval_override/);

  // Existing public listings stay visible even if the linked agent is pending.
  assert.match(properties, /LEFT JOIN agents a ON a\.id = p\.agent_id/);
  assert.doesNotMatch(properties, /AND a\.status = 'approved'/);
});

test('the staff UI shows the blocked message and a super-admin reason box only', () => {
  assert.match(app, /This agent isn't approved yet\. Approve the agent first, or unlink the listing\./);
  const bannerStart = app.indexOf('function showApprovalBlockerBanner');
  const banner = app.slice(bannerStart, bannerStart + 9000);
  assert.match(banner, /pendingAgentBlocked/);
  assert.match(banner, /Approve the agent first, or unlink this listing from the agent/);
  assert.match(banner, /staff-pending-agent-override-reason/);
  assert.match(banner, /Override and approve \(super admin\)/);
  assert.match(banner, /!pendingAgentBlocked && response\?\.human_approval_override_available === true/);

  const approveStart = app.indexOf('async function staffApprovePreviewListing');
  const approve = app.slice(approveStart, approveStart + 3500);
  assert.match(approve, /pending_agent_override: true/);
  assert.match(approve, /pending_agent_override_reason: pendingAgentOverrideReason/);

  assert.match(app, /async function approvePendingAgentOverride/);
});

test('loadLinkedAgentStatus treats a missing row as not approved and skips listings with no agent', async () => {
  const none = await loadLinkedAgentStatus({ query: async () => ({ rows: [] }) }, '');
  assert.equal(none, null);
  const missing = await loadLinkedAgentStatus({ query: async () => ({ rows: [] }) }, PENDING_AGENT.id);
  assert.equal(missing.missing, true);
  assert.equal(evaluatePendingAgentApproval({ agent: missing }).blocked, true);
  const loaded = await loadLinkedAgentStatus({
    query: async () => ({ rows: [{ id: PENDING_AGENT.id, status: 'approved' }] })
  }, PENDING_AGENT.id);
  assert.equal(evaluatePendingAgentApproval({ agent: loaded }).blocked, false);
});
