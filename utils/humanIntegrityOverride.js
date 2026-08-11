'use strict';

const HUMAN_INTEGRITY_OVERRIDE_MARKER = 'human-integrity-override-20260811';
const HUMAN_APPROVAL_OVERRIDE_MARKER = 'human-approval-overlord-20260811';
const HUMAN_INTEGRITY_OVERRIDE_NOTE = 'human override — verified manually';
const HUMAN_INTEGRITY_OVERRIDE_ROLES = new Set(['super_admin', 'moderator']);

function humanIntegrityOverrideAccess({ adminAuth = {}, requested = false, nextStatus = '' } = {}) {
  const role = String(adminAuth?.role || '').trim().toLowerCase();
  const authType = String(adminAuth?.type || '').trim().toLowerCase();
  const userId = String(adminAuth?.userId || '').trim();
  const humanSession = Boolean(userId)
    && HUMAN_INTEGRITY_OVERRIDE_ROLES.has(role)
    && ['bearer', 'moderator'].includes(authType);

  return {
    requested: requested === true,
    allowed: requested === true && String(nextStatus || '').toLowerCase() === 'approved' && humanSession,
    human_session: humanSession,
    role,
    auth_type: authType,
    user_id: userId || null
  };
}

function humanApprovalOverrideAccess(input = {}) {
  return humanIntegrityOverrideAccess(input);
}

module.exports = {
  HUMAN_APPROVAL_OVERRIDE_MARKER,
  HUMAN_INTEGRITY_OVERRIDE_MARKER,
  HUMAN_INTEGRITY_OVERRIDE_NOTE,
  HUMAN_INTEGRITY_OVERRIDE_ROLES,
  humanIntegrityOverrideAccess,
  humanApprovalOverrideAccess
};
