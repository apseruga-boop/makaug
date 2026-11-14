'use strict';

/**
 * A private owner looking after their own listing, on WhatsApp.
 *
 * Arthur, 14 Nov 2026: "how do they remove the property as well, we need to
 * make sure this route is built in, tested and working ... for sold, they
 * have sold, on for a week, then they are removed and they are notified."
 *
 * What was there: "REMOVE MK-20261114-EC7E2F" worked, with the exact
 * reference and nothing else. "Remove my property" went to the menu. A sold
 * listing came off the site after its 7 days and nobody was told. "Thanks"
 * after submitting got the main menu, and STATUS got "I can help with that".
 *
 *  REMOVE                 which one (if they have several), are you sure,
 *                         then it is off the site and the team is told
 *  STATUS / MY LISTING    where each of their properties is, and what is due
 *  "Thanks" after sending "You're welcome", and what happens next
 *  SOLD + 7 days          the lister is told it has come off (runs daily)
 *
 * The words and the lookups are here. routes/whatsapp.js holds the session.
 */

const logger = require('../config/logger');
const revenue = require('./revenueService');
const { foundOnlinePropertySql } = require('../utils/foundOnlineSql');
const { publishedPricing, ugxLabel } = require('../config/publishedPricing');

const OWNER_REMOVE_PICK_STEP = 'owner_remove_pick';
const OWNER_REMOVE_CONFIRM_STEP = 'owner_remove_confirm';
/** A sold listing shows its SOLD badge this long (utils/publicInventoryStatus.js). */
const SOLD_PUBLIC_DAYS = 7;
/** On the first run after a deploy, do not write to everyone who ever sold. */
const SOLD_NOTICE_LOOKBACK_DAYS = 3;

const SITE = () => String(process.env.PUBLIC_BASE_URL || 'https://makaug.com').replace(/\/+$/, '');

function clean(value, max = 300) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function phoneKey(value) {
  return String(value || '').replace(/\D+/g, '').slice(-9);
}

function normalise(text = '') {
  return clean(text, 200).toUpperCase().replace(/[^A-Z0-9 -]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function shortDay(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(String(value).length === 10 ? `${value}T12:00:00Z` : value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Africa/Kampala' });
}

function firstName(name = '') {
  const word = clean(name, 60).split(/\s+/)[0] || '';
  return /^[A-Za-z][A-Za-z'’-]{1,20}$/.test(word) ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : '';
}

// "Remove", "remove my listing", "take it down", "please delete my property
// from makaug". Not "remove me" (that is a request to delete their data, which
// the reply playbook passes to the team) and not "REMOVE MK-…" (the exact
// reference: handled where it always was).
const REMOVE_REQUEST = /^(?:PLEASE |PLS |KINDLY |CAN YOU |COULD YOU |I WANT TO |I WANT YOU TO |I D LIKE TO |I WOULD LIKE TO )?(?:REMOVE|DELETE|UNLIST|TAKE DOWN|TAKE OFF|PULL DOWN|CANCEL)(?: (?:MY|THE|THIS|THAT|OUR))?(?: (?:LISTING|LISTINGS|PROPERTY|HOUSE|HOME|PLOT|LAND|RENTAL|APARTMENT|SHOP|ADVERT|ADVERTISEMENT|AD|POST|IT))?(?: (?:DOWN|OFF))?(?: (?:FROM|ON|OFF) (?:MAKAUG|THE SITE|THE WEBSITE|YOUR SITE|YOUR WEBSITE))?(?: (?:PLEASE|PLS))?$/;
const TAKE_IT_DOWN = /^(?:PLEASE |PLS |KINDLY )?TAKE (?:IT|MY (?:LISTING|PROPERTY|HOUSE|PLOT|LAND|ADVERT)|THE (?:LISTING|PROPERTY|HOUSE|PLOT|LAND|ADVERT)) (?:DOWN|OFF)(?: (?:PLEASE|PLS))?$/;

function isRemoveRequest(text = '') {
  const t = normalise(text);
  if (!t || t.length > 90) return false;
  if (/\bMK-\d{8}-[A-Z0-9]{6}\b/.test(t)) return false;
  if (/\bREMOVE (?:ME|MY (?:NUMBER|DATA|DETAILS|ACCOUNT|NAME))\b/.test(t)) return false;
  // A bare CANCEL stops whatever flow they are in; it is not about a listing.
  if (/^(?:PLEASE |PLS |KINDLY )?CANCEL(?: (?:IT|PLEASE|PLS))?$/.test(t)) return false;
  return REMOVE_REQUEST.test(t) || TAKE_IT_DOWN.test(t);
}

const STATUS_REQUEST = /^(?:STATUS|MY STATUS|MY LISTINGS?|MY PROPERT(?:Y|IES)|MY HOUSE|MY PLOT|MY LAND|CHECK(?: MY)? (?:LISTING|PROPERTY|STATUS)|IS (?:IT|MY (?:LISTING|PROPERTY|HOUSE|PLOT|LAND)) (?:LIVE|UP|APPROVED|ONLINE|READY|DONE)(?: YET| NOW)?|HAS (?:IT|MY (?:LISTING|PROPERTY|HOUSE|PLOT|LAND)) (?:BEEN APPROVED|GONE LIVE|BEEN POSTED)(?: YET)?|WHERE IS MY (?:LISTING|PROPERTY)|WHEN WILL (?:IT|MY (?:LISTING|PROPERTY|HOUSE)) (?:GO LIVE|BE LIVE|BE APPROVED|SHOW))$/;

function isStatusRequest(text = '') {
  const t = normalise(text);
  return Boolean(t) && t.length <= 60 && STATUS_REQUEST.test(t);
}

const THANKS = /^(?:(?:OK|OKAY|YES|SURE|GREAT|NICE|COOL|ALRIGHT) )?(?:THANKS?|THANK YOU|THANK U|THANKYOU|THANX|THX|TNX|ASANTE|WEBALE|APWOYO)(?: (?:SO MUCH|VERY MUCH|A LOT|MUCH|SANA|NNYO|KO|BRO|BOSS|SIR|MADAM|DEAR|TEAM|AGAIN))*$/;

function isThanks(text = '') {
  const t = normalise(text);
  return Boolean(t) && t.length <= 80 && THANKS.test(t);
}

const HELP_REQUEST = /^(?:HELP|HELP ME|I NEED HELP|MSAADA|NSABA OBUYAMBI|OBUYAMBI|NNYAMBA|NYAMBA|SUPPORT|(?:I (?:NEED|WANT) TO )?(?:TALK|SPEAK) TO (?:A )?(?:PERSON|HUMAN|SOMEONE)|CALL ME)$/;

function isHelpRequest(text = '') {
  const t = normalise(text);
  return Boolean(t) && t.length <= 40 && HELP_REQUEST.test(t);
}

/** "HELP" from an owner used to get the main menu, or an email address. */
function ownerHelpReply({ name = '', contact = {} } = {}) {
  const first = firstName(name);
  return [
    `🙋 No problem${first ? ` ${first}` : ''}, help is on the way.`,
    '',
    contact.digits
      ? `I have let *${contact.name}* from our team know, and he will get back to you. If it is urgent, call or WhatsApp ${contact.name} directly on *${contact.pretty}*.`
      : 'I have let our team know, and someone will get back to you here.'
  ].join('\n');
}

function ownerHelpTeamNotice({ name = '', phone = '', said = '', listings = [] } = {}) {
  const digits = String(phone || '').replace(/\D+/g, '');
  return [
    '🙋 *A private owner asked for help on WhatsApp*',
    `${clean(name, 80) || 'Owner'}${digits ? ` · +${digits}` : ''}`,
    digits ? `Reply to them: https://wa.me/${digits}` : '',
    said ? `They said: "${clean(said, 160)}"` : '',
    ...listings.slice(0, 3).map((row) => `🏠 ${listingLabel(row)} — ${String(row.status).toLowerCase()}`),
    '',
    'Please call or WhatsApp them back as soon as you can.'
  ].filter((line, index, all) => line || (index > 0 && all[index - 1])).join('\n');
}

/** This number's own listings (no agent, never found-online), newest first. */
async function ownerListings(db, phone, { statuses = ['pending', 'approved', 'hidden', 'sold'], days = 365 } = {}) {
  const key = phoneKey(phone);
  if (key.length !== 9) return [];
  const result = await db.query(
    `SELECT id, title, area, district, status, lister_name, lister_phone, lister_paid_until, lister_billing_suspended_at,
            inquiry_reference, created_at, reviewed_at, sold_at, moderation_stage, listing_type, availability_status
       FROM properties
      WHERE agent_id IS NULL AND NOT ${foundOnlinePropertySql('properties')}
        AND RIGHT(REGEXP_REPLACE(COALESCE(lister_phone, ''), '[^0-9]', '', 'g'), 9) = $1
        AND LOWER(COALESCE(status, '')) = ANY($2::text[])
        AND created_at > NOW() - ($3::int * INTERVAL '1 day')
      ORDER BY created_at DESC LIMIT 12`,
    [key, statuses, days]
  );
  return result.rows || [];
}

function listingLabel(row = {}) {
  const title = clean(row.title, 70) || 'Your property';
  return row.inquiry_reference ? `${title} (${row.inquiry_reference})` : title;
}

/** One line on where a listing is, in the owner's words. */
function ownerStateLine(row = {}, today = revenue.kampalaDate()) {
  const status = String(row.status || '').toLowerCase();
  const paid = revenue.isoDay(row.lister_paid_until);
  const url = `${SITE()}/property/${row.id}`;
  if (status === 'pending') return '⏳ With our team for review. I message you the link the moment it is live.';
  if (status === 'sold') return `🏷️ Marked ${soldWord(row)}. It shows a ${soldWord(row)} badge for 7 days, then comes off the site.`;
  if (status === 'hidden') {
    if (row.lister_billing_suspended_at) return '⛔ Off the site because the monthly fee was not paid. Pay and it goes straight back up.';
    if (String(row.moderation_stage || '') === 'removed_by_owner') return '🗑️ Off the site. You removed it.';
    return '⛔ Off the site. Reply *HELP* and a person will look at it.';
  }
  if (paid && paid >= today) return `✅ Live, paid until ${shortDay(paid)}.\n${url}`;
  if (paid) return `✅ Live. The monthly fee was due on ${shortDay(paid)}.\n${url}`;
  return `✅ Live. The first month (${ugxLabel(publishedPricing().owner_listing.monthly_ugx)}) is not paid yet.\n${url}`;
}

function ownerStatusMessage(listings = [], { name = '' } = {}) {
  const first = firstName(name || listings[0]?.lister_name);
  const lines = [`📋 *Your ${listings.length === 1 ? 'property' : 'properties'} on makaug${first ? `, ${first}` : ''}*`];
  for (const row of listings.slice(0, 6)) {
    lines.push('', `*${listingLabel(row)}*`, ownerStateLine(row));
  }
  if (listings.length > 6) lines.push('', `…and ${listings.length - 6} more.`);
  const onSite = listings.some((row) => ['pending', 'approved'].includes(String(row.status || '').toLowerCase()));
  lines.push('', onSite
    ? 'Sold or let it? Reply *SOLD*. Want it off the site? Reply *REMOVE*. Another one to list? Reply *LIST*.'
    : 'Another property to list? Reply *LIST*.');
  return lines.join('\n');
}

function removePickMessage(listings = []) {
  return [
    '🗑️ *Which one should come off makaug?* Reply the number:',
    '',
    ...listings.map((row, index) => `*${index + 1}* · ${listingLabel(row)}${String(row.status).toLowerCase() === 'pending' ? ' — in review' : ''}`),
    '',
    '*0* · None, leave them'
  ].join('\n');
}

function removeConfirmMessage(row = {}) {
  return [
    `🗑️ Take *${listingLabel(row)}* off makaug?`,
    '',
    'Reply *YES* to remove it, or *NO* to keep it.',
    '',
    '_If it has sold or been let, reply *SOLD* instead: it shows a SOLD badge for 7 days first, which tells buyers you close deals._'
  ].join('\n');
}

function removedMessage(row = {}) {
  return `✅ Done. *${listingLabel(row)}* is off makaug.com and nobody will be sent to it. Nothing more is charged for it.\n\nWas that a mistake, or want it back? Reply *HELP*. Another property to list? Reply *LIST*.`;
}

function removedTeamNotice({ row = {}, phone = '' } = {}) {
  const digits = String(phone || '').replace(/\D+/g, '');
  return [
    '🗑️ *A private owner removed their listing*',
    `${clean(row.lister_name, 80) || 'Owner'}${digits ? ` · +${digits}` : ''}`,
    `🏠 ${listingLabel(row)}`,
    `It was ${String(row.status).toLowerCase() === 'pending' ? 'still in review' : 'live'}. It is off the site now and off *Who still owes*.`,
    'A quick call to ask why is worth it.'
  ].join('\n');
}

/** Take one of this number's own listings off the site, and write down that they asked. */
async function removeOwnerListing(db, { listing = {}, phone = '' } = {}) {
  const digits = String(phone || '').replace(/\D+/g, '');
  const updated = await db.query(
    `UPDATE properties
        SET status = 'hidden',
            moderation_stage = 'removed_by_owner',
            moderation_reason = 'Owner requested removal from the verified listing WhatsApp number.',
            updated_at = NOW(),
            extra_fields = COALESCE(extra_fields, '{}'::jsonb) || jsonb_build_object(
              'owner_removed_via_whatsapp', TRUE,
              'owner_removed_at', NOW()::text
            )
      WHERE id = $1
        AND RIGHT(REGEXP_REPLACE(COALESCE(lister_phone, ''), '[^0-9]', '', 'g'), 9) = $2
        AND LOWER(COALESCE(status, '')) IN ('pending', 'approved', 'live', 'published')
      RETURNING id`,
    [listing.id, digits.slice(-9)]
  );
  if (!updated.rows?.[0]) return false;
  await db.query(
    `INSERT INTO property_moderation_events (property_id, actor_id, action, status_from, status_to, reason, delivery)
     VALUES ($1, 'whatsapp-owner', 'owner_removed_via_whatsapp', $2, 'hidden', $3, $4::jsonb)`,
    [
      listing.id,
      listing.status,
      'Owner requested removal from the verified listing WhatsApp number.',
      JSON.stringify({ channel: 'whatsapp', phone_suffix: digits.slice(-4) })
    ]
  ).catch((error) => logger.warn('WhatsApp owner removal event write failed:', error.message || String(error)));
  return true;
}

/**
 * "Your property has been sent for review": what was sent, and the three things
 * that happen next. The fee is said here so the payment link is no surprise.
 */
function submittedMessage({ name = '', title = '', location = '', price = '', reference = '', monthlyFee = '' } = {}) {
  const first = firstName(name);
  const what = [
    title ? `🏠 *${clean(title, 90)}*` : '',
    [location ? `📍 ${clean(location, 60)}` : '', price ? `💰 ${clean(price, 30)}` : ''].filter(Boolean).join(' · '),
    reference ? `Reference: ${reference}` : ''
  ].filter(Boolean);
  return [
    `🎉 *Sent for review${first ? `, ${first}` : ''}.*`,
    ...(what.length ? ['', ...what] : []),
    '',
    '*What happens next*',
    '1️⃣ Our team checks it, usually within 24 hours.',
    '2️⃣ I send you the link the moment it is live.',
    `3️⃣ With the link comes how to pay: *${monthlyFee} a month* keeps it live. Nothing is charged automatically.`,
    '',
    'Buyers and tenants then call or WhatsApp you directly. makaug takes no commission.',
    '',
    'Reply *STATUS* to check on it, or *REMOVE* to take it off, any time.'
  ].join('\n');
}

/** "Thanks" from an owner whose property is with us: say what happens next. */
function submittedThanksReply({ listings = [], name = '' } = {}) {
  const first = firstName(name || listings[0]?.lister_name);
  const waiting = listings.filter((row) => String(row.status).toLowerCase() === 'pending');
  if (waiting.length) {
    return `You're welcome${first ? `, ${first}` : ''}! 🙌 Our team is checking ${waiting.length === 1 ? 'your property' : 'your properties'} now, usually within 24 hours. I will message you the link the moment it is live.`;
  }
  return `You're welcome${first ? `, ${first}` : ''}! 🙌`;
}

// --- Sold, seven days on -------------------------------------------------------

/** Sold listings whose 7 days with the SOLD badge have just ended, and whose lister has not been told. */
async function soldListingsJustOff(db) {
  const result = await db.query(
    `SELECT p.id, p.title, p.area, p.district, p.listing_type, p.availability_status, p.sold_at, p.lister_name, p.lister_phone,
            p.agent_id, a.full_name AS agent_name, a.greeting_name AS agent_greeting_name,
            COALESCE(a.whatsapp, a.phone) AS agent_phone, a.status AS agent_status, a.removed_at AS agent_removed_at
       FROM properties p
       LEFT JOIN agents a ON a.id = p.agent_id
      WHERE LOWER(COALESCE(p.status, '')) = 'sold'
        AND p.sold_at IS NOT NULL
        AND p.sold_at <= NOW() - ($1::int * INTERVAL '1 day')
        AND p.sold_at > NOW() - (($1::int + $2::int) * INTERVAL '1 day')
        AND NOT (COALESCE(p.extra_fields, '{}'::jsonb) ? 'sold_off_notice_at')
        AND NOT ${foundOnlinePropertySql('p')}
      ORDER BY p.sold_at ASC LIMIT 100`,
    [SOLD_PUBLIC_DAYS, SOLD_NOTICE_LOOKBACK_DAYS]
  );
  return result.rows || [];
}

/**
 * SOLD, or LET for a rental. A landlord whose house has been taken has not
 * sold it. The same rule the King uses for "Mark let" (rent and short stays),
 * plus student rooms.
 */
function soldWord(row = {}) {
  const availability = String(row.availability_status || '').toLowerCase();
  return availability === 'let_agreed' || /rent|short|student/.test(String(row.listing_type || '').toLowerCase()) ? 'LET' : 'SOLD';
}

function soldOffMessage(row = {}) {
  const isAgent = Boolean(row.agent_id);
  const name = isAgent ? (clean(row.agent_greeting_name, 30) || firstName(row.agent_name)) : firstName(row.lister_name);
  const title = clean(row.title, 90) || 'Your property';
  return [
    `🏷️ *${title}* has now come off makaug.com${name ? `, ${name}` : ''}. It showed as ${soldWord(row)} for 7 days, and that week is up.`,
    '',
    isAgent
      ? 'Got the next one? Send it here the same way: photos and a caption.'
      : 'Another property to sell or let? Reply *LIST* and I will take you through it.'
  ].join('\n');
}

function soldOffTeamNotice(rows = []) {
  return [
    `🏷️ *${rows.length} sold ${rows.length === 1 ? 'listing' : 'listings'} came off the site today*`,
    ...rows.slice(0, 15).map((row) => `• ${clean(row.title, 70) || 'Listing'} — ${clean(row.agent_name || row.lister_name, 50) || 'lister'}`),
    rows.length > 15 ? `…and ${rows.length - 15} more` : '',
    'Each lister has been told, and asked for their next property.'
  ].filter(Boolean).join('\n');
}

/**
 * Daily: tell each lister whose sold property has just come off the site.
 * Once per listing. Runs with the billing reminders, in the Kampala morning.
 */
async function runSoldOffNotices(db, { deliver = null, notifyTeam = null } = {}) {
  const rows = await soldListingsJustOff(db);
  if (!rows.length) return { told: 0 };
  const send = deliver || (async (to, body, nonce) => require('./leadHandoffService').deliverWhatsapp({ to, body, kind: 'sold_listing_off', leadId: null, nonce }));
  const told = [];
  for (const row of rows) {
    const agentGone = row.agent_id && (row.agent_removed_at || String(row.agent_status || '') !== 'approved');
    const to = String((row.agent_id ? row.agent_phone : row.lister_phone) || '').replace(/\D+/g, '');
    let status = 'skipped';
    if (!agentGone && to.length >= 9) {
      try {
        status = (await send(to, soldOffMessage(row), `${row.id}:sold_off`))?.status || 'unknown';
      } catch (error) {
        status = 'failed';
        logger.warn('Sold-off notice failed', { propertyId: row.id, error: error.message });
      }
    }
    // Written down whatever happened, so nobody is told twice.
    await db.query(
      `UPDATE properties
          SET extra_fields = COALESCE(extra_fields, '{}'::jsonb) || jsonb_build_object('sold_off_notice_at', NOW()::text, 'sold_off_notice_status', $2::text)
        WHERE id = $1`,
      [row.id, status]
    ).catch((error) => logger.warn('Sold-off notice not recorded', { propertyId: row.id, error: error.message }));
    if (['sent', 'queued', 'simulated'].includes(status)) told.push(row);
  }
  if (told.length) {
    const team = notifyTeam || (async (body) => require('./leadDeskService').sendToTeam(db, body, 'sold_listings_off'));
    await team(soldOffTeamNotice(told)).catch(() => null);
  }
  return { told: told.length, checked: rows.length };
}

module.exports = {
  OWNER_REMOVE_PICK_STEP,
  OWNER_REMOVE_CONFIRM_STEP,
  SOLD_PUBLIC_DAYS,
  isRemoveRequest,
  isStatusRequest,
  isThanks,
  isHelpRequest,
  ownerHelpReply,
  ownerHelpTeamNotice,
  ownerListings,
  ownerStateLine,
  ownerStatusMessage,
  removePickMessage,
  removeConfirmMessage,
  removedMessage,
  removedTeamNotice,
  removeOwnerListing,
  submittedMessage,
  submittedThanksReply,
  soldListingsJustOff,
  soldWord,
  soldOffMessage,
  soldOffTeamNotice,
  runSoldOffNotices
};
