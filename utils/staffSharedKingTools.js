'use strict';

/**
 * King tools that staff (Ronald, and other moderators) may also use from the
 * staff dashboard. Everything else on /api/admin stays admin-only — including
 * the old lead-outreach WhatsApp/email send routes, billing, Staff Ops, and
 * temporary passwords.
 */
function normalizeAdminPath(path = '') {
  const raw = String(path || '').split('?')[0];
  const trimmed = raw.replace(/\/+$/, '') || '/';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function isStaffSharedKingTool(path, method = 'GET') {
  const p = normalizeAdminPath(path);
  const m = String(method || 'GET').toUpperCase();

  // Never share the old opt-in outreach senders. Those message the public.
  if (p === '/outreach/email/send' || p === '/outreach/whatsapp/send') return false;

  if (p === '/outreach-tracker' || p.startsWith('/outreach-tracker/')) return true;
  if (p === '/agent-prospects' && m === 'GET') return true;
  if (p.startsWith('/agent-manager/')) return true;
  if (p === '/featured-rotation' && m === 'GET') return true;
  if (p === '/featured-rotation/run-once' && m === 'POST') return true;
  if (p === '/properties/live' && m === 'GET') return true;
  if (/^\/properties\/[^/]+\/featured$/.test(p) && m === 'PATCH') return true;
  if (p === '/agents' && (m === 'GET' || m === 'POST')) return true;
  if (p === '/agents/invite' || p === '/agents/direct-onboarding') return true;
  if (/^\/agents\/[^/]+\/(status|featured|greeting-name|identity-document|profile-photo|registration-status|public-profile-approval)$/.test(p)) return true;
  if (/^\/agents\/[^/]+\/(remove|remove-preview|restore)$/.test(p)) return true;
  return false;
}

module.exports = {
  normalizeAdminPath,
  isStaffSharedKingTool
};
