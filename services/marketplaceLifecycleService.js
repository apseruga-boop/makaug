'use strict';

const crypto = require('crypto');

const logger = require('../config/logger');
const { sendSupportEmail } = require('./emailService');
const { logNotification, notificationStatusFromDelivery } = require('./notificationLogService');
const { sendWhatsAppText } = require('./whatsappNotificationService');

const MARKETPLACE_REGJOURNEY_MARKER = 'marketplace-regjourney-20260719';
const SUPPORTED_LANGUAGES = new Set(['en', 'lg', 'sw', 'ac', 'ny', 'rn', 'sm', 'am', 'ar']);
const REJECTION_REASONS = Object.freeze({
  duplicate: 'Duplicate business profile',
  not_property_related: 'Business is not property-related',
  bad_contact: 'Contact details could not be verified',
  suspicious: 'Submission needs additional trust evidence'
});

const COPY = Object.freeze({
  en: {
    received: ({ name, reference }) => `makaug: we received your listing for ${name}. Ref ${reference}. Most reviews are completed within 24 hours. We will message you when it is live.`,
    live: ({ name, publicUrl, editUrl, waitlistUrl }) => `makaug: ${name} is now live as Privately Listed.\n\nView profile: ${publicUrl}\nEdit your profile anytime: ${editUrl}\n\nWant to appear first in search and receive leads first? Verified is coming. Join the waitlist: ${waitlistUrl}`,
    rejected: ({ name, reason, resubmitUrl }) => `makaug: we could not approve ${name} yet. Reason: ${reason}. Please correct the details and resubmit here: ${resubmitUrl}`,
    day7: ({ name, views, category, waitlistUrl }) => `${name} has been viewed ${views} times this week. Verified ${category} businesses receive leads first. Verified will be UGX 150,000/year. Join the waitlist: ${waitlistUrl}`,
    lead: ({ category, district, waitlistUrl }) => `A customer just asked for ${category} services in ${district}. Verified members received the lead first. Join the Verified waitlist to be first next time: ${waitlistUrl}`
  },
  lg: {
    received: ({ name, reference }) => `makaug: tufunye okwewandiisa kwa ${name}. Ref ${reference}. Okukebera kusinga kukolebwa mu ssaawa 24. Tujja kukutegeeza bwe kunaaba kulabika.`,
    live: ({ name, publicUrl, editUrl, waitlistUrl }) => `makaug: ${name} kati erabika nga Privately Listed.\n\nLaba profile: ${publicUrl}\nKyusa profile yo: ${editUrl}\n\nOyagala okusooka mu kunoonya n'okufuna leads? Verified ejja. Weewandiise: ${waitlistUrl}`,
    rejected: ({ name, reason, resubmitUrl }) => `makaug: tetunnasobola kukkiriza ${name}. Ensonga: ${reason}. Tereeza ebikwata ku bizinesi oddemu oweereze: ${resubmitUrl}`,
    day7: ({ name, views, category, waitlistUrl }) => `${name} erabiddwa emirundi ${views} wiiki eno. Bizinesi za ${category} eza Verified ze zisooka okufuna leads. Omuwendo gujja kuba UGX 150,000 buli mwaka. Weewandiise: ${waitlistUrl}`,
    lead: ({ category, district, waitlistUrl }) => `Kasitoma anoonya ${category} mu ${district}. Aba Verified be basoose okufuna lead. Weewandiise ku Verified: ${waitlistUrl}`
  },
  sw: {
    received: ({ name, reference }) => `makaug: tumepokea usajili wa ${name}. Ref ${reference}. Ukaguzi mwingi hukamilika ndani ya saa 24. Tutakujulisha ukiwa live.`,
    live: ({ name, publicUrl, editUrl, waitlistUrl }) => `makaug: ${name} sasa iko live kama Privately Listed.\n\nTazama wasifu: ${publicUrl}\nHariri wakati wowote: ${editUrl}\n\nUnataka kuonekana kwanza na kupata leads kwanza? Verified inakuja. Jiunge: ${waitlistUrl}`,
    rejected: ({ name, reason, resubmitUrl }) => `makaug: hatujaweza kuidhinisha ${name}. Sababu: ${reason}. Sahihisha maelezo na utume tena: ${resubmitUrl}`,
    day7: ({ name, views, category, waitlistUrl }) => `${name} imetazamwa mara ${views} wiki hii. Biashara za ${category} zilizo Verified hupata leads kwanza. Bei itakuwa UGX 150,000 kwa mwaka. Jiunge: ${waitlistUrl}`,
    lead: ({ category, district, waitlistUrl }) => `Mteja ameomba huduma ya ${category} katika ${district}. Wanachama Verified walipata lead kwanza. Jiunge: ${waitlistUrl}`
  },
  ac: {
    received: ({ name, reference }) => `makaug: wagamo coc pa ${name}. Ref ${reference}. Kineno coc mapol i cawa 24. Wabi cwalo lok ka dong tye live.`,
    live: ({ name, publicUrl, editUrl, waitlistUrl }) => `makaug: ${name} dong tye live macalo Privately Listed.\nNen profile: ${publicUrl}\nYub profile: ${editUrl}\nVerified bino - donyo i nying: ${waitlistUrl}`,
    rejected: ({ name, reason, resubmitUrl }) => `makaug: pe watwero yee ${name} pud. Tyen lok: ${reason}. Yub lok ki icwal dok: ${resubmitUrl}`,
    day7: ({ name, views, category, waitlistUrl }) => `${name} kineno tyen ${views} i cabit man. Jo ${category} ma Verified giyudo leads kong. Wel bino bedo UGX 150,000 i mwaka. Dony i nying: ${waitlistUrl}`,
    lead: ({ category, district, waitlistUrl }) => `Latic mito ${category} i ${district}. Jo Verified guyudo lead kong. Dony i nying: ${waitlistUrl}`
  },
  ny: {
    received: ({ name, reference }) => `makaug: twakiira okuhandiika kwa ${name}. Ref ${reference}. Okukebera nikukira kumara omu shaaha 24. Nitwija kukumanyisa ku eraabe live.`,
    live: ({ name, publicUrl, editUrl, waitlistUrl }) => `makaug: ${name} hati eri live nka Privately Listed.\nReeba profile: ${publicUrl}\nHindura profile: ${editUrl}\nVerified neija - handiika aha waitlist: ${waitlistUrl}`,
    rejected: ({ name, reason, resubmitUrl }) => `makaug: titwabaasize kwikiriza ${name}. Enshonga: ${reason}. Tereeza ogarukemu ohereze: ${resubmitUrl}`,
    day7: ({ name, views, category, waitlistUrl }) => `${name} ereebirwe emirundi ${views} omu saabiiti egi. Aba ${category} aba Verified nibo babanza leads. Omuhendo nigwija kuba UGX 150,000 omu mwaka. Handiika: ${waitlistUrl}`,
    lead: ({ category, district, waitlistUrl }) => `Omukiriya naayenda ${category} omu ${district}. Aba Verified nibo babanzire lead. Handiika: ${waitlistUrl}`
  },
  rn: {
    received: ({ name, reference }) => `makaug: twakiira okuhandiika kwa ${name}. Ref ${reference}. Okukebera nikukira kumara omu shaaha 24. Nitwija kukumanyisa ku eraabe live.`,
    live: ({ name, publicUrl, editUrl, waitlistUrl }) => `makaug: ${name} hati eri live nka Privately Listed.\nReeba profile: ${publicUrl}\nHindura profile: ${editUrl}\nVerified neija - handiika aha waitlist: ${waitlistUrl}`,
    rejected: ({ name, reason, resubmitUrl }) => `makaug: titwabaasize kwikiriza ${name}. Enshonga: ${reason}. Tereeza ogarukemu ohereze: ${resubmitUrl}`,
    day7: ({ name, views, category, waitlistUrl }) => `${name} ereebirwe emirundi ${views} omu saabiiti egi. Aba ${category} aba Verified nibo babanza leads. Omuhendo nigwija kuba UGX 150,000 omu mwaka. Handiika: ${waitlistUrl}`,
    lead: ({ category, district, waitlistUrl }) => `Omukiriya naayenda ${category} omu ${district}. Aba Verified nibo babanzire lead. Handiika: ${waitlistUrl}`
  },
  sm: {
    received: ({ name, reference }) => `makaug: tufunye okwewandiisa kwa ${name}. Ref ${reference}. Okukebera kutera okukolebwa mu ssaawa 24. Tujja kukutegeeza bwe kunaaba live.`,
    live: ({ name, publicUrl, editUrl, waitlistUrl }) => `makaug: ${name} kati eri live nga Privately Listed.\nBona profile: ${publicUrl}\nKyusa profile: ${editUrl}\nVerified ejja - weewandiise: ${waitlistUrl}`,
    rejected: ({ name, reason, resubmitUrl }) => `makaug: tetunnasobola kukkiriza ${name}. Ensonga: ${reason}. Tereeza oddemu oweereze: ${resubmitUrl}`,
    day7: ({ name, views, category, waitlistUrl }) => `${name} eboneddwa emirundi ${views} wiiki eno. Aba ${category} aba Verified be basooka leads. Omuwendo gujja kuba UGX 150,000 buli mwaka. Weewandiise: ${waitlistUrl}`,
    lead: ({ category, district, waitlistUrl }) => `Kasitoma anoonya ${category} mu ${district}. Aba Verified be basoose lead. Weewandiise: ${waitlistUrl}`
  },
  am: {
    received: ({ name, reference }) => `makaug: የ${name} ምዝገባ ደርሶናል። ማጣቀሻ ${reference}። አብዛኛው ግምገማ በ24 ሰዓት ውስጥ ይጠናቀቃል። በቀጥታ ሲታይ እናሳውቃለን።`,
    live: ({ name, publicUrl, editUrl, waitlistUrl }) => `makaug: ${name} እንደ Privately Listed በቀጥታ ይታያል።\nመገለጫ: ${publicUrl}\nአርትዕ: ${editUrl}\nVerified በቅርቡ ይመጣል። ይመዝገቡ: ${waitlistUrl}`,
    rejected: ({ name, reason, resubmitUrl }) => `makaug: ${name}ን ገና ማጽደቅ አልቻልንም። ምክንያት: ${reason}። አስተካክለው እንደገና ይላኩ: ${resubmitUrl}`,
    day7: ({ name, views, category, waitlistUrl }) => `${name} በዚህ ሳምንት ${views} ጊዜ ታይቷል። Verified ${category} መጀመሪያ leads ያገኛሉ። ዋጋው በዓመት UGX 150,000 ይሆናል። ይመዝገቡ: ${waitlistUrl}`,
    lead: ({ category, district, waitlistUrl }) => `ደንበኛ በ${district} የ${category} አገልግሎት ጠይቋል። Verified አባላት መጀመሪያ lead አግኝተዋል። ይመዝገቡ: ${waitlistUrl}`
  },
  ar: {
    received: ({ name, reference }) => `makaug: استلمنا تسجيل ${name}. المرجع ${reference}. تكتمل معظم المراجعات خلال 24 ساعة. سنراسلك عند النشر.`,
    live: ({ name, publicUrl, editUrl, waitlistUrl }) => `makaug: أصبح ${name} منشورا كإدراج خاص.\nالملف: ${publicUrl}\nالتعديل: ${editUrl}\nخدمة Verified قادمة. انضم للقائمة: ${waitlistUrl}`,
    rejected: ({ name, reason, resubmitUrl }) => `makaug: لم نتمكن من اعتماد ${name} بعد. السبب: ${reason}. صحح البيانات وأعد الإرسال: ${resubmitUrl}`,
    day7: ({ name, views, category, waitlistUrl }) => `تمت مشاهدة ${name} عدد ${views} مرات هذا الأسبوع. الأعمال الموثقة في ${category} تحصل على العملاء أولا. سيكون السعر 150,000 UGX سنويا. انضم: ${waitlistUrl}`,
    lead: ({ category, district, waitlistUrl }) => `طلب عميل خدمة ${category} في ${district}. حصل الأعضاء الموثقون على الطلب أولا. انضم: ${waitlistUrl}`
  }
});

let schedulerTimer = null;
let schedulerRunning = false;

function clean(value = '') {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function languageCode(value = '') {
  const code = clean(value).toLowerCase().split(/[-_]/)[0];
  return SUPPORTED_LANGUAGES.has(code) ? code : 'en';
}

function baseUrl() {
  return clean(process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || process.env.BASE_URL || 'https://makaug.com').replace(/\/+$/, '');
}

function hashMagicToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function lifecycleCopy(language, type, data = {}) {
  const set = COPY[languageCode(language)] || COPY.en;
  return typeof set[type] === 'function' ? set[type](data) : '';
}

function rejectionReasonLabel(code, fallback = '') {
  return REJECTION_REASONS[clean(code)] || clean(fallback) || 'The submission needs corrections before it can be published.';
}

async function issueMarketplaceEditLink(db, { businessId, claimId = null, actorUserId = null } = {}) {
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashMagicToken(token);
  const days = Math.max(30, Math.min(730, parseInt(process.env.MARKETPLACE_EDIT_LINK_DAYS || '365', 10) || 365));
  await db.query(
    `UPDATE marketplace_edit_tokens SET revoked_at = NOW() WHERE business_id = $1 AND revoked_at IS NULL`,
    [businessId]
  );
  await db.query(
    `INSERT INTO marketplace_edit_tokens (business_id, claim_id, token_hash, created_by, expires_at)
     VALUES ($1,$2,$3,$4,NOW() + ($5::text || ' days')::interval)`,
    [businessId, claimId, tokenHash, actorUserId, days]
  );
  return `${baseUrl()}/marketplace#manage=${encodeURIComponent(token)}`;
}

async function resolveMarketplaceEditToken(db, token) {
  const raw = clean(token);
  if (raw.length < 32) return null;
  const result = await db.query(
    `SELECT t.id AS token_id, t.business_id, t.expires_at,
            b.id, b.name, b.slug, b.category, b.description, b.services_text,
            b.district, b.area, b.serves_regions, b.phone, b.whatsapp, b.email,
            b.website, b.social_links, b.profile_images, b.tier, b.status,
            b.owner_name, b.owner_phone, b.owner_email, b.owner_language,
            b.profile_view_count, b.updated_at
     FROM marketplace_edit_tokens t
     JOIN marketplace_businesses b ON b.id = t.business_id
     WHERE t.token_hash = $1 AND t.revoked_at IS NULL AND t.expires_at > NOW()
     LIMIT 1`,
    [hashMagicToken(raw)]
  );
  const row = result.rows[0] || null;
  if (row) {
    await db.query(`UPDATE marketplace_edit_tokens SET last_used_at = NOW() WHERE id = $1`, [row.token_id]);
  }
  return row;
}

async function reserveNotification(db, { business, leadId = null, type, triggerKey, language, payload = {} } = {}) {
  const result = await db.query(
    `INSERT INTO marketplace_owner_notifications (
       business_id, lead_id, notification_type, trigger_key,
       recipient_phone, recipient_email, language, payload
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
     ON CONFLICT (trigger_key) DO UPDATE
       SET status = 'pending', failure_reason = NULL, updated_at = NOW()
       WHERE marketplace_owner_notifications.status IN ('failed', 'skipped')
     RETURNING id`,
    [
      business.id,
      leadId,
      type,
      triggerKey,
      business.owner_phone || business.whatsapp || business.phone || null,
      business.owner_email || business.email || null,
      languageCode(language || business.owner_language),
      JSON.stringify(payload)
    ]
  );
  return result.rows[0]?.id || null;
}

async function deliverOwnerMessage(db, { business, leadId = null, type, triggerKey, subject, body, language, payload = {} } = {}) {
  const notificationId = await reserveNotification(db, { business, leadId, type, triggerKey, language, payload });
  if (!notificationId) return { sent: false, skipped: true, reason: 'already_delivered_or_queued' };
  const phone = clean(business.owner_phone || business.whatsapp || business.phone);
  const email = clean(business.owner_email || business.email).toLowerCase();
  const attempts = [];
  let delivery = null;
  let channel = null;
  if (phone) {
    channel = 'whatsapp';
    delivery = await sendWhatsAppText({ to: phone, body });
    attempts.push({ channel, delivery });
    await logNotification(db, {
      channel,
      type,
      status: notificationStatusFromDelivery(delivery),
      recipientPhone: phone,
      relatedLeadId: leadId,
      failureReason: delivery.sent ? null : (delivery.error || delivery.reason || null),
      payloadSummary: { marketplace_business_id: business.id, trigger_key: triggerKey }
    });
  }
  if ((!delivery?.sent && !delivery?.queued) && email) {
    channel = 'email';
    delivery = await sendSupportEmail({ to: email, subject, text: body });
    attempts.push({ channel, delivery });
    await logNotification(db, {
      channel,
      type,
      status: notificationStatusFromDelivery(delivery),
      recipientEmail: email,
      relatedLeadId: leadId,
      failureReason: delivery.sent ? null : (delivery.error || delivery.reason || null),
      payloadSummary: { marketplace_business_id: business.id, trigger_key: triggerKey }
    });
  }
  const sent = Boolean(delivery?.sent || delivery?.queued);
  const failureReason = sent ? null : clean(delivery?.error || delivery?.reason || (phone || email ? 'delivery_failed' : 'missing_owner_contact'));
  await db.query(
    `UPDATE marketplace_owner_notifications
     SET channel = $2, status = $3, failure_reason = $4, sent_at = CASE WHEN $3 = 'sent' THEN NOW() ELSE sent_at END, updated_at = NOW()
     WHERE id = $1`,
    [notificationId, channel, sent ? 'sent' : (phone || email ? 'failed' : 'skipped'), failureReason || null]
  );
  return { sent, channel, delivery, attempts, failure_reason: failureReason || null };
}

async function sendMarketplaceRegistrationAcknowledgement(db, business, reference) {
  const language = languageCode(business.owner_language);
  const body = lifecycleCopy(language, 'received', { name: business.name, reference });
  const result = await deliverOwnerMessage(db, {
    business,
    type: 'marketplace_registration_acknowledgement',
    triggerKey: `marketplace-registration-ack:${business.id}`,
    subject: `makaug received ${business.name} - ${reference}`,
    body,
    language,
    payload: { reference }
  });
  if (result.sent) {
    await db.query(`UPDATE marketplace_businesses SET registration_acknowledged_at = NOW() WHERE id = $1`, [business.id]);
  }
  return result;
}

async function sendMarketplaceApprovalNotification(db, business, { claimId = null, actorUserId = null } = {}) {
  const editUrl = await issueMarketplaceEditLink(db, { businessId: business.id, claimId, actorUserId });
  const publicUrl = `${baseUrl()}/marketplace?business=${encodeURIComponent(business.slug)}`;
  const waitlistUrl = `${baseUrl()}/marketplace?verified_waitlist=1&business=${encodeURIComponent(business.slug)}`;
  const language = languageCode(business.owner_language);
  const body = lifecycleCopy(language, 'live', { name: business.name, publicUrl, editUrl, waitlistUrl });
  const result = await deliverOwnerMessage(db, {
    business,
    type: 'marketplace_business_live',
    triggerKey: `marketplace-business-live:${business.id}:${claimId || 'registration'}`,
    subject: `${business.name} is live on makaug`,
    body,
    language,
    payload: { public_profile: publicUrl, magic_edit_issued: true, verified_waitlist: waitlistUrl }
  });
  if (result.sent) {
    await db.query(`UPDATE marketplace_businesses SET approval_notification_sent_at = NOW() WHERE id = $1`, [business.id]);
  }
  return { ...result, public_url: publicUrl, edit_url: editUrl, waitlist_url: waitlistUrl };
}

async function sendMarketplaceRejectionNotification(db, business, { reasonCode, reason, triggerSuffix = '' } = {}) {
  const language = languageCode(business.owner_language);
  const reasonLabel = rejectionReasonLabel(reasonCode, reason);
  const resubmitUrl = `${baseUrl()}/marketplace#register`;
  const body = lifecycleCopy(language, 'rejected', { name: business.name, reason: reasonLabel, resubmitUrl });
  const result = await deliverOwnerMessage(db, {
    business,
    type: 'marketplace_business_rejected',
    triggerKey: `marketplace-business-rejected:${business.id}:${reasonCode || 'other'}:${clean(triggerSuffix) || 'registration'}`,
    subject: `Update required for ${business.name} on makaug`,
    body,
    language,
    payload: { reason_code: reasonCode, reason: reasonLabel }
  });
  if (result.sent) {
    await db.query(`UPDATE marketplace_businesses SET rejection_notification_sent_at = NOW() WHERE id = $1`, [business.id]);
  }
  return result;
}

async function runMarketplaceDay7Followups(db, { limit = 25 } = {}) {
  const result = await db.query(
    `SELECT * FROM marketplace_businesses
     WHERE status = 'live' AND tier = 'private'
       AND reviewed_at <= NOW() - INTERVAL '7 days'
       AND day7_followup_sent_at IS NULL
     ORDER BY reviewed_at ASC
     LIMIT $1`,
    [Math.max(1, Math.min(100, Number(limit) || 25))]
  );
  let sent = 0;
  for (const business of result.rows) {
    const waitlistUrl = `${baseUrl()}/marketplace?verified_waitlist=1&business=${encodeURIComponent(business.slug)}`;
    const language = languageCode(business.owner_language);
    const body = lifecycleCopy(language, 'day7', {
      name: business.name,
      views: Number(business.profile_view_count || 0),
      category: clean(business.category).replace(/_/g, ' '),
      waitlistUrl
    });
    const delivery = await deliverOwnerMessage(db, {
      business,
      type: 'marketplace_day7_upgrade_followup',
      triggerKey: `marketplace-day7:${business.id}`,
      subject: `${business.name} weekly profile update`,
      body,
      language,
      payload: { views: Number(business.profile_view_count || 0), verified_waitlist: waitlistUrl }
    });
    await db.query(`UPDATE marketplace_businesses SET day7_followup_sent_at = NOW() WHERE id = $1`, [business.id]);
    if (delivery.sent) sent += 1;
  }
  return { checked: result.rows.length, sent };
}

async function notifyMarketplaceLeadOpportunity(db, lead) {
  if (!lead?.id || !lead.category || !lead.district) return { matched: 0, sent: 0 };
  const cap = Math.max(1, Math.min(25, parseInt(process.env.MARKETPLACE_LEAD_UPSELL_RECIPIENT_CAP || '10', 10) || 10));
  const result = await db.query(
    `SELECT * FROM marketplace_businesses
     WHERE status = 'live' AND tier = 'private' AND category = $1
       AND (district = $2 OR $2 = ANY(serves_regions))
     ORDER BY updated_at DESC
     LIMIT $3`,
    [lead.category, lead.district, cap]
  );
  let sent = 0;
  for (const business of result.rows) {
    const waitlistUrl = `${baseUrl()}/marketplace?verified_waitlist=1&business=${encodeURIComponent(business.slug)}`;
    const language = languageCode(business.owner_language);
    const body = lifecycleCopy(language, 'lead', {
      category: clean(lead.category).replace(/_/g, ' '),
      district: lead.district,
      waitlistUrl
    });
    const delivery = await deliverOwnerMessage(db, {
      business,
      leadId: lead.id,
      type: 'marketplace_lead_upgrade_prompt',
      triggerKey: `marketplace-lead:${lead.id}:${business.id}`,
      subject: `New ${clean(lead.category).replace(/_/g, ' ')} demand in ${lead.district}`,
      body,
      language,
      payload: { category: lead.category, district: lead.district, verified_waitlist: waitlistUrl }
    });
    if (delivery.sent) sent += 1;
  }
  return { matched: result.rows.length, sent };
}

async function tickMarketplaceLifecycleScheduler(db) {
  if (schedulerRunning) return { skipped: true, reason: 'already_running' };
  schedulerRunning = true;
  try {
    return await runMarketplaceDay7Followups(db);
  } catch (error) {
    logger.warn('Marketplace lifecycle scheduler tick failed', { error: error.message });
    return { error: error.message };
  } finally {
    schedulerRunning = false;
  }
}

function startMarketplaceLifecycleScheduler(db) {
  if (schedulerTimer || !process.env.DATABASE_URL || process.env.MARKETPLACE_LIFECYCLE_SCHEDULER_ENABLED === 'false') return;
  const intervalMs = Math.max(60_000, parseInt(process.env.MARKETPLACE_LIFECYCLE_INTERVAL_MS || '900000', 10) || 900_000);
  schedulerTimer = setInterval(() => tickMarketplaceLifecycleScheduler(db), intervalMs);
  schedulerTimer.unref?.();
  setTimeout(() => tickMarketplaceLifecycleScheduler(db), 10_000).unref?.();
  logger.info('Marketplace lifecycle scheduler armed', { intervalMs });
}

module.exports = {
  MARKETPLACE_REGJOURNEY_MARKER,
  REJECTION_REASONS,
  hashMagicToken,
  issueMarketplaceEditLink,
  languageCode,
  lifecycleCopy,
  notifyMarketplaceLeadOpportunity,
  rejectionReasonLabel,
  resolveMarketplaceEditToken,
  runMarketplaceDay7Followups,
  sendMarketplaceApprovalNotification,
  sendMarketplaceRegistrationAcknowledgement,
  sendMarketplaceRejectionNotification,
  startMarketplaceLifecycleScheduler
};
