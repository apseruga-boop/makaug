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
  // Staff Performance: everyone reads it, calls, logs outcomes and adds list
  // numbers. Targets, points and the paid rate (PUT …/settings) are King-only.
  if (p === '/staff-performance' && m === 'GET') return true;
  if (/^\/staff-performance\/prospects\/[^/]+\/(call|outcome)$/.test(p) && m === 'POST') return true;
  if (p === '/staff-performance/lists' && m === 'POST') return true;
  if (/^\/staff-performance\/lists\/[^/]+\/number$/.test(p) && m === 'POST') return true;
  // Calling screen: staff run their own sessions, calls, wrap-ups, added
  // numbers, feed, stats and day report. The team view, evidence trail,
  // targets and number review stay King-only.
  // Staff desk (Arthur, 21 Nov 2026): own home, pay and profile only.
  if (['/desk/home', '/desk/performance', '/desk/pay', '/desk/profile'].includes(p) && m === 'GET') return true;
  if (p === '/desk/profile' && m === 'PUT') return true;
  // Staff desk 3b: own pipeline pages (outcome owed, pipeline, agents to approve, owes us money, missed calls).
  if (['/desk/owed', '/desk/pipeline', '/desk/approve', '/desk/owes', '/desk/missed'].includes(p) && m === 'GET') return true;
  // Staff Leads & WhatsApp (ops 3): read the queue, add a chat as a lead, record an outcome. Never sends.
  if (p === '/desk/leads' && m === 'GET') return true;
  if (m === 'POST' && (p === '/desk/leads/from-chat' || /^\/desk\/leads\/(ss:)?[0-9a-f-]{36}\/outcome$/i.test(p))) return true;
  if (m === 'POST' && (/^\/desk\/owed\/[0-9a-f-]{36}$/i.test(p) || /^\/desk\/owes\/[0-9a-f-]{36}\/chase$/i.test(p) || p === '/desk/missed' || /^\/desk\/missed\/\d+\/dismiss$/.test(p))) return true;
  if (p === '/calling/bootstrap' && m === 'GET') return true;
  if (p === '/calling/sessions' && m === 'POST') return true;
  if (/^\/calling\/sessions\/[^/]+\/(heartbeat|task|next|end|claim|inbound)$/.test(p) && m === 'POST') return true;
  if (/^\/calling\/attempts\/[^/]+\/contact$/.test(p) && m === 'GET') return true;
  if (/^\/calling\/attempts\/[^/]+\/(sms|video-request)$/.test(p) && m === 'POST') return true;
  if (['/calling/sms-proof/parse', '/calling/sms-proof'].includes(p) && m === 'POST') return true;
  if (['/calling/meeting', '/calling/meeting/report'].includes(p) && m === 'GET') return true;
  if (p === '/calling/meeting/notes' && m === 'POST') return true;
  if (/^\/calling\/sms-proofs\/[^/]+\/image$/.test(p) && m === 'GET') return true;
  if (['/calling/search', '/calling/my-money', '/calling/lookup', '/calling/live'].includes(p) && m === 'GET') return true;
  if (['/calling/day-split', '/calling/housekeeping'].includes(p) && m === 'GET') return true;
  if (p === '/calling/housekeeping/done' && m === 'POST') return true;
  if (/^\/calling\/attempts\/[^/]+\/(tap|end|wrapup|skip|pay|paid-claim)$/.test(p) && m === 'POST') return true;
  if (/^\/calling\/attempts\/[^/]+\/payment$/.test(p) && m === 'GET') return true;
  if (['/calling/plan', '/calling/cash'].includes(p) && (m === 'GET' || m === 'POST')) return true;
  if (p === '/calling/numbers' && m === 'POST') return true;
  if (['/calling/stats', '/calling/counts', '/calling/feed', '/calling/report', '/calling/summary', '/calling/whatsapp', '/calling/leads', '/calling/timeline'].includes(p) && m === 'GET') return true;
  // Read-only WhatsApp conversation view (no sending anywhere on the calling screen).
  if (/^\/calling\/whatsapp\/[^/]+$/.test(p) && m === 'GET') return true;
  if (p.startsWith('/agent-manager/')) return true;
  if (p === '/featured-rotation' && m === 'GET') return true;
  if (p === '/featured-rotation/run-once' && m === 'POST') return true;
  if (p === '/properties/live' && m === 'GET') return true;
  if (/^\/properties\/[^/]+\/featured$/.test(p) && m === 'PATCH') return true;
  if (p === '/agents' && (m === 'GET' || m === 'POST')) return true;
  if (p === '/agents/invite' || p === '/agents/direct-onboarding') return true;
  if (/^\/agents\/[^/]+\/(status|featured|greeting-name|identity-document|profile-photo|registration-status|public-profile-approval)$/.test(p)) return true;
  // Staff never remove or restore agents (Arthur, 21 Nov 2026): they send King
  // a removal request with a reason. Remove, preview and restore are King-only.
  if (/^\/agents\/[^/]+\/removal-request$/.test(p) && m === 'POST') return true;
  return false;
}

module.exports = {
  normalizeAdminPath,
  isStaffSharedKingTool
};
