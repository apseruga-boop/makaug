'use strict';

const ROLE_DASHBOARD_MAP = {
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
  if (['admin'].includes(input)) return 'admin';
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
  if (user.role === 'admin' || audience === 'admin') return '/admin';
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
    message: message || 'Verification complete. Your MakaUg account is ready.'
  };
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
    await db.query(
      `UPDATE users
       SET profile_data = COALESCE(profile_data, '{}'::jsonb) || $2::jsonb,
           updated_at = NOW()
       WHERE id = $1`,
      [user.id, JSON.stringify({ broker_review_status: 'pending_review' })]
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
}

function parseBudgetUpper(value = '') {
  const numbers = String(value || '').match(/\d[\d,\s]*/g);
  if (!numbers?.length) return null;
  const parsed = numbers
    .map((item) => parseInt(item.replace(/[^\d]/g, ''), 10))
    .filter((item) => Number.isFinite(item));
  return parsed.length ? Math.max(...parsed) : null;
}

module.exports = {
  buildOtpSuccessPayload,
  dashboardForUser,
  ensurePostVerificationRecords,
  normalizeSignupAudience,
  roleForSignup
};
