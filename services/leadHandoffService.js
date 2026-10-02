'use strict';

/**
 * Lead handoff — what happens the moment someone asks about a listing.
 *
 * makaug is a discovery platform, not a marketplace: it passes the enquiry to
 * the person who listed the property, tells the seeker who that is and how to
 * reach them, and steps out. No chasing, no sitting in the conversation.
 *
 *   enquiry form / viewing / callback / WhatsApp-bot enquiry
 *     → lister gets the seeker's details on WhatsApp (and email if we have one)
 *     → seeker gets a confirmation with the lister's contact
 *   WhatsApp button click
 *     → the seeker is already talking to the lister directly: contact_shown
 *   found-online listing (scraped from social media)
 *     → makaug never messages the original poster: contact_shown
 *
 * Every attempt is written to `notifications` with its real outcome, and the
 * lead carries a handoff_status an admin can filter on.
 */

const logger = require('../config/logger');
const { logNotification } = require('./notificationLogService');
const { recordLeadHandoff, phoneKey } = require('./leadService');
const { sendWhatsAppText, normalizeUgPhoneForWhatsApp } = require('./whatsappNotificationService');
const { sendSupportEmail } = require('./emailService');
const {
  getWhatsappDeliveryMode,
  isWhatsappWebBridgeEnabled,
  queueWhatsappWebBridgeMessage
} = require('./whatsappWebBridgeService');
const { foundOnlinePropertySql } = require('../utils/foundOnlineSql');
const { publicLivePropertyStatusSql } = require('../utils/publicInventoryStatus');

function text(value, fallback = '') {
  const cleaned = String(value ?? '').trim();
  return cleaned || fallback;
}

function flag(name, fallback = true) {
  const raw = String(process.env[name] ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  return !['0', 'false', 'no', 'off'].includes(raw);
}

function siteUrl() {
  const base = text(process.env.PUBLIC_SITE_URL || process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL, 'https://makaug.com');
  return base.replace(/\/+$/, '') || 'https://makaug.com';
}

function listingUrl(listing = {}) {
  return listing.id ? `${siteUrl()}/property/${encodeURIComponent(String(listing.id))}` : siteUrl();
}

function makaugOwnNumbers() {
  return String([process.env.MAKAUG_WHATSAPP_NUMBERS, process.env.MAKAUG_WHATSAPP_NUMBER, process.env.WHATSAPP_BUSINESS_NUMBER, '256780863394'].filter(Boolean).join(','))
    .split(',')
    .map((value) => phoneKey(value))
    .filter(Boolean);
}

function handoffWhatsappSource() {
  return text(process.env.LEAD_HANDOFF_WHATSAPP_SOURCE, 'whatsapp_runtime').toLowerCase();
}

/**
 * Load everything the handoff needs about a listing in one query.
 */
// An agent row created by the social-source sweeps (not a person who registered
// with makaug). The same markers migration 057 used to suspend them.
function sourceAgentProfileSql(alias = 'a') {
  const a = alias ? `${alias}.` : '';
  return `(${a}id IS NOT NULL AND ${a}user_id IS NULL AND (
    COALESCE(${a}licence_number, '') ~* '^(SOCIAL|FOUND-ONLINE|TIKTOK|FACEBOOK|X)-'
    OR COALESCE(${a}verification_reason, '') ~* '(public social source|source profile|source sweep)'
  ))`;
}

// Who makaug may WhatsApp about a lead: a registered agent whose profile is
// approved or who signed up themselves (has a makaug login), or the private
// owner who listed with makaug. Never a scraped poster, never a source-sweep
// agent profile, never a suspended agent.
function registeredAgentSql(alias = 'a') {
  const a = alias ? `${alias}.` : '';
  return `(LOWER(COALESCE(${a}status, '')) = 'approved' AND NOT ${sourceAgentProfileSql(alias)})`;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadListingContact(db, listingId) {
  if (!listingId || !UUID_PATTERN.test(String(listingId))) return null;
  const result = await db.query(
    `SELECT
       p.id, p.title, p.inquiry_reference, p.status, p.district, p.area,
       p.agent_id, p.lister_name, p.lister_phone, p.lister_email,
       a.full_name AS agent_name, a.phone AS agent_phone, a.whatsapp AS agent_whatsapp,
       a.email AS agent_email, a.user_id AS agent_user_id, a.status AS agent_status,
       a.makaug_agent_number,
       ${sourceAgentProfileSql('a')} AS agent_is_source_profile,
       ${foundOnlinePropertySql('p')} AS is_found_online,
       ${publicLivePropertyStatusSql('p')} AS is_live
     FROM properties p
     LEFT JOIN agents a ON a.id = p.agent_id
     WHERE p.id = $1::uuid
     LIMIT 1`,
    [String(listingId)]
  );
  return result.rows[0] || null;
}

function listerContactOf(listing = {}) {
  return {
    name: text(listing.agent_name || listing.lister_name) || 'the lister',
    phone: text(listing.agent_whatsapp || listing.agent_phone || listing.lister_phone) || null,
    email: text(listing.agent_email || listing.lister_email) || null
  };
}

function dailyCap(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

// makaug's WhatsApp number must never become a spam cannon, whatever is typed
// into a public form: each phone gets a bounded number of handoff messages a
// day. Kept in memory (one web instance) so the guard costs the database
// nothing; a restart simply starts the count again.
const sendLog = new Map();
const DAY_MS = 24 * 60 * 60 * 1000;

function overDailyCap(_db, { phone: recipient, typePrefix, cap }) {
  const key = phoneKey(recipient);
  if (!key) return false;
  const bucket = `${typePrefix}|${key}`;
  const now = Date.now();
  const recent = (sendLog.get(bucket) || []).filter((at) => now - at < DAY_MS);
  sendLog.set(bucket, recent);
  if (sendLog.size > 50000) sendLog.clear();
  return recent.length >= cap;
}

function countSend(typePrefix, recipient) {
  const key = phoneKey(recipient);
  if (!key) return;
  const bucket = `${typePrefix}|${key}`;
  const list = sendLog.get(bucket) || [];
  list.push(Date.now());
  sendLog.set(bucket, list);
}

async function deliverWhatsapp({ to, body, kind, leadId, nonce = 0 }) {
  const recipient = normalizeUgPhoneForWhatsApp(to);
  if (!recipient || recipient.length < 9) return { status: 'skipped', reason: 'invalid_phone' };
  if (makaugOwnNumbers().includes(phoneKey(recipient))) return { status: 'skipped', reason: 'makaug_own_number' };
  try {
    const mode = getWhatsappDeliveryMode();
    if (mode !== 'test' && (mode === 'web_bridge' || isWhatsappWebBridgeEnabled())) {
      const queued = await queueWhatsappWebBridgeMessage({
        recipient,
        text: body,
        source: handoffWhatsappSource(),
        actorId: 'lead_handoff',
        metadata: {
          message_kind: `lead_handoff_${kind}`,
          lead_id: leadId || null,
          reply_dedupe_key: `lead_handoff:${leadId || 'none'}:${kind}:${nonce}`
        }
      });
      return { status: 'queued', provider: 'whatsapp_web_bridge', id: queued?.id || null };
    }
    const sent = await sendWhatsAppText({ to: recipient, body });
    if (sent.sent) return { status: sent.simulated ? 'simulated' : 'sent', provider: sent.provider || 'whatsapp', id: sent.id || null };
    return { status: 'failed', reason: sent.reason || 'not_sent', provider: sent.provider || null };
  } catch (error) {
    logger.warn('Lead handoff WhatsApp failed', { kind, leadId, error: error.message });
    return { status: 'failed', reason: error.message };
  }
}

async function deliverEmail({ to, subject, body, replyTo }) {
  const recipient = text(to).toLowerCase();
  if (!recipient || !recipient.includes('@')) return { status: 'skipped', reason: 'no_email' };
  try {
    const sent = await sendSupportEmail({ to: recipient, subject, text: body, replyTo });
    if (sent.sent) return { status: 'sent', provider: sent.provider || 'email', id: sent.id || null };
    return { status: sent.mocked ? 'simulated' : 'failed', reason: sent.reason || 'not_sent' };
  } catch (error) {
    logger.warn('Lead handoff email failed', { error: error.message });
    return { status: 'failed', reason: error.message };
  }
}

const KIND_LABEL = Object.freeze({
  enquiry: 'New enquiry',
  viewing: 'Viewing request',
  callback: 'Callback request',
  whatsapp_bot: 'New enquiry via makaug WhatsApp'
});

function buildListerMessage({ kind, listing, seeker, message, extra = {} }) {
  const lines = [
    `${KIND_LABEL[kind] || 'New enquiry'} from makaug.com`,
    '',
    `Property: ${text(listing.title, 'your listing')}${listing.inquiry_reference ? ` (${listing.inquiry_reference})` : ''}`,
    listingUrl(listing),
    '',
    `Name: ${text(seeker.name, 'Not given')}`
  ];
  if (seeker.phone) lines.push(`Phone / WhatsApp: ${seeker.phone}`);
  if (seeker.email) lines.push(`Email: ${seeker.email}`);
  if (kind === 'viewing' && (extra.preferred_date || extra.preferred_time)) {
    lines.push(`Preferred viewing: ${[extra.preferred_date, extra.preferred_time].filter(Boolean).join(' ')}`);
  }
  if (kind === 'callback' && extra.preferred_callback_time) {
    lines.push(`Best time to call: ${extra.preferred_callback_time}`);
  }
  const note = text(message);
  if (note && !/^WhatsApp contact initiated/i.test(note)) lines.push('', `Message: "${note.slice(0, 600)}"`);
  lines.push('', 'Please contact them directly. makaug.com passes enquiries on and does not take part in the conversation.');
  return lines.join('\n');
}

function buildSeekerMessage({ kind, listing, lister, seeker }) {
  const greeting = seeker.name && !/^(unknown|whatsapp contact)/i.test(seeker.name) ? `Hi ${seeker.name.split(' ')[0]},` : 'Hi,';
  const action = kind === 'viewing' ? 'viewing request' : kind === 'callback' ? 'callback request' : 'enquiry';
  const lines = [
    greeting,
    '',
    `Your ${action} for "${text(listing.title, 'the property')}" has been sent to ${lister.name}.`,
    listingUrl(listing),
    ''
  ];
  if (lister.phone) {
    const wa = normalizeUgPhoneForWhatsApp(lister.phone);
    lines.push(`You can also reach them directly on ${lister.phone}${wa ? ` (WhatsApp: https://wa.me/${wa})` : ''}.`);
  }
  lines.push('', 'makaug.com helps you find the property and the person listing it. Any viewing, payment or agreement is between you and them. Never pay before you have seen the property and its documents.');
  return lines.join('\n');
}

async function logAttempt(db, { lead, listing, channel, recipientPhone, recipientEmail, type, result }) {
  const status = result.status === 'simulated' ? 'simulated' : result.status;
  if (channel === 'whatsapp' && ['sent', 'queued', 'simulated'].includes(status)) {
    countSend(type.startsWith('lead_handoff_lister_') ? 'lead_handoff_lister_' : 'lead_confirmation_seeker_', recipientPhone);
  }
  await logNotification(db, {
    recipientPhone: recipientPhone || null,
    recipientEmail: recipientEmail || null,
    channel,
    type,
    status,
    failureReason: ['failed', 'skipped'].includes(result.status) ? result.reason || null : null,
    sentAt: result.status === 'sent' ? new Date() : null,
    payloadSummary: {
      provider: result.provider || null,
      provider_id: result.id || null,
      property_title: listing?.title || null,
      inquiry_reference: listing?.inquiry_reference || null
    },
    relatedListingId: listing?.id || null,
    relatedLeadId: lead?.id || null
  });
}

function summarise(results) {
  const statuses = results.map((r) => r.status);
  if (statuses.includes('sent')) return 'sent';
  if (statuses.includes('queued')) return 'queued';
  if (statuses.includes('simulated')) return 'simulated';
  if (statuses.includes('capped')) return 'capped';
  if (statuses.includes('failed')) return 'failed';
  return 'no_lister_contact';
}

/**
 * Pass a listing lead to the lister and confirm to the seeker.
 *
 * kind: 'enquiry' | 'whatsapp_click' | 'viewing' | 'callback' | 'whatsapp_bot'
 * Returns { status, lister, seeker } and never throws.
 */
async function handOffListingLead(db, { lead, listing: listingInput = null, listingId = null, kind = 'enquiry', seeker = {}, message = '', extra = {} } = {}) {
  try {
    if (!lead?.id) return { status: 'no_lead' };
    if (lead._isRepeat) {
      // Clicks never re-notify. Anything else re-notifies only when it carries
      // something the lister has not had (a viewing on top of an enquiry, a new
      // message) or when the earlier handoff never reached them.
      const alreadyDelivered = ['sent', 'queued', 'simulated'].includes(lead.handoff_status);
      if (kind === 'whatsapp_click' || (alreadyDelivered && !lead._hasNewForLister)) {
        return { status: 'repeat', lead_id: lead.id };
      }
    }
    const listing = listingInput?.is_found_online !== undefined
      ? listingInput
      : await loadListingContact(db, listingInput?.id || listingId || lead.listing_id);
    if (!listing) {
      await recordLeadHandoff(db, lead.id, { status: 'no_listing', detail: { summary: 'Listing not found for handoff' } });
      return { status: 'no_listing' };
    }
    const lister = listerContactOf(listing);

    if (lead.is_test) {
      await recordLeadHandoff(db, lead.id, { status: 'test_skipped', detail: { kind } });
      return { status: 'test_skipped', lister };
    }
    if (listing.agent_id && (listing.agent_is_source_profile || String(listing.agent_status || '').toLowerCase() !== 'approved')) {
      // Not a registered, approved agent: makaug does not message them. The
      // lead waits in the Lead Centre for staff to refer to an approved agent.
      await recordLeadHandoff(db, lead.id, {
        status: 'agent_not_approved',
        detail: { kind, summary: `Listing agent is not an approved makaug agent (status ${listing.agent_status || 'unknown'}); not messaged — refer from the Lead Centre.` }
      });
      return { status: 'agent_not_approved', lister };
    }
    if (listing.is_found_online) {
      await recordLeadHandoff(db, lead.id, {
        status: 'contact_shown',
        detail: { kind, summary: 'Found-online listing: seeker shown the original poster\'s contact; makaug does not message posters.' }
      });
      return { status: 'contact_shown', lister };
    }
    if (kind === 'whatsapp_click') {
      await recordLeadHandoff(db, lead.id, {
        status: 'contact_shown',
        detail: { kind, summary: `Seeker opened WhatsApp to ${lister.name} directly.`, lister_phone_present: Boolean(lister.phone) }
      });
      return { status: 'contact_shown', lister };
    }
    if (!listing.is_live) {
      await recordLeadHandoff(db, lead.id, { status: 'listing_not_live', detail: { kind, listing_status: listing.status } });
      return { status: 'listing_not_live', lister };
    }
    if (!flag('LEAD_HANDOFF_ENABLED', true)) {
      await recordLeadHandoff(db, lead.id, { status: 'disabled', detail: { kind } });
      return { status: 'disabled', lister };
    }

    const listerResults = [];
    const nonce = Number(lead.repeat_count || 0);
    const sameAsSeeker = lister.phone && seeker.phone && phoneKey(lister.phone) === phoneKey(seeker.phone);
    const listerCapped = lister.phone && overDailyCap(db, {
      phone: lister.phone,
      typePrefix: 'lead_handoff_lister_',
      cap: dailyCap('LEAD_HANDOFF_LISTER_DAILY_CAP', 40)
    });
    if (listerCapped) {
      listerResults.push({ channel: 'whatsapp', status: 'capped', reason: 'lister_daily_cap' });
    } else if (lister.phone && !sameAsSeeker) {
      const body = buildListerMessage({ kind, listing, seeker, message, extra });
      const result = await deliverWhatsapp({ to: lister.phone, body, kind: `lister_${kind}`, leadId: lead.id, nonce });
      listerResults.push({ channel: 'whatsapp', ...result });
      await logAttempt(db, { lead, listing, channel: 'whatsapp', recipientPhone: lister.phone, type: `lead_handoff_lister_${kind}`, result });
    }
    if (lister.email) {
      const body = buildListerMessage({ kind, listing, seeker, message, extra });
      const result = await deliverEmail({
        to: lister.email,
        subject: `${KIND_LABEL[kind] || 'New enquiry'}: ${text(listing.title, 'your listing')}`,
        body,
        replyTo: seeker.email || undefined
      });
      listerResults.push({ channel: 'email', ...result });
      await logAttempt(db, { lead, listing, channel: 'email', recipientEmail: lister.email, type: `lead_handoff_lister_${kind}`, result });
    }

    const status = summarise(listerResults);
    await recordLeadHandoff(db, lead.id, {
      status,
      detail: {
        kind,
        summary: status === 'no_lister_contact'
          ? 'Listing has no phone or email for the lister — needs staff attention.'
          : `Enquiry passed to ${lister.name} (${listerResults.map((r) => `${r.channel}:${r.status}`).join(', ')})`,
        lister_results: listerResults
      }
    });

    // Seeker confirmation — only when the lister really was sent it (never
    // "your enquiry has been sent" when it was not). The WhatsApp bot already
    // answered in the chat.
    let seekerResult = { status: 'skipped', reason: 'not_needed' };
    const listerReached = ['sent', 'queued', 'simulated'].includes(status);
    const seekerCapped = seeker.phone && overDailyCap(db, {
      phone: seeker.phone,
      typePrefix: 'lead_confirmation_seeker_',
      cap: dailyCap('LEAD_HANDOFF_SEEKER_DAILY_CAP', 5)
    });
    if (kind !== 'whatsapp_bot' && listerReached && !seekerCapped && flag('LEAD_HANDOFF_SEEKER_CONFIRMATION', true)) {
      const body = buildSeekerMessage({ kind, listing, lister, seeker });
      if (seeker.phone) {
        seekerResult = await deliverWhatsapp({ to: seeker.phone, body, kind: `seeker_${kind}`, leadId: lead.id, nonce });
        await logAttempt(db, { lead, listing, channel: 'whatsapp', recipientPhone: seeker.phone, type: `lead_confirmation_seeker_${kind}`, result: seekerResult });
      } else if (seeker.email) {
        seekerResult = await deliverEmail({ to: seeker.email, subject: `Your enquiry: ${text(listing.title, 'makaug.com property')}`, body });
        await logAttempt(db, { lead, listing, channel: 'email', recipientEmail: seeker.email, type: `lead_confirmation_seeker_${kind}`, result: seekerResult });
      }
    }

    return { status, lister, lister_results: listerResults, seeker: seekerResult };
  } catch (error) {
    logger.error('Lead handoff failed', { leadId: lead?.id, kind, error: error.message });
    try {
      await recordLeadHandoff(db, lead?.id, { status: 'failed', detail: { kind, error: error.message } });
    } catch (_ignored) { /* already logged */ }
    return { status: 'failed', error: error.message };
  }
}

/**
 * Leads that are for makaug itself (a "tell us what you need" request, a
 * general callback): acknowledge the person and put it in front of the team.
 */
async function acknowledgeTeamLead(db, { lead, seeker = {}, seekerMessage = '', teamSubject = '', teamMessage = '', type = 'team_lead' } = {}) {
  if (!lead?.id || lead._isRepeat) return { status: lead?._isRepeat ? 'repeat' : 'no_lead' };
  if (lead.is_test) {
    await recordLeadHandoff(db, lead.id, { status: 'test_skipped', detail: { type } });
    return { status: 'test_skipped' };
  }
  const results = [];
  const seekerCapped = seeker.phone && overDailyCap(db, {
    phone: seeker.phone,
    typePrefix: 'lead_confirmation_seeker_',
    cap: dailyCap('LEAD_HANDOFF_SEEKER_DAILY_CAP', 5)
  });
  if (seekerMessage && !seekerCapped && flag('LEAD_HANDOFF_SEEKER_CONFIRMATION', true)) {
    let result = { status: 'skipped', reason: 'no_contact' };
    if (seeker.phone) {
      result = await deliverWhatsapp({ to: seeker.phone, body: seekerMessage, kind: `seeker_${type}`, leadId: lead.id });
      await logAttempt(db, { lead, channel: 'whatsapp', recipientPhone: seeker.phone, type: `lead_confirmation_seeker_${type}`, result });
    } else if (seeker.email) {
      result = await deliverEmail({ to: seeker.email, subject: 'makaug.com received your request', body: seekerMessage });
      await logAttempt(db, { lead, channel: 'email', recipientEmail: seeker.email, type: `lead_confirmation_seeker_${type}`, result });
    }
    results.push({ to: 'seeker', ...result });
  }
  if (teamMessage) {
    const teamEmail = text(process.env.LEAD_TEAM_EMAIL || process.env.SUPPORT_EMAIL, 'info@makaug.com');
    const result = await deliverEmail({ to: teamEmail, subject: teamSubject || 'New makaug lead', body: teamMessage, replyTo: seeker.email || undefined });
    await logAttempt(db, { lead, channel: 'email', recipientEmail: teamEmail, type: `lead_team_${type}`, result });
    results.push({ to: 'team', ...result });
  }
  await recordLeadHandoff(db, lead.id, {
    status: 'makaug_team',
    detail: { type, summary: 'In the makaug Lead Centre for the team.', results }
  });
  return { status: 'makaug_team', results };
}

module.exports = {
  registeredAgentSql,
  sourceAgentProfileSql,
  _resetSendLog: () => sendLog.clear(),
  acknowledgeTeamLead,
  deliverWhatsapp,
  makaugOwnNumbers,
  buildListerMessage,
  buildSeekerMessage,
  handOffListingLead,
  listerContactOf,
  loadListingContact
};
