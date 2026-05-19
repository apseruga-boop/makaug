'use strict';

const ROLE_DASHBOARD_MAP = {
  super_admin: '/admin',
  admin: '/admin',
  agent_broker: '/broker-dashboard',
  field_agent: '/field-agent-dashboard',
  property_owner: '/dashboard',
  buyer_renter: '/dashboard'
};

function normalizeSignupAudience(value = '') {
  const input = String(value || '').toLowerCase().trim();
  if (['student', 'student_parent', 'student-signup'].includes(input)) return 'student';
  if (['agent', 'broker', 'agent_broker', 'broker-signup'].includes(input)) return 'agent';
  if (['field', 'field_agent', 'field-agent', 'field-agent-signup'].includes(input)) return 'field_agent';
  if (['advertiser', 'advertiser-signup'].includes(input)) return 'advertiser';
  if (['admin', 'super_admin'].includes(input)) return input;
  return 'finder';
}

function roleForSignup({ roleInput = '', audience = '' } = {}) {
  const resolvedAudience = normalizeSignupAudience(audience || roleInput);
  if (resolvedAudience === 'field_agent') return 'field_agent';
  if (resolvedAudience === 'agent') return 'agent_broker';

  const input = String(roleInput || '').toLowerCase().trim();
  const roleMap = {
    'buyer / renter': 'buyer_renter',
    buyer: 'buyer_renter',
    renter: 'buyer_renter',
    buyer_renter: 'buyer_renter',
    finder: 'buyer_renter',
    property_finder: 'buyer_renter',
    student: 'buyer_renter',
    advertiser: 'buyer_renter',
    'property owner': 'property_owner',
    owner: 'property_owner',
    property_owner: 'property_owner',
    'agent / broker': 'agent_broker',
    agent: 'agent_broker',
    broker: 'agent_broker',
    agent_broker: 'agent_broker',
    field_agent: 'field_agent',
    'field agent': 'field_agent'
  };
  return roleMap[input] || 'buyer_renter';
}

function dashboardForUser(user = {}, preferredAudience = '') {
  const profile = user.profile_data && typeof user.profile_data === 'object' ? user.profile_data : {};
  const audience = normalizeSignupAudience(preferredAudience || profile.audience || profile.account_kind || profile.seeker_type);
  if (user.role === 'admin' || user.role === 'super_admin' || audience === 'admin' || audience === 'super_admin') return '/admin';
  if (user.role === 'field_agent' || audience === 'field_agent') return '/field-agent-dashboard';
  if (user.role === 'agent_broker' || audience === 'agent') return '/broker-dashboard';
  if (audience === 'student') return '/student-dashboard';
  if (audience === 'advertiser') return '/advertiser-dashboard';
  return ROLE_DASHBOARD_MAP[user.role] || '/dashboard';
}

function buildOtpSuccessPayload({ user, token, preferredAudience = '', pendingIntentCompleted = false, message = '' } = {}) {
  const redirectUrl = dashboardForUser(user, preferredAudience);
  return {
    token,
    user,
    success: true,
    userId: user?.id || null,
    role: user?.role || '',
    sessionCreated: Boolean(token),
    contactVerified: true,
    nextAction: 'open_dashboard',
    redirectUrl,
    pendingIntentCompleted: Boolean(pendingIntentCompleted),
    message: message || 'Verification complete. Your makaug.com account is ready.'
  };
}

function cleanText(value = '') {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizePhoneDigits(value = '') {
  return cleanText(value).replace(/\D+/g, '');
}

function parseCsvList(value = '') {
  if (Array.isArray(value)) {
    return value.map((item) => cleanText(item)).filter(Boolean);
  }
  return String(value || '')
    .split(',')
    .map((item) => cleanText(item))
    .filter(Boolean);
}

function parseBooleanLike(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const text = cleanText(value).toLowerCase();
  if (!text) return fallback;
  if (['1', 'true', 'yes', 'y', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(text)) return false;
  return fallback;
}

async function ensurePostVerificationRecords(db, user = {}) {
  if (!db || !user?.id) return;
  const profile = user.profile_data && typeof user.profile_data === 'object' ? user.profile_data : {};
  const audience = normalizeSignupAudience(profile.audience || profile.account_kind || profile.seeker_type);

  if (audience === 'student') {
    await db.query(
      `INSERT INTO student_preferences (
        user_id,
        campus,
        university,
        preferred_locations,
        max_budget,
        preferred_language,
        alert_channels,
        alert_frequency
      ) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7::jsonb,$8)
      ON CONFLICT (user_id) DO UPDATE
      SET campus = COALESCE(student_preferences.campus, EXCLUDED.campus),
          university = COALESCE(student_preferences.university, EXCLUDED.university),
          preferred_language = EXCLUDED.preferred_language,
          updated_at = NOW()`,
      [
        user.id,
        profile.student_campus || profile.university || null,
        profile.student_university || profile.university || null,
        JSON.stringify(profile.preferred_areas ? [profile.preferred_areas] : []),
        parseBudgetUpper(profile.budget_range),
        user.preferred_language || 'en',
        JSON.stringify(['in_app', user.preferred_contact_channel || 'whatsapp']),
        'weekly'
      ]
    );
    return;
  }

  if (audience === 'field_agent') {
    await db.query(
      `UPDATE users
       SET profile_data = COALESCE(profile_data, '{}'::jsonb) || $2::jsonb,
           updated_at = NOW()
       WHERE id = $1`,
      [user.id, JSON.stringify({ field_agent_application_status: 'pending_review' })]
    );
    return;
  }

  if (audience === 'agent') {
    const fullName = cleanText([user.first_name, user.last_name].filter(Boolean).join(' ')) || 'makaug broker';
    const email = cleanText(user.email || '');
    const phone = cleanText(user.phone || '');
    const phoneDigits = normalizePhoneDigits(phone);
    const districtsCovered = parseCsvList(profile.agent_districts || profile.preferred_areas);
    const specializations = parseCsvList(profile.agent_specialities || profile.property_type_interest);
    const privacyConsentAccepted = parseBooleanLike(profile.broker_privacy_consent_accepted, false);
    const dataRetentionNoticeAccepted = parseBooleanLike(profile.broker_data_retention_notice_accepted, false);
    const brokerDocUrl = cleanText(profile.broker_identity_document_url);
    const brokerDocName = cleanText(profile.broker_identity_document_name);
    const brokerDocType = cleanText(profile.broker_identity_document_type);
    const nationalIdNumber = cleanText(profile.broker_national_id_number || profile.national_id_number).toUpperCase();
    const verificationReason = cleanText(profile.broker_verification_reason)
      || 'Broker identity verification submitted during makaug.com account creation.';
    const resolvedLicence = cleanText(profile.area_licence_number || profile.agent_licence_number)
      || `PENDING-${String(user.id).slice(0, 8).toUpperCase()}`;
    const companyName = cleanText(profile.agent_company) || null;
    const profilePhotoUrl = cleanText(profile.broker_profile_photo_url) || null;
    const bio = cleanText(profile.broker_bio)
      || (specializations.length
        ? `makaug broker covering ${districtsCovered.slice(0, 3).join(', ') || 'Uganda'} properties.`
        : null);

    const existing = await db.query(
      `SELECT id
       FROM agents
       WHERE user_id = $1
          OR ($2::text <> '' AND LOWER(COALESCE(email, '')) = LOWER($2))
          OR ($3::text <> '' AND regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') = $3)
       ORDER BY user_id = $1 DESC, updated_at DESC
       LIMIT 1`,
      [user.id, email, phoneDigits]
    );

    let brokerAgentId = existing.rows[0]?.id || null;
    if (brokerAgentId) {
      const updated = await db.query(
        `UPDATE agents
         SET user_id = $1,
             full_name = COALESCE(NULLIF($2, ''), full_name),
             company_name = COALESCE($3, company_name),
             licence_number = COALESCE(NULLIF($4, ''), licence_number),
             registration_status = 'not_registered',
             listing_limit = 2147483647,
             phone = COALESCE(NULLIF($5, ''), phone),
             whatsapp = COALESCE(NULLIF($5, ''), whatsapp),
             email = COALESCE(NULLIF($6, ''), email),
             districts_covered = CASE WHEN cardinality($7::text[]) > 0 THEN $7::text[] ELSE districts_covered END,
             specializations = CASE WHEN cardinality($8::text[]) > 0 THEN $8::text[] ELSE specializations END,
             nin = COALESCE(NULLIF($9, ''), nin),
             identity_document_name = COALESCE(NULLIF($10, ''), identity_document_name),
             identity_document_url = COALESCE(NULLIF($11, ''), identity_document_url),
             identity_document_type = COALESCE(NULLIF($12, ''), identity_document_type),
             identity_document_uploaded_at = CASE WHEN NULLIF($11, '') IS NOT NULL THEN NOW() ELSE identity_document_uploaded_at END,
             verification_reason = COALESCE(NULLIF($13, ''), verification_reason),
             privacy_consent_accepted = privacy_consent_accepted OR $14,
             privacy_consent_at = CASE WHEN $14 THEN COALESCE(privacy_consent_at, NOW()) ELSE privacy_consent_at END,
             data_retention_notice_accepted = data_retention_notice_accepted OR $15,
             data_retention_notice_at = CASE WHEN $15 THEN COALESCE(data_retention_notice_at, NOW()) ELSE data_retention_notice_at END,
             profile_photo_url = COALESCE($16, profile_photo_url),
             bio = COALESCE($17, bio),
             status = CASE WHEN status = 'approved' THEN status ELSE 'pending' END,
             updated_at = NOW()
         WHERE id = $18
         RETURNING id`,
        [
          user.id,
          fullName,
          companyName,
          resolvedLicence,
          phone,
          email,
          districtsCovered,
          specializations,
          nationalIdNumber,
          brokerDocName,
          brokerDocUrl,
          brokerDocType,
          verificationReason,
          privacyConsentAccepted,
          dataRetentionNoticeAccepted,
          profilePhotoUrl,
          bio,
          brokerAgentId
        ]
      );
      brokerAgentId = updated.rows[0]?.id || brokerAgentId;
    } else {
      const inserted = await db.query(
        `INSERT INTO agents (
          full_name,
          company_name,
          licence_number,
          registration_status,
          listing_limit,
          phone,
          whatsapp,
          email,
          districts_covered,
          specializations,
          nin,
          identity_document_name,
          identity_document_url,
          identity_document_type,
          identity_document_uploaded_at,
          verification_reason,
          privacy_consent_accepted,
          privacy_consent_at,
          data_retention_notice_accepted,
          data_retention_notice_at,
          profile_photo_url,
          bio,
          user_id,
          status
        ) VALUES ($1,$2,$3,'not_registered',2147483647,$4,$4,$5,$6,$7,$8,$9,$10,$11,CASE WHEN NULLIF($10, '') IS NOT NULL THEN NOW() ELSE NULL END,$12,$13,CASE WHEN $13 THEN NOW() ELSE NULL END,$14,CASE WHEN $14 THEN NOW() ELSE NULL END,$15,$16,$17,'pending')
        RETURNING id`,
        [
          fullName,
          companyName,
          resolvedLicence,
          phone,
          email || null,
          districtsCovered,
          specializations,
          nationalIdNumber || null,
          brokerDocName || null,
          brokerDocUrl || null,
          brokerDocType || null,
          verificationReason,
          privacyConsentAccepted,
          dataRetentionNoticeAccepted,
          profilePhotoUrl,
          bio,
          user.id
        ]
      );
      brokerAgentId = inserted.rows[0]?.id || null;
    }

    await db.query(
      `UPDATE users
       SET profile_data = COALESCE(profile_data, '{}'::jsonb) || $2::jsonb,
           updated_at = NOW()
       WHERE id = $1`,
      [user.id, JSON.stringify({
        broker_review_status: 'pending_review',
        broker_agent_id: brokerAgentId
      })]
    );
    return;
  }

  await db.query(
    `INSERT INTO property_seeker_profiles (
      user_id,
      first_name,
      last_name,
      preferred_language,
      preferred_contact_channel,
      whatsapp_consent,
      email_alert_consent,
      sms_consent,
      marketing_consent,
      seeker_type,
      current_goal,
      timeline,
      profile_completion_percent,
      onboarding_completed
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
    ON CONFLICT (user_id) DO UPDATE
    SET first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        preferred_language = EXCLUDED.preferred_language,
        preferred_contact_channel = EXCLUDED.preferred_contact_channel,
        updated_at = NOW()`,
    [
      user.id,
      user.first_name || null,
      user.last_name || null,
      user.preferred_language || 'en',
      user.preferred_contact_channel || 'whatsapp',
      user.preferred_contact_channel === 'whatsapp',
      user.preferred_contact_channel === 'email',
      user.preferred_contact_channel === 'sms',
      user.marketing_opt_in !== false,
      profile.seeker_type || 'casual_browser',
      profile.primary_goal || null,
      profile.moving_timeline || null,
      profile.primary_goal || profile.preferred_areas ? 40 : 20,
      false
    ]
  );

  const category = categoryFromGoal(profile.primary_goal);
  const preferredLocations = profile.preferred_areas ? [profile.preferred_areas] : [];
  await db.query(
    `INSERT INTO property_seeker_preferences (
      user_id,
      categories,
      preferred_locations,
      max_budget,
      currency,
      timeline,
      alert_channels
    ) VALUES ($1,$2::jsonb,$3::jsonb,$4,'UGX',$5,$6::jsonb)
    ON CONFLICT (user_id) DO UPDATE
    SET categories = EXCLUDED.categories,
        preferred_locations = EXCLUDED.preferred_locations,
        max_budget = EXCLUDED.max_budget,
        timeline = EXCLUDED.timeline,
        alert_channels = EXCLUDED.alert_channels,
        updated_at = NOW()`,
    [
      user.id,
      JSON.stringify(category ? [category] : []),
      JSON.stringify(preferredLocations),
      parseBudgetUpper(profile.budget_range),
      profile.moving_timeline || null,
      JSON.stringify(['in_app', user.preferred_contact_channel || 'whatsapp'])
    ]
  );
}

function parseBudgetUpper(value = '') {
  const text = String(value || '').toUpperCase();
  const matches = text.match(/\d+(?:\.\d+)?\s*[KMB]?/g);
  if (!matches?.length) return null;
  const parsed = matches.map((item) => {
    const compact = item.replace(/\s+/g, '');
    const number = parseFloat(compact);
    if (!Number.isFinite(number)) return null;
    if (compact.endsWith('B')) return Math.round(number * 1000000000);
    if (compact.endsWith('M')) return Math.round(number * 1000000);
    if (compact.endsWith('K')) return Math.round(number * 1000);
    return Math.round(number);
  }).filter((item) => Number.isFinite(item));
  return parsed.length ? Math.max(...parsed) : null;
}

function categoryFromGoal(value = '') {
  const text = String(value || '').toLowerCase();
  if (text.includes('rent')) return 'rent';
  if (text.includes('buy')) return 'sale';
  if (text.includes('land')) return 'land';
  if (text.includes('student')) return 'student';
  if (text.includes('commercial')) return 'commercial';
  return '';
}

module.exports = {
  buildOtpSuccessPayload,
  dashboardForUser,
  ensurePostVerificationRecords,
  normalizeSignupAudience,
  roleForSignup
};
