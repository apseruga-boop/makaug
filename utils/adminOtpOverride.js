const { cleanText } = require('../middleware/validation');

function normalizePhone(phone) {
  return cleanText(phone).replace(/\s+/g, '');
}

function normalizeUgPhone(phone) {
  const value = normalizePhone(phone);
  if (/^0\d{9}$/.test(value)) return `+256${value.slice(1)}`;
  if (/^256\d{9}$/.test(value)) return `+${value}`;
  return value;
}

function normalizeEmail(email) {
  return cleanText(email).toLowerCase();
}

function parseBooleanLike(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const text = cleanText(value).toLowerCase();
  if (!text) return fallback;
  if (['1', 'true', 'yes', 'y', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(text)) return false;
  return fallback;
}

function getAdminOtpOverrideCode() {
  return cleanText(
    process.env.ADMIN_OTP_OVERRIDE_CODE
      || process.env.AUTH_OTP_OVERRIDE_CODE
      || process.env.LISTING_OTP_OVERRIDE_CODE
      || (process.env.NODE_ENV === 'production' ? '' : '123456')
  );
}

function isAdminOtpOverrideEnabled() {
  return parseBooleanLike(process.env.ADMIN_OTP_OVERRIDE_ENABLED, process.env.NODE_ENV !== 'production');
}

function getAdminOtpOverrideAllowlist() {
  const raw = cleanText(
    process.env.ADMIN_OTP_OVERRIDE_ALLOWLIST
      || process.env.OTP_OVERRIDE_ALLOWLIST
      || ''
  );
  if (!raw) return [];

  return raw
    .split(/[\n,;]+/)
    .map((item) => cleanText(item))
    .filter(Boolean)
    .map((item) => {
      if (item === '*') return '*';
      return item.includes('@') ? normalizeEmail(item) : normalizeUgPhone(item);
    });
}

function canUseAdminOtpOverride({ channel = 'phone', identifier = '' }) {
  if (!isAdminOtpOverrideEnabled()) return false;
  const code = getAdminOtpOverrideCode();
  if (!code) return false;

  const strictAllowlist = parseBooleanLike(process.env.ADMIN_OTP_OVERRIDE_ALLOWLIST_STRICT, false);
  const allowlist = getAdminOtpOverrideAllowlist();
  if (!strictAllowlist || !allowlist.length || allowlist.includes('*')) return true;

  const normalized = channel === 'email'
    ? normalizeEmail(identifier)
    : normalizeUgPhone(identifier);

  return allowlist.includes(normalized);
}

function isAdminOtpOverrideMatch({ code = '', channel = 'phone', identifier = '' }) {
  const overrideCode = getAdminOtpOverrideCode();
  if (!overrideCode) return false;
  if (cleanText(code) !== overrideCode) return false;
  return canUseAdminOtpOverride({ channel, identifier });
}

module.exports = {
  parseBooleanLike,
  normalizeEmail,
  normalizePhone,
  normalizeUgPhone,
  getAdminOtpOverrideCode,
  getAdminOtpOverrideAllowlist,
  isAdminOtpOverrideEnabled,
  canUseAdminOtpOverride,
  isAdminOtpOverrideMatch
};
