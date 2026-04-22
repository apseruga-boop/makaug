const jwt = require('jsonwebtoken');

const {
  normalizeEmail,
  normalizeUgPhone
} = require('./adminOtpOverride');

function getListingOtpJwtSecret() {
  return process.env.LISTING_OTP_JWT_SECRET
    || process.env.JWT_SECRET
    || (process.env.NODE_ENV === 'production' ? '' : 'dev-listing-otp-secret');
}

function createListingSubmitToken({ channel = 'phone', phone = '', email = '' }) {
  const resolvedChannel = String(channel || 'phone').toLowerCase() === 'email' ? 'email' : 'phone';
  const normalizedPhone = normalizeUgPhone(phone);
  const normalizedEmail = normalizeEmail(email);
  const identifier = resolvedChannel === 'email' ? normalizedEmail : normalizedPhone;
  const secret = getListingOtpJwtSecret();
  if (!secret) {
    throw new Error('JWT secret missing for listing OTP token generation');
  }

  return jwt.sign(
    {
      purpose: 'listing_submit',
      channel: resolvedChannel,
      identifier,
      phone: normalizedPhone || null,
      email: normalizedEmail || null
    },
    secret,
    { expiresIn: process.env.LISTING_OTP_EXPIRES_IN || '30m' }
  );
}

function verifyListingSubmitToken(token) {
  const secret = getListingOtpJwtSecret();
  if (!secret) return { ok: false, error: 'missing_jwt_secret' };

  try {
    const decoded = jwt.verify(token, secret);
    const channel = String(decoded?.channel || 'phone').toLowerCase() === 'email' ? 'email' : 'phone';
    const identifier = channel === 'email'
      ? normalizeEmail(decoded?.email || decoded?.identifier)
      : normalizeUgPhone(decoded?.phone || decoded?.identifier);
    if (decoded?.purpose !== 'listing_submit' || !identifier) {
      return { ok: false, error: 'invalid_purpose' };
    }
    return {
      ok: true,
      channel,
      identifier,
      phone: normalizeUgPhone(decoded?.phone),
      email: normalizeEmail(decoded?.email)
    };
  } catch (error) {
    return { ok: false, error: 'invalid_or_expired' };
  }
}

module.exports = {
  createListingSubmitToken,
  verifyListingSubmitToken
};
