const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const db = require('../config/database');
const smsService = require('../models/smsService');
const logger = require('../config/logger');
const { sendSupportEmail } = require('../services/emailService');
const { cleanText, isValidEmail, isValidPhone } = require('../middleware/validation');
const {
  parseBooleanLike,
  normalizeEmail,
  normalizeUgPhone,
  getAdminOtpOverrideCode,
  canUseAdminOtpOverride,
  isAdminOtpOverrideMatch
} = require('../utils/adminOtpOverride');

const router = express.Router();

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
    oauth_provider: row.oauth_provider || null,
    created_at: row.created_at
  };
}

function createToken(user) {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not configured');
  }

  return jwt.sign(
    {
      sub: user.id,
      phone: user.phone,
      role: user.role
    },
    secret,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
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

async function issueOtp({ purpose, channel = 'phone', phone = '', email = '' }) {
  const resolvedChannel = String(channel || 'phone').toLowerCase() === 'email' ? 'email' : 'phone';
  const identifier = resolvedChannel === 'email' ? normalizeEmail(email) : normalizeUgPhone(phone);
  const overrideAllowed = canUseAdminOtpOverride({ channel: resolvedChannel, identifier });
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresMinutes = Math.max(parseInt(process.env.OTP_EXPIRES_MINUTES || '10', 10), 1);

  if (!identifier) {
    throw new Error('Missing OTP identifier');
  }

  await db.query(
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
        text: `Your MakaUg verification code is ${otp}. It expires in ${expiresMinutes} minutes.`
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
    if (process.env.NODE_ENV === 'production' && (!delivery?.sent || delivery?.mocked)) {
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
  } else {
    let delivery = null;
    try {
      delivery = await smsService.sendSMS(identifier, `MakaUg verification code: ${otp}. Expires in ${expiresMinutes} minutes.`);
    } catch (error) {
      logger.error('Failed to send OTP SMS', error.message);
      if (overrideAllowed) {
        logger.warn('OTP SMS send failed, using ADMIN_OTP_OVERRIDE_CODE fallback');
        return { otp, channel: resolvedChannel, identifier, expiresMinutes };
      }
      const sendError = new Error('Failed to send OTP SMS');
      sendError.status = 400;
      throw sendError;
    }
    if (process.env.NODE_ENV === 'production' && (delivery?.mocked || !delivery?.sid)) {
      if (overrideAllowed) {
        logger.warn('OTP SMS delivery unavailable, using ADMIN_OTP_OVERRIDE_CODE fallback');
        return { otp, channel: resolvedChannel, identifier, expiresMinutes };
      }
      const configError = new Error('Phone OTP delivery provider is not configured');
      configError.status = 400;
      throw configError;
    }
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
  try {
    const firstName = cleanText(req.body.first_name);
    const lastName = cleanText(req.body.last_name);
    const phone = normalizeUgPhone(req.body.phone);
    const email = normalizeEmail(req.body.email) || null;
    const roleInput = cleanText(req.body.role).toLowerCase();
    const password = cleanText(req.body.password);
    const otpChannelInput = cleanText(req.body.otp_channel).toLowerCase();
    const otpChannel = otpChannelInput === 'email' ? 'email' : 'phone';
    const marketingOptIn = parseBooleanLike(req.body.marketing_opt_in, true);
    const weeklyTipsOptIn = parseBooleanLike(req.body.weekly_tips_opt_in, true);
    const preferredContactInput = cleanText(req.body.preferred_contact_channel).toLowerCase();
    const preferredContactChannel = ['whatsapp', 'phone', 'email'].includes(preferredContactInput) ? preferredContactInput : 'whatsapp';
    const preferredLanguageInput = cleanText(req.body.preferred_language).toLowerCase();
    const preferredLanguage = ['en', 'lg', 'sw', 'ac', 'ny', 'rn', 'sm'].includes(preferredLanguageInput) ? preferredLanguageInput : 'en';

    const roleMap = {
      'buyer / renter': 'buyer_renter',
      buyer: 'buyer_renter',
      renter: 'buyer_renter',
      buyer_renter: 'buyer_renter',
      'property owner': 'property_owner',
      owner: 'property_owner',
      property_owner: 'property_owner',
      'agent / broker': 'agent_broker',
      agent: 'agent_broker',
      broker: 'agent_broker',
      agent_broker: 'agent_broker',
      'field agent': 'field_agent',
      field_agent: 'field_agent'
    };

    const role = roleMap[roleInput] || 'buyer_renter';

    const errors = [];
    if (!firstName) errors.push('first_name is required');
    if (!lastName) errors.push('last_name is required');
    if (!phone) errors.push('phone is required');
    if (!password || password.length < 8) errors.push('password must be at least 8 characters');
    if (phone && !isValidPhone(phone)) errors.push('phone is invalid');
    if (phone && !isValidUgPhone(phone)) errors.push('phone must be a valid Uganda number');
    if (email && !isValidEmail(email)) errors.push('email is invalid');
    if (otpChannel === 'email' && !email) errors.push('email is required when otp_channel is email');

    if (errors.length) {
      return res.status(400).json({ ok: false, error: 'Validation failed', details: errors });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const result = await db.query(
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
        preferred_language
      ) VALUES ($1,$2,$3,$4,$5,$6,false,'active',$7,$8,$9,$10)
      RETURNING *`,
      [firstName, lastName, phone, email, role, passwordHash, marketingOptIn, weeklyTipsOptIn, preferredContactChannel, preferredLanguage]
    );

    const user = result.rows[0];
    const otpIssue = await issueOtp({
      purpose: 'signup',
      channel: otpChannel === 'email' && email ? 'email' : 'phone',
      phone,
      email
    });

    await db.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

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
    if (error.code === '23505') {
      return res.status(409).json({ ok: false, error: 'Account with this phone or email already exists' });
    }
    return next(error);
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

    return res.json({ ok: true, data: { token, user: publicUser(user) } });
  } catch (error) {
    return next(error);
  }
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

    if (channel === 'email') {
      if (!email || !isValidEmail(email)) {
        return res.status(400).json({ ok: false, error: 'Valid email is required' });
      }
      exists = await db.query('SELECT id FROM users WHERE LOWER(email) = $1 AND status = $2 LIMIT 1', [email, 'active']);
      if (!exists.rows.length) {
        return res.status(404).json({ ok: false, error: 'No account found with that email' });
      }
    } else {
      if (!phone || !isValidPhone(phone) || !isValidUgPhone(phone)) {
        return res.status(400).json({ ok: false, error: 'Valid phone is required' });
      }
      exists = await db.query('SELECT id FROM users WHERE phone = $1 AND status = $2 LIMIT 1', [phone, 'active']);
      if (!exists.rows.length) {
        return res.status(404).json({ ok: false, error: 'No account found with that phone' });
      }
    }

    const otpIssue = await issueOtp({
      purpose,
      channel,
      phone,
      email
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
      ? await db.query('SELECT id FROM users WHERE LOWER(email) = $1 AND status = $2 LIMIT 1', [email, 'active'])
      : await db.query('SELECT id FROM users WHERE phone = $1 AND status = $2 LIMIT 1', [phone, 'active']);
    if (!exists.rows.length) {
      return res.status(404).json({ ok: false, error: channel === 'email' ? 'No account found with that email' : 'No account found with that phone' });
    }

    const otpIssue = await issueOtp({
      purpose: 'reset_password',
      channel,
      phone,
      email
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

    const user = userResult.rows[0];
    const token = createToken(user);
    await db.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

    return res.json({ ok: true, data: { token, user: publicUser(user) } });
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
    const roleInput = cleanText(req.body.role).toLowerCase() || user.role;
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

    const roleMap = {
      'buyer / renter': 'buyer_renter',
      buyer: 'buyer_renter',
      renter: 'buyer_renter',
      buyer_renter: 'buyer_renter',
      'property owner': 'property_owner',
      owner: 'property_owner',
      property_owner: 'property_owner',
      'agent / broker': 'agent_broker',
      agent: 'agent_broker',
      broker: 'agent_broker',
      agent_broker: 'agent_broker',
      'field agent': 'field_agent',
      field_agent: 'field_agent',
      admin: 'admin'
    };
    const role = roleMap[roleInput] || user.role;

    if (emailInput && !isValidEmail(emailInput)) {
      return res.status(400).json({ ok: false, error: 'email is invalid' });
    }

    const updated = await db.query(
      `UPDATE users
       SET first_name = $2,
           last_name = $3,
           email = $4,
           role = $5,
           marketing_opt_in = $6,
           weekly_tips_opt_in = $7,
           preferred_contact_channel = $8,
           preferred_language = $9
       WHERE id = $1
       RETURNING *`,
      [auth.userId, firstName, lastName, emailInput || null, role, marketingOptIn, weeklyTipsOptIn, preferredContactChannel, preferredLanguage]
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

    return res.json({ ok: true, data: { changed: true } });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
