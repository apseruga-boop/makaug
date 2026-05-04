const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const db = require('../config/database');
const logger = require('../config/logger');
const { sendSupportEmail, sendWelcomeEmail } = require('../services/emailService');
const {
  buildOtpSuccessPayload,
  dashboardForUser,
  ensurePostVerificationRecords,
  normalizeSignupAudience,
  roleForSignup
} = require('../services/authFlowService');
const { logNotification, notificationStatusFromDelivery } = require('../services/notificationLogService');
const { isSmsOtpDeliveryConfirmed, sendPhoneOtp } = require('../services/phoneOtpDeliveryService');
const { cleanText, isValidEmail, isValidPhone } = require('../middleware/validation');
const {
  parseBooleanLike,
  normalizeEmail,
  normalizeUgPhone,
  getAdminOtpOverrideCode,
  canUseAdminOtpOverride,
  isAdminOtpOverrideMatch
} = require('../utils/adminOtpOverride');
const {
  ensureAdminSecuritySettings,
  recordAdminLogin,
  recordAdminPasswordChange
} = require('../services/adminSecurityService');

const router = express.Router();

function authCookieOptions(req) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure || req.get('x-forwarded-proto') === 'https' || process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/'
  };
}

function setAuthCookie(req, res, token) {
  if (token) {
    res.cookie('makaug_auth_token', token, authCookieOptions(req));
  }
}

function isValidUgPhone(phone) {
  return /^\+256\d{9}$/.test(phone);
}

function isAdminOtpOverrideEnabled() {
  return parseBooleanLike(process.env.ADMIN_OTP_OVERRIDE_ENABLED, false);
}

function publicUser(row) {
  if (!row) return null;
  const phone = String(row.phone || '');
  return {
    id: row.id,
    first_name: row.first_name,
    last_name: row.last_name,
    phone: phone.startsWith('oauth:') ? '' : row.phone,
    email: row.email,
    role: row.role,
    phone_verified: row.phone_verified,
    status: row.status,
    marketing_opt_in: row.marketing_opt_in !== false,
    weekly_tips_opt_in: row.weekly_tips_opt_in !== false,
    preferred_contact_channel: row.preferred_contact_channel || 'whatsapp',
    preferred_language: row.preferred_language || 'en',
    profile_data: row.profile_data && typeof row.profile_data === 'object' && !Array.isArray(row.profile_data) ? row.profile_data : {},
    oauth_provider: row.oauth_provider || null,
    created_at: row.created_at
  };
}

function sanitizeProfileData(input = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const allowed = [
    'audience',
    'account_kind',
    'seeker_type',
    'onboarding_source',
    'primary_goal',
    'preferred_areas',
    'budget_range',
    'moving_timeline',
    'university',
    'student_campus',
    'student_university',
    'accommodation_type',
    'agent_company',
    'agent_districts',
    'agent_specialities',
    'preferred_updates',
    'field_agent_territory',
    'field_agent_areas',
    'field_agent_languages',
    'field_agent_experience',
    'field_agent_availability',
    'field_agent_reason',
    'field_agent_application_status',
    'broker_review_status',
    'business_name',
    'business_type',
    'campaign_interest'
  ];
  return allowed.reduce((acc, key) => {
    const value = cleanText(source[key]);
    if (value) acc[key] = value.slice(0, 240);
    return acc;
  }, {});
}

function createToken(user) {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not configured');
  }
  const profile = user.profile_data && typeof user.profile_data === 'object' && !Array.isArray(user.profile_data)
    ? user.profile_data
    : {};

  return jwt.sign(
    {
      sub: user.id,
      phone: user.phone,
      role: user.role,
      audience: profile.audience || profile.account_kind || '',
      account_kind: profile.account_kind || profile.audience || ''
    },
    secret,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

async function notifyAdminSignup({ user, eventType }) {
  try {
    await logNotification(db, {
      channel: 'in_app',
      type: eventType,
      status: 'logged',
      payloadSummary: {
        user_id: user?.id,
        role: user?.role,
        profile_data: user?.profile_data || {}
      }
    });
  } catch (_) {}
}

function accountCreatedEventType(user = {}) {
  const profile = user.profile_data && typeof user.profile_data === 'object' ? user.profile_data : {};
  const audience = normalizeSignupAudience(profile.audience || profile.account_kind || profile.seeker_type);
  if (audience === 'student') return 'account_created_student';
  if (audience === 'agent') return 'account_created_broker';
  if (audience === 'field_agent') return 'field_agent_application_received';
  if (audience === 'advertiser') return 'advertiser_signup_received';
  return 'account_created_property_finder';
}

function getBaseUrl(req) {
  const configured = String(process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || '').replace(/\/$/, '');
  if (configured) return configured;
  const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
  return `${proto}://${req.get('host')}`;
}

function getOAuthRedirectUri(req, provider) {
  return `${getBaseUrl(req)}/api/auth/oauth/${provider}/callback`;
}

const SOCIAL_AUTH_TEMPORARILY_DISABLED = true;

function getSocialProviderConfig(req) {
  return {
    google: {
      enabled: !SOCIAL_AUTH_TEMPORARILY_DISABLED && !!(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET),
      redirect_uri: getOAuthRedirectUri(req, 'google')
    },
    facebook: {
      enabled: !SOCIAL_AUTH_TEMPORARILY_DISABLED && !!(process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET),
      redirect_uri: getOAuthRedirectUri(req, 'facebook')
    },
    apple: {
      enabled: false,
      setup_required: 'Apple sign-in requires an Apple Developer Service ID, private key, team ID, and callback configuration.'
    }
  };
}

function oauthErrorRedirect(req, message) {
  const params = new URLSearchParams({ auth_error: message || 'Social sign-in failed' });
  return `${getBaseUrl(req)}/#${params.toString()}`;
}

function oauthSuccessRedirect(req, token, user, provider) {
  const params = new URLSearchParams({
    auth_token: token,
    auth_user: JSON.stringify(publicUser(user)),
    auth_source: provider
  });
  return `${getBaseUrl(req)}/#${params.toString()}`;
}

function createOAuthState(provider, audience) {
  return jwt.sign(
    {
      purpose: 'oauth',
      provider,
      audience: ['agent', 'field_agent', 'admin'].includes(audience) ? audience : 'finder'
    },
    process.env.JWT_SECRET,
    { expiresIn: '10m' }
  );
}

function verifyOAuthState(state, provider) {
  const decoded = jwt.verify(state, process.env.JWT_SECRET);
  if (decoded?.purpose !== 'oauth' || decoded?.provider !== provider) {
    throw new Error('Invalid OAuth state');
  }
  return decoded;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = data?.error_description || data?.error?.message || data?.error || `OAuth request failed (${response.status})`;
    throw new Error(message);
  }
  return data;
}

function splitDisplayName(profile = {}) {
  const fullName = cleanText(profile.name || profile.displayName || '');
  const firstName = cleanText(profile.given_name || profile.first_name || (fullName.split(/\s+/)[0] || 'MakaUg'));
  const lastName = cleanText(profile.family_name || profile.last_name || (fullName.split(/\s+/).slice(1).join(' ') || 'User'));
  return { firstName, lastName };
}

async function findOrCreateOAuthUser({ provider, subject, email, profile, audience }) {
  const normalizedEmail = normalizeEmail(email);
  const role = audience === 'agent' ? 'agent_broker' : 'buyer_renter';

  let result = subject
    ? await db.query(
        `SELECT *
         FROM users
         WHERE oauth_provider = $1 AND oauth_subject = $2 AND status = 'active'
         LIMIT 1`,
        [provider, subject]
      )
    : { rows: [] };

  if (!result.rows.length && normalizedEmail) {
    result = await db.query('SELECT * FROM users WHERE LOWER(email) = $1 AND status = $2 LIMIT 1', [normalizedEmail, 'active']);
  }

  if (result.rows.length) {
    const updated = await db.query(
      `UPDATE users
       SET oauth_provider = COALESCE(oauth_provider, $2),
           oauth_subject = COALESCE(oauth_subject, $3),
           oauth_profile = $4::jsonb,
           last_login_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [result.rows[0].id, provider, subject || null, JSON.stringify(profile || {})]
    );
    return updated.rows[0];
  }

  if (!normalizedEmail) {
    const error = new Error('Your social account did not return an email address. Please sign up with phone/email.');
    error.status = 400;
    throw error;
  }

  const { firstName, lastName } = splitDisplayName(profile);
  const generatedPhone = `oauth:${provider}:${subject || normalizedEmail}`;
  const passwordHash = await bcrypt.hash(`${Date.now()}-${Math.random()}-${provider}`, 10);
  const inserted = await db.query(
    `INSERT INTO users (
      first_name,
      last_name,
      phone,
      email,
      role,
      password_hash,
      phone_verified,
      status,
      marketing_opt_in,
      weekly_tips_opt_in,
      preferred_contact_channel,
      oauth_provider,
      oauth_subject,
      oauth_profile,
      last_login_at
    ) VALUES ($1,$2,$3,$4,$5,$6,true,'active',true,true,'email',$7,$8,$9::jsonb,NOW())
    RETURNING *`,
    [
      firstName,
      lastName,
      generatedPhone,
      normalizedEmail,
      role,
      passwordHash,
      provider,
      subject || null,
      JSON.stringify(profile || {})
    ]
  );
  return inserted.rows[0];
}

function getAuthUserIdFromRequest(req) {
  const authHeader = req.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return { error: 'Missing bearer token' };
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return { userId: decoded.sub };
  } catch (error) {
    return { error: 'Invalid token' };
  }
}

function isEmailOtpDeliveryConfirmed(delivery) {
  return delivery?.sent === true && delivery?.mocked !== true;
}

function isPhoneOtpDeliveryConfirmed(delivery) {
  return isSmsOtpDeliveryConfirmed(delivery);
}

function getOtpCopy(language = 'en', { otp, expiresMinutes, purpose = 'login' } = {}) {
  const lang = ['en', 'lg', 'sw', 'ac', 'ny', 'rn', 'sm'].includes(String(language || '').toLowerCase())
    ? String(language || '').toLowerCase()
    : 'en';
  const catalog = {
    en: {
      signup: `MakaUg account verification: your code is ${otp}. It expires in ${expiresMinutes} minutes. Do not share it with anyone.`,
      login: `MakaUg sign-in verification: your code is ${otp}. It expires in ${expiresMinutes} minutes. Do not share it with anyone.`,
      reset_password: `MakaUg password reset: your code is ${otp}. It expires in ${expiresMinutes} minutes. Do not share it with anyone.`
    },
    lg: {
      signup: `MakaUg okukakasa akawunti: koodi yo ye ${otp}. Egwaako mu ddakiika ${expiresMinutes}. Tokigabana na muntu yenna.`,
      login: `MakaUg okukakasa okuyingira: koodi yo ye ${otp}. Egwaako mu ddakiika ${expiresMinutes}. Tokigabana na muntu yenna.`,
      reset_password: `MakaUg okukyusa password: koodi yo ye ${otp}. Egwaako mu ddakiika ${expiresMinutes}. Tokigabana na muntu yenna.`
    },
    sw: {
      signup: `Uthibitishaji wa akaunti ya MakaUg: msimbo wako ni ${otp}. Unaisha baada ya dakika ${expiresMinutes}. Usiushiriki na mtu yeyote.`,
      login: `Uthibitishaji wa kuingia MakaUg: msimbo wako ni ${otp}. Unaisha baada ya dakika ${expiresMinutes}. Usiushiriki na mtu yeyote.`,
      reset_password: `Kubadilisha nenosiri la MakaUg: msimbo wako ni ${otp}. Unaisha baada ya dakika ${expiresMinutes}. Usiushiriki na mtu yeyote.`
    },
    ac: {
      signup: `MakaUg kubeero me account: code mamegi tye ${otp}. Bi toyo i dakika ${expiresMinutes}. Pe i nywak kwede dano mo.`,
      login: `MakaUg kubeero me donyo: code mamegi tye ${otp}. Bi toyo i dakika ${expiresMinutes}. Pe i nywak kwede dano mo.`,
      reset_password: `MakaUg loko password: code mamegi tye ${otp}. Bi toyo i dakika ${expiresMinutes}. Pe i nywak kwede dano mo.`
    },
    ny: {
      signup: `Okwehamya akawunti ya MakaUg: koodi yawe ni ${otp}. Egiherwaaho omu dakikha ${expiresMinutes}. Otakigambira muntu.`,
      login: `Okwehamya okuyingira MakaUg: koodi yawe ni ${otp}. Egiherwaaho omu dakikha ${expiresMinutes}. Otakigambira muntu.`,
      reset_password: `Okugarura password ya MakaUg: koodi yawe ni ${otp}. Egiherwaaho omu dakikha ${expiresMinutes}. Otakigambira muntu.`
    },
    rn: {
      signup: `Okuhamya account ya MakaUg: code yawe ni ${otp}. Erahwa mu dakikha ${expiresMinutes}. Otagigambira muntu.`,
      login: `Okuhamya okwinjira MakaUg: code yawe ni ${otp}. Erahwa mu dakikha ${expiresMinutes}. Otagigambira muntu.`,
      reset_password: `Okuhindura password ya MakaUg: code yawe ni ${otp}. Erahwa mu dakikha ${expiresMinutes}. Otagigambira muntu.`
    },
    sm: {
      signup: `Okukakasa account ya MakaUg: code yo ye ${otp}. Eggwaako mu ddakiika ${expiresMinutes}. Totigabana na muntu yenna.`,
      login: `Okukakasa okuyingira MakaUg: code yo ye ${otp}. Eggwaako mu ddakiika ${expiresMinutes}. Totigabana na muntu yenna.`,
      reset_password: `Okukyusa password ya MakaUg: code yo ye ${otp}. Eggwaako mu ddakiika ${expiresMinutes}. Totigabana na muntu yenna.`
    }
  };
  return catalog[lang]?.[purpose] || catalog.en[purpose] || catalog.en.login;
}

async function issueOtp({ purpose, channel = 'phone', phone = '', email = '', preferredLanguage = 'en', queryRunner = db }) {
  const resolvedChannel = String(channel || 'phone').toLowerCase() === 'email' ? 'email' : 'phone';
  const identifier = resolvedChannel === 'email' ? normalizeEmail(email) : normalizeUgPhone(phone);
  const overrideAllowed = canUseAdminOtpOverride({ channel: resolvedChannel, identifier });
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresMinutes = Math.max(parseInt(process.env.OTP_EXPIRES_MINUTES || '10', 10), 1);

  if (!identifier) {
    throw new Error('Missing OTP identifier');
  }

  await queryRunner.query(
    `UPDATE otps
     SET used = TRUE
     WHERE phone = $1
       AND purpose = $2
       AND used = FALSE`,
    [identifier, purpose]
  );

  await queryRunner.query(
    `INSERT INTO otps (phone, code, purpose, expires_at)
     VALUES ($1, $2, $3, NOW() + ($4::text || ' minutes')::interval)`,
    [identifier, otp, purpose, String(expiresMinutes)]
  );

  if (resolvedChannel === 'email') {
    let delivery = null;
    try {
      delivery = await sendSupportEmail({
        to: identifier,
        subject: 'MakaUg verification code',
        text: getOtpCopy(preferredLanguage, { otp, expiresMinutes, purpose })
      });
    } catch (error) {
      logger.error('Failed to send OTP email', error.message);
      if (overrideAllowed) {
        logger.warn('OTP email send failed, using ADMIN_OTP_OVERRIDE_CODE fallback');
        return { otp, channel: resolvedChannel, identifier, expiresMinutes };
      }
      const sendError = new Error('Failed to send OTP email');
      sendError.status = 400;
      throw sendError;
    }
    if (process.env.NODE_ENV === 'production' && !isEmailOtpDeliveryConfirmed(delivery)) {
      logger.warn('Email OTP delivery unavailable', { channel: resolvedChannel, delivery });
      if (overrideAllowed) {
        logger.warn('Email OTP delivery unavailable, using ADMIN_OTP_OVERRIDE_CODE fallback');
        return { otp, channel: resolvedChannel, identifier, expiresMinutes };
      }
      const reason = String(delivery?.error || delivery?.reason || '').toLowerCase();
      const configError = new Error(
        (reason.includes('smtpclientauthentication') || reason.includes('5.7.139'))
          ? 'Email OTP is blocked by Microsoft 365 tenant policy. Enable Authenticated SMTP or configure Microsoft Graph mail delivery.'
          : 'Email OTP delivery provider is not configured'
      );
      configError.status = 400;
      throw configError;
    }
    await logNotification(db, {
      recipientEmail: identifier,
      channel: 'email',
      type: 'otp_sent',
      status: notificationStatusFromDelivery(delivery),
      payloadSummary: { purpose, expires_minutes: expiresMinutes },
      sentAt: delivery?.sent ? new Date() : null,
      failureReason: delivery?.error || delivery?.reason || null
    });
  } else {
    const deliveryResult = await sendPhoneOtp({
      to: identifier,
      message: getOtpCopy(preferredLanguage, { otp, expiresMinutes, purpose }),
      purpose,
      source: 'auth_otp'
    });
    const delivery = deliveryResult.delivery || null;
    if (!deliveryResult.ok) {
      logger.error('Failed to send OTP to phone', {
        purpose,
        attempts: deliveryResult.attempts
      });
      await logNotification(db, {
        recipientPhone: identifier,
        channel: 'sms',
        type: 'otp_sent',
        status: 'failed',
        payloadSummary: {
          purpose,
          expires_minutes: expiresMinutes,
          attempts: deliveryResult.attempts
        },
        failureReason: deliveryResult.failureReason || 'phone_otp_delivery_failed'
      });
      if (overrideAllowed) {
        logger.warn('OTP phone delivery failed, using ADMIN_OTP_OVERRIDE_CODE fallback');
        return { otp, channel: resolvedChannel, identifier, expiresMinutes };
      }
      const sendError = new Error('Failed to send OTP to phone or WhatsApp');
      sendError.status = 400;
      throw sendError;
    }
    await logNotification(db, {
      recipientPhone: identifier,
      channel: deliveryResult.channel === 'whatsapp' ? 'whatsapp' : 'sms',
      type: 'otp_sent',
      status: notificationStatusFromDelivery(delivery),
      payloadSummary: {
        purpose,
        expires_minutes: expiresMinutes,
        delivery_channel: deliveryResult.channel,
        provider: delivery?.provider || null,
        attempts: deliveryResult.attempts
      },
      sentAt: delivery?.success || delivery?.sent ? new Date() : null,
      failureReason: delivery?.error || delivery?.reason || null
    });
  }

  return {
    otp,
    channel: resolvedChannel,
    identifier,
    expiresMinutes
  };
}

router.get('/social/config', (req, res) => {
  return res.json({
    ok: true,
    data: {
      providers: getSocialProviderConfig(req)
    }
  });
});

router.get('/oauth/:provider/start', (req, res) => {
  try {
    const provider = cleanText(req.params.provider).toLowerCase();
    const audience = cleanText(req.query.audience).toLowerCase();
    const providers = getSocialProviderConfig(req);
    if (!['google', 'facebook'].includes(provider)) {
      return res.status(400).json({ ok: false, error: 'Unsupported social provider' });
    }
    if (SOCIAL_AUTH_TEMPORARILY_DISABLED) {
      return res.status(410).json({
        ok: false,
        error: 'Social sign-in is temporarily disabled. Please use phone/email and password.'
      });
    }
    if (!providers[provider]?.enabled) {
      return res.status(503).json({
        ok: false,
        error: `${provider} sign-in is not configured`,
        details: [`Add ${provider === 'google' ? 'GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET' : 'FACEBOOK_APP_ID and FACEBOOK_APP_SECRET'} in Render environment variables.`]
      });
    }

    const redirectUri = getOAuthRedirectUri(req, provider);
    const state = createOAuthState(provider, audience);
    if (provider === 'google') {
      const params = new URLSearchParams({
        client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid email profile',
        state,
        prompt: 'select_account'
      });
      return res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
    }

    const params = new URLSearchParams({
      client_id: process.env.FACEBOOK_APP_ID,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'email,public_profile',
      state
    });
    return res.redirect(`https://www.facebook.com/v19.0/dialog/oauth?${params.toString()}`);
  } catch (error) {
    logger.error('OAuth start failed', error.message);
    return res.redirect(oauthErrorRedirect(req, 'Social sign-in could not start'));
  }
});

router.get('/oauth/:provider/callback', async (req, res) => {
  const provider = cleanText(req.params.provider).toLowerCase();
  try {
    if (!['google', 'facebook'].includes(provider)) {
      return res.redirect(oauthErrorRedirect(req, 'Unsupported social provider'));
    }
    const code = cleanText(req.query.code);
    const state = cleanText(req.query.state);
    if (!code || !state) {
      return res.redirect(oauthErrorRedirect(req, 'Social sign-in did not return a valid code'));
    }

    const decodedState = verifyOAuthState(state, provider);
    const redirectUri = getOAuthRedirectUri(req, provider);
    let profile = null;
    let subject = '';
    let email = '';

    if (provider === 'google') {
      const token = await fetchJson('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
          client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code'
        })
      });
      profile = await fetchJson('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { Authorization: `Bearer ${token.access_token}` }
      });
      subject = cleanText(profile.sub);
      email = normalizeEmail(profile.email);
    } else {
      const tokenParams = new URLSearchParams({
        client_id: process.env.FACEBOOK_APP_ID,
        client_secret: process.env.FACEBOOK_APP_SECRET,
        redirect_uri: redirectUri,
        code
      });
      const token = await fetchJson(`https://graph.facebook.com/v19.0/oauth/access_token?${tokenParams.toString()}`);
      profile = await fetchJson(`https://graph.facebook.com/v19.0/me?fields=id,first_name,last_name,name,email&access_token=${encodeURIComponent(token.access_token)}`);
      subject = cleanText(profile.id);
      email = normalizeEmail(profile.email);
    }

    const user = await findOrCreateOAuthUser({
      provider,
      subject,
      email,
      profile,
      audience: decodedState.audience
    });
    const jwtToken = createToken(user);
    return res.redirect(oauthSuccessRedirect(req, jwtToken, user, provider));
  } catch (error) {
    logger.error(`${provider} OAuth callback failed`, error.message);
    return res.redirect(oauthErrorRedirect(req, error.message || 'Social sign-in failed'));
  }
});

router.post('/register', async (req, res, next) => {
  let client = null;
  try {
    client = await db.getClient();
    const firstName = cleanText(req.body.first_name);
    const lastName = cleanText(req.body.last_name) || '';
    const phone = normalizeUgPhone(req.body.phone);
    const email = normalizeEmail(req.body.email) || null;
    const roleInput = cleanText(req.body.role).toLowerCase();
    const password = cleanText(req.body.password);
    const confirmPassword = cleanText(req.body.confirm_password);
    const otpChannelInput = cleanText(req.body.otp_channel).toLowerCase();
    const otpChannel = otpChannelInput === 'email' ? 'email' : 'phone';
    const marketingOptIn = parseBooleanLike(req.body.marketing_opt_in, true);
    const weeklyTipsOptIn = parseBooleanLike(req.body.weekly_tips_opt_in, true);
    const preferredContactInput = cleanText(req.body.preferred_contact_channel).toLowerCase();
    const preferredContactChannel = ['whatsapp', 'phone', 'email'].includes(preferredContactInput) ? preferredContactInput : 'whatsapp';
    const preferredLanguageInput = cleanText(req.body.preferred_language).toLowerCase();
    const preferredLanguage = ['en', 'lg', 'sw', 'ac', 'ny', 'rn', 'sm'].includes(preferredLanguageInput) ? preferredLanguageInput : 'en';
    const audience = normalizeSignupAudience(req.body.audience || req.body.profile_data?.audience || roleInput);
    const profileData = sanitizeProfileData({
      ...(req.body.profile_data && typeof req.body.profile_data === 'object' ? req.body.profile_data : {}),
      audience,
      account_kind: req.body.profile_data?.account_kind || audience,
      field_agent_application_status: audience === 'field_agent' ? 'pending_review' : req.body.profile_data?.field_agent_application_status,
      broker_review_status: audience === 'agent' ? 'pending_review' : req.body.profile_data?.broker_review_status
    });

    const role = roleForSignup({ roleInput, audience });

    const errors = [];
    if (!firstName) errors.push('first_name is required');
    if (!email) errors.push('email is required');
    if (!phone) errors.push('phone is required');
    if (!password || password.length < 8) errors.push('password must be at least 8 characters');
    if (confirmPassword && confirmPassword !== password) errors.push('confirm_password must match password');
    if (req.body.terms_accepted === false || req.body.terms_accepted === 'false') errors.push('terms_accepted is required');
    if (req.body.privacy_accepted === false || req.body.privacy_accepted === 'false') errors.push('privacy_accepted is required');
    if (phone && !isValidPhone(phone)) errors.push('phone is invalid');
    if (phone && !isValidUgPhone(phone)) errors.push('phone must be a valid Uganda number');
    if (email && !isValidEmail(email)) errors.push('email is invalid');
    if (otpChannel === 'email' && !email) errors.push('email is required when otp_channel is email');
    if (audience === 'agent' && !email) errors.push('email is required for broker signup');
    if (audience === 'field_agent' && !profileData.field_agent_territory && !profileData.field_agent_areas) {
      errors.push('field agent territory or areas are required');
    }

    if (errors.length) {
      return res.status(400).json({ ok: false, error: 'Validation failed', details: errors });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    await client.query('BEGIN');

    const existingResult = await client.query(
      `SELECT *
       FROM users
       WHERE phone = $1
          OR ($2::text IS NOT NULL AND LOWER(email) = LOWER($2))
       ORDER BY created_at ASC
       FOR UPDATE`,
      [phone, email]
    );

    const verifiedConflict = existingResult.rows.find((row) => row.phone_verified || row.status !== 'active');
    if (verifiedConflict) {
      await client.query('ROLLBACK');
      return res.status(409).json({ ok: false, error: 'Account with this phone or email already exists' });
    }

    if (existingResult.rows.length > 1) {
      await client.query('ROLLBACK');
      return res.status(409).json({ ok: false, error: 'This phone/email is already tied to another unverified signup. Please use sign in or contact support.' });
    }

    let user = null;
    if (existingResult.rows.length === 1) {
      const updated = await client.query(
        `UPDATE users
         SET first_name = $2,
             last_name = $3,
             phone = $4,
             email = $5,
             role = $6,
             password_hash = $7,
             marketing_opt_in = $8,
             weekly_tips_opt_in = $9,
             preferred_contact_channel = $10,
             preferred_language = $11,
             profile_data = COALESCE(profile_data, '{}'::jsonb) || $12::jsonb,
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [
          existingResult.rows[0].id,
          firstName,
          lastName,
          phone,
          email,
          role,
          passwordHash,
          marketingOptIn,
          weeklyTipsOptIn,
          preferredContactChannel,
          preferredLanguage,
          JSON.stringify(profileData)
        ]
      );
      user = updated.rows[0];
    } else {
      const result = await client.query(
        `INSERT INTO users (
          first_name,
          last_name,
          phone,
          email,
          role,
          password_hash,
          phone_verified,
          status,
          marketing_opt_in,
          weekly_tips_opt_in,
          preferred_contact_channel,
          preferred_language,
          profile_data
        ) VALUES ($1,$2,$3,$4,$5,$6,false,'active',$7,$8,$9,$10,$11::jsonb)
        RETURNING *`,
        [firstName, lastName, phone, email, role, passwordHash, marketingOptIn, weeklyTipsOptIn, preferredContactChannel, preferredLanguage, JSON.stringify(profileData)]
      );
      user = result.rows[0];
    }

    const otpIssue = await issueOtp({
      purpose: 'signup',
      channel: otpChannel === 'email' && email ? 'email' : 'phone',
      phone,
      email,
      preferredLanguage,
      queryRunner: client
    });

    await client.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);
    await client.query('COMMIT');

    if (audience === 'field_agent') {
      await notifyAdminSignup({ user, eventType: 'new_field_agent_application' });
    } else if (audience === 'agent') {
      await notifyAdminSignup({ user, eventType: 'new_broker_verification_request' });
    } else if (audience === 'advertiser') {
      await notifyAdminSignup({ user, eventType: 'new_advertiser_signup' });
    }

    return res.status(201).json({
      ok: true,
      data: {
        user: publicUser(user),
        requires_otp: true,
        message: otpChannel === 'email' ? 'Verification OTP sent to email' : 'Verification OTP sent to phone',
        ...(process.env.NODE_ENV === 'production' ? {} : { dev_otp: otpIssue.otp })
      }
    });
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (_) {}
    }
    if (error.code === '23505') {
      return res.status(409).json({ ok: false, error: 'Account with this phone or email already exists' });
    }
    return next(error);
  } finally {
    if (client) client.release();
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const phone = normalizeUgPhone(req.body.phone);
    const email = normalizeEmail(req.body.email);
    const password = cleanText(req.body.password);

    if ((!phone && !email) || !password) {
      return res.status(400).json({ ok: false, error: 'phone/email and password are required' });
    }

    if (email && !isValidEmail(email)) {
      return res.status(400).json({ ok: false, error: 'email is invalid' });
    }

    const result = phone
      ? await db.query('SELECT * FROM users WHERE phone = $1 AND status = $2 LIMIT 1', [phone, 'active'])
      : await db.query('SELECT * FROM users WHERE LOWER(email) = $1 AND status = $2 LIMIT 1', [email, 'active']);

    if (!result.rows.length) {
      return res.status(401).json({ ok: false, error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ ok: false, error: 'Invalid credentials' });
    }

    if (!user.phone_verified) {
      return res.status(403).json({ ok: false, error: 'Phone not verified. Use OTP sign in to verify this account.' });
    }

    const token = createToken(user);
    await db.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);
    const adminSecurity = await ensureAdminSecuritySettings(db, user);
    await recordAdminLogin(db, user, req);
    setAuthCookie(req, res, token);

    return res.json({
      ok: true,
      data: {
        token,
        user: publicUser(user),
        admin_security: adminSecurity ? {
          mfa_enabled: adminSecurity.mfa_enabled === true,
          force_password_change: adminSecurity.force_password_change === true
        } : undefined
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/logout', (req, res) => {
  res.clearCookie('makaug_auth_token', { ...authCookieOptions(req), maxAge: undefined });
  return res.json({ ok: true, data: { logged_out: true } });
});

router.post('/request-otp', async (req, res, next) => {
  try {
    const channelInput = cleanText(req.body.channel).toLowerCase();
    const channel = channelInput === 'email' ? 'email' : 'phone';
    const phone = normalizeUgPhone(req.body.phone);
    const email = normalizeEmail(req.body.email);
    const purposeRaw = cleanText(req.body.purpose).toLowerCase();
    const purpose = ['signup', 'login', 'reset_password'].includes(purposeRaw) ? purposeRaw : 'login';
    let exists = null;
    let preferredLanguage = cleanText(req.body.preferred_language).toLowerCase();

    if (channel === 'email') {
      if (!email || !isValidEmail(email)) {
        return res.status(400).json({ ok: false, error: 'Valid email is required' });
      }
      exists = await db.query('SELECT id, preferred_language FROM users WHERE LOWER(email) = $1 AND status = $2 LIMIT 1', [email, 'active']);
      if (!exists.rows.length) {
        return res.status(404).json({ ok: false, error: 'No account found with that email' });
      }
    } else {
      if (!phone || !isValidPhone(phone) || !isValidUgPhone(phone)) {
        return res.status(400).json({ ok: false, error: 'Valid phone is required' });
      }
      exists = await db.query('SELECT id, preferred_language FROM users WHERE phone = $1 AND status = $2 LIMIT 1', [phone, 'active']);
      if (!exists.rows.length) {
        return res.status(404).json({ ok: false, error: 'No account found with that phone' });
      }
    }

    preferredLanguage = ['en', 'lg', 'sw', 'ac', 'ny', 'rn', 'sm'].includes(preferredLanguage)
      ? preferredLanguage
      : (exists.rows[0]?.preferred_language || 'en');

    const otpIssue = await issueOtp({
      purpose,
      channel,
      phone,
      email,
      preferredLanguage
    });

    return res.json({
      ok: true,
      data: {
        message: channel === 'email' ? 'OTP sent to email' : 'OTP sent',
        channel,
        ...(process.env.NODE_ENV === 'production' ? {} : { dev_otp: otpIssue.otp })
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/request-password-reset', async (req, res, next) => {
  try {
    const channelInput = cleanText(req.body.channel).toLowerCase();
    const channel = channelInput === 'email' ? 'email' : 'phone';
    const phone = normalizeUgPhone(req.body.phone);
    const email = normalizeEmail(req.body.email);

    if (channel === 'email' && (!email || !isValidEmail(email))) {
      return res.status(400).json({ ok: false, error: 'Valid email is required' });
    }
    if (channel === 'phone' && (!phone || !isValidPhone(phone) || !isValidUgPhone(phone))) {
      return res.status(400).json({ ok: false, error: 'Valid phone is required' });
    }

    const exists = channel === 'email'
      ? await db.query('SELECT id, preferred_language FROM users WHERE LOWER(email) = $1 AND status = $2 LIMIT 1', [email, 'active'])
      : await db.query('SELECT id, preferred_language FROM users WHERE phone = $1 AND status = $2 LIMIT 1', [phone, 'active']);
    if (!exists.rows.length) {
      return res.status(404).json({ ok: false, error: channel === 'email' ? 'No account found with that email' : 'No account found with that phone' });
    }

    const preferredLanguageInput = cleanText(req.body.preferred_language).toLowerCase();
    const preferredLanguage = ['en', 'lg', 'sw', 'ac', 'ny', 'rn', 'sm'].includes(preferredLanguageInput)
      ? preferredLanguageInput
      : (exists.rows[0]?.preferred_language || 'en');

    const otpIssue = await issueOtp({
      purpose: 'reset_password',
      channel,
      phone,
      email,
      preferredLanguage
    });

    return res.json({
      ok: true,
      data: {
        message: channel === 'email' ? 'Password reset OTP sent to email' : 'Password reset OTP sent',
        channel,
        ...(process.env.NODE_ENV === 'production' ? {} : { dev_otp: otpIssue.otp })
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/reset-password', async (req, res, next) => {
  try {
    const channelInput = cleanText(req.body.channel).toLowerCase();
    const channel = channelInput === 'email' ? 'email' : 'phone';
    const phone = normalizeUgPhone(req.body.phone);
    const email = normalizeEmail(req.body.email);
    const code = cleanText(req.body.code);
    const newPassword = cleanText(req.body.new_password);
    const identifier = channel === 'email' ? email : phone;

    if (!identifier || !code || !newPassword) {
      return res.status(400).json({ ok: false, error: `${channel}, code and new_password are required` });
    }
    if (channel === 'email' && !isValidEmail(identifier)) {
      return res.status(400).json({ ok: false, error: 'email is invalid' });
    }
    if (channel === 'phone' && (!isValidPhone(identifier) || !isValidUgPhone(identifier))) {
      return res.status(400).json({ ok: false, error: 'phone is invalid' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ ok: false, error: 'new_password must be at least 8 characters' });
    }

    const usedOverride = isAdminOtpOverrideMatch({
      code,
      channel,
      identifier
    });

    let matchedOtp = null;
    if (!usedOverride) {
      const otp = await db.query(
        `SELECT *
         FROM otps
         WHERE phone = $1
           AND code = $2
           AND purpose = 'reset_password'
           AND used = FALSE
           AND expires_at > NOW()
         ORDER BY created_at DESC
         LIMIT 1`,
        [identifier, code]
      );

      if (!otp.rows.length) {
        return res.status(400).json({ ok: false, error: 'Invalid or expired OTP code' });
      }
      matchedOtp = otp.rows[0];
    } else {
      logger.warn('Password reset OTP verified via ADMIN_OTP_OVERRIDE_CODE fallback', { channel, identifier });
    }

    const userResult = channel === 'email'
      ? await db.query('SELECT * FROM users WHERE LOWER(email) = $1 AND status = $2 LIMIT 1', [identifier, 'active'])
      : await db.query('SELECT * FROM users WHERE phone = $1 AND status = $2 LIMIT 1', [identifier, 'active']);
    if (!userResult.rows.length) {
      return res.status(404).json({ ok: false, error: 'Account not found' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);

    if (matchedOtp?.id) {
      await db.query('UPDATE otps SET used = TRUE WHERE id = $1', [matchedOtp.id]);
    }
    if (channel === 'email') {
      await db.query('UPDATE users SET password_hash = $2, phone_verified = TRUE WHERE LOWER(email) = $1', [identifier, newHash]);
    } else {
      await db.query('UPDATE users SET password_hash = $2, phone_verified = TRUE WHERE phone = $1', [identifier, newHash]);
    }

    return res.json({ ok: true, data: { reset: true } });
  } catch (error) {
    return next(error);
  }
});

router.post('/verify-otp', async (req, res, next) => {
  try {
    const channelInput = cleanText(req.body.channel).toLowerCase();
    const channel = channelInput === 'email' ? 'email' : 'phone';
    const phone = normalizeUgPhone(req.body.phone);
    const email = normalizeEmail(req.body.email);
    const code = cleanText(req.body.code);
    const purposeRaw = cleanText(req.body.purpose).toLowerCase();
    const purpose = purposeRaw === 'signup' ? 'signup' : 'login';
    const identifier = channel === 'email' ? email : phone;

    if (!identifier || !code) {
      return res.status(400).json({ ok: false, error: `${channel} and code are required` });
    }
    if (channel === 'email' && !isValidEmail(identifier)) {
      return res.status(400).json({ ok: false, error: 'email is invalid' });
    }
    if (channel === 'phone' && (!isValidPhone(identifier) || !isValidUgPhone(identifier))) {
      return res.status(400).json({ ok: false, error: 'phone is invalid' });
    }

    const usedOverride = isAdminOtpOverrideMatch({
      code,
      channel,
      identifier
    });

    if (!usedOverride) {
      const otp = await db.query(
        `SELECT *
         FROM otps
         WHERE phone = $1
           AND code = $2
           AND purpose = $3
           AND used = FALSE
           AND expires_at > NOW()
         ORDER BY created_at DESC
         LIMIT 1`,
        [identifier, code, purpose]
      );

      if (!otp.rows.length) {
        return res.status(400).json({ ok: false, error: 'Invalid or expired OTP code' });
      }

      await db.query('UPDATE otps SET used = TRUE WHERE id = $1', [otp.rows[0].id]);
    } else {
      logger.warn('Auth OTP verified via ADMIN_OTP_OVERRIDE_CODE fallback', {
        channel,
        purpose,
        identifier
      });
    }
    if (channel === 'phone') {
      await db.query('UPDATE users SET phone_verified = TRUE WHERE phone = $1', [identifier]);
    } else {
      await db.query('UPDATE users SET phone_verified = TRUE WHERE LOWER(email) = $1', [identifier]);
    }

    const userResult = channel === 'phone'
      ? await db.query('SELECT * FROM users WHERE phone = $1 AND status = $2 LIMIT 1', [identifier, 'active'])
      : await db.query('SELECT * FROM users WHERE LOWER(email) = $1 AND status = $2 LIMIT 1', [identifier, 'active']);
    if (!userResult.rows.length) {
      return res.status(404).json({ ok: false, error: 'Account not found' });
    }

    let user = userResult.rows[0];
    try {
      await ensurePostVerificationRecords(db, user);
      const refreshed = await db.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [user.id]);
      if (refreshed.rows.length) user = refreshed.rows[0];
    } catch (profileError) {
      logger.warn('Post-verification profile setup failed', { userId: user.id, error: profileError.message });
    }

    const token = createToken(user);
    await db.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);
    const adminSecurity = await ensureAdminSecuritySettings(db, user);
    await recordAdminLogin(db, user, req);
    setAuthCookie(req, res, token);

    if (purpose === 'signup' && user.email) {
      try {
        const welcomeDelivery = await sendWelcomeEmail({ to: user.email, user });
        await logNotification(db, {
          userId: user.id,
          recipientEmail: user.email,
          channel: 'email',
          type: accountCreatedEventType(user),
          status: notificationStatusFromDelivery(welcomeDelivery),
          payloadSummary: { redirect_url: dashboardForUser(user), purpose },
          sentAt: welcomeDelivery?.sent ? new Date() : null,
          failureReason: welcomeDelivery?.error || welcomeDelivery?.reason || null
        });
      } catch (emailError) {
        logger.warn('Welcome email delivery failed after signup verification', {
          userId: user.id,
          email: user.email,
          error: emailError.message
        });
        await logNotification(db, {
          userId: user.id,
          recipientEmail: user.email,
          channel: 'email',
          type: accountCreatedEventType(user),
          status: 'failed',
          payloadSummary: { redirect_url: dashboardForUser(user), purpose },
          failureReason: emailError.message
        });
      }
    }

    const publicPayload = publicUser(user);
    await logNotification(db, {
      userId: user.id,
      recipientPhone: channel === 'phone' ? identifier : user.phone,
      recipientEmail: channel === 'email' ? identifier : user.email,
      channel: 'in_app',
      type: 'otp_verified',
      status: 'logged',
      payloadSummary: { purpose, redirect_url: dashboardForUser(user), contact_channel: channel }
    });

    const successPayload = buildOtpSuccessPayload({
      token,
      user: publicPayload,
      preferredAudience: publicPayload.profile_data?.audience || '',
      message: 'Verification complete. Opening your MakaUg dashboard.'
    });
    if (adminSecurity) {
      successPayload.admin_security = {
        mfa_enabled: adminSecurity.mfa_enabled === true,
        force_password_change: adminSecurity.force_password_change === true
      };
    }

    return res.json({ ok: true, data: successPayload });
  } catch (error) {
    return next(error);
  }
});

router.get('/me', async (req, res, next) => {
  try {
    const auth = getAuthUserIdFromRequest(req);
    if (auth.error) {
      return res.status(401).json({ ok: false, error: auth.error });
    }

    const result = await db.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [auth.userId]);
    if (!result.rows.length) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }

    return res.json({ ok: true, data: { user: publicUser(result.rows[0]) } });
  } catch (error) {
    return next(error);
  }
});

router.patch('/me', async (req, res, next) => {
  try {
    const auth = getAuthUserIdFromRequest(req);
    if (auth.error) {
      return res.status(401).json({ ok: false, error: auth.error });
    }

    const current = await db.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [auth.userId]);
    if (!current.rows.length) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }

    const user = current.rows[0];
    const firstName = cleanText(req.body.first_name) || user.first_name;
    const lastName = cleanText(req.body.last_name) || user.last_name;
    const emailInput = req.body.email !== undefined ? cleanText(req.body.email).toLowerCase() : user.email;
    const marketingOptIn = req.body.marketing_opt_in === undefined ? user.marketing_opt_in : parseBooleanLike(req.body.marketing_opt_in, true);
    const weeklyTipsOptIn = req.body.weekly_tips_opt_in === undefined ? user.weekly_tips_opt_in : parseBooleanLike(req.body.weekly_tips_opt_in, true);
    const preferredContactInput = cleanText(req.body.preferred_contact_channel).toLowerCase();
    const preferredContactChannel = ['whatsapp', 'phone', 'email'].includes(preferredContactInput)
      ? preferredContactInput
      : (user.preferred_contact_channel || 'whatsapp');
    const preferredLanguageInput = cleanText(req.body.preferred_language).toLowerCase();
    const preferredLanguage = ['en', 'lg', 'sw', 'ac', 'ny', 'rn', 'sm'].includes(preferredLanguageInput)
      ? preferredLanguageInput
      : (user.preferred_language || 'en');

    if (emailInput && !isValidEmail(emailInput)) {
      return res.status(400).json({ ok: false, error: 'email is invalid' });
    }

    const updated = await db.query(
      `UPDATE users
       SET first_name = $2,
           last_name = $3,
           email = $4,
           marketing_opt_in = $5,
           weekly_tips_opt_in = $6,
           preferred_contact_channel = $7,
           preferred_language = $8
       WHERE id = $1
       RETURNING *`,
      [auth.userId, firstName, lastName, emailInput || null, marketingOptIn, weeklyTipsOptIn, preferredContactChannel, preferredLanguage]
    );

    return res.json({ ok: true, data: { user: publicUser(updated.rows[0]) } });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ ok: false, error: 'Email already in use' });
    }
    return next(error);
  }
});

router.post('/change-password', async (req, res, next) => {
  try {
    const auth = getAuthUserIdFromRequest(req);
    if (auth.error) {
      return res.status(401).json({ ok: false, error: auth.error });
    }

    const oldPassword = cleanText(req.body.old_password);
    const newPassword = cleanText(req.body.new_password);

    if (!oldPassword || !newPassword) {
      return res.status(400).json({ ok: false, error: 'old_password and new_password are required' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ ok: false, error: 'new_password must be at least 8 characters' });
    }

    const result = await db.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [auth.userId]);
    if (!result.rows.length) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }

    const user = result.rows[0];
    const ok = await bcrypt.compare(oldPassword, user.password_hash);
    if (!ok) {
      return res.status(400).json({ ok: false, error: 'Current password is incorrect' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [auth.userId, newHash]);
    await recordAdminPasswordChange(db, user, req);

    return res.json({ ok: true, data: { changed: true } });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
